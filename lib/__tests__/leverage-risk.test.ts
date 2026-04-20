import { describe, it, expect } from "vitest";
import {
  computeBlowUpPenalty,
  computeBlowUpDistanceScore,
  computeLevAdjSharpe,
  DEFAULT_PENALTY_PARAMS,
} from "../leverage-risk";

const PARAMS = DEFAULT_PENALTY_PARAMS; // safe_lev=3, max_lev=15, exponent=1.5

describe("computeBlowUpPenalty", () => {
  it("returns 0 at or below safe_lev", () => {
    expect(computeBlowUpPenalty(0, PARAMS)).toBe(0);
    expect(computeBlowUpPenalty(3, PARAMS)).toBe(0);
  });

  it("returns 1 at or above max_lev", () => {
    expect(computeBlowUpPenalty(15, PARAMS)).toBe(1);
    expect(computeBlowUpPenalty(20, PARAMS)).toBe(1);
  });

  it("interpolates between safe_lev and max_lev", () => {
    const mid = computeBlowUpPenalty(9, PARAMS); // midpoint of [3,15]
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });

  it("is convex with exponent > 1 (midpoint penalty < 0.5)", () => {
    // With exponent=1.5, the midpoint t=0.5 gives 0.5^1.5 approx 0.354
    const mid = computeBlowUpPenalty(9, PARAMS);
    expect(mid).toBeLessThan(0.5);
  });

  it("is monotonically increasing", () => {
    const a = computeBlowUpPenalty(5, PARAMS);
    const b = computeBlowUpPenalty(10, PARAMS);
    const c = computeBlowUpPenalty(14, PARAMS);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
  });
});

describe("computeBlowUpDistanceScore", () => {
  it("is 1 - penalty", () => {
    expect(computeBlowUpDistanceScore(3, PARAMS)).toBe(1);
    expect(computeBlowUpDistanceScore(15, PARAMS)).toBe(0);
    const mid = computeBlowUpDistanceScore(9, PARAMS);
    expect(mid).toBeCloseTo(1 - computeBlowUpPenalty(9, PARAMS), 6);
  });
});

describe("computeLevAdjSharpe", () => {
  it("returns 0 for empty array", () => {
    expect(computeLevAdjSharpe([], 0)).toBe(0);
  });

  it("returns 0 for all-zero PnL series", () => {
    expect(computeLevAdjSharpe(new Array(30).fill(0), 1)).toBe(0);
  });

  it("is lower for higher leverage with identical raw PnL", () => {
    // mean=2, std=1 -- raw Sharpe ~2. Both scores land near 1.0 but remain
    // distinguishable: lev=3 divides PnLs by 4, lev=0 by 1, so score(lev=0)>score(lev=3).
    const pnls = [2, 1, 3, 2, 1, 4, 1, 2, 3, 1,
                  2, 1, 3, 2, 1, 4, 1, 2, 3, 1,
                  2, 1, 3, 2, 1, 4, 1, 2, 3, 1];
    const lowLev  = computeLevAdjSharpe(pnls, 0);
    const highLev = computeLevAdjSharpe(pnls, 3);
    expect(highLev).toBeLessThan(lowLev);
  });

  it("is clamped to [0, 1]", () => {
    const bigPnls = new Array(30).fill(1000);
    const result = computeLevAdjSharpe(bigPnls, 0);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
    const badPnls = new Array(30).fill(-100);
    expect(computeLevAdjSharpe(badPnls, 0)).toBe(0);
  });

  it("normalises at 2 -- a Sharpe of 2 maps to score approx 1.0", () => {
    // Alternating [1,3] gives mean=2, std=1, raw_sharpe=2, score=clamp(2/2,0,1)=1
    const pnls = Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? 1 : 3));
    const score = computeLevAdjSharpe(pnls, 0); // avgLev=0 so adjPnls = pnls
    expect(score).toBeCloseTo(1.0, 1);
  });

  it("single-element array is clamped to 1 (documents known behavior)", () => {
    // stddev of 1-element array is 0, so raw = 100/0.0001 = 1M, clamped to 1
    expect(computeLevAdjSharpe([100], 0)).toBe(1);
  });

  it("negative avgLeverage is treated the same as zero", () => {
    const pnls = Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? 1 : 3));
    expect(computeLevAdjSharpe(pnls, -5)).toBeCloseTo(computeLevAdjSharpe(pnls, 0), 6);
  });
});
