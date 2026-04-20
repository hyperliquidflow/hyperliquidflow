import { describe, it, expect } from "vitest";
import { getEquityTier, computeCohortScoresV2 } from "../cohort-engine";

describe("getEquityTier", () => {
  it("returns Elite for $5M+", () => {
    expect(getEquityTier(5_000_000)).toBe("Elite");
    expect(getEquityTier(10_000_000)).toBe("Elite");
    expect(getEquityTier(40_000_000)).toBe("Elite");
  });

  it("returns Major for $1M - $5M", () => {
    expect(getEquityTier(1_000_000)).toBe("Major");
    expect(getEquityTier(3_000_000)).toBe("Major");
    expect(getEquityTier(4_999_999)).toBe("Major");
  });

  it("returns Large for $500K - $1M", () => {
    expect(getEquityTier(500_000)).toBe("Large");
    expect(getEquityTier(750_000)).toBe("Large");
    expect(getEquityTier(999_999)).toBe("Large");
  });

  it("returns Mid for $100K - $500K", () => {
    expect(getEquityTier(100_000)).toBe("Mid");
    expect(getEquityTier(250_000)).toBe("Mid");
    expect(getEquityTier(499_999)).toBe("Mid");
  });

  it("returns Small for $50K - $100K", () => {
    expect(getEquityTier(50_000)).toBe("Small");
    expect(getEquityTier(75_000)).toBe("Small");
    expect(getEquityTier(99_999)).toBe("Small");
  });

  it("returns Micro for $1K - $50K", () => {
    expect(getEquityTier(1_000)).toBe("Micro");
    expect(getEquityTier(25_000)).toBe("Micro");
    expect(getEquityTier(49_999)).toBe("Micro");
  });

  it("returns Dust for under $1K", () => {
    expect(getEquityTier(0)).toBe("Dust");
    expect(getEquityTier(999)).toBe("Dust");
    expect(getEquityTier(0.000001)).toBe("Dust");
  });

  it("returns null for null/undefined/negative", () => {
    expect(getEquityTier(null)).toBeNull();
    expect(getEquityTier(undefined)).toBeNull();
    expect(getEquityTier(-1)).toBeNull();
  });
});

describe("computeCohortScoresV2", () => {
  const FLAT_PNLS = new Array(30).fill(0);
  const GOOD_PNLS = Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? 5 : 15));

  it("returns overall_score_v2 in [0,1]", () => {
    const r = computeCohortScoresV2(GOOD_PNLS, 2, 5);
    expect(r.overall_score_v2).toBeGreaterThanOrEqual(0);
    expect(r.overall_score_v2).toBeLessThanOrEqual(1);
  });

  it("defaults regime_fit to 0.5 when state is omitted", () => {
    const r = computeCohortScoresV2(GOOD_PNLS, 2, 5);
    expect(r.regime_fit).toBe(0.5);
  });

  it("high leverage reduces overall_score_v2", () => {
    const lowLev  = computeCohortScoresV2(GOOD_PNLS, 1, 4);
    const highLev = computeCohortScoresV2(GOOD_PNLS, 8, 14);
    expect(highLev.overall_score_v2).toBeLessThan(lowLev.overall_score_v2);
  });

  it("zero leverage gives max blow_up_distance_v2", () => {
    const r = computeCohortScoresV2(GOOD_PNLS, 0, 0);
    expect(r.blow_up_distance_v2).toBe(1);
  });

  it("flat PnL series scores predictably (regime_fit=0.5, blow_up=1, no PnL factors)", () => {
    // lev_adj_sharpe=0, pnl_consistency=0 (no-data windows skipped)
    // drawdown=1 (zero series has no peak so maxDrawdown stays 0)
    // regime_fit=0.5, blow_up=1
    // = 0.30*0 + 0.20*0 + 0.20*1 + 0.15*0.5 + 0.15*1 = 0.425
    const r = computeCohortScoresV2(FLAT_PNLS, 0, 0);
    expect(r.overall_score_v2).toBeCloseTo(0.425, 2);
  });

  it("all sub-scores are in [0,1]", () => {
    const r = computeCohortScoresV2(GOOD_PNLS, 3, 9);
    expect(r.lev_adj_sharpe).toBeGreaterThanOrEqual(0);
    expect(r.lev_adj_sharpe).toBeLessThanOrEqual(1);
    expect(r.pnl_consistency).toBeGreaterThanOrEqual(0);
    expect(r.pnl_consistency).toBeLessThanOrEqual(1);
    expect(r.drawdown_score).toBeGreaterThanOrEqual(0);
    expect(r.drawdown_score).toBeLessThanOrEqual(1);
    expect(r.blow_up_distance_v2).toBeGreaterThanOrEqual(0);
    expect(r.blow_up_distance_v2).toBeLessThanOrEqual(1);
  });
});
