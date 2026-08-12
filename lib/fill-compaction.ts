// lib/fill-compaction.ts
//
// Collapse fills to hourly resolution, conservatively.
//
// Cache size, not data availability, has bounded every study in this project.
// A 400-wallet 200-day fetch produces over six million raw fills, which is
// roughly a gigabyte of JSON: at the limit of what a single string can hold and
// past what is comfortable to parse. The 2026-08-12 attempt was killed at the
// halfway mark for exactly this reason, after three million fills.
//
// Nothing downstream reads an individual fill. Entry analyses collapse fills
// into episodes, and the positioning work needs signed size changes per wallet
// per coin per hour. Both survive aggregation intact, so compaction buys the
// window length back at no analytical cost.
//
// It is lossy for sub-hour latency questions. Those belong to the short 1m-bar
// runs, which are small enough not to need this.

export interface CompactableFill {
  /** wallet id */
  w: string;
  /** coin */
  c: string;
  /** price */
  p: number;
  /** size */
  s: number;
  /** timestamp, ms */
  t: number;
  /** 1 = long, -1 = short */
  d: 1 | -1;
  /** 1 = opening, 0 = closing */
  o: 0 | 1;
  /** realised PnL on a close */
  pnl: number;
}

export const BUCKET_MS = 3_600_000;

/**
 * One row per wallet, coin, side, open/close and hour, at the size-weighted
 * price and summed size, stamped with the earliest fill in the bucket so a
 * follower's earliest possible action time is preserved rather than smeared to
 * the bucket edge.
 */
export function compactFills<T extends CompactableFill>(fills: readonly T[], bucketMs = BUCKET_MS): T[] {
  const groups = new Map<string, T>();
  for (const f of fills) {
    const key = `${f.w}|${f.c}|${f.d}|${f.o}|${Math.floor(f.t / bucketMs)}`;
    const prev = groups.get(key);
    if (!prev) {
      groups.set(key, { ...f });
      continue;
    }
    const totalSize = prev.s + f.s;
    prev.p = totalSize > 0 ? (prev.p * prev.s + f.p * f.s) / totalSize : prev.p;
    prev.s = totalSize;
    prev.pnl += f.pnl;
    if (f.t < prev.t) prev.t = f.t;
  }
  return [...groups.values()].sort((a, b) => a.t - b.t);
}

/** Net signed position implied by a set of fills. Compaction must preserve it. */
export function netSignedSize(fills: readonly CompactableFill[]): number {
  return fills.reduce((s, f) => s + f.s * f.d * (f.o === 1 ? 1 : -1), 0);
}

/** Total realised PnL. Compaction must preserve it. */
export function totalPnl(fills: readonly CompactableFill[]): number {
  return fills.reduce((s, f) => s + f.pnl, 0);
}

export interface ConservationCheck {
  sizeDrift: number;
  pnlDrift: number;
  ok: boolean;
}

/**
 * Relative drift in the two quantities every downstream slice sums. Aggregation
 * that moves either one is wrong, and the caller should refuse to write.
 */
export function checkConservation(
  before: readonly CompactableFill[],
  after: readonly CompactableFill[],
  tolerance = 1e-6,
): ConservationCheck {
  const sizeBefore = netSignedSize(before), sizeAfter = netSignedSize(after);
  const pnlBefore = totalPnl(before), pnlAfter = totalPnl(after);
  const sizeDrift = Math.abs(sizeBefore - sizeAfter) / Math.max(Math.abs(sizeBefore), 1e-9);
  const pnlDrift = Math.abs(pnlBefore - pnlAfter) / Math.max(Math.abs(pnlBefore), 1e-9);
  return { sizeDrift, pnlDrift, ok: sizeDrift <= tolerance && pnlDrift <= tolerance };
}
