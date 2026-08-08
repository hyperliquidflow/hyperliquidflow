# Phase 0: Clean House and Resurrection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring every dead pipeline back to life, delete all clutter and dead code, and make silent failure impossible, so the 30-to-60-day prove-or-kill clock (rank IC, per-recipe outcomes) can finally start.

**Architecture:** No new features. Three kinds of work: (1) repo hygiene, commit or delete every loose file and dead module; (2) surgical fixes to the four root causes from the 2026-08-08 audit (phantom column, disabled workflows, dead heartbeat, swallowed errors); (3) observability that turns red when data stops flowing. Full audit: docs/audit/2026-08-08-full-audit.md (created in Task 9) and the published report artifact.

**Tech Stack:** Next.js 15, Supabase (Postgres + pg_cron), Vercel crons, GitHub Actions, UptimeRobot (new, free tier), Vitest.

## Global Constraints

- No em dashes or en dashes in any file content, including markdown. A PreToolUse hook blocks them. Use commas or hyphens.
- All UI colors from `lib/design-tokens.ts`. No new UI in this plan.
- Never read `process.env` outside `lib/env.ts` in app code (scripts/rank-ic.ts is an existing sanctioned exception).
- Conventional commit messages: `chore:`, `fix:`, `feat:`, `docs:`.
- Run `npm run typecheck` and `npm run test` before every commit that touches TypeScript.
- Supabase migrations are applied to prod via MCP `apply_migration` (or dashboard SQL editor), then committed to `supabase/migrations/`. Never let prod and the migrations directory diverge (that caused the April schema-drift crisis).

## Context from the audit (why each task exists)

- All 4 GitHub workflows show `disabled_inactivity` since 2026-06-22 (60 days after last commit).
- `scripts/daily-wallet-scan.ts` Phase 11 selects `wallets.overall_score`, a column that has never existed. Error swallowed nightly since 2026-04-19. Result: `wallet_score_history` and `rank_ic_history` have 0 rows ever.
- The 5-minute heartbeat was cron-job.org (external, unversioned). It died ~2026-07-16. Only the daily Vercel cron survives, so detection runs once a day.
- Live hygiene pruned the cohort 493 to 58 with zero inflow (scan dead).
- `signal_events` table: writer deleted 2026-04-17, two dead readers remain.
- `/api/cohort-state` Supabase fallback stamps `updated_at = now` on day-old data, blinding any freshness monitor.

---

### Task 1: Repo clean house, commit the keepers, delete the clutter

**Files:**
- Delete: `learning-summary.json`, `anti-ai-writing style copy.md`, `.claude/worktrees/audit-remediation`, `.claude/worktrees/naughty-turing`, `.worktrees/flat-nav`, `.worktrees/sprint-2-bias-trend`
- Modify: `.gitignore`
- Commit (untracked keepers): `docs/superpowers/plans/*.md` (7 files), `docs/audit/2026-07-22-full-project-audit.md`, `docs/mockups/2026-04-22-wallet-pages/`, the modified `CLAUDE.md`, this plan file

**Interfaces:**
- Produces: a clean `git status` (nothing untracked, nothing modified), which is also the anti-disable measure: commits reset GitHub's 60-day inactivity counter.

- [ ] **Step 1: Remove stale worktrees**

```bash
git worktree list
git worktree remove --force .claude/worktrees/audit-remediation || rm -rf .claude/worktrees/audit-remediation
git worktree remove --force .claude/worktrees/naughty-turing   || rm -rf .claude/worktrees/naughty-turing
git worktree remove --force .worktrees/flat-nav                || rm -rf .worktrees/flat-nav
git worktree remove --force .worktrees/sprint-2-bias-trend     || rm -rf .worktrees/sprint-2-bias-trend
git worktree prune
```

- [ ] **Step 2: Delete stale local files**

`learning-summary.json` is a stale April artifact (CI regenerates it per run). `anti-ai-writing style copy.md` duplicates the writing rules that already live in the user's global `~/.claude/CLAUDE.md`.

```bash
rm learning-summary.json
rm "anti-ai-writing style copy.md"
```

- [ ] **Step 3: Extend .gitignore**

Append to `.gitignore`:

```
# CI artifacts regenerated per run
learning-summary.json
scan-summary.json

# editor workspace files (user-local)
*.code-workspace

# claude worktrees
.claude/worktrees/
```

- [ ] **Step 4: Commit everything that should live in history**

```bash
git add .gitignore CLAUDE.md docs/superpowers/plans/ docs/superpowers/specs/ docs/audit/ docs/mockups/
git add docs/sprints/ 2>/dev/null || true
git status   # verify: nothing untracked remains except intentionally ignored files
git commit -m "chore: commit outstanding plans, mockups, and audit docs; ignore CI artifacts and workspace files"
```

Expected: `git status` shows a clean tree. This commit alone restarts GitHub's inactivity clock.

---

### Task 2: Delete dead code

**Files:**
- Delete: `components/alert-bell.tsx`, `app/performance/PerformanceClient.tsx`, `app/performance/loading.tsx`, `app/signals/radar/designs/` (entire directory)
- Modify: `scripts/daily-wallet-scan.ts` (remove `resolveWalletOutcomes`), `scripts/rank-ic.ts` (remove `computeWeeklyRecipeBaseRates`)

**Interfaces:**
- Consumes: nothing. Every deleted item was verified orphaned or schema-dead in the audit.
- Produces: `signal_events` has zero remaining readers, which unblocks the table drop in Task 3.

- [ ] **Step 1: Delete orphaned UI files**

```bash
rm components/alert-bell.tsx
rm app/performance/PerformanceClient.tsx app/performance/loading.tsx
rm -rf app/signals/radar/designs
```

Note: keep `app/performance/page.tsx` (redirect) and `app/performance/ranking/` (rank IC page). Keep `lib/hooks/use-alert-events.ts` intact; its `markAllSeen` becomes unused but the hook is needed for the Phase 3 alert rebuild.

- [ ] **Step 2: Remove resolveWalletOutcomes from the scan**

In `scripts/daily-wallet-scan.ts`: delete the entire `resolveWalletOutcomes` function (the block starting at the comment above line 895 through line 956, it selects the dropped columns `price_win` and `wallet_outcome` and inner-joins `signal_events`) and delete its call site at line 1708 (`await resolveWalletOutcomes();`).

- [ ] **Step 3: Remove the OOCV base-rate function from rank-ic**

In `scripts/rank-ic.ts`: delete the entire `computeWeeklyRecipeBaseRates` function (comment block starting at line 213 through the end of the function) and its call site (grep for `computeWeeklyRecipeBaseRates(` in the same file). OOCV position tracking never landed (R12 scope), the function's data source (`signal_events`) is dropped in Task 3, and it has skipped itself on every run since 2026-04-24.

- [ ] **Step 4: Verify no references remain**

```bash
grep -rn "AlertBell\|alert-bell" app/ components/ lib/ scripts/ || echo CLEAN
grep -rn "resolveWalletOutcomes\|computeWeeklyRecipeBaseRates" scripts/ app/ lib/ || echo CLEAN
grep -rn "signal_events" app/ lib/ scripts/ || echo CLEAN
npm run typecheck && npm run test
```

Expected: three CLEAN lines, typecheck and tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: delete dead code (AlertBell, old performance client, radar designs gallery, schema-dead scan and rank-ic branches)"
```

---

### Task 3: Migration 020, drop dead tables and extend learning-critical retention

**Files:**
- Create: `supabase/migrations/020_cleanup_and_retention.sql`

**Interfaces:**
- Consumes: Task 2 (no code references `signal_events` anymore; `rate_limit_tokens` never had any).
- Produces: `signal_outcomes` and `signals_history` retain 180 days, which dissolves the learning cold-start deadlock (30-day retention could never satisfy the 100-outcome + 30-day gate).

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/020_cleanup_and_retention.sql`:

```sql
-- 2026-08-08 audit cleanup.
-- signal_events: writer deleted 2026-04-17, readers removed in the same change set.
-- rate_limit_tokens: seeded in R25, never read or written by any code.
DROP TABLE IF EXISTS signal_events;
DROP TABLE IF EXISTS rate_limit_tokens;

-- Extend retention from 30 to 180 days. The learning gate needs outcomes to
-- accumulate; 30-day retention capped the table at ~5 rows at current volume.
-- cron.schedule with an existing jobname replaces that job in place.
SELECT cron.schedule(
  'cleanup-old-signals',
  '5 3 * * *',
  $$
    DELETE FROM signals_history
    WHERE detected_at < NOW() - INTERVAL '180 days';
  $$
);

SELECT cron.schedule(
  'cleanup-old-signal-outcomes',
  '15 3 * * *',
  $$
    DELETE FROM signal_outcomes
    WHERE created_at < NOW() - INTERVAL '180 days';
  $$
);
```

- [ ] **Step 2: Apply to prod**

Apply via Supabase MCP `apply_migration` with name `020_cleanup_and_retention`, or paste into the dashboard SQL editor.

- [ ] **Step 3: Verify**

Run against prod (MCP `execute_sql`):

```sql
SELECT jobname, command FROM cron.job WHERE jobname IN ('cleanup-old-signals','cleanup-old-signal-outcomes');
SELECT to_regclass('public.signal_events') AS se, to_regclass('public.rate_limit_tokens') AS rlt;
```

Expected: both commands contain `180 days`; both regclass values are null.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/020_cleanup_and_retention.sql
git commit -m "chore(db): drop signal_events and rate_limit_tokens, extend outcome retention to 180d"
```

---

### Task 4: Fix the phantom column (Phase 11 score history)

**Files:**
- Create: `lib/score-history.ts`
- Test: `lib/__tests__/score-history.test.ts`
- Modify: `scripts/daily-wallet-scan.ts:1792-1845` (`writeScoreHistory`)

**Interfaces:**
- Produces: `buildScoreHistoryRows(date: string, activeWallets: Array<{id: string; overall_score_shadow?: number | null}>, snapshots: Array<{wallet_id: string; overall_score: number | null; snapshot_time: string}>, backtests: Array<{wallet_id: string; daily_pnls: number[] | null}>): ScoreHistoryRow[]` where `ScoreHistoryRow = {date: string; wallet_id: string; overall_score: number; overall_score_shadow: number | null; daily_pnl_usd: number}`. Snapshots must be passed sorted newest-first; the helper takes the first occurrence per wallet.
- Note: with this fix, `overall_score_shadow` (which DOES exist on `wallets`) starts flowing into `wallet_score_history` nightly, so the R13 V2 canary finally becomes decidable after 30 measurements. This is the deliberate restart of the canary; do not remove Phase 10b shadow scoring.

- [ ] **Step 1: Write the failing test**

Create `lib/__tests__/score-history.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildScoreHistoryRows } from "../score-history";

const DATE = "2026-08-08";

describe("buildScoreHistoryRows", () => {
  it("takes the newest snapshot score per wallet (input sorted newest-first)", () => {
    const rows = buildScoreHistoryRows(
      DATE,
      [{ id: "w1", overall_score_shadow: 0.7 }],
      [
        { wallet_id: "w1", overall_score: 0.61, snapshot_time: "2026-08-08T00:37:00Z" },
        { wallet_id: "w1", overall_score: 0.42, snapshot_time: "2026-08-07T00:37:00Z" },
      ],
      [{ wallet_id: "w1", daily_pnls: [10, 20, 30] }]
    );
    expect(rows).toEqual([
      { date: DATE, wallet_id: "w1", overall_score: 0.61, overall_score_shadow: 0.7, daily_pnl_usd: 30 },
    ]);
  });

  it("skips wallets that have no snapshot score", () => {
    const rows = buildScoreHistoryRows(
      DATE,
      [{ id: "w1" }, { id: "w2" }],
      [{ wallet_id: "w2", overall_score: 0.5, snapshot_time: "2026-08-08T00:37:00Z" }],
      []
    );
    expect(rows.map((r) => r.wallet_id)).toEqual(["w2"]);
  });

  it("defaults pnl to 0 and shadow to null when absent", () => {
    const rows = buildScoreHistoryRows(
      DATE,
      [{ id: "w1" }],
      [{ wallet_id: "w1", overall_score: 0.5, snapshot_time: "2026-08-08T00:37:00Z" }],
      [{ wallet_id: "w1", daily_pnls: null }]
    );
    expect(rows[0].daily_pnl_usd).toBe(0);
    expect(rows[0].overall_score_shadow).toBeNull();
  });

  it("ignores snapshots with null overall_score", () => {
    const rows = buildScoreHistoryRows(
      DATE,
      [{ id: "w1" }],
      [
        { wallet_id: "w1", overall_score: null, snapshot_time: "2026-08-08T00:37:00Z" },
        { wallet_id: "w1", overall_score: 0.33, snapshot_time: "2026-08-07T00:37:00Z" },
      ],
      []
    );
    expect(rows[0].overall_score).toBe(0.33);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run lib/__tests__/score-history.test.ts`
Expected: FAIL, cannot resolve `../score-history`.

- [ ] **Step 3: Implement the pure helper**

Create `lib/score-history.ts` (no imports from `lib/env.ts`, keep it pure):

```ts
// Pure row-building logic for daily wallet score history (rank IC input).
// Kept free of Supabase and env imports so it is unit-testable.

export interface ScoreHistoryRow {
  date: string;
  wallet_id: string;
  overall_score: number;
  overall_score_shadow: number | null;
  daily_pnl_usd: number;
}

export function buildScoreHistoryRows(
  date: string,
  activeWallets: Array<{ id: string; overall_score_shadow?: number | null }>,
  snapshots: Array<{ wallet_id: string; overall_score: number | null; snapshot_time: string }>,
  backtests: Array<{ wallet_id: string; daily_pnls: number[] | null }>
): ScoreHistoryRow[] {
  const latestScore = new Map<string, number>();
  for (const snap of snapshots) {
    if (!latestScore.has(snap.wallet_id) && snap.overall_score !== null) {
      latestScore.set(snap.wallet_id, snap.overall_score);
    }
  }

  const pnlMap = new Map<string, number>();
  for (const bt of backtests) {
    const arr = bt.daily_pnls;
    if (Array.isArray(arr) && arr.length > 0) {
      pnlMap.set(bt.wallet_id, arr[arr.length - 1] ?? 0);
    }
  }

  return activeWallets
    .filter((w) => latestScore.has(w.id))
    .map((w) => ({
      date,
      wallet_id: w.id,
      overall_score: latestScore.get(w.id) as number,
      overall_score_shadow: w.overall_score_shadow ?? null,
      daily_pnl_usd: pnlMap.get(w.id) ?? 0,
    }));
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run lib/__tests__/score-history.test.ts`
Expected: 4 passing.

- [ ] **Step 5: Rewrite writeScoreHistory to use real columns and to throw on failure**

Replace the entire `writeScoreHistory` function in `scripts/daily-wallet-scan.ts` (currently lines 1792-1845) with:

```ts
async function writeScoreHistory(): Promise<{ written: number }> {
  const today = new Date().toISOString().slice(0, 10);

  // overall_score lives on cohort_snapshots, NOT wallets. Selecting it from
  // wallets was the phantom-column bug that kept this table empty for 4 months.
  const { data: activeWallets, error: walletErr } = await supabase
    .from("wallets")
    .select("id, overall_score_shadow")
    .eq("is_active", true);

  if (walletErr) throw new Error(`[score-history] wallet fetch: ${walletErr.message}`);
  if (!activeWallets || activeWallets.length === 0) return { written: 0 };

  const walletIds = activeWallets.map((w) => w.id);

  // Chunk the .in() filters: ~500 UUIDs in a single PostgREST query URL risks
  // a 414. Chunks are disjoint by wallet, and each chunk is sorted newest-first,
  // so first-occurrence-per-wallet in buildScoreHistoryRows stays correct.
  const IN_CHUNK = 200;
  const snapshots: Array<{ wallet_id: string; overall_score: number | null; snapshot_time: string }> = [];
  const backtests: Array<{ wallet_id: string; daily_pnls: number[] | null }> = [];
  for (let i = 0; i < walletIds.length; i += IN_CHUNK) {
    const ids = walletIds.slice(i, i + IN_CHUNK);

    const { data: snapChunk, error: snapErr } = await supabase
      .from("cohort_snapshots")
      .select("wallet_id, overall_score, snapshot_time")
      .in("wallet_id", ids)
      .order("snapshot_time", { ascending: false })
      .limit(ids.length * 2);
    if (snapErr) throw new Error(`[score-history] snapshot fetch: ${snapErr.message}`);
    snapshots.push(...((snapChunk ?? []) as typeof snapshots));

    const { data: btChunk, error: btErr } = await supabase
      .from("user_pnl_backtest")
      .select("wallet_id, daily_pnls")
      .in("wallet_id", ids);
    if (btErr) throw new Error(`[score-history] backtest fetch: ${btErr.message}`);
    backtests.push(...((btChunk ?? []) as typeof backtests));
  }

  const rows = buildScoreHistoryRows(today, activeWallets, snapshots, backtests);

  if (rows.length === 0) {
    throw new Error(
      `[score-history] built 0 rows for ${activeWallets.length} active wallets, no snapshot scores found`
    );
  }

  let written = 0;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase
      .from("wallet_score_history")
      .upsert(chunk, { onConflict: "date,wallet_id" });
    if (error) throw new Error(`[score-history] upsert: ${error.message}`);
    written += chunk.length;
  }
  return { written };
}
```

Add the import at the top of the script alongside the existing lib imports:

```ts
import { buildScoreHistoryRows } from "../lib/score-history";
```

Throwing is deliberate: `main().catch` exits 1, which turns the GitHub Actions job red. Silent green-while-broken is the failure mode that cost 4 months of data.

- [ ] **Step 6: Typecheck, run full tests**

Run: `npm run typecheck && npm run test`
Expected: clean.

- [ ] **Step 7: One-shot prod verification**

Run the scan locally against prod once (requires `.env.local` vars in the shell):

```bash
npx tsx scripts/daily-wallet-scan.ts
```

Then verify via Supabase MCP: `SELECT count(*), max(date) FROM wallet_score_history;`
Expected: count equals roughly the active wallet count (58 until Task 10 rebuilds the cohort), max(date) is today. Note: the full scan takes up to 50 minutes; it is acceptable to instead defer this verification to Task 10's workflow_dispatch run and only verify typecheck plus tests here.

- [ ] **Step 8: Commit**

```bash
git add lib/score-history.ts lib/__tests__/score-history.test.ts scripts/daily-wallet-scan.ts
git commit -m "fix(scan): score history read from cohort_snapshots, throw on write failure (phantom-column bug, audit root cause 1)"
```

---

### Task 5: Make the scan and CI fail loudly

**Files:**
- Modify: `scripts/daily-wallet-scan.ts` (Phase 10b swallow at lines 1127-1130)
- Modify: `.github/workflows/daily-wallet-scan.yml` (assertion step)

**Interfaces:**
- Consumes: `scan-summary.json` field `score_history_written` (written at scripts/daily-wallet-scan.ts:1745).

- [ ] **Step 1: Log the Phase 10b swallow**

At `scripts/daily-wallet-scan.ts:1127-1130`, the shadow-score upsert ignores errors silently (`if (!error) computed += chunk.length;` with no else). Change it to:

```ts
if (error) {
  console.error("[shadow-scoring] upsert error:", error.message);
} else {
  computed += chunk.length;
}
```

- [ ] **Step 2: Add a summary assertion step to the workflow**

In `.github/workflows/daily-wallet-scan.yml`, after the step that runs the scan and before the artifact upload step, insert:

```yaml
      - name: Assert scan produced score history
        run: |
          python3 - <<'EOF'
          import json, sys
          s = json.load(open('scan-summary.json'))
          written = s.get('score_history_written', 0)
          if written == 0:
              sys.exit('score_history_written is 0: silent write failure, see audit 2026-08-08')
          print('score_history_written:', written)
          EOF
```

The artifact upload step already has `if: always()`, so the summary is preserved even when this assertion fails.

- [ ] **Step 3: Validate workflow syntax, typecheck, commit**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/daily-wallet-scan.yml'))"
npm run typecheck && npm run test
git add scripts/daily-wallet-scan.ts .github/workflows/daily-wallet-scan.yml
git commit -m "fix(ci): scan job fails red when score history writes nothing; log shadow-score upsert errors"
```

---

### Task 6: Honest freshness, monitor what actually matters

**Files:**
- Modify: `app/api/cohort-state/route.ts:137-139` (fabricated updated_at)
- Modify: `.github/workflows/freshness-check.yml` (add data-flow checks)

**Interfaces:**
- Consumes: GitHub Actions secrets `SUPABASE_URL` and `SUPABASE_ANON_KEY` (already configured for other workflows; anon key is sufficient because these checks only need row-level reads that RLS currently denies to anon... it does not: RLS has no policies, anon sees zero rows. Use `SUPABASE_SERVICE_ROLE_KEY`, also already configured, and never echo it).

- [ ] **Step 1: Stop fabricating updated_at in the Supabase fallback**

In `app/api/cohort-state/route.ts`, the fallback payload at lines 137-139 stamps fresh timestamps onto day-old data. Replace the `updated_at` line:

```ts
    // Honest freshness: report the age of the data we are actually serving.
    // Fabricating updated_at = now here blinded every freshness monitor.
    const newestSnapshotTime =
      [...latestByWallet.values()]
        .map((s) => s.snapshot_time as string)
        .sort()
        .pop() ?? new Date(0).toISOString();

    const fallbackPayload: CohortCachePayload = {
      updated_at:           newestSnapshotTime,
```

(Only the `updated_at` value changes; every other field in the payload stays as is.)

- [ ] **Step 2: Extend the freshness workflow with a data-cadence check**

Replace the single check step in `.github/workflows/freshness-check.yml` so the job verifies both API freshness and database write cadence:

```yaml
      - name: Verify /api/cohort-state updated_at is recent
        env:
          TARGET_URL: https://hyperliquidflow.vercel.app/api/cohort-state
          MAX_AGE_SECONDS: '1200'
        run: |
          set -euo pipefail
          body=$(curl -sS -f "$TARGET_URL")
          updated_at=$(echo "$body" | python3 -c "import json,sys; print(json.load(sys.stdin)['updated_at'])")
          age=$(python3 -c "
          from datetime import datetime, timezone
          updated = datetime.fromisoformat('$updated_at'.replace('Z','+00:00'))
          print(int((datetime.now(timezone.utc) - updated).total_seconds()))
          ")
          echo "updated_at: $updated_at"
          echo "age: ${age}s (threshold: ${MAX_AGE_SECONDS}s)"
          if [ "$age" -gt "$MAX_AGE_SECONDS" ]; then
            echo "::error::Cohort snapshot is stale by ${age}s, refresh pipeline may be down"
            exit 1
          fi

      - name: Verify snapshots are being written (heartbeat alive)
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
          MAX_AGE_SECONDS: '2700'
        run: |
          set -euo pipefail
          latest=$(curl -sS -f \
            "$SUPABASE_URL/rest/v1/cohort_snapshots?select=snapshot_time&order=snapshot_time.desc&limit=1" \
            -H "apikey: $SUPABASE_KEY" -H "Authorization: Bearer $SUPABASE_KEY" \
            | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['snapshot_time'])")
          age=$(python3 -c "
          from datetime import datetime, timezone
          t = datetime.fromisoformat('$latest'.replace('Z','+00:00').split('+')[0] + '+00:00')
          print(int((datetime.now(timezone.utc) - t).total_seconds()))
          ")
          echo "latest snapshot: $latest (age ${age}s, threshold ${MAX_AGE_SECONDS}s)"
          if [ "$age" -gt "$MAX_AGE_SECONDS" ]; then
            echo "::error::No cohort snapshot written in ${age}s, the 5-minute heartbeat is dead"
            exit 1
          fi

      - name: Verify score history wrote within 48h (nightly scan alive)
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
        run: |
          set -euo pipefail
          latest=$(curl -sS -f \
            "$SUPABASE_URL/rest/v1/wallet_score_history?select=date&order=date.desc&limit=1" \
            -H "apikey: $SUPABASE_KEY" -H "Authorization: Bearer $SUPABASE_KEY" \
            | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0]['date'] if d else '1970-01-01')")
          ok=$(python3 -c "
          from datetime import date, timedelta
          print(1 if date.fromisoformat('$latest') >= date.today() - timedelta(days=2) else 0)
          ")
          echo "latest score history date: $latest"
          if [ "$ok" != "1" ]; then
            echo "::error::wallet_score_history has no row in 48h, nightly scan or Phase 11 is dead"
            exit 1
          fi
```

Important sequencing: the two new checks will fail until Task 7 (heartbeat) and Task 10 (first scan run) land. That is correct behavior, not a bug; enable the workflow in Task 7 and expect red until Task 10 completes.

- [ ] **Step 3: Validate, typecheck, commit**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/freshness-check.yml'))"
npm run typecheck && npm run test
git add app/api/cohort-state/route.ts .github/workflows/freshness-check.yml
git commit -m "fix(observability): honest fallback updated_at; freshness check verifies snapshot cadence and score-history writes"
```

---

### Task 7: Re-enable workflows, keepalive, UptimeRobot heartbeat

**Files:**
- Create: `.github/workflows/keepalive.yml`
- Manual: GitHub UI or gh CLI (re-enable 4 workflows), UptimeRobot account (2 monitors)

**Interfaces:**
- Produces: sub-daily refresh cadence (UptimeRobot pings `/api/cohort-state` every 5 min; the route fires a background refresh whenever the KV payload is more than 5 min stale, restoring the pre-July detection cadence).
- Verified 2026-08-08: the stale-triggered background refresh WORKS in prod (a manual probe moved `updated_at` from 00:37 to 11:27 UTC within minutes). The once-daily cadence was purely absence of pings, not a broken trigger.

- [ ] **Step 1: Create the keepalive workflow**

GitHub disables ALL scheduled workflows after 60 days without repo activity. A monthly bot commit resets that counter for every workflow, including itself. Create `.github/workflows/keepalive.yml`:

```yaml
name: Keepalive

# GitHub auto-disables scheduled workflows after 60 days without repo activity.
# That silent disable killed the entire data pipeline on 2026-06-22 (audit
# 2026-08-08, root cause 2). A monthly heartbeat commit resets the counter
# for every workflow in this repo, including this one.

on:
  schedule:
    - cron: '0 4 1 * *'
  workflow_dispatch:

permissions:
  contents: write

jobs:
  keepalive:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
      - name: Commit heartbeat
        run: |
          date -u +%Y-%m-%dT%H:%M:%SZ > .github/keepalive
          git config user.name "keepalive"
          git config user.email "actions@users.noreply.github.com"
          git add .github/keepalive
          git commit -m "chore: monthly keepalive heartbeat"
          git push
```

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/keepalive.yml'))"
git add .github/workflows/keepalive.yml
git commit -m "ci: monthly keepalive commit so GitHub can never auto-disable the schedules again"
git push origin main
```

Push here matters: the following steps operate on the remote.

- [ ] **Step 2: Re-enable the four disabled workflows**

Option A (CLI):

```bash
brew install gh
gh auth login
gh workflow enable daily-wallet-scan.yml
gh workflow enable freshness-check.yml
gh workflow enable signal-learning.yml
gh workflow enable rank-ic.yml
gh workflow list --all
```

Option B (web): repo, Actions tab, select each workflow showing the "This scheduled workflow is disabled" banner, click "Enable workflow".

Verify: `curl -s https://api.github.com/repos/hyperliquidflow/hyperliquidflow/actions/workflows | python3 -c "import json,sys; [print(w['path'], w['state']) for w in json.load(sys.stdin)['workflows']]"` shows `active` for all five (four re-enabled plus keepalive).

- [ ] **Step 3: Create the UptimeRobot heartbeat + alarm**

At uptimerobot.com (free tier), signed in as sidahimsa@proton.me:

1. Monitor 1 (the heartbeat): type HTTP(s), URL `https://hyperliquidflow.vercel.app/api/cohort-state`, interval 5 minutes, alert contact: email. Each ping triggers the route's background refresh whenever KV is stale, which restores signal-detection cadence.
2. Monitor 2 (the alarm on the alarm): type Keyword, URL `https://hyperliquidflow.vercel.app/api/cohort-state`, keyword `updated_at`, alert if keyword missing, interval 5 minutes. Catches the route returning errors rather than data.

- [ ] **Step 4: Verify cadence within the hour**

After 30-60 minutes, via Supabase MCP:

```sql
SELECT count(*) AS snaps_last_hour FROM cohort_snapshots WHERE snapshot_time > NOW() - INTERVAL '1 hour';
```

Expected: roughly 6-12 times the active wallet count per hour once warm (one snapshot per wallet per ~5-10 min cycle). Anything greater than the active count proves sub-daily cadence is back.

---

### Task 8: Hygiene inflow guard, never melt the cohort again

**Files:**
- Modify: `lib/cohort-hygiene.ts` (add `isScanFresh` helper)
- Test: `lib/__tests__/cohort-hygiene.test.ts` (append)
- Modify: `app/api/refresh-cohort/route.ts:540-557` (conditional destructive maintenance)

**Interfaces:**
- Produces: `isScanFresh(lastScannedAt: string | null, now?: Date, maxAgeHours?: number): boolean` exported from `lib/cohort-hygiene.ts`.

- [ ] **Step 1: Write the failing test**

Append to `lib/__tests__/cohort-hygiene.test.ts`:

```ts
import { isScanFresh } from "../cohort-hygiene";

describe("isScanFresh", () => {
  const now = new Date("2026-08-08T12:00:00Z");

  it("true when the last scan is within 48h", () => {
    expect(isScanFresh("2026-08-07T00:30:00Z", now)).toBe(true);
  });

  it("false when the last scan is older than 48h", () => {
    expect(isScanFresh("2026-06-22T03:27:00Z", now)).toBe(false);
  });

  it("false when there has never been a scan", () => {
    expect(isScanFresh(null, now)).toBe(false);
  });
});
```

(If the file already imports from `../cohort-hygiene`, merge `isScanFresh` into the existing import statement instead of adding a duplicate import.)

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run lib/__tests__/cohort-hygiene.test.ts`
Expected: FAIL, `isScanFresh` is not exported.

- [ ] **Step 3: Implement the helper**

Add to `lib/cohort-hygiene.ts`:

```ts
/**
 * True when the nightly scan has run recently enough that hygiene pruning is
 * safe. When the scan (the only cohort inflow) is dead, pruning with no
 * replacement melted the cohort 493 -> 58 between Jun 22 and Aug 3, 2026.
 */
export function isScanFresh(
  lastScannedAt: string | null,
  now: Date = new Date(),
  maxAgeHours = 48
): boolean {
  if (!lastScannedAt) return false;
  const ageMs = now.getTime() - new Date(lastScannedAt).getTime();
  return ageMs <= maxAgeHours * 3_600_000;
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run lib/__tests__/cohort-hygiene.test.ts`
Expected: all pass.

- [ ] **Step 5: Gate the destructive maintenance in the refresh route**

In `app/api/refresh-cohort/route.ts`, import `isScanFresh` from `@/lib/cohort-hygiene` (extend the existing import from that module). Then restructure the `tasks` array construction at lines 540-557: fetch scan freshness first, and only include the two destructive tasks when the scan is fresh.

```ts
        const { data: lastScanRow } = await supabase
          .from("wallets")
          .select("last_scanned_at")
          .not("last_scanned_at", "is", null)
          .order("last_scanned_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const scanFresh = isScanFresh(lastScanRow?.last_scanned_at ?? null);

        const tasks: Array<{ name: string; p: Promise<unknown> }> = [];

        if (scanFresh) {
          tasks.push({
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
          });
          tasks.push({ name: "pruneUnderperformers", p: pruneUnderperformers() });
        } else {
          console.warn("[hygiene] skipped: last scan older than 48h, pruning with no inflow melts the cohort");
        }

        tasks.push({ name: "runBridgeInflowEnrichment", p: runBridgeInflowEnrichment(wallets.map((w) => ({ id: w.id, address: w.address }))) });
        tasks.push({ name: "runTwapEnrichment",         p: runTwapEnrichment(twapCandidates) });
        tasks.push({ name: "updateIntradayRecipePerformance", p: updateIntradayRecipePerformance() });
```

(The `signal_timing` push below this block stays unchanged.)

- [ ] **Step 6: Typecheck, full tests, commit**

```bash
npm run typecheck && npm run test
git add lib/cohort-hygiene.ts lib/__tests__/cohort-hygiene.test.ts app/api/refresh-cohort/route.ts
git commit -m "fix(hygiene): skip pruning and hygiene gates when the scan is stale (no inflow, no attrition)"
```

---

### Task 9: Truth pass on docs and comments

**Files:**
- Modify: `CLAUDE.md` (data flow, KV TTLs, workflows)
- Modify: `docs/sprints/status.md` (audit outcome, roadmap pointer)
- Modify: `app/api/refresh-cohort/route.ts:1-10` (header comment), `:57-59` (TTL comment)
- Create: `docs/audit/2026-08-08-full-audit.md`

- [ ] **Step 1: Fix the refresh-cohort header fiction**

Replace the file header comment of `app/api/refresh-cohort/route.ts` (which claims "runs every 60 seconds" and "9 signal recipes") with:

```ts
/**
 * /api/refresh-cohort
 *
 * Scores the active cohort, runs the 13-recipe signal lab, writes the KV
 * snapshot. Triggered by: the daily Vercel cron (00:00 UTC), and by
 * /api/cohort-state firing a background refresh whenever its KV payload is
 * more than 5 minutes stale (driven by the UptimeRobot 5-minute ping).
 */
```

Also correct the KV TTL comment near line 57-59 to state the actual values (600s primary, 24h fallback) and remove the reference to a GitHub Actions 5-minute ping.

- [ ] **Step 2: Update CLAUDE.md**

In the Data Flow section, replace the "GitHub Actions ping (24/7)" block with:

```
UptimeRobot (5-min ping, 24/7)     GitHub Actions (01:00 UTC daily)
  hits /api/cohort-state             scripts/signal-learning.ts
  which background-refreshes         updates signal_outcomes stats
  the cohort when stale >5 min
```

In the KV Cache Keys table, change `cohort:active` TTL from `~120s` to `600s` and note the fallback key TTL is 24h. In the GitHub Actions section, add `keepalive.yml` (monthly heartbeat commit, prevents the 60-day scheduled-workflow auto-disable) and remove references to `signal_events`. In the Supabase Migrations table, add `020 | Drop signal_events + rate_limit_tokens, retention to 180d`.

- [ ] **Step 3: Update sprint status**

In `docs/sprints/status.md`, under Active Sprint, replace the current block with:

```
**Recovery: Phase 0 Clean House and Resurrection (2026-08-08 audit)**
Status: IN PROGRESS
Plan: docs/superpowers/plans/2026-08-08-phase0-clean-house-and-resurrection.md
Roadmap: docs/superpowers/specs/2026-08-08-rebuild-roadmap.md
Full audit: docs/audit/2026-08-08-full-audit.md

Sprint 6 (Auth) and Sprint 7 (UI revision) are deferred until the rebuild
roadmap's Phase 2 has produced a prove-or-kill verdict. Sprint 8's data gate
was found never met (retention had wiped the outcomes); it is superseded by
the roadmap.
```

- [ ] **Step 4: Write the in-repo audit summary**

Create `docs/audit/2026-08-08-full-audit.md` containing: the verdict (no measured edge ever existed, and none was measurable), the five root causes with file:line references (phantom column daily-wallet-scan.ts:1795, workflows disabled_inactivity Jun 22, cron-job.org heartbeat death ~Jul 16, retention vs cold-start deadlock signal-learning.ts:107 vs migration 007:40-47, wallet-signal-stats.ts never wired), the component scorecard summary (KEEP/FIX/CUT/UNPROVEN), the recipe cut list (15 to 6), and a link to the full published report. Source material: the published artifact of 2026-08-08. Note prominently that this supersedes docs/audit/2026-07-22-full-project-audit.md, which reported wallet_score_history and rank_ic_history as populated without querying them.

- [ ] **Step 5: Typecheck, commit, push**

```bash
npm run typecheck && npm run test
git add CLAUDE.md docs/sprints/status.md docs/audit/2026-08-08-full-audit.md app/api/refresh-cohort/route.ts
git commit -m "docs: truth pass, cadence and TTL facts corrected, 2026-08-08 audit recorded, roadmap linked"
git push origin main
```

---

### Task 10: Resurrection run and verification

**Files:** none (operational task)

- [ ] **Step 1: Deploy**

Confirm Vercel picked up the pushed commits (the cohort-state and refresh-cohort changes must be live before relying on the new freshness semantics). Check the Vercel dashboard deployment status or `vercel ls`.

- [ ] **Step 2: Trigger the scan manually**

```bash
gh workflow run daily-wallet-scan.yml
sleep 10
RUN_ID=$(gh run list --workflow=daily-wallet-scan.yml --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$RUN_ID" --exit-status
```

(Or Actions tab, Daily Wallet Scan, Run workflow.) Duration: 40-50 minutes.

- [ ] **Step 3: Verify the resurrection**

Via Supabase MCP after the run completes:

```sql
SELECT count(*) FROM wallets WHERE is_active = true;                          -- expect ~300-500
SELECT count(*), max(date) FROM wallet_score_history;                          -- expect count ~= active, date = today
SELECT count(*) FROM cohort_snapshots WHERE snapshot_time > NOW() - INTERVAL '1 hour';  -- expect > active count (heartbeat)
```

And check: the scan run is green, the "Assert scan produced score history" step passed, freshness-check runs green on its next tick, UptimeRobot shows both monitors up.

- [ ] **Step 4: Record completion**

Update `docs/sprints/status.md`: mark Phase 0 COMPLETE with the date and the verified numbers. Commit:

```bash
git add docs/sprints/status.md
git commit -m "docs: Phase 0 resurrection complete, cohort and pipelines verified live"
git push origin main
```

**Exit criteria (all must hold):**
- `git status` clean, all five workflows `active`, keepalive scheduled.
- Cohort rebuilt to hundreds of wallets, snapshots flowing every ~5-10 min.
- `wallet_score_history` gaining rows nightly, asserted red-on-failure in CI.
- Freshness check verifies API age, snapshot cadence, and score-history writes.
- UptimeRobot emails on any 5-minute ping failure.
- Every dead table, dead file, and false comment identified by the audit is gone.
