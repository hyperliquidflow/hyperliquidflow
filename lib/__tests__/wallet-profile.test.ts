import { describe, it, expect } from "vitest";
import {
  classifyTradingStyle,
  computeConsistency,
  computeRegimeStats,
  extractTopCoins,
} from "../wallet-profile";

describe("classifyTradingStyle", () => {
  it("returns SCALPER above 300", () => {
    expect(classifyTradingStyle(301)).toBe("SCALPER");
    expect(classifyTradingStyle(1000)).toBe("SCALPER");
  });
  it("returns SWING at exactly 300 (not > 300)", () => {
    expect(classifyTradingStyle(300)).toBe("SWING");
  });
  it("returns SWING between 60 and 300 inclusive", () => {
    expect(classifyTradingStyle(60)).toBe("SWING");
    expect(classifyTradingStyle(150)).toBe("SWING");
  });
  it("returns TREND below 60", () => {
    expect(classifyTradingStyle(59)).toBe("TREND");
    expect(classifyTradingStyle(0)).toBe("TREND");
  });
});

describe("computeConsistency", () => {
  it("returns 0 when fewer than 5 active days", () => {
    expect(computeConsistency([100, 200, 300, 0, 0, 0])).toBe(0); // 3 active
  });
  it("returns 0 when mean of active days is 0", () => {
    expect(computeConsistency([100, -100, 50, -50, 0, 0])).toBe(0);
  });
  it("returns 0 when mean of active days is negative", () => {
    expect(computeConsistency([-100, -200, -300, -400, -500])).toBe(0);
  });
  it("returns ~1.0 for perfectly uniform positive daily PnL", () => {
    // stddev = 0, so 1 - clamp(0/mean, 0, 1) = 1.0
    expect(computeConsistency([500, 500, 500, 500, 500])).toBeCloseTo(1.0);
  });
  it("returns lower value for highly variable series", () => {
    const uniform  = computeConsistency([500, 500, 500, 500, 500]);
    const variable = computeConsistency([100, 1000, 50, 2000, 10]);
    expect(variable).toBeLessThan(uniform);
  });
  it("ignores zero days in mean/stddev calculation", () => {
    // 50 zeros plus 5 uniform positives: should behave same as just the 5
    const withZeros    = computeConsistency([...Array(50).fill(0), 500, 500, 500, 500, 500]);
    const withoutZeros = computeConsistency([500, 500, 500, 500, 500]);
    expect(withZeros).toBeCloseTo(withoutZeros);
  });
  it("returns value in [0, 1]", () => {
    const c = computeConsistency([100, 200, 50, 300, 150, 80]);
    expect(c).toBeGreaterThanOrEqual(0);
    expect(c).toBeLessThanOrEqual(1);
  });
});

describe("computeRegimeStats", () => {
  const bullLabels:   string[] = Array(10).fill("BULL");
  const mixedLabels:  string[] = [
    ...Array(10).fill("BULL"),
    ...Array(10).fill("BEAR"),
    ...Array(10).fill("RANGING"),
  ];

  it("returns null for regimes with fewer than minRegimeDays days (default 5)", () => {
    // 4 BULL days, 4 BEAR days -- both below default 5
    const labels = [...Array(4).fill("BULL"), ...Array(4).fill("BEAR")];
    const pnls   = Array(8).fill(100);
    const r = computeRegimeStats(pnls, labels);
    expect(r.bull_daily_pnl).toBeNull();
    expect(r.bear_daily_pnl).toBeNull();
    expect(r.regime_edge).toBeNull();
  });

  it("returns non-null avg when regime has exactly minRegimeDays days", () => {
    const labels = Array(5).fill("BULL");
    const pnls   = Array(5).fill(200);
    const r = computeRegimeStats(pnls, labels);
    expect(r.bull_daily_pnl).toBeCloseTo(200);
  });

  it("returns null regime_edge when only one regime has enough data", () => {
    const labels = [...Array(10).fill("BULL"), ...Array(2).fill("BEAR")];
    const pnls   = Array(12).fill(100);
    const r = computeRegimeStats(pnls, labels);
    expect(r.regime_edge).toBeNull();
  });

  it("computes regime_edge when two regimes have enough data", () => {
    const labels = [...Array(10).fill("BULL"), ...Array(10).fill("BEAR")];
    const pnls   = [
      ...Array(10).fill(200),   // bull avg = 200
      ...Array(10).fill(-100),  // bear avg = -100
    ];
    const r = computeRegimeStats(pnls, labels);
    expect(r.bull_daily_pnl).toBeCloseTo(200);
    expect(r.bear_daily_pnl).toBeCloseTo(-100);
    expect(r.regime_edge).not.toBeNull();
    expect(r.regime_edge!).toBeGreaterThan(0);
    expect(r.regime_edge!).toBeLessThanOrEqual(1);
  });

  it("regime_edge is clamped to [-1, 1]", () => {
    const labels = [...Array(10).fill("BULL"), ...Array(10).fill("BEAR")];
    const pnls   = [...Array(10).fill(1_000_000), ...Array(10).fill(-1_000_000)];
    const r = computeRegimeStats(pnls, labels);
    expect(r.regime_edge!).toBeLessThanOrEqual(1);
    expect(r.regime_edge!).toBeGreaterThanOrEqual(-1);
  });

  it("counts regime days correctly", () => {
    const labels = [
      ...Array(8).fill("BULL"),
      ...Array(6).fill("BEAR"),
      ...Array(4).fill("RANGING"),
    ];
    const pnls = Array(18).fill(100);
    const r = computeRegimeStats(pnls, labels);
    expect(r.regime_day_counts.BULL).toBe(8);
    expect(r.regime_day_counts.BEAR).toBe(6);
    expect(r.regime_day_counts.RANGING).toBe(4);
  });

  it("all days same regime: other regimes null, regime_edge null", () => {
    const pnls = Array(10).fill(100);
    const r = computeRegimeStats(pnls, bullLabels);
    expect(r.bull_daily_pnl).toBeCloseTo(100);
    expect(r.bear_daily_pnl).toBeNull();
    expect(r.ranging_daily_pnl).toBeNull();
    expect(r.regime_edge).toBeNull();
  });

  it("handles three regimes with enough data", () => {
    const pnls = [
      ...Array(10).fill(200),
      ...Array(10).fill(-50),
      ...Array(10).fill(100),
    ];
    const r = computeRegimeStats(pnls, mixedLabels);
    expect(r.bull_daily_pnl).toBeCloseTo(200);
    expect(r.bear_daily_pnl).toBeCloseTo(-50);
    expect(r.ranging_daily_pnl).toBeCloseTo(100);
    expect(r.regime_edge).not.toBeNull();
  });
});

describe("extractTopCoins", () => {
  it("returns coins sorted by |positionValue| descending", () => {
    const positions = [
      { position: { coin: "ETH", positionValue: "5000" } },
      { position: { coin: "BTC", positionValue: "20000" } },
      { position: { coin: "SOL", positionValue: "1000" } },
    ];
    expect(extractTopCoins(positions, 5)).toEqual(["BTC", "ETH", "SOL"]);
  });

  it("handles negative positionValue (short positions)", () => {
    const positions = [
      { position: { coin: "ETH", positionValue: "-8000" } },
      { position: { coin: "BTC", positionValue: "5000" } },
    ];
    expect(extractTopCoins(positions, 5)).toEqual(["ETH", "BTC"]);
  });

  it("caps at maxCoins", () => {
    const positions = Array.from({ length: 10 }, (_, i) => ({
      position: { coin: `COIN${i}`, positionValue: String((10 - i) * 1000) },
    }));
    expect(extractTopCoins(positions, 3)).toHaveLength(3);
  });

  it("returns empty array for empty positions", () => {
    expect(extractTopCoins([], 5)).toEqual([]);
  });

  it("skips entries missing coin or positionValue", () => {
    const positions = [
      { position: { coin: "BTC", positionValue: "10000" } },
      { position: { coin: "ETH" } },            // missing positionValue
      { position: { positionValue: "5000" } },  // missing coin
      {},                                         // missing position entirely
    ];
    expect(extractTopCoins(positions, 5)).toEqual(["BTC"]);
  });
});
