import { describe as suite, it, expect } from "vitest";
import { reconstructDailyLean, leanEpoch, DAY_MS, type LeanFill } from "@/lib/cohort-lean";

const f = (o: Partial<LeanFill> & Pick<LeanFill, "t">): LeanFill => ({
  w: "a", c: "BTC", s: 1, d: 1, o: 1, ...o,
});
/** Flat price of 100 for every coin at every time. */
const flat = () => 100;

suite("reconstructDailyLean", () => {
  it("values an open position at the day boundary", () => {
    const days = reconstructDailyLean([f({ t: 0, s: 3 })], flat);
    expect(days[0].get("BTC")).toBeCloseTo(300, 9);
  });

  it("carries a position forward across days until it is closed", () => {
    const days = reconstructDailyLean(
      [f({ t: 0, s: 2 }), f({ t: 3 * DAY_MS, s: 2, o: 0 })],
      flat,
    );
    expect(days[0].get("BTC")).toBeCloseTo(200, 9);
    expect(days[1].get("BTC")).toBeCloseTo(200, 9);
    expect(days[3].has("BTC")).toBe(false);   // closed before this boundary
  });

  it("signs a short position negative", () => {
    const days = reconstructDailyLean([f({ t: 0, s: 2, d: -1 })], flat);
    expect(days[0].get("BTC")).toBeCloseTo(-200, 9);
  });

  it("nets opposing wallets into one cohort lean", () => {
    const days = reconstructDailyLean(
      [f({ t: 0, w: "a", s: 3 }), f({ t: 0, w: "b", s: 1, d: -1 })],
      flat,
    );
    expect(days[0].get("BTC")).toBeCloseTo(200, 9);
  });

  // Wallets that cancel each other leave the coin present at a net of zero.
  // The dust filter here is per wallet, so a flat cohort lean is a real
  // measurement of indifference rather than an absence, and callers drop it on
  // magnitude. Asserted so the boundary between the two stays deliberate.
  it("reports a cancelled cohort lean as zero rather than removing the coin", () => {
    const days = reconstructDailyLean(
      [f({ t: 0, w: "a", s: 2 }), f({ t: 0, w: "b", s: 2, d: -1 })],
      flat,
    );
    expect(days[0].get("BTC")).toBeCloseTo(0, 9);
  });

  it("drops a coin only when the wallet itself is flat", () => {
    const days = reconstructDailyLean(
      [f({ t: 0, w: "a", s: 2 }), f({ t: 1000, w: "a", s: 2, o: 0 })],
      flat,
    );
    expect(days[0].has("BTC")).toBe(false);
  });

  it("keeps coins separate", () => {
    const days = reconstructDailyLean(
      [f({ t: 0, c: "BTC", s: 1 }), f({ t: 0, c: "ETH", s: 5 })],
      flat,
    );
    expect(days[0].get("BTC")).toBeCloseTo(100, 9);
    expect(days[0].get("ETH")).toBeCloseTo(500, 9);
  });

  it("omits a coin with no price rather than valuing it at zero", () => {
    const days = reconstructDailyLean([f({ t: 0 })], () => null);
    expect(days[0].size).toBe(0);
  });

  // The known limitation, asserted so it stays known: a wallet that was
  // already long before the window closes into a phantom short.
  it("shows the phantom short a mid-window close produces, which burn-in exists to absorb", () => {
    const days = reconstructDailyLean([f({ t: 0, s: 4, o: 0 })], flat);
    expect(days[0].get("BTC")).toBeCloseTo(-400, 9);
  });

  it("handles an empty input", () => {
    expect(reconstructDailyLean([], flat)).toEqual([]);
    expect(leanEpoch([])).toBeNull();
  });

  it("anchors day boundaries on the first fill", () => {
    expect(leanEpoch([f({ t: 500 }), f({ t: 100 })])).toBe(100);
  });
});
