// lib/excursion.ts
// How far a trade travels in each direction before its holding window closes.
//
// The grading loop exits at a 3 ATR target or a 2 ATR stop within 24 hours, and
// across the project's entire history not one trade has ever hit the target.
// Every exit has been a stop or a timeout. That makes the reward side of the
// design decorative: the breakeven arithmetic assumes a 3:2 payoff that the
// market never actually pays.
//
// Maximum favourable and adverse excursion, measured in ATR units, say what the
// price series can actually deliver. That is a property of the market rather
// than of any recipe, so it can be measured from random entry points without
// overfitting to the handful of real signals on record.

export interface ExcursionBar {
  t: number;
  h: string;
  l: string;
  c: string;
}

export interface Excursion {
  /** Best the trade ever went, in ATR units. Never negative. */
  mfe_atr: number;
  /** Worst the trade ever went, in ATR units. Never negative. */
  mae_atr: number;
  bars_seen: number;
}

export interface ExcursionParams {
  direction:     "LONG" | "SHORT";
  entryPrice:    number;
  atr:           number;
  entryMs:       number;
  bars:          ExcursionBar[];
  maxHoldHours?: number;
}

const HOUR_MS = 3600_000;

/** Peak favourable and adverse travel over the holding window, in ATR units. */
export function computeExcursion(params: ExcursionParams): Excursion | null {
  const { direction, entryPrice, atr, entryMs, bars, maxHoldHours = 24 } = params;
  if (entryPrice <= 0 || atr <= 0) return null;

  const windowEnd = entryMs + maxHoldHours * HOUR_MS;
  const window = bars.filter((b) => b.t >= entryMs && b.t < windowEnd);
  if (window.length === 0) return null;

  let bestPx  = entryPrice;
  let worstPx = entryPrice;

  for (const b of window) {
    const high = parseFloat(b.h);
    const low  = parseFloat(b.l);
    if (!isFinite(high) || !isFinite(low)) continue;

    if (direction === "LONG") {
      if (high > bestPx)  bestPx  = high;
      if (low  < worstPx) worstPx = low;
    } else {
      if (low  < bestPx)  bestPx  = low;
      if (high > worstPx) worstPx = high;
    }
  }

  const sign = direction === "LONG" ? 1 : -1;
  return {
    mfe_atr:   Math.max(0, (sign * (bestPx  - entryPrice)) / atr),
    mae_atr:   Math.max(0, (sign * (entryPrice - worstPx)) / atr),
    bars_seen: window.length,
  };
}

/** Share of trades whose favourable travel reached `multiple` ATR. */
export function hitRateAtMultiple(
  excursions: Array<{ mfe_atr: number }>,
  multiple: number,
): number | null {
  if (excursions.length === 0) return null;
  return excursions.filter((e) => e.mfe_atr >= multiple).length / excursions.length;
}
