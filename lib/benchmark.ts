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
// The market move is scaled by each coin's beta to BTC, estimated from returns
// that closed before the signal fired. See lib/beta.ts. When beta cannot be
// estimated the fallback is 1, and the grading loop records a null beta so
// those rows can be told apart from genuinely estimated ones.

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
 * Beta- and direction-adjusted benchmark, and the alpha left over after paying
 * it. alpha = net PnL − what the same exposure to the market earned.
 *
 * `beta` scales the market move to the coin's own sensitivity. A 3-beta alt
 * that returns 300 bps while BTC returns 100 earned exactly what its exposure
 * implied, so its alpha is zero, not the 200 an unscaled comparison would show.
 * When beta could not be estimated the fallback is 1, which is the unscaled
 * comparison, and callers should record that no estimate was available.
 */
export function computeAlpha(input: {
  netPnlBps:       number;
  marketReturnBps: number | null;
  direction:       TradeDirection;
  beta?:           number | null;
}): AlphaResult {
  if (input.marketReturnBps === null) {
    return { benchmark_bps: null, alpha_bps: null };
  }
  const sign      = input.direction === "LONG" ? 1 : -1;
  const beta      = input.beta ?? 1;
  const benchmark = parseFloat((sign * beta * input.marketReturnBps).toFixed(2));
  return {
    benchmark_bps: benchmark,
    alpha_bps:     parseFloat((input.netPnlBps - benchmark).toFixed(2)),
  };
}
