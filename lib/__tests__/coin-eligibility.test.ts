import { describe, it, expect } from "vitest";
import { grossNotionalByCoin, eligibleCoins } from "../coin-eligibility";

describe("grossNotionalByCoin", () => {
  it("adds long and short exposure together rather than netting them out", () => {
    // A coin the cohort is split on still carries real conviction. Netting the
    // sides would report near zero and hide it.
    const gross = grossNotionalByCoin([
      { coin: "BTC", szi:  2, positionValue: 500_000 },
      { coin: "BTC", szi: -2, positionValue: 400_000 },
    ]);
    expect(gross.get("BTC")).toBe(900_000);
  });

  it("sums exposure across separate coins", () => {
    const gross = grossNotionalByCoin([
      { coin: "BTC",  szi: 1, positionValue: 100 },
      { coin: "KAITO", szi: 1, positionValue: 5 },
    ]);
    expect(gross.get("BTC")).toBe(100);
    expect(gross.get("KAITO")).toBe(5);
  });

  it("ignores positions with an unusable notional", () => {
    const gross = grossNotionalByCoin([
      { coin: "BTC", szi: 1, positionValue: Number.NaN },
      { coin: "BTC", szi: 1, positionValue: 100 },
    ]);
    expect(gross.get("BTC")).toBe(100);
  });
});

describe("eligibleCoins", () => {
  // Roughly the real cohort shape: two dominant majors, a mid tier, a long tail.
  const cohort = () => new Map([
    ["BTC",     999_000_000],
    ["ETH",     791_000_000],
    ["HYPE",    295_000_000],
    ["ZEC",     151_000_000],
    ["SOL",      49_000_000],
    ["KAITO",       800_000],
    ["CASHCAT",     120_000],
  ]);

  it("keeps the coins the cohort has real capital in", () => {
    const eligible = eligibleCoins(cohort(), { minShare: 0.01, minAbsolute: 1_000_000 });
    expect(eligible.has("BTC")).toBe(true);
    expect(eligible.has("ETH")).toBe(true);
    expect(eligible.has("HYPE")).toBe(true);
    expect(eligible.has("ZEC")).toBe(true);
  });

  it("drops the long tail the cohort barely touches", () => {
    // KAITO produced 88.6% of all recorded outcomes while holding under 0.1%
    // of cohort capital. That inversion is what this gate exists to stop.
    const eligible = eligibleCoins(cohort(), { minShare: 0.01, minAbsolute: 1_000_000 });
    expect(eligible.has("KAITO")).toBe(false);
    expect(eligible.has("CASHCAT")).toBe(false);
  });

  it("drops a coin that clears the share floor but not the absolute floor", () => {
    // A shrunken cohort can make a trivial position look like a big share.
    const tiny = new Map([["BTC", 9_000], ["DOGE", 1_000]]);
    const eligible = eligibleCoins(tiny, { minShare: 0.01, minAbsolute: 1_000_000 });
    expect(eligible.size).toBe(0);
  });

  it("returns nothing when the cohort holds nothing", () => {
    expect(eligibleCoins(new Map(), { minShare: 0.01, minAbsolute: 1_000_000 }).size).toBe(0);
  });

  it("does not divide by zero when every position is worthless", () => {
    const zeroed = new Map([["BTC", 0], ["ETH", 0]]);
    expect(eligibleCoins(zeroed, { minShare: 0.01, minAbsolute: 1 }).size).toBe(0);
  });
});
