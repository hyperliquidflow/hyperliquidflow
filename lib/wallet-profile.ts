export type TradingStyle = "SCALPER" | "SWING" | "TREND";

export interface RegimeStats {
  bull_daily_pnl:    number | null;
  bear_daily_pnl:    number | null;
  ranging_daily_pnl: number | null;
  regime_edge:       number | null;
  regime_day_counts: { BULL: number; BEAR: number; RANGING: number };
}

// ─── Trading style ────────────────────────────────────────────────────────────

export function classifyTradingStyle(totalTrades: number): TradingStyle {
  if (totalTrades > 300) return "SCALPER";
  if (totalTrades < 60)  return "TREND";
  return "SWING";
}

// ─── PnL consistency ──────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function mean(xs: number[]): number {
  return xs.reduce((s, v) => s + v, 0) / xs.length;
}

function stddev(xs: number[]): number {
  const m = mean(xs);
  const variance = xs.reduce((s, v) => s + (v - m) ** 2, 0) / xs.length;
  return Math.sqrt(variance);
}

/**
 * Returns [0, 1]. Only computed over non-zero days (trading-off zeros excluded).
 * Returns 0 when fewer than 5 active days or mean is non-positive.
 */
export function computeConsistency(dailyPnls: number[]): number {
  const active = dailyPnls.filter((v) => v !== 0);
  if (active.length < 5) return 0;
  const m = mean(active);
  if (m <= 0) return 0;
  return 1 - clamp(stddev(active) / m, 0, 1);
}

// ─── Regime stats ─────────────────────────────────────────────────────────────

/**
 * `regimeLabels` is a parallel array aligned with `dailyPnls` — index i covers
 * the same calendar day as dailyPnls[i]. Values: "BULL" | "BEAR" | "RANGING".
 * `minRegimeDays` is the minimum days in a regime before its avg is trusted.
 */
export function computeRegimeStats(
  dailyPnls:    number[],
  regimeLabels: string[],
  minRegimeDays = 5,
): RegimeStats {
  const buckets: Record<"BULL" | "BEAR" | "RANGING", number[]> = {
    BULL:    [],
    BEAR:    [],
    RANGING: [],
  };

  const n = Math.min(dailyPnls.length, regimeLabels.length);
  for (let i = 0; i < n; i++) {
    const label = regimeLabels[i] as "BULL" | "BEAR" | "RANGING";
    if (label in buckets) buckets[label].push(dailyPnls[i]);
  }

  const avg = (xs: number[]): number | null =>
    xs.length >= minRegimeDays ? mean(xs) : null;

  const bull    = avg(buckets.BULL);
  const bear    = avg(buckets.BEAR);
  const ranging = avg(buckets.RANGING);

  const nonNull = [bull, bear, ranging].filter((v): v is number => v !== null);
  let regime_edge: number | null = null;
  if (nonNull.length >= 2) {
    const best  = Math.max(...nonNull);
    const worst = Math.min(...nonNull);
    regime_edge = clamp(
      (best - worst) / Math.max(Math.abs(best) + Math.abs(worst), 1),
      -1,
      1,
    );
  }

  return {
    bull_daily_pnl:    bull,
    bear_daily_pnl:    bear,
    ranging_daily_pnl: ranging,
    regime_edge,
    regime_day_counts: {
      BULL:    buckets.BULL.length,
      BEAR:    buckets.BEAR.length,
      RANGING: buckets.RANGING.length,
    },
  };
}

// ─── Coin exposure ────────────────────────────────────────────────────────────

interface RawPosition {
  position?: {
    coin?:           string;
    positionValue?:  string;
  };
}

/**
 * Extracts up to `maxCoins` coin symbols from a snapshot's positions array,
 * sorted by |positionValue| descending.
 */
export function extractTopCoins(positions: unknown[], maxCoins: number): string[] {
  const parsed = (positions as RawPosition[])
    .filter((p) => p?.position?.coin && p?.position?.positionValue)
    .map((p) => ({
      coin:  p.position!.coin as string,
      notional: Math.abs(parseFloat(p.position!.positionValue as string)),
    }))
    .filter((p) => !isNaN(p.notional));

  parsed.sort((a, b) => b.notional - a.notional);
  return parsed.slice(0, maxCoins).map((p) => p.coin);
}
