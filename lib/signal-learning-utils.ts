// lib/signal-learning-utils.ts
// Pure stateless functions for the signal learning stats engine.
// No I/O -- all inputs are plain data. Tested directly by Vitest.

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

export function computeConfidence(sampleSize: number, winRate: number): number {
  if (sampleSize === 0) return 0;
  const z = 1.645; // 90% confidence z-score
  const p = winRate;
  const n = sampleSize;
  const centre = (p + (z * z) / (2 * n)) / (1 + (z * z) / n);
  const margin  = (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n)) / (1 + (z * z) / n);
  const lowerBound = centre - margin;
  return Math.min(1, Math.max(0, Math.abs(lowerBound - 0.5) * 2));
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

export interface AtrExitResult {
  entry_price:          number;
  exit_price:           number;
  exit_reason:          "stop" | "target" | "time_1h" | "time_4h" | "time_24h";
  gross_pnl_bps:        number;
  net_pnl_bps:          number;
  realized_r_multiple:  number;
  is_win:               boolean;
}

/**
 * Simulate first-exit-wins logic using discrete price snapshots.
 * Stop = entry - 2*ATR (LONG) or entry + 2*ATR (SHORT).
 * Target = entry + 3*ATR (LONG) or entry - 3*ATR (SHORT).
 * Checked in order: 1h, 4h, 24h. First snapshot that hits stop or target wins;
 * otherwise the first available snapshot is a time exit.
 */
export function simulateAtrExit(
  direction:  "LONG" | "SHORT",
  entryPrice: number,
  atr:        number,
  price1h:    number | null,
  price4h:    number | null,
  price24h:   number | null,
): AtrExitResult | null {
  if (entryPrice <= 0 || atr <= 0) return null;

  const sign      = direction === "LONG" ? 1 : -1;
  const stopPx    = entryPrice - sign * 2 * atr;
  const targetPx  = entryPrice + sign * 3 * atr;

  const snapshots: Array<[number | null, "time_1h" | "time_4h" | "time_24h"]> = [
    [price1h,  "time_1h"],
    [price4h,  "time_4h"],
    [price24h, "time_24h"],
  ];

  let exitPx:     number | null = null;
  let exitReason: AtrExitResult["exit_reason"] | null = null;

  for (const [px, timeLabel] of snapshots) {
    if (px === null) continue;
    const hitStop   = direction === "LONG" ? px <= stopPx   : px >= stopPx;
    const hitTarget = direction === "LONG" ? px >= targetPx : px <= targetPx;
    if (hitStop) {
      exitPx     = stopPx;   // use exact stop level as conservative approximation
      exitReason = "stop";
      break;
    }
    if (hitTarget) {
      exitPx     = targetPx; // use exact target level
      exitReason = "target";
      break;
    }
    exitPx     = px;
    exitReason = timeLabel;
    break;
  }

  if (exitPx === null || exitReason === null) return null;

  const grossPnlBps  = sign * ((exitPx - entryPrice) / entryPrice) * 10_000;
  const netPnlBps    = grossPnlBps - ROUND_TRIP_FEE_BPS;
  const rMultiple    = grossPnlBps / (2 * atr / entryPrice * 10_000); // pnl / 1R

  return {
    entry_price:         entryPrice,
    exit_price:          exitPx,
    exit_reason:         exitReason,
    gross_pnl_bps:       parseFloat(grossPnlBps.toFixed(2)),
    net_pnl_bps:         parseFloat(netPnlBps.toFixed(2)),
    realized_r_multiple: parseFloat(rMultiple.toFixed(4)),
    is_win:              netPnlBps > 0,
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
