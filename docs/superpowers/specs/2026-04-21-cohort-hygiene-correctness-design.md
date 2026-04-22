# Cohort Hygiene Correctness Fixes, Design

**Date:** 2026-04-21 (revised 2026-04-22 after critical audit)
**Scope:** [lib/cohort-hygiene.ts](../../../lib/cohort-hygiene.ts)
**Driver:** audit of the Stream B hygiene gates surfaced two correctness issues that are safely fixable in isolation. A third issue (drawdown gate is dead code) has a different root cause and is broken out as follow-up work below; it is NOT addressed by this spec.

## Problems being fixed

1. **Dead-wallet bypass.** [lib/cohort-hygiene.ts:179](../../../lib/cohort-hygiene.ts#L179): `if (!snap) continue`. A wallet flagged `is_active=true` with no recent snapshot row is silently skipped. No counter advances, it sits in the cohort indefinitely. Also catches wallets whose latest snapshot is many days old but still present.
2. **Sanity guard is advisory only.** [lib/cohort-hygiene.ts:222](../../../lib/cohort-hygiene.ts#L222) logs a warning when >25% of the cohort would be deactivated, then proceeds. A bad data pull can still nuke the cohort in one cycle.

## Problems deliberately NOT fixed here (follow-up)

- **Drawdown gate is dead code.** [supabase/migrations/002_wallet_metrics.sql:36-53](../../../supabase/migrations/002_wallet_metrics.sql#L36-L53) runs a pg_cron job that prunes `cohort_snapshots` to the 2 most recent rows per wallet. Combined with `MIN_DRAWDOWN_SNAPSHOTS = 3` at [lib/cohort-hygiene.ts:13](../../../lib/cohort-hygiene.ts#L13), the drawdown gate returns false 100% of the time. Fixing this needs a product decision about where to store a longer equity history (raise retention vs new aggregated table vs lower the min-samples threshold with noise tradeoff) and does not fit the scope of an "obvious correctness" sprint. Tracked as a separate TODO.
- **1000-row PostgREST cap on snapshot queries.** With retention at 2 rows/wallet and ~500 active wallets, the query returns ~1000 rows, exactly at the default cap. Today this is at the boundary, not beyond it. If retention ever increases (see above) or the cleanup cron fails, the cap becomes a real issue. Flag for revisit alongside the drawdown work, do not preempt here.
- **Caller-side observability** (fire-and-forget writes, breakdown reports intent not truth) belongs to [app/api/refresh-cohort/route.ts](../../../app/api/refresh-cohort/route.ts); the concurrent audit-remediation branch addresses it. This spec stays out of that file.

## Approach summary

- Add an explicit idle gate: if the latest snapshot is older than 3 days (or missing entirely), deactivate with reason `"idle"`. No grace. Runs first in the gate sequence.
- Promote the sanity guard from `console.warn` to `throw`, so a suspicious cycle never writes.

## Files changed

| File | Change |
|------|--------|
| `lib/cohort-hygiene.ts` | Modify. New gate, new reason, new predicate, throw on sanity abort. |
| `lib/__tests__/cohort-hygiene.test.ts` | Modify. New predicate tests, new orchestrator cases. |

No migration. No query changes. No RPC. The existing `.from("cohort_snapshots").select(...)` calls stay as written.

## Design detail

### lib/cohort-hygiene.ts changes

**Type additions:**

```ts
export type DeactivationReason = "low_equity" | "liq_imminent" | "drawdown_7d" | "idle";

export interface HygieneBreakdown {
  low_equity:                   number;
  liq_imminent:                 number;
  drawdown_7d:                  number;
  idle:                         number;
  total_deactivated_this_cycle: number;
  cohort_size_pre:              number;
  cohort_size_post:             number;
}
```

**New constant:**

```ts
const IDLE_THRESHOLD_MS = 3 * 24 * 60 * 60_000;
```

**New exported predicate:**

```ts
export function failsIdleGate(
  snapshotTime: string | null | undefined,
  nowMs:        number,
  maxIdleMs:    number = IDLE_THRESHOLD_MS,
): boolean {
  if (!snapshotTime) return true;
  return nowMs - new Date(snapshotTime).getTime() > maxIdleMs;
}
```

**Gate order in the wallet loop:**

```
for each walletId in activeWalletIds:
  snap  = latestByWallet.get(walletId) ?? undefined
  grace = graceByWallet.get(walletId)  ?? default

  # 1. Idle (NEW): missing snapshot OR > 3 days old, deactivate with no grace
  if failsIdleGate(snap?.snapshot_time, nowMs):
    deactivate "idle"; continue

  # From here, snap is guaranteed present and recent-enough to evaluate.
  if !snap: continue   # defensive only; idle gate already covered this

  # 2. Drawdown (unchanged; currently dead code, see follow-up section)
  # 3. Equity (unchanged)
  # 4. Liq-buffer (unchanged)
  # 5. Counter updates (unchanged)
```

The idle gate runs first. Once it passes, every downstream gate can trust that `snap` exists. The existing `if (!snap) continue` becomes defensive redundancy; keep it for safety rather than remove, since the alternative (idle gate trusting a map lookup always succeeds) is one refactor away from a null-deref.

**Sanity guard:**

```ts
const deactivationPct = toDeactivate.length / cohortSizePre;
if (deactivationPct > MAX_CYCLE_DEACTIVATION_PCT) {
  throw new Error(
    `[hygiene] sanity abort: would deactivate ${toDeactivate.length}/${cohortSizePre}` +
    ` (${(deactivationPct * 100).toFixed(1)}%), exceeds ${MAX_CYCLE_DEACTIVATION_PCT * 100}% threshold.` +
    ` No writes issued. Investigate gate logic before retrying.`,
  );
}
```

Throws before the DB write block, so aborts are atomic.

**Breakdown:**

```ts
const breakdown: HygieneBreakdown = {
  low_equity:                   byReason.get("low_equity")?.length   ?? 0,
  liq_imminent:                 byReason.get("liq_imminent")?.length ?? 0,
  drawdown_7d:                  byReason.get("drawdown_7d")?.length  ?? 0,
  idle:                         byReason.get("idle")?.length         ?? 0,
  total_deactivated_this_cycle: toDeactivate.length,
  cohort_size_pre:              cohortSizePre,
  cohort_size_post:             cohortSizePre - toDeactivate.length,
};
```

Empty-cohort early return also needs the `idle: 0` field.

### lib/__tests__/cohort-hygiene.test.ts changes

**New predicate tests** for `failsIdleGate`:
- null / undefined / empty string snapshot time returns true
- 0 ms age returns false
- exactly 3 days returns false (boundary, not exceeded)
- 3 days + 1 ms returns true
- custom `maxIdleMs` respected

**New orchestrator tests:**
- Wallet with latest snap 4 days old deactivates as `"idle"` with no grace.
- Wallet missing from the latest-snapshot query result entirely deactivates as `"idle"`.
- Idle check runs before drawdown and equity: wallet that is both idle and below equity floor is tagged `"idle"`, not `"low_equity"`.
- Sanity guard throws when >25% of cohort would deactivate; test asserts `mockWalletUpdates.length === 0`.
- Breakdown includes `idle: N` and `total_deactivated_this_cycle` sums correctly.

**Existing orchestrator tests:**
- **Rewrite** `"skips wallets with no recent snapshot without deactivating"` at [lib/__tests__/cohort-hygiene.test.ts:193](../../../lib/__tests__/cohort-hygiene.test.ts#L193). Its assertions directly contradict the new idle-gate behavior. Replace with the new "Wallet missing from the latest-snapshot query result entirely deactivates as idle" test above; the setup (empty snapshot response for a wallet in `activeWalletIds`) is reused.
- Update breakdown assertions in every other orchestrator test to include `idle: 0` where relevant. No mock rewrite needed (the snapshot query shape is unchanged).

## Risks and mitigations

1. **Audit-remediation rebase.** Their branch modifies [app/api/refresh-cohort/route.ts](../../../app/api/refresh-cohort/route.ts) (the sole caller). After their merge and rebase onto main, the caller's `HygieneBreakdown` has a new required `idle` field. Adding a required field to an interface is narrowing; code constructing the object must supply it. The caller only reads the breakdown (does not construct it), so rebase is a one-line change: add `idle` to the log string. No runtime breakage.
2. **Throw semantics in fire-and-forget.** The existing caller at [app/api/refresh-cohort/route.ts:515](../../../app/api/refresh-cohort/route.ts#L515) has `.catch((err) => console.error("[hygiene] error:", err))`. A `throw` from the sanity guard becomes a logged error, identical visibility to today's write-error path. No unhandled rejection.
3. **Legitimate mass-idle after outage.** If the snapshot-writer pipeline is down for >3 days and then recovers, every wallet briefly looks idle, the sanity guard trips, hygiene throws. No wallets get deactivated. The hygiene job stays blocked until operators investigate. This is arguably correct behavior, not a bug. Documented so the first on-call who sees it in logs knows why.
4. **Idle threshold tuning.** 3 days is a starting point. If operational reality shows this is too aggressive or too loose, tune via the `maxIdleMs` parameter (already testable). Not a risk, a knob.
5. **Branch discipline.** All work on `main` in the primary checkout. No push. No merge, rebase, or delete of `audit-remediation`. Out-of-scope per operational rule set for this session.

## Success criteria

- `npm run typecheck` passes.
- `npx vitest run` passes with the new and updated tests.
- A wallet whose snapshot stream dies for >3 days gets deactivated with `deactivation_reason = 'idle'` and no longer consumes cohort slots.
- A corrupted snapshot read that causes >25% spurious deactivations aborts the cycle with an error, leaves `wallets` table untouched.

## Explicit follow-up (out of this spec)

Resurrect the drawdown gate. Options to brainstorm when that work starts:
- Lower `MIN_DRAWDOWN_SNAPSHOTS` to 2 and live with noisier signal.
- Raise `cohort_snapshots` retention to N days (DB-size tradeoff on free tier).
- Add a new table or materialized view that keeps daily equity rollups per wallet for 30d, driven by the daily scan.
- Derive drawdown from an existing daily PnL series (migration 004 added a daily-backtest table; schema needs verification before committing to this path) via cumulative equity curve.

No option is obviously correct. Deserves its own brainstorm and a product decision about drawdown sensitivity vs storage cost.
