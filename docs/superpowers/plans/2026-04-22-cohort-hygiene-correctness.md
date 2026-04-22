# Cohort Hygiene Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close two correctness holes in Stream B hygiene: silently-idle wallets that never get deactivated, and a sanity guard that warns but does not abort bad cycles.

**Architecture:** Add a new idle gate that runs first in the per-wallet loop (no grace, deactivates when latest snapshot is missing or older than 3 days). Promote the `>25%` cycle-wide sanity guard from `console.warn` to `throw` so a suspicious cycle never writes. Scope is confined to [lib/cohort-hygiene.ts](../../../lib/cohort-hygiene.ts) and its test file. No migration. No RPC. No caller changes.

**Tech Stack:** TypeScript, Vitest, Supabase (unchanged query shape), Next.js App Router (caller unchanged).

**Spec:** [docs/superpowers/specs/2026-04-21-cohort-hygiene-correctness-design.md](../specs/2026-04-21-cohort-hygiene-correctness-design.md)

---

## File Structure

| File | Responsibility |
|------|----------------|
| `lib/cohort-hygiene.ts` | Adds `IDLE_THRESHOLD_MS` constant, `failsIdleGate` pure predicate, `"idle"` reason, `idle: number` breakdown field. Wires idle check as first gate in the loop. Converts the sanity guard from warn to throw. |
| `lib/__tests__/cohort-hygiene.test.ts` | Adds `failsIdleGate` predicate tests, new orchestrator cases for idle + sanity abort, updates existing breakdown assertions to include `idle: 0`, rewrites the test at line 268 whose assertions now contradict the new gate. |

No other files touched.

---

## Task 1: `failsIdleGate` pure predicate

**Files:**
- Modify: `lib/cohort-hygiene.ts` (add constant + exported predicate near the other pure predicates around line 37)
- Test: `lib/__tests__/cohort-hygiene.test.ts` (add new `describe` block near the other predicate blocks, around line 143)

- [ ] **Step 1: Write the failing tests**

Add this block to `lib/__tests__/cohort-hygiene.test.ts` immediately before the `describe("nextGraceCycles", ...)` block. The `failsIdleGate` name must be added to the import list at the top (line 52 onward).

Update the import:

```ts
import {
  isSnapshotFresh,
  failsEquityGate,
  failsLiqBufferGate,
  failsDrawdownGate,
  failsIdleGate,
  nextGraceCycles,
  applyHygieneGates,
} from "../cohort-hygiene";
```

Append the new describe block:

```ts
describe("failsIdleGate", () => {
  const DAY = 24 * 60 * 60_000;

  it("returns true for null snapshot time", () => {
    expect(failsIdleGate(null, NOW)).toBe(true);
  });
  it("returns true for undefined snapshot time", () => {
    expect(failsIdleGate(undefined, NOW)).toBe(true);
  });
  it("returns true for empty-string snapshot time", () => {
    expect(failsIdleGate("", NOW)).toBe(true);
  });
  it("returns false at 0 ms age", () => {
    expect(failsIdleGate(ago(0), NOW)).toBe(false);
  });
  it("returns false at exactly 3 days (boundary, not exceeded)", () => {
    expect(failsIdleGate(ago(3 * DAY), NOW)).toBe(false);
  });
  it("returns true at 3 days + 1 ms", () => {
    expect(failsIdleGate(ago(3 * DAY + 1), NOW)).toBe(true);
  });
  it("respects custom maxIdleMs", () => {
    expect(failsIdleGate(ago(2 * DAY), NOW, 1 * DAY)).toBe(true);
    expect(failsIdleGate(ago(2 * DAY), NOW, 3 * DAY)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/__tests__/cohort-hygiene.test.ts`

Expected: the 7 new tests fail at the import line with a message like "failsIdleGate is not exported from ../cohort-hygiene". Existing tests still pass.

- [ ] **Step 3: Implement the predicate**

Open `lib/cohort-hygiene.ts`. Add the constant next to the other top-of-file constants (around line 15, immediately after `SNAPSHOT_FRESHNESS_MS`):

```ts
const IDLE_THRESHOLD_MS = 3 * 24 * 60 * 60_000;
```

Add the predicate inside the "Pure predicates" section, immediately after the `isSnapshotFresh` export (around line 43):

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

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/__tests__/cohort-hygiene.test.ts`

Expected: all 7 new predicate tests pass. The existing 40 tests still pass. Total: 47.

- [ ] **Step 5: Commit**

```bash
git add lib/cohort-hygiene.ts lib/__tests__/cohort-hygiene.test.ts
git commit -m "feat(hygiene): add failsIdleGate pure predicate"
```

---

## Task 2: Extend `DeactivationReason` and `HygieneBreakdown` with `idle`

**Files:**
- Modify: `lib/cohort-hygiene.ts` (type + interface + empty-cohort return around lines 19, 21-28, 102-109, 287-294)
- Test: `lib/__tests__/cohort-hygiene.test.ts` (update existing breakdown assertions at lines 184-191 and 459-466)

This task is type-only plus the orchestrator return shape. It does not change runtime behavior (no wallet can be deactivated as `"idle"` until Task 3 wires the gate). The shadow `idle: 0` is added to both the empty-cohort early return and the final breakdown.

- [ ] **Step 1: Update the failing test assertions**

In `lib/__tests__/cohort-hygiene.test.ts`, update the empty-cohort test (around line 181) to include `idle: 0`:

```ts
  it("returns empty breakdown and makes no DB calls for empty cohort", async () => {
    const result = await applyHygieneGates([]);
    expect(result.deactivated).toEqual([]);
    expect(result.breakdown).toEqual({
      low_equity: 0,
      liq_imminent: 0,
      drawdown_7d: 0,
      idle: 0,
      total_deactivated_this_cycle: 0,
      cohort_size_pre: 0,
      cohort_size_post: 0,
    });
    expect(mockWalletUpdates).toHaveLength(0);
  });
```

Update the mixed-reasons breakdown assertion (around line 459) to include `idle: 0`:

```ts
    expect(result.breakdown).toMatchObject({
      low_equity: 1,
      drawdown_7d: 1,
      liq_imminent: 1,
      idle: 0,
      total_deactivated_this_cycle: 3,
      cohort_size_pre: 4,
      cohort_size_post: 1,
    });
```

Note: `toMatchObject` would tolerate a missing `idle` field in the implementation, but `toEqual` on the empty-cohort test will not. Keep both updated so the type extension is exercised.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/__tests__/cohort-hygiene.test.ts`

Expected: the empty-cohort test fails because `result.breakdown` lacks `idle`.

- [ ] **Step 3: Extend the type and interface**

In `lib/cohort-hygiene.ts`, change the `DeactivationReason` type (line 19):

```ts
export type DeactivationReason = "low_equity" | "liq_imminent" | "drawdown_7d" | "idle";
```

Change the `HygieneBreakdown` interface (lines 21-28):

```ts
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

Update the empty-cohort early return block (lines 102-109):

```ts
  if (cohortSizePre === 0) {
    return {
      deactivated: [],
      breakdown: {
        low_equity: 0, liq_imminent: 0, drawdown_7d: 0, idle: 0,
        total_deactivated_this_cycle: 0,
        cohort_size_pre: 0, cohort_size_post: 0,
      },
    };
  }
```

Update the final breakdown construction (lines 287-294):

```ts
  const breakdown: HygieneBreakdown = {
    low_equity:                   byReason.get("low_equity")?.length   ?? 0,
    liq_imminent:                 byReason.get("liq_imminent")?.length  ?? 0,
    drawdown_7d:                  byReason.get("drawdown_7d")?.length   ?? 0,
    idle:                         byReason.get("idle")?.length          ?? 0,
    total_deactivated_this_cycle: toDeactivate.length,
    cohort_size_pre:              cohortSizePre,
    cohort_size_post:             cohortSizePre - toDeactivate.length,
  };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/__tests__/cohort-hygiene.test.ts`

Expected: all 47 tests pass.

Run: `npm run typecheck`

Expected: passes. No consumers of `HygieneBreakdown` construct the object themselves.

- [ ] **Step 5: Commit**

```bash
git add lib/cohort-hygiene.ts lib/__tests__/cohort-hygiene.test.ts
git commit -m "feat(hygiene): extend DeactivationReason and HygieneBreakdown with idle"
```

---

## Task 3: Wire idle gate into `applyHygieneGates` loop

**Files:**
- Modify: `lib/cohort-hygiene.ts` (insert idle check at the top of the per-wallet loop around line 175)
- Test: `lib/__tests__/cohort-hygiene.test.ts` (rewrite the test at line 268; add three new cases)

This is the behavior change. The idle check runs first inside the per-wallet loop. It looks at `latestByWallet.get(walletId)?.snapshot_time` (which may be undefined if the wallet has no snapshot row at all). If `failsIdleGate` returns true, push an `"idle"` deactivation with no grace and `continue`.

The existing `if (!snap) continue;` stays as defensive redundancy.

- [ ] **Step 1: Rewrite the contradicting test and add new cases**

The test at line 268 (`"skips wallets with no recent snapshot without deactivating"`) asserts the exact opposite of the new gate behavior. Delete it and replace with the block below. Also add new tests after it.

Replace lines 268 to 287 (the `"skips wallets with no recent snapshot..."` test block) with:

```ts
  it("deactivates wallet with no snapshot row as idle with no grace", async () => {
    mockSnapshotResponses = [
      { data: [], error: null },
      { data: [], error: null },
    ];
    mockWalletResponses = [
      {
        data: [{ id: "w-missing", low_equity_cycles: 2, low_buffer_cycles: 1 }],
        error: null,
      },
    ];

    const result = await applyHygieneGates(["w-missing"]);

    expect(result.deactivated).toEqual([{ wallet_id: "w-missing", reason: "idle" }]);
    expect(result.breakdown.idle).toBe(1);
    expect(result.breakdown.cohort_size_post).toBe(0);
    const deactivate = mockWalletUpdates.find(
      (u) => u.payload.is_active === false && u.payload.deactivation_reason === "idle",
    );
    expect(deactivate).toBeDefined();
    expect(deactivate?.ids).toEqual(["w-missing"]);
  });

  it("deactivates wallet whose latest snapshot is 4 days old as idle", async () => {
    const FOUR_DAYS = 4 * 24 * 60 * 60_000;
    mockSnapshotResponses = [
      {
        data: [
          {
            wallet_id: "w-stale",
            account_value: 50_000,
            liq_buffer_pct: 0.4,
            position_count: 0,
            snapshot_time: ago(FOUR_DAYS),
          },
        ],
        error: null,
      },
      { data: [], error: null },
    ];
    mockWalletResponses = [
      {
        data: [{ id: "w-stale", low_equity_cycles: 0, low_buffer_cycles: 0 }],
        error: null,
      },
    ];

    const result = await applyHygieneGates(["w-stale"]);

    expect(result.deactivated).toEqual([{ wallet_id: "w-stale", reason: "idle" }]);
    expect(result.breakdown.idle).toBe(1);
  });

  it("idle gate runs before equity: idle-and-low-equity wallet is tagged idle, not low_equity", async () => {
    const FOUR_DAYS = 4 * 24 * 60 * 60_000;
    mockSnapshotResponses = [
      {
        data: [
          {
            wallet_id: "w-both",
            account_value: 0,
            liq_buffer_pct: null,
            position_count: 0,
            snapshot_time: ago(FOUR_DAYS),
          },
        ],
        error: null,
      },
      { data: [], error: null },
    ];
    mockWalletResponses = [
      {
        data: [{ id: "w-both", low_equity_cycles: 2, low_buffer_cycles: 0 }],
        error: null,
      },
    ];

    const result = await applyHygieneGates(["w-both"]);

    expect(result.deactivated).toEqual([{ wallet_id: "w-both", reason: "idle" }]);
    expect(result.breakdown.idle).toBe(1);
    expect(result.breakdown.low_equity).toBe(0);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/__tests__/cohort-hygiene.test.ts`

Expected: the three new idle-orchestrator tests fail.

- [ ] **Step 3: Wire the idle gate**

Open `lib/cohort-hygiene.ts` and modify the per-wallet loop (starting at line 175). Insert the idle check as the very first gate, immediately after the `snap`/`grace` lookup and BEFORE the `if (!snap) continue;` line:

```ts
  for (const walletId of activeWalletIds) {
    const snap  = latestByWallet.get(walletId);
    const grace = graceByWallet.get(walletId) ?? { low_equity_cycles: 0, low_buffer_cycles: 0 };

    // 1. Idle gate: missing snapshot OR latest snapshot older than IDLE_THRESHOLD_MS.
    if (failsIdleGate(snap?.snapshot_time, nowMs)) {
      toDeactivate.push({ wallet_id: walletId, reason: "idle" });
      continue;
    }

    if (!snap) continue; // defensive; idle gate above already covered this

    const fresh  = isSnapshotFresh(snap.snapshot_time, nowMs);
    const series = seriesByWallet.get(walletId) ?? [];

    // (remainder of existing loop unchanged)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/__tests__/cohort-hygiene.test.ts`

Expected: all tests pass. Total count after this task: 50.

- [ ] **Step 5: Commit**

```bash
git add lib/cohort-hygiene.ts lib/__tests__/cohort-hygiene.test.ts
git commit -m "feat(hygiene): wire idle gate into applyHygieneGates"
```

---

## Task 4: Promote sanity guard from warn to throw

**Files:**
- Modify: `lib/cohort-hygiene.ts` (lines 222 to 228, inside the sanity check block)
- Test: `lib/__tests__/cohort-hygiene.test.ts` (add new test inside the `applyHygieneGates` describe block)

The current sanity block at line 222 logs a warning and proceeds. Swap for a `throw` so the writes never happen when the cohort would shrink by more than 25% in one cycle. The throw runs BEFORE the DB write block, so aborts are atomic.

- [ ] **Step 1: Write the failing test**

Add this test inside the `applyHygieneGates` describe block, after the existing `"aggregates breakdown across mixed deactivation reasons"` test (around line 470):

```ts
  it("sanity guard throws and issues no writes when >25% of cohort would deactivate", async () => {
    mockSnapshotResponses = [
      {
        data: [
          { wallet_id: "wC", account_value: 500_000, liq_buffer_pct: 0.5, position_count: 0, snapshot_time: ago(5 * MIN) },
          { wallet_id: "wD", account_value: 500_000, liq_buffer_pct: 0.5, position_count: 0, snapshot_time: ago(5 * MIN) },
        ],
        error: null,
      },
      { data: [], error: null },
    ];
    mockWalletResponses = [
      {
        data: [
          { id: "wA", low_equity_cycles: 0, low_buffer_cycles: 0 },
          { id: "wB", low_equity_cycles: 0, low_buffer_cycles: 0 },
          { id: "wC", low_equity_cycles: 0, low_buffer_cycles: 0 },
          { id: "wD", low_equity_cycles: 0, low_buffer_cycles: 0 },
        ],
        error: null,
      },
    ];

    await expect(applyHygieneGates(["wA", "wB", "wC", "wD"])).rejects.toThrow(/sanity abort/);
    expect(mockWalletUpdates).toHaveLength(0);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/__tests__/cohort-hygiene.test.ts`

Expected: the new sanity test fails because `applyHygieneGates` currently logs a warning and resolves instead of throwing.

- [ ] **Step 3: Change warn to throw**

In `lib/cohort-hygiene.ts`, replace lines 222 to 228 (the `console.warn` block inside the `// 5. Sanity check` section) with:

```ts
  // 5. Sanity check: abort if too many wallets would be deactivated in one cycle.
  const deactivationPct = toDeactivate.length / cohortSizePre;
  if (deactivationPct > MAX_CYCLE_DEACTIVATION_PCT) {
    throw new Error(
      `[hygiene] sanity abort: would deactivate ${toDeactivate.length}/${cohortSizePre}` +
      ` (${(deactivationPct * 100).toFixed(1)}%), exceeds ${MAX_CYCLE_DEACTIVATION_PCT * 100}% threshold.` +
      ` No writes issued. Investigate gate logic before retrying.`,
    );
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/__tests__/cohort-hygiene.test.ts`

Expected: all tests pass. Total count: 51.

- [ ] **Step 5: Commit**

```bash
git add lib/cohort-hygiene.ts lib/__tests__/cohort-hygiene.test.ts
git commit -m "fix(hygiene): promote sanity guard from warn to throw"
```

---

## Task 5: Full verification

This is the wrap-up. Type check, full test run, sanity sweep of the diff against the spec.

- [ ] **Step 1: Typecheck the repo**

Run: `npm run typecheck`

Expected: 0 errors. If the caller [app/api/refresh-cohort/route.ts](../../../app/api/refresh-cohort/route.ts) flags a missing `idle` field in a log string, that file has likely been touched by the parallel `audit-remediation` branch. Do NOT modify it here; surface the failure to the user for rebase coordination.

- [ ] **Step 2: Run the full test suite**

Run: `npx vitest run`

Expected: all tests pass, including the 51 in `lib/__tests__/cohort-hygiene.test.ts`. No unrelated test files should have changed.

- [ ] **Step 3: Verify no em/en dashes in the diff**

Run: `git diff main -- lib/cohort-hygiene.ts lib/__tests__/cohort-hygiene.test.ts | LC_ALL=C grep -nP '[\xe2][\x80][\x93\x94]' || echo "clean"`

Expected output: `clean`. The pre-commit hook would have caught this already, but a post-check is cheap.

- [ ] **Step 4: Confirm spec coverage**

Compare the diff against `docs/superpowers/specs/2026-04-21-cohort-hygiene-correctness-design.md`:

- `failsIdleGate` predicate exists and is exported: check with `grep -n 'export function failsIdleGate' lib/cohort-hygiene.ts`
- `DeactivationReason` includes `"idle"`: `grep -n 'idle' lib/cohort-hygiene.ts | head`
- Idle gate is the first gate in the wallet loop: read the loop at lines 175 to 190
- Sanity block throws instead of warns: `grep -n 'sanity abort' lib/cohort-hygiene.ts`
- Breakdown object has `idle:` field in both the empty-return and final-return paths: `grep -n 'idle:' lib/cohort-hygiene.ts`

Expected: all five checks hit.

- [ ] **Step 5: Final status check**

Run: `git status` and `git log --oneline -5`

Expected: clean working tree, 4 commits on top of `main` (Tasks 1 through 4). No files outside `lib/cohort-hygiene.ts` and `lib/__tests__/cohort-hygiene.test.ts` modified.

No commit for this task itself (it is verification only). Report to the user that the plan is complete and the branch is ready for review.

---

## Self-Review Notes

- **Spec coverage**: every item in the spec's "Approach summary" and "Design detail" maps to a step in Tasks 1 through 4. The drawdown-dead-code and 1000-row-cap items are explicitly out of scope per the spec's follow-up section.
- **Test rewrite**: Task 3 deletes the old `"skips wallets with no recent snapshot..."` test (lines 268 to 287 in the current file) because its assertions contradict the new idle gate. Replaced with `"deactivates wallet with no snapshot row as idle with no grace"` that reuses the same mock setup.
- **Type consistency**: `failsIdleGate` signature (`string | null | undefined`, `number`, `number`) matches the call site `failsIdleGate(snap?.snapshot_time, nowMs)` where `snap?.snapshot_time` is `string | undefined`.
- **Risk note**: if the snapshot-writer pipeline is down for more than 3 days and then recovers, every wallet looks idle, the sanity guard trips, and hygiene throws. This is arguably correct. The caller's fire-and-forget `.catch` logs the error; nothing deactivates. An on-call reading the log sees the reason plainly.
- **No dashes**: drafted without em-dashes and en-dashes per the CLAUDE.md copy rule. Hyphens only in identifiers and code comments where the hook allows them.
