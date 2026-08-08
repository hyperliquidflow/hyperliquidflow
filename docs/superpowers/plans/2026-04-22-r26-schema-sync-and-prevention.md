# R26 Schema Sync and Drift Prevention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the six missing Supabase migrations (011 through 019) to production in a verified order, then install CI and runtime guards so this class of silent drift cannot recur.

**Architecture:** Two phases. Phase A (Tasks 1 to 12) is a one-shot remediation: take a backup, pause the nightly scan, apply migrations sequentially via `mcp__supabase-mcp__apply_migration` with a row-or-column verification SELECT after each, then resume the scan and watch for regressions. Phase B (Tasks 13 to 18) lands durable prevention: hard-fail on `42P01` / `42703` errors, add a schema-health smoke workflow, add a CI migration pusher, tighten status.md semantics, and pin an onboarding doc. Phase A must finish cleanly before Phase B, because the new CI pusher expects `supabase_migrations.schema_migrations` to match reality.

**Tech Stack:** Supabase (Postgres with `pg_cron`), Supabase CLI v1, GitHub Actions, Node/TypeScript with `@supabase/supabase-js`, Vitest. Prod project ref: `qcedbargzizmayvimstg`.

---

## Context

Read these first for background:
- `docs/superpowers/plans/2026-04-22-schema-drift-postmortem-and-sync.md` (the postmortem that motivates this plan)
- `docs/sprints/status.md` (sprint tracking, will be updated at the end)

**Observed prod state (2026-04-22):** 12 tables in `public`. `supabase_migrations.schema_migrations` has zero rows. Expected 20+ tables after migration 019.

**Missing tables:** `wallet_profiles`, `signal_timing`, `cohort_attrition`, `wallet_score_history`, `rank_ic_history`, `out_of_cohort_tracking`, `recipe_calibration`, `wallet_signal_stats`.

**Missing columns:** leverage cols on `wallets` and `user_pnl_backtest` (013), regime and OOCV cols on `user_pnl_backtest` (016), shadow scoring cols on `wallets` (018), ATR outcome cols on `signal_outcomes` and net-PnL cols on `recipe_performance` (015).

All migrations 011 through 019 are additive and use `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`, so re-applying against a partially-applied table is safe.

---

## File Structure

### New files (created in this plan)

| Path | Responsibility |
|---|---|
| `supabase/config.toml` | Links the repo to the prod Supabase project for the Supabase CLI |
| `.github/workflows/db-migrate.yml` | CI workflow that runs `supabase db push` on every merge to `main` |
| `.github/workflows/schema-health.yml` | Every-6h smoke test that checks recent row counts in critical tables |
| `scripts/check-schema-health.ts` | Node script invoked by schema-health.yml, exits 1 on missing rows |
| `docs/supabase-migrations.md` | Onboarding doc: local dev, new migration, CI push flow |
| `lib/__tests__/daily-wallet-scan-errors.test.ts` | Vitest coverage for the new hard-fail helper |

### Modified files

| Path | Responsibility | Change |
|---|---|---|
| `scripts/daily-wallet-scan.ts` | Nightly cohort build | Wrap Supabase writes through a new `assertNonFatal(error)` helper that throws on code `42P01` or `42703` |
| `lib/supabase-errors.ts` (NEW) | Pure helper | Classifies `PostgrestError.code` values into fatal vs warn |
| `docs/sprints/status.md` | Sprint tracking | Add R26 row and VERIFIED_IN_PROD column semantics |
| `CLAUDE.md` | Top-level dev docs | Pin `docs/supabase-migrations.md` under a new "Running migrations" section |

---

## Phase A: Apply missing migrations in prod

### Preflight rules (read before starting)

- Every SQL statement in Phase A runs against prod via `mcp__supabase-mcp__apply_migration` or `mcp__supabase-mcp__execute_sql`. There is no dry-run environment. Treat each task as a live change.
- The MCP tool `mcp__supabase-mcp__apply_migration` automatically records a row in `supabase_migrations.schema_migrations` on success. Verify that row after each apply, as part of the task's verification step.
- Between tasks, if a verification SELECT shows unexpected output, STOP. Do not proceed to the next migration. Report the output verbatim and wait for human review.
- Do not attempt to push or pull anything from the Supabase CLI in Phase A. Phase B installs the CLI wiring after the schema is correct.

---

### Task 1: Preflight verification and backup

**Files:** none (prod ops only)

- [ ] **Step 1: Confirm project ref with the user**

Ask the user to confirm the prod Supabase project ref is `qcedbargzizmayvimstg`. Do not proceed if this is not re-confirmed in this session (drift happened on prod before; do not repeat the mistake).

- [ ] **Step 2: Snapshot current public-schema table list**

Call `mcp__supabase-mcp__execute_sql` with:

```sql
SELECT tablename
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
```

Expected: 12 rows, none of them in `{wallet_profiles, signal_timing, cohort_attrition, wallet_score_history, rank_ic_history, out_of_cohort_tracking, recipe_calibration, wallet_signal_stats}`. Save the output to report back at Task 12 for the before/after diff.

- [ ] **Step 3: Confirm schema_migrations is empty**

```sql
SELECT COUNT(*) FROM supabase_migrations.schema_migrations;
```

Expected: `0`. If nonzero, STOP and surface the rows; this plan assumes an empty tracking table.

- [ ] **Step 4: Confirm pg_cron availability**

```sql
SELECT extname, extversion
FROM pg_extension
WHERE extname = 'pg_cron';
```

Expected: one row with `pg_cron`. If absent, ask the user to enable `pg_cron` in the Supabase dashboard (Database > Extensions) before Task 5 (migration 014 uses `cron.schedule`).

- [ ] **Step 5: Ask the user to take a PITR snapshot**

Ask the user to open the Supabase dashboard for `qcedbargzizmayvimstg`, go to Database > Backups, and note the current PITR timestamp. Record the timestamp (ISO 8601 UTC) in the task output. Wait for user confirmation before proceeding.

- [ ] **Step 6: Ask the user to disable the nightly scan workflow**

Ask the user to open GitHub Actions, select the `Daily Wallet Scan` workflow, and click the "..." menu > "Disable workflow". This stops new 42P01 errors from accumulating while Phase A runs. Wait for user confirmation.

- [ ] **Step 7: Commit nothing (no code changes this task)**

No commit required; Task 1 is pure verification.

---

### Task 2: Backfill schema_migrations for already-applied 001 through 010

**Files:** none (prod ops only)

**Why:** Tables from migrations 001 through 010 exist in prod, but their rows in `supabase_migrations.schema_migrations` are missing. The Supabase CLI keys off filename prefixes; if we let 001-010 remain untracked, the Phase B `supabase db push` will try to re-run them, which risks errors on non-idempotent statements. Backfilling first.

- [ ] **Step 1: Insert tracking rows for 001 through 010**

Call `mcp__supabase-mcp__execute_sql` with:

```sql
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES
  ('001', 'initial_schema',      ARRAY['-- backfilled 2026-04-22']),
  ('002', 'wallet_metrics',      ARRAY['-- backfilled 2026-04-22']),
  ('003', 'equity_tier',         ARRAY['-- backfilled 2026-04-22']),
  ('004', 'backtest_daily_pnls', ARRAY['-- backfilled 2026-04-22']),
  ('005', 'entity_type',         ARRAY['-- backfilled 2026-04-22']),
  ('006', 'signal_intelligence', ARRAY['-- backfilled 2026-04-22']),
  ('007', 'signal_outcomes',     ARRAY['-- backfilled 2026-04-22']),
  ('008', 'recipe_calibration',  ARRAY['-- backfilled 2026-04-22']),
  ('009', 'wallet_hygiene',      ARRAY['-- backfilled 2026-04-22']),
  ('010', 'wash_sybil',          ARRAY['-- backfilled 2026-04-22'])
ON CONFLICT (version) DO NOTHING;
```

- [ ] **Step 2: Verify ten rows exist**

```sql
SELECT version, name
FROM supabase_migrations.schema_migrations
ORDER BY version;
```

Expected: exactly 10 rows, versions `'001'` through `'010'`, names matching the `supabase/migrations/` filenames minus the numeric prefix.

---

### Task 3: Apply migration 011 (wallet_profiles)

**Files:**
- Apply: `supabase/migrations/011_wallet_profiles.sql`

- [ ] **Step 1: Read the migration file to confirm contents**

Read `supabase/migrations/011_wallet_profiles.sql` end to end. Confirm it creates a `wallet_profiles` table with `IF NOT EXISTS` guards.

- [ ] **Step 2: Apply via MCP**

Call `mcp__supabase-mcp__apply_migration` with `name: "011_wallet_profiles"` and `query` set to the full SQL contents of the file.

- [ ] **Step 3: Verify table exists**

```sql
SELECT tablename
FROM pg_tables
WHERE schemaname = 'public' AND tablename = 'wallet_profiles';
```

Expected: one row.

- [ ] **Step 4: Verify tracking row**

```sql
SELECT version, name
FROM supabase_migrations.schema_migrations
WHERE version = '011';
```

Expected: one row with `name = 'wallet_profiles'`.

---

### Task 4: Apply migration 012 (signal_timing)

**Files:**
- Apply: `supabase/migrations/012_signal_timing.sql`

- [ ] **Step 1: Read the migration file**

Read the full SQL; confirm it creates a `signal_timing` table.

- [ ] **Step 2: Apply via MCP**

Call `mcp__supabase-mcp__apply_migration` with `name: "012_signal_timing"` and the full SQL.

- [ ] **Step 3: Verify table exists**

```sql
SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename='signal_timing';
```

Expected: one row.

- [ ] **Step 4: Verify tracking row**

```sql
SELECT version FROM supabase_migrations.schema_migrations WHERE version = '012';
```

Expected: one row.

---

### Task 5: Apply migration 013 (leverage and attrition)

**Files:**
- Apply: `supabase/migrations/013_leverage_and_attrition.sql`

- [ ] **Step 1: Read the migration file**

Confirm it adds leverage columns to `wallets` and `user_pnl_backtest`, and creates `cohort_attrition`.

- [ ] **Step 2: Apply via MCP**

Call `mcp__supabase-mcp__apply_migration` with `name: "013_leverage_and_attrition"` and the full SQL.

- [ ] **Step 3: Verify leverage columns on wallets**

```sql
SELECT column_name
FROM information_schema.columns
WHERE table_schema='public'
  AND table_name='wallets'
  AND column_name IN ('max_leverage_60d','avg_leverage_60d','blow_up_distance');
```

Expected: three rows (exact set depends on migration content; whatever the file declares, verify each column is present).

- [ ] **Step 4: Verify cohort_attrition table**

```sql
SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename='cohort_attrition';
```

Expected: one row.

- [ ] **Step 5: Verify tracking row**

```sql
SELECT version FROM supabase_migrations.schema_migrations WHERE version = '013';
```

Expected: one row.

---

### Task 6: Apply migration 014 (rank IC)

**Files:**
- Apply: `supabase/migrations/014_rank_ic.sql`

- [ ] **Step 1: Read the migration file**

Confirm it creates `wallet_score_history`, `rank_ic_history`, and schedules a `pg_cron` cleanup job. Note the `cron.schedule` call details.

- [ ] **Step 2: Confirm pg_cron is still enabled**

```sql
SELECT extname FROM pg_extension WHERE extname = 'pg_cron';
```

Expected: one row. If absent, STOP; Task 1 Step 4 should have caught this.

- [ ] **Step 3: Apply via MCP**

Call `mcp__supabase-mcp__apply_migration` with `name: "014_rank_ic"` and the full SQL.

- [ ] **Step 4: Verify two tables**

```sql
SELECT tablename FROM pg_tables
WHERE schemaname='public'
  AND tablename IN ('wallet_score_history','rank_ic_history')
ORDER BY tablename;
```

Expected: two rows.

- [ ] **Step 5: Verify cron job registered**

```sql
SELECT jobname FROM cron.job WHERE jobname LIKE '%wallet_score%' OR jobname LIKE '%rank_ic%';
```

Expected: one or more rows matching the names declared in the migration. If zero rows but the migration claimed to register a job, STOP.

- [ ] **Step 6: Verify tracking row**

```sql
SELECT version FROM supabase_migrations.schema_migrations WHERE version = '014';
```

Expected: one row.

---

### Task 7: Apply migration 015 (outcome overhaul)

**Files:**
- Apply: `supabase/migrations/015_outcome_overhaul.sql`

**Why this one is special:** The postmortem flagged 015 as possibly partially applied. It uses `ADD COLUMN IF NOT EXISTS` throughout, so re-applying is safe, but check the before state so Task 12 can diff accurately.

- [ ] **Step 1: Read the migration file**

Confirm it adds ATR exit columns to `signal_outcomes` (`entry_price`, `exit_price`, `exit_reason`, `gross_pnl_bps`, `net_pnl_bps`, `realized_r_multiple`, `latency_at_measurement_ms`, `is_win`) and net-PnL columns to `recipe_performance` (`median_net_pnl_bps`, `win_rate_net`, `expectancy_bps_net`, `sample_size_60d`).

- [ ] **Step 2: Snapshot current column set on both tables**

```sql
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('signal_outcomes','recipe_performance')
ORDER BY table_name, column_name;
```

Save the output to the task log.

- [ ] **Step 3: Apply via MCP**

Call `mcp__supabase-mcp__apply_migration` with `name: "015_outcome_overhaul"` and the full SQL.

- [ ] **Step 4: Verify all expected columns now exist**

```sql
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'signal_outcomes' AND column_name IN
      ('entry_price','exit_price','exit_reason','gross_pnl_bps','net_pnl_bps',
       'realized_r_multiple','latency_at_measurement_ms','is_win'))
    OR
    (table_name = 'recipe_performance' AND column_name IN
      ('median_net_pnl_bps','win_rate_net','expectancy_bps_net','sample_size_60d'))
  )
ORDER BY table_name, column_name;
```

Expected: 12 rows (8 on `signal_outcomes`, 4 on `recipe_performance`).

- [ ] **Step 5: Verify exit_reason check constraint**

```sql
SELECT conname
FROM pg_constraint
WHERE conrelid = 'public.signal_outcomes'::regclass
  AND conname = 'signal_outcomes_exit_reason_check';
```

Expected: one row.

- [ ] **Step 6: Verify tracking row**

```sql
SELECT version FROM supabase_migrations.schema_migrations WHERE version = '015';
```

Expected: one row.

---

### Task 8: Apply migration 016 (multi window and OOCV)

**Files:**
- Apply: `supabase/migrations/016_multi_window_and_oocv.sql`

- [ ] **Step 1: Read the migration file**

Confirm it adds multi-window score columns on `wallets`, a `regime_at_day` column on `user_pnl_backtest`, and creates `out_of_cohort_tracking`.

- [ ] **Step 2: Apply via MCP**

Call `mcp__supabase-mcp__apply_migration` with `name: "016_multi_window_and_oocv"` and the full SQL.

- [ ] **Step 3: Verify `out_of_cohort_tracking` table exists**

```sql
SELECT tablename FROM pg_tables
WHERE schemaname='public' AND tablename='out_of_cohort_tracking';
```

Expected: one row.

- [ ] **Step 4: Verify `regime_at_day` column on user_pnl_backtest**

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema='public'
  AND table_name='user_pnl_backtest'
  AND column_name='regime_at_day';
```

Expected: one row.

- [ ] **Step 5: Verify tracking row**

```sql
SELECT version FROM supabase_migrations.schema_migrations WHERE version = '016';
```

Expected: one row.

---

### Task 9: Apply migration 017 (EV decouple)

**Files:**
- Apply: `supabase/migrations/017_ev_decouple.sql`

- [ ] **Step 1: Read the migration file**

Confirm it creates `recipe_calibration` and `wallet_signal_stats`.

- [ ] **Step 2: Apply via MCP**

Call `mcp__supabase-mcp__apply_migration` with `name: "017_ev_decouple"` and the full SQL.

- [ ] **Step 3: Verify both tables**

```sql
SELECT tablename FROM pg_tables
WHERE schemaname='public'
  AND tablename IN ('recipe_calibration','wallet_signal_stats')
ORDER BY tablename;
```

Expected: two rows.

- [ ] **Step 4: Verify tracking row**

```sql
SELECT version FROM supabase_migrations.schema_migrations WHERE version = '017';
```

Expected: one row.

---

### Task 10: Apply migration 018 (shadow scoring)

**Files:**
- Apply: `supabase/migrations/018_shadow_scoring.sql`

- [ ] **Step 1: Read the migration file**

Confirm it adds shadow columns (`overall_score_shadow` and friends) on `wallets` and possibly `rank_ic_history`.

- [ ] **Step 2: Apply via MCP**

Call `mcp__supabase-mcp__apply_migration` with `name: "018_shadow_scoring"` and the full SQL.

- [ ] **Step 3: Verify shadow column on wallets**

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema='public'
  AND table_name='wallets'
  AND column_name='overall_score_shadow';
```

Expected: one row.

- [ ] **Step 4: Verify any other columns the migration declares**

Based on the read from Step 1, repeat the `information_schema.columns` SELECT for each shadow column added to other tables (for example, `rank_ic_shadow` on `rank_ic_history`). Expect one row per column the migration declares.

- [ ] **Step 5: Verify tracking row**

```sql
SELECT version FROM supabase_migrations.schema_migrations WHERE version = '018';
```

Expected: one row.

---

### Task 11: Apply migration 019 (RLS default-deny)

**Files:**
- Apply: `supabase/migrations/019_enable_rls.sql`

**Why this order matters:** RLS is flipped on last so none of the preceding migrations get blocked by a deny-all policy mid-apply. The backend reads/writes with `SUPABASE_SERVICE_ROLE_KEY`, which bypasses RLS, so enabling it is safe for server traffic. Browser has no direct Supabase access.

- [ ] **Step 1: Read the migration file**

Confirm it enables RLS and adds default-deny policies on every public-schema table.

- [ ] **Step 2: Apply via MCP**

Call `mcp__supabase-mcp__apply_migration` with `name: "019_enable_rls"` and the full SQL.

- [ ] **Step 3: Verify RLS is on for every public table**

```sql
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
```

Expected: every row has `rowsecurity = true`. If any row shows `false`, STOP and surface which table was missed.

- [ ] **Step 4: Verify at least one policy per table**

```sql
SELECT tablename, COUNT(*) AS policy_count
FROM pg_policies
WHERE schemaname = 'public'
GROUP BY tablename
ORDER BY tablename;
```

Expected: every public table has `policy_count >= 1`.

- [ ] **Step 5: Verify tracking row**

```sql
SELECT version FROM supabase_migrations.schema_migrations WHERE version = '019';
```

Expected: one row.

- [ ] **Step 6: Smoke-test a server-side read via the service role**

Call `mcp__supabase-mcp__execute_sql` (which uses the service role):

```sql
SELECT COUNT(*) FROM wallets;
```

Expected: a non-zero count (matches whatever was there before 019; RLS should not block the service role). If it errors or returns 0 where it should have rows, STOP.

---

### Task 12: Postflight (resume traffic, smoke test, row-count check)

**Files:** none (prod ops only)

- [ ] **Step 1: Ask the user to re-enable the Daily Wallet Scan workflow**

Ask the user to open GitHub Actions, select `Daily Wallet Scan`, and click "Enable workflow". Wait for confirmation.

- [ ] **Step 2: Trigger a manual run**

Ask the user to click "Run workflow" on the Daily Wallet Scan. Tail the logs live.

- [ ] **Step 3: Confirm zero schema errors in the run**

Watch the scan logs for:
- `42P01` (relation does not exist)
- `42703` (column does not exist)

Expected: neither string appears. If either appears, STOP and surface the offending table or column; the migration set is incomplete.

- [ ] **Step 4: Snapshot post-state table list**

```sql
SELECT tablename
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
```

Diff against Task 1 Step 2 output. Expected new tables: `wallet_profiles`, `signal_timing`, `cohort_attrition`, `wallet_score_history`, `rank_ic_history`, `out_of_cohort_tracking`, `recipe_calibration`, `wallet_signal_stats`.

- [ ] **Step 5: Verify schema_migrations has 19 rows**

```sql
SELECT COUNT(*) FROM supabase_migrations.schema_migrations;
```

Expected: `19`.

- [ ] **Step 6: Record a 24h followup note**

Append to the plan's own log (or a new note in `docs/sprints/status.md` under R26): "Row-count check pending, run 2026-04-23 after first full nightly scan." The check itself is Task 18 Step 4 of Phase B (schema-health workflow does it automatically once installed).

- [ ] **Step 7: Commit nothing (Phase A is pure prod ops)**

No git changes in Phase A.

---

## Phase B: Prevention

Phase B runs on a new branch off `main`. All changes here are code, tests, and docs; no further prod DB mutations.

### Task 13: Hard-fail on 42P01 and 42703 in the nightly scan

**Files:**
- Create: `lib/supabase-errors.ts`
- Create: `lib/__tests__/supabase-errors.test.ts`
- Modify: `scripts/daily-wallet-scan.ts` (wrap every `.upsert()` / `.insert()` error check)

**Why:** Today the scan logs `error.message` and keeps going when Supabase returns `42P01` or `42703`. We want these to throw so a drifted schema surfaces on the next nightly run, not months later.

- [ ] **Step 1: Create a branch**

```bash
git checkout -b r26-prevention
```

- [ ] **Step 2: Write the failing test**

Create `lib/__tests__/supabase-errors.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isFatalSupabaseError, assertNonFatal } from "@/lib/supabase-errors";

describe("isFatalSupabaseError", () => {
  it("returns true for 42P01 (relation does not exist)", () => {
    expect(isFatalSupabaseError({ code: "42P01", message: "x" })).toBe(true);
  });

  it("returns true for 42703 (column does not exist)", () => {
    expect(isFatalSupabaseError({ code: "42703", message: "x" })).toBe(true);
  });

  it("returns false for a generic error", () => {
    expect(isFatalSupabaseError({ code: "23505", message: "dup key" })).toBe(false);
  });

  it("returns false for null", () => {
    expect(isFatalSupabaseError(null)).toBe(false);
  });
});

describe("assertNonFatal", () => {
  it("throws on 42P01", () => {
    expect(() =>
      assertNonFatal({ code: "42P01", message: "relation missing" }, "[test]"),
    ).toThrow(/\[test\] schema drift/);
  });

  it("does not throw on 23505", () => {
    expect(() =>
      assertNonFatal({ code: "23505", message: "dup" }, "[test]"),
    ).not.toThrow();
  });

  it("does not throw on null", () => {
    expect(() => assertNonFatal(null, "[test]")).not.toThrow();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run lib/__tests__/supabase-errors.test.ts`
Expected: FAIL with "Cannot find module '@/lib/supabase-errors'".

- [ ] **Step 4: Write the helper**

Create `lib/supabase-errors.ts`:

```ts
// Shape-compatible with PostgrestError without pulling the dep into pure modules.
export interface SupabaseErrorLike {
  code: string | null | undefined;
  message: string;
}

// Postgres codes that prove the schema on disk has diverged from the code.
// See docs/superpowers/plans/2026-04-22-schema-drift-postmortem-and-sync.md.
const FATAL_CODES = new Set(["42P01", "42703"]);

export function isFatalSupabaseError(
  err: SupabaseErrorLike | null | undefined,
): boolean {
  if (!err || !err.code) return false;
  return FATAL_CODES.has(err.code);
}

// Throws when the error indicates schema drift, otherwise returns silently.
// Tag is a caller-supplied prefix so the thrown message points to the site.
export function assertNonFatal(
  err: SupabaseErrorLike | null | undefined,
  tag: string,
): void {
  if (isFatalSupabaseError(err)) {
    throw new Error(
      `${tag} schema drift: ${err!.code} ${err!.message}. ` +
        `Table or column is missing. See docs/supabase-migrations.md.`,
    );
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run lib/__tests__/supabase-errors.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Wire `assertNonFatal` into every write site in `scripts/daily-wallet-scan.ts`**

Find every `const { error } = await supabase.from(...).upsert(...)` or `.insert(...)` call. After the existing `console.error` / `console.warn` line, add an `assertNonFatal(error, "[<tag>]")` call using the tag already on the log line.

Example (line 596):

```ts
// Before
console.error(`[upsert] chunk ${i} to ${i + CHUNK} error:`, error.message);

// After
console.error(`[upsert] chunk ${i} to ${i + CHUNK} error:`, error.message);
assertNonFatal(error, "[upsert]");
```

Repeat the same pattern for every site found by:

```bash
grep -n "error.message\|error:" scripts/daily-wallet-scan.ts
```

Add the import at the top of the file:

```ts
import { assertNonFatal } from "@/lib/supabase-errors";
```

- [ ] **Step 7: Run typecheck and the full test suite**

Run: `npm run typecheck && npm run test`
Expected: both pass, including the new 5 supabase-errors tests.

- [ ] **Step 8: Commit**

```bash
git add lib/supabase-errors.ts lib/__tests__/supabase-errors.test.ts scripts/daily-wallet-scan.ts
git commit -m "feat(scan): hard-fail on schema-drift error codes 42P01 and 42703"
```

---

### Task 14: Schema-health smoke workflow

**Files:**
- Create: `scripts/check-schema-health.ts`
- Create: `.github/workflows/schema-health.yml`

**Why:** Even with hard-fail in the scan, the nightly only runs once per day. A 6h cadence on a cheap row-count probe catches drift in under 6h instead of up to 24.

- [ ] **Step 1: Write the smoke-test script**

Create `scripts/check-schema-health.ts`:

```ts
// Checks that critical downstream tables received a write in the last 25h.
// Exits 1 (workflow fails, GitHub emails admins) on any missing check.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface Check {
  table: string;
  column: string;
  windowHours: number;
  feature: string;
}

const CHECKS: Check[] = [
  { table: "wallet_score_history", column: "captured_at", windowHours: 25, feature: "R9 rank IC" },
  { table: "signal_timing",        column: "fired_at",    windowHours: 25, feature: "R7 latency" },
  { table: "recipe_calibration",   column: "updated_at",  windowHours: 25, feature: "R12 EV decouple" },
];

async function runCheck(c: Check): Promise<boolean> {
  const since = new Date(Date.now() - c.windowHours * 3600_000).toISOString();
  const { count, error } = await supabase
    .from(c.table)
    .select("*", { count: "exact", head: true })
    .gte(c.column, since);
  if (error) {
    console.error(`[${c.feature}] ${c.table}: ${error.code} ${error.message}`);
    return false;
  }
  const ok = (count ?? 0) > 0;
  console.log(`[${c.feature}] ${c.table}: ${count ?? 0} rows in last ${c.windowHours}h (${ok ? "OK" : "FAIL"})`);
  return ok;
}

async function main() {
  const results = await Promise.all(CHECKS.map(runCheck));
  if (results.some((r) => !r)) {
    console.error("One or more schema health checks failed.");
    process.exit(1);
  }
  console.log("All schema health checks passed.");
}

main();
```

- [ ] **Step 2: Verify it runs locally against prod**

Run: `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/check-schema-health.ts`
Expected output (after R26 has been running for 25h): three `OK` lines and `All schema health checks passed.`
Expected output (before 25h has elapsed): at least one `FAIL` line and exit 1. Acceptable for now; the workflow will start alerting, and the first real scan will populate rows.

Note: the workflow will fail during the first 25h window. Document this by adding the line "Workflow starts alerting 25h after first nightly scan completes" to `.github/workflows/schema-health.yml` header.

- [ ] **Step 3: Write the workflow**

Create `.github/workflows/schema-health.yml`:

```yaml
name: Schema Health

# Every 6h, verifies that critical downstream tables received a write in the
# last 25h. Catches schema drift (tables missing) and pipeline stalls.
# Starts alerting 25h after R26 completes its first nightly scan.

on:
  schedule:
    - cron: '0 */6 * * *'
  workflow_dispatch:

jobs:
  check:
    runs-on: ubuntu-latest
    timeout-minutes: 3
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
      - run: npm ci
      - name: Run schema health checks
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
        run: npx tsx scripts/check-schema-health.ts
```

- [ ] **Step 4: Commit**

```bash
git add scripts/check-schema-health.ts .github/workflows/schema-health.yml
git commit -m "feat(ci): schema-health smoke workflow every 6h"
```

---

### Task 15: Supabase CLI config and CI migration push

**Files:**
- Create: `supabase/config.toml`
- Create: `.github/workflows/db-migrate.yml`

**Why:** Remove humans from the migration-apply loop. Every merge to `main` runs `supabase db push`, which diffs `supabase/migrations/` against `supabase_migrations.schema_migrations` (now populated by Phase A) and applies anything new.

**Preflight for this task:** ask the user to add two GitHub secrets if not already present:
- `SUPABASE_ACCESS_TOKEN` (personal access token from Supabase dashboard > Account > Access Tokens)
- `SUPABASE_DB_PASSWORD` (from Supabase dashboard > Project Settings > Database)

- [ ] **Step 1: Ask the user to confirm the two secrets exist in GitHub**

Ask the user to open the repo on GitHub, go to Settings > Secrets and variables > Actions, and confirm both `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD` are set. If not, walk them through creating both. Wait for confirmation.

- [ ] **Step 2: Create `supabase/config.toml`**

```toml
# Links the repo to the prod Supabase project.
# Project ref source of truth: https://supabase.com/dashboard/project/qcedbargzizmayvimstg
project_id = "qcedbargzizmayvimstg"
```

- [ ] **Step 3: Create the CI migration workflow**

Create `.github/workflows/db-migrate.yml`:

```yaml
name: DB Migrate

# Runs on every push to main. Applies any migrations in supabase/migrations/
# that are not yet present in supabase_migrations.schema_migrations.
# Requires: SUPABASE_ACCESS_TOKEN and SUPABASE_DB_PASSWORD secrets.

on:
  push:
    branches: [main]
    paths:
      - 'supabase/migrations/**'
      - '.github/workflows/db-migrate.yml'
  workflow_dispatch:

jobs:
  push:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
        with:
          version: latest
      - name: Link project
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
        run: supabase link --project-ref qcedbargzizmayvimstg
      - name: Push migrations
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
          SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }}
        run: supabase db push
```

- [ ] **Step 4: Commit**

```bash
git add supabase/config.toml .github/workflows/db-migrate.yml
git commit -m "feat(ci): auto-apply supabase migrations on merge to main"
```

---

### Task 16: Tighten status.md semantics (VERIFIED_IN_PROD)

**Files:**
- Modify: `docs/sprints/status.md`

- [ ] **Step 1: Add an R26 row and update R7 through R13 status**

Open `docs/sprints/status.md`. Under the Remediation Plan Sprints table, add a row for R26 and replace the "COMPLETE (2026-04-19)" strings for R7 through R13 with "VERIFIED_IN_PROD (<date>)" if Task 12 postflight passed, or leave "COMPLETE (2026-04-19)" with a `[drift]` marker if the 24h row-count check is still pending.

Example edit (use the exact R26 verification date from Task 12 Step 5 result):

```markdown
| R7  | Signal-to-entry latency capture            | VERIFIED_IN_PROD (2026-04-23) | migration 012, signal_timing ... |
| R8  | Leverage capture + cohort attrition        | VERIFIED_IN_PROD (2026-04-23) | migration 013, ... |
| R9  | Rank IC measurement                        | VERIFIED_IN_PROD (2026-04-23) | migration 014, ... |
| R10 | Outcome measurement overhaul               | VERIFIED_IN_PROD (2026-04-23) | migration 015, ... |
| R11 | Multi-window selection + OOCV              | VERIFIED_IN_PROD (2026-04-23) | migration 016, ... |
| R12 | EV decouple                                | VERIFIED_IN_PROD (2026-04-23) | migration 017, ... |
| R13 | Empirically-fit leverage-adjusted scoring  | VERIFIED_IN_PROD (2026-04-23) | migration 018, ... |
| R26 | Schema sync + drift prevention             | COMPLETE (<today>)            | migrations 011-019 applied, hard-fail guards, schema-health and db-migrate workflows |
```

- [ ] **Step 2: Add a state-definition note below the table**

Append to `docs/sprints/status.md`:

```markdown
### Sprint state definitions

- **PLANNED:** spec exists, no code
- **IN PROGRESS:** code being written
- **CODE_MERGED:** PR merged to main, but prod effects not yet observed
- **COMPLETE:** migrations applied and one full nightly cycle succeeded
- **VERIFIED_IN_PROD:** COMPLETE + the feature's target table has non-zero rows after 24h
```

- [ ] **Step 3: Commit**

```bash
git add docs/sprints/status.md
git commit -m "docs(sprints): add VERIFIED_IN_PROD state and R26 row"
```

---

### Task 17: Onboarding doc and CLAUDE.md pin

**Files:**
- Create: `docs/supabase-migrations.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Write `docs/supabase-migrations.md`**

```markdown
# Supabase migrations

This repo auto-applies migrations to the prod Supabase project
`qcedbargzizmayvimstg` on every merge to `main` via
`.github/workflows/db-migrate.yml`.

## Create a new migration

```bash
supabase migration new <short_snake_name>
# writes supabase/migrations/<version>_<name>.sql
```

Edit the file. Prefer `IF NOT EXISTS` guards on tables and `ADD COLUMN IF NOT EXISTS`
on columns so re-apply is a no-op.

## Test locally

```bash
supabase start          # boots local Postgres
supabase db reset       # replays all migrations from scratch
```

## Push to prod

Merge the PR to `main`. The `DB Migrate` workflow runs `supabase db push`,
which applies any migration files whose version is not yet in
`supabase_migrations.schema_migrations`. Watch the workflow in GitHub Actions.

## What runs against prod automatically

- `db-migrate.yml`: on merge to main
- `schema-health.yml`: every 6h; fails if a critical table has zero rows in the last 25h
- Hard-fail in `scripts/daily-wallet-scan.ts`: throws on Postgres error codes
  `42P01` (missing table) and `42703` (missing column)

## If something breaks

1. Check `supabase_migrations.schema_migrations` via `mcp__supabase-mcp__execute_sql` for the last applied version
2. Compare with `ls supabase/migrations/` to find the gap
3. If drift is severe, see
   `docs/superpowers/plans/2026-04-22-schema-drift-postmortem-and-sync.md`
   and `docs/superpowers/plans/2026-04-22-r26-schema-sync-and-prevention.md`
   for the recovery pattern.
```

- [ ] **Step 2: Pin it in `CLAUDE.md`**

Find the "## Environment Variables" section in `CLAUDE.md`. Insert above it:

```markdown
## Running migrations

Migrations live in `supabase/migrations/` and auto-apply to prod on merge
to `main` via `.github/workflows/db-migrate.yml`. See
[docs/supabase-migrations.md](docs/supabase-migrations.md) for local dev
and recovery steps.
```

- [ ] **Step 3: Commit**

```bash
git add docs/supabase-migrations.md CLAUDE.md
git commit -m "docs: add supabase-migrations onboarding doc and pin in CLAUDE.md"
```

---

### Task 18: Open PR and merge

**Files:** none (git ops)

- [ ] **Step 1: Push the branch**

```bash
git push -u origin r26-prevention
```

- [ ] **Step 2: Open a PR**

```bash
gh pr create --title "R26 prevention: hard-fail, schema-health, db-migrate CI" --body "$(cat <<'EOF'
## Summary

- Hard-fail on `42P01` and `42703` Postgres error codes in `scripts/daily-wallet-scan.ts` via a new `lib/supabase-errors.ts` helper
- New `.github/workflows/schema-health.yml` smoke test every 6h against `wallet_score_history`, `signal_timing`, `recipe_calibration`
- New `.github/workflows/db-migrate.yml` that runs `supabase db push` on merge to main
- New `supabase/config.toml` linking to prod project ref
- `docs/sprints/status.md`: add VERIFIED_IN_PROD state and R26 row
- `docs/supabase-migrations.md` + CLAUDE.md pin

Context: `docs/superpowers/plans/2026-04-22-schema-drift-postmortem-and-sync.md`
Plan: `docs/superpowers/plans/2026-04-22-r26-schema-sync-and-prevention.md`

Phase A (applying migrations 011 to 019 in prod) must be complete before merging this PR,
because `db-migrate.yml` would otherwise try to re-run them.

## Test plan

- [x] `npm run typecheck` passes
- [x] `npm run test` passes (includes new supabase-errors tests)
- [x] `scripts/check-schema-health.ts` runs locally without throwing
- [ ] After merge: first `DB Migrate` workflow run is a no-op (all 19 already in schema_migrations)
- [ ] After merge: first `Schema Health` workflow run passes (contingent on 25h after R26 Phase A)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Wait for CI, request review, merge**

Wait for `npm run typecheck`, `npm run test`, and any other configured checks to pass. Ask for human review. On approval, merge to `main`.

- [ ] **Step 4: Watch the first run of the new workflows**

After merge, open GitHub Actions and confirm:
- `DB Migrate` runs and reports zero new migrations applied
- `Schema Health` runs and either passes (if 25h has elapsed since the last nightly scan) or fails gracefully with a clear message

---

## Post-plan followups (not in this plan's scope)

- If the 24h row-count check fails for any of `wallet_score_history`, `signal_timing`, `recipe_calibration`, `cohort_attrition`, `out_of_cohort_tracking`, `wallet_signal_stats`: open a bug on the corresponding Rxx sprint to debug the write path. The schema exists now; whatever is still quiet is a code-path problem, not drift.
- R13 canary cutover gate (30 days of `rank_ic_shadow` observations) remains on its original cadence. Phase A should have populated `overall_score_shadow` going forward.

---

## Self-review notes

Coverage check against postmortem:
- "Automate migrations via CI" -> Task 15
- "Hard-fail the nightly scan" -> Task 13
- "Row-count smoke test" -> Task 14
- "Tighten status.md semantics" -> Task 16
- "Onboarding doc" -> Task 17
- Preflight + sequenced migrations + verify -> Tasks 1-12
- `schema_migrations` backfill -> Task 2 (specifically called out in postmortem as "one-time backfill")
- Option A ship decision -> already executed 2026-04-22 (this plan assumes R25 is merged, CRON_SECRET is live)

Placeholder scan: every SQL block is concrete; every code block is complete; every commit message is written; no "TBD" strings. Migration 015 "may be partial" is handled concretely by snapshotting columns before apply and verifying the expected 12 columns after.

Type consistency: `assertNonFatal(err, tag)` signature used consistently in Task 13 Steps 2, 4, 6. `SupabaseErrorLike` interface used in both the helper and the test.

---

## Follow-ups (separate session)

### R27: Lazy env validation in `lib/env.ts`

**Why:** During Task 12 postflight (2026-04-22), the daily-wallet-scan workflow crashed at module load because `lib/env.ts` eagerly `requireEnv`-s `SUPABASE_ANON_KEY`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `KV_REST_API_READ_ONLY_TOKEN` — vars the scan/learning scripts never read. Unblocked for now by wiring all four secrets into both workflows' `env:` blocks, but that duplicates secrets GitHub-side and conflates "required for the Next.js app" with "required for any script that transitively imports cohort-engine".

**Scope:**
- Convert the four browser/KV-only exports from `export const` to lazy getters (or a `getEnv(name)` accessor) so module load succeeds when the consuming code never touches them.
- Drop the redundant env entries from `.github/workflows/daily-wallet-scan.yml` and `.github/workflows/signal-learning.yml` once the refactor lands.
- Audit `scripts/**/*.ts` for other eager env imports that should move to lazy access.

**Guardrails:**
- Must not change behaviour for the Next.js runtime (those consumers read these vars).
- Add a test that imports `lib/env.ts` with only `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` set and confirms no throw.

**Coordinate with:** Sprint 7 (UI revision) — if that sprint touches `lib/env.ts`, rebase before starting.
