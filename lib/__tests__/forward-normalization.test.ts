import { describe, it, expect } from "vitest";
import { normalizedForwardPerformance } from "@/lib/skill-test";

describe("normalizedForwardPerformance", () => {
  // The defect this exists to remove: the forward variable was a raw dollar
  // sum, so a large account outranked a small one at identical skill. The
  // score side was already scale free, which made the correlation a hybrid of
  // a scale-free predictor against a scale-dependent outcome.
  it("gives two wallets of identical shape but different size the same value", () => {
    const small = normalizedForwardPerformance([1, -1, 2, -2, 3], [1, 2, 3]);
    const large = normalizedForwardPerformance([100, -100, 200, -200, 300], [100, 200, 300]);
    expect(small).not.toBeNull();
    expect(large).toBeCloseTo(small!, 10);
  });

  it("ranks a better forward run above a worse one at equal risk", () => {
    const train = [1, -1, 2, -2, 3];
    const good = normalizedForwardPerformance(train, [3, 3, 3]);
    const bad  = normalizedForwardPerformance(train, [-3, -3, -3]);
    expect(good!).toBeGreaterThan(bad!);
  });

  it("normalizes by the train half only, so the test half cannot leak into its own scale", () => {
    const train = [1, -1, 2, -2, 3];
    // Same forward mean, wildly different forward volatility. A test-half
    // normalizer would rank these differently; a train-half one must not.
    const steady   = normalizedForwardPerformance(train, [2, 2, 2]);
    const volatile = normalizedForwardPerformance(train, [-8, 2, 12]);
    expect(steady).toBeCloseTo(volatile!, 10);
  });

  it("returns null when the train half has no variation to normalize by", () => {
    expect(normalizedForwardPerformance([5, 5, 5, 5], [1, 2, 3])).toBeNull();
  });

  it("returns null on an empty test half", () => {
    expect(normalizedForwardPerformance([1, -1, 2], [])).toBeNull();
  });

  it("is negative when the forward half loses", () => {
    const v = normalizedForwardPerformance([1, -1, 2, -2], [-5, -5]);
    expect(v!).toBeLessThan(0);
  });

  it("expresses the result in train-half daily risk units", () => {
    // train sd of [2,-2,2,-2] is 2. Forward mean of [4,4] is 4. So 4/2 = 2.
    expect(normalizedForwardPerformance([2, -2, 2, -2], [4, 4])).toBeCloseTo(2, 10);
  });
});
