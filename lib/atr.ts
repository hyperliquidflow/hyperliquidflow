// lib/atr.ts
// ATR (Average True Range) computation for 4h candles.
// Pure functions, no I/O. Used by scripts/signal-learning.ts.

export interface CandleForAtr {
  h: string;
  l: string;
  c: string;
}

export const ATR_PERIOD = 14;

// Equal-weighted mean true range over the last `period` candles.
export function computeATR(candles: CandleForAtr[], period = ATR_PERIOD): number | null {
  if (candles.length < 2) return null;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const h     = parseFloat(candles[i].h);
    const l     = parseFloat(candles[i].l);
    const prevC = parseFloat(candles[i - 1].c);
    if (!isFinite(h) || !isFinite(l) || !isFinite(prevC)) continue;
    trs.push(Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC)));
  }
  const slice = trs.slice(-period);
  if (slice.length === 0) return null;
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

// ATR expressed as a percentage of price (e.g. 0.015 = 1.5% of price).
export function atrPct(atr: number, price: number): number {
  return price > 0 ? atr / price : 0;
}
