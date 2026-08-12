// lib/cohort-lean.ts
//
// Reconstruct what the cohort held, day by day, from its fills.
//
// Positions come from fills rather than from cohort_snapshots because the
// snapshot table is sparse historically: one snapshot every five to eight hours
// through May and June, with a six-week hole. Fills are complete, so walking
// them forward is the only way to know what the cohort held on an arbitrary
// past day.
//
// Extracted from scripts/positioning-factor.ts so the mechanism study can ask
// what the lean is made of without carrying a second copy of the reconstruction
// that produces it. A silent divergence between two copies of this would not
// look like a bug, it would look like a discovery.

export interface LeanFill {
  /** wallet id */
  w: string;
  /** coin */
  c: string;
  /** size */
  s: number;
  /** timestamp, ms */
  t: number;
  /** 1 = long, -1 = short */
  d: 1 | -1;
  /** 1 = opening, 0 = closing */
  o: 0 | 1;
}

export const DAY_MS = 86_400_000;

/**
 * Signed notional held per coin at each day boundary.
 *
 * An open adds to the position on its side, a close removes from it, and the
 * sum over wallets at any instant is the cohort's net lean on that coin. The
 * price used to value it comes from the caller, so this stays free of any
 * candle format.
 *
 * Reconstruction starts every wallet flat, so a position opened before the
 * window and closed inside it registers as a phantom on the wrong side. That
 * error decays as real opens accumulate and is worst at the start, which is
 * why callers discard an opening burn-in rather than trusting it.
 */
export function reconstructDailyLean(
  fills: readonly LeanFill[],
  priceAt: (coin: string, t: number) => number | null,
): Array<Map<string, number>> {
  if (fills.length === 0) return [];
  const sorted = [...fills].sort((a, b) => a.t - b.t);
  const t0 = sorted[0].t;
  const t1 = sorted[sorted.length - 1].t;
  const totalDays = Math.floor((t1 - t0) / DAY_MS);

  const pos = new Map<string, number>();          // wallet|coin -> signed size
  const byDay: Array<Map<string, number>> = [];
  let cursor = 0;

  for (let day = 0; day <= totalDays; day++) {
    const boundary = t0 + (day + 1) * DAY_MS;
    while (cursor < sorted.length && sorted[cursor].t < boundary) {
      const f = sorted[cursor++];
      const k = `${f.w}|${f.c}`;
      pos.set(k, (pos.get(k) ?? 0) + (f.o === 1 ? 1 : -1) * f.d * f.s);
    }
    const snap = new Map<string, number>();
    for (const [k, size] of pos) {
      if (Math.abs(size) < 1e-12) continue;
      const coin = k.slice(k.indexOf("|") + 1);
      const px = priceAt(coin, boundary);
      if (px === null) continue;
      snap.set(coin, (snap.get(coin) ?? 0) + size * px);
    }
    byDay.push(snap);
  }
  return byDay;
}

/** First fill timestamp, which anchors every day boundary above. */
export function leanEpoch(fills: readonly LeanFill[]): number | null {
  if (fills.length === 0) return null;
  let min = Infinity;
  for (const f of fills) if (f.t < min) min = f.t;
  return Number.isFinite(min) ? min : null;
}
