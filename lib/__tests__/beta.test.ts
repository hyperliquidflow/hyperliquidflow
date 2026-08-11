import { describe, it, expect } from "vitest";
import { toReturns, alignReturns, computeBeta } from "../beta";

const H = 3600_000;
const bars = (closes: number[], startT = 0, step = H) =>
  closes.map((c, i) => ({ t: startT + i * step, c: String(c) }));

describe("toReturns", () => {
  it("produces one return per consecutive pair, stamped at the later bar", () => {
    const r = toReturns(bars([100, 110, 99]));
    expect(r).toHaveLength(2);
    expect(r[0].r).toBeCloseTo(0.1, 10);
    expect(r[1].r).toBeCloseTo(-0.1, 10);
    expect(r[0].t).toBe(H);
  });

  it("skips pairs with an unusable price", () => {
    const r = toReturns([{ t: 0, c: "100" }, { t: H, c: "0" }, { t: 2 * H, c: "110" }]);
    expect(r.every((x) => Number.isFinite(x.r))).toBe(true);
  });

  it("returns nothing for a single bar", () => {
    expect(toReturns(bars([100]))).toEqual([]);
  });
});

describe("alignReturns", () => {
  it("pairs returns that share a timestamp and drops the rest", () => {
    const coin = [{ t: H, r: 0.1 }, { t: 2 * H, r: 0.2 }, { t: 9 * H, r: 0.9 }];
    const btc  = [{ t: H, r: 0.05 }, { t: 2 * H, r: 0.1 }];
    const { coin: c, market: m } = alignReturns(coin, btc);

    expect(c).toEqual([0.1, 0.2]);
    expect(m).toEqual([0.05, 0.1]);
  });

  it("returns empty arrays when nothing lines up", () => {
    const { coin, market } = alignReturns([{ t: 1, r: 0.1 }], [{ t: 2, r: 0.1 }]);
    expect(coin).toEqual([]);
    expect(market).toEqual([]);
  });
});

describe("computeBeta", () => {
  const market = Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? 0.01 : -0.008));

  it("returns 1 for a coin that tracks the market exactly", () => {
    expect(computeBeta(market, market)).toBeCloseTo(1, 6);
  });

  it("returns 2 for a coin that moves twice as hard", () => {
    const coin = market.map((r) => r * 2);
    expect(computeBeta(coin, market)).toBeCloseTo(2, 6);
  });

  it("returns a negative beta for a coin that moves against the market", () => {
    const coin = market.map((r) => -r);
    expect(computeBeta(coin, market)).toBeCloseTo(-1, 6);
  });

  it("returns null below the minimum sample rather than a fragile estimate", () => {
    expect(computeBeta([0.01, 0.02], [0.01, 0.02])).toBeNull();
  });

  it("returns null when the market never moved, since beta is undefined", () => {
    const flat = Array.from({ length: 40 }, () => 0);
    expect(computeBeta(market, flat)).toBeNull();
  });

  it("returns null when the two series are different lengths", () => {
    expect(computeBeta(market, market.slice(0, 10))).toBeNull();
  });
});
