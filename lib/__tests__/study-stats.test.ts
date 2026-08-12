import { describe as suite, it, expect } from "vitest";
import {
  priceAt,
  staleTolerance,
  toEpisodes,
  clusterByCoinDay,
  describe as summarise,
  zscore,
  type StudyFill,
} from "@/lib/study-stats";

const MIN = 60_000;
const fill = (o: Partial<StudyFill> & Pick<StudyFill, "w" | "c" | "t">): StudyFill => ({
  p: 100, s: 1, d: 1, ...o,
});

suite("priceAt", () => {
  const series: Array<[number, number]> = [[0, 10], [60_000, 11], [120_000, 12]];

  it("takes the first bar at or after the requested time", () => {
    expect(priceAt(series, 60_000, MIN)).toBe(11);
    expect(priceAt(series, 30_000, MIN)).toBe(11);
  });

  it("returns null past the end of the series", () => {
    expect(priceAt(series, 200_000, MIN)).toBeNull();
  });

  it("returns null on an empty series", () => {
    expect(priceAt([], 0, MIN)).toBeNull();
  });

  it("refuses a bar further away than the tolerance", () => {
    // Next bar is 60s away, tolerance is 30s.
    expect(priceAt(series, 1, 30_000)).toBeNull();
  });

  // The defect this guards: a fixed 10-minute tolerance rejected most lookups on
  // 15m bars, silently dropping a third of the sample and not at random.
  it("accepts a bar one interval away once tolerance scales with the interval", () => {
    const fifteen: Array<[number, number]> = [[0, 10], [15 * MIN, 11]];
    expect(priceAt(fifteen, 1, 10 * MIN)).toBeNull();
    expect(priceAt(fifteen, 1, staleTolerance(15))).toBe(11);
  });

  it("staleTolerance never drops below ten minutes", () => {
    expect(staleTolerance(1)).toBe(10 * MIN);
    expect(staleTolerance(15)).toBe(22.5 * MIN);
  });
});

suite("toEpisodes", () => {
  it("merges fills of one wallet, coin and side inside the gap", () => {
    const out = toEpisodes([
      fill({ w: "a", c: "BTC", t: 0, p: 100, s: 1 }),
      fill({ w: "a", c: "BTC", t: 5 * MIN, p: 110, s: 1 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].s).toBe(2);
    expect(out[0].p).toBeCloseTo(105, 9);   // size weighted
    expect(out[0].t).toBe(0);               // earliest, when a follower could act
  });

  it("splits when the gap is exceeded", () => {
    const out = toEpisodes([
      fill({ w: "a", c: "BTC", t: 0 }),
      fill({ w: "a", c: "BTC", t: 31 * MIN }),
    ], 30);
    expect(out).toHaveLength(2);
  });

  it("chains across a long run of closely spaced fills", () => {
    // Each fill is 10 minutes after the last, so all 10 belong to one episode
    // even though the first and last are 90 minutes apart.
    const fills = Array.from({ length: 10 }, (_, i) => fill({ w: "a", c: "BTC", t: i * 10 * MIN }));
    expect(toEpisodes(fills, 30)).toHaveLength(1);
  });

  it("keeps different wallets, coins and directions apart", () => {
    const out = toEpisodes([
      fill({ w: "a", c: "BTC", t: 0 }),
      fill({ w: "b", c: "BTC", t: 0 }),
      fill({ w: "a", c: "ETH", t: 0 }),
      fill({ w: "a", c: "BTC", t: 0, d: -1 }),
    ]);
    expect(out).toHaveLength(4);
  });

  it("weights price by size rather than averaging naively", () => {
    const out = toEpisodes([
      fill({ w: "a", c: "BTC", t: 0, p: 100, s: 9 }),
      fill({ w: "a", c: "BTC", t: MIN, p: 200, s: 1 }),
    ]);
    expect(out[0].p).toBeCloseTo(110, 9);
  });

  it("collapses a heavy cluster to a single observation", () => {
    // The real shape of the defect: 47 fills averaged per episode in production.
    const fills = Array.from({ length: 47 }, (_, i) => fill({ w: "a", c: "ZEC", t: i * 1000 }));
    expect(toEpisodes(fills)).toHaveLength(1);
  });

  it("returns episodes in time order", () => {
    const out = toEpisodes([
      fill({ w: "a", c: "BTC", t: 100 * MIN }),
      fill({ w: "b", c: "ETH", t: 0 }),
    ]);
    expect(out.map((e) => e.t)).toEqual([0, 100 * MIN]);
  });

  it("handles an empty input", () => {
    expect(toEpisodes([])).toEqual([]);
  });
});

suite("clusterByCoinDay", () => {
  const DAY = 86_400_000;

  it("averages same coin same day into one observation", () => {
    const out = clusterByCoinDay([
      { coin: "BTC", t: 0, r: 0.01 },
      { coin: "BTC", t: 3600_000, r: 0.03 },
    ]);
    expect(out).toEqual([0.02]);
  });

  it("keeps different days apart", () => {
    const out = clusterByCoinDay([
      { coin: "BTC", t: 0, r: 0.01 },
      { coin: "BTC", t: DAY, r: 0.03 },
    ]);
    expect(out.sort()).toEqual([0.01, 0.03]);
  });

  it("keeps different coins apart on the same day", () => {
    const out = clusterByCoinDay([
      { coin: "BTC", t: 0, r: 0.01 },
      { coin: "ETH", t: 0, r: 0.03 },
    ]);
    expect(out).toHaveLength(2);
  });

  // The inflation this prevents: 50 wallets buying one coin on one afternoon
  // resolve against a single market move and are one observation, not 50.
  it("turns a crowded coin-day into one observation, not fifty", () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ coin: "ZEC", t: i * 60_000, r: 0.02 }));
    const out = clusterByCoinDay(rows);
    expect(out).toHaveLength(1);
    expect(out[0]).toBeCloseTo(0.02, 12);
  });

  it("handles an empty input", () => {
    expect(clusterByCoinDay([])).toEqual([]);
  });
});

suite("describe", () => {
  it("returns null below two observations", () => {
    expect(summarise([])).toBeNull();
    expect(summarise([1])).toBeNull();
  });

  it("computes mean, median and win rate", () => {
    const s = summarise([-1, 1, 3])!;
    expect(s.n).toBe(3);
    expect(s.mean).toBeCloseTo(1, 9);
    expect(s.median).toBe(1);
    expect(s.winRate).toBeCloseTo(2 / 3, 9);
  });

  it("averages the middle pair for an even count", () => {
    expect(summarise([1, 2, 3, 4])!.median).toBe(2.5);
  });

  it("reports t of zero when every value is identical", () => {
    const s = summarise([5, 5, 5])!;
    expect(s.sd).toBe(0);
    expect(s.t).toBe(0);
  });

  it("scales t with sample size at fixed mean and dispersion", () => {
    const small = summarise([1, -1, 1, -1, 2])!;
    const large = summarise([...Array(5).fill(0).flatMap(() => [1, -1, 1, -1, 2])])!;
    expect(Math.abs(large.t)).toBeGreaterThan(Math.abs(small.t));
  });
});

suite("zscore", () => {
  it("centres and scales to unit deviation", () => {
    const z = zscore([1, 2, 3]);
    expect(z[0]).toBeCloseTo(-1.2247, 3);
    expect(z[1]).toBeCloseTo(0, 9);
    expect(z[2]).toBeCloseTo(1.2247, 3);
  });

  it("returns zeros for a flat input rather than NaN", () => {
    expect(zscore([4, 4, 4])).toEqual([0, 0, 0]);
  });

  it("returns zeros below two observations", () => {
    expect(zscore([7])).toEqual([0]);
    expect(zscore([])).toEqual([]);
  });

  // Scale invariance is what lets a dollar notional feature and a wallet count
  // feature be added together. It holds exactly in maths and to floating point
  // precision in practice, so compare elementwise rather than by identity.
  it("is invariant to scale, so features of different magnitude are comparable", () => {
    const small = zscore([1, 2, 3]);
    const large = zscore([1000, 2000, 3000]);
    small.forEach((v, i) => expect(v).toBeCloseTo(large[i], 12));
  });

  it("is invariant to a shift, so only relative position matters", () => {
    const base = zscore([1, 2, 3]);
    const shifted = zscore([501, 502, 503]);
    base.forEach((v, i) => expect(v).toBeCloseTo(shifted[i], 12));
  });
});
