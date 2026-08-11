// lib/benchmark.ts
// Separates edge from beta.
//
// A LONG that returns 200 bps in a market that ran 180 bps is not a signal, it
// is exposure. Until every outcome is measured against what the market did over
// the same window, a bull month reads as a working system and a bear month
// reads as a broken one. Expectancy alone cannot tell those apart.
//
// The benchmark is BTC's return over the same holding window, signed by the
// trade's direction: a SHORT is compared against the inverse, because being
// short in a falling market is beta too.
//
// Known limitation: this does not scale the benchmark by each coin's beta to
// BTC. A high-beta alt that returns 300 bps while BTC returns 100 is credited
// with 200 bps of alpha when some of that is amplified exposure. Estimating
// per-coin beta needs a return history this project does not yet retain, so
// the unscaled version ships first. It is a large improvement over no
// benchmark and it errs toward flattering high-beta names, which is worth
// remembering when reading per-coin results.

export type TradeDirection = "LONG" | "SHORT";

/** Simple return between two prices, in basis points. */
export function marketReturnBps(entryPx: number, exitPx: number): number | null {
  if (!isFinite(entryPx) || entryPx <= 0) return null;
  if (!isFinite(exitPx)  || exitPx  <= 0) return null;
  return parseFloat((((exitPx - entryPx) / entryPx) * 10_000).toFixed(2));
}

export interface AlphaResult {
  benchmark_bps: number | null;
  alpha_bps:     number | null;
}

/**
 * Direction-adjusted benchmark and the alpha left over after paying it.
 * alpha = net PnL − what the same directional exposure to the market earned.
 */
export function computeAlpha(input: {
  netPnlBps:       number;
  marketReturnBps: number | null;
  direction:       TradeDirection;
}): AlphaResult {
  if (input.marketReturnBps === null) {
    return { benchmark_bps: null, alpha_bps: null };
  }
  const sign      = input.direction === "LONG" ? 1 : -1;
  const benchmark = parseFloat((sign * input.marketReturnBps).toFixed(2));
  return {
    benchmark_bps: benchmark,
    alpha_bps:     parseFloat((input.netPnlBps - benchmark).toFixed(2)),
  };
}
