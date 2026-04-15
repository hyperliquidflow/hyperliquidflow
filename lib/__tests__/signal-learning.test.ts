import { describe, it, expect } from "vitest";
import {
  computeWinRates,
  computeTrend,
  computeMeasuredEV,
  meetsMinSample,
  computeConfidence,
} from "../signal-learning-utils";

describe("computeWinRates", () => {
  it("returns correct win rates for 7d, 30d, 90d windows", () => {
    const now = Date.now();
    const outcomes = [
      { is_win: true,  fired_at: new Date(now - 2 * 86400_000).toISOString() },
      { is_win: false, fired_at: new Date(now - 5 * 86400_000).toISOString() },
      { is_win: true,  fired_at: new Date(now - 15 * 86400_000).toISOString() },
      { is_win: false, fired_at: new Date(now - 15 * 86400_000).toISOString() },
      { is_win: true,  fired_at: new Date(now - 60 * 86400_000).toISOString() },
    ];
    const rates = computeWinRates(outcomes);
    expect(rates.win_rate_7d).toBeCloseTo(0.5, 1);
    expect(rates.win_rate_30d).toBeCloseTo(0.5, 1);
    expect(rates.win_rate_90d).toBeCloseTo(0.6, 1);
  });

  it("returns null for windows with zero signals", () => {
    const rates = computeWinRates([]);
    expect(rates.win_rate_7d).toBeNull();
    expect(rates.win_rate_30d).toBeNull();
    expect(rates.win_rate_90d).toBeNull();
  });
});

describe("computeTrend", () => {
  it("returns DEGRADING when 7d rate is much lower than 90d rate", () => {
    expect(computeTrend(0.30, 0.70)).toBe("DEGRADING");
  });

  it("returns IMPROVING when 7d rate is much higher than 90d rate", () => {
    expect(computeTrend(0.75, 0.40)).toBe("IMPROVING");
  });

  it("returns STABLE when rates are within 10%", () => {
    expect(computeTrend(0.55, 0.50)).toBe("STABLE");
  });

  it("returns INSUFFICIENT_DATA when either value is null", () => {
    expect(computeTrend(null, 0.50)).toBe("INSUFFICIENT_DATA");
    expect(computeTrend(0.50, null)).toBe("INSUFFICIENT_DATA");
  });
});

describe("computeMeasuredEV", () => {
  it("computes ev = win_rate * avg_win + (1-win_rate) * avg_loss", () => {
    expect(computeMeasuredEV(0.60, 0.02, -0.01)).toBeCloseTo(0.60 * 0.02 + 0.40 * -0.01);
  });

  it("returns null when inputs are null", () => {
    expect(computeMeasuredEV(null, 0.02, -0.01)).toBeNull();
  });
});

describe("meetsMinSample", () => {
  it("returns true for 30+ samples", () => {
    expect(meetsMinSample(30)).toBe(true);
    expect(meetsMinSample(100)).toBe(true);
  });
  it("returns false for under 30 samples", () => {
    expect(meetsMinSample(29)).toBe(false);
    expect(meetsMinSample(0)).toBe(false);
  });
});

describe("computeConfidence", () => {
  it("returns higher confidence for larger samples", () => {
    const c30  = computeConfidence(30, 0.70);
    const c100 = computeConfidence(100, 0.70);
    expect(c100).toBeGreaterThan(c30);
  });

  it("returns value between 0 and 1", () => {
    const c = computeConfidence(50, 0.65);
    expect(c).toBeGreaterThanOrEqual(0);
    expect(c).toBeLessThanOrEqual(1);
  });
});
