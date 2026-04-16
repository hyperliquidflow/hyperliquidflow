// lib/signal-lab.ts
// All 9 signal recipes. Each recipe receives the two most recent cohort
// snapshots for every active wallet and emits zero or more SignalEvent objects.
//
// IMPORTANT: Snapshot deltas measure CHANGES IN OPEN POSITIONS, not realized PnL.
// Realized PnL comes exclusively from userFills.closedPnl — never conflate these.

import { createClient } from "@supabase/supabase-js";
import { kv } from "@vercel/kv";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "@/lib/env";
import { computeEv, estimateTradeCost } from "@/lib/risk-engine";
import type { HlL2Book, HlCandle, HlAssetCtx } from "@/lib/hyperliquid-api-client";
import { getRecipeConfig } from "@/lib/recipe-config";
import { buildOutcomeRows } from "@/lib/outcome-helpers";

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
  wallet_id:   string;
  recipe_id:   string;
  coin:        string;
  signal_type: "ENTRY" | "EXIT" | "SCALE_IN" | "SCALE_OUT" | "FLIP" | "ALERT";
  direction:   "LONG" | "SHORT" | "FLAT" | null;
  ev_score:    number | null;
  metadata:    Record<string, unknown>;
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

// ─────────────────────────────────────────────────────────────────────────────
// Recipe 1 — High-Conviction Momentum Stack
// ─────────────────────────────────────────────────────────────────────────────
// ≥3 wallets adding in the same direction whose COMBINED notional delta
// exceeds $500K within the snapshot window. Previously used a per-wallet
// $500K threshold which was unreachable for most cohort account sizes.

async function recipe1(pairs: SnapshotPair[]): Promise<SignalEvent[]> {
  const cfg = await getRecipeConfig("momentum_stack");
  const MIN_WALLETS         = cfg["MIN_WALLETS"] ?? 3;
  const WALLET_THRESHOLD    = MIN_WALLETS;
  const COMBINED_NOTIONAL   = cfg["COMBINED_NOTIONAL"] ?? 500_000;
  const WINDOW_MS           = cfg["WINDOW_MS"] ?? 300_000;

  // Coin → direction → { walletIds, totalDelta }
  const buckets = new Map<string, { LONG: { ids: string[]; delta: number }; SHORT: { ids: string[]; delta: number } }>();

  for (const { walletId, curr, prev } of pairs) {
    if (!prev) continue;
    const timeDiff = new Date(curr.snapshot_time).getTime() - new Date(prev.snapshot_time).getTime();
    if (timeDiff > WINDOW_MS) continue;

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
      if (ids.length >= WALLET_THRESHOLD && delta >= COMBINED_NOTIONAL) {
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
// Emits one signal per coin, not one per wallet. 20-min KV cooldown per coin.

async function recipe2(
  pairs: SnapshotPair[],
  candles5m: Map<string, HlCandle[]>   // coin -> recent 5m candles
): Promise<SignalEvent[]> {
  const cfg = await getRecipeConfig("divergence_squeeze");
  const LIQ_BUFFER_THRESHOLD = cfg["LIQ_BUFFER_THRESHOLD"] ?? 0.08;   // truly thin margin only
  const PRICE_FLAT_PCT       = cfg["PRICE_FLAT_PCT"] ?? 0.005;  // <0.5% move in last 30 min
  const MIN_NOTIONAL_DELTA   = cfg["MIN_NOTIONAL_DELTA"] ?? 75_000; // per wallet; $75K each to qualify
  const MIN_WALLET_SCORE     = cfg["MIN_WALLET_SCORE"] ?? 0.65;   // high-conviction wallets only
  const PRICE_FLAT_CANDLES   = 6;      // 6 x 5m = 30 min
  const MIN_WALLETS          = cfg["MIN_WALLETS"] ?? 3;      // require 3 coordinating wallets

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
    if (!targetCoin || maxCoinDelta < MIN_NOTIONAL_DELTA) continue;

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
  recipeWinRates: Map<string, number>,
  recipeSignalCounts: Map<string, number>
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
      // recipeWinRates keys are recipe IDs only (e.g. "rotation_carry"), not "recipe:coin".
      // Disable during bootstrap: wait for at least 10 historical signals before
      // applying the win-rate filter; prevents free-firing for weeks on the 0.65 default.
      const histWinRate = recipeWinRates.get("rotation_carry");
      const histCount   = recipeSignalCounts.get("rotation_carry") ?? 0;
      if (histCount < 10) continue;
      if ((histWinRate ?? 0) < MIN_HISTORICAL_WINRATE) continue;

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
// Recipe 5 — Post-Liquidation Rebound (approximated)
// ─────────────────────────────────────────────────────────────────────────────
// Large fills (>$2M notional) within 60s of a cohort-wide >5% position reduction.
//
// NOTE: True liquidation cascade detection requires the Hyperliquid WebSocket
// (orderbook + liquidation stream). This approximation uses cohort position
// shrinkage + fill volume spike as a proxy. Tagged Phase 3 for WS upgrade.

async function recipe5(
  pairs: SnapshotPair[],
  allMids: Record<string, string>,
  priorAllMids: Record<string, string> | null
): Promise<SignalEvent[]> {
  const cfg = await getRecipeConfig("liq_rebound");
  const POSITION_SHRINK_PCT      = cfg["POSITION_SHRINK_PCT"] ?? 0.05;   // cohort net notional drops >5%
  const PRICE_SPIKE_PCT_MAJOR    = cfg["PRICE_SPIKE_PCT_MAJOR"] ?? 0.015;  // BTC/ETH: cascade-level only (was 0.02 flat)
  const PRICE_SPIKE_PCT_ALT      = cfg["PRICE_SPIKE_PCT_ALT"] ?? 0.035;  // alts: filter routine volatility
  const MAJOR_COINS              = new Set(["BTC", "ETH"]);
  const events: SignalEvent[] = [];

  // Without prior mids we cannot confirm price movement — skip to avoid false fires
  if (!priorAllMids) return events;

  // Aggregate cohort-level notional delta per coin
  const coinDelta = new Map<string, { before: number; after: number }>();
  for (const { curr, prev } of pairs) {
    if (!prev) continue;
    const coins = new Set([...posMap(curr).keys(), ...posMap(prev).keys()]);
    for (const coin of coins) {
      const currVal = parseFloat(posMap(curr).get(coin)?.positionValue ?? "0");
      const prevVal = parseFloat(posMap(prev).get(coin)?.positionValue ?? "0");
      const existing = coinDelta.get(coin) ?? { before: 0, after: 0 };
      coinDelta.set(coin, {
        before: existing.before + Math.abs(prevVal),
        after:  existing.after  + Math.abs(currVal),
      });
    }
  }

  for (const [coin, { before, after }] of coinDelta) {
    if (before < 1_000_000) continue; // too small to matter
    const shrink = (before - after) / before;
    if (shrink < POSITION_SHRINK_PCT) continue;

    const currentMidStr = allMids[coin];
    const priorMidStr   = priorAllMids[coin];
    if (!currentMidStr || !priorMidStr) continue;

    const currentMid = parseFloat(currentMidStr);
    const priorMid   = parseFloat(priorMidStr);
    if (priorMid <= 0) continue;

    // Price must have moved meaningfully since the prior cycle to confirm market
    // stress vs routine de-risking. Threshold is lower for majors (cascade-only)
    // and higher for alts (filters routine volatility).
    const priceMove     = Math.abs(currentMid - priorMid) / priorMid;
    const PRICE_SPIKE_PCT = MAJOR_COINS.has(coin) ? PRICE_SPIKE_PCT_MAJOR : PRICE_SPIKE_PCT_ALT;
    if (priceMove < PRICE_SPIKE_PCT) continue;

    // Rebound direction: if price dropped → longs got liquidated → LONG rebound
    const direction: "LONG" | "SHORT" = currentMid < priorMid ? "LONG" : "SHORT";

    events.push({
      wallet_id:   "", // cohort-level event, no single wallet
      recipe_id:   "liq_rebound",
      coin,
      signal_type: "ALERT",
      direction,
      ev_score:    null,
      metadata: {
        cohort_notional_before: before,
        cohort_notional_after:  after,
        shrink_pct:             shrink,
        price_move_pct:         priceMove,
        current_mid:            currentMidStr,
        prior_mid:              priorMidStr,
        warning: "APPROXIMATION: true liq cascade detection requires WebSocket (Phase 3)",
        description: `Cohort ${coin} exposure dropped ${(shrink * 100).toFixed(1)}% + price moved ${(priceMove * 100).toFixed(2)}%. Possible liquidation cascade. ${direction} rebound watch.`,
      },
    });
  }
  return events;
}

// ─────────────────────────────────────────────────────────────────────────────
// Recipe 6 — Streak Continuation
// ─────────────────────────────────────────────────────────────────────────────
// Wallet on 5+ win streak with Sharpe proxy > 1.8 (normalised > 0.6).

async function recipe6(
  pairs: SnapshotPair[],
  backtestMap: Map<string, { win_streak: number; sharpe_ratio: number }>
): Promise<SignalEvent[]> {
  const cfg = await getRecipeConfig("streak_continuation");
  const MIN_STREAK  = cfg["MIN_STREAK"] ?? 5;
  const MIN_SHARPE  = cfg["MIN_SHARPE"] ?? 0.60;   // normalised (maps to raw ~1.8)
  const events: SignalEvent[] = [];

  for (const { walletId, curr } of pairs) {
    const bt = backtestMap.get(walletId);
    if (!bt) continue;
    if (bt.win_streak < MIN_STREAK)   continue;
    if (bt.sharpe_ratio < MIN_SHARPE) continue;

    // Emit for the wallet's largest current position
    const largest = [...posMap(curr).values()].sort(
      (a, b) => parseFloat(b.positionValue) - parseFloat(a.positionValue)
    )[0];
    if (!largest) continue;

    events.push({
      wallet_id:   walletId,
      recipe_id:   "streak_continuation",
      coin:        largest.coin,
      signal_type: "ALERT",
      direction:   sign(largest.szi) === "FLAT" ? null : sign(largest.szi),
      ev_score:    null,
      metadata: {
        win_streak:   bt.win_streak,
        sharpe_proxy: bt.sharpe_ratio,
        description:  `Wallet on ${bt.win_streak}-trade win streak, Sharpe proxy ${bt.sharpe_ratio.toFixed(2)}. Holding ${largest.coin}.`,
      },
    });
  }
  return events;
}

// ─────────────────────────────────────────────────────────────────────────────
// Recipe 7 — Funding + Extreme Divergence
// ─────────────────────────────────────────────────────────────────────────────
// Smart-money bias opposite to retail OI proxy + funding > 0.05%.
// Retail OI proxy = totalOI − cohort net notional (see risk-engine.ts).

async function recipe7(
  pairs: SnapshotPair[],
  assetCtxMap: Map<string, HlAssetCtx>
): Promise<SignalEvent[]> {
  const cfg = await getRecipeConfig("funding_divergence");
  const FUNDING_THRESHOLD = cfg["FUNDING_THRESHOLD"] ?? 0.0005;   // 0.05%/hr
  const events: SignalEvent[] = [];

  // Aggregate cohort net notional per coin
  const cohortNet = new Map<string, number>();
  for (const { curr } of pairs) {
    for (const ap of curr.positions) {
      const coin = ap.position.coin;
      const val  = parseFloat(ap.position.positionValue);
      const szi  = parseFloat(ap.position.szi);
      const signed = szi > 0 ? val : -val;
      cohortNet.set(coin, (cohortNet.get(coin) ?? 0) + signed);
    }
  }

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
// Recipe 9 — Anti-Whale Trap
// ─────────────────────────────────────────────────────────────────────────────
// Rapid exposure reduction + negative regime score → defensive flat/short signal.

async function recipe9(
  pairs: SnapshotPair[],
  regime: "BULL" | "BEAR" | "RANGING"
): Promise<SignalEvent[]> {
  const cfg = await getRecipeConfig("anti_whale_trap");
  const HIGH_SCORE          = cfg["HIGH_SCORE"] ?? 0.70;
  const REDUCTION_PCT       = cfg["REDUCTION_PCT"] ?? 0.30;
  const REDUCTION_THRESHOLD = REDUCTION_PCT;
  const LOW_REGIME_FIT      = 0.35;   // regime_fit below this = danger
  const events: SignalEvent[] = [];

  for (const { walletId, curr, prev, overallScore } of pairs) {
    if (!prev) continue;
    if (overallScore < HIGH_SCORE) continue; // only watch high-score wallets

    const reduction = prev.total_notional > 0
      ? (prev.total_notional - curr.total_notional) / prev.total_notional
      : 0;
    if (reduction < REDUCTION_THRESHOLD) continue;

    const regimeFitLow = (curr.regime_fit ?? 1) < LOW_REGIME_FIT;
    if (!regimeFitLow) continue;

    // Find the coin with the largest reduction
    const prevPos = posMap(prev);
    const currPos = posMap(curr);
    let biggestCoin = "";
    let biggestDelta = 0;

    for (const [coin, pPos] of prevPos) {
      const cPos = currPos.get(coin);
      const before = parseFloat(pPos.positionValue);
      const after  = cPos ? parseFloat(cPos.positionValue) : 0;
      const delta  = before - after;
      if (delta > biggestDelta) {
        biggestDelta = delta;
        biggestCoin  = coin;
      }
    }

    events.push({
      wallet_id:   walletId,
      recipe_id:   "anti_whale_trap",
      coin:        biggestCoin || "PORTFOLIO",
      signal_type: "EXIT",
      direction:   regime === "BEAR" ? "SHORT" : "FLAT",
      ev_score:    null,
      metadata: {
        notional_reduction_pct: reduction,
        regime_fit:             curr.regime_fit,
        current_regime:         regime,
        description: `High-score wallet rapidly reducing exposure (−${(reduction * 100).toFixed(1)}%) in ${regime} regime. Possible trap exit.`,
      },
    });
  }
  return events;
}

// ─────────────────────────────────────────────────────────────────────────────
// Recipe 10 — Position Aging
// ─────────────────────────────────────────────────────────────────────────────
// High-score wallet holding a losing position for 2+ consecutive cycles
// without reducing size — patience trap alert.

async function recipe10(pairs: SnapshotPair[]): Promise<SignalEvent[]> {
  const HIGH_SCORE = 0.65;
  const LOSS_RATIO_THRESHOLD = -0.05;
  const events: SignalEvent[] = [];

  const underwaterCounts = (await kv.get<Record<string, number>>("cohort:underwater_counts")) ?? {};

  for (const { walletId, overallScore, curr, prev } of pairs) {
    if (overallScore < HIGH_SCORE) continue;
    if (!prev) continue;

    const currPos = posMap(curr);
    const prevPos = posMap(prev);

    for (const [coin, pos] of currPos) {
      const key = `${walletId}:${coin}`;
      const posValue = Math.abs(parseFloat(pos.positionValue));
      const ratio = parseFloat(pos.unrealizedPnl) / (posValue + 1e-8);

      const prevPosEntry = prevPos.get(coin);
      const currSzi = Math.abs(parseFloat(pos.szi));
      const prevSzi = prevPosEntry ? Math.abs(parseFloat(prevPosEntry.szi)) : 0;

      const isUnderwater = ratio <= LOSS_RATIO_THRESHOLD;
      const notReducing = currSzi >= prevSzi * 0.95;

      if (isUnderwater && notReducing) {
        underwaterCounts[key] = (underwaterCounts[key] ?? 0) + 1;
        const count = underwaterCounts[key];
        if (count >= 2) {
          const dir = sign(pos.szi);
          events.push({
            wallet_id:   walletId,
            recipe_id:   "position_aging",
            coin,
            signal_type: "ALERT",
            direction:   dir === "FLAT" ? null : dir,
            ev_score:    null,
            metadata: {
              unrealized_pnl_ratio: ratio,
              consecutive_cycles:   count,
              wallet_score:         overallScore,
              description: `Wallet holding losing ${coin} position for ${count}+ cycles (unreal PnL ${(ratio * 100).toFixed(1)}%)`,
            },
          });
        }
      } else {
        underwaterCounts[key] = 0;
      }
    }

    // Reset counts for coins no longer held
    for (const key of Object.keys(underwaterCounts)) {
      if (key.startsWith(`${walletId}:`) && !currPos.has(key.slice(walletId.length + 1))) {
        underwaterCounts[key] = 0;
      }
    }
  }

  kv.set("cohort:underwater_counts", underwaterCounts, { ex: 25 * 3600 }).catch(() => {});

  return events;
}

// ─────────────────────────────────────────────────────────────────────────────
// Recipe 11 — Cross-wallet Concentration Risk
// ─────────────────────────────────────────────────────────────────────────────
// More than 60% of cohort total notional concentrated in a single coin.

function recipe11(pairs: SnapshotPair[]): SignalEvent[] {
  const CONCENTRATION_THRESHOLD = 0.60;
  // BTC is always the dominant cohort holding; concentration there is not a signal.
  // ETH gets a higher bar since moderate ETH dominance is common but not universal.
  const EXCLUDED_COINS  = new Set(["BTC"]);
  const ETH_THRESHOLD   = 0.70;

  // Coin -> total notional + per-wallet breakdown
  const coinNotional = new Map<string, number>();
  const walletCoinNotional = new Map<string, Map<string, number>>();
  let totalCohortNotional = 0;

  for (const { walletId, curr } of pairs) {
    const wMap = walletCoinNotional.get(walletId) ?? new Map<string, number>();
    for (const ap of curr.positions) {
      const coin = ap.position.coin;
      const val  = Math.abs(parseFloat(ap.position.positionValue));
      coinNotional.set(coin, (coinNotional.get(coin) ?? 0) + val);
      wMap.set(coin, (wMap.get(coin) ?? 0) + val);
      totalCohortNotional += val;
    }
    walletCoinNotional.set(walletId, wMap);
  }

  if (totalCohortNotional === 0) return [];

  const events: SignalEvent[] = [];
  for (const [coin, notional] of coinNotional) {
    if (EXCLUDED_COINS.has(coin)) continue;
    const ratio     = notional / totalCohortNotional;
    const threshold = coin === "ETH" ? ETH_THRESHOLD : CONCENTRATION_THRESHOLD;
    if (ratio <= threshold) continue;

    // Top 3 wallets by exposure to this coin
    const walletExposures: { wallet_id: string; notional: number }[] = [];
    for (const [walletId, wMap] of walletCoinNotional) {
      const wNotional = wMap.get(coin) ?? 0;
      if (wNotional > 0) walletExposures.push({ wallet_id: walletId, notional: wNotional });
    }
    walletExposures.sort((a, b) => b.notional - a.notional);
    const topWallets = walletExposures.slice(0, 3);

    events.push({
      wallet_id:   "",
      recipe_id:   "concentration_risk",
      coin,
      signal_type: "ALERT",
      direction:   null,
      ev_score:    null,
      metadata: {
        concentration_pct:      ratio,
        total_cohort_notional:  totalCohortNotional,
        top_wallets:            topWallets,
        description: `${(ratio * 100).toFixed(1)}% of cohort notional in ${coin} -- concentration risk`,
      },
    });
  }
  return events;
}

// ─────────────────────────────────────────────────────────────────────────────
// Recipe 12 — Wallet Churn (Coordinated Exit)
// ─────────────────────────────────────────────────────────────────────────────
// 3+ wallets simultaneously reducing/closing positions on the same coin,
// combined notional reduction >= $500K within the snapshot window.

function recipe12(pairs: SnapshotPair[]): SignalEvent[] {
  const WALLET_THRESHOLD  = 3;
  const COMBINED_NOTIONAL = 500_000;
  const WINDOW_MS         = 5 * 60 * 1000;

  // Coin → { walletIds, totalReduction, direction }
  const buckets = new Map<string, { ids: string[]; delta: number; direction: "LONG" | "SHORT" | null }>();

  for (const { walletId, curr, prev } of pairs) {
    if (!prev) continue;
    const timeDiff = new Date(curr.snapshot_time).getTime() - new Date(prev.snapshot_time).getTime();
    if (timeDiff > WINDOW_MS) continue;

    const currPos = posMap(curr);
    const prevPos = posMap(prev);
    const allCoins = new Set([...currPos.keys(), ...prevPos.keys()]);

    for (const coin of allCoins) {
      const cPos = currPos.get(coin);
      const pPos = prevPos.get(coin);
      const currVal = cPos ? Math.abs(parseFloat(cPos.positionValue)) : 0;
      const prevVal = pPos ? Math.abs(parseFloat(pPos.positionValue)) : 0;
      const delta = currVal - prevVal;
      if (delta >= 0) continue; // only count reductions

      const dir = pPos ? sign(pPos.szi) : null;
      if (!dir || dir === "FLAT") continue;

      if (!buckets.has(coin)) buckets.set(coin, { ids: [], delta: 0, direction: dir });
      const bucket = buckets.get(coin)!;
      bucket.ids.push(walletId);
      bucket.delta += delta; // accumulates as negative
    }
  }

  const events: SignalEvent[] = [];
  for (const [coin, { ids, delta, direction }] of buckets) {
    if (ids.length >= WALLET_THRESHOLD && Math.abs(delta) >= COMBINED_NOTIONAL) {
      events.push({
        wallet_id:   ids[0],
        recipe_id:   "wallet_churn",
        coin,
        signal_type: "EXIT",
        direction,
        ev_score:    null,
        metadata: {
          wallet_count:       ids.length,
          wallet_ids:         ids,
          combined_reduction: Math.abs(delta),
          description: `${ids.length} wallets reducing ${coin} ${direction} combined $${(Math.abs(delta) / 1e3).toFixed(0)}K`,
        },
      });
    }
  }
  return events;
}

// ─────────────────────────────────────────────────────────────────────────────
// Recipe 13 — Funding Rate Trend
// ─────────────────────────────────────────────────────────────────────────────
// Funding rate for a coin rising for 3+ consecutive cycles and above 0.03%/hr.

async function recipe13(
  assetCtxMap: Map<string, HlAssetCtx>
): Promise<SignalEvent[]> {
  const FUNDING_THRESHOLD = 0.0003; // 0.03%/hr

  const coins = [...assetCtxMap.keys()];

  const results = await Promise.all(
    coins.map(async (coin) => {
      const ctx = assetCtxMap.get(coin)!;
      const funding = parseFloat(ctx.funding);
      const kvKey = `market:funding_history:${coin}`;

      const history = (await kv.get<number[]>(kvKey)) ?? [];
      history.push(funding);
      if (history.length > 4) history.shift();
      kv.set(kvKey, history, { ex: 25 * 3600 }).catch(() => {});

      // Need 3+ readings, current above threshold, all last 3 increasing
      if (history.length < 3) return null;
      if (funding <= FUNDING_THRESHOLD) return null;
      const last3 = history.slice(-3);
      const allIncreasing = last3[1] > last3[0] && last3[2] > last3[1];
      if (!allIncreasing) return null;

      const event: SignalEvent = {
        wallet_id:   "",
        recipe_id:   "funding_trend",
        coin,
        signal_type: "ALERT",
        direction:   "SHORT", // rising funding = overextended longs = fade
        ev_score:    null,
        metadata: {
          current_funding:  funding,
          funding_history:  history,
          description: `${coin} funding rising for 3+ cycles, now ${(funding * 100).toFixed(4)}%. Possible overextended longs.`,
        },
      };
      return event;
    })
  );

  return results.filter((r): r is SignalEvent => r !== null);
}

// ─────────────────────────────────────────────────────────────────────────────
// EV enrichment — attach EV scores where backtest data is available
// ─────────────────────────────────────────────────────────────────────────────

function enrichWithEv(
  events: SignalEvent[],
  backtestMap: Map<string, { win_rate: number; avg_win_usd: number; avg_loss_usd: number }>,
  l2Books: Map<string, HlL2Book>
): SignalEvent[] {
  return events.map((event) => {
    const bt = event.wallet_id ? backtestMap.get(event.wallet_id) : null;
    if (!bt || bt.win_rate === 0) return event;

    const book = l2Books.get(event.coin) ?? null;
    const notional = 10_000; // default reference notional for EV calc
    const cost = estimateTradeCost(notional, book, event.direction === "LONG" ? "buy" : "sell");
    const ev = computeEv({
      win_probability: bt.win_rate,
      avg_win_usd:     bt.avg_win_usd,
      avg_loss_usd:    bt.avg_loss_usd,
      trade_cost_usd:  cost.total,
    });

    return { ...event, ev_score: ev.is_reliable ? ev.ev_score : null };
  });
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
  /** allMids from the previous cron cycle, stored in KV. Used by R5 price confirmation. */
  priorAllMids:        Record<string, string> | null;
  backtestMap:         Map<string, { win_rate: number; avg_win_usd: number; avg_loss_usd: number; win_streak: number; sharpe_ratio: number }>;
  l2Books:             Map<string, HlL2Book>;
  recipeWinRates:      Map<string, number>;
  recipeSignalCounts:  Map<string, number>;
  regime:              "BULL" | "BEAR" | "RANGING";
}

/**
 * Run all 9 signal recipes, enrich with EV scores, persist to Supabase.
 *
 * @param inputs  All market data and cohort state required by recipes
 * @returns Array of all fired signal events
 */
export async function runSignalLab(inputs: SignalLabInputs): Promise<SignalEvent[]> {
  const {
    pairs, candles5m, candles4h, assetCtxMap, allMids, priorAllMids,
    backtestMap, l2Books, recipeWinRates, recipeSignalCounts, regime,
  } = inputs;

  // Run recipes 1-7, 10-13 in parallel (all async now); R8 depends on their output
  const [r1, r2, r3, r4, r5, r6, r7, r10, r11, r12, r13] = await Promise.all([
    recipe1(pairs),
    recipe2(pairs, candles5m),
    recipe3(pairs, candles4h),
    recipe4(pairs, assetCtxMap, recipeWinRates, recipeSignalCounts),
    recipe5(pairs, allMids, priorAllMids),
    recipe6(pairs, backtestMap),
    recipe7(pairs, assetCtxMap),
    recipe10(pairs),
    recipe11(pairs),
    recipe12(pairs),
    recipe13(assetCtxMap),
  ]);
  // Recipe 8 validates signals from other recipes; Recipe 9 is independent
  const preValidation = [...r1, ...r2, ...r3, ...r4, ...r5, ...r6, ...r7, ...r10, ...r11, ...r12, ...r13];
  const [r8, r9] = await Promise.all([
    recipe8(pairs, preValidation),
    recipe9(pairs, regime),
  ]);

  // Exclude original signals that were re-emitted as whale_validated to avoid duplicate
  // feed entries. The whale_validated event preserves original_recipe in its metadata.
  const validatedKeys = new Set(
    r8.map((s) => `${s.wallet_id}:${s.coin}:${s.direction ?? ""}`)
  );
  const dedupedPre = preValidation.filter(
    (s) => !validatedKeys.has(`${s.wallet_id}:${s.coin}:${s.direction ?? ""}`)
  );
  const allEvents = [...dedupedPre, ...r8, ...r9];

  // Enrich with EV scores
  const enriched = enrichWithEv(allEvents, backtestMap, l2Books);

  // Compute intraday recipe performance from recent signals_history (last 6h)
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

  const rows = [...toInsert, ...cohortEvents];
  if (rows.length > 0) {
    const { data: inserted, error } = await supabase
      .from("signals_history")
      .insert(rows)
      .select("id, recipe_id, coin, direction");
    if (error) {
      console.error("[signal-lab] insert error:", error.message);
    } else {
      console.log(`[signal-lab] inserted ${inserted?.length ?? 0} signal events`);
      // Capture price at signal fire time for outcome tracking
      if (inserted && inserted.length > 0) {
        const outcomeRows = buildOutcomeRows(inserted, allMids);
        // Diagnostic: surface why outcome rows may be empty
        if (outcomeRows.length === 0) {
          const missingCoins = [...new Set(inserted.map((s) => s.coin))].filter((c) => !allMids[c]);
          console.warn(
            `[signal-lab] 0 outcome rows built from ${inserted.length} signals. allMids keys: ${Object.keys(allMids).length}, coins missing from allMids:`,
            missingCoins,
          );
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
      }
    }
  }

  return enriched;
}
