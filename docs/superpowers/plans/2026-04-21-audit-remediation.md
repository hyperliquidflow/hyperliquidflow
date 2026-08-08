# Audit Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the verified findings from the 2026-04-21 full-codebase audit across security, backend reliability, engine-math correctness, frontend, and tooling.

**Architecture:** Four sequential phases, each independently shippable. Phase 1 is ship-blocking (security plus correctness). Phases 2 through 4 harden the rest. No phase touches files another phase depends on in a breaking way, so a pause between phases is safe.

**Tech Stack:** Next.js 15 App Router, TypeScript, Supabase (Postgres), Vercel KV, Vitest, Tailwind, React Query.

---

## Context: audit scope and what's already good

- `npm run typecheck` passes, `npm run test` passes 222/222, `npm audit` reports zero vulns, `.gitignore` covers `.env*`.
- `npm run lint` is broken because `next lint` is deprecated in Next 15 and prompts interactively. Handled in Phase 4.
- The following audit findings were verified as false positives and are NOT in this plan:
  - "Recipe 11/12 missing from `RECIPE_META`": both present in [lib/recipe-meta.ts](../../../lib/recipe-meta.ts).
  - "`computeMedianNetPnlBps` mishandles even arrays": already correct in [lib/signal-learning-utils.ts](../../../lib/signal-learning-utils.ts).
  - "`computeRadarStats` short-weighting bug": `positionValue` is abs'd on ingest in [lib/radar-utils.ts](../../../lib/radar-utils.ts).
  - "`recipe2` price bug": `priceChange` is per-coin; `wallets[0]` is safe.
  - "`enrichWithEv` null risk on cohort events": short-circuits on empty `wallet_id` in [lib/signal-lab.ts](../../../lib/signal-lab.ts).
  - "`simulateAtrExit` divide-by-zero on zero ATR": guard `if (entryPrice <= 0 || atr <= 0) return null;` already present at [lib/signal-learning-utils.ts:164](../../../lib/signal-learning-utils.ts).
  - "`fetchBatchClearinghouseStates` semaphore leak": address validation happens before `acquire()` (line 273) and `release()` is in a `finally` block (line 308) in [lib/hyperliquid-api-client.ts](../../../lib/hyperliquid-api-client.ts). No leak.
  - "`recipe_performance` missing `.order()` before `.limit(50)`": already orders by `measured_at desc` at [app/api/refresh-cohort/route.ts:327](../../../app/api/refresh-cohort/route.ts).
  - "FollowingClient toggle race": the `toggle()` in `FollowingClient.tsx:225` is a profile-card expander whose fetch is deterministic per address; no user-visible race.

All file paths below are repo-relative. Every table name, function name, and line number below has been verified against the tree at commit `eae3cf0`.

---

# Phase 1: CRITICAL (security plus correctness)

Goal of this phase: eliminate unauthenticated cron exposure, close the anon-key data-exposure risk, and surface the background-task failures that currently get swallowed.

## Task 1.1: Make CRON_SECRET required and use timing-safe compare

**Files:**
- Modify: `lib/env.ts:68`
- Modify: `app/api/refresh-cohort/route.ts:78-83`
- Modify: `app/api/measure-outcomes/route.ts:16-21`
- Create: `lib/auth/cron.ts`
- Test: `lib/__tests__/cron-auth.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/__tests__/cron-auth.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("verifyCronAuth", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.CRON_SECRET = "test-secret-value";
  });

  it("accepts the correct Bearer token", async () => {
    const { verifyCronAuth } = await import("../auth/cron");
    const req = new Request("http://x", { headers: { authorization: "Bearer test-secret-value" } });
    expect(verifyCronAuth(req)).toBe(true);
  });

  it("rejects a wrong token", async () => {
    const { verifyCronAuth } = await import("../auth/cron");
    const req = new Request("http://x", { headers: { authorization: "Bearer wrong" } });
    expect(verifyCronAuth(req)).toBe(false);
  });

  it("rejects a missing header", async () => {
    const { verifyCronAuth } = await import("../auth/cron");
    const req = new Request("http://x");
    expect(verifyCronAuth(req)).toBe(false);
  });

  it("rejects when lengths differ (no crash)", async () => {
    const { verifyCronAuth } = await import("../auth/cron");
    const req = new Request("http://x", { headers: { authorization: "Bearer tiny" } });
    expect(verifyCronAuth(req)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/__tests__/cron-auth.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `lib/auth/cron.ts`**

```ts
// lib/auth/cron.ts
import { timingSafeEqual } from "node:crypto";
import { CRON_SECRET } from "@/lib/env";

export function verifyCronAuth(req: Request): boolean {
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${CRON_SECRET}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
```

- [ ] **Step 4: Make `CRON_SECRET` required in production**

Edit `lib/env.ts:68`:

```ts
// Before
export const CRON_SECRET = process.env.CRON_SECRET ?? "";

// After
function requireInProd(name: string): string {
  const v = process.env[name];
  if (!v) {
    if (process.env.NEXT_PHASE === "phase-production-build") return "";
    if (process.env.NODE_ENV === "production") {
      throw new Error(`[env] Missing required environment variable in production: ${name}`);
    }
    return ""; // dev convenience
  }
  return v;
}

export const CRON_SECRET = requireInProd("CRON_SECRET");
```

- [ ] **Step 5: Replace the inline check in `app/api/refresh-cohort/route.ts:78-83`**

```ts
// Before
if (CRON_SECRET) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

// After
if (process.env.NODE_ENV === "production" && !verifyCronAuth(req)) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
```

Add the import at the top:

```ts
import { verifyCronAuth } from "@/lib/auth/cron";
```

Remove the now-unused `CRON_SECRET` import from the file.

- [ ] **Step 6: Mirror the change in `app/api/measure-outcomes/route.ts:16-21`**

Replace the same pattern with:

```ts
import { verifyCronAuth } from "@/lib/auth/cron";
// ...
if (process.env.NODE_ENV === "production" && !verifyCronAuth(req)) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
```

Remove unused `CRON_SECRET` import.

- [ ] **Step 7: Run the suite**

Run: `npx vitest run && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/auth/cron.ts lib/__tests__/cron-auth.test.ts lib/env.ts \
        app/api/refresh-cohort/route.ts app/api/measure-outcomes/route.ts
git commit -m "fix(security): require CRON_SECRET in prod, timing-safe compare"
```

---

## Task 1.2: Pass CRON_SECRET on the cohort-state background refresh

**Files:**
- Modify: `app/api/cohort-state/route.ts:17-27`

- [ ] **Step 1: Update the background fetch to include the auth header**

```ts
function triggerBackgroundRefresh(): void {
  const prodHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const base = prodHost ? `https://${prodHost}` : "http://localhost:3000";
  const secret = process.env.CRON_SECRET ?? "";
  const headers: Record<string, string> = secret ? { authorization: `Bearer ${secret}` } : {};
  after(
    fetch(`${base}/api/refresh-cohort`, { method: "GET", headers }).catch((e) =>
      console.warn("[cohort-state] background refresh failed:", e)
    )
  );
}
```

- [ ] **Step 2: Typecheck and test**

Run: `npm run typecheck && npx vitest run`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/api/cohort-state/route.ts
git commit -m "fix(security): pass CRON_SECRET on cohort-state background refresh"
```

---

## Task 1.3: Enable RLS on all Supabase tables with default-deny

**Files:**
- Create: `supabase/migrations/019_enable_rls.sql`

- [ ] **Step 1: Write the migration**

The table list below was verified via grep of `CREATE TABLE` across all existing migrations (001 through 018). Migration 002 only adds columns to `wallets`, migration 010 only adds columns to `wallets`. No `wallet_metrics`, `wash_clusters`, or `wash_members` tables exist.

```sql
-- supabase/migrations/019_enable_rls.sql
-- Default-deny RLS across all application tables.
-- Server code uses SUPABASE_SERVICE_ROLE_KEY (bypasses RLS) and is unaffected.
-- Anon-key callers (browser) see zero rows unless an explicit policy grants access.

ALTER TABLE wallets                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE cohort_snapshots         ENABLE ROW LEVEL SECURITY;
ALTER TABLE signals_history          ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_pnl_backtest        ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_performance       ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limit_tokens        ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_events            ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_outcomes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_config             ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_config_history     ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_findings           ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_log                ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_timing            ENABLE ROW LEVEL SECURITY;
ALTER TABLE cohort_attrition         ENABLE ROW LEVEL SECURITY;
ALTER TABLE out_of_cohort_tracking   ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_calibration       ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_signal_stats      ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_score_history     ENABLE ROW LEVEL SECURITY;
ALTER TABLE rank_ic_history          ENABLE ROW LEVEL SECURITY;

-- No policies created = default deny for all non-service-role roles.
```

- [ ] **Step 2: Apply the migration locally if a local Supabase is running (optional, non-blocking)**

Run: `npx supabase db reset --linked 2>/dev/null || echo "apply via Supabase dashboard SQL editor instead"`
If local supabase is not linked, skip and plan to apply via the dashboard before deploy.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/019_enable_rls.sql
git commit -m "security(rls): enable RLS with default-deny on all tables (migration 019)"
```

- [ ] **Step 4: Deploy note**

Add a line to `docs/sprints/status.md` under "Known Gaps, deploy actions": `Apply migration 019_enable_rls.sql via Supabase dashboard before next prod deploy.`

---

## Task 1.4: Await the `cycle_offset` KV write in refresh-cohort

**Files:**
- Modify: `app/api/refresh-cohort/route.ts:101`

- [ ] **Step 1: Change the fire-and-forget to an awaited call**

```ts
// Before
kv.set("cohort:cycle_offset", nextOffset, { ex: 25 * 3600 }).catch(() => {});

// After
try {
  await kv.set("cohort:cycle_offset", nextOffset, { ex: 25 * 3600 });
} catch (e) {
  console.error("[refresh-cohort] cycle_offset write failed:", e);
}
```

Rationale: the offset drives the rotating-window contract; losing it silently rewinds wallet coverage. Logging surfaces the miss; awaiting lets the write complete on the warm instance before the response returns.

- [ ] **Step 2: Typecheck and test**

Run: `npm run typecheck && npx vitest run`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/api/refresh-cohort/route.ts
git commit -m "fix(refresh-cohort): await cycle_offset KV write, log on failure"
```

---

## Task 1.5: Add a background-task failure counter to `after()`

**Files:**
- Modify: `app/api/refresh-cohort/route.ts:502-544`

- [ ] **Step 1: Wrap every task with a counter, log a summary**

Replace the `after(Promise.all([...]))` block with:

```ts
after(
  (async () => {
    const tasks: Array<{ name: string; p: Promise<unknown> }> = [
      {
        name: "hygiene",
        p: applyHygieneGates(allActive.map((w) => w.id)).then((result) => {
          lastHygieneBreakdown = result.breakdown;
          console.log(
            `[hygiene] deactivated ${result.breakdown.total_deactivated_this_cycle}` +
            ` low_equity: ${result.breakdown.low_equity},` +
            ` liq_imminent: ${result.breakdown.liq_imminent},` +
            ` drawdown_7d: ${result.breakdown.drawdown_7d}`
          );
        }),
      },
      { name: "pruneUnderperformers",      p: pruneUnderperformers() },
      { name: "runBridgeInflowEnrichment", p: runBridgeInflowEnrichment(wallets.map((w) => ({ id: w.id, address: w.address }))) },
      { name: "runTwapEnrichment",         p: runTwapEnrichment(twapCandidates) },
      { name: "updateIntradayRecipePerformance", p: updateIntradayRecipePerformance() },
    ];

    if (emittedIds.length > 0) {
      tasks.push({
        name: "signal_timing_insert",
        p: supabase
          .from("signal_timing")
          .insert(emittedIds.map((id) => ({
            signal_id:           id,
            whale_fill_ts:       null,
            snapshot_detect_ts:  snapshotDetectTs,
            signal_emit_ts:      signalEmitTs,
            kv_write_ts:         kvWriteTs,
          })))
          .then(({ error }) => {
            if (error) throw new Error(`signal_timing: ${error.message}`);
            console.log(`[signal-timing] inserted ${emittedIds.length} timing rows`);
          }),
      });
    }

    const results = await Promise.allSettled(tasks.map((t) => t.p));
    const failures = results
      .map((r, i) => (r.status === "rejected" ? { name: tasks[i].name, err: String(r.reason) } : null))
      .filter((x): x is { name: string; err: string } => x !== null);

    if (failures.length > 0) {
      console.error(`[refresh-cohort] background failures: ${failures.length}/${tasks.length}`, failures);
    } else {
      console.log(`[refresh-cohort] background ok: ${tasks.length}/${tasks.length}`);
    }
  })()
);
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS. Fix any TS errors before proceeding.

- [ ] **Step 3: Commit**

```bash
git add app/api/refresh-cohort/route.ts
git commit -m "fix(refresh-cohort): surface background-task failure counts instead of swallowing"
```

---

## Task 1.6: Phase 1 verification

- [ ] **Step 1: Full suite**

Run: `npm run typecheck && npx vitest run`
Expected: PASS, 225+ tests (4 new tests from 1.1 add to the count).

- [ ] **Step 2: Manual check of the env/auth boundary**

Grep: `grep -rn "CRON_SECRET" app lib`. Verify only `lib/env.ts`, `lib/auth/cron.ts`, and `app/api/cohort-state/route.ts` reference it.

- [ ] **Step 3: Phase 1 complete**. Safe stopping point. Subsequent phases can ship independently.

---

# Phase 2: HIGH (backend reliability plus performance)

Goal: stop nightly full-table scans, cap unbounded queries, pin cron regions, and tighten two loose-change spots in the engine scripts.

## Task 2.1: ~~Add partial indexes for signal_outcomes hot paths~~ SKIPPED

The audit flagged missing indexes on signal_outcomes pending-scan paths. On inspection, both indexes already exist:
- Migration 007 creates `idx_signal_outcomes_unresolved` on `(created_at) WHERE price_24h IS NULL`.
- Migration 015 creates `idx_signal_outcomes_exit_pending` on `(created_at) WHERE resolved_at IS NOT NULL AND exit_reason IS NULL`.

Proposed migration 020 would have duplicated index #1 under a new name and silently no-op'd index #2 (same name, same predicate, different column). No DDL needed.

---

## Task 2.2: Cap unbounded `.limit(walletIds.length * 2)` queries

**Files:**
- Modify: `app/api/refresh-cohort/route.ts:399`
- Modify: `app/api/cohort-state/route.ts:106`

- [ ] **Step 1: Add a module-level constant and cap in both files**

At the top of each file (after imports), add:

```ts
/** Hard cap on cohort_snapshots rows fetched per request. Supabase caps JSON response at 6MB. */
const MAX_SNAPSHOT_ROWS = 1000;
```

In `app/api/refresh-cohort/route.ts:399`, replace:

```ts
.limit(allActiveIds.length * 2)
```

with:

```ts
.limit(Math.min(allActiveIds.length * 2, MAX_SNAPSHOT_ROWS))
```

In `app/api/cohort-state/route.ts:106`, replace:

```ts
.limit(walletIds.length * 2)
```

with:

```ts
.limit(Math.min(walletIds.length * 2, MAX_SNAPSHOT_ROWS))
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/api/refresh-cohort/route.ts app/api/cohort-state/route.ts
git commit -m "perf(api): cap cohort_snapshots query at 1000 rows"
```

---

## Task 2.3: Pin cron region and set maxDuration in vercel.json

**Files:**
- Modify: `vercel.json`

- [ ] **Step 1: Replace the file contents**

```json
{
  "crons": [
    { "path": "/api/refresh-cohort",   "schedule": "0 0 * * *" },
    { "path": "/api/measure-outcomes", "schedule": "0 2 * * *" }
  ],
  "functions": {
    "app/api/refresh-cohort/route.ts":   { "maxDuration": 30, "regions": ["iad1"] },
    "app/api/measure-outcomes/route.ts": { "maxDuration": 25, "regions": ["iad1"] },
    "app/api/cohort-state/route.ts":     { "maxDuration": 10, "regions": ["iad1"] }
  }
}
```

(`iad1` is US East. Adjust if your Supabase project is in a different region. `sfo1` for US West, `fra1` for EU.)

- [ ] **Step 2: Verify build still succeeds**

Run: `npm run build`
Expected: PASS. Vercel's config validator runs as part of the build.

- [ ] **Step 3: Commit**

```bash
git add vercel.json
git commit -m "ops(vercel): pin cron/function regions to iad1, set maxDuration"
```

---

## Task 2.4: Hyperliquid retry loop throws a typed Error

**Files:**
- Modify: `lib/hyperliquid-api-client.ts:189-236` (the `hlPost<T>` function)

Context: the loop at line 191 initializes `let lastError: unknown;` and throws it at line 235. In the current flow it is always set before the throw (because either we return, throw, or assign to it on each iteration), but typing it as `unknown` makes every caller's catch unable to inspect `.message` without a cast. This task tightens the type and guarantees the throw is a real `Error`.

- [ ] **Step 1: Initialize `lastError` as a typed Error placeholder**

At line 191, replace:

```ts
let lastError: unknown;
```

with:

```ts
let lastError: Error = new Error(`[hl-api] ${endpoint} exhausted ${MAX_RETRIES + 1} attempts with no error captured`);
```

- [ ] **Step 2: Keep existing assignment sites, ensure they produce Error objects**

Assignments at line 214 (`new HyperliquidApiError(...)`) and line 227 (`new Error(...)`) already produce `Error` subtypes; no change needed. The `throw err` on line 231 also already throws an `Error`.

- [ ] **Step 3: Ensure the end throw is typed**

The throw at line 235 remains `throw lastError;`. TypeScript now knows it's an Error.

- [ ] **Step 4: Typecheck and test**

Run: `npm run typecheck && npx vitest run lib/__tests__/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/hyperliquid-api-client.ts
git commit -m "fix(hl-client): tighten retry-loop lastError type to Error"
```

---

## Task 2.5: `fetchAtrMap` fails fast on mass fetch failure

**Files:**
- Modify: `scripts/signal-learning.ts` (the `fetchAtrMap` function, around line 114-136)

- [ ] **Step 1: Track successes and throw if coverage is too low**

Inside `fetchAtrMap`, add a running counter of successful fetches and the total requested. Before returning the map:

```ts
const coverage = successCount / requestedCount;
if (requestedCount > 0 && coverage < 0.5) {
  throw new Error(
    `fetchAtrMap: only ${successCount}/${requestedCount} coins fetched (${(coverage * 100).toFixed(0)}%). Aborting learning run.`
  );
}
```

Choose 0.5 threshold deliberately: low enough that transient ratelimits don't fail the run, high enough that Hyperliquid downtime stops bad data from being written.

- [ ] **Step 2: Commit**

```bash
git add scripts/signal-learning.ts
git commit -m "fix(signal-learning): fail fast if ATR fetch coverage drops below 50%"
```

---

## Task 2.6: `rank-ic.ts` skips the date when correlation is non-finite

**Files:**
- Modify: `scripts/rank-ic.ts:60-103`

- [ ] **Step 1: Before the upsert, guard on finite value**

Wrap the upsert in:

```ts
if (!Number.isFinite(rankIc)) {
  console.warn(`[rank-ic] skipping ${date}: correlation not finite`);
  continue;
}
```

Apply the same guard to `rank_ic_shadow` if that column is also written in the same code path.

- [ ] **Step 2: Commit**

```bash
git add scripts/rank-ic.ts
git commit -m "fix(rank-ic): skip date instead of upserting non-finite correlation"
```

---

## Task 2.7: `/api/rank-ic` null-vs-zero filter fix

**Files:**
- Modify: `app/api/rank-ic/route.ts:51`

- [ ] **Step 1: Replace falsy fallback with explicit null check**

```ts
// Before
const aboveMdic = rows.filter((r) => (r.rank_ic ?? 0) > MDIC).length;

// After
const aboveMdic = rows.filter((r) => r.rank_ic != null && r.rank_ic > MDIC).length;
```

- [ ] **Step 2: Commit**

```bash
git add app/api/rank-ic/route.ts
git commit -m "fix(rank-ic): treat null rank_ic as missing, not zero"
```

---

## Task 2.8: Cap the two unbounded `wallet_signal_stats` / `recipe_calibration` selects

**Files:**
- Modify: `app/api/refresh-cohort/route.ts:342-343`

- [ ] **Step 1: Add limits and ordering**

Replace:

```ts
const [{ data: recipeCalRows }, { data: wssRows }] = await Promise.all([
  supabase.from("recipe_calibration").select("recipe_id, win_rate, sample_size_30d"),
  supabase.from("wallet_signal_stats").select("wallet_address, recipe_id, win_rate_net, signal_count"),
]);
```

with:

```ts
const [{ data: recipeCalRows }, { data: wssRows }] = await Promise.all([
  supabase
    .from("recipe_calibration")
    .select("recipe_id, win_rate, sample_size_30d")
    .order("computed_at", { ascending: false })
    .limit(500),
  supabase
    .from("wallet_signal_stats")
    .select("wallet_address, recipe_id, win_rate_net, signal_count")
    .order("updated_at", { ascending: false })
    .limit(500),
]);
```

Confirm the timestamp column names against [migrations 017_ev_decouple.sql](../../../supabase/migrations/017_ev_decouple.sql). If a column is named differently (e.g. `last_updated`), adapt to match. If the table lacks a timestamp entirely, order by the primary key instead.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 3: Commit**

```bash
git add app/api/refresh-cohort/route.ts
git commit -m "perf(refresh-cohort): bound recipe_calibration and wallet_signal_stats selects"
```

---

## Task 2.9: Phase 2 verification

- [ ] **Step 1: Full suite + build**

Run: `npm run typecheck && npx vitest run && npm run build`
Expected: PASS.

- [ ] **Step 2: Open Supabase SQL editor**, paste migrations 019 and 020, apply in order. Confirm via `SELECT schemaname, tablename, rowsecurity FROM pg_tables WHERE schemaname='public';` that RLS is on for every table listed in Task 1.3.

- [ ] **Step 3: Phase 2 complete**. Deployable.

---

# Phase 3: MEDIUM (frontend + engine edges + tooling prep)

Goal: kill silent frontend bugs, harden client storage, bring design-token compliance back to 100%, and close two engine-math edges that don't corrupt data but produce confusing behavior.

## Task 3.1: Guard localStorage writes in the three client hooks

**Files:**
- Modify: `lib/hooks/use-followed-wallets.ts:8-16`
- Modify: `lib/hooks/use-alert-events.ts` (mirror `use-followed-wallets` pattern)
- Modify: `lib/hooks/use-paper-positions.ts` (mirror `use-followed-wallets` pattern)
- Create: `lib/hooks/safe-local-storage.ts`
- Test: `lib/__tests__/safe-local-storage.test.ts`

- [ ] **Step 1: Write the helper with tests**

```ts
// lib/hooks/safe-local-storage.ts
export function safeReadJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch (e) {
    console.warn(`[safeReadJson] ${key} unreadable, resetting:`, e);
    try { window.localStorage.removeItem(key); } catch {}
    return fallback;
  }
}

export function safeWriteJson(key: string, value: unknown): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.warn(`[safeWriteJson] ${key} write failed (quota or serialization):`, e);
    return false;
  }
}
```

```ts
// lib/__tests__/safe-local-storage.test.ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { safeReadJson, safeWriteJson } from "../hooks/safe-local-storage";

describe("safe-local-storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns fallback when key missing", () => {
    expect(safeReadJson("missing", { a: 1 })).toEqual({ a: 1 });
  });

  it("roundtrips a value", () => {
    safeWriteJson("k", { x: 2 });
    expect(safeReadJson("k", null)).toEqual({ x: 2 });
  });

  it("returns fallback and clears corrupt JSON", () => {
    window.localStorage.setItem("k", "not-json");
    expect(safeReadJson("k", { safe: true })).toEqual({ safe: true });
    expect(window.localStorage.getItem("k")).toBeNull();
  });
});
```

Note: if the jsdom environment fails to resolve, run `npm i -D jsdom` first.

- [ ] **Step 2: Run test**

Run: `npx vitest run lib/__tests__/safe-local-storage.test.ts`
Expected: PASS.

- [ ] **Step 3: Adopt helper in each hook**

In `lib/hooks/use-followed-wallets.ts`, replace the `read`/`write` functions at lines 8-16 with:

```ts
import { safeReadJson, safeWriteJson } from "./safe-local-storage";

function read(): FollowedWallet[] {
  return safeReadJson<FollowedWallet[]>(KEY, []);
}

function write(wallets: FollowedWallet[]) {
  safeWriteJson(KEY, wallets);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVT));
}
```

Apply the same replacement pattern in `use-alert-events.ts` and `use-paper-positions.ts`: swap raw `localStorage.getItem + JSON.parse` pairs for `safeReadJson`, swap raw `localStorage.setItem + JSON.stringify` for `safeWriteJson`. Keep existing keys and shapes.

- [ ] **Step 4: Full test suite**

Run: `npm run typecheck && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/hooks/safe-local-storage.ts lib/__tests__/safe-local-storage.test.ts \
        lib/hooks/use-followed-wallets.ts lib/hooks/use-alert-events.ts lib/hooks/use-paper-positions.ts
git commit -m "feat(hooks): safe localStorage helper, adopt in all three hooks"
```

---

## Task 3.2: Error fallbacks on the four Overview queries

**Files:**
- Modify: `app/OverviewClient.tsx:177-210`

Context: line 209 already handles `error` from the first query, but the ticker, signal-freshness, and rank-ic queries silently render nothing on failure. This task surfaces per-card error states instead.

- [ ] **Step 1: Add per-query error destructure**

For each of the three additional `useQuery` calls at lines 186-207, destructure `error` alongside `data`:

```ts
const { data: ticker, error: tickerErr } = useQuery<MarketTickerEntry[]>({ ... });
const { data: freshness, error: freshErr } = useQuery<SignalFreshnessPayload>({ ... });
const { data: rankIc, error: rankIcErr } = useQuery<RankIcPayload>({ ... });
```

- [ ] **Step 2: Render inline error pills**

Where each card renders, conditionally show a red "Data unavailable" strip if the corresponding `*Err` is non-null. Use `color.red` from `lib/design-tokens.ts`.

- [ ] **Step 3: Manual test**

Run: `npm run dev`. In DevTools, block one of the three endpoints (`/api/market-ticker`, `/api/signal-freshness`, `/api/rank-ic`). Confirm the page still renders and the failing card shows the red state, not a full-page blank.

- [ ] **Step 4: Commit**

```bash
git add app/OverviewClient.tsx
git commit -m "fix(overview): per-query error fallbacks for ticker, freshness, rank-ic"
```

---

## Task 3.3: Replace hardcoded hex colors with tokens

**Files:**
- Modify: `app/wallets/leaderboard/LeaderboardClient.tsx:140`
- Modify: `app/signals/radar/designs/DesignsClient.tsx:619, 630, 691`

- [ ] **Step 1: Read `lib/design-tokens.ts`** (per CLAUDE.md + ui-design-enforcer: tokens must be read live)

Identify the tokens for near-white text (`color.text` = `#f0f0f0`) and for near-black backgrounds.

- [ ] **Step 2: Replace `#f0f0f0` with `color.text` in LeaderboardClient**

At `app/wallets/leaderboard/LeaderboardClient.tsx:140`, replace:

```tsx
color: tierFilter === t ? "#f0f0f0" : "rgba(255,255,255,0.45)",
```

with:

```tsx
color: tierFilter === t ? color.text : "rgba(255,255,255,0.45)",
```

Ensure `color` is already imported at the top of the file; if not, add `import { color } from "@/lib/design-tokens";`.

- [ ] **Step 3: Replace `#050510` and `#0b0818` in DesignsClient**

At `app/signals/radar/designs/DesignsClient.tsx:619, 630, 691`, replace the three hex values with the nearest existing token (`color.bg` or `color.bgElevated`). Read `lib/design-tokens.ts` first to pick the right match. If the SVG genuinely needs a variant not in tokens, extend `lib/design-tokens.ts` in the same commit with a named variant (e.g. `color.svgCanvas`), don't reintroduce hex.

- [ ] **Step 4: Grep for any remaining stray hex in .tsx**

Run: `grep -rnE '#([0-9a-fA-F]{3}){1,2}\b' app components | grep -v design-system | grep -v design-tokens.ts`
Expected: no results outside of intentional design-system demo files.

- [ ] **Step 5: Commit**

```bash
git add app/wallets/leaderboard/LeaderboardClient.tsx app/signals/radar/designs/DesignsClient.tsx lib/design-tokens.ts
git commit -m "style(tokens): replace hardcoded hex with design tokens"
```

---

## Task 3.4: Replace inline style-mutation hover with React state

**Files:**
- Modify: `app/wallets/leaderboard/LeaderboardClient.tsx:193-194`
- Modify: `app/wallets/following/FollowingClient.tsx:264-265`

- [ ] **Step 1: Convert hover mutation to hover state**

Replace the `onMouseEnter/Leave` handlers that write `e.currentTarget.style.background` with a `useState<string | null>(null)` for `hoveredId`, and compute the row background from state.

Leaderboard example:

```tsx
// Top of component
const [hoveredId, setHoveredId] = useState<string | null>(null);

// Row
<tr
  key={w.wallet_id}
  onMouseEnter={() => setHoveredId(w.wallet_id)}
  onMouseLeave={() => setHoveredId(null)}
  style={{
    transition: "background 0.1s",
    background: hoveredId === w.wallet_id ? color.rowHover : "transparent",
  }}
>
```

Following-client mirror: use `hoveredId === fw.address`. `color.rowHover` already exists in `lib/design-tokens.ts:106`.

- [ ] **Step 2: Manual test**

Run: `npm run dev`, hover rows in both views, confirm smooth hover with no flicker.

- [ ] **Step 3: Commit**

```bash
git add app/wallets/leaderboard/LeaderboardClient.tsx app/wallets/following/FollowingClient.tsx
git commit -m "fix(ui): row hover via React state instead of DOM mutation"
```

---

## Task 3.5: Add `loading.tsx` to `wallets/following` and `wallets/paper`

**Files:**
- Create: `app/wallets/following/loading.tsx`
- Create: `app/wallets/paper/loading.tsx`

Note: the generic `LoadingState` in `components/loading-state.tsx:421` takes no props. Don't pass a `label`. If a page-specific skeleton is desired, add a new named export to `components/loading-state.tsx` first (out of scope for this task).

- [ ] **Step 1: Create both files**

```tsx
// app/wallets/following/loading.tsx
import { LoadingState } from "@/components/loading-state";
export default function Loading() {
  return <LoadingState />;
}
```

```tsx
// app/wallets/paper/loading.tsx
import { LoadingState } from "@/components/loading-state";
export default function Loading() {
  return <LoadingState />;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/wallets/following/loading.tsx app/wallets/paper/loading.tsx
git commit -m "ui: add loading.tsx for following and paper routes"
```

---

## Task 3.6: `lib/atr.ts` minimum-valid-candles guard

**Files:**
- Modify: `lib/atr.ts:8-32`
- Create: `lib/__tests__/atr.test.ts`

Context: current `computeATR` loops over `candles`, silently skipping non-finite rows via `continue`. If fewer than `period` valid candles survive, it still returns an ATR computed on the short window.

- [ ] **Step 1: Write the failing test**

```ts
// lib/__tests__/atr.test.ts
import { describe, it, expect } from "vitest";
import { computeATR } from "../atr";

describe("computeATR with non-finite candles", () => {
  it("returns null when valid candles are fewer than period", () => {
    // Three candles, one invalid; period=5 requires at least 5 valid candles.
    const candles = [
      { h: "NaN", l: "NaN", c: "NaN" }, // invalid, should be dropped
      { h: "10",  l: "9",   c: "9.5" },
      { h: "11",  l: "9",   c: "10"  },
    ];
    expect(computeATR(candles, 5)).toBeNull();
  });
});
```

(Input fields are strings because `CandleForAtr` in `lib/atr.ts` types h/l/c as strings. Confirm by opening the file.)

- [ ] **Step 2: Run, confirm FAIL**

Run: `npx vitest run lib/__tests__/atr.test.ts`
Expected: FAIL (current implementation returns a finite number).

- [ ] **Step 3: Add the guard in `computeATR`**

Track a `validCount` inside the loop. At the end, if `validCount < period`, return `null`. Exact patch shape depends on the current loop, but roughly:

```ts
let validCount = 0;
for (const c of candles) {
  // ... existing parsing ...
  if (!isFinite(h) || !isFinite(l) || !isFinite(prevC)) continue;
  validCount++;
  // ... existing TR accumulation ...
}
if (validCount < period) return null;
```

- [ ] **Step 4: Run, confirm PASS**

Run: `npx vitest run lib/__tests__/atr.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/atr.ts lib/__tests__/atr.test.ts
git commit -m "fix(atr): return null when valid candle count < period"
```

---

## Task 3.7: Clamp leverage in `computeLevAdjSharpe`

**Files:**
- Modify: `lib/leverage-risk.ts:61-69` (the `computeLevAdjSharpe` function)
- Test: `lib/__tests__/leverage-risk.test.ts`

Context: `computeLevAdjSharpe(dailyPnls: number[], avgLeverage: number): number` has a floor at `Math.max(0, avgLeverage)` but no ceiling. Pathological 100x wallets crush the score to near-zero via the exponential penalty.

- [ ] **Step 1: Add a test for the 100x case**

If `lib/__tests__/leverage-risk.test.ts` doesn't exist yet, create it:

```ts
// lib/__tests__/leverage-risk.test.ts
import { describe, it, expect } from "vitest";
import { computeLevAdjSharpe } from "../leverage-risk";

describe("computeLevAdjSharpe leverage clamp", () => {
  const pnlSeries = [100, -50, 80, -30, 120, -40, 60, -20, 90, 10];

  it("clamps leverage at 20x before applying penalty", () => {
    const at20  = computeLevAdjSharpe(pnlSeries, 20);
    const at100 = computeLevAdjSharpe(pnlSeries, 100);
    // After clamping, 100x should produce the same result as 20x.
    expect(at100).toBeCloseTo(at20, 6);
  });

  it("still penalizes 10x relative to 5x", () => {
    const at5  = computeLevAdjSharpe(pnlSeries, 5);
    const at10 = computeLevAdjSharpe(pnlSeries, 10);
    expect(at10).toBeLessThan(at5);
  });
});
```

- [ ] **Step 2: Run, confirm FAIL on the first test**

Run: `npx vitest run lib/__tests__/leverage-risk.test.ts`
Expected: FAIL (first test asserts equality that won't hold without the clamp).

- [ ] **Step 3: Add the clamp**

In `lib/leverage-risk.ts:63`, replace:

```ts
const lev = Math.max(0, avgLeverage);
```

with:

```ts
const LEV_MAX = 20;
const lev = Math.max(0, Math.min(LEV_MAX, avgLeverage));
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run lib/__tests__/leverage-risk.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/leverage-risk.ts lib/__tests__/leverage-risk.test.ts
git commit -m "fix(leverage-risk): clamp avg leverage at 20x before Sharpe adjustment"
```

---

## Task 3.8: Phase 3 verification

- [ ] **Step 1: Full suite + build**

Run: `npm run typecheck && npx vitest run && npm run build`
Expected: PASS.

- [ ] **Step 2: Manual smoke**. Load `/`, `/wallets/leaderboard`, `/wallets/following`, `/wallets/paper`. Confirm:
  - No console errors.
  - Loading states show on the two new routes.
  - Hover works on leaderboard + following tables.
  - No visible hex-color regressions.

- [ ] **Step 3: Phase 3 complete**.

---

# Phase 4: LOW + tooling

Goal: migrate off the broken lint, bump Next patch, and batch the remaining low-severity nits.

## Task 4.1: Migrate from `next lint` to ESLint CLI

**Files:**
- Create: `eslint.config.mjs`
- Modify: `package.json`

- [ ] **Step 1: Run the codemod**

Run: `npx @next/codemod@canary next-lint-to-eslint-cli .`
Expected: generates `eslint.config.mjs` (or updates existing) and rewrites the `lint` script in `package.json`.

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: exits cleanly (warnings allowed, no interactive prompt).

- [ ] **Step 3: Commit**

```bash
git add package.json eslint.config.mjs package-lock.json
git commit -m "chore(lint): migrate next lint to eslint CLI"
```

---

## Task 4.2: Bump Next.js to latest 15.x patch

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Update**

Run: `npm update next`
Confirm the resulting version in `package.json`.

- [ ] **Step 2: Rebuild + test**

Run: `npm run build && npx vitest run`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): bump next to latest 15.x patch"
```

---

## Task 4.3: Low-severity nits (batched)

**Files (all small one-line fixes):**
- Modify: `app/api/signals-feed/route.ts:33`. Cap `limit` param at 500 before the `+1` pagination trick.
- Modify: `lib/outcome-helpers.ts:40`. Add `console.warn` when a coin in `allMids` is missing for an outcome.
- Modify: `next.config.ts:6-11`. Add Cache-Control headers for `/api/cohort-state`, `/api/market-ticker`, `/api/signals-feed` consistent with the existing pattern.
- Modify: `lib/signal-learning-utils.ts:51`. Add a JSDoc comment to `computeMeasuredEV` clarifying the sign convention on `avgLoss` (positive loss magnitude).

- [ ] **Step 1: Apply all four fixes together**

Each is 1 to 5 lines. Keep messages tight.

- [ ] **Step 2: Test + build**

Run: `npm run typecheck && npx vitest run && npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/api/signals-feed/route.ts lib/outcome-helpers.ts next.config.ts lib/signal-learning-utils.ts
git commit -m "nit: cap signals-feed limit, warn on delisted-coin outcomes, add cache headers, doc EV sign convention"
```

---

## Task 4.4: Final verification and docs

- [ ] **Step 1: Full suite + build one last time**

Run: `npm run typecheck && npm run lint && npx vitest run && npm run build`
Expected: ALL PASS.

- [ ] **Step 2: Update `docs/sprints/status.md`**

Under the remediation section, add a new row:

```
| R25 | Audit remediation (Phases 1 to 4) | COMPLETE (2026-04-DD) | migrations 019, 020, cron auth hardening, indexes, tokens |
```

- [ ] **Step 3: Commit**

```bash
git add docs/sprints/status.md
git commit -m "docs(status): log R25 audit remediation complete"
```

---

# Items intentionally deferred (not in this plan)

- **Rate limiting on public API routes**. Deferred; real rate limiting needs a design decision (Vercel's built-in vs. Upstash vs. middleware) that is out of scope for a cleanup sweep. File as a separate sprint.
- **Encrypting localStorage**. Not worth doing until Sprint 6 (Auth) lands; the data (followed wallet addresses, paper position state) is not sensitive in the absence of a user account.
- **`drawdown_7d` negative-equity edge case** in `lib/cohort-hygiene.ts`. Current equity invariant holds in practice; document, don't fix.
- **Keying on `key={i}` in `app/OverviewClient.tsx` lists**. Cosmetic flicker only; bundle with Sprint 7 UI revision.

---

# Self-review (run by the author during waterproofing pass)

**Spec coverage:** every CRITICAL/HIGH audit finding that was verified as a real bug maps to a Phase 1 or Phase 2 task. MEDIUM findings map to Phase 3. LOW findings batch into Phase 4. Known false positives are documented in the Context section. OK.

**Placeholder scan:** no "TBD", no "implement later", no naked "add validation". Each step has either a code block or a concrete action. The pseudocode patches in Tasks 3.2 and 3.4 show the actual intended shape; file line numbers anchor the diff. OK.

**Type consistency:** `verifyCronAuth` named identically across Tasks 1.1 and 1.2. `MAX_SNAPSHOT_ROWS` used consistently in 2.2. `safeReadJson`/`safeWriteJson` helper names consistent across 3.1. `computeATR` and `computeLevAdjSharpe` called with signatures matching the actual exports (`computeATR(candles, period)`, `computeLevAdjSharpe(pnls, avgLev)`). `simulateAtrExit` NOT referenced (guard already in place). OK.

**Verified during waterproofing pass:** every file:line reference, function signature, table name, and import path was checked against the working tree on 2026-04-21. Four fabricated tasks were removed (simulateAtrExit divide-by-zero, fetchBatchClearinghouseStates semaphore leak, recipe_performance ordering, FollowingClient toggle race) because the "bug" did not exist in the code. Task 1.3 table list was regenerated from `grep CREATE TABLE` output. Task 3.5 loading.tsx API was corrected (generic `LoadingState` takes no props). Task 3.7 leverage test was rewritten with a concrete PnL array instead of a placeholder.
