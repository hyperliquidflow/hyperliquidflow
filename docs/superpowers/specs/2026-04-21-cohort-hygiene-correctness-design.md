# Cohort Hygiene Correctness Fixes, Design

**Date:** 2026-04-21
**Scope:** [lib/cohort-hygiene.ts](../../../lib/cohort-hygiene.ts)
**Driver:** deeper audit of the Stream B hygiene gates surfaced three correctness issues. All deactivations flow through this module; silent bugs here produce the invisible failure mode "cohort silently drifts away from reality".

## Problems being fixed

1. **PostgREST 1000-row truncation on the 7d-series query.** [lib/cohort-hygiene.ts:138](../../../lib/cohort-hygiene.ts) selects every snapshot for every active wallet in the last 7 days with no bound. At ~500 active wallets and hourly cadence that is ~84k rows; PostgREST truncates at 1000 and the response also hits the 6MB cap. The drawdown gate is effectively disabled for ~99% of the cohort. The latest-snapshot query at line 116 has the same shape and is risky for the same reason.
2. **Dead-wallet bypass.** Line 179: `if (!snap) continue`. A wallet flagged `is_active=true` with no recent snapshot row is silently skipped, no counter advances, it sits in the cohort indefinitely.
3. **Sanity guard is advisory only.** Line 222 logs a warning when >25% of the cohort would be deactivated, then proceeds. A bad data pull can still nuke the cohort in one cycle.

The observability gap (fire-and-forget writes, breakdown reports intent not truth) belongs to the caller [app/api/refresh-cohort/route.ts](../../../app/api/refresh-cohort/route.ts); the concurrent audit-remediation branch addresses it. This spec stays out of that file.

## Approach summary

- Replace the two unbounded snapshot queries with aggregating Postgres RPCs. The DB returns a fixed row per wallet. No cap risk, no pagination code, faster.
- Add an explicit idle gate: if the latest snapshot is older than 3 days (or missing entirely), deactivate with reason `"idle"`. No grace.
- Promote the sanity guard from `console.warn` to `throw`, so a suspicious cycle never writes.

## Files changed

| File | Change |
|------|--------|
| `supabase/migrations/021_hygiene_rpcs.sql` | NEW. Two Postgres functions. |
| `lib/cohort-hygiene.ts` | Modify. New gate, new reason, new predicate, RPC calls, throw on sanity abort. |
| `lib/__tests__/cohort-hygiene.test.ts` | Modify. New predicate tests, RPC-shaped mocks, new orchestrator cases. |

Out of scope: `app/api/refresh-cohort/route.ts` (owned by concurrent session), caller-side observability, any schema change beyond adding functions.

## Design detail

### Migration 021: hygiene RPCs

```sql
-- supabase/migrations/021_hygiene_rpcs.sql

create or replace function hygiene_latest_snapshots(p_wallet_ids uuid[])
returns table (
  wallet_id      uuid,
  account_value  numeric,
  liq_buffer_pct numeric,
  position_count integer,
  snapshot_time  timestamptz
)
language sql
stable
as $$
  select distinct on (wallet_id)
    wallet_id, account_value, liq_buffer_pct, position_count, snapshot_time
  from cohort_snapshots
  where wallet_id = any(p_wallet_ids)
  order by wallet_id, snapshot_time desc;
$$;

create or replace function hygiene_drawdown_7d(p_wallet_ids uuid[])
returns table (
  wallet_id      uuid,
  max_drawdown   numeric,
  snapshot_count integer
)
language sql
stable
as $$
  with windowed as (
    select
      wallet_id,
      account_value,
      snapshot_time,
      max(account_value) over (
        partition by wallet_id
        order by snapshot_time
        rows between unbounded preceding and current row
      ) as running_peak
    from cohort_snapshots
    where wallet_id = any(p_wallet_ids)
      and snapshot_time >= now() - interval '7 days'
  )
  select
    wallet_id,
    coalesce(
      max(case when running_peak > 0 then 1 - account_value / running_peak else 0 end),
      0
    ) as max_drawdown,
    count(*)::int as snapshot_count
  from windowed
  group by wallet_id;
$$;

grant execute on function hygiene_latest_snapshots(uuid[]) to anon, authenticated, service_role;
grant execute on function hygiene_drawdown_7d(uuid[])       to anon, authenticated, service_role;
```

The drawdown RPC preserves current JS semantics: max drawdown observed anywhere in the 7d window, not just peak-to-current.

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

**Breaking signature change** to `failsDrawdownGate` (internal-only, only tests reference it):

```ts
export function failsDrawdownGate(
  maxDrawdown:   number,
  snapshotCount: number,
  threshold:     number = MAX_7D_DRAWDOWN,
  minSnapshots:  number = MIN_DRAWDOWN_SNAPSHOTS,
): boolean {
  if (snapshotCount < minSnapshots) return false;
  return maxDrawdown > threshold;
}
```

**Query replacement:**

```ts
const { data: latestSnaps, error: snapErr } = await supabase
  .rpc("hygiene_latest_snapshots", { p_wallet_ids: activeWalletIds });
if (snapErr) throw new Error(`[hygiene] latest-snaps rpc failed: ${snapErr.message}`);

const { data: drawdowns, error: ddErr } = await supabase
  .rpc("hygiene_drawdown_7d", { p_wallet_ids: activeWalletIds });
if (ddErr) throw new Error(`[hygiene] drawdown-7d rpc failed: ${ddErr.message}`);

const drawdownByWallet = new Map<string, { max_drawdown: number; snapshot_count: number }>();
for (const row of drawdowns ?? []) {
  drawdownByWallet.set(row.wallet_id, {
    max_drawdown:   Number(row.max_drawdown),
    snapshot_count: row.snapshot_count,
  });
}
```

`Number(row.max_drawdown)` because Supabase returns Postgres `numeric` as a string in the JSON response.

**Gate order in the wallet loop:**

```
for each walletId in activeWalletIds:
  snap  = latestByWallet.get(walletId) ?? null
  grace = graceByWallet.get(walletId)  ?? default
  dd    = drawdownByWallet.get(walletId) ?? { max_drawdown: 0, snapshot_count: 0 }

  # 1. Idle: missing snapshot OR > 3 days old, deactivate with no grace
  if failsIdleGate(snap?.snapshot_time, nowMs):
    deactivate "idle"; continue

  # 2. Drawdown: max DD in 7d window > 50%, deactivate with no grace
  if failsDrawdownGate(dd.max_drawdown, dd.snapshot_count):
    deactivate "drawdown_7d"; continue

  # 3. Equity gate (grace)
  if equity result deactivates: "low_equity"; continue

  # 4. Liq-buffer gate (grace)
  if buffer result deactivates: "liq_imminent"; continue

  # 5. Counter updates (unchanged)
```

Note: once idle runs first, the `if (!snap) continue` on line 179 becomes dead code. Remove it.

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

Throws before any DB writes, so aborts are atomic.

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

### lib/__tests__/cohort-hygiene.test.ts changes

**Mock rewrite.** Replace the builder-chain mock with an RPC queue keyed by function name, plus the existing wallets-table builder:

```ts
let mockRpcResponses: Record<string, Array<{ data: unknown; error: { message: string } | null }>> = {};
let mockWalletResponses: Array<{ data: unknown; error: { message: string } | null }> = [];
let mockWalletUpdates: Array<{ payload: Record<string, unknown>; ids: unknown[] }> = [];

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    rpc: vi.fn((name: string) => {
      const queue = mockRpcResponses[name] ?? [];
      return Promise.resolve(queue.shift() ?? { data: [], error: null });
    }),
    from: vi.fn(() => walletBuilder),
  })),
}));
```

**New predicate tests** for `failsIdleGate`:
- null snapshot time returns true
- 0 ms age returns false
- exactly 3 days returns false (boundary, not exceeded)
- 3 days + 1 ms returns true
- custom `maxIdleMs` respected

**Updated predicate tests** for `failsDrawdownGate`:
- snapshotCount below minSnapshots returns false (even with huge max_drawdown)
- max_drawdown above threshold returns true
- max_drawdown at threshold returns false (boundary)
- custom threshold respected

**New orchestrator tests:**
- Wallet with latest snap 4 days old deactivates as `"idle"` with no grace.
- Wallet missing from `hygiene_latest_snapshots` result entirely deactivates as `"idle"`.
- Idle check short-circuits drawdown and equity checks (wallet is tagged `"idle"`, never stacked with another reason).
- Sanity guard throws when >25% of cohort would deactivate; test asserts no wallet updates were written.
- Breakdown includes `idle: N` field and `total_deactivated_this_cycle` sums correctly.

**Updated orchestrator tests:** replace raw-series drawdown stubs with RPC-shaped `{ wallet_id, max_drawdown, snapshot_count }` rows.

## Risks and mitigations

The user flagged to be extra aware of risks. Explicit list:

1. **Deploy ordering: migration must land before TS.** If the TS ships first, every hygiene run hits "function hygiene_latest_snapshots does not exist" and throws; combined with the new sanity-guard `throw` mindset the hygiene result is always an exception. Mitigation: commit the migration in one commit, apply it to Supabase, then commit the TS. Two commits in order. Document in the commit messages.
2. **SQL semantics drift from JS.** The running-peak window function must match the JS loop that tracks max-observed-drawdown. Mitigation: dedicated test asserting drawdown value for a known series ([100, 200, 80, 150] must produce 0.60 drawdown, not 0.25). The RPC is not under vitest, so the assertion runs in an integration-style setup test or in CI as a Postgres-backed test. For the initial change we verify by hand-computing against the SQL in a psql session before committing, and document the expected values in the migration comment.
3. **Column type confirmed as `uuid`.** [supabase/migrations/001_initial_schema.sql:27](../../../supabase/migrations/001_initial_schema.sql) defines `cohort_snapshots.wallet_id UUID`. RPC parameters use `uuid[]`. Supabase client coerces JS string arrays to uuid at the driver layer; no extra cast needed in TS.
4. **Function name collision.** `create or replace` silently replaces existing functions with the same signature. Mitigation: the `hygiene_` prefix is new; confirm with `\df hygiene_*` in psql before applying. If a clash is found, rename.
5. **Audit-remediation rebase collision.** Their branch modifies `app/api/refresh-cohort/route.ts` (the sole caller). After their merge and rebase onto main, the caller sees a new `idle` field in `HygieneBreakdown`. If they destructure the breakdown, TypeScript catches it as a widening; if they spread-log it, runtime prints the new field. Mitigation: add `idle` to the breakdown as an optional-at-construction field only if needed. As written it is always present and TypeScript-required, which is the intended contract. One-line cosmetic update on their side when they rebase.
6. **Throw semantics in a fire-and-forget context.** Pre-rebase, the caller wraps `applyHygieneGates(...).then(...).catch(...)` inside `after(Promise.all(...))`. Throwing in the promise chain triggers the existing `.catch` logger. No silent failure. Post-rebase, audit-remediation's wrapper surfaces it more prominently. Either way, no partial writes.
7. **Empty-cohort early return.** The existing `if (cohortSizePre === 0)` early return is preserved. The new breakdown shape still passes `{idle: 0, ...}`; update the early-return object so tests do not fail on a missing field.
8. **Concurrent editing on main.** The user is the only person on main; the other session is on `audit-remediation`. No concurrent writer risk as long as the rule ("stay on main, do not push audit-remediation") holds. No rebase or force push here.
9. **Migration rollback.** If migration 021 lands and causes trouble (e.g. permissions misconfigured), the rollback is `drop function hygiene_latest_snapshots(text[]); drop function hygiene_drawdown_7d(text[]);` plus reverting the TS commit. Reversible within minutes.
10. **`numeric` returns as string.** Supabase returns Postgres `numeric` as a string in JSON; plain `row.max_drawdown > 0.5` does string comparison. Mitigation: cast with `Number(...)` at parse time, covered explicitly in the code above.

## Success criteria

- `npm run typecheck` passes.
- `npx vitest run` passes with the new and updated tests.
- Manual acceptance: staging Supabase has migration 021 applied; a dry-run hygiene call against a realistic active-wallet list returns `cohort_size_pre == activeWalletIds.length`, a non-zero `idle` count for wallets that genuinely stopped snapshotting, and a `drawdown_7d` count that reflects the full cohort (not truncated).
- Future incident check: a corrupted snapshot table producing >25% spurious deactivations causes a cycle to abort with an error, not silently wipe the cohort.
