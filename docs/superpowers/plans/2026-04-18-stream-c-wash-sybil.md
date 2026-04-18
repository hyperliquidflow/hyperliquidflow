# Stream C — Implementation Plan

**Spec:** [docs/superpowers/specs/2026-04-18-stream-c-wash-sybil.md](../specs/2026-04-18-stream-c-wash-sybil.md)
**Date:** 2026-04-18

---

## Key design decisions

**Fee ratio gate placement:** Computed inside `scoreWallet` after the existing `suspiciously_fresh` check (last in the chain, since it's the most expensive conceptually). `wash_score` is written into `ScoringResult` regardless of pass/fail. `rejection_reason = "wash_detected"` fires only if `wash_score > MAX_FEE_RATIO`.

**`wash_score` persistence:** Written to `wallets.wash_score` inside `updateWalletMetrics` (which already runs for all scored wallets). This means it's stored even for non-qualifying wallets that reached the fee ratio check — useful for distribution analysis.

**Sybil input:** `detectSybilClusters()` receives two things from `main()`:
  - `qualifiedWalletIds: string[]` — wallet IDs that set `is_active = true` in this run (collected during the scoring loop)
  - `scoringResultMap: Map<walletId, { profit_factor: number }>` — for picking the cluster primary

**Sybil data source:** Reads `user_pnl_backtest.daily_pnls` for the qualified IDs from Supabase (written earlier in the same scan run by `saveBacktestRow`). One query, no API calls.

**Cluster ID:** Deterministic — sort wallet IDs alphabetically, SHA-256 the `"|"`-joined string, take the first 8 hex chars. Same cluster always gets the same ID across re-runs.

**scan-summary.json:** `wash_detected` goes into `rejection_breakdown` (existing object, just add the key). `sybil_clusters_found` and `sybil_wallets_deactivated` go top-level.

---

## Steps

### Step 1 — Migration `010_wash_sybil.sql`

```sql
alter table wallets
  add column if not exists wash_score       numeric(5,3),
  add column if not exists sybil_cluster_id text;

create index if not exists idx_wallets_sybil_cluster
  on wallets(sybil_cluster_id)
  where sybil_cluster_id is not null;
```

---

### Step 2 — Pure functions in `lib/wash-sybil.ts` (new file, unit-testable)

```ts
/** Returns fee_ratio = fees / max(|gross_pnl|, 1). Always >= 0. */
export function computeFeeRatio(totalFees: number, grossPnl: number): number

/** Returns Pearson r for two equal-length arrays. Returns 0 if std dev is 0. */
export function pearsonR(xs: number[], ys: number[]): number

/** Counts non-zero values in a series. */
export function nonZeroDays(series: number[]): number

/**
 * Groups wallet IDs into sybil clusters by pairwise Pearson r.
 * Returns a Map<clusterId, walletId[]> for clusters with >= 2 members.
 * Only considers pairs where both series have >= minNonZeroDays non-zero values.
 */
export function findSybilClusters(
  series:          Map<string, number[]>,
  threshold:       number,
  minNonZeroDays:  number,
): Map<string, string[]>   // clusterId -> walletIds

/** Deterministic cluster ID from a set of wallet IDs. */
export function clusterIdFromWalletIds(walletIds: string[]): string
```

`findSybilClusters` uses union-find (disjoint set) internally so that transitive clusters are handled correctly — if A correlates with B and B correlates with C, all three end up in the same cluster even if A and C don't exceed the threshold directly.

---

### Step 3 — Update `scripts/daily-wallet-scan.ts`

#### 3a. Add `wash_score` to `ScoringResult` interface

```ts
interface ScoringResult {
  // ... existing fields ...
  wash_score: number | null;  // null if wallet failed a prior gate before reaching fee check
}
```

#### 3b. Add constant

```ts
const MAX_FEE_RATIO = 0.60;
```

#### 3c. Extend rejection gate chain in `scoreWallet`

After the `suspiciously_fresh` check, before `const qualifies = ...`:

```ts
let wash_score: number | null = null;
if (rejection_reason === null) {
  // Only compute for wallets that passed all prior gates
  wash_score = computeFeeRatio(total_fees_30d, realized_pnl_30d_gross);
  if (wash_score > MAX_FEE_RATIO) rejection_reason = "wash_detected";
}
```

Return `wash_score` in the result object.

#### 3d. Add `wash_detected: 0` to `rejection_breakdown` in `main()`

```ts
rejection_breakdown: {
  // ... existing keys ...
  wash_detected: 0,
} as Record<string, number>,
```

#### 3e. Update `updateWalletMetrics` to write `wash_score`

```ts
.update({
  win_rate:         result.win_rate,
  trade_count_30d:  result.trade_count_30d,
  realized_pnl_30d: result.realized_pnl_30d,
  last_scanned_at:  new Date().toISOString(),
  is_active:        result.qualifies,
  ...(result.wash_score !== null && { wash_score: result.wash_score }),
})
```

#### 3f. Collect qualifying wallet IDs during scoring loop

In the `Promise.allSettled` result processing loop, alongside the existing `summary.activated++`:

```ts
// Collect (walletId, profit_factor) for qualifying wallets for sybil analysis
const qualifiedForSybil = new Map<string, number>();  // walletId -> profit_factor
// ...inside loop, where result.qualifies is true:
const walletId = addressToId.get(result.address);
if (walletId) qualifiedForSybil.set(walletId, result.profit_factor);
```

#### 3g. Add `sybil_clusters_found` and `sybil_wallets_deactivated` to `summary` object

```ts
sybil_clusters_found:     0,
sybil_wallets_deactivated: 0,
```

#### 3h. Add `detectSybilClusters()` call at end of `main()`, after Phase 6 enrichment

```ts
const sybilResult = await detectSybilClusters(qualifiedForSybil, supabase);
summary.sybil_clusters_found      = sybilResult.clustersFound;
summary.sybil_wallets_deactivated = sybilResult.walletsDeactivated;
```

Update `scan-summary.json` write to happen after this call.

#### 3i. Implement `detectSybilClusters()` in the scan script

```ts
async function detectSybilClusters(
  qualifiedWallets: Map<string, number>,  // walletId -> profit_factor
  supabase:         SupabaseClient,
): Promise<{ clustersFound: number; walletsDeactivated: number }>
```

Implementation:
1. If `qualifiedWallets.size < 2` return early (no pairs to compare).
2. Fetch `user_pnl_backtest` rows for the qualified wallet IDs — one query: `select wallet_id, daily_pnls where wallet_id in (...)`.
3. Build `Map<walletId, number[]>` from the fetched rows.
4. Call `findSybilClusters(seriesMap, SYBIL_CORRELATION_THRESHOLD, MIN_NONZERO_DAYS_FOR_SYBIL)`.
5. For each cluster:
   a. Compute cluster ID via `clusterIdFromWalletIds`.
   b. Identify primary = wallet with highest `profit_factor` from `qualifiedWallets`.
   c. Duplicates = cluster members minus primary.
   d. Update duplicates: `is_active = false, deactivation_reason = "sybil_duplicate", sybil_cluster_id = clusterId`.
   e. Update primary: `sybil_cluster_id = clusterId` (stays active, just labeled).
6. Return counts.

---

### Step 4 — `lib/__tests__/wash-sybil.test.ts` (new file)

| Test group | Cases |
|---|---|
| `computeFeeRatio` | zero gross (uses floor), normal ratio, gross = 1 (floor boundary) |
| `pearsonR` | perfect positive correlation, perfect negative, zero correlation, identical series (std dev = 0 returns 0), single-element arrays |
| `nonZeroDays` | all zero, all non-zero, mixed |
| `findSybilClusters` | no pairs above threshold, one pair, transitive cluster (A-B, B-C all merge), pair below minNonZeroDays is skipped |
| `clusterIdFromWalletIds` | deterministic across orderings, different wallets produce different IDs |

---

### Step 5 — Verify and test

```bash
npm run typecheck
npm run test
```

---

### Step 6 — Docs

- Update `docs/sprints/status.md`: Stream C status PLAN READY
- After scan runs successfully: mark COMPLETE

---

## File summary

| File | Action |
|---|---|
| `supabase/migrations/010_wash_sybil.sql` | NEW |
| `lib/wash-sybil.ts` | NEW (pure functions) |
| `lib/__tests__/wash-sybil.test.ts` | NEW |
| `scripts/daily-wallet-scan.ts` | MODIFY (5 targeted edits) |
| `docs/sprints/status.md` | MODIFY |

No cron changes. No API route changes. No new API calls.

---

## Non-goals

- Trade timing / same-coin-same-second correlation (needs FillRecord field additions — Stream D)
- On-chain graph analysis
- Real-time wash detection in cron
- UI surfacing of wash_score or sybil_cluster_id (Stream F)
