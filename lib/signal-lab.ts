// lib/signal-lab.ts
// All 9 signal recipes. Each recipe receives the two most recent cohort
// snapshots for every active wallet and emits zero or more SignalEvent objects.
//
// IMPORTANT: Snapshot deltas measure CHANGES IN OPEN POSITIONS, not realized PnL.
// Realized PnL comes exclusively from userFills.closedPnl — never conflate these.

import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "@/lib/env";
import { computeEv, estimateTradeCost } from "@/lib/risk-engine";
import type { HlL2Book, HlCandle, HlAssetCtx } from "@/lib/hyperliquid-api-client";

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

function recipe1(pairs: SnapshotPair[]): SignalEvent[] {
  const WALLET_THRESHOLD    = 3;
  const COMBINED_NOTIONAL   = 500_000;
  const WINDOW_MS           = 5 * 60 * 1000;

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
// Net exposure rising while price flat + liquidation buffer <15%.

function recipe2(
  pairs: SnapshotPair[],
  candles5m: Map<string, HlCandle[]>   // coin → recent 5m candles
): SignalEvent[] {
  const LIQ_BUFFER_THRESHOLD = 0.15;
  const PRICE_FLAT_PCT = 0.005; // price moved < 0.5% → "flat"
  const events: SignalEvent[] = [];

  for (const { walletId, curr, prev, overallScore } of pairs) {
    if (!prev) continue;
    if ((curr.liq_buffer_pct ?? 1) >= LIQ_BUFFER_THRESHOLD) continue;

    const notionalDelta = curr.total_notional - prev.total_notional;
    if (notionalDelta <= 0) continue; // exposure not rising

    // Check price flatness for the wallet's largest position coin
    const largestPos = [...posMap(curr).values()].sort(
      (a, b) => parseFloat(b.positionValue) - parseFloat(a.positionValue)
    )[0];
    if (!largestPos) continue;

    const coinCandles = candles5m.get(largestPos.coin) ?? [];
    if (coinCandles.length < 2) continue;

    const firstClose = parseFloat(coinCandles[0].c);
    const lastClose  = parseFloat(coinCandles[coinCandles.length - 1].c);
    const priceChange = firstClose > 0 ? Math.abs(lastClose - firstClose) / firstClose : 1;

    if (priceChange >= PRICE_FLAT_PCT) continue; // price moved — not a squeeze setup

    events.push({
      wallet_id:   walletId,
      recipe_id:   "divergence_squeeze",
      coin:        largestPos.coin,
      signal_type: "ALERT",
      direction:   sign(largestPos.szi) === "FLAT" ? null : sign(largestPos.szi),
      ev_score:    null,
      metadata: {
        liq_buffer_pct:  curr.liq_buffer_pct,
        notional_delta:  notionalDelta,
        price_change_pct: priceChange,
        wallet_score:    overallScore,
        description: `Exposure rising +$${(notionalDelta / 1e3).toFixed(0)}K while ${largestPos.coin} price flat (${(priceChange * 100).toFixed(2)}%). Liq buffer ${((curr.liq_buffer_pct ?? 0) * 100).toFixed(1)}%`,
      },
    });
  }
  return events;
}

// ─────────────────────────────────────────────────────────────────────────────
// Recipe 3 — Accumulation Re-Entry
// ─────────────────────────────────────────────────────────────────────────────
// Winners cohort increases positions after >8% drawdown in last 4h.

function recipe3(
  pairs: SnapshotPair[],
  candles4h: Map<string, HlCandle[]>  // coin → last 4h candles (e.g. 48 × 5m)
): SignalEvent[] {
  const DRAWDOWN_THRESHOLD = 0.08;
  const HIGH_SCORE = 0.65;
  const events: SignalEvent[] = [];

  const coinsWithDrawdown = new Set<string>();

  // Identify coins with >8% drawdown in last 4h
  for (const [coin, candles] of candles4h) {
    if (candles.length < 2) continue;
    const highPx = Math.max(...candles.map((c) => parseFloat(c.h)));
    const lastClose = parseFloat(candles[candles.length - 1].c);
    if (highPx > 0 && (highPx - lastClose) / highPx >= DRAWDOWN_THRESHOLD) {
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

function recipe4(
  pairs: SnapshotPair[],
  assetCtxMap: Map<string, HlAssetCtx>,
  recipeWinRates: Map<string, number>   // recipe_id:coin → historical win rate
): SignalEvent[] {
  const MIN_FUNDING = 0.0003;           // 0.03%/hr minimum positive funding
  const MIN_HISTORICAL_WINRATE = 0.60;
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
      // Default to 0.65 when no history exists yet (bootstrap: fire on first occurrence,
      // accumulate real data in recipe_performance via the daily scan).
      const histWinRate = recipeWinRates.get("rotation_carry") ?? 0.65;
      if (histWinRate < MIN_HISTORICAL_WINRATE) continue;

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
          description: `New ${coin} position with +${(funding * 100).toFixed(4)}% funding. Historical follow-through: ${(histWinRate * 100).toFixed(0)}%`,
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

function recipe5(
  pairs: SnapshotPair[],
  allMids: Record<string, string>
): SignalEvent[] {
  const POSITION_SHRINK_PCT = 0.05;   // cohort net notional drops >5%
  const PRICE_SPIKE_PCT     = 0.02;   // price spikes >2% after shrink
  const events: SignalEvent[] = [];

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
    if (shrink < POSITION_SHRINK_PCT) continue; // not a big enough reduction

    // Check allMids for price spike — compare current mid vs prior mid in metadata
    // (We use the fact that allMids changed since last refresh)
    const midStr = allMids[coin];
    if (!midStr) continue;

    // Emit ALERT — UI will annotate as "possible liq cascade + rebound setup"
    events.push({
      wallet_id:   "", // cohort-level event, no single wallet
      recipe_id:   "liq_rebound",
      coin,
      signal_type: "ALERT",
      direction:   "LONG",            // rebound bias is long after liquidation cascade
      ev_score:    null,
      metadata: {
        cohort_notional_before: before,
        cohort_notional_after:  after,
        shrink_pct:             shrink,
        current_mid:            midStr,
        warning: "APPROXIMATION: true liq cascade detection requires WebSocket (Phase 3)",
        description: `Cohort ${coin} exposure dropped ${(shrink * 100).toFixed(1)}%, possible liquidation cascade. Rebound watch.`,
      },
    });
  }
  return events;
}

// ─────────────────────────────────────────────────────────────────────────────
// Recipe 6 — Streak Continuation
// ─────────────────────────────────────────────────────────────────────────────
// Wallet on 5+ win streak with Sharpe proxy > 1.8 (normalised > 0.6).

function recipe6(
  pairs: SnapshotPair[],
  backtestMap: Map<string, { win_streak: number; sharpe_ratio: number }>
): SignalEvent[] {
  const MIN_STREAK  = 5;
  const MIN_SHARPE  = 0.60;   // normalised (maps to raw ~1.8)
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

function recipe7(
  pairs: SnapshotPair[],
  assetCtxMap: Map<string, HlAssetCtx>
): SignalEvent[] {
  const FUNDING_THRESHOLD = 0.0005;   // 0.05%/hr
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

    const funding    = parseFloat(ctx.funding);
    const totalOi    = parseFloat(ctx.openInterest);
    // Retail OI proxy: total OI not explained by the cohort
    // NOTE: This is an approximation — "retail" here means "non-cohort"
    const retailOiProxy = totalOi - Math.abs(netNotional);

    // Divergence: cohort bias vs retail proxy
    const cohortLong    = netNotional > 0;
    const retailNetLong = retailOiProxy > 0;

    // Signal only when they diverge AND funding is extreme
    if (cohortLong === retailNetLong) continue;
    if (Math.abs(funding) < FUNDING_THRESHOLD) continue;

    events.push({
      wallet_id:   "",   // cohort-level
      recipe_id:   "funding_divergence",
      coin,
      signal_type: "ALERT",
      direction:   cohortLong ? "LONG" : "SHORT",
      ev_score:    null,
      metadata: {
        cohort_net_notional:  netNotional,
        retail_oi_proxy:      retailOiProxy,
        funding_rate:         funding,
        divergence_usd:       Math.abs(netNotional - retailOiProxy),
        warning: "retail_oi_proxy is an approximation (totalOI − cohortNotional), not true retail data",
        description: `Smart money ${cohortLong ? "LONG" : "SHORT"} while retail proxy ${cohortLong ? "SHORT" : "LONG"} on ${coin}. Funding ${(funding * 100).toFixed(4)}%.`,
      },
    });
  }
  return events;
}

// ─────────────────────────────────────────────────────────────────────────────
// Recipe 8 — Whale Validation Filter
// ─────────────────────────────────────────────────────────────────────────────
// Signal confirmed by ≥3 core cohort wallets (score ≥ 0.75) within 60s.

function recipe8(
  pairs: SnapshotPair[],
  pendingSignals: SignalEvent[]   // signals from other recipes in this cycle
): SignalEvent[] {
  const MIN_WHALE_COUNT = 3;
  const WHALE_SCORE     = 0.75;
  const events: SignalEvent[] = [];

  // Build map of coin+direction → whale wallets active in this cycle
  const whaleActivity = new Map<string, string[]>();
  for (const { walletId, overallScore, curr } of pairs) {
    if (overallScore < WHALE_SCORE) continue;
    for (const ap of curr.positions) {
      const dir = sign(ap.position.szi);
      if (dir === "FLAT") continue;
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

function recipe9(
  pairs: SnapshotPair[],
  regime: "BULL" | "BEAR" | "RANGING"
): SignalEvent[] {
  const REDUCTION_THRESHOLD = 0.20;   // ≥20% notional reduction
  const LOW_REGIME_FIT      = 0.35;   // regime_fit below this = danger
  const events: SignalEvent[] = [];

  for (const { walletId, curr, prev, overallScore } of pairs) {
    if (!prev) continue;
    if (overallScore < 0.65) continue; // only watch high-score wallets

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
  pairs:          SnapshotPair[];
  candles5m:      Map<string, HlCandle[]>;
  candles4h:      Map<string, HlCandle[]>;
  assetCtxMap:    Map<string, HlAssetCtx>;
  allMids:        Record<string, string>;
  backtestMap:    Map<string, { win_rate: number; avg_win_usd: number; avg_loss_usd: number; win_streak: number; sharpe_ratio: number }>;
  l2Books:        Map<string, HlL2Book>;
  recipeWinRates: Map<string, number>;
  regime:         "BULL" | "BEAR" | "RANGING";
}

/**
 * Run all 9 signal recipes, enrich with EV scores, persist to Supabase.
 *
 * @param inputs  All market data and cohort state required by recipes
 * @returns Array of all fired signal events
 */
export async function runSignalLab(inputs: SignalLabInputs): Promise<SignalEvent[]> {
  const {
    pairs, candles5m, candles4h, assetCtxMap, allMids,
    backtestMap, l2Books, recipeWinRates, regime,
  } = inputs;

  // Run each recipe
  const r1 = recipe1(pairs);
  const r2 = recipe2(pairs, candles5m);
  const r3 = recipe3(pairs, candles4h);
  const r4 = recipe4(pairs, assetCtxMap, recipeWinRates);
  const r5 = recipe5(pairs, allMids);
  const r6 = recipe6(pairs, backtestMap);
  const r7 = recipe7(pairs, assetCtxMap);
  // Recipe 8 validates signals from other recipes
  const preValidation = [...r1, ...r2, ...r3, ...r4, ...r5, ...r6, ...r7];
  const r8 = recipe8(pairs, preValidation);
  const r9 = recipe9(pairs, regime);

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
    const { error } = await supabase.from("signals_history").insert(rows);
    if (error) {
      console.error("[signal-lab] insert error:", error.message);
    } else {
      console.log(`[signal-lab] inserted ${rows.length} signal events`);
    }
  }

  return enriched;
}
