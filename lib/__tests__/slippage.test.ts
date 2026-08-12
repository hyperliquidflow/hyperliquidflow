import { describe as suite, it, expect } from "vitest";
import { walkBook, roundTripCostBps, type BookLevel } from "@/lib/slippage";

// Asks ascend from the mid, bids descend from it.
const asks: BookLevel[] = [
  { px: 100.0, sz: 10 },   // $1,000
  { px: 101.0, sz: 10 },   // $1,010
  { px: 110.0, sz: 10 },   // $1,100
];
const bids: BookLevel[] = [
  { px: 100.0, sz: 10 },
  { px: 99.0, sz: 10 },
  { px: 90.0, sz: 10 },
];

suite("walkBook", () => {
  it("fills entirely at the top level when the order is small", () => {
    const r = walkBook(asks, 500, 100, "buy")!;
    expect(r.avgPx).toBeCloseTo(100, 9);
    expect(r.slippageBps).toBeCloseTo(0, 9);
    expect(r.exhausted).toBe(false);
  });

  it("prices deeper levels as size grows", () => {
    // $2,000: $1,000 at 100 and $1,000 at 101.
    const r = walkBook(asks, 2000, 100, "buy")!;
    expect(r.avgPx).toBeGreaterThan(100);
    expect(r.avgPx).toBeLessThan(101);
    expect(r.slippageBps).toBeGreaterThan(0);
  });

  it("charges more per unit as the order grows, which is the whole point", () => {
    const small = walkBook(asks, 500, 100, "buy")!;
    const large = walkBook(asks, 3000, 100, "buy")!;
    expect(large.slippageBps).toBeGreaterThan(small.slippageBps);
  });

  it("treats a sell below the mid as a cost, not a gain", () => {
    const r = walkBook(bids, 2000, 100, "sell")!;
    expect(r.slippageBps).toBeGreaterThan(0);
  });

  // Pricing the unfillable remainder at the last level would understate the
  // cost of size, which is the error this whole module exists to avoid.
  it("flags a book that runs out instead of pretending the rest filled", () => {
    const r = walkBook(asks, 1_000_000, 100, "buy")!;
    expect(r.exhausted).toBe(true);
    expect(r.filledUsd).toBeCloseTo(1000 + 1010 + 1100, 6);
  });

  it("skips malformed levels rather than producing NaN", () => {
    const messy: BookLevel[] = [{ px: 0, sz: 5 }, { px: 100, sz: 0 }, { px: 100, sz: 10 }];
    const r = walkBook(messy, 500, 100, "buy")!;
    expect(Number.isFinite(r.avgPx)).toBe(true);
    expect(r.avgPx).toBeCloseTo(100, 9);
  });

  it("returns null on an empty book or a nonsense request", () => {
    expect(walkBook([], 100, 100, "buy")).toBeNull();
    expect(walkBook(asks, 0, 100, "buy")).toBeNull();
    expect(walkBook(asks, 100, 0, "buy")).toBeNull();
  });
});

suite("roundTripCostBps", () => {
  it("adds both crossings and both fees", () => {
    const r = roundTripCostBps(bids, asks, 500, 100, 4.5)!;
    // Both legs fill at the touch, so the cost is the two fees alone.
    expect(r.totalBps).toBeCloseTo(9, 6);
    expect(r.exhausted).toBe(false);
  });

  it("grows with size as both legs reach deeper", () => {
    const small = roundTripCostBps(bids, asks, 500, 100, 4.5)!;
    const large = roundTripCostBps(bids, asks, 2500, 100, 4.5)!;
    expect(large.totalBps).toBeGreaterThan(small.totalBps);
  });

  it("propagates exhaustion from either leg", () => {
    const r = roundTripCostBps(bids, asks, 1_000_000, 100, 4.5)!;
    expect(r.exhausted).toBe(true);
  });
});
