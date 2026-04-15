# Performance Outcome Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `signal_outcomes` table that records price at signal fire time and resolves 1h/4h/24h directional accuracy, powering a real Performance card showing accuracy % and avg move instead of the current EV-proxy metric.

**Architecture:** A new Supabase table (`signal_outcomes`) is populated at signal fire time inside `lib/signal-lab.ts` (where `allMids` is already in scope). An hourly cron (`/api/measure-outcomes`, already registered in `vercel.json`) resolves pending windows. The `/api/recipe-performance` route gains a second query that aggregates outcomes for 7d and 30d windows. The UI reads both datasets from one API response and renders Option A card layout with a 7d/30d toggle.

**Tech Stack:** Next.js App Router, Supabase (postgres), Vercel KV, Vitest, TypeScript

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `supabase/migrations/007_signal_outcomes.sql` | Table DDL, indexes, retention cron |
| Create | `lib/outcome-helpers.ts` | Pure functions: computeOutcome, computeMovePct, buildOutcomeRows |
| Create | `lib/__tests__/outcome-helpers.test.ts` | Unit tests for outcome helpers |
| Create | `app/api/measure-outcomes/route.ts` | Hourly resolution cron handler |
| Modify | `lib/signal-lab.ts:1127-1135` | Insert into signal_outcomes after signals_history insert |
| Modify | `lib/server/kv-fetchers.ts:40-48` | Extend RecipeStats interface with outcome fields |
| Modify | `app/api/recipe-performance/route.ts` | Add signal_outcomes query, merge into response |
| Modify | `app/signals/performance/PerformanceClient.tsx` | Option A card layout, 7d/30d toggle, degraded state |
| Modify | `app/edge/EdgeClient.tsx` | Same card layout as PerformanceClient |

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/007_signal_outcomes.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/007_signal_outcomes.sql

CREATE TABLE IF NOT EXISTS signal_outcomes (
  id               UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  signal_id        UUID          NOT NULL REFERENCES signals_history(id) ON DELETE CASCADE,
  recipe_id        TEXT          NOT NULL,
  coin             TEXT          NOT NULL,
  direction        TEXT          CHECK (direction IN ('LONG','SHORT','FLAT') OR direction IS NULL),
  price_at_signal  NUMERIC(20,6) NOT NULL,
  price_1h         NUMERIC(20,6),
  price_4h         NUMERIC(20,6),
  price_24h        NUMERIC(20,6),
  outcome_1h       BOOLEAN,
  outcome_4h       BOOLEAN,
  outcome_24h      BOOLEAN,
  move_pct_1h      NUMERIC(8,4),
  move_pct_4h      NUMERIC(8,4),
  move_pct_24h     NUMERIC(8,4),
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  resolved_at      TIMESTAMPTZ
);

-- Partial index: fast lookup of unresolved rows by the resolution cron
CREATE INDEX IF NOT EXISTS idx_signal_outcomes_unresolved
  ON signal_outcomes (created_at)
  WHERE price_24h IS NULL;

-- Aggregate index: fast GROUP BY recipe_id queries in the API route
CREATE INDEX IF NOT EXISTS idx_signal_outcomes_recipe
  ON signal_outcomes (recipe_id, created_at DESC);

-- FK lookup index
CREATE INDEX IF NOT EXISTS idx_signal_outcomes_signal
  ON signal_outcomes (signal_id);

-- Retain signal_outcomes for 30 days (matches signals_history retention)
SELECT cron.schedule(
  'cleanup-old-signal-outcomes',
  '15 3 * * *',
  $$
    DELETE FROM signal_outcomes
    WHERE created_at < NOW() - INTERVAL '30 days';
  $$
);
```

- [ ] **Step 2: Apply the migration via Supabase dashboard or CLI**

```bash
# If using Supabase CLI:
supabase db push
# Or paste the SQL directly into the Supabase SQL editor for the project
```

Verify the table exists:
```bash
# In Supabase SQL editor:
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'signal_outcomes' ORDER BY ordinal_position;
```
Expected: 17 rows covering all columns.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/007_signal_outcomes.sql
git commit -m "feat(db): add signal_outcomes table for real outcome tracking"
```

---

## Task 2: Outcome Helper Functions + Tests

**Files:**
- Create: `lib/outcome-helpers.ts`
- Create: `lib/__tests__/outcome-helpers.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// lib/__tests__/outcome-helpers.test.ts
import { describe, it, expect } from "vitest";
import { computeOutcome, computeMovePct, buildOutcomeRows } from "../outcome-helpers";

describe("computeOutcome", () => {
  it("returns true for LONG when price rose", () => {
    expect(computeOutcome("LONG", 100, 101)).toBe(true);
  });
  it("returns false for LONG when price fell", () => {
    expect(computeOutcome("LONG", 100, 99)).toBe(false);
  });
  it("returns true for SHORT when price fell", () => {
    expect(computeOutcome("SHORT", 100, 99)).toBe(true);
  });
  it("returns false for SHORT when price rose", () => {
    expect(computeOutcome("SHORT", 100, 101)).toBe(false);
  });
  it("returns null for FLAT direction", () => {
    expect(computeOutcome("FLAT", 100, 110)).toBe(null);
  });
  it("returns null for null direction", () => {
    expect(computeOutcome(null, 100, 110)).toBe(null);
  });
  it("returns false for LONG when price unchanged", () => {
    expect(computeOutcome("LONG", 100, 100)).toBe(false);
  });
});

describe("computeMovePct", () => {
  it("returns positive % when price rose", () => {
    expect(computeMovePct(100, 102)).toBeCloseTo(2.0);
  });
  it("returns negative % when price fell", () => {
    expect(computeMovePct(100, 95)).toBeCloseTo(-5.0);
  });
  it("returns 0 when price unchanged", () => {
    expect(computeMovePct(100, 100)).toBe(0);
  });
  it("handles fractional prices", () => {
    expect(computeMovePct(0.5, 0.55)).toBeCloseTo(10.0);
  });
});

describe("buildOutcomeRows", () => {
  it("builds one row per inserted signal using the signal id and allMids price", () => {
    const inserted = [
      { id: "uuid-1", recipe_id: "momentum_stack", coin: "BTC", direction: "LONG" },
      { id: "uuid-2", recipe_id: "funding_trend",  coin: "ETH", direction: "SHORT" },
    ];
    const allMids: Record<string, string> = { BTC: "65000", ETH: "3200" };
    const rows = buildOutcomeRows(inserted, allMids);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      signal_id:       "uuid-1",
      recipe_id:       "momentum_stack",
      coin:            "BTC",
      direction:       "LONG",
      price_at_signal: 65000,
    });
    expect(rows[1].price_at_signal).toBe(3200);
  });

  it("skips rows where the coin is missing from allMids", () => {
    const inserted = [
      { id: "uuid-1", recipe_id: "r1", coin: "UNKNOWN", direction: "LONG" },
    ];
    const rows = buildOutcomeRows(inserted, {});
    expect(rows).toHaveLength(0);
  });

  it("includes rows with null direction", () => {
    const inserted = [
      { id: "uuid-1", recipe_id: "r1", coin: "BTC", direction: null },
    ];
    const rows = buildOutcomeRows(inserted, { BTC: "50000" });
    expect(rows).toHaveLength(1);
    expect(rows[0].direction).toBe(null);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test -- outcome-helpers
```
Expected: FAIL — `Cannot find module '../outcome-helpers'`

- [ ] **Step 3: Write the implementation**

```typescript
// lib/outcome-helpers.ts

export function computeOutcome(
  direction: string | null,
  priceAtSignal: number,
  priceNow: number
): boolean | null {
  if (direction === "LONG")  return priceNow > priceAtSignal;
  if (direction === "SHORT") return priceNow < priceAtSignal;
  return null; // FLAT or null — no directional call to grade
}

export function computeMovePct(priceAtSignal: number, priceNow: number): number {
  return ((priceNow - priceAtSignal) / priceAtSignal) * 100;
}

export interface InsertedSignal {
  id:        string;
  recipe_id: string;
  coin:      string;
  direction: string | null;
}

export interface SignalOutcomeRow {
  signal_id:       string;
  recipe_id:       string;
  coin:            string;
  direction:       string | null;
  price_at_signal: number;
}

export function buildOutcomeRows(
  inserted: InsertedSignal[],
  allMids: Record<string, string>
): SignalOutcomeRow[] {
  const rows: SignalOutcomeRow[] = [];
  for (const sig of inserted) {
    const priceStr = allMids[sig.coin];
    if (!priceStr) continue; // coin not in allMids (delisted or unknown)
    const price = parseFloat(priceStr);
    if (!isFinite(price) || price <= 0) continue;
    rows.push({
      signal_id:       sig.id,
      recipe_id:       sig.recipe_id,
      coin:            sig.coin,
      direction:       sig.direction,
      price_at_signal: price,
    });
  }
  return rows;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run test -- outcome-helpers
```
Expected: all 11 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/outcome-helpers.ts lib/__tests__/outcome-helpers.test.ts
git commit -m "feat(outcomes): outcome helper functions with full test coverage"
```

---

## Task 3: Signal Capture in signal-lab.ts

**Files:**
- Modify: `lib/signal-lab.ts:1127-1135`

The `signals_history` insert is at line 1129. Change it to use `.select()` so we get the inserted IDs back, then immediately insert corresponding `signal_outcomes` rows.

- [ ] **Step 1: Replace the signals_history insert block**

Find this block (lines ~1127-1135):

```typescript
  const rows = [...toInsert, ...cohortEvents];
  if (rows.length > 0) {
    const { error } = await supabase.from("signals_history").insert(rows);
    if (error) {
      console.error("[signal-lab] insert error:", error.message);
    } else {
      console.log(`[signal-lab] inserted ${rows.length} signal events`);
    }
  }
```

Replace with:

```typescript
  const rows = [...toInsert, ...cohortEvents];
  if (rows.length > 0) {
    const { data: inserted, error } = await supabase
      .from("signals_history")
      .insert(rows)
      .select("id, recipe_id, coin, direction");
    if (error) {
      console.error("[signal-lab] insert error:", error.message);
    } else {
      console.log(`[signal-lab] inserted ${inserted?.length ?? 0} signal events`);
      // Capture price at signal fire time for outcome tracking
      if (inserted && inserted.length > 0) {
        const outcomeRows = buildOutcomeRows(inserted, allMids);
        if (outcomeRows.length > 0) {
          supabase.from("signal_outcomes").insert(outcomeRows).then(({ error: oErr }) => {
            if (oErr) console.error("[signal-lab] signal_outcomes insert error:", oErr.message);
          });
        }
      }
    }
  }
```

- [ ] **Step 2: Add the import at the top of signal-lab.ts**

Add alongside existing imports:

```typescript
import { buildOutcomeRows } from "@/lib/outcome-helpers";
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npm run typecheck
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/signal-lab.ts
git commit -m "feat(outcomes): capture price_at_signal in signal_outcomes on every signal insert"
```

---

## Task 4: Resolution Cron — `/api/measure-outcomes`

**Files:**
- Create: `app/api/measure-outcomes/route.ts`

This endpoint is already registered in `vercel.json` (`0 * * * *` — hourly). Just implement the handler.

- [ ] **Step 1: Write the route**

```typescript
// app/api/measure-outcomes/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, HYPERLIQUID_API_URL } from "@/lib/env";
import { computeOutcome, computeMovePct } from "@/lib/outcome-helpers";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const CHUNK_SIZE = 100;
// 26h = 24h window + 2h buffer for hourly cron granularity
const HORIZON_MS = 26 * 60 * 60 * 1000;

export async function GET(): Promise<NextResponse> {
  const startMs = Date.now();

  // 1. Fetch pending rows: missing price_24h and within resolution horizon
  const horizon = new Date(Date.now() - HORIZON_MS).toISOString();
  const { data: pending, error: fetchErr } = await supabase
    .from("signal_outcomes")
    .select("id, coin, direction, price_at_signal, price_1h, price_4h, price_24h, created_at")
    .is("price_24h", null)
    .gte("created_at", horizon);

  if (fetchErr) {
    console.error("[measure-outcomes] fetch error:", fetchErr.message);
    return NextResponse.json({ ok: false, error: fetchErr.message }, { status: 500 });
  }
  if (!pending || pending.length === 0) {
    return NextResponse.json({ ok: true, resolved: 0, duration_ms: Date.now() - startMs });
  }

  // 2. Fetch current prices from Hyperliquid (one call, all coins)
  let allMids: Record<string, string> = {};
  try {
    const res = await fetch(HYPERLIQUID_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "allMids" }),
    });
    allMids = await res.json() as Record<string, string>;
  } catch (err) {
    console.error("[measure-outcomes] allMids fetch failed:", err);
    return NextResponse.json({ ok: false, error: "allMids fetch failed" }, { status: 502 });
  }

  const now = Date.now();

  // 3. Compute updates
  const updates: { id: string; patch: Record<string, unknown> }[] = [];
  for (const row of pending) {
    const firedAt  = new Date(row.created_at).getTime();
    const ageMs    = now - firedAt;
    const priceNow = parseFloat(allMids[row.coin] ?? "");
    const patch: Record<string, unknown> = {};

    // Skip if coin is delisted / missing from allMids
    if (!isFinite(priceNow) || priceNow <= 0) continue;

    if (ageMs >= 60 * 60 * 1000 && row.price_1h == null) {
      patch.price_1h    = priceNow;
      patch.move_pct_1h = parseFloat(computeMovePct(Number(row.price_at_signal), priceNow).toFixed(4));
      patch.outcome_1h  = computeOutcome(row.direction, Number(row.price_at_signal), priceNow);
    }
    if (ageMs >= 4 * 60 * 60 * 1000 && row.price_4h == null) {
      patch.price_4h    = priceNow;
      patch.move_pct_4h = parseFloat(computeMovePct(Number(row.price_at_signal), priceNow).toFixed(4));
      patch.outcome_4h  = computeOutcome(row.direction, Number(row.price_at_signal), priceNow);
    }
    if (ageMs >= 24 * 60 * 60 * 1000 && row.price_24h == null) {
      patch.price_24h    = priceNow;
      patch.move_pct_24h = parseFloat(computeMovePct(Number(row.price_at_signal), priceNow).toFixed(4));
      patch.outcome_24h  = computeOutcome(row.direction, Number(row.price_at_signal), priceNow);
      // resolved when price_24h is set (price columns gate resolved_at, not outcome booleans)
      patch.resolved_at  = new Date().toISOString();
    }

    if (Object.keys(patch).length > 0) {
      updates.push({ id: row.id, patch });
    }
  }

  // 4. Batch-update in chunks of CHUNK_SIZE
  let resolved = 0;
  for (let i = 0; i < updates.length; i += CHUNK_SIZE) {
    const chunk = updates.slice(i, i + CHUNK_SIZE);
    await Promise.all(
      chunk.map(({ id, patch }) =>
        supabase.from("signal_outcomes").update(patch).eq("id", id)
      )
    );
    resolved += chunk.length;
  }

  console.log(
    JSON.stringify({
      event: "measure_outcomes_complete",
      pending: pending.length,
      resolved,
      duration_ms: Date.now() - startMs,
    })
  );

  return NextResponse.json({ ok: true, resolved, duration_ms: Date.now() - startMs });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run typecheck
```
Expected: no errors.

- [ ] **Step 3: Smoke test locally**

```bash
npm run dev
# In a separate terminal:
curl http://localhost:3000/api/measure-outcomes
```
Expected: `{"ok":true,"resolved":0,"duration_ms":<n>}` (no pending rows yet since table is empty).

- [ ] **Step 4: Commit**

```bash
git add app/api/measure-outcomes/route.ts
git commit -m "feat(cron): implement /api/measure-outcomes hourly resolution cron"
```

---

## Task 5: Update RecipeStats Type + API Route

**Files:**
- Modify: `lib/server/kv-fetchers.ts:40-48`
- Modify: `app/api/recipe-performance/route.ts`

- [ ] **Step 1: Extend RecipeStats in kv-fetchers.ts**

Replace the existing `RecipeStats` interface (lines 40-48):

```typescript
// Before:
export interface RecipeStats {
  recipe_id: string;
  signal_count: number;
  true_positive: number;
  false_positive: number;
  avg_ev_score: number | null;
  win_rate: number | null;
  measured_at: string;
}
```

With:

```typescript
export interface RecipeStats {
  // Legacy EV-based fields — kept for fallback display
  recipe_id:     string;
  signal_count:  number;
  true_positive: number;
  false_positive:number;
  avg_ev_score:  number | null;
  win_rate:      number | null;
  measured_at:   string;

  // Outcome-based fields — null until signal_outcomes has data
  resolved_7d:      number;
  resolved_30d:     number;
  accuracy_1h_7d:   number | null;
  accuracy_4h_7d:   number | null;
  accuracy_24h_7d:  number | null;
  avg_move_1h_7d:   number | null;
  avg_move_4h_7d:   number | null;
  avg_move_24h_7d:  number | null;
  accuracy_1h_30d:  number | null;
  accuracy_4h_30d:  number | null;
  accuracy_24h_30d: number | null;
  avg_move_1h_30d:  number | null;
  avg_move_4h_30d:  number | null;
  avg_move_24h_30d: number | null;
  top_coins_7d:     string[];
  top_coins_30d:    string[];
}
```

- [ ] **Step 2: Update fetchRecipePerformance in kv-fetchers.ts to pass default outcome fields**

In `fetchRecipePerformance`, the `.map()` that constructs result rows needs to spread outcome defaults. Find the map call after `const latest = new Map<string, RecipeStats>()` and ensure each row gets default outcome fields:

```typescript
const OUTCOME_DEFAULTS: Omit<RecipeStats, "recipe_id"|"signal_count"|"true_positive"|"false_positive"|"avg_ev_score"|"win_rate"|"measured_at"> = {
  resolved_7d: 0, resolved_30d: 0,
  accuracy_1h_7d: null, accuracy_4h_7d: null, accuracy_24h_7d: null,
  avg_move_1h_7d: null, avg_move_4h_7d: null, avg_move_24h_7d: null,
  accuracy_1h_30d: null, accuracy_4h_30d: null, accuracy_24h_30d: null,
  avg_move_1h_30d: null, avg_move_4h_30d: null, avg_move_24h_30d: null,
  top_coins_7d: [], top_coins_30d: [],
};
```

Apply these defaults in the map that builds `RecipeStats` rows so the type is satisfied.

- [ ] **Step 3: Rewrite the recipe-performance route**

Replace the entire contents of `app/api/recipe-performance/route.ts`:

```typescript
// app/api/recipe-performance/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { kv } from "@vercel/kv";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "@/lib/env";
import type { RecipeStats } from "@/lib/server/kv-fetchers";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const OUTCOME_DEFAULTS = {
  resolved_7d: 0, resolved_30d: 0,
  accuracy_1h_7d: null, accuracy_4h_7d: null, accuracy_24h_7d: null,
  avg_move_1h_7d: null, avg_move_4h_7d: null, avg_move_24h_7d: null,
  accuracy_1h_30d: null, accuracy_4h_30d: null, accuracy_24h_30d: null,
  avg_move_1h_30d: null, avg_move_4h_30d: null, avg_move_24h_30d: null,
  top_coins_7d: [] as string[], top_coins_30d: [] as string[],
};

export async function GET(): Promise<NextResponse> {
  const [{ data: perfData, error: perfErr }, intradayRaw, { data: outcomeData }, { data: coinData }] =
    await Promise.all([
      supabase
        .from("recipe_performance")
        .select("recipe_id, signal_count, true_positive, false_positive, avg_ev_score, win_rate, measured_at")
        .order("measured_at", { ascending: false })
        .limit(100),
      kv.get<Record<string, { avg_ev: number; count: number }>>("recipe:intraday_perf"),
      // Outcome accuracy aggregation: 7d and 30d
      supabase.rpc("get_recipe_outcome_stats"),
      // Top coins per recipe: 7d and 30d
      supabase
        .from("signal_outcomes")
        .select("recipe_id, coin, created_at")
        .gte("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),
    ]);

  if (perfErr) return NextResponse.json({ error: perfErr.message }, { status: 500 });

  // Build outcome stats map from RPC result
  const outcomeMap = new Map<string, typeof OUTCOME_DEFAULTS>();
  for (const row of outcomeData ?? []) {
    outcomeMap.set(row.recipe_id, {
      resolved_7d:      row.resolved_7d      ?? 0,
      resolved_30d:     row.resolved_30d     ?? 0,
      accuracy_1h_7d:   row.accuracy_1h_7d   ?? null,
      accuracy_4h_7d:   row.accuracy_4h_7d   ?? null,
      accuracy_24h_7d:  row.accuracy_24h_7d  ?? null,
      avg_move_1h_7d:   row.avg_move_1h_7d   ?? null,
      avg_move_4h_7d:   row.avg_move_4h_7d   ?? null,
      avg_move_24h_7d:  row.avg_move_24h_7d  ?? null,
      accuracy_1h_30d:  row.accuracy_1h_30d  ?? null,
      accuracy_4h_30d:  row.accuracy_4h_30d  ?? null,
      accuracy_24h_30d: row.accuracy_24h_30d ?? null,
      avg_move_1h_30d:  row.avg_move_1h_30d  ?? null,
      avg_move_4h_30d:  row.avg_move_4h_30d  ?? null,
      avg_move_24h_30d: row.avg_move_24h_30d ?? null,
      top_coins_7d:  [],
      top_coins_30d: [],
    });
  }

  // Build top coins per recipe per window from the coin query
  const since7d = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const coinCount7d  = new Map<string, Map<string, number>>();
  const coinCount30d = new Map<string, Map<string, number>>();
  for (const row of coinData ?? []) {
    const is7d = new Date(row.created_at).getTime() >= since7d;
    const target = is7d ? coinCount7d : coinCount30d;
    if (!target.has(row.recipe_id)) target.set(row.recipe_id, new Map());
    const m = target.get(row.recipe_id)!;
    m.set(row.coin, (m.get(row.coin) ?? 0) + 1);
  }
  // Also accumulate 7d rows into 30d counts
  for (const row of coinData ?? []) {
    if (!coinCount30d.has(row.recipe_id)) coinCount30d.set(row.recipe_id, new Map());
    const m = coinCount30d.get(row.recipe_id)!;
    m.set(row.coin, (m.get(row.coin) ?? 0) + 1);
  }
  const topCoins = (m: Map<string, number>) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([coin]) => coin);

  for (const [recipeId, outcome] of outcomeMap) {
    outcome.top_coins_7d  = topCoins(coinCount7d.get(recipeId)  ?? new Map());
    outcome.top_coins_30d = topCoins(coinCount30d.get(recipeId) ?? new Map());
  }

  // Deduplicate perf rows: keep most recent per recipe_id
  const latest = new Map<string, RecipeStats>();
  for (const row of perfData ?? []) {
    if (!latest.has(row.recipe_id)) {
      latest.set(row.recipe_id, {
        ...row,
        ...(outcomeMap.get(row.recipe_id) ?? OUTCOME_DEFAULTS),
      } as RecipeStats);
    }
  }

  // Overlay intraday KV data and build final result
  const result: RecipeStats[] = [...latest.values()].map((row) => {
    const intraday = intradayRaw?.[row.recipe_id];
    if (!intraday) return row;
    return { ...row, signal_count: intraday.count, avg_ev_score: intraday.avg_ev };
  });

  // Add KV-only recipes not yet in the daily table
  if (intradayRaw) {
    for (const [recipe_id, { avg_ev, count }] of Object.entries(intradayRaw)) {
      if (!latest.has(recipe_id)) {
        result.push({
          recipe_id,
          signal_count:  count,
          avg_ev_score:  avg_ev,
          win_rate:      null,
          true_positive: 0,
          false_positive:0,
          measured_at:   new Date().toISOString(),
          ...(outcomeMap.get(recipe_id) ?? OUTCOME_DEFAULTS),
        });
      }
    }
  }

  return NextResponse.json(result, {
    headers: { "Cache-Control": "public, max-age=60" },
  });
}
```

- [ ] **Step 4: Create the Supabase RPC function**

The route calls `supabase.rpc("get_recipe_outcome_stats")`. Create this function in Supabase SQL editor:

```sql
CREATE OR REPLACE FUNCTION get_recipe_outcome_stats()
RETURNS TABLE (
  recipe_id        TEXT,
  resolved_7d      BIGINT,
  resolved_30d     BIGINT,
  accuracy_1h_7d   DOUBLE PRECISION,
  accuracy_4h_7d   DOUBLE PRECISION,
  accuracy_24h_7d  DOUBLE PRECISION,
  avg_move_1h_7d   DOUBLE PRECISION,
  avg_move_4h_7d   DOUBLE PRECISION,
  avg_move_24h_7d  DOUBLE PRECISION,
  accuracy_1h_30d  DOUBLE PRECISION,
  accuracy_4h_30d  DOUBLE PRECISION,
  accuracy_24h_30d DOUBLE PRECISION,
  avg_move_1h_30d  DOUBLE PRECISION,
  avg_move_4h_30d  DOUBLE PRECISION,
  avg_move_24h_30d DOUBLE PRECISION
) LANGUAGE sql STABLE AS $$
  SELECT
    recipe_id,
    COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days'
      AND outcome_4h IS NOT NULL)                         AS resolved_7d,
    COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days'
      AND outcome_4h IS NOT NULL)                         AS resolved_30d,
    AVG(outcome_1h::int)  FILTER (WHERE created_at >= NOW() - INTERVAL '7 days'
      AND outcome_1h IS NOT NULL)                         AS accuracy_1h_7d,
    AVG(outcome_4h::int)  FILTER (WHERE created_at >= NOW() - INTERVAL '7 days'
      AND outcome_4h IS NOT NULL)                         AS accuracy_4h_7d,
    AVG(outcome_24h::int) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days'
      AND outcome_24h IS NOT NULL)                        AS accuracy_24h_7d,
    AVG(move_pct_1h)  FILTER (WHERE created_at >= NOW() - INTERVAL '7 days'
      AND move_pct_1h IS NOT NULL)                        AS avg_move_1h_7d,
    AVG(move_pct_4h)  FILTER (WHERE created_at >= NOW() - INTERVAL '30 days'
      AND move_pct_4h IS NOT NULL)                        AS avg_move_4h_7d,
    AVG(move_pct_24h) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days'
      AND move_pct_24h IS NOT NULL)                       AS avg_move_24h_7d,
    AVG(outcome_1h::int)  FILTER (WHERE created_at >= NOW() - INTERVAL '30 days'
      AND outcome_1h IS NOT NULL)                         AS accuracy_1h_30d,
    AVG(outcome_4h::int)  FILTER (WHERE created_at >= NOW() - INTERVAL '30 days'
      AND outcome_4h IS NOT NULL)                         AS accuracy_4h_30d,
    AVG(outcome_24h::int) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days'
      AND outcome_24h IS NOT NULL)                        AS accuracy_24h_30d,
    AVG(move_pct_1h)  FILTER (WHERE created_at >= NOW() - INTERVAL '30 days'
      AND move_pct_1h IS NOT NULL)                        AS avg_move_1h_30d,
    AVG(move_pct_4h)  FILTER (WHERE created_at >= NOW() - INTERVAL '30 days'
      AND move_pct_4h IS NOT NULL)                        AS avg_move_4h_30d,
    AVG(move_pct_24h) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days'
      AND move_pct_24h IS NOT NULL)                       AS avg_move_24h_30d
  FROM signal_outcomes
  GROUP BY recipe_id;
$$;
```

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/server/kv-fetchers.ts app/api/recipe-performance/route.ts
git commit -m "feat(api): add outcome stats to recipe-performance response"
```

---

## Task 6: UI — PerformanceClient Option A Card Layout

**Files:**
- Modify: `app/signals/performance/PerformanceClient.tsx`
- Modify: `app/edge/EdgeClient.tsx`

Both files get the same card logic. Apply to `PerformanceClient` first, then replicate to `EdgeClient`.

- [ ] **Step 1: Rewrite PerformanceClient.tsx**

```typescript
"use client";
// app/signals/performance/PerformanceClient.tsx

import { useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { formatPct } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { RECIPE_META } from "@/lib/recipe-meta";
import {
  color, card as C, type as T, space, radius,
} from "@/lib/design-tokens";
import type { RecipeStats } from "@/lib/server/kv-fetchers";

// Interpolate white → color.green (#6aaa7a) based on accuracy 0→1
function accuracyColor(rate: number): string {
  const r = Math.round(255 + (106 - 255) * rate);
  const g = Math.round(255 + (170 - 255) * rate);
  const b = Math.round(255 + (122 - 255) * rate);
  return `rgb(${r},${g},${b})`;
}

function fmt(val: number | null | undefined, decimals = 1): string {
  if (val == null) return "—";
  return `${val >= 0 ? "+" : ""}${val.toFixed(decimals)}%`;
}

function fmtAcc(val: number | null | undefined): string {
  if (val == null) return "—";
  return `${(val * 100).toFixed(1)}%`;
}

type Window = "7d" | "30d";

const S = {
  page:       { padding: space.pagePaddingX },
  grid:       { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px", marginBottom: "24px" },
  heroRow:    { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1px", background: color.borderFaint, borderBottom: `1px solid ${color.borderFaint}` },
  heroCel:    { padding: "16px 20px", background: color.card, textAlign: "center" as const },
  heroVal:    { ...T.statValue, fontFamily: "'Geist Mono', monospace" },
  heroLbl:    { ...T.statLabel, marginTop: "6px" },
  table:      { width: "100%", borderCollapse: "collapse" as const },
  tdTf:       { ...T.statLabel, padding: "7px 20px", fontSize: "11px", letterSpacing: "0.08em" },
  tdAcc:      { padding: "7px 8px", fontSize: "11px", fontWeight: 700, fontVariantNumeric: "tabular-nums" as const, fontFamily: "'Geist Mono', monospace" },
  tdMv:       { padding: "7px 20px 7px 0", fontSize: "11px", fontWeight: 700, fontVariantNumeric: "tabular-nums" as const, fontFamily: "'Geist Mono', monospace", textAlign: "right" as const },
  tog:        { display: "flex", gap: "2px", background: color.neutralBg, border: `1px solid ${color.neutralBorder}`, borderRadius: radius.tag, padding: "2px" },
  togBtn:     { background: "none", border: "none", cursor: "pointer" as const, fontSize: "11px", fontWeight: 600, fontFamily: "'DM Sans', system-ui, sans-serif", padding: "2px 8px", borderRadius: radius.dirPill, color: color.textMuted } as const,
  togBtnOn:   { background: color.tagBg, color: color.text },
  coin:       { fontSize: "11px", fontWeight: 700, padding: "2px 7px", borderRadius: radius.dirPill, background: color.tagBg, border: `1px solid ${color.border}`, color: color.tagText },
  fallback:   { ...T.statValue, marginTop: "16px" },
  fallbackNote: { fontSize: "13px", color: color.textMuted, marginTop: "6px", lineHeight: 1.4 },
  lowSample:  { fontSize: "11px", color: color.textMuted, fontWeight: 600, marginLeft: "4px" },
};

export function PerformanceClient({ initialData }: { initialData: RecipeStats[] | null }) {
  const [win, setWin] = useState<Window>("7d");

  const { data: stats } = useQuery<RecipeStats[]>({
    queryKey:        ["recipe-performance"],
    queryFn:         () => fetch("/api/recipe-performance").then((r) => r.json()),
    initialData:     initialData ?? undefined,
    placeholderData: keepPreviousData,
    staleTime:       60_000,
    refetchInterval: 60_000,
  });

  const allRecipes = Object.keys(RECIPE_META).map((id) => {
    const perf = stats?.find((s) => s.recipe_id === id);
    return { id, ...RECIPE_META[id], perf };
  });

  return (
    <div className="page-enter">
      <PageHeader
        title="Performance"
        subtitle="Directional accuracy by recipe — % of signals where price moved the predicted direction. Not realized profit."
      />
      <div style={{ ...S.page, paddingTop: "20px" }}>
        <div style={S.grid}>
          {allRecipes.map(({ id, label, desc, perf }) => {
            const resolved  = win === "7d" ? (perf?.resolved_7d ?? 0) : (perf?.resolved_30d ?? 0);
            const acc4h     = win === "7d" ? perf?.accuracy_4h_7d   : perf?.accuracy_4h_30d;
            const move4h    = win === "7d" ? perf?.avg_move_4h_7d   : perf?.avg_move_4h_30d;
            const acc1h     = win === "7d" ? perf?.accuracy_1h_7d   : perf?.accuracy_1h_30d;
            const move1h    = win === "7d" ? perf?.avg_move_1h_7d   : perf?.avg_move_1h_30d;
            const acc24h    = win === "7d" ? perf?.accuracy_24h_7d  : perf?.accuracy_24h_30d;
            const move24h   = win === "7d" ? perf?.avg_move_24h_7d  : perf?.avg_move_24h_30d;
            const coins     = win === "7d" ? (perf?.top_coins_7d ?? []) : (perf?.top_coins_30d ?? []);
            const signals   = perf?.signal_count ?? 0;
            const isNew     = resolved === 0;
            const isLow     = resolved > 0 && resolved < 10;

            return (
              <div key={id} className="card-hover glow-btn" style={C.base}>
                {/* Header */}
                <div style={{ ...C.header, justifyContent: "space-between" }}>
                  <span style={T.cardTitle}>{label}</span>
                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <div style={S.tog}>
                      <button
                        style={{ ...S.togBtn, ...(win === "7d" ? S.togBtnOn : {}) }}
                        onClick={() => setWin("7d")}
                      >7d</button>
                      <button
                        style={{ ...S.togBtn, ...(win === "30d" ? S.togBtnOn : {}) }}
                        onClick={() => setWin("30d")}
                      >30d</button>
                    </div>
                    {signals > 0 && (
                      <span style={{ fontSize: "11px", fontWeight: 700, padding: "2px 8px", borderRadius: radius.dirPill, background: color.tagBg, border: `1px solid ${color.borderFaint}`, color: color.textMuted, fontVariantNumeric: "tabular-nums" }}>
                        {signals}
                      </span>
                    )}
                  </div>
                </div>

                {/* No outcome data yet — fallback to EV metric */}
                {isNew ? (
                  <div style={{ padding: "16px 20px 18px" }}>
                    <div style={{ ...S.fallback, color: perf?.win_rate != null ? accuracyColor(perf.win_rate) : color.textFaint }}>
                      {perf?.win_rate != null ? formatPct(perf.win_rate) : "n/a"}
                    </div>
                    <div style={T.statLabel}>Signal Quality</div>
                    <div style={S.fallbackNote}>
                      Outcome tracking is live. Accuracy data accumulates over 7 days.
                    </div>
                    <div style={{ ...T.statSub, marginTop: "12px" }}>{desc}</div>
                  </div>
                ) : (
                  <>
                    {/* Hero row */}
                    <div style={S.heroRow}>
                      <div style={S.heroCel}>
                        <div style={{ ...S.heroVal, color: acc4h != null ? accuracyColor(acc4h) : color.textFaint }}>
                          {fmtAcc(acc4h)}
                          {isLow && <span style={S.lowSample}> ~</span>}
                        </div>
                        <div style={S.heroLbl}>Accuracy · 4h</div>
                      </div>
                      <div style={S.heroCel}>
                        <div style={{ ...S.heroVal, color: move4h == null ? color.textFaint : move4h >= 0 ? color.green : color.red }}>
                          {fmt(move4h != null ? move4h : null)}
                        </div>
                        <div style={S.heroLbl}>Avg Move · 4h</div>
                      </div>
                    </div>

                    {/* Breakdown table */}
                    <table style={S.table}>
                      <tbody>
                        {([
                          ["1h",  acc1h,  move1h],
                          ["4h",  acc4h,  move4h],
                          ["24h", acc24h, move24h],
                        ] as [string, number | null | undefined, number | null | undefined][]).map(([tf, acc, mv]) => (
                          <tr key={tf} style={{ borderBottom: `1px solid ${color.divider}` }}>
                            <td style={S.tdTf}>{tf}</td>
                            <td style={{ ...S.tdAcc, color: acc != null ? accuracyColor(acc) : color.textFaint }}>
                              {fmtAcc(acc)}
                            </td>
                            <td style={{ ...S.tdMv, color: mv == null ? color.textFaint : mv >= 0 ? color.green : color.red }}>
                              {fmt(mv)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {/* Coin tags */}
                    {coins.length > 0 && (
                      <div style={{ display: "flex", gap: "4px", padding: "10px 20px 0", flexWrap: "wrap" }}>
                        {coins.map((c) => <span key={c} style={S.coin}>{c}</span>)}
                      </div>
                    )}

                    {/* Description */}
                    <div style={{ ...T.statSub, padding: "8px 20px 14px", lineHeight: 1.45 }}>{desc}</div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Apply the same card logic to EdgeClient.tsx**

`app/edge/EdgeClient.tsx` is an identical layout. Copy the complete component from Step 1, changing only the component name from `PerformanceClient` to `EdgeClient` and the export name. The file is `app/edge/EdgeClient.tsx`.

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```
Expected: no errors.

- [ ] **Step 4: Run tests**

```bash
npm run test
```
Expected: all passing.

- [ ] **Step 5: Start dev server and verify visually**

```bash
npm run dev
```

Open `http://localhost:3000/signals/performance`. With an empty `signal_outcomes` table, every card should show the Signal Quality fallback with the "Outcome tracking is live" note. No errors in console.

- [ ] **Step 6: Commit**

```bash
git add app/signals/performance/PerformanceClient.tsx app/edge/EdgeClient.tsx
git commit -m "feat(ui): Performance page Option A card layout with outcome tracking states"
```

---

## Task 7: Push and Verify Deploy

- [ ] **Step 1: Push all commits**

```bash
git push origin main
```

- [ ] **Step 2: Verify Vercel deploy completes without build errors**

Check the Vercel dashboard or run:
```bash
vercel logs --follow
```

- [ ] **Step 3: Verify /signals/performance renders on production**

Open `https://hyperliquidflow.vercel.app/signals/performance`. Cards should render in the fallback "Signal Quality" state. No runtime errors.

- [ ] **Step 4: Verify /api/measure-outcomes returns 200**

```bash
curl https://hyperliquidflow.vercel.app/api/measure-outcomes
```
Expected: `{"ok":true,"resolved":0,"duration_ms":<n>}` — no pending rows yet.

- [ ] **Step 5: Verify next hourly cron fires correctly**

After the next hour mark (`0 * * * *`), check Vercel cron logs to confirm `measure-outcomes` ran without error. Within 24 hours of first signals firing, `signal_outcomes` rows will appear and cards will transition from fallback to outcome display.
