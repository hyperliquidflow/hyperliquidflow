// lib/signal-learning-utils.ts
// Pure stateless functions for the signal learning stats engine.
// No I/O -- all inputs are plain data. Tested directly by Vitest.

import { getCoinTier, type CoinTier } from "./token-tiers";

export interface OutcomeRow {
  is_win:   boolean | null;
  fired_at: string;
}

export interface WinRates {
  win_rate_7d:  number | null;
  win_rate_30d: number | null;
  win_rate_90d: number | null;
}

export function computeWinRates(outcomes: OutcomeRow[]): WinRates {
  const now = Date.now();
  const resolved = outcomes.filter((o) => o.is_win !== null);

  function winRate(days: number): number | null {
    const cutoff = now - days * 86400_000;
    const window = resolved.filter((o) => new Date(o.fired_at).getTime() >= cutoff);
    if (window.length === 0) return null;
    return window.filter((o) => o.is_win).length / window.length;
  }

  return {
    win_rate_7d:  winRate(7),
    win_rate_30d: winRate(30),
    win_rate_90d: winRate(90),
  };
}

export function computeTrend(
  winRate7d:  number | null,
  winRate90d: number | null
): "IMPROVING" | "DEGRADING" | "STABLE" | "INSUFFICIENT_DATA" {
  if (winRate7d === null || winRate90d === null) return "INSUFFICIENT_DATA";
  const delta = winRate7d - winRate90d;
  if (delta > 0.10) return "IMPROVING";
  if (delta < -0.10) return "DEGRADING";
  return "STABLE";
}

/**
 * Expected value from win rate and average win/loss.
 *
 * Sign convention: `avgWin` and `avgLoss` are both SIGNED returns.
 * `avgLoss` is typically negative (e.g. -0.02 for a 2% average losing return),
 * so the formula adds it directly rather than subtracting. Passing a positive
 * magnitude for `avgLoss` would flip the EV sign and produce wrong results.
 * See `supabase/migrations/017_ev_decouple.sql` for the signed storage schema.
 */
export function computeMeasuredEV(
  winRate:  number | null,
  avgWin:   number | null,
  avgLoss:  number | null
): number | null {
  if (winRate === null || avgWin === null || avgLoss === null) return null;
  return winRate * avgWin + (1 - winRate) * avgLoss;
}

export function meetsMinSample(sampleSize: number): boolean {
  return sampleSize >= 30;
}

/**
 * Win rate at which a stop/target system breaks even before costs.
 * Risking `stopAtr` to make `targetAtr` needs stop/(stop+target) to break even,
 * so a 2-ATR stop against a 3-ATR target breaks even at 40%, not 50%.
 */
export function breakevenWinRate(stopAtr: number, targetAtr: number): number {
  return stopAtr / (stopAtr + targetAtr);
}

export function computeConfidence(
  sampleSize: number,
  winRate:    number,
  breakeven:  number = 0.5,
): number {
  if (sampleSize === 0) return 0;
  const z = 1.645; // 90% confidence z-score
  const p = winRate;
  const n = sampleSize;
  const centre = (p + (z * z) / (2 * n)) / (1 + (z * z) / n);
  const margin  = (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n)) / (1 + (z * z) / n);
  const lowerBound = centre - margin;
  return Math.min(1, Math.max(0, Math.abs(lowerBound - breakeven) * 2));
}

/**
 * Confidence that the true win rate is ABOVE breakeven, which is the question
 * a prove-or-kill review actually asks. `computeConfidence` measures distance
 * from an anchor in either direction, so a recipe that is confidently BAD and
 * one that is confidently GOOD score the same there. This returns 0 unless the
 * Wilson lower bound clears breakeven outright.
 */
export function confidenceAboveBreakeven(
  sampleSize: number,
  winRate:    number,
  breakeven:  number,
): number {
  if (sampleSize === 0) return 0;
  const z = 1.645;
  const p = winRate;
  const n = sampleSize;
  const centre = (p + (z * z) / (2 * n)) / (1 + (z * z) / n);
  const margin = (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n)) / (1 + (z * z) / n);
  const lowerBound = centre - margin;
  if (lowerBound <= breakeven) return 0;
  return Math.min(1, (lowerBound - breakeven) / (1 - breakeven));
}

export function computeWinRateByRegime(
  outcomes: (OutcomeRow & { regime_at_fire: string })[]
): Record<string, number | null> {
  const regimes = ["BULL", "BEAR", "RANGING"];
  const now = Date.now();
  const cutoff = now - 30 * 86400_000;
  const recent = outcomes.filter((o) => new Date(o.fired_at).getTime() >= cutoff);

  const result: Record<string, number | null> = {};
  for (const regime of regimes) {
    const inRegime = recent.filter((o) => o.regime_at_fire === regime && o.is_win !== null);
    result[regime] = inRegime.length > 0
      ? inRegime.filter((o) => o.is_win).length / inRegime.length
      : null;
  }
  return result;
}

export interface RegimeFitBuckets {
  high: { win_rate: number | null; sample: number };
  mid:  { win_rate: number | null; sample: number };
  low:  { win_rate: number | null; sample: number };
}

/**
 * Stratify resolved outcomes by wallet_regime_fit stored in signal metadata.
 * Thresholds: LOW < 0.33, MID 0.33-0.67, HIGH >= 0.67.
 * win_rate is null for buckets with zero resolved outcomes.
 */
export function computeWinRateByRegimeFit(
  outcomes: Array<{ is_win: boolean | null; regime_fit: number | null }>,
): RegimeFitBuckets {
  const resolved = outcomes.filter((o) => o.is_win !== null);

  function bucket(lo: number, hi: number) {
    const rows = resolved.filter((o) => {
      if (o.regime_fit === null) return false;
      return o.regime_fit >= lo && o.regime_fit < hi;
    });
    return {
      win_rate: rows.length > 0 ? rows.filter((o) => o.is_win).length / rows.length : null,
      sample:   rows.length,
    };
  }

  return {
    high: bucket(0.67, Infinity),
    mid:  bucket(0.33, 0.67),
    low:  bucket(0,    0.33),
  };
}

export function dominantRegime(
  outcomes: (OutcomeRow & { regime_at_fire: string })[]
): string | null {
  const now = Date.now();
  const cutoff = now - 30 * 86400_000;
  const recent = outcomes.filter((o) => new Date(o.fired_at).getTime() >= cutoff);
  if (recent.length === 0) return null;

  const counts: Record<string, number> = {};
  for (const o of recent) counts[o.regime_at_fire] = (counts[o.regime_at_fire] ?? 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

// ─── ATR-based exit simulation ─────────────────────────────────────────────────

// Round-trip taker cost: 5 bps entry + 5 bps exit (Hyperliquid market taker).
export const ROUND_TRIP_FEE_BPS = 10;

// Stop and target distances, in ATR multiples. These set the breakeven win rate.
//
// Chosen from a path simulation over 2,808 random entries on conviction-gate
// coins at a 24h hold (scripts/exit-structure-analysis.ts, 2026-08-11). The
// original 2/3 structure timed out 74% of trades and reached its target 6.9%
// of the time, so its assumed 3:2 payoff never actually paid. 1/1 resolves 84%
// of trades at the levels and has the lowest outcome variance on the grid
// (sd 195 bps vs 285), which roughly halves the samples needed to detect a
// given edge. Symmetric payoff puts breakeven at a clean 50% before costs.
export const EXIT_STOP_ATR   = 1;
export const EXIT_TARGET_ATR = 1;

/**
 * Round-trip slippage assumption in bps, by coin liquidity tier. Order book
 * depth is not retained historically, so these are standing assumptions rather
 * than measurements. They matter most on SMALL names, which is where the cohort
 * trades most and where a zero-slippage grade flatters the result hardest.
 */
export const SLIPPAGE_BPS_BY_TIER: Record<CoinTier, number> = {
  MAJOR: 2,
  LARGE: 6,
  SMALL: 20,
};

export function slippageBpsForCoin(coin: string): number {
  return SLIPPAGE_BPS_BY_TIER[getCoinTier(coin)];
}

export interface ExitBar {
  t: number;  // bar open time, ms
  h: string;
  l: string;
  c: string;
}

export interface CandleExitResult {
  entry_price:         number;
  exit_price:          number;
  exit_reason:         "stop" | "target" | "time";
  hold_hours:          number;
  gross_pnl_bps:       number;
  cost_bps:            number;
  net_pnl_bps:         number;
  realized_r_multiple: number;
  is_win:              boolean;
}

export interface CandleExitParams {
  direction:          "LONG" | "SHORT";
  entryPrice:         number;
  atr:                number;
  entryMs:            number;
  bars:               ExitBar[];
  maxHoldHours?:      number;
  feeBps?:            number;
  slippageBps?:       number;
  /** Signed hourly funding in bps. Positive means longs pay shorts. */
  fundingBpsPerHour?: number;
  /** Stop distance in ATR multiples. Defaults to the shipped EXIT_STOP_ATR. */
  stopAtr?:           number;
  /** Target distance in ATR multiples. Defaults to the shipped EXIT_TARGET_ATR. */
  targetAtr?:         number;
}

const HOUR_MS = 3600_000;

/**
 * Walk hourly bars from the signal timestamp and exit on the first bar whose
 * range touches the stop or the target. Bar ranges are used rather than closes
 * because a close-only check cannot see an adverse excursion inside the bar,
 * which silently converts stopped-out trades into winners.
 *
 * Stop = entry - 2*ATR (LONG) or entry + 2*ATR (SHORT).
 * Target = entry + 3*ATR (LONG) or entry - 3*ATR (SHORT).
 * A bar that spans both levels resolves as a stop: OHLC does not record which
 * came first, so the simulation takes the adverse fill.
 */
export function simulateExitFromCandles(params: CandleExitParams): CandleExitResult | null {
  const {
    direction, entryPrice, atr, entryMs, bars,
    maxHoldHours      = 24,
    feeBps            = ROUND_TRIP_FEE_BPS,
    slippageBps       = 0,
    fundingBpsPerHour = 0,
    stopAtr           = EXIT_STOP_ATR,
    targetAtr         = EXIT_TARGET_ATR,
  } = params;

  if (entryPrice <= 0 || atr <= 0) return null;

  const sign     = direction === "LONG" ? 1 : -1;
  const stopPx   = entryPrice - sign * stopAtr   * atr;
  const targetPx = entryPrice + sign * targetAtr * atr;
  const windowEnd = entryMs + maxHoldHours * HOUR_MS;

  const window = bars.filter((b) => b.t >= entryMs && b.t < windowEnd);
  if (window.length === 0) return null;

  // Bars held, not elapsed clock time: signals fire mid-bar, so a wall-clock
  // measurement produces fractions and misstates the number of funding periods.
  const holdHoursAt = (barIndex: number) => barIndex + 1;

  let exitPx:     number | null = null;
  let exitReason: CandleExitResult["exit_reason"] | null = null;
  let holdHours   = 0;

  for (const [i, b] of window.entries()) {
    const high = parseFloat(b.h);
    const low  = parseFloat(b.l);
    if (!isFinite(high) || !isFinite(low)) continue;

    const hitStop   = direction === "LONG" ? low  <= stopPx   : high >= stopPx;
    const hitTarget = direction === "LONG" ? high >= targetPx : low  <= targetPx;

    if (hitStop) {
      exitPx     = stopPx;
      exitReason = "stop";
      holdHours  = holdHoursAt(i);
      break;
    }
    if (hitTarget) {
      exitPx     = targetPx;
      exitReason = "target";
      holdHours  = holdHoursAt(i);
      break;
    }
  }

  if (exitPx === null || exitReason === null) {
    const last  = window[window.length - 1];
    const close = parseFloat(last.c);
    if (!isFinite(close) || close <= 0) return null;
    exitPx     = close;
    exitReason = "time";
    holdHours  = holdHoursAt(window.length - 1);
  }

  const grossPnlBps = sign * ((exitPx - entryPrice) / entryPrice) * 10_000;
  // Longs pay funding when the rate is positive; shorts receive it.
  const fundingBps  = sign * fundingBpsPerHour * holdHours;
  const costBps     = feeBps + slippageBps + fundingBps;
  const netPnlBps   = grossPnlBps - costBps;
  const oneRBps     = (stopAtr * atr) / entryPrice * 10_000;

  return {
    entry_price:         entryPrice,
    exit_price:          parseFloat(exitPx.toFixed(10)),
    exit_reason:         exitReason,
    hold_hours:          holdHours,
    gross_pnl_bps:       parseFloat(grossPnlBps.toFixed(2)),
    cost_bps:            parseFloat(costBps.toFixed(2)),
    net_pnl_bps:         parseFloat(netPnlBps.toFixed(2)),
    realized_r_multiple: parseFloat((netPnlBps / oneRBps).toFixed(4)),
    is_win:              netPnlBps > 0,
  };
}

export interface RecipeNetStats {
  median_net_pnl_bps:   number | null;
  win_rate_net:         number | null;
  expectancy_bps_net:   number | null;
  expectancy_alpha_bps: number | null;
  sample_size_60d:      number | null;
}

/**
 * Headline net stats for a recipe, withheld until the sample clears
 * `meetsMinSample`. Gating at the writer rather than in each view means the
 * dashboard, the server components and the Telegram bot cannot independently
 * decide to publish an expectancy computed from a handful of trades.
 * The sample count is always reported so the wait is visible.
 */
export function computeRecipeNetStats(
  rows: Array<{ net_pnl_bps: number | null; is_win: boolean | null; alpha_bps?: number | null }>,
): RecipeNetStats {
  const graded = rows.filter((r) => r.net_pnl_bps !== null);
  const empty: RecipeNetStats = {
    median_net_pnl_bps: null, win_rate_net: null, expectancy_bps_net: null,
    expectancy_alpha_bps: null, sample_size_60d: null,
  };
  if (graded.length === 0) return empty;
  if (!meetsMinSample(graded.length)) return { ...empty, sample_size_60d: graded.length };

  const wins       = graded.filter((r) => r.is_win === true).length;
  const withAlpha  = graded.filter((r) => r.alpha_bps !== null && r.alpha_bps !== undefined);
  const alphaMean  = withAlpha.length > 0
    ? parseFloat((withAlpha.reduce((s, r) => s + (r.alpha_bps as number), 0) / withAlpha.length).toFixed(2))
    : null;

  return {
    median_net_pnl_bps:   computeMedianNetPnlBps(graded),
    win_rate_net:         wins / graded.length,
    expectancy_bps_net:   computeExpectancyBps(graded),
    expectancy_alpha_bps: alphaMean,
    sample_size_60d:      graded.length,
  };
}

// Average net PnL across all resolved outcomes (expectancy).
export function computeExpectancyBps(
  outcomes: Array<{ net_pnl_bps: number | null }>,
): number | null {
  const resolved = outcomes.filter((o) => o.net_pnl_bps !== null);
  if (resolved.length === 0) return null;
  const sum = resolved.reduce((s, o) => s + (o.net_pnl_bps as number), 0);
  return parseFloat((sum / resolved.length).toFixed(2));
}

// Median net PnL across resolved outcomes.
export function computeMedianNetPnlBps(
  outcomes: Array<{ net_pnl_bps: number | null }>,
): number | null {
  const vals = outcomes
    .filter((o) => o.net_pnl_bps !== null)
    .map((o) => o.net_pnl_bps as number)
    .sort((a, b) => a - b);
  if (vals.length === 0) return null;
  const mid = Math.floor(vals.length / 2);
  return vals.length % 2 === 0 ? (vals[mid - 1] + vals[mid]) / 2 : vals[mid];
}
