import { describe, it, expect } from "vitest";
import {
  computeWalletRegimeFit,
  computeSignalRegimeFit,
  regimeFitLabel,
} from "../signal-validation";

describe("computeWalletRegimeFit", () => {
  it("returns 1.0 for a wallet's best regime", () => {
    // BULL=100 is best, BEAR=-20 is worst
    expect(computeWalletRegimeFit(100, -20, 40, "BULL")).toBeCloseTo(1.0);
  });

  it("returns 0.0 for a wallet's worst regime", () => {
    expect(computeWalletRegimeFit(100, -20, 40, "BEAR")).toBeCloseTo(0.0);
  });

  it("returns intermediate value for middle regime", () => {
    // best=100, worst=-20, range=120; RANGING=40 -> (40 - (-20)) / 120 = 0.5
    expect(computeWalletRegimeFit(100, -20, 40, "RANGING")).toBeCloseTo(0.5);
  });

  it("returns 0.5 when all regimes are equal (no differentiation)", () => {
    expect(computeWalletRegimeFit(50, 50, 50, "BULL")).toBe(0.5);
    expect(computeWalletRegimeFit(50, 50, 50, "BEAR")).toBe(0.5);
  });

  it("returns null when all pnl values are null", () => {
    expect(computeWalletRegimeFit(null, null, null, "BULL")).toBeNull();
  });

  it("handles partial null pnl values -- uses only non-null for range", () => {
    // BULL=100, BEAR=null, RANGING=20; available=[100,20], best=100, worst=20
    // current=BULL(100) -> (100-20)/(100-20) = 1.0
    expect(computeWalletRegimeFit(100, null, 20, "BULL")).toBeCloseTo(1.0);
    // current=RANGING(20) -> (20-20)/(100-20) = 0.0
    expect(computeWalletRegimeFit(100, null, 20, "RANGING")).toBeCloseTo(0.0);
  });

  it("treats null current regime pnl as worst case", () => {
    // BULL=100, BEAR=null (regime being tested), RANGING=20
    // available non-null: [100, 20]; best=100, worst=20; current=null -> worst=20
    // fit = (20-20)/(100-20) = 0.0
    expect(computeWalletRegimeFit(100, null, 20, "BEAR")).toBeCloseTo(0.0);
  });

  it("clamps to [0, 1] for edge cases", () => {
    const fit = computeWalletRegimeFit(100, 50, 80, "BULL");
    expect(fit).toBeGreaterThanOrEqual(0);
    expect(fit).toBeLessThanOrEqual(1);
  });

  it("works with all negative pnls -- worst performer gets 0", () => {
    // BULL=-10, BEAR=-50, RANGING=-30; best=-10, worst=-50, range=40
    // BEAR: (-50 - (-50)) / 40 = 0.0
    expect(computeWalletRegimeFit(-10, -50, -30, "BEAR")).toBeCloseTo(0.0);
    // BULL: (-10 - (-50)) / 40 = 1.0
    expect(computeWalletRegimeFit(-10, -50, -30, "BULL")).toBeCloseTo(1.0);
  });
});

describe("computeSignalRegimeFit", () => {
  it("returns null for empty list", () => {
    expect(computeSignalRegimeFit([])).toBeNull();
  });

  it("returns null when all values are null", () => {
    expect(computeSignalRegimeFit([null, null, null])).toBeNull();
  });

  it("returns mean of non-null values", () => {
    expect(computeSignalRegimeFit([1.0, 0.0, null])).toBeCloseTo(0.5);
    expect(computeSignalRegimeFit([0.8, 0.6, 0.4])).toBeCloseTo(0.6);
  });

  it("returns single value unchanged", () => {
    expect(computeSignalRegimeFit([0.75])).toBeCloseTo(0.75);
  });
});

describe("regimeFitLabel", () => {
  it("returns null for null input", () => {
    expect(regimeFitLabel(null)).toBeNull();
  });

  it("returns HIGH for >= 0.67", () => {
    expect(regimeFitLabel(0.67)).toBe("HIGH");
    expect(regimeFitLabel(1.0)).toBe("HIGH");
    expect(regimeFitLabel(0.8)).toBe("HIGH");
  });

  it("returns MID for 0.33 to 0.66", () => {
    expect(regimeFitLabel(0.33)).toBe("MID");
    expect(regimeFitLabel(0.5)).toBe("MID");
    expect(regimeFitLabel(0.66)).toBe("MID");
  });

  it("returns LOW for < 0.33", () => {
    expect(regimeFitLabel(0.0)).toBe("LOW");
    expect(regimeFitLabel(0.32)).toBe("LOW");
  });
});
