import { describe, it, expect } from "vitest";
import { liquidationDistance } from "@/lib/risk-engine";

// Helper: build the position shape as it is stored in cohort_snapshots.positions
const pos = (opts: {
  coin?: string;
  szi: string;
  positionValue: string;
  liquidationPx: string | null;
}) => ({
  position: {
    coin: opts.coin ?? "BTC",
    szi: opts.szi,
    entryPx: "0",
    positionValue: opts.positionValue,
    unrealizedPnl: "0",
    returnOnEquity: "0",
    liquidationPx: opts.liquidationPx,
    leverage: { type: "cross" as const, value: 5 },
    cumFunding: { allTime: "0", sinceChange: "0", sinceOpen: "0" },
  },
  type: "oneWay" as const,
});

describe("liquidationDistance", () => {
  it("returns null when there are no positions", () => {
    expect(liquidationDistance([])).toBeNull();
  });

  it("returns null when no position carries a liquidation price", () => {
    expect(
      liquidationDistance([pos({ szi: "1", positionValue: "100000", liquidationPx: null })])
    ).toBeNull();
  });

  it("measures a long as the drop from mark to the liquidation price", () => {
    // mark = 100000 / 1 = 100000, liq at 80000 => 20% away
    const d = liquidationDistance([
      pos({ szi: "1", positionValue: "100000", liquidationPx: "80000" }),
    ]);
    expect(d).toBeCloseTo(0.2, 6);
  });

  it("measures a short as the rise from mark to the liquidation price", () => {
    // mark = 100000, short, liq above at 110000 => 10% away
    const d = liquidationDistance([
      pos({ szi: "-1", positionValue: "100000", liquidationPx: "110000" }),
    ]);
    expect(d).toBeCloseTo(0.1, 6);
  });

  it("takes the nearest position when several are open", () => {
    const d = liquidationDistance([
      pos({ coin: "BTC", szi: "1", positionValue: "100000", liquidationPx: "80000" }),
      pos({ coin: "ETH", szi: "10", positionValue: "30000", liquidationPx: "2910" }), // mark 3000, 3% away
    ]);
    expect(d).toBeCloseTo(0.03, 6);
  });

  it("ignores positions with unusable data but keeps the rest", () => {
    const d = liquidationDistance([
      pos({ coin: "BTC", szi: "0", positionValue: "0", liquidationPx: "80000" }),
      pos({ coin: "ETH", szi: "10", positionValue: "30000", liquidationPx: "2700" }), // 10%
    ]);
    expect(d).toBeCloseTo(0.1, 6);
  });

  it("is 0 when mark has already reached the liquidation price", () => {
    const d = liquidationDistance([
      pos({ szi: "1", positionValue: "100000", liquidationPx: "100000" }),
    ]);
    expect(d).toBe(0);
  });

  // This is the case the old free-margin proxy got wrong. A wallet that has
  // deployed nearly all of its equity as margin scores ~0 on the proxy while
  // sitting a long way from liquidation, because margin used is a statement
  // about leverage, not about price distance.
  it("reports a fully deployed wallet as far from liquidation", () => {
    const d = liquidationDistance([
      pos({ szi: "1", positionValue: "84019", liquidationPx: "65000" }),
    ]);
    expect(d).toBeGreaterThan(0.2);
  });

  it("accepts bare position objects as well as the assetPosition wrapper", () => {
    const d = liquidationDistance([
      { szi: "1", positionValue: "100000", liquidationPx: "90000" },
    ]);
    expect(d).toBeCloseTo(0.1, 6);
  });
});
