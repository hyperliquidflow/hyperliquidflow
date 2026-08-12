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
