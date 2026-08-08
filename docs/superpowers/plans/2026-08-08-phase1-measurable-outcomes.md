# Phase 1: Measurable Outcomes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every fired signal receives a trustworthy net-PnL grade within ~26 hours, only cohort-structural recipes remain, and no page claims more freshness or health than the data has.

**Architecture:** Three chunks. (1a) Grading: price outcomes from historical candles at true horizons instead of a once-daily spot price, and grade each outcome individually as it matures instead of waiting for a batch quorum that can never be reached. (1b) Recipe surgery: 15 recipes down to 6 that have a cohort-structural reason to exist, each with golden-fixture tests. (1c) UI honesty: every surface states its data age; no hardcoded health.

**Tech Stack:** Next.js 15, Supabase, Vercel crons, GitHub Actions, Vitest.

## Global Constraints

- No em dashes or en dashes in file content, including markdown. A PreToolUse hook blocks them.
- All UI colors from `lib/design-tokens.ts`. Invoke the `ui-design-enforcer` skill before any JSX edit.
- No internal language in user-facing copy (no "cron", "KV", "GitHub Actions", "refresh cycle").
- Run `npm run typecheck` and `npx vitest run` before every commit touching TypeScript.
- YAML validation: `ruby -ryaml -e "YAML.load_file('<file>')"` (no pyyaml or js-yaml available locally).
- Prod DB changes: write the migration file, apply via Supabase dashboard SQL editor, then verify by query.

## Phase 0 outcome this builds on

Pipelines are live: heartbeat every ~5 min (UptimeRobot), nightly scan green with a score-history assertion, `wallet_score_history` accumulating (57 rows on day one), retention at 180 days, dead tables dropped. Cohort is 77 active wallets after gates, which is low; gate calibration is Task 7 here.

---

### Task 1: True-horizon outcome pricing

**Files:**
- Modify: `lib/outcome-helpers.ts` (add `priceAt`)
- Test: `lib/__tests__/outcome-helpers.test.ts` (append)
- Modify: `app/api/measure-outcomes/route.ts` (candle-based rewrite)
- Modify: `vercel.json` (measure-outcomes maxDuration 25 stays; schedule unchanged)

**Interfaces:**
- Produces: `priceAt(candles: Array<{t: number; c: string}>, targetMs: number): number | null`, the first candle at or after `targetMs`, close price, or null.

Why: the route currently stamps `allMids` (the price *now*) into `price_1h`, `price_4h`, and `price_24h`. With one daily run, `price_4h` held a ~25h price. Every 4h statistic in the stats engine was built on that. Candles make horizons exact regardless of when the job runs.

- [ ] **Step 1: Write the failing test**

Append to `lib/__tests__/outcome-helpers.test.ts`:

```ts
import { priceAt } from "../outcome-helpers";

describe("priceAt", () => {
  const candles = [
    { t: 1000, c: "10" },
    { t: 2000, c: "20" },
    { t: 3000, c: "30" },
  ];

  it("returns the close of the first candle at or after the target", () => {
    expect(priceAt(candles, 2000)).toBe(20);
  });

  it("returns the next candle when the target falls between candles", () => {
    expect(priceAt(candles, 1500)).toBe(20);
  });

  it("returns null when the target is past the last candle", () => {
    expect(priceAt(candles, 9999)).toBeNull();
  });

  it("returns null for a non-numeric or non-positive close", () => {
    expect(priceAt([{ t: 1000, c: "0" }], 1000)).toBeNull();
    expect(priceAt([{ t: 1000, c: "abc" }], 1000)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run lib/__tests__/outcome-helpers.test.ts`
Expected: FAIL, `priceAt` is not exported.

- [ ] **Step 3: Implement**

Add to `lib/outcome-helpers.ts`:

```ts
/** First candle whose open time is at or after targetMs, close price. Null when
 *  the target is beyond the series or the close is unusable. */
export function priceAt(
  candles: Array<{ t: number; c: string }>,
  targetMs: number
): number | null {
  for (const candle of candles) {
    if (candle.t >= targetMs) {
      const price = parseFloat(candle.c);
      return isFinite(price) && price > 0 ? price : null;
    }
  }
  return null;
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run lib/__tests__/outcome-helpers.test.ts`
Expected: all pass.

- [ ] **Step 5: Rewrite the route to price from candles**

In `app/api/measure-outcomes/route.ts`, replace the `allMids` block (steps 2 and 3, roughly lines 39-91) with per-coin candle fetches. Keep the auth check, the pending query, and the chunked update loop as they are. Extend `HORIZON_MS` to `30 * 24 * 60 * 60 * 1000` now that retention is 180 days.

```ts
import { fetchCandleSnapshot } from "@/lib/hyperliquid-api-client";
import { computeOutcome, computeMovePct, priceAt } from "@/lib/outcome-helpers";

const HOUR_MS = 60 * 60 * 1000;

// ... after the pending fetch:

  // Group by coin so each coin needs one candle request.
  const byCoin = new Map<string, typeof pending>();
  for (const row of pending) {
    const list = byCoin.get(row.coin) ?? [];
    list.push(row);
    byCoin.set(row.coin, list);
  }

  const now = Date.now();
  const updates: { id: string; patch: Record<string, unknown> }[] = [];
  let delisted = 0;

  for (const [coin, coinRows] of byCoin) {
    const minCreated = Math.min(...coinRows.map((r) => new Date(r.created_at).getTime()));
    let candles;
    try {
      candles = await fetchCandleSnapshot(coin, "1h", minCreated - HOUR_MS, now);
    } catch {
      delisted += coinRows.length;
      continue;
    }
    if (!candles || candles.length === 0) {
      delisted += coinRows.length;
      continue;
    }

    for (const row of coinRows) {
      const firedMs = new Date(row.created_at).getTime();
      const ageMs   = now - firedMs;
      const entry   = Number(row.price_at_signal);
      const patch: Record<string, unknown> = {};

      const horizons: Array<[number, "1h" | "4h" | "24h", number | null]> = [
        [1,  "1h",  row.price_1h],
        [4,  "4h",  row.price_4h],
        [24, "24h", row.price_24h],
      ];

      for (const [hours, label, existing] of horizons) {
        if (ageMs < hours * HOUR_MS || existing != null) continue;
        const price = priceAt(candles, firedMs + hours * HOUR_MS);
        if (price == null) continue;
        patch[`price_${label}`]    = price;
        patch[`move_pct_${label}`] = parseFloat(computeMovePct(entry, price).toFixed(4));
        patch[`outcome_${label}`]  = computeOutcome(row.direction, entry, price);
        if (label === "24h") patch.resolved_at = new Date().toISOString();
      }

      if (Object.keys(patch).length > 0) updates.push({ id: row.id, patch });
    }
  }
```

Include `delisted` in the completion log and the JSON response.

- [ ] **Step 6: Typecheck, test, commit**

```bash
npm run typecheck && npx vitest run
git add lib/outcome-helpers.ts lib/__tests__/outcome-helpers.test.ts app/api/measure-outcomes/route.ts
git commit -m "fix(outcomes): price 1h/4h/24h from candles at true horizons, not a single daily spot price"
```

---

### Task 2: Per-outcome grading, remove the cold-start deadlock

**Files:**
- Modify: `scripts/signal-learning.ts` (`checkColdStart`, `main`, `backfillAtrExits`)
- Test: `lib/__tests__/signal-learning.test.ts` (append a gate test if a pure helper is extracted)

**Interfaces:**
- Consumes: Task 1's honest `price_1h/4h/24h`.
- Produces: `is_win` and `net_pnl_bps` populated for every resolved directional outcome, with no population minimum.

Why: the gate required 100 outcomes AND 30 days simultaneously, while retention deleted at 30 days. At any realistic signal rate the gate could never open, so no outcome was ever graded.

- [ ] **Step 1: Delete the cold-start gate from the grading path**

In `scripts/signal-learning.ts`:
- Delete the `checkColdStart` function entirely.
- In `main()`, remove the `isColdStart` branch so `backfillAtrExits()` runs unconditionally. Keep `runStatsEngine()` unconditional too; it already computes Wilson intervals and marks low-sample recipes as INSUFFICIENT_DATA, which is the correct way to express uncertainty.
- Keep the `writeAgentLog` OBSERVATION call, but move it into `main()` and log actual counts: rows graded this run, total graded, oldest outcome age.

Grading is per row and idempotent (`.is("exit_reason", null)` already scopes it to ungraded rows), so no quorum is needed.

- [ ] **Step 2: Keep statistical honesty in the stats engine**

Confirm `runStatsEngine` retains its per-recipe minimum sample threshold for `meets_min_sample` and `confidence`. Small samples must be labeled, not hidden. Only the *grading* gate is removed, not the *inference* gate.

- [ ] **Step 3: Run against prod once**

```bash
npx tsx scripts/signal-learning.ts
```

Expected: the log reports rows graded rather than "Cold start guard". Verify: `SELECT count(*) FROM signal_outcomes WHERE is_win IS NOT NULL;` is greater than 0 once any outcome has passed its 24h horizon.

- [ ] **Step 4: Typecheck, test, commit**

```bash
npm run typecheck && npx vitest run
git add scripts/signal-learning.ts
git commit -m "fix(learning): grade each outcome as it matures, remove the unreachable cold-start quorum"
```

---

### Task 3: Wire the calibration filler, end EV circularity

**Files:**
- Modify: `.github/workflows/signal-learning.yml`
- Modify: `lib/signal-lab.ts` (`enrichWithEv` fallback log)

- [ ] **Step 1: Add the missing workflow step**

In `.github/workflows/signal-learning.yml`, after the signal-learning step (same `env` block), add:

```yaml
      - name: Update wallet and recipe signal stats
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
          SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
          KV_REST_API_URL: ${{ secrets.KV_REST_API_URL }}
          KV_REST_API_TOKEN: ${{ secrets.KV_REST_API_TOKEN }}
          KV_REST_API_READ_ONLY_TOKEN: ${{ secrets.KV_REST_API_READ_ONLY_TOKEN }}
          HYPERLIQUID_API_URL: ${{ secrets.HYPERLIQUID_API_URL }}
        run: npx tsx scripts/wallet-signal-stats.ts
```

This script's own header has claimed this wiring existed since April. It never did, which is why `recipe_calibration` and `wallet_signal_stats` have zero rows and EV falls back to backtest win rate.

- [ ] **Step 2: Make the circular fallback visible**

In `lib/signal-lab.ts` `enrichWithEv`, where `walletWinRate` falls back to `bt.win_rate` because no `wallet_signal_stats` row exists, add a one-time-per-run counter and log it after the enrichment loop, for example `[ev] N of M signals priced from backtest fallback (no measured stats yet)`. Silent circularity is what hid this for four months.

- [ ] **Step 3: Validate, commit**

```bash
ruby -ryaml -e "YAML.load_file('.github/workflows/signal-learning.yml')"
npm run typecheck && npx vitest run
git add .github/workflows/signal-learning.yml lib/signal-lab.ts
git commit -m "fix(ev): run the calibration filler nightly and log backtest-fallback pricing"
```

---

### Task 4: Fix recipe_performance write and read semantics

**Files:**
- Modify: `scripts/daily-wallet-scan.ts` (`computeAndSaveRecipePerformance` insert)
- Modify: `app/api/refresh-cohort/route.ts` (`updateIntradayRecipePerformance` insert, `recipeWinRates` map build)
- Create: `supabase/migrations/021_recipe_performance_unique.sql`

Why: rows are appended, so `updateRecipeNetStats` patches net stats onto a row that the next intraday insert immediately buries. Separately, the reader builds its map from 50 rows ordered newest-first, and `new Map(entries)` lets later (older) entries overwrite newer ones, so gates read stale win rates.

- [ ] **Step 1: Add a uniqueness key**

Create `supabase/migrations/021_recipe_performance_unique.sql`:

```sql
-- One row per recipe per day. Append-only writes buried the nightly net-PnL
-- stats under intraday rows with null net columns (audit 2026-08-08).
DELETE FROM recipe_performance a
USING recipe_performance b
WHERE a.recipe_id = b.recipe_id
  AND date_trunc('day', a.measured_at) = date_trunc('day', b.measured_at)
  AND a.ctid < b.ctid;

ALTER TABLE recipe_performance
  ADD COLUMN IF NOT EXISTS measured_day DATE
  GENERATED ALWAYS AS ((measured_at AT TIME ZONE 'UTC')::date) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS recipe_performance_recipe_day_uniq
  ON recipe_performance (recipe_id, measured_day);
```

Apply via the Supabase SQL editor, then verify the index exists.

- [ ] **Step 2: Switch both writers to upsert**

In `scripts/daily-wallet-scan.ts` and `app/api/refresh-cohort/route.ts`, change `.insert(rows)` to `.upsert(rows, { onConflict: "recipe_id,measured_day" })`. Do not set `measured_day` in the payload; it is generated.

- [ ] **Step 3: Fix the newest-wins map**

In `app/api/refresh-cohort/route.ts`, where `recipeWinRates` and `recipeSignalCounts` are built from rows ordered `measured_at` descending, build with an explicit first-wins loop rather than `new Map(entries)`:

```ts
        const recipeWinRates = new Map<string, number>();
        const recipeSignalCounts = new Map<string, number>();
        for (const row of perfRows ?? []) {
          if (!recipeWinRates.has(row.recipe_id)) {
            recipeWinRates.set(row.recipe_id, row.win_rate ?? 0);
            recipeSignalCounts.set(row.recipe_id, row.signal_count ?? 0);
          }
        }
```

- [ ] **Step 4: Typecheck, test, commit**

```bash
npm run typecheck && npx vitest run
git add supabase/migrations/021_recipe_performance_unique.sql scripts/daily-wallet-scan.ts app/api/refresh-cohort/route.ts
git commit -m "fix(recipe-perf): one row per recipe per day, readers take the newest row"
```

---

### Task 5: Recipe surgery, 15 down to 6

**Files:**
- Modify: `lib/signal-lab.ts` (delete 9 recipes, fix 2), `lib/recipe-meta.ts`, `lib/recipe-config.ts`, `lib/hypurrscan-enrichment.ts` (bridge_inflow, twap_accumulation emitters)
- Modify: any UI referencing removed recipe ids (grep before deleting)

**Keep:** `momentum_stack`, `divergence_squeeze`, `accumulation_reentry`, `whale_validated`, `rotation_carry`, `funding_divergence`.
**Cut:** `position_aging`, `concentration_risk`, `funding_trend`, `streak_continuation`, `liq_rebound`, `wallet_churn`, `anti_whale_trap`, `bridge_inflow`, `twap_accumulation`.

- [ ] **Step 1: Delete the nine recipes**

Remove each recipe function, its registration inside `runSignalLab`, its `RECIPE_META` entry, and its `recipe-config` defaults. `bridge_inflow` and `twap_accumulation` are emitted from `lib/hypurrscan-enrichment.ts`; remove those emitters but keep Hypurrscan name enrichment, which the UI uses for labels.

Grep for each removed id across `app/`, `lib/`, and `components/` and clean up references (filter chips, meta lookups) before finishing.

- [ ] **Step 2: Make momentum_stack's window cadence-aware**

`momentum_stack` (and the now-deleted `wallet_churn`) required the snapshot pair to be within 300 seconds. The real cadence has never been faster than about 5 minutes, so the flagship recipe has essentially never fired. In `lib/signal-lab.ts`, replace the fixed comparison with a window derived from the observed pair gap, floored at the configured value:

```ts
  // The pair gap is the real detection cadence. A fixed 300s window meant this
  // recipe could only fire if two snapshots landed inside 5 minutes, which the
  // schedule never guaranteed (audit 2026-08-08).
  const WINDOW_MS = cfg.WINDOW_MS ?? 300_000;
  const effectiveWindow = Math.max(WINDOW_MS, 2 * medianPairGapMs);
```

Compute `medianPairGapMs` once in `runSignalLab` from the pairs it is given and thread it into the recipe. Cap it (for example at 2 hours) so a long outage cannot make the window meaningless.

- [ ] **Step 3: Fix rotation_carry's self-referential gate**

The gate reads `recipe_performance.win_rate`, which is the intraday `ev_score > 0` proxy, so it measures our own EV assignment rather than realized outcomes. Change the source to `win_rate_net` from the newest nightly row, and keep the bootstrap bypass until at least 10 graded signals exist. Fetch `win_rate_net` alongside `win_rate` in the route's perf query.

- [ ] **Step 4: Suspend funding_divergence from the feed**

Its only measurement is a median net loss of 316 bps per signal. Keep the recipe computing and recording outcomes, but exclude it from `recent_signals` in the KV payload until it has 30 graded outcomes with non-negative expectancy. Add a short comment naming the audit and the reinstatement condition.

- [ ] **Step 5: Typecheck, test, commit**

```bash
npm run typecheck && npx vitest run
git add lib/ app/
git commit -m "feat(recipes): cut 9 ungradeable or negative-expectancy recipes, make momentum_stack cadence-aware, fix rotation_carry gate"
```

---

### Task 6: Golden-fixture tests for the survivors

**Files:**
- Create: `lib/__tests__/signal-lab.test.ts`

`lib/signal-lab.ts` is the product and has zero tests. Threshold tuning without them is guesswork.

- [ ] **Step 1: Build a fixture factory**

Create a helper in the test file that builds a `SnapshotPair` with configurable wallet scores, positions, notionals, and timestamps, so each recipe test is three or four lines.

- [ ] **Step 2: Two tests per surviving recipe**

For each of the 6 recipes: one fixture that must fire (assert the event's `recipe_id`, `direction`, and `coin`), one near-miss fixture that must not fire (for example one wallet short of the convergence threshold). For `momentum_stack`, add a third case proving it fires at a realistic pair gap (about 5 to 10 minutes), which is the regression this whole phase exists to prevent.

- [ ] **Step 3: Add a V1 scoring test**

Append to `lib/__tests__/cohort-engine.test.ts` a test of `computeCohortScores`, the formula actually used in production, covering the weighted sum and the flat-wallet `regime_fit = 0.5` baseline.

- [ ] **Step 4: Run and commit**

```bash
npx vitest run
git add lib/__tests__/
git commit -m "test: golden fixtures for the six surviving recipes and V1 scoring"
```

---

### Task 7: Cohort gate calibration

**Files:**
- Modify: `scripts/daily-wallet-scan.ts` (G12 threshold, scoring concurrency and backoff)

The first resurrection scan produced 77 active wallets from 3,063 discovered. G12 (`low_regime_coverage`, requires 10+ days in every regime within 180 days) alone rejected 134, and 97 wallets failed scoring outright on Hyperliquid 429s.

- [ ] **Step 1: Add retry with exponential backoff**

The scan retries a 429 once with a fixed 5 second delay. Replace with three attempts at 2s, 8s, 20s, and count exhausted retries separately from other scan errors in the summary. 97 wallets silently dropped is a selection bias, not just noise.

- [ ] **Step 2: Loosen G12 to a defensible threshold**

Require 5+ days per regime rather than 10, and skip the gate entirely for wallets whose 180-day history is shorter than 120 days rather than rejecting them. Record the pre-gate and post-gate counts in `scan-summary.json` so the tradeoff stays visible.

- [ ] **Step 3: Run the scan manually and compare**

Dispatch the workflow, then compare `activated`, `rejection_breakdown`, and final active count against the 2026-08-08 baseline (3,063 discovered, 248 activated, 77 active). Target: 250 or more active wallets without weakening G1 through G9 (the quality gates).

- [ ] **Step 4: Commit**

```bash
git add scripts/daily-wallet-scan.ts
git commit -m "fix(scan): retry rate limits with backoff, loosen regime-coverage gate for short-history wallets"
```

---

### Task 8: UI honesty pass

**Files:** `app/OverviewClient.tsx`, `app/wallets/discovery/DiscoveryClient.tsx`, `lib/server/kv-fetchers.ts`, `app/wallets/leaderboard/LeaderboardClient.tsx`, `app/wallets/inposition/InPositionClient.tsx`, `app/signals/feed/FeedClient.tsx`, `app/signals/divergence/DivergenceClient.tsx`, `app/api/market-radar/route.ts`, `app/signals/performance/PerformanceClient.tsx`, `app/performance/ranking/RankingClient.tsx`, `components/nav.tsx`

**Invoke the `ui-design-enforcer` skill before the first JSX edit.**

- [ ] **Step 1: Shared freshness indicator**

Build one small component that takes `updated_at` and renders a relative age, quiet when fresh, `color.amber` past an hour, `color.red` past a day. Place it in the header of Overview, Leaderboard, In Position, Feed, Divergence, and Radar.

- [ ] **Step 2: Make the Monitoring dot mean something**

In `components/nav.tsx`, drive the pulsing dot from the payload's real age: `color.accent` and pulsing when under 15 minutes, `color.amber` and static when under an hour, `color.red` and static beyond that. Label it by state.

- [ ] **Step 3: Derive Discovery's pipeline card from live data**

In `lib/server/kv-fetchers.ts`, replace the hardcoded step strings and `ok` statuses with values computed from the newest scan and snapshot timestamps. Remove internal vocabulary per the copy rule (no "GitHub Actions", "Vercel Cron", "pg_cron", "userFillsByTime", no raw column names like `win_rate`).

- [ ] **Step 4: Fix the misleading empty states**

Feed: render the infinite-scroll sentinel even when the 24h window is empty so history loads, and change the copy from blaming filters to describing the situation. Divergence: distinguish "nothing crossed the threshold" from "no positioning data available". Signal Scores: replace "Outcome tracking is live" with copy that matches reality (graded count and horizon). Ranking: compute the projected first-measurement date from actual accumulated measurements instead of `Date.now() + 31 days`.

- [ ] **Step 5: Radar counts only active wallets**

In `app/api/market-radar/route.ts`, join or filter to `is_active = true` so retained snapshots of deactivated wallets stop being counted as current positioning. Add Radar to the nav in `components/nav.tsx` (it is currently reachable by URL only).

- [ ] **Step 6: Typecheck, test, commit**

```bash
npm run typecheck && npx vitest run
git add app/ components/ lib/
git commit -m "fix(ui): show real data age everywhere, derive pipeline health from data, honest empty states"
```

---

### Task 9: Close out

- [ ] **Step 1: Verify the grading loop end to end**

After one full day with signals firing:

```sql
SELECT count(*) FILTER (WHERE is_win IS NOT NULL) AS graded,
       count(*) AS total,
       min(created_at)::date AS oldest
FROM signal_outcomes;
SELECT recipe_id, count(*), round(avg(net_pnl_bps)::numeric, 1) AS avg_net_bps
FROM signal_outcomes WHERE is_win IS NOT NULL GROUP BY 1;
SELECT count(*) FROM recipe_calibration;
```

Expected: graded is greater than 0, `recipe_calibration` is no longer empty.

- [ ] **Step 2: Update status and hand off to Phase 2**

Mark Phase 1 complete in `docs/sprints/status.md` with the verified numbers, and note the Phase 2 review cadence (weekly): rank IC progress toward 30 measurements, per-recipe graded counts, and the funding_divergence reinstatement check.

**Exit criteria:**
- A signal fired on day N carries `is_win` and `net_pnl_bps` by day N+2.
- `recipe_calibration` and `wallet_signal_stats` are populated, and EV fallback logging shows the share still priced from backtest.
- Six recipes remain, each with golden-fixture tests; `momentum_stack` provably fires at the real cadence.
- Active cohort is 250 or more without weakening quality gates.
- Every data surface displays its age; no hardcoded health strings remain.
