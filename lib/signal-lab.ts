// lib/signal-lab.ts
// The six surviving signal recipes. Each recipe receives the two most recent
// cohort snapshots for every active wallet and emits zero or more SignalEvent
// objects.
//
// The 2026-08-08 audit cut nine recipes that were either ungradeable or had
// negative measured expectancy: position_aging, concentration_risk,
// funding_trend, streak_continuation, liq_rebound, wallet_churn,
// anti_whale_trap, bridge_inflow, twap_accumulation.
//
// IMPORTANT: Snapshot deltas measure CHANGES IN OPEN POSITIONS, not realized PnL.
// Realized PnL comes exclusively from userFills.closedPnl, never conflate these.

import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { kv } from "@vercel/kv";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "@/lib/env";
import { computeEv, estimateTradeCost } from "@/lib/risk-engine";
import type { HlL2Book, HlCandle, HlAssetCtx } from "@/lib/hyperliquid-api-client";
import { getRecipeConfig } from "@/lib/recipe-config";
import { buildOutcomeRows } from "@/lib/outcome-helpers";
import { tieredNotional } from "@/lib/token-tiers";
import { grossNotionalByCoin, eligibleCoins } from "@/lib/coin-eligibility";
import { computeWalletRegimeFit } from "@/lib/signal-validation";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ─────────────────────────────────────────────────────────────────────────────
// Core types
// ─────────────────────────────────────────────────────────────────────────────

export interface SnapshotRow {
  id: string;
  wallet_id: string;
  wallet_address: string;
  overall_score: number;
  snapshot_time: string;       // ISO string
  account_value: number;
  total_notional: number;
  total_margin_used: number;
  liq_buffer_pct: number | null;
  position_count: number;
  positions: CohortPosition[];
  sharpe_proxy: number;
  regime_fit:   number;
  unrealized_pnl?: number;
  withdrawable?:   number;
}

export interface CohortPosition {
  position: {
    coin: string;
    szi: string;
    entryPx: string;
    positionValue: string;
    unrealizedPnl: string;
    leverage: { type: string; value: number };
    liquidationPx: string | null;
  };
  type: "oneWay";
}

/** Pair of consecutive snapshots for a wallet (prev may be null on first run). */
export interface SnapshotPair {
  walletId: string;
  walletAddress: string;
  overallScore: number;
  curr: SnapshotRow;
  prev: SnapshotRow | null;
}

export interface SignalEvent {
  wallet_id:     string;
  recipe_id:     string;
  coin:          string;
  signal_type:   "ENTRY" | "EXIT" | "SCALE_IN" | "SCALE_OUT" | "FLIP" | "ALERT";
  direction:     "LONG" | "SHORT" | "FLAT" | null;
  ev_score:      number | null;
  metadata:      Record<string, unknown>;
  // Unix-ms from the originating fill.time; null until WebSocket ingestion (Sprint 21)
  whale_fill_ts?: number | null;
}

export interface SignalLabResult {
  events:          SignalEvent[];
  emittedIds:      string[];   // signals_history UUIDs, same order as rowsWithIds
  signal_emit_ts:  string;     // ISO; captured just before the signals_history insert
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: position delta between two snapshots
// ─────────────────────────────────────────────────────────────────────────────

function posMap(snap: SnapshotRow): Map<string, CohortPosition["position"]> {
  const m = new Map<string, CohortPosition["position"]>();
  for (const ap of snap.positions) m.set(ap.position.coin, ap.position);
  return m;
}

function sign(szi: string): "LONG" | "SHORT" | "FLAT" {
  const n = parseFloat(szi);
  if (n > 0) return "LONG";
  if (n < 0) return "SHORT";
  return "FLAT";
}

/** Hard ceiling on any cadence-derived pair window. A long outage must not
 *  stretch the window until "same window" stops meaning anything. */
export const MAX_PAIR_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Median gap between prev and curr snapshot times across the pairs given.
 * This is the real detection cadence. Returns 0 when no pair has a prev
 * snapshot, which leaves the configured window untouched.
 */
export function medianPairGap(pairs: SnapshotPair[]): number {
  const gaps: number[] = [];
  for (const { curr, prev } of pairs) {
    if (!prev) continue;
    const gap = new Date(curr.snapshot_time).getTime() - new Date(prev.snapshot_time).getTime();
    if (Number.isFinite(gap) && gap > 0) gaps.push(gap);
  }
  if (gaps.length === 0) return 0;
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  return gaps.length % 2 === 1 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
}

// ─────────────────────────────────────────────────────────────────────────────
// Recipe 1 — High-Conviction Momentum Stack
// ─────────────────────────────────────────────────────────────────────────────
// ≥3 wallets adding in the same direction whose COMBINED notional delta
// exceeds $500K within the snapshot window. Previously used a per-wallet
// $500K threshold which was unreachable for most cohort account sizes.

async function recipe1(pairs: SnapshotPair[], medianPairGapMs: number): Promise<SignalEvent[]> {
  const cfg = await getRecipeConfig("momentum_stack");
  const MIN_WALLETS         = cfg["MIN_WALLETS"]         ?? 3;
  const WALLET_THRESHOLD    = MIN_WALLETS;
  const COMBINED_NOTIONAL   = cfg["COMBINED_NOTIONAL"]   ?? 500_000;
  const LARGE_MULT          = cfg["NOTIONAL_LARGE_MULT"]  ?? 0.5;
  const SMALL_MULT          = cfg["NOTIONAL_SMALL_MULT"]  ?? 0.2;

  // The pair gap is the real detection cadence. A fixed 300s window meant this
  // recipe could only fire if two snapshots landed inside 5 minutes, which the
  // schedule never guaranteed (audit 2026-08-08).
  const WINDOW_MS       = cfg["WINDOW_MS"] ?? 300_000;
  const effectiveWindow = Math.min(
    Math.max(WINDOW_MS, 2 * medianPairGapMs),
    MAX_PAIR_WINDOW_MS,
  );

  // Coin → direction → { walletIds, totalDelta }
  const buckets = new Map<string, { LONG: { ids: string[]; delta: number }; SHORT: { ids: string[]; delta: number } }>();

  for (const { walletId, curr, prev } of pairs) {
    if (!prev) continue;
    const timeDiff = new Date(curr.snapshot_time).getTime() - new Date(prev.snapshot_time).getTime();
    if (timeDiff > effectiveWindow) continue;

    const currPos = posMap(curr);
    const prevPos = posMap(prev);
    const allCoins = new Set([...currPos.keys(), ...prevPos.keys()]);

    for (const coin of allCoins) {
      const cPos = currPos.get(coin);
      const pPos = prevPos.get(coin);
      const currVal = cPos ? Math.abs(parseFloat(cPos.positionValue)) : 0;
      const prevVal = pPos ? Math.abs(parseFloat(pPos.positionValue)) : 0;
      const delta = currVal - prevVal;
      if (delta <= 0) continue; // only count increases

      const direction = cPos ? sign(cPos.szi) : null;
      if (!direction || direction === "FLAT") continue;

      if (!buckets.has(coin)) buckets.set(coin, { LONG: { ids: [], delta: 0 }, SHORT: { ids: [], delta: 0 } });
      const side = buckets.get(coin)![direction];
      side.ids.push(walletId);
      side.delta += delta;
    }
  }

  const events: SignalEvent[] = [];
  for (const [coin, sides] of buckets) {
    for (const direction of ["LONG", "SHORT"] as const) {
      const { ids, delta } = sides[direction];
      if (ids.length >= WALLET_THRESHOLD && delta >= tieredNotional(COMBINED_NOTIONAL, coin, LARGE_MULT, SMALL_MULT)) {
        events.push({
          wallet_id:   ids[0],
          recipe_id:   "momentum_stack",
          coin,
          signal_type: "ENTRY",
          direction,
          ev_score:    null,
          metadata: {
            wallet_count:    ids.length,
            wallet_ids:      ids,
            combined_delta:  delta,
            description: `${ids.length} wallets added combined $${(delta / 1e3).toFixed(0)}K ${direction} on ${coin}`,
          },
        });
      }
    }
  }
  return events;
}

// ─────────────────────────────────────────────────────────────────────────────
// Recipe 2 — Divergence Squeeze
// ─────────────────────────────────────────────────────────────────────────────
// Cohort-level: 2+ qualifying wallets loading the same coin while price is flat
// (last 30 min) and each is running thin margin (<10% liq buffer).
// Emits one signal per coin, not one per wallet. Repeat emission is prevented by
// keying off each wallet's notional delta since the previous snapshot, so an
// unchanged position contributes nothing. There is no KV cooldown despite an
// earlier version of this comment claiming one.

async function recipe2(
  pairs: SnapshotPair[],
  candles5m: Map<string, HlCandle[]>   // coin -> recent 5m candles
): Promise<SignalEvent[]> {
  const cfg = await getRecipeConfig("divergence_squeeze");
  const LIQ_BUFFER_THRESHOLD = cfg["LIQ_BUFFER_THRESHOLD"]  ?? 0.08;   // truly thin margin only
  const PRICE_FLAT_PCT       = cfg["PRICE_FLAT_PCT"]          ?? 0.005;  // <0.5% move in last 30 min
  const MIN_NOTIONAL_DELTA   = cfg["MIN_NOTIONAL_DELTA"]      ?? 75_000; // per wallet; $75K each to qualify
  const MIN_WALLET_SCORE     = cfg["MIN_WALLET_SCORE"]        ?? 0.65;   // high-conviction wallets only
  const PRICE_FLAT_CANDLES   = 6;      // 6 x 5m = 30 min
  const MIN_WALLETS          = cfg["MIN_WALLETS"]             ?? 3;      // require 3 coordinating wallets
  const LARGE_MULT           = cfg["NOTIONAL_LARGE_MULT"]     ?? 0.5;
  const SMALL_MULT           = cfg["NOTIONAL_SMALL_MULT"]     ?? 0.2;

  // Pass 1: collect wallets qualifying per coin
  type QualifiedWallet = {
    walletId: string;
    notionalDelta: number;
    liqBuffer: number;
    score: number;
    direction: "LONG" | "SHORT" | null;
    priceChangePct: number;
  };
  const coinBuckets = new Map<string, QualifiedWallet[]>();

  for (const { walletId, curr, prev, overallScore } of pairs) {
    if (!prev) continue;
    if (overallScore < MIN_WALLET_SCORE) continue;
    if ((curr.liq_buffer_pct ?? 1) >= LIQ_BUFFER_THRESHOLD) continue;

    // Find the coin with the largest per-coin notional increase (the coin being loaded)
    const currPos = posMap(curr);
    const prevPos = posMap(prev);
    let maxCoinDelta = 0;
    let targetCoin   = "";
    for (const [c, p] of currPos) {
      const pp    = prevPos.get(c);
      const delta = parseFloat(p.positionValue) - (pp ? parseFloat(pp.positionValue) : 0);
      if (delta > maxCoinDelta) { maxCoinDelta = delta; targetCoin = c; }
    }
    if (!targetCoin || maxCoinDelta < tieredNotional(MIN_NOTIONAL_DELTA, targetCoin, LARGE_MULT, SMALL_MULT)) continue;

    const notionalDelta = maxCoinDelta;
    const targetPos     = currPos.get(targetCoin)!;

    const coinCandles = candles5m.get(targetCoin) ?? [];
    if (coinCandles.length < 2) continue;

    const recentCandles = coinCandles.slice(-PRICE_FLAT_CANDLES);
    const firstClose    = parseFloat(recentCandles[0].c);
    const lastClose     = parseFloat(recentCandles[recentCandles.length - 1].c);
    const priceChange   = firstClose > 0 ? Math.abs(lastClose - firstClose) / firstClose : 1;
    if (priceChange >= PRICE_FLAT_PCT) continue;

    const coin = targetCoin;
    const dir  = sign(targetPos.szi) === "FLAT" ? null : sign(targetPos.szi) as "LONG" | "SHORT";
    const bucket = coinBuckets.get(coin) ?? [];
    bucket.push({
      walletId,
      notionalDelta,
      liqBuffer: curr.liq_buffer_pct ?? 0,
      score: overallScore,
      direction: dir,
      priceChangePct: priceChange,
    });
    coinBuckets.set(coin, bucket);
  }

  // Pass 2: emit one signal per coin that has enough qualifying wallets
  const events: SignalEvent[] = [];

  for (const [coin, wallets] of coinBuckets) {
    if (wallets.length < MIN_WALLETS) continue;

    const totalDelta   = wallets.reduce((s, w) => s + w.notionalDelta, 0);
    const avgLiqBuf    = wallets.reduce((s, w) => s + w.liqBuffer, 0) / wallets.length;
    const priceChg     = wallets[0].priceChangePct;
    // Direction: majority vote; null if split
    const longs  = wallets.filter((w) => w.direction === "LONG").length;
    const shorts = wallets.filter((w) => w.direction === "SHORT").length;
    const direction: "LONG" | "SHORT" | null =
      longs > shorts ? "LONG" : shorts > longs ? "SHORT" : null;

    const anchor = wallets.sort((a, b) => b.score - a.score)[0];

    events.push({
      wallet_id:   "",
      recipe_id:   "divergence_squeeze",
      coin,
      signal_type: "ALERT",
      direction,
      ev_score:    null,
      metadata: {
        wallet_count:      wallets.length,
        total_delta:       totalDelta,
        avg_liq_buffer:    avgLiqBuf,
        price_change_pct:  priceChg,
        wallet_ids:        wallets.map((w) => w.walletId),
        description: `${wallets.length} wallets loading ${coin} +$${(totalDelta / 1e3).toFixed(0)}K combined while flat last 30m (${(priceChg * 100).toFixed(2)}%). Avg liq buffer ${(avgLiqBuf * 100).toFixed(1)}%`,
      },
    });
  }
  return events;
}

// ─────────────────────────────────────────────────────────────────────────────
// Recipe 3 — Accumulation Re-Entry
// ─────────────────────────────────────────────────────────────────────────────
// Winners cohort increases positions after a meaningful drawdown in last 4h.
// Threshold is per-coin: 2x the coin's 4h high-low range, clamped [6%, 15%].
// BTC/ETH: threshold lands ~6%; volatile alts: up to 15%. Prevents the flat
// 8% bar from being noise on alts while missing signals on low-vol majors.

async function recipe3(
  pairs: SnapshotPair[],
  candles4h: Map<string, HlCandle[]>  // coin -> last 4h candles (e.g. 48 x 5m)
): Promise<SignalEvent[]> {
  const cfg = await getRecipeConfig("accumulation_reentry");
  const HIGH_SCORE           = cfg["HIGH_SCORE"] ?? 0.65;
  const DRAWDOWN_MULTIPLIER  = cfg["DRAWDOWN_MULTIPLIER"] ?? 2.0;  // threshold = 2x the coin's typical 4h range
  const DRAWDOWN_MIN         = cfg["DRAWDOWN_MIN"] ?? 0.06; // floor: even stable coins need a real dip
  const DRAWDOWN_MAX         = cfg["DRAWDOWN_MAX"] ?? 0.15; // ceiling: above this is capitulation, not dip-buy
  const DRAWDOWN_FALLBACK    = 0.09; // for coins without candle data (outside top-10)
  const events: SignalEvent[] = [];

  const coinsWithDrawdown = new Set<string>();

  // Identify coins with a meaningful drawdown in last 4h.
  // Threshold scales with each coin's own volatility so the bar is equally
  // selective across BTC, ETH, and small alts.
  for (const [coin, candles] of candles4h) {
    if (candles.length < 2) continue;
    const highPx    = Math.max(...candles.map((c) => parseFloat(c.h)));
    const lowPx     = Math.min(...candles.map((c) => parseFloat(c.l)));
    const lastClose = parseFloat(candles[candles.length - 1].c);
    const midPx     = parseFloat(candles[Math.floor(candles.length / 2)].c);
    const vol4h     = midPx > 0 ? (highPx - lowPx) / midPx : DRAWDOWN_FALLBACK;
    const threshold = Math.max(DRAWDOWN_MIN, Math.min(DRAWDOWN_MAX, vol4h * DRAWDOWN_MULTIPLIER));
    if (highPx > 0 && (highPx - lastClose) / highPx >= threshold) {
      coinsWithDrawdown.add(coin);
    }
  }

  if (coinsWithDrawdown.size === 0) return [];

  for (const { walletId, curr, prev, overallScore } of pairs) {
    if (!prev || overallScore < HIGH_SCORE) continue;

    const currPos = posMap(curr);
    const prevPos = posMap(prev);

    for (const coin of coinsWithDrawdown) {
      const cPos = currPos.get(coin);
      const pPos = prevPos.get(coin);
      if (!cPos) continue; // wallet doesn't hold this coin now

      const currSzi = parseFloat(cPos.szi);
      const prevSzi = pPos ? parseFloat(pPos.szi) : 0;

      // Wallet increased position size (same direction)
      const sameDir   = Math.sign(currSzi) === Math.sign(prevSzi) || prevSzi === 0;
      const increased = Math.abs(currSzi) > Math.abs(prevSzi) * 1.05;

      if (!sameDir || !increased) continue;

      events.push({
        wallet_id:   walletId,
        recipe_id:   "accumulation_reentry",
        coin,
        signal_type: "SCALE_IN",
        direction:   currSzi > 0 ? "LONG" : "SHORT",
        ev_score:    null,
        metadata: {
          wallet_score:     overallScore,
          coin_drawdown_pct: (() => {
            const candles = candles4h.get(coin) ?? [];
            if (!candles.length) return null;
            const high  = Math.max(...candles.map((c) => parseFloat(c.h)));
            const close = parseFloat(candles[candles.length - 1].c);
            return high > 0 ? (high - close) / high : null;
          })(),
          description: `High-score wallet re-entering ${coin} after >8% 4h drawdown`,
        },
      });
    }
  }
  return events;
}

// ─────────────────────────────────────────────────────────────────────────────
// Recipe 4 — Rotation Carry Play
// ─────────────────────────────────────────────────────────────────────────────
// Rotation into positive-funding perps with >60% historical follow-through.

async function recipe4(
  pairs: SnapshotPair[],
  assetCtxMap: Map<string, HlAssetCtx>,
  recipeNetWinRates: Map<string, number>,
  recipeGradedCounts: Map<string, number>
): Promise<SignalEvent[]> {
  const cfg = await getRecipeConfig("rotation_carry");
  const MIN_FUNDING = cfg["MIN_FUNDING"] ?? 0.0003;           // 0.03%/hr minimum positive funding
  const MIN_HISTORICAL_WINRATE = cfg["MIN_HISTORICAL_WINRATE"] ?? 0.60;
  const events: SignalEvent[] = [];

  for (const { walletId, curr, prev } of pairs) {
    if (!prev) continue;

    const currPos = posMap(curr);
    const prevPos = posMap(prev);

    for (const [coin, cPos] of currPos) {
      const pPos = prevPos.get(coin);
      const isNew = !pPos || Math.abs(parseFloat(pPos.szi)) < 1e-8;
      if (!isNew) continue; // only new entries

      const ctx = assetCtxMap.get(coin);
      if (!ctx) continue;

      const funding = parseFloat(ctx.funding);
      if (funding < MIN_FUNDING) continue; // funding too low

      // Check historical follow-through for this recipe.
      // Source is win_rate_net from the newest nightly recipe_performance row,
      // the fraction of graded outcomes with positive net PnL. The old source,
      // win_rate, is the intraday ev_score > 0 proxy, so the gate was measuring
      // our own EV assignment rather than realized outcomes (audit 2026-08-08).
      // Keys are recipe IDs only (e.g. "rotation_carry"), not "recipe:coin".
      // Bootstrap: fire freely until 10 graded signals exist, then apply the
      // filter, which prevents tuning on zero data.
      const histWinRate  = recipeNetWinRates.get("rotation_carry");
      const histCount    = recipeGradedCounts.get("rotation_carry") ?? 0;
      const bootstrapped = histCount >= 10;
      if (bootstrapped && (histWinRate ?? 1) < MIN_HISTORICAL_WINRATE) continue;

      events.push({
        wallet_id:   walletId,
        recipe_id:   "rotation_carry",
        coin,
        signal_type: "ENTRY",
        direction:   parseFloat(cPos.szi) > 0 ? "LONG" : "SHORT",
        ev_score:    null,
        metadata: {
          funding_rate:    funding,
          hist_win_rate:   histWinRate,
          open_interest:   ctx.openInterest,
          description: `New ${coin} position with +${(funding * 100).toFixed(4)}% funding. Historical follow-through: ${((histWinRate ?? 0) * 100).toFixed(0)}%`,
        },
      });
    }
  }
  return events;
}

// ─────────────────────────────────────────────────────────────────────────────
// Recipe 7 — Funding + Extreme Divergence
// ─────────────────────────────────────────────────────────────────────────────
// Smart-money bias opposite to retail OI proxy + funding > 0.05%.
// Retail OI proxy = totalOI − cohort net notional (see risk-engine.ts).
// Fires on the ONSET of divergence, not while it persists. Divergence is a state
// that lasts as long as the position is held, so emitting on the state produced
// one row per poll: a single held KAITO long generated 83 signals in 13.5 hours.

async function recipe7(
  pairs: SnapshotPair[],
  assetCtxMap: Map<string, HlAssetCtx>
): Promise<SignalEvent[]> {
  const cfg = await getRecipeConfig("funding_divergence");
  const FUNDING_THRESHOLD = cfg["FUNDING_THRESHOLD"] ?? 0.0005;   // 0.05%/hr
  const events: SignalEvent[] = [];

  // Aggregate cohort net notional per coin, for the current snapshot and for
  // the previous one. Divergence is a state that persists for as long as the
  // cohort holds the position, so emitting on the state re-emits the same idea
  // on every poll. Comparing against prev turns it into an onset event.
  const netByCoin = (side: "curr" | "prev") => {
    const net = new Map<string, number>();
    for (const pair of pairs) {
      const snapshot = side === "curr" ? pair.curr : pair.prev;
      if (!snapshot) continue;
      for (const ap of snapshot.positions) {
        const val    = parseFloat(ap.position.positionValue);
        const szi    = parseFloat(ap.position.szi);
        const signed = szi > 0 ? val : -val;
        net.set(ap.position.coin, (net.get(ap.position.coin) ?? 0) + signed);
      }
    }
    return net;
  };

  const cohortNet = netByCoin("curr");
  const prevNet   = netByCoin("prev");

  for (const [coin, netNotional] of cohortNet) {
    const ctx = assetCtxMap.get(coin);
    if (!ctx) continue;

    const funding = parseFloat(ctx.funding);
    if (Math.abs(funding) < FUNDING_THRESHOLD) continue;

    const cohortLong = netNotional > 0;

    // Funding rate direction as crowd positioning proxy:
    //   positive funding → longs paying shorts → market crowd is net long
    //   negative funding → shorts paying longs → market crowd is net short
    // This fixes the original unsigned-OI approach which was always positive
    // and therefore only detected divergence when the cohort was net short.
    const crowdLong = funding > 0;

    // Signal only when smart money and crowd are on opposite sides
    if (cohortLong === crowdLong) continue;

    // Only on the onset. A coin with no prior cohort exposure counts as not
    // previously divergent, so newly opened divergent positions still fire.
    // Funding is only available at its current value, so a divergence that
    // begins with a funding flip rather than a cohort flip is missed. That is
    // the rarer case and is preferable to re-emitting on every poll.
    const prevNotional = prevNet.get(coin);
    const wasDivergent =
      prevNotional !== undefined &&
      prevNotional !== 0 &&
      (prevNotional > 0) !== crowdLong;
    if (wasDivergent) continue;

    events.push({
      wallet_id:   "",   // cohort-level
      recipe_id:   "funding_divergence",
      coin,
      signal_type: "ALERT",
      direction:   cohortLong ? "LONG" : "SHORT",
      ev_score:    null,
      metadata: {
        cohort_net_notional: netNotional,
        funding_rate:        funding,
        crowd_bias:          crowdLong ? "LONG" : "SHORT",
        description: `Smart money ${cohortLong ? "LONG" : "SHORT"} while funding implies crowd ${crowdLong ? "LONG" : "SHORT"} on ${coin}. Funding ${(funding * 100).toFixed(4)}%.`,
      },
    });
  }
  return events;
}

// ─────────────────────────────────────────────────────────────────────────────
// Recipe 8 — Whale Validation Filter
// ─────────────────────────────────────────────────────────────────────────────
// Signal confirmed by ≥3 core cohort wallets (score ≥ 0.75) within 60s.

async function recipe8(
  pairs: SnapshotPair[],
  pendingSignals: SignalEvent[]   // signals from other recipes in this cycle
): Promise<SignalEvent[]> {
  const cfg = await getRecipeConfig("whale_validated");
  const MIN_WALLETS     = cfg["MIN_WALLETS"] ?? 3;
  const MIN_SCORE       = cfg["MIN_SCORE"] ?? 0.75;
  const MIN_WHALE_COUNT = MIN_WALLETS;
  const WHALE_SCORE     = MIN_SCORE;
  const events: SignalEvent[] = [];

  // Build map of coin+direction → whale wallets with FRESH activity.
  // "Fresh" means the position is new (not in prev) or grew since prev.
  // Whales holding week-old unchanged positions are excluded — they would
  // otherwise launder unrelated signals indefinitely in their direction.
  const whaleActivity = new Map<string, string[]>();
  for (const { walletId, overallScore, curr, prev } of pairs) {
    if (overallScore < WHALE_SCORE) continue;
    const prevPositions = prev ? posMap(prev) : null;
    for (const ap of curr.positions) {
      const dir = sign(ap.position.szi);
      if (dir === "FLAT") continue;

      const prevPos = prevPositions?.get(ap.position.coin);
      const currSzi = Math.abs(parseFloat(ap.position.szi));
      const prevSzi = prevPos ? Math.abs(parseFloat(prevPos.szi)) : 0;

      // Accept: new position (no prev entry) or position size grew by >5%
      const isActive = !prevPos || currSzi > prevSzi * 1.05;
      if (!isActive) continue;

      const key = `${ap.position.coin}:${dir}`;
      const list = whaleActivity.get(key) ?? [];
      list.push(walletId);
      whaleActivity.set(key, list);
    }
  }

  // Re-emit pending signals that pass the whale validation
  for (const sig of pendingSignals) {
    if (!sig.direction || sig.direction === "FLAT") continue;
    const key = `${sig.coin}:${sig.direction}`;
    const whales = whaleActivity.get(key) ?? [];
    if (whales.length >= MIN_WHALE_COUNT) {
      events.push({
        ...sig,
        recipe_id:  "whale_validated",
        signal_type: "ENTRY",
        metadata: {
          ...sig.metadata,
          original_recipe: sig.recipe_id,
          validating_whales: whales.length,
          whale_wallet_ids:  whales,
          description: `${sig.recipe_id} signal on ${sig.coin} validated by ${whales.length} core whales (score ≥ ${WHALE_SCORE})`,
        },
      });
    }
  }
  return events;
}

// ─────────────────────────────────────────────────────────────────────────────
// Test-only exports
// ─────────────────────────────────────────────────────────────────────────────
// Production callers must go through runSignalLab, which sequences the recipes,
// enriches with EV, and persists. These aliases exist so each recipe can be
// driven in isolation from a golden fixture without also exercising the
// Supabase and KV write path.

export {
  recipe1 as momentumStackRecipe,
  recipe2 as divergenceSqueezeRecipe,
  recipe3 as accumulationReentryRecipe,
  recipe4 as rotationCarryRecipe,
  recipe7 as fundingDivergenceRecipe,
  recipe8 as whaleValidatedRecipe,
};

// ─────────────────────────────────────────────────────────────────────────────
// EV enrichment — attach EV scores where backtest data is available
// ─────────────────────────────────────────────────────────────────────────────

// Minimum resolved outcomes in recipe_calibration before the recipe base rate
// is trusted enough to contribute to the 70% weight.  Below this threshold the
// blend falls back to wallet-only win_rate.
const RECIPE_MIN_SAMPLE = 30;

// Bayesian weights for EV win_probability: recipe base rate vs wallet adjustment.
const RECIPE_WEIGHT = 0.70;
const WALLET_WEIGHT = 0.30;

function enrichWithEv(
  events: SignalEvent[],
  backtestMap: Map<string, { win_rate: number; avg_win_usd: number; avg_loss_usd: number }>,
  l2Books: Map<string, HlL2Book>,
  recipeCalibrationMap: Map<string, { win_rate: number; sample_size_30d: number }>,
  walletSignalStatsMap: Map<string, { win_rate_net: number; signal_count: number }>
): SignalEvent[] {
  // Track how much EV is still priced off backtest data rather than measured
  // outcomes. Silent fallback hid four months of circular pricing.
  let backtestFallbacks = 0;
  let priced = 0;

  const enriched = events.map((event) => {
    const bt = event.wallet_id ? backtestMap.get(event.wallet_id) : null;
    if (!bt || bt.win_rate === 0) return event;

    const book    = l2Books.get(event.coin) ?? null;
    const notional = 10_000; // reference notional for EV normalisation
    const cost    = estimateTradeCost(notional, book, event.direction === "LONG" ? "buy" : "sell");

    // Blend recipe base rate (70%) + outcome-measured wallet win rate (30%).
    // wallet_signal_stats provides the 30% from real resolved outcomes, breaking
    // the circular path where backtest win_rate drove both cohort rank and EV.
    // Falls back to backtest win_rate for the wallet component when no outcome data.
    const cal = recipeCalibrationMap.get(event.recipe_id ?? "");
    const recipeWinRate = cal && cal.sample_size_30d >= RECIPE_MIN_SAMPLE ? cal.win_rate : null;

    const walletKey = `${event.wallet_id}:${event.recipe_id ?? ""}`;
    const wss = walletSignalStatsMap.get(walletKey);
    const walletWinRate = wss ? wss.win_rate_net : bt.win_rate;

    priced++;
    if (!wss && recipeWinRate === null) backtestFallbacks++;

    const blendedWinRate = recipeWinRate !== null
      ? RECIPE_WEIGHT * recipeWinRate + WALLET_WEIGHT * walletWinRate
      : walletWinRate;

    const ev = computeEv({
      win_probability: blendedWinRate,
      avg_win_usd:     bt.avg_win_usd,
      avg_loss_usd:    bt.avg_loss_usd,
      trade_cost_usd:  cost.total,
    });

    return { ...event, ev_score: ev.is_reliable ? ev.ev_score : null };
  });

  if (priced > 0) {
    console.log(
      `[ev] priced ${priced} signals, ${backtestFallbacks} from backtest fallback ` +
      `(no measured calibration or wallet stats yet)`
    );
  }

  return enriched;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main runner — call all recipes and persist results
// ─────────────────────────────────────────────────────────────────────────────

export interface SignalLabInputs {
  pairs:               SnapshotPair[];
  candles5m:           Map<string, HlCandle[]>;
  candles4h:           Map<string, HlCandle[]>;
  assetCtxMap:         Map<string, HlAssetCtx>;
  allMids:             Record<string, string>;
  backtestMap:         Map<string, { win_rate: number; avg_win_usd: number; avg_loss_usd: number; win_streak: number; sharpe_ratio: number }>;
  l2Books:             Map<string, HlL2Book>;
  /** recipe_performance.win_rate_net from the newest nightly row per recipe,
   *  the fraction of graded outcomes with positive net PnL. Gates rotation_carry. */
  recipeNetWinRates:   Map<string, number>;
  /** recipe_performance.sample_size_60d from the same row: graded outcome count.
   *  rotation_carry's win-rate gate stays bypassed until this reaches 10. */
  recipeGradedCounts:  Map<string, number>;
  regime:              "BULL" | "BEAR" | "RANGING";
  /** Per-wallet regime profile from wallet_profiles. Optional -- absent = no regime fit annotation. */
  walletProfileMap?:   Map<string, { bull_daily_pnl: number | null; bear_daily_pnl: number | null; ranging_daily_pnl: number | null }>;
  /** Recipe-level calibration from recipe_calibration table (R12). Used for 70% EV base rate.
   *  Optional for backward-compat -- absent = enrichWithEv falls back to wallet-only win_rate. */
  recipeCalibrationMap?: Map<string, { win_rate: number; sample_size_30d: number }>;
  /** Per-wallet per-recipe outcome stats from wallet_signal_stats (R12). Keyed as
   *  `${wallet_id}:${recipe_id}`. Used for the 30% wallet component of the EV blend,
   *  replacing the circular backtest win_rate path. Optional -- absent = falls back. */
  walletSignalStatsMap?: Map<string, { win_rate_net: number; signal_count: number }>;
}

/**
 * Run the six surviving signal recipes, enrich with EV scores, persist to Supabase.
 *
 * @param inputs  All market data and cohort state required by recipes
 * @returns Signal events, inserted DB IDs, and the emit timestamp for latency tracking
 */
export async function runSignalLab(inputs: SignalLabInputs): Promise<SignalLabResult> {
  const {
    pairs, candles5m, candles4h, assetCtxMap, allMids,
    backtestMap, l2Books, recipeNetWinRates, recipeGradedCounts, regime,
    walletProfileMap,
  } = inputs;
  const walletSignalStatsMap = inputs.walletSignalStatsMap ?? new Map<string, { win_rate_net: number; signal_count: number }>();

  // Observed detection cadence for this batch. momentum_stack widens its window
  // from this instead of assuming snapshots land 5 minutes apart.
  const medianPairGapMs = medianPairGap(pairs);

  // Run the five independent recipes in parallel; whale_validated depends on their output
  const [r1, r2, r3, r4, r7] = await Promise.all([
    recipe1(pairs, medianPairGapMs),
    recipe2(pairs, candles5m),
    recipe3(pairs, candles4h),
    recipe4(pairs, assetCtxMap, recipeNetWinRates, recipeGradedCounts),
    recipe7(pairs, assetCtxMap),
  ]);
  const preValidation = [...r1, ...r2, ...r3, ...r4, ...r7];
  const r8 = await recipe8(pairs, preValidation);

  // Exclude original signals that were re-emitted as whale_validated to avoid duplicate
  // feed entries. The whale_validated event preserves original_recipe in its metadata.
  const validatedKeys = new Set(
    r8.map((s) => `${s.wallet_id}:${s.coin}:${s.direction ?? ""}`)
  );
  const dedupedPre = preValidation.filter(
    (s) => !validatedKeys.has(`${s.wallet_id}:${s.coin}:${s.direction ?? ""}`)
  );
  const emitted = [...dedupedPre, ...r8];

  // Single choke point: drop signals on coins the cohort has no real capital in.
  // Applied here rather than inside each recipe so it covers all six, and any
  // recipe added later, without each needing to remember.
  const grossByCoin = grossNotionalByCoin(
    pairs.flatMap((p) =>
      p.curr.positions.map((ap) => ({
        coin:          ap.position.coin,
        szi:           parseFloat(ap.position.szi),
        positionValue: parseFloat(ap.position.positionValue),
      }))
    )
  );
  const eligible  = eligibleCoins(grossByCoin);
  const allEvents = emitted.filter((e) => eligible.has(e.coin));

  if (allEvents.length < emitted.length) {
    // Never drop silently: a shrinking feed must be explainable.
    const droppedByCoin = new Map<string, number>();
    for (const e of emitted) {
      if (!eligible.has(e.coin)) droppedByCoin.set(e.coin, (droppedByCoin.get(e.coin) ?? 0) + 1);
    }
    const summary = [...droppedByCoin.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([coin, n]) => `${coin}x${n}`)
      .join(", ");
    console.log(
      `[signal-lab] conviction gate dropped ${emitted.length - allEvents.length} of ` +
      `${emitted.length} signals on low-conviction coins: ${summary}. ` +
      `${eligible.size} coins eligible.`
    );
  }

  // Enrich with EV scores
  const enriched = enrichWithEv(allEvents, backtestMap, l2Books, inputs.recipeCalibrationMap ?? new Map(), walletSignalStatsMap);

  // Annotate each signal with wallet regime fit (how well this wallet performs in current regime)
  if (walletProfileMap) {
    for (const event of enriched) {
      const profile = walletProfileMap.get(event.wallet_id);
      const fit = profile
        ? computeWalletRegimeFit(
            profile.bull_daily_pnl,
            profile.bear_daily_pnl,
            profile.ranging_daily_pnl,
            regime,
          )
        : null;
      event.metadata = { ...event.metadata, wallet_regime_fit: fit };
    }
  }

  // Persist to Supabase (skip cohort-level events with empty wallet_id)
  // wallet_id is a Supabase UUID (36 chars: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
  const toInsert = enriched
    .filter((e) => e.wallet_id.length === 36)
    .map((e) => ({
      wallet_id:   e.wallet_id,
      recipe_id:   e.recipe_id,
      coin:        e.coin,
      signal_type: e.signal_type,
      direction:   e.direction,
      detected_at: new Date().toISOString(),
      ev_score:    e.ev_score,
      metadata:    e.metadata,
    }));

  // Also insert cohort-level events (wallet_id = first active wallet as placeholder)
  const cohortEvents = enriched
    .filter((e) => e.wallet_id.length !== 36)
    .map((e) => ({
      wallet_id:   pairs[0]?.walletId ?? "",
      recipe_id:   e.recipe_id,
      coin:        e.coin,
      signal_type: e.signal_type,
      direction:   e.direction,
      detected_at: new Date().toISOString(),
      ev_score:    e.ev_score,
      metadata:    { ...e.metadata, cohort_level: true },
    }))
    .filter((e) => e.wallet_id.length > 0);

  // Assign UUIDs client-side so the outcome write does not depend on PostgREST
  // returning the inserted rows. Under load .insert().select() has been observed
  // to return empty arrays even when rows land — silently skipping outcomes.
  const rowsWithIds = [...toInsert, ...cohortEvents].map((r) => ({
    ...r,
    id: randomUUID(),
  }));

  const signal_emit_ts = new Date().toISOString();
  let emittedIds: string[] = [];

  if (rowsWithIds.length > 0) {
    const { error } = await supabase.from("signals_history").insert(rowsWithIds);
    if (error) {
      console.error("[signal-lab] insert error:", error.message);
    } else {
      emittedIds = rowsWithIds.map((r) => r.id);
      console.log(`[signal-lab] inserted ${rowsWithIds.length} signal events`);
      // Augment allMids with last-close from candles5m for coins missing a live mid.
      // Covers the edge case where a coin has open positions (and thus fires signals)
      // but dropped out of allMids between the position fetch and the mid fetch.
      const priceMap: Record<string, string> = { ...allMids };
      for (const [coin, candles] of candles5m) {
        if (!priceMap[coin] && candles.length > 0) {
          priceMap[coin] = candles[candles.length - 1].c;
        }
      }
      const outcomeRows = buildOutcomeRows(rowsWithIds, priceMap);
      if (outcomeRows.length < rowsWithIds.length) {
        const missingCoins = [...new Set(rowsWithIds.map((s) => s.coin))].filter((c) => !priceMap[c]);
        if (missingCoins.length > 0) {
          console.warn(`[signal-lab] ${missingCoins.length} coins missing from allMids+candles5m (likely delisted):`, missingCoins);
        }
      }
      if (outcomeRows.length > 0) {
        const { error: oErr } = await supabase.from("signal_outcomes").insert(outcomeRows);
        if (oErr) {
          console.error("[signal-lab] signal_outcomes insert FAILED:", oErr.message, {
            sampleCoin: outcomeRows[0]?.coin,
          });
        } else {
          console.log(`[signal-lab] inserted ${outcomeRows.length} outcome seed rows`);
        }
      }

      // Update intraday KV after insert so this run's signals are included in the count
      const sixHoursAgo = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
      const { data: recentPerf } = await supabase
        .from("signals_history")
        .select("recipe_id, ev_score")
        .gte("detected_at", sixHoursAgo)
        .not("ev_score", "is", null);
      if (recentPerf && recentPerf.length > 0) {
        const byRecipe = new Map<string, number[]>();
        for (const row of recentPerf) {
          const list = byRecipe.get(row.recipe_id) ?? [];
          list.push(row.ev_score as number);
          byRecipe.set(row.recipe_id, list);
        }
        const intradayPerf: Record<string, { avg_ev: number; count: number }> = {};
        for (const [recipeId, scores] of byRecipe) {
          intradayPerf[recipeId] = {
            avg_ev: scores.reduce((a, b) => a + b, 0) / scores.length,
            count:  scores.length,
          };
        }
        kv.set("recipe:intraday_perf", intradayPerf, { ex: 7 * 3600 }).catch(() => {});
      }
    }
  }

  return { events: enriched, emittedIds, signal_emit_ts };
}
