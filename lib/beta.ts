// lib/beta.ts
// Per-coin sensitivity to BTC, so the benchmark charges each trade for the
// exposure it actually carried.
//
// An unscaled benchmark compares every coin 1:1 against BTC, which flatters
// high-beta names: an alt returning 300 bps while BTC returns 100 looks like
// 200 bps of alpha when a beta of 3 means it earned exactly what its exposure
// implied and the true alpha is zero.
//
// beta = cov(coin, market) / var(market), estimated from returns that closed
// before the signal fired so the trade is never scored with information it
// could not have had.

export interface TimedReturn {
  t: number;
  r: number;
}

export interface PriceBar {
  t: number;
  c: string;
}

/** Minimum aligned observations before a beta estimate is trustworthy. */
export const BETA_MIN_SAMPLE = 20;

/** Simple returns between consecutive closes, stamped at the later bar. */
export function toReturns(bars: PriceBar[]): TimedReturn[] {
  const out: TimedReturn[] = [];
  for (let i = 1; i < bars.length; i++) {
    const prev = parseFloat(bars[i - 1].c);
    const curr = parseFloat(bars[i].c);
    if (!isFinite(prev) || prev <= 0 || !isFinite(curr) || curr <= 0) continue;
    out.push({ t: bars[i].t, r: (curr - prev) / prev });
  }
  return out;
}

/** Inner join two return series on timestamp. */
export function alignReturns(
  coin:   TimedReturn[],
  market: TimedReturn[],
): { coin: number[]; market: number[] } {
  const marketByT = new Map(market.map((m) => [m.t, m.r]));
  const c: number[] = [];
  const m: number[] = [];
  for (const point of coin) {
    const mr = marketByT.get(point.t);
    if (mr === undefined) continue;
    c.push(point.r);
    m.push(mr);
  }
  return { coin: c, market: m };
}

/**
 * Ordinary least squares beta of coin returns against market returns.
 * Null below the minimum sample, on a length mismatch, or when the market has
 * no variance, since beta is undefined against a constant.
 */
export function computeBeta(coin: number[], market: number[]): number | null {
  if (coin.length !== market.length) return null;
  if (coin.length < BETA_MIN_SAMPLE) return null;

  const n = coin.length;
  const meanCoin   = coin.reduce((s, v) => s + v, 0) / n;
  const meanMarket = market.reduce((s, v) => s + v, 0) / n;

  let cov = 0;
  let varMarket = 0;
  for (let i = 0; i < n; i++) {
    const dm = market[i] - meanMarket;
    cov       += (coin[i] - meanCoin) * dm;
    varMarket += dm * dm;
  }

  if (varMarket <= 0) return null;
  const beta = cov / varMarket;
  return Number.isFinite(beta) ? beta : null;
}
