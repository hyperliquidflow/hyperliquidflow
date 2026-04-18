import { describe, it, expect } from "vitest";
import {
  isSnapshotFresh,
  failsEquityGate,
  failsLiqBufferGate,
  failsDrawdownGate,
  nextGraceCycles,
} from "../cohort-hygiene";

const NOW = 1_000_000_000_000; // fixed reference ms
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;

describe("isSnapshotFresh", () => {
  it("returns true at exactly 30 min", () => {
    expect(isSnapshotFresh(ago(30 * MIN), NOW)).toBe(true);
  });
  it("returns false at 31 min", () => {
    expect(isSnapshotFresh(ago(31 * MIN), NOW)).toBe(false);
  });
  it("returns true at 0 ms", () => {
    expect(isSnapshotFresh(ago(0), NOW)).toBe(true);
  });
  it("respects custom maxAgeMs", () => {
    expect(isSnapshotFresh(ago(5 * MIN), NOW, 4 * MIN)).toBe(false);
    expect(isSnapshotFresh(ago(5 * MIN), NOW, 6 * MIN)).toBe(true);
  });
});

describe("failsEquityGate", () => {
  it("fails below floor", () => {
    expect(failsEquityGate(9_999)).toBe(true);
  });
  it("passes at exactly floor", () => {
    expect(failsEquityGate(10_000)).toBe(false);
  });
  it("passes above floor", () => {
    expect(failsEquityGate(10_001)).toBe(false);
  });
  it("respects custom floor", () => {
    expect(failsEquityGate(500, 1_000)).toBe(true);
    expect(failsEquityGate(1_000, 1_000)).toBe(false);
  });
});

describe("failsLiqBufferGate", () => {
  it("fails when buffer below min and positions open", () => {
    expect(failsLiqBufferGate(0.04, 2)).toBe(true);
  });
  it("passes when buffer at exactly min", () => {
    expect(failsLiqBufferGate(0.05, 2)).toBe(false);
  });
  it("passes when no positions even if buffer is low", () => {
    expect(failsLiqBufferGate(0.01, 0)).toBe(false);
  });
  it("passes when buffer is null (no margin info)", () => {
    expect(failsLiqBufferGate(null, 3)).toBe(false);
  });
  it("passes when buffer is fine", () => {
    expect(failsLiqBufferGate(0.5, 5)).toBe(false);
  });
});

describe("failsDrawdownGate", () => {
  it("returns false when fewer than minSnapshots", () => {
    expect(failsDrawdownGate([100, 50])).toBe(false);
  });
  it("returns false at exactly minSnapshots with no drawdown", () => {
    expect(failsDrawdownGate([100, 110, 120])).toBe(false);
  });
  it("returns false at 50% drawdown (boundary, not exceeded)", () => {
    expect(failsDrawdownGate([100, 100, 50])).toBe(false);
  });
  it("returns true above 50% drawdown", () => {
    expect(failsDrawdownGate([100, 100, 49])).toBe(true);
  });
  it("detects drawdown from intermediate peak", () => {
    // peak = 200, current = 80 => 60% drawdown
    expect(failsDrawdownGate([100, 200, 80])).toBe(true);
  });
  it("returns false for flat series", () => {
    expect(failsDrawdownGate([100, 100, 100, 100])).toBe(false);
  });
  it("respects custom threshold", () => {
    expect(failsDrawdownGate([100, 100, 70], 0.30, 3)).toBe(true);
    expect(failsDrawdownGate([100, 100, 70], 0.31, 3)).toBe(false);
  });
});

describe("nextGraceCycles", () => {
  it("holds counter when snapshot is stale", () => {
    expect(nextGraceCycles(2, true, false, 3)).toEqual({ next: 2, deactivate: false });
  });
  it("holds counter when stale and passing", () => {
    expect(nextGraceCycles(1, false, false, 3)).toEqual({ next: 1, deactivate: false });
  });
  it("resets to 0 when fresh and passing", () => {
    expect(nextGraceCycles(2, false, true, 3)).toEqual({ next: 0, deactivate: false });
  });
  it("increments when fresh and failing", () => {
    expect(nextGraceCycles(1, true, true, 3)).toEqual({ next: 2, deactivate: false });
  });
  it("deactivates when increment reaches threshold", () => {
    expect(nextGraceCycles(2, true, true, 3)).toEqual({ next: 3, deactivate: true });
  });
  it("deactivates immediately if already at threshold", () => {
    expect(nextGraceCycles(3, true, true, 3)).toEqual({ next: 4, deactivate: true });
  });
  it("respects threshold of 1 (deactivate on first fresh failure)", () => {
    expect(nextGraceCycles(0, true, true, 1)).toEqual({ next: 1, deactivate: true });
  });
});
