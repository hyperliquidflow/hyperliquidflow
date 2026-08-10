import { describe, it, expect } from "vitest";
import { computeATR, computeATRAsOf } from "../atr";

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

describe("computeATRAsOf", () => {
  const FOUR_H = 4 * 3600_000;
  // 20 bars, each with a true range of exactly 1, except the last 5 which
  // have a true range of 10. A point-in-time ATR must not see the spike.
  const candles = Array.from({ length: 20 }, (_, i) => ({
    t: i * FOUR_H,
    h: i < 15 ? "101" : "110",
    l: i < 15 ? "100" : "100",
    c: "100",
  }));

  it("excludes bars that close after the as-of time", () => {
    // As of bar 15's open, only bars 0-14 have closed: every true range is 1.
    const atr = computeATRAsOf(candles, 15 * FOUR_H, { period: 14, intervalMs: FOUR_H });
    expect(atr).toBe(1);
  });

  it("includes the spike once those bars have closed", () => {
    const atr = computeATRAsOf(candles, 20 * FOUR_H, { period: 14, intervalMs: FOUR_H });
    expect(atr).toBeGreaterThan(1);
  });

  it("returns null when too few bars closed before the as-of time", () => {
    expect(computeATRAsOf(candles, 5 * FOUR_H, { period: 14, intervalMs: FOUR_H })).toBeNull();
  });
});
