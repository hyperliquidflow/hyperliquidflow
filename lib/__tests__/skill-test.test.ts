import { describe, it, expect } from "vitest";
import { splitDailyPnls, scoreFromDailyPnls, rankIC } from "../skill-test";

describe("splitDailyPnls", () => {
  it("splits a series into an earlier training half and a later test half", () => {
    const split = splitDailyPnls([1, 2, 3, 4, 5, 6], { minHalf: 3 });
    expect(split?.train).toEqual([1, 2, 3]);
    expect(split?.test).toEqual([4, 5, 6]);
  });

  it("puts the odd day in the training half so the test half is never short", () => {
    const split = splitDailyPnls([1, 2, 3, 4, 5], { minHalf: 2 });
    expect(split?.train).toEqual([1, 2, 3]);
    expect(split?.test).toEqual([4, 5]);
  });

  it("returns null when either half would fall under the minimum", () => {
    expect(splitDailyPnls([1, 2, 3, 4], { minHalf: 3 })).toBeNull();
  });
});

describe("scoreFromDailyPnls", () => {
  it("ranks a steady earner above a volatile one with the same total", () => {
    const steady   = Array.from({ length: 30 }, () => 100);
    const volatile = Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? 900 : -700));

    expect(scoreFromDailyPnls(steady)).toBeGreaterThan(scoreFromDailyPnls(volatile));
  });

  it("scores a consistent loser at the floor", () => {
    const loser = Array.from({ length: 30 }, () => -100);
    expect(scoreFromDailyPnls(loser)).toBeLessThan(0.1);
  });

  it("stays within 0 and 1", () => {
    const s = scoreFromDailyPnls([50, -20, 300, 10, -5, 80]);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  });
});

describe("rankIC", () => {
  it("returns +1 when score order matches forward return order exactly", () => {
    const pairs = Array.from({ length: 25 }, (_, i) => ({ score: i / 25, forwardPnl: i * 10 }));
    expect(rankIC(pairs)?.rho).toBeCloseTo(1, 5);
  });

  it("returns -1 when the score order is exactly inverted", () => {
    const pairs = Array.from({ length: 25 }, (_, i) => ({ score: i / 25, forwardPnl: -i * 10 }));
    expect(rankIC(pairs)?.rho).toBeCloseTo(-1, 5);
  });

  it("reports the pair count it measured", () => {
    const pairs = Array.from({ length: 25 }, (_, i) => ({ score: i / 25, forwardPnl: i }));
    expect(rankIC(pairs)?.n).toBe(25);
  });

  it("returns null below the minimum sample, rather than a noisy number", () => {
    const pairs = Array.from({ length: 5 }, (_, i) => ({ score: i / 5, forwardPnl: i }));
    expect(rankIC(pairs)).toBeNull();
  });

  it("returns null when every score ties, since there is no ordering to test", () => {
    const pairs = Array.from({ length: 25 }, (_, i) => ({ score: 0.5, forwardPnl: i }));
    expect(rankIC(pairs)).toBeNull();
  });
});
