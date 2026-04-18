import { createHash } from "crypto";

// ─── Wash detection ───────────────────────────────────────────────────────────

/** fee_ratio = total_fees / max(|gross_pnl|, 1). Always >= 0. */
export function computeFeeRatio(totalFees: number, grossPnl: number): number {
  return totalFees / Math.max(Math.abs(grossPnl), 1);
}

// ─── Sybil detection ─────────────────────────────────────────────────────────

/** Count of non-zero values in a series. */
export function nonZeroDays(series: number[]): number {
  return series.filter((v) => v !== 0).length;
}

/** Pearson correlation coefficient for two equal-length arrays.
 *  Returns 0 if either series has zero standard deviation. */
export function pearsonR(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n === 0) return 0;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const ex = xs[i] - mx;
    const ey = ys[i] - my;
    num += ex * ey;
    dx2 += ex * ex;
    dy2 += ey * ey;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom === 0 ? 0 : num / denom;
}

/** Deterministic cluster ID derived from a set of wallet IDs. */
export function clusterIdFromWalletIds(walletIds: string[]): string {
  const joined = [...walletIds].sort().join("|");
  return createHash("sha256").update(joined).digest("hex").slice(0, 8);
}

/**
 * Groups wallet IDs into sybil clusters via pairwise Pearson r + union-find.
 * Transitive clusters are merged: if A-B and B-C both exceed threshold, all
 * three end up in the same cluster even if A-C does not.
 *
 * Returns a Map<clusterId, walletId[]> for clusters with >= 2 members only.
 * Pairs where either series has fewer than minNonZeroDays non-zero values are skipped.
 */
export function findSybilClusters(
  series:         Map<string, number[]>,
  threshold:      number,
  minNonZeroDays: number,
): Map<string, string[]> {
  const ids = [...series.keys()];

  // Union-find
  const parent = new Map<string, string>(ids.map((id) => [id, id]));

  function find(id: string): string {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    // Path compression
    let cur = id;
    while (cur !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  function union(a: string, b: string): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  // Pairwise comparisons
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i];
      const b = ids[j];
      const sa = series.get(a)!;
      const sb = series.get(b)!;

      if (nonZeroDays(sa) < minNonZeroDays || nonZeroDays(sb) < minNonZeroDays) continue;
      if (sa.length !== sb.length) continue;

      const r = pearsonR(sa, sb);
      if (r > threshold) union(a, b);
    }
  }

  // Group by root
  const groups = new Map<string, string[]>();
  for (const id of ids) {
    const root = find(id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(id);
  }

  // Return only clusters with >= 2 members, keyed by deterministic cluster ID
  const result = new Map<string, string[]>();
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const clusterId = clusterIdFromWalletIds(members);
    result.set(clusterId, members);
  }

  return result;
}
