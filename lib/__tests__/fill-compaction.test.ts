import { describe as suite, it, expect } from "vitest";
import {
  compactFills,
  checkConservation,
  netSignedSize,
  totalPnl,
  type CompactableFill,
} from "@/lib/fill-compaction";

const HOUR = 3_600_000;
const f = (o: Partial<CompactableFill> & Pick<CompactableFill, "t">): CompactableFill => ({
  w: "a", c: "BTC", p: 100, s: 1, d: 1, o: 1, pnl: 0, ...o,
});

suite("compactFills", () => {
  it("merges fills of one wallet, coin, side and hour into a single row", () => {
    const out = compactFills([f({ t: 0 }), f({ t: 60_000 }), f({ t: 3_599_999 })]);
    expect(out).toHaveLength(1);
    expect(out[0].s).toBe(3);
  });

  it("keeps separate hours apart", () => {
    expect(compactFills([f({ t: 0 }), f({ t: HOUR })])).toHaveLength(2);
  });

  it("keeps opens and closes apart, since they move a position in opposite directions", () => {
    expect(compactFills([f({ t: 0, o: 1 }), f({ t: 60_000, o: 0 })])).toHaveLength(2);
  });

  it("keeps wallets, coins and directions apart", () => {
    const out = compactFills([
      f({ t: 0 }),
      f({ t: 0, w: "b" }),
      f({ t: 0, c: "ETH" }),
      f({ t: 0, d: -1 }),
    ]);
    expect(out).toHaveLength(4);
  });

  it("weights price by size", () => {
    const out = compactFills([f({ t: 0, p: 100, s: 9 }), f({ t: 60_000, p: 200, s: 1 })]);
    expect(out[0].p).toBeCloseTo(110, 9);
  });

  // A follower could have acted at the first fill, not at the hour boundary.
  it("stamps the bucket with its earliest fill", () => {
    const out = compactFills([f({ t: 2_000_000 }), f({ t: 500_000 })]);
    expect(out[0].t).toBe(500_000);
  });

  it("sums realised PnL across the bucket", () => {
    const out = compactFills([f({ t: 0, o: 0, pnl: 12.5 }), f({ t: 10, o: 0, pnl: -2.5 })]);
    expect(out[0].pnl).toBeCloseTo(10, 9);
  });

  it("returns rows in time order", () => {
    const out = compactFills([f({ t: 5 * HOUR }), f({ t: 0, c: "ETH" })]);
    expect(out.map((r) => r.t)).toEqual([0, 5 * HOUR]);
  });

  it("handles an empty input", () => {
    expect(compactFills([])).toEqual([]);
  });

  // The reason this module exists: a production-shaped firehose must collapse
  // hard enough that the cache stops bounding the study window.
  it("collapses a heavy intra-hour cluster to one row", () => {
    const fills = Array.from({ length: 500 }, (_, i) => f({ t: i * 1000, s: 2 }));
    const out = compactFills(fills);
    expect(out).toHaveLength(1);
    expect(out[0].s).toBe(1000);
  });
});

suite("checkConservation", () => {
  it("passes when compaction preserves position and PnL", () => {
    const before = [
      f({ t: 0, s: 3, o: 1, d: 1 }),
      f({ t: 60_000, s: 2, o: 0, d: 1, pnl: 7 }),
      f({ t: HOUR, s: 4, o: 1, d: -1 }),
    ];
    const check = checkConservation(before, compactFills(before));
    expect(check.ok).toBe(true);
    expect(check.sizeDrift).toBeLessThan(1e-9);
  });

  it("fails when a fill is lost", () => {
    const before = [f({ t: 0, s: 3 }), f({ t: HOUR, s: 5 })];
    const check = checkConservation(before, [before[0]]);
    expect(check.ok).toBe(false);
  });

  it("nets opens against closes when measuring position", () => {
    expect(netSignedSize([f({ t: 0, s: 5, o: 1, d: 1 }), f({ t: 0, s: 5, o: 0, d: 1 })])).toBe(0);
  });

  it("sums PnL across every row", () => {
    expect(totalPnl([f({ t: 0, pnl: 1.5 }), f({ t: 0, pnl: -0.5 })])).toBeCloseTo(1, 9);
  });
});
