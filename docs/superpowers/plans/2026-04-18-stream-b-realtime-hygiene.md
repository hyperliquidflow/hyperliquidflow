# Stream B — Implementation Plan

**Spec:** [docs/superpowers/specs/2026-04-18-stream-b-realtime-hygiene.md](../specs/2026-04-18-stream-b-realtime-hygiene.md)
**Date:** 2026-04-18

---

## Key design decisions before coding

**Data source:** Hygiene gates evaluate ALL ~493 active wallets every cycle, not just the ~100 in the current scoring batch. The cron slices `wallets = allActive.slice(offset, offset + 100)` for API scoring, but the hygiene function has access to `allActive` (all active wallet IDs). It reads the latest `cohort_snapshots` row per wallet from Supabase — no extra API calls.

**Grace counter staleness:** A wallet's latest snapshot may be up to `allActive.length / 100 * 5 min` old (e.g., 493 wallets = ~25 min before it cycles back). Only increment or reset a grace counter when the snapshot `snapshot_time` is within 30 minutes. If the snapshot is older, hold the counter as-is (neither increment nor reset). This prevents falsely advancing a counter against stale data.

**Placement in cron:** Hygiene runs inside `after()`, same as the current `deactivateDustWallets`. The KV payload is written first, then hygiene fires. This means one cycle of lag between a blow-up and its deactivation — acceptable given the alternatives require blocking the response path.

**KV payload:** `hygiene_breakdown` is appended to `CohortCachePayload` (exported interface in `route.ts`) and written into the KV payload before the `kv.set` call, not inside `after()`. The breakdown from the *previous* hygiene run is what gets included (returned from the prior `after()` invocation and stored in a module-level ref). On the very first run the field is null. Consumers check for presence before rendering.

---

## Steps

### Step 1 — Migration

Create `supabase/migrations/009_wallet_hygiene.sql`:

```sql
alter table wallets
  add column if not exists deactivation_reason  text,
  add column if not exists deactivated_at        timestamptz,
  add column if not exists low_equity_cycles     smallint not null default 0,
  add column if not exists low_buffer_cycles     smallint not null default 0;

create index if not exists idx_wallets_deactivation_reason
  on wallets(deactivation_reason)
  where deactivation_reason is not null;
```

No data migration. Additive-only.

---

### Step 2 — `lib/cohort-hygiene.ts` (new file)

This module contains pure predicate functions and one async orchestrator. Keep DB writes in the orchestrator only so the predicates are unit-testable without mocks.

**Types needed:**

```ts
export interface WalletSnapshot {
  wallet_id:      string;
  account_value:  number;
  liq_buffer_pct: number | null;
  position_count: number;
  snapshot_time:  string; // ISO
}

export interface WalletGraceState {
  wallet_id:         string;
  low_equity_cycles: number;
  low_buffer_cycles: number;
}

export interface HygieneResult {
  deactivated: Array<{ wallet_id: string; reason: DeactivationReason }>;
  breakdown:   HygieneBreakdown;
}

export type DeactivationReason = "low_equity" | "liq_imminent" | "drawdown_7d";

export interface HygieneBreakdown {
  low_equity:                   number;
  liq_imminent:                 number;
  drawdown_7d:                  number;
  total_deactivated_this_cycle: number;
  cohort_size_pre:              number;
  cohort_size_post:             number;
}
```

**Pure predicates (unit-testable, no I/O):**

```ts
// Returns true if snapshot is fresh enough to act on
export function isSnapshotFresh(snapshotTime: string, nowMs: number, maxAgeMs = 30 * 60_000): boolean

// Returns true if equity is below floor
export function failsEquityGate(accountValue: number, floor = 10_000): boolean

// Returns true if liq buffer is critically low (open positions only)
export function failsLiqBufferGate(liqBuffer: number | null, positionCount: number, minBuffer = 0.05): boolean

// Returns true if 7d drawdown exceeds threshold
// Expects series sorted oldest-first. Returns false if fewer than MIN_DRAWDOWN_SNAPSHOTS values.
export function failsDrawdownGate(
  equitySeries: number[],
  maxDrawdown = 0.50,
  minSnapshots = 3
): boolean

// Computes next grace counter value
// Holds at current value if snapshot is stale (not fresh)
export function nextGraceCycles(
  current:    number,
  failing:    boolean,
  isFresh:    boolean,
  threshold:  number
): { next: number; deactivate: boolean }
```

**Async orchestrator `applyHygieneGates`:**

```ts
export async function applyHygieneGates(
  activeWalletIds: string[],   // allActive.map(w => w.id)
): Promise<HygieneResult>
```

Implementation:

1. Fetch latest snapshot per active wallet — one Supabase query using `distinct on (wallet_id)` ordered by `snapshot_time desc`. Result: `Map<wallet_id, WalletSnapshot>`.

2. Fetch last 7d of snapshots for all active wallets in one query (for drawdown gate). Group into `Map<wallet_id, number[]>` of `account_value` series, oldest-first.

3. Read current grace counters from `wallets` — one `select id, low_equity_cycles, low_buffer_cycles where id in (...)`.

4. Evaluate gates per wallet using the pure predicates above. Build three lists:
   - `toDeactivate: Array<{id, reason}>` — exhausted grace or drawdown failure
   - `graceUpdates: Array<{id, low_equity_cycles, low_buffer_cycles}>` — incremented but not yet terminal
   - `graceResets: string[]` — wallet IDs that passed all gates; reset both counters to 0

5. Sanity check: if `toDeactivate.length / activeWalletIds.length > MAX_CYCLE_DEACTIVATION_PCT (0.25)`, log a warning (still apply).

6. Batch DB writes:
   - `update wallets set is_active=false, deactivation_reason=X, deactivated_at=now() where id in (...)` — one call per distinct reason
   - `update wallets set low_equity_cycles=X, low_buffer_cycles=Y where id=Z` — upsert via `.upsert()` or individual updates batched by value if counts are small
   - `update wallets set low_equity_cycles=0, low_buffer_cycles=0 where id in (resets)` — one call

7. Return `HygieneResult`.

---

### Step 3 — Update `app/api/refresh-cohort/route.ts`

**3a. Add `hygiene_breakdown` to `CohortCachePayload`:**

```ts
export interface CohortCachePayload {
  // ... existing fields ...
  hygiene_breakdown: HygieneBreakdown | null;
}
```

**3b. Module-level mutable ref for last breakdown (avoids blocking KV write on hygiene execution):**

```ts
let lastHygieneBreakdown: HygieneBreakdown | null = null;
```

**3c. Include in payload build (uses previous cycle's result, null on first run):**

```ts
const payload: CohortCachePayload = {
  // ... existing fields ...
  hygiene_breakdown: lastHygieneBreakdown,
};
```

**3d. Replace `deactivateDustWallets` call in `after()` with:**

```ts
after(async () => {
  const result = await applyHygieneGates(allActive.map((w) => w.id))
    .catch((err) => {
      console.error("[hygiene] error:", err);
      return null;
    });
  if (result) {
    lastHygieneBreakdown = result.breakdown;
    console.log(
      `[hygiene] deactivated ${result.breakdown.total_deactivated_this_cycle} — ` +
      `low_equity: ${result.breakdown.low_equity}, ` +
      `liq_imminent: ${result.breakdown.liq_imminent}, ` +
      `drawdown_7d: ${result.breakdown.drawdown_7d}`
    );
  }
  // existing pruneUnderperformers remains
  pruneUnderperformers().catch(...)
});
```

**3e. Remove the `deactivateDustWallets` function** (functionality superseded by hygiene equity gate at the $10K floor; the new gate is strictly stronger).

**3f. Remove the `after()` call to `deactivateDustWallets`** (replaced above).

---

### Step 4 — `lib/server/kv-fetchers.ts`

`fetchCohortState` returns `CohortCachePayload | null` and the type is already imported from route.ts. No code change needed since `hygiene_breakdown` is added to the exported interface. Verify the type imports at the top of `kv-fetchers.ts` pick up the new field automatically.

If the Overview page reads `hygiene_breakdown`, it should handle `null` gracefully (first-run, or on KV cache miss falling back to Supabase where the field won't exist). Pattern: `payload?.hygiene_breakdown ?? null`.

---

### Step 5 — `lib/__tests__/cohort-hygiene.test.ts` (new file)

Test every pure predicate at boundary conditions:

| Test | Cases |
|---|---|
| `isSnapshotFresh` | exactly 30 min, 31 min, 0 min |
| `failsEquityGate` | $9,999 / $10,000 / $10,001 |
| `failsLiqBufferGate` | null buffer + positions, 0.04 + positions, 0.05 + positions, 0.04 + no positions |
| `failsDrawdownGate` | <3 snapshots (should return false), 50% drawdown, 51% drawdown, flat series |
| `nextGraceCycles` | stale snapshot holds, fresh failing increments, fresh passing resets, threshold breach deactivates |

Do not test `applyHygieneGates` directly — the orchestrator is integration-level; mock at the Supabase boundary if needed but the pure predicates are the important coverage.

---

### Step 6 — Verify

```bash
npm run typecheck   # must pass
npm run test        # must pass including new cohort-hygiene.test.ts
```

Manual smoke test (optional, no live creds needed for unit tests):
```sql
-- Seed a test active wallet with a $5K snapshot, then run the cron 3x and check:
select address, is_active, deactivation_reason, low_equity_cycles from wallets where ...;
```

---

### Step 7 — Docs

- Update `docs/sprints/status.md`: Stream B → IN PROGRESS when work starts, COMPLETE when criteria pass
- Update spec status header from `Draft (revised after audit)` → `COMPLETE`

---

## File summary

| File | Action |
|---|---|
| `supabase/migrations/009_wallet_hygiene.sql` | NEW |
| `lib/cohort-hygiene.ts` | NEW |
| `lib/__tests__/cohort-hygiene.test.ts` | NEW |
| `app/api/refresh-cohort/route.ts` | MODIFY (interface, module ref, after() block, remove deactivateDustWallets) |
| `lib/server/kv-fetchers.ts` | VERIFY (type import picks up new field, no code change expected) |
| `docs/sprints/status.md` | MODIFY |

---

## What this plan does NOT do (explicit non-goals)

- Re-check Stream A's 30d performance gates (win_rate / profit_factor) in cron — API cost is prohibitive
- Dormancy detection — Stream A's daily scan covers it
- Reactivation logic — Stream A daily scan covers it
- UI changes — Stream F
- Touching `scripts/daily-wallet-scan.ts`
