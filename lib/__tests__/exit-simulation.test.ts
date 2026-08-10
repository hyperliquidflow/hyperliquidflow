import { describe, it, expect } from "vitest";
import {
  simulateExitFromCandles,
  slippageBpsForCoin,
  computeRecipeNetStats,
  type ExitBar,
} from "../signal-learning-utils";

const HOUR = 3600_000;

// entry 100 with atr 5 gives: LONG stop 90, LONG target 115.
function bar(hourIndex: number, high: number, low: number, close: number): ExitBar {
  return { t: hourIndex * HOUR, h: String(high), l: String(low), c: String(close) };
}

describe("simulateExitFromCandles", () => {
  it("exits at the stop when a later bar breaches it", () => {
    // Regression: the first bar closes green, so a snapshot-only simulator
    // recorded a +300 bps time exit and never looked at the bar that stopped out.
    const result = simulateExitFromCandles({
      direction:  "LONG",
      entryPrice: 100,
      atr:        5,
      entryMs:    0,
      bars:       [bar(0, 104, 99, 103), bar(1, 103, 88, 89)],
    });

    expect(result?.exit_reason).toBe("stop");
    expect(result?.exit_price).toBe(90);
    expect(result?.gross_pnl_bps).toBe(-1000);
    expect(result?.is_win).toBe(false);
  });

  it("exits at the target when a bar reaches it", () => {
    const result = simulateExitFromCandles({
      direction:  "LONG",
      entryPrice: 100,
      atr:        5,
      entryMs:    0,
      bars:       [bar(0, 104, 99, 103), bar(1, 116, 102, 114)],
    });

    expect(result?.exit_reason).toBe("target");
    expect(result?.exit_price).toBe(115);
    expect(result?.gross_pnl_bps).toBe(1500);
  });

  it("resolves a bar containing both levels as a stop", () => {
    // Intrabar order is unknowable from OHLC, so assume the adverse fill.
    const result = simulateExitFromCandles({
      direction:  "LONG",
      entryPrice: 100,
      atr:        5,
      entryMs:    0,
      bars:       [bar(0, 116, 88, 100)],
    });

    expect(result?.exit_reason).toBe("stop");
    expect(result?.exit_price).toBe(90);
  });

  it("exits at the last bar close when neither level is reached", () => {
    const result = simulateExitFromCandles({
      direction:  "LONG",
      entryPrice: 100,
      atr:        5,
      entryMs:    0,
      bars:       [bar(0, 104, 99, 103), bar(1, 105, 98, 102)],
    });

    expect(result?.exit_reason).toBe("time");
    expect(result?.exit_price).toBe(102);
    expect(result?.gross_pnl_bps).toBe(200);
  });

  it("mirrors stop and target for SHORT", () => {
    // SHORT entry 100, atr 5: stop 110, target 85.
    const result = simulateExitFromCandles({
      direction:  "SHORT",
      entryPrice: 100,
      atr:        5,
      entryMs:    0,
      bars:       [bar(0, 102, 84, 86)],
    });

    expect(result?.exit_reason).toBe("target");
    expect(result?.exit_price).toBe(85);
    expect(result?.gross_pnl_bps).toBe(1500);
  });

  it("ignores bars that close before the signal fired", () => {
    const result = simulateExitFromCandles({
      direction:  "LONG",
      entryPrice: 100,
      atr:        5,
      entryMs:    2 * HOUR,
      bars:       [bar(0, 104, 80, 82), bar(1, 104, 80, 82), bar(2, 105, 98, 102)],
    });

    expect(result?.exit_reason).toBe("time");
    expect(result?.exit_price).toBe(102);
  });

  it("stops holding at maxHoldHours", () => {
    const bars = [bar(0, 104, 99, 103), bar(1, 105, 98, 102), bar(2, 104, 88, 89)];
    const result = simulateExitFromCandles({
      direction:    "LONG",
      entryPrice:   100,
      atr:          5,
      entryMs:      0,
      bars,
      maxHoldHours: 2,
    });

    expect(result?.exit_reason).toBe("time");
    expect(result?.exit_price).toBe(102);
    expect(result?.hold_hours).toBe(2);
  });

  it("subtracts fees, slippage and funding from gross to get net", () => {
    const result = simulateExitFromCandles({
      direction:         "LONG",
      entryPrice:        100,
      atr:               5,
      entryMs:           0,
      bars:              [bar(0, 104, 99, 103), bar(1, 105, 98, 102)],
      feeBps:            9,
      slippageBps:       6,
      fundingBpsPerHour: 1,
    });

    // gross 200, fees 9, slippage 6, funding 1 bps/h over a 2h hold = 2
    expect(result?.gross_pnl_bps).toBe(200);
    expect(result?.cost_bps).toBe(17);
    expect(result?.net_pnl_bps).toBe(183);
  });

  it("credits funding to a SHORT when longs are paying", () => {
    const result = simulateExitFromCandles({
      direction:         "SHORT",
      entryPrice:        100,
      atr:               5,
      entryMs:           0,
      bars:              [bar(0, 101, 99, 99), bar(1, 101, 98, 99)],
      feeBps:            0,
      slippageBps:       0,
      fundingBpsPerHour: 1,
    });

    // Positive funding means longs pay shorts, so a 2h SHORT earns 2 bps back.
    expect(result?.cost_bps).toBe(-2);
    expect(result?.net_pnl_bps).toBe(102);
  });

  it("measures R against net PnL, not gross", () => {
    const result = simulateExitFromCandles({
      direction:   "LONG",
      entryPrice:  100,
      atr:         5,
      entryMs:     0,
      bars:        [bar(0, 116, 102, 114)],
      feeBps:      10,
      slippageBps: 0,
    });

    // 1R = 2*atr = 1000 bps. Net is 1500 - 10 = 1490, so R = 1.49.
    expect(result?.net_pnl_bps).toBe(1490);
    expect(result?.realized_r_multiple).toBe(1.49);
  });

  it("returns null when no bar covers the holding window", () => {
    const result = simulateExitFromCandles({
      direction:  "LONG",
      entryPrice: 100,
      atr:        5,
      entryMs:    10 * HOUR,
      bars:       [bar(0, 104, 99, 103)],
    });

    expect(result).toBeNull();
  });
});

describe("slippageBpsForCoin", () => {
  it("charges the least on majors and the most on illiquid names", () => {
    expect(slippageBpsForCoin("BTC")).toBeLessThan(slippageBpsForCoin("SOL"));
    expect(slippageBpsForCoin("SOL")).toBeLessThan(slippageBpsForCoin("CASHCAT"));
  });

  it("charges a real cost on every tier", () => {
    for (const coin of ["BTC", "SOL", "CASHCAT"]) {
      expect(slippageBpsForCoin(coin)).toBeGreaterThan(0);
    }
  });
});

describe("simulateExitFromCandles hold_hours", () => {
  it("counts whole bars held when the signal fires mid-bar", () => {
    // Signals fire whenever the cohort moves, not on the hour, so an elapsed
    // clock measurement yields fractions that cannot be stored as bar counts.
    const result = simulateExitFromCandles({
      direction:  "LONG",
      entryPrice: 100,
      atr:        5,
      entryMs:    0.5 * HOUR,
      bars:       [bar(0, 104, 99, 103), bar(1, 105, 98, 102), bar(2, 105, 98, 101)],
    });

    expect(result?.hold_hours).toBe(2);
    expect(Number.isInteger(result?.hold_hours)).toBe(true);
  });
});

describe("computeRecipeNetStats", () => {
  const row = (net: number, win: boolean) => ({ net_pnl_bps: net, is_win: win });

  it("withholds headline stats below the minimum sample", () => {
    const stats = computeRecipeNetStats([row(100, true), row(-50, false)]);

    expect(stats.sample_size_60d).toBe(2);
    expect(stats.expectancy_bps_net).toBeNull();
    expect(stats.win_rate_net).toBeNull();
    expect(stats.median_net_pnl_bps).toBeNull();
  });

  it("reports headline stats once the sample clears the minimum", () => {
    const rows = Array.from({ length: 30 }, (_, i) => row(i < 15 ? 100 : -50, i < 15));
    const stats = computeRecipeNetStats(rows);

    expect(stats.sample_size_60d).toBe(30);
    expect(stats.expectancy_bps_net).toBe(25);
    expect(stats.win_rate_net).toBe(0.5);
  });

  it("reports a zero sample as null rather than zero", () => {
    const stats = computeRecipeNetStats([]);
    expect(stats.sample_size_60d).toBeNull();
    expect(stats.expectancy_bps_net).toBeNull();
  });
});
