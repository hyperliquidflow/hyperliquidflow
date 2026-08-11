import { describe, it, expect } from "vitest";
import { marketReturnBps, computeAlpha } from "../benchmark";

describe("marketReturnBps", () => {
  it("measures the move between entry and exit in bps", () => {
    expect(marketReturnBps(100, 102)).toBe(200);
  });

  it("is negative when the market fell", () => {
    expect(marketReturnBps(100, 99)).toBe(-100);
  });

  it("returns null for an unusable entry price", () => {
    expect(marketReturnBps(0, 100)).toBeNull();
    expect(marketReturnBps(Number.NaN, 100)).toBeNull();
  });
});

describe("computeAlpha", () => {
  it("charges a LONG for the market move it was riding", () => {
    // Made 150 bps while the market carried 200. That is negative alpha: just
    // holding the market would have paid more.
    const r = computeAlpha({ netPnlBps: 150, marketReturnBps: 200, direction: "LONG" });
    expect(r.benchmark_bps).toBe(200);
    expect(r.alpha_bps).toBe(-50);
  });

  it("credits a LONG that beat the market", () => {
    const r = computeAlpha({ netPnlBps: 400, marketReturnBps: 200, direction: "LONG" });
    expect(r.alpha_bps).toBe(200);
  });

  it("inverts the benchmark for a SHORT", () => {
    // Shorting into a rising market: the passive equivalent lost 200, so losing
    // only 100 is genuinely 100 bps of skill.
    const r = computeAlpha({ netPnlBps: -100, marketReturnBps: 200, direction: "SHORT" });
    expect(r.benchmark_bps).toBe(-200);
    expect(r.alpha_bps).toBe(100);
  });

  it("does not credit a SHORT that merely rode a falling market", () => {
    const r = computeAlpha({ netPnlBps: 150, marketReturnBps: -200, direction: "SHORT" });
    expect(r.benchmark_bps).toBe(200);
    expect(r.alpha_bps).toBe(-50);
  });

  it("leaves alpha null when the market return is unknown", () => {
    const r = computeAlpha({ netPnlBps: 150, marketReturnBps: null, direction: "LONG" });
    expect(r.benchmark_bps).toBeNull();
    expect(r.alpha_bps).toBeNull();
  });
});
