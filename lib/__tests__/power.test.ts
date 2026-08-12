import { describe as suite, it, expect } from "vitest";
import {
  dailySharpe,
  expectedT,
  normalCdf,
  inverseNormalCdf,
  powerAtBar,
  daysForPower,
  barForPower,
} from "@/lib/power";

suite("normalCdf and its inverse", () => {
  it("matches known quantiles", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
  });

  it("inverts itself", () => {
    for (const p of [0.05, 0.2, 0.5, 0.8, 0.975]) {
      expect(normalCdf(inverseNormalCdf(p))).toBeCloseTo(p, 4);
    }
  });

  it("returns the standard 80% power z", () => {
    expect(inverseNormalCdf(0.8)).toBeCloseTo(0.8416, 3);
  });
});

suite("expectedT", () => {
  it("scales with the square root of time", () => {
    // An effect observed at t 2 over 100 days should read t 4 over 400.
    expect(expectedT(2, 100, 400)).toBeCloseTo(4, 9);
  });

  it("shrinks over a shorter window", () => {
    expect(expectedT(2, 100, 25)).toBeCloseTo(1, 9);
  });

  it("reports the daily Sharpe behind it", () => {
    expect(dailySharpe(2, 100)).toBeCloseTo(0.2, 9);
  });
});

suite("powerAtBar", () => {
  // The finding that prompted this module: the traded positioning factor reads
  // t 1.42 over 104 days, so a 60-day forward gate cannot confirm it.
  it("shows the traded factor's 60-day gate is a coin flip at best", () => {
    const p = powerAtBar(1.42, 104, 60, 1.5);
    expect(p).toBeGreaterThan(0.25);
    expect(p).toBeLessThan(0.45);
  });

  it("shows a t 2.5 bar at 60 days is near hopeless for that effect", () => {
    expect(powerAtBar(1.42, 104, 60, 2.5)).toBeLessThan(0.1);
  });

  // The diagnostic IC is a different and much stronger measurement.
  it("shows the diagnostic IC can carry a real bar at 60 days", () => {
    expect(powerAtBar(3.17, 104, 60, 1.5)).toBeGreaterThan(0.8);
  });

  it("is monotone in time", () => {
    const a = powerAtBar(1.42, 104, 60, 1.5);
    const b = powerAtBar(1.42, 104, 300, 1.5);
    expect(b).toBeGreaterThan(a);
  });
});

suite("daysForPower", () => {
  it("prices the horizon the traded factor actually needs", () => {
    const d = daysForPower(1.42, 104, 2.0, 0.8);
    expect(d).toBeGreaterThan(300);
    expect(d).toBeLessThan(500);
  });

  it("needs less time for a stronger effect", () => {
    expect(daysForPower(3.17, 104, 2.0)).toBeLessThan(daysForPower(1.42, 104, 2.0));
  });

  // No amount of waiting confirms an effect that is not there.
  it("returns Infinity for a zero or negative effect", () => {
    expect(daysForPower(0, 104, 2.0)).toBe(Infinity);
    expect(daysForPower(-1.2, 104, 2.0)).toBe(Infinity);
  });
});

suite("barForPower", () => {
  it("gives a bar the effect can actually clear", () => {
    const bar = barForPower(3.17, 104, 60, 0.8);
    expect(powerAtBar(3.17, 104, 60, bar)).toBeCloseTo(0.8, 2);
  });

  it("returns a bar near zero when the window is too short to demand anything", () => {
    expect(barForPower(1.42, 104, 60, 0.8)).toBeLessThan(0.5);
  });
});
