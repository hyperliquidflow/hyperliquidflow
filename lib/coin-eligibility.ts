// lib/coin-eligibility.ts
// Restricts signal emission to the coins the cohort actually has capital in.
//
// Signal volume had inverted against cohort conviction: KAITO produced 88.6% of
// every recorded outcome while holding under 0.1% of cohort notional, and BTC
// and ETH, which together carry two thirds of the cohort's capital, produced
// almost none. Two things caused it. funding_divergence had no notional floor
// at all, and tieredNotional scales thresholds DOWN to 20% for small coins,
// which lowers the bar on exactly the names where costs are highest and candle
// history is least reliable.
//
// The gate is expressed as a share of cohort capital rather than as a token
// allowlist. An allowlist goes stale and would have excluded HYPE and ZEC, both
// of which the cohort holds hundreds of millions in.

export interface PositionExposure {
  coin:          string;
  szi:           number;
  positionValue: number;
}

export interface EligibilityOpts {
  /** Minimum share of total cohort gross notional, e.g. 0.01 for 1%. */
  minShare:    number;
  /** Absolute floor in USD, so a shrunken cohort cannot promote a tiny position. */
  minAbsolute: number;
}

export const DEFAULT_ELIGIBILITY: EligibilityOpts = {
  minShare:    0.01,
  minAbsolute: 1_000_000,
};

/**
 * Gross cohort exposure per coin. Long and short sides are added, not netted:
 * a coin the cohort is split on still carries conviction, and netting would
 * report it as untouched.
 */
export function grossNotionalByCoin(positions: PositionExposure[]): Map<string, number> {
  const gross = new Map<string, number>();
  for (const p of positions) {
    const value = Math.abs(p.positionValue);
    if (!isFinite(value) || value <= 0) continue;
    gross.set(p.coin, (gross.get(p.coin) ?? 0) + value);
  }
  return gross;
}

/** Coins carrying enough cohort capital to be worth emitting signals on. */
export function eligibleCoins(
  grossByCoin: Map<string, number>,
  opts: EligibilityOpts = DEFAULT_ELIGIBILITY,
): Set<string> {
  let total = 0;
  for (const v of grossByCoin.values()) total += v;
  if (total <= 0) return new Set();

  const eligible = new Set<string>();
  for (const [coin, notional] of grossByCoin) {
    if (notional < opts.minAbsolute) continue;
    if (notional / total < opts.minShare) continue;
    eligible.add(coin);
  }
  return eligible;
}
