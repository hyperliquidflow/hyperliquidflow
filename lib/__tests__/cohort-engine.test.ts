import { describe, it, expect } from "vitest";
import { getEquityTier, computeCohortScores, computeCohortScoresV2 } from "../cohort-engine";
import type { HlClearinghouseState, HlAssetPosition } from "../hyperliquid-api-client";

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

describe("computeCohortScores", () => {
  // V1 weights: 0.35 sharpe | 0.25 consistency | 0.25 drawdown | 0.15 regime_fit
  const FLAT_PNLS  = new Array(30).fill(0);
  const STEADY_WIN = new Array(30).fill(10); // zero variance, monotonic equity curve

  function makeState(positions: Array<{ szi: number; notional: number }>): HlClearinghouseState {
    const assetPositions: HlAssetPosition[] = positions.map((p, i) => ({
      position: {
        coin:          `C${i}`,
        szi:           String(p.szi),
        entryPx:       "100",
        positionValue: String(p.notional),
        unrealizedPnl: "0",
        returnOnEquity: "0",
        liquidationPx: null,
        leverage:      { type: "cross", value: 3 },
        cumFunding:    { allTime: "0", sinceChange: "0", sinceOpen: "0" },
      },
      type: "oneWay",
    }));
    const summary = {
      accountValue:    "1000000",
      totalNtlPos:     "0",
      totalRawUsd:     "1000000",
      totalMarginUsed: "0",
    };
    return {
      assetPositions,
      crossMarginSummary: summary,
      marginSummary:      summary,
      withdrawable:       "1000000",
    };
  }

  const FLAT_WALLET = makeState([]);

  it("gives a flat wallet the neutral 0.5 regime_fit baseline in every regime", () => {
    for (const regime of ["BULL", "BEAR", "RANGING"] as const) {
      expect(computeCohortScores(STEADY_WIN, FLAT_WALLET, regime).regime_fit).toBe(0.5);
    }
  });

  it("scores a flat-PnL flat-position wallet at 0.325", () => {
    // sharpe=0, consistency=0 (all windows have no data), drawdown=1 (no peak),
    // regime_fit=0.5 => 0.35*0 + 0.25*0 + 0.25*1 + 0.15*0.5 = 0.325
    const r = computeCohortScores(FLAT_PNLS, FLAT_WALLET, "RANGING");
    expect(r.sharpe_proxy).toBe(0);
    expect(r.pnl_consistency).toBe(0);
    expect(r.drawdown_score).toBe(1);
    expect(r.regime_fit).toBe(0.5);
    expect(r.overall_score).toBeCloseTo(0.325, 6);
  });

  it("applies the 35/25/25/15 weighted sum", () => {
    // Steady $10/day: sharpe clamps to 1, every 7d window is positive so
    // consistency=1, the equity curve never draws down so drawdown=1.
    // Flat wallet keeps regime_fit at 0.5.
    // => 0.35 + 0.25 + 0.25 + 0.075 = 0.925
    const r = computeCohortScores(STEADY_WIN, FLAT_WALLET, "BULL");
    expect(r.sharpe_proxy).toBe(1);
    expect(r.pnl_consistency).toBe(1);
    expect(r.drawdown_score).toBe(1);
    expect(r.overall_score).toBeCloseTo(0.925, 6);
  });

  it("rewards a long-biased wallet in BULL and penalises it in BEAR", () => {
    const allLong = makeState([{ szi: 2, notional: 200_000 }, { szi: 1, notional: 100_000 }]);

    const bull = computeCohortScores(STEADY_WIN, allLong, "BULL");
    expect(bull.regime_fit).toBeCloseTo(1, 3);
    expect(bull.overall_score).toBeCloseTo(1, 3);   // 0.35 + 0.25 + 0.25 + 0.15

    const bear = computeCohortScores(STEADY_WIN, allLong, "BEAR");
    expect(bear.regime_fit).toBeCloseTo(0, 3);
    expect(bear.overall_score).toBeCloseTo(0.85, 3); // 0.35 + 0.25 + 0.25 + 0
  });

  it("clamps overall_score into [0,1]", () => {
    const losing = new Array(30).fill(-10);
    const r = computeCohortScores(losing, FLAT_WALLET, "BEAR");
    expect(r.overall_score).toBeGreaterThanOrEqual(0);
    expect(r.overall_score).toBeLessThanOrEqual(1);
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
