import { describe, it, expect } from "vitest";
import { computeExcursion, hitRateAtMultiple } from "../excursion";

const H = 3600_000;
const bar = (i: number, high: number, low: number, close: number) =>
  ({ t: i * H, h: String(high), l: String(low), c: String(close) });

describe("computeExcursion", () => {
  it("measures the best and worst the trade ever went, in ATR units", () => {
    // entry 100, atr 5. Best high 115 is +3 ATR, worst low 92 is -1.6 ATR.
    const e = computeExcursion({
      direction: "LONG", entryPrice: 100, atr: 5, entryMs: 0,
      bars: [bar(0, 108, 99, 104), bar(1, 115, 92, 96)],
    });
    expect(e?.mfe_atr).toBeCloseTo(3, 6);
    expect(e?.mae_atr).toBeCloseTo(1.6, 6);
  });

  it("inverts favourable and adverse for a SHORT", () => {
    // A SHORT profits as price falls, so the low is the favourable extreme.
    const e = computeExcursion({
      direction: "SHORT", entryPrice: 100, atr: 5, entryMs: 0,
      bars: [bar(0, 110, 85, 90)],
    });
    expect(e?.mfe_atr).toBeCloseTo(3, 6);
    expect(e?.mae_atr).toBeCloseTo(2, 6);
  });

  it("never reports a negative excursion when price only moved one way", () => {
    const e = computeExcursion({
      direction: "LONG", entryPrice: 100, atr: 5, entryMs: 0,
      bars: [bar(0, 110, 100, 108)],
    });
    expect(e?.mae_atr).toBe(0);
  });

  it("stops at the holding limit", () => {
    const e = computeExcursion({
      direction: "LONG", entryPrice: 100, atr: 5, entryMs: 0,
      bars: [bar(0, 105, 99, 104), bar(1, 106, 98, 100), bar(2, 200, 10, 150)],
      maxHoldHours: 2,
    });
    expect(e?.mfe_atr).toBeCloseTo(1.2, 6);
  });

  it("returns null when no bar covers the window", () => {
    expect(computeExcursion({
      direction: "LONG", entryPrice: 100, atr: 5, entryMs: 10 * H,
      bars: [bar(0, 105, 99, 104)],
    })).toBeNull();
  });

  it("returns null for a nonsensical ATR", () => {
    expect(computeExcursion({
      direction: "LONG", entryPrice: 100, atr: 0, entryMs: 0,
      bars: [bar(0, 105, 99, 104)],
    })).toBeNull();
  });
});

describe("hitRateAtMultiple", () => {
  const excursions = [
    { mfe_atr: 0.5, mae_atr: 0.2 },
    { mfe_atr: 1.5, mae_atr: 0.9 },
    { mfe_atr: 3.2, mae_atr: 2.4 },
    { mfe_atr: 2.1, mae_atr: 1.1 },
  ];

  it("reports the share of trades that reached a given favourable multiple", () => {
    expect(hitRateAtMultiple(excursions, 1.5)).toBeCloseTo(0.75, 6);
    expect(hitRateAtMultiple(excursions, 3.0)).toBeCloseTo(0.25, 6);
  });

  it("reports zero when nothing reached the multiple", () => {
    expect(hitRateAtMultiple(excursions, 10)).toBe(0);
  });

  it("returns null for an empty sample rather than a misleading zero", () => {
    expect(hitRateAtMultiple([], 1)).toBeNull();
  });
});
