// lib/study-stats.ts
//
// Pure statistics for the retrospective research scripts. No I/O.
//
// These functions carry the statistical validity of every research result in
// the project, and they exist because the naive version of each produced a
// confident wrong answer first:
//
//   toEpisodes        fills within a wallet are near duplicates; counting them
//                     separately inflated a decile t-statistic to 51
//   clusterByCoinDay  wallets on one coin on one day resolve against a single
//                     market move; ignoring that inflated a 24h result to t 2.7
//   priceAt           a staleness tolerance fixed at 10 minutes silently dropped
//                     a third of a 15m-bar sample, non-randomly
//
// They live here rather than in a script so they can be tested, and so
// fill-study and signal-stack cannot drift apart on the definitions.

export interface StudyFill {
  /** wallet id */
  w: string;
  /** coin symbol */
  c: string;
  /** fill price */
  p: number;
  /** size */
  s: number;
  /** timestamp, ms */
  t: number;
  /** 1 = long side, -1 = short side */
  d: 1 | -1;
}

/**
 * Close of the first bar at or after `t`, or null when the nearest bar is
 * further away than `toleranceMs`.
 *
 * The tolerance must scale with the bar interval. Held at a fixed 10 minutes it
 * rejects most legitimate lookups on 15m bars, because bars are 15 minutes
 * apart, and the rows that survive are not a random subset of the sample.
 */
export function priceAt(
  series: ReadonlyArray<readonly [number, number]>,
  t: number,
  toleranceMs: number,
): number | null {
  if (!series || series.length === 0) return null;
  let lo = 0, hi = series.length - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid][0] >= t) { best = mid; hi = mid - 1; } else { lo = mid + 1; }
  }
  if (best === -1) return null;
  if (series[best][0] - t > toleranceMs) return null;
  return series[best][1];
}

/** One and a half bars: wide enough for a legitimate next bar, tight enough that a real hole still fails. */
export function staleTolerance(barMinutes: number): number {
  return Math.max(10 * 60_000, barMinutes * 1.5 * 60_000);
}

/**
 * Collapse fills into entry episodes.
 *
 * One wallet opening a position emits many fills seconds apart on the same coin
 * and side. Counted separately they are near duplicates: n counts them all while
 * the independent information is one trade, which inflates t by roughly the
 * square root of the cluster size.
 *
 * Fills of the same wallet, coin and direction within `gapMinutes` of the
 * previous fill merge into one episode, priced at the size-weighted average and
 * stamped at the first fill, which is when a follower could first have acted.
 */
export function toEpisodes<T extends StudyFill>(fills: readonly T[], gapMinutes = 30): T[] {
  const gapMs = gapMinutes * 60_000;
  const keyed = new Map<string, T[]>();
  for (const f of fills) {
    const k = `${f.w}|${f.c}|${f.d}`;
    if (!keyed.has(k)) keyed.set(k, []);
    keyed.get(k)!.push(f);
  }

  const out: T[] = [];
  for (const group of keyed.values()) {
    const sorted = [...group].sort((a, b) => a.t - b.t);
    let bucket: T[] = [];
    const flush = () => {
      if (bucket.length === 0) return;
      const size = bucket.reduce((s, f) => s + f.s, 0);
      const notional = bucket.reduce((s, f) => s + f.p * f.s, 0);
      out.push({
        ...bucket[0],
        p: size > 0 ? notional / size : bucket[0].p,
        s: size,
        t: bucket[0].t,
      });
      bucket = [];
    };
    for (const f of sorted) {
      if (bucket.length > 0 && f.t - bucket[bucket.length - 1].t > gapMs) flush();
      bucket.push(f);
    }
    flush();
  }
  return out.sort((a, b) => a.t - b.t);
}

/**
 * Average observations that share a coin and a calendar day into one value.
 *
 * toEpisodes removes correlation inside a wallet. It does nothing about many
 * wallets trading the same coin on the same day, which resolve against one
 * market move and carry one unit of information between them. Long horizons
 * depend on this most, because a 24h forward window overlaps nearly every other
 * entry that day.
 */
export function clusterByCoinDay(
  rows: ReadonlyArray<{ coin: string; t: number; r: number }>,
  dayMs = 86_400_000,
): number[] {
  const groups = new Map<string, number[]>();
  for (const row of rows) {
    const k = `${row.coin}|${Math.floor(row.t / dayMs)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(row.r);
  }
  return [...groups.values()].map((rs) => rs.reduce((a, b) => a + b, 0) / rs.length);
}

export interface SampleStats {
  n: number;
  mean: number;
  median: number;
  sd: number;
  se: number;
  t: number;
  winRate: number;
}

/** Sample mean, dispersion and t against zero. Null below two observations. */
export function describe(xs: readonly number[]): SampleStats | null {
  const n = xs.length;
  if (n < 2) return null;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(xs.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1));
  const se = sd / Math.sqrt(n);
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(n / 2);
  const median = n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return {
    n, mean, median, sd, se,
    t: se === 0 ? 0 : mean / se,
    winRate: xs.filter((v) => v > 0).length / n,
  };
}

/**
 * Cross-sectional z-score. A flat input returns zeros rather than NaN, so one
 * degenerate day cannot poison a whole feature series.
 */
export function zscore(xs: readonly number[]): number[] {
  const n = xs.length;
  if (n < 2) return xs.map(() => 0);
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(xs.reduce((s, v) => s + (v - mean) ** 2, 0) / n);
  if (!Number.isFinite(sd) || sd === 0) return xs.map(() => 0);
  return xs.map((v) => (v - mean) / sd);
}

/**
 * Average all observations on one UTC calendar day into one value, regardless
 * of coin. clusterByCoinDay absorbs many wallets on one coin; it does nothing
 * about many coins moving together on the same day, and alts are heavily
 * correlated cross-sectionally, so thirty coins on one falling afternoon are
 * closer to one observation than thirty. Day-level clustering is the
 * conservative unit for any multi-coin table (external review, 2026-08-12).
 */
export function clusterByDay(
  rows: ReadonlyArray<{ t: number; r: number }>,
  dayMs = 86_400_000,
): number[] {
  return [...clusterByDayMap(rows, dayMs).values()];
}

/**
 * The same clustering, keyed by day index, for when two series have to be
 * compared on the days they share. Averaging each side separately and
 * subtracting the totals would compare different days to each other.
 */
export function clusterByDayMap(
  rows: ReadonlyArray<{ t: number; r: number }>,
  dayMs = 86_400_000,
): Map<number, number> {
  const groups = new Map<number, number[]>();
  for (const row of rows) {
    const k = Math.floor(row.t / dayMs);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(row.r);
  }
  const out = new Map<number, number>();
  for (const [k, rs] of groups) out.set(k, rs.reduce((a, b) => a + b, 0) / rs.length);
  return out;
}

/**
 * Mean after dropping `frac` of the sample from each end. A mean that does not
 * survive trimming is carried by a handful of tail observations, which is a
 * lottery ticket rather than an edge. Null when trimming leaves nothing.
 */
export function trimmedMean(xs: readonly number[], frac = 0.1): number | null {
  const n = xs.length;
  if (n === 0 || frac <= 0) return n === 0 ? null : xs.reduce((a, b) => a + b, 0) / n;
  // ceil, not floor: always remove at least the requested fraction, so a
  // sample too small to trim honestly returns null instead of an untrimmed mean.
  const cut = Math.ceil(n * frac);
  const kept = [...xs].sort((a, b) => a - b).slice(cut, n - cut);
  if (kept.length === 0) return null;
  return kept.reduce((a, b) => a + b, 0) / kept.length;
}

/** Deterministic PRNG so bootstrap results reproduce run to run. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Percentile bootstrap CI for the mean. Feed it day-clustered values so the
 * resampling unit is the day, not the (correlated) raw observation.
 */
export function bootstrapMeanCI(
  xs: readonly number[],
  opts: { iters?: number; alpha?: number; seed?: number } = {},
): { lo: number; hi: number } | null {
  const { iters = 2000, alpha = 0.05, seed = 42 } = opts;
  const n = xs.length;
  if (n < 2) return null;
  const rng = mulberry32(seed);
  const means: number[] = new Array(iters);
  for (let i = 0; i < iters; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += xs[Math.floor(rng() * n)];
    means[i] = s / n;
  }
  means.sort((a, b) => a - b);
  const loIdx = Math.floor((alpha / 2) * iters);
  const hiIdx = Math.min(iters - 1, Math.ceil((1 - alpha / 2) * iters) - 1);
  return { lo: means[loIdx], hi: means[hiIdx] };
}

/**
 * Sum of hourly funding rates settling inside (t0, t1], plus coverage so a
 * sparse funding series cannot silently understate the charge. Convention:
 * a positive rate means longs pay, so a position with direction d is charged
 * d * sum as a return deduction.
 */
export function fundingOverHold(
  series: ReadonlyArray<readonly [number, number]>,
  t0: number,
  t1: number,
): { sum: number; points: number; expectedPoints: number } {
  const expectedPoints = Math.max(0, Math.round((t1 - t0) / 3_600_000));
  let sum = 0, points = 0;
  for (const [ts, rate] of series) {
    if (ts > t1) break;
    if (ts > t0) { sum += rate; points++; }
  }
  return { sum, points, expectedPoints };
}
