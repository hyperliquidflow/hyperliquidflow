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
