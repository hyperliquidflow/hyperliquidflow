import { describe, it, expect } from "vitest";
import { computeATR } from "../atr";

describe("computeATR with non-finite candles", () => {
  it("returns null when valid candles are fewer than period", () => {
    const candles = [
      { h: "NaN", l: "NaN", c: "NaN" },
      { h: "10",  l: "9",   c: "9.5" },
      { h: "11",  l: "9",   c: "10"  },
    ];
    expect(computeATR(candles, 5)).toBeNull();
  });

  it("returns a finite ATR when valid candles meet the period", () => {
    const candles = Array.from({ length: 6 }, (_, i) => ({
      h: String(10 + i),
      l: String(9  + i),
      c: String(9.5 + i),
    }));
    const atr = computeATR(candles, 5);
    expect(atr).not.toBeNull();
    expect(Number.isFinite(atr!)).toBe(true);
  });
});
