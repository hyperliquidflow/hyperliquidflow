import { describe, it, expect } from "vitest";
import { getEquityTier } from "../cohort-engine";

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
