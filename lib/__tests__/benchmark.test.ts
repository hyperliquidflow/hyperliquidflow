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

  it("scales the benchmark by the coin's beta", () => {
    // A 3-beta alt returning 300 bps while the market ran 100 earned exactly
    // what its exposure implied. Unscaled, that reads as 200 bps of alpha.
    const r = computeAlpha({ netPnlBps: 300, marketReturnBps: 100, direction: "LONG", beta: 3 });
    expect(r.benchmark_bps).toBe(300);
    expect(r.alpha_bps).toBe(0);
  });

  it("charges a low-beta coin less than the full market move", () => {
    const r = computeAlpha({ netPnlBps: 100, marketReturnBps: 200, direction: "LONG", beta: 0.25 });
    expect(r.benchmark_bps).toBe(50);
    expect(r.alpha_bps).toBe(50);
  });

  it("applies beta and direction together for a SHORT", () => {
    const r = computeAlpha({ netPnlBps: -100, marketReturnBps: 200, direction: "SHORT", beta: 2 });
    expect(r.benchmark_bps).toBe(-400);
    expect(r.alpha_bps).toBe(300);
  });

  it("falls back to a beta of 1 when it could not be estimated", () => {
    const r = computeAlpha({ netPnlBps: 150, marketReturnBps: 200, direction: "LONG", beta: null });
    expect(r.benchmark_bps).toBe(200);
    expect(r.alpha_bps).toBe(-50);
  });

  it("leaves alpha null when the market return is unknown", () => {
    const r = computeAlpha({ netPnlBps: 150, marketReturnBps: null, direction: "LONG" });
    expect(r.benchmark_bps).toBeNull();
    expect(r.alpha_bps).toBeNull();
  });
});
