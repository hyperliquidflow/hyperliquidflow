// lib/__tests__/outcome-helpers.test.ts
import { describe, it, expect } from "vitest";
import { computeOutcome, computeMovePct, buildOutcomeRows } from "../outcome-helpers";

describe("computeOutcome", () => {
  it("returns true for LONG when price rose", () => {
    expect(computeOutcome("LONG", 100, 101)).toBe(true);
  });
  it("returns false for LONG when price fell", () => {
    expect(computeOutcome("LONG", 100, 99)).toBe(false);
  });
  it("returns true for SHORT when price fell", () => {
    expect(computeOutcome("SHORT", 100, 99)).toBe(true);
  });
  it("returns false for SHORT when price rose", () => {
    expect(computeOutcome("SHORT", 100, 101)).toBe(false);
  });
  it("returns null for FLAT direction", () => {
    expect(computeOutcome("FLAT", 100, 110)).toBe(null);
  });
  it("returns null for null direction", () => {
    expect(computeOutcome(null, 100, 110)).toBe(null);
  });
  it("returns false for LONG when price unchanged", () => {
    expect(computeOutcome("LONG", 100, 100)).toBe(false);
  });
});

describe("computeMovePct", () => {
  it("returns positive % when price rose", () => {
    expect(computeMovePct(100, 102)).toBeCloseTo(2.0);
  });
  it("returns negative % when price fell", () => {
    expect(computeMovePct(100, 95)).toBeCloseTo(-5.0);
  });
  it("returns 0 when price unchanged", () => {
    expect(computeMovePct(100, 100)).toBe(0);
  });
  it("handles fractional prices", () => {
    expect(computeMovePct(0.5, 0.55)).toBeCloseTo(10.0);
  });
});

describe("buildOutcomeRows", () => {
  it("builds one row per inserted signal using the signal id and allMids price", () => {
    const inserted = [
      { id: "uuid-1", recipe_id: "momentum_stack", coin: "BTC", direction: "LONG" },
      { id: "uuid-2", recipe_id: "funding_trend",  coin: "ETH", direction: "SHORT" },
    ];
    const allMids: Record<string, string> = { BTC: "65000", ETH: "3200" };
    const rows = buildOutcomeRows(inserted, allMids);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      signal_id:       "uuid-1",
      recipe_id:       "momentum_stack",
      coin:            "BTC",
      direction:       "LONG",
      price_at_signal: 65000,
    });
    expect(rows[1].price_at_signal).toBe(3200);
  });

  it("skips rows where the coin is missing from allMids", () => {
    const inserted = [
      { id: "uuid-1", recipe_id: "r1", coin: "UNKNOWN", direction: "LONG" },
    ];
    const rows = buildOutcomeRows(inserted, {});
    expect(rows).toHaveLength(0);
  });

  it("includes rows with null direction", () => {
    const inserted = [
      { id: "uuid-1", recipe_id: "r1", coin: "BTC", direction: null },
    ];
    const rows = buildOutcomeRows(inserted, { BTC: "50000" });
    expect(rows).toHaveLength(1);
    expect(rows[0].direction).toBe(null);
  });
});
