import { describe as suite, it, expect } from "vitest";
import {
  priceAt,
  staleTolerance,
  toEpisodes,
  clusterByCoinDay,
  clusterByDay,
  describe as summarise,
  zscore,
  trimmedMean,
  mulberry32,
  bootstrapMeanCI,
  fundingOverHold,
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

suite("clusterByDay", () => {
  it("averages all observations on one UTC day into one value across coins", () => {
    const day = 86_400_000;
    const rows = [
      { t: day * 100 + 1, r: 0.01 },
      { t: day * 100 + 2, r: 0.03 },
      { t: day * 101 + 5, r: -0.02 },
    ];
    const out = clusterByDay(rows).sort((a, b) => a - b);
    expect(out).toHaveLength(2);
    expect(out[0]).toBeCloseTo(-0.02, 10);
    expect(out[1]).toBeCloseTo(0.02, 10);
  });

  it("thirty coins on one falling afternoon are one observation", () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ t: 86_400_000 * 7 + i, r: -0.05 }));
    expect(clusterByDay(rows)).toHaveLength(1);
  });
});

suite("trimmedMean", () => {
  it("is insensitive to a single extreme tail value at 10% trim", () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 1000];
    const tm = trimmedMean(xs, 0.1)!;
    expect(tm).toBeCloseTo((2 + 3 + 4 + 5 + 6 + 7 + 8 + 9) / 8, 10);
  });

  it("returns null when trimming would leave nothing", () => {
    expect(trimmedMean([1], 0.5)).toBeNull();
  });
});

suite("bootstrapMeanCI", () => {
  it("is deterministic for a fixed seed", () => {
    const xs = Array.from({ length: 50 }, (_, i) => (i % 2 === 0 ? 1 : -0.5));
    const a = bootstrapMeanCI(xs, { iters: 500, seed: 42 })!;
    const b = bootstrapMeanCI(xs, { iters: 500, seed: 42 })!;
    expect(a.lo).toBe(b.lo);
    expect(a.hi).toBe(b.hi);
  });

  it("brackets the sample mean of a well-behaved sample", () => {
    const xs = Array.from({ length: 200 }, (_, i) => 0.5 + Math.sin(i) * 0.1);
    const ci = bootstrapMeanCI(xs, { iters: 1000, seed: 7 })!;
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(ci.lo).toBeLessThan(mean);
    expect(ci.hi).toBeGreaterThan(mean);
  });

  it("returns null below two observations", () => {
    expect(bootstrapMeanCI([1])).toBeNull();
  });

  it("mulberry32 streams are reproducible", () => {
    const a = mulberry32(7), b = mulberry32(7);
    for (let i = 0; i < 5; i++) expect(a()).toBe(b());
  });
});

suite("fundingOverHold", () => {
  const hour = 3_600_000;
  const series: Array<[number, number]> = [
    [hour * 1, 0.0001], [hour * 2, 0.0002], [hour * 3, -0.0001], [hour * 4, 0.0003],
  ];

  it("sums rates settling inside the window, exclusive start, inclusive end", () => {
    const { sum, points, expectedPoints } = fundingOverHold(series, hour * 1, hour * 3);
    expect(sum).toBeCloseTo(0.0001, 12);
    expect(points).toBe(2);
    expect(expectedPoints).toBe(2);
  });

  it("reports missing settlements through expectedPoints", () => {
    const { points, expectedPoints } = fundingOverHold(series, 0, hour * 10);
    expect(points).toBe(4);
    expect(expectedPoints).toBe(10);
  });

  it("an empty series contributes zero with the full expected count", () => {
    const { sum, points, expectedPoints } = fundingOverHold([], 0, hour * 5);
    expect(sum).toBe(0);
    expect(points).toBe(0);
    expect(expectedPoints).toBe(5);
  });
});
