import { describe, it, expect } from "vitest";
import { getCoinTier, tieredNotional } from "../token-tiers";

describe("getCoinTier", () => {
  it("returns MAJOR for BTC", () => expect(getCoinTier("BTC")).toBe("MAJOR"));
  it("returns MAJOR for ETH", () => expect(getCoinTier("ETH")).toBe("MAJOR"));
  it("returns LARGE for SOL", () => expect(getCoinTier("SOL")).toBe("LARGE"));
  it("returns LARGE for HYPE", () => expect(getCoinTier("HYPE")).toBe("LARGE"));
  it("returns LARGE for ARB", () => expect(getCoinTier("ARB")).toBe("LARGE"));
  it("returns LARGE for AVAX", () => expect(getCoinTier("AVAX")).toBe("LARGE"));
  it("returns LARGE for DOGE", () => expect(getCoinTier("DOGE")).toBe("LARGE"));
  it("returns LARGE for SUI", () => expect(getCoinTier("SUI")).toBe("LARGE"));
  it("returns SMALL for unknown coin", () => expect(getCoinTier("PEPE")).toBe("SMALL"));
  it("returns SMALL for WIF", () => expect(getCoinTier("WIF")).toBe("SMALL"));
});

describe("tieredNotional", () => {
  it("returns base for MAJOR coins", () => {
    expect(tieredNotional(500_000, "BTC")).toBe(500_000);
    expect(tieredNotional(500_000, "ETH")).toBe(500_000);
  });
  it("returns 50% of base for LARGE coins", () => {
    expect(tieredNotional(500_000, "SOL")).toBe(250_000);
    expect(tieredNotional(500_000, "HYPE")).toBe(250_000);
  });
  it("returns 20% of base for SMALL coins", () => {
    expect(tieredNotional(500_000, "PEPE")).toBe(100_000);
    expect(tieredNotional(500_000, "WIF")).toBe(100_000);
  });
  it("respects custom largeMult", () => {
    expect(tieredNotional(500_000, "SOL", 0.4, 0.1)).toBe(200_000);
  });
  it("respects custom smallMult", () => {
    expect(tieredNotional(500_000, "WIF", 0.4, 0.1)).toBe(50_000);
  });
  it("MAJOR coins ignore multiplier overrides", () => {
    expect(tieredNotional(1_000_000, "BTC", 0.1, 0.1)).toBe(1_000_000);
  });
});
