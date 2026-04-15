# Performance Page: Real Outcome Tracking

**Date:** 2026-04-16  
**Status:** Approved  
**Sprint:** Post-Sprint 3 (standalone feature)

---

## Problem

The Performance page currently shows "Signal Quality" — the percentage of signals where `ev_score > 0`. This is not recipe quality. It measures whether high-quality wallets happen to trigger a recipe, not whether the recipe predicts profitable price moves. A recipe firing exclusively from elite wallets scores 100% regardless of whether the price moved at all.

No outcome tracking exists. When a signal fires, the price is never recorded. There is no loop closure. The page gives false analytical confidence with a confident-looking percentage that means something different from what a trader would assume.

---

## Goal

Show real directional accuracy per recipe: of the signals this recipe fired, what percentage resulted in the coin moving in the predicted direction within 1h, 4h, and 24h? Show this alongside the average magnitude of that move. Aggregate over 7-day and 30-day rolling windows. Degrade gracefully until enough data accumulates.

---

## Decisions Made

| Question | Decision | Reason |
|---|---|---|
| Outcome timeframes | 1h, 4h, 24h all shown | Different traders use different horizons |
| Aggregation windows | 7d and 30d, toggle | 7d reacts to regime; 30d is statistically meaningful |
| Per-coin breakdown | Bundled for now | Sample sizes too small per coin; unlock later |
| Card layout | Option A: hero + breakdown table | All data visible without tabs |
| Hero metric | 4h accuracy + 4h avg move | 4h is the most actionable horizon |
| New cron | Use existing `/api/measure-outcomes` | Free tier is at 2-cron limit; slot already registered |
| `recipe_performance` changes | None | Query `signal_outcomes` directly in the API |
| EV-based Signal Quality | Keep as fallback | Shown until 7d of outcome data accumulates |

---

## Architecture

### New Table: `signal_outcomes`

One row per signal, written at fire time, resolved by the hourly cron.

```sql
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
  outcome_1h       BOOLEAN,      -- NULL for FLAT/NULL direction; not a false negative
  outcome_4h       BOOLEAN,
  outcome_24h      BOOLEAN,
  move_pct_1h      NUMERIC(8,4), -- signed; positive = up regardless of direction
  move_pct_4h      NUMERIC(8,4),
  move_pct_24h     NUMERIC(8,4),
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  resolved_at      TIMESTAMPTZ   -- set when all 3 windows are populated
);

CREATE INDEX ON signal_outcomes (created_at) WHERE price_24h IS NULL;
CREATE INDEX ON signal_outcomes (recipe_id, created_at DESC);
CREATE INDEX ON signal_outcomes (signal_id);
```

**Retention:** match `signals_history` — delete rows older than 30 days via a pg_cron job added to the migration.

**Direction rules:**
- `LONG`: `outcome_Xh = price_Xh > price_at_signal`
- `SHORT`: `outcome_Xh = price_Xh < price_at_signal`
- `FLAT` / `NULL`: `outcome_Xh = NULL` — prices and move_pct are still written; the boolean is omitted because there was no directional call to grade

---

### Signal Capture (in `refresh-cohort` / background refresh)

Wherever new signals are written to `signals_history`, immediately insert a corresponding row into `signal_outcomes` with `price_at_signal` pulled from the `allMids` data already in memory. All outcome columns are NULL at this point.

Order of operations:
1. Insert `signals_history` rows
2. Insert `signal_outcomes` rows (FK requires signals_history to exist first)

`allMids` is fetched in the same execution context where signals are generated. Confirm this in the implementation phase — if signals are written inside `after()`, `allMids` must be passed in, not re-fetched.

---

### Resolution Cron: `/api/measure-outcomes`

Already registered in `vercel.json`. Schedule: `0 * * * *` (hourly). Implement the handler.

**Algorithm:**

```
1. Query signal_outcomes WHERE price_24h IS NULL
                          AND created_at >= NOW() - INTERVAL '26 hours'
   (26h = 24h window + 2h buffer for hourly cron granularity)

2. Fetch allMids once — returns all current prices in one API call

3. For each row, resolve whichever windows have elapsed:
   - price_1h  if (NOW() - created_at) >= 1h  AND price_1h IS NULL
   - price_4h  if (NOW() - created_at) >= 4h  AND price_4h IS NULL
   - price_24h if (NOW() - created_at) >= 24h AND price_24h IS NULL

4. Compute for each resolved window:
   move_pct = (price_window - price_at_signal) / price_at_signal * 100
   outcome  = if direction LONG:  price_window > price_at_signal
              if direction SHORT: price_window < price_at_signal
              if direction FLAT/NULL: NULL

5. If coin is missing from allMids (delisted): skip that window, leave NULL

6. If price_1h, price_4h, and price_24h are all non-null: set resolved_at = NOW()
   (resolved_at is gated on price columns, not outcome booleans — FLAT/NULL direction
   signals have NULL outcome booleans by design but are still considered fully resolved
   once all three prices are recorded)

7. Batch-update signal_outcomes (process in chunks of 100 to avoid timeouts)
```

**Budget:** One `allMids` call + one batched Supabase update. No ≤10s constraint (separate from refresh-cohort). Expected runtime under 2s at current signal volumes.

---

### API Route: `/api/recipe-performance`

Runs two queries and merges results. Existing query is untouched.

**New query on `signal_outcomes`:**

```sql
SELECT
  recipe_id,
  COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days'
    AND outcome_4h IS NOT NULL)                        AS resolved_7d,
  COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days'
    AND outcome_4h IS NOT NULL)                        AS resolved_30d,

  AVG(outcome_1h::int)  FILTER (WHERE created_at >= NOW() - INTERVAL '7 days'
    AND outcome_1h IS NOT NULL)                        AS accuracy_1h_7d,
  AVG(outcome_4h::int)  FILTER (WHERE created_at >= NOW() - INTERVAL '7 days'
    AND outcome_4h IS NOT NULL)                        AS accuracy_4h_7d,
  AVG(outcome_24h::int) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days'
    AND outcome_24h IS NOT NULL)                       AS accuracy_24h_7d,

  AVG(move_pct_1h)  FILTER (WHERE created_at >= NOW() - INTERVAL '7 days'
    AND move_pct_1h IS NOT NULL)                       AS avg_move_1h_7d,
  AVG(move_pct_4h)  FILTER (WHERE created_at >= NOW() - INTERVAL '7 days'
    AND move_pct_4h IS NOT NULL)                       AS avg_move_4h_7d,
  AVG(move_pct_24h) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days'
    AND move_pct_24h IS NOT NULL)                      AS avg_move_24h_7d,

  -- 30d versions of all the above
  AVG(outcome_1h::int)  FILTER (WHERE created_at >= NOW() - INTERVAL '30 days'
    AND outcome_1h IS NOT NULL)                        AS accuracy_1h_30d,
  AVG(outcome_4h::int)  FILTER (WHERE created_at >= NOW() - INTERVAL '30 days'
    AND outcome_4h IS NOT NULL)                        AS accuracy_4h_30d,
  AVG(outcome_24h::int) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days'
    AND outcome_24h IS NOT NULL)                       AS accuracy_24h_30d,

  AVG(move_pct_1h)  FILTER (WHERE created_at >= NOW() - INTERVAL '30 days'
    AND move_pct_1h IS NOT NULL)                       AS avg_move_1h_30d,
  AVG(move_pct_4h)  FILTER (WHERE created_at >= NOW() - INTERVAL '30 days'
    AND move_pct_4h IS NOT NULL)                       AS avg_move_4h_30d,
  AVG(move_pct_24h) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days'
    AND move_pct_24h IS NOT NULL)                      AS avg_move_24h_30d

FROM signal_outcomes
GROUP BY recipe_id
```

**Merge logic:** join on `recipe_id`. All outcome fields are `number | null` — null if no resolved signals in that window yet.

**Updated `RecipeStats` type:**

```ts
export interface RecipeStats {
  recipe_id:       string
  signal_count:    number
  avg_ev_score:    number | null
  win_rate:        number | null   // legacy EV-based; kept for fallback display

  resolved_7d:     number
  resolved_30d:    number

  accuracy_1h_7d:  number | null
  accuracy_4h_7d:  number | null
  accuracy_24h_7d: number | null
  avg_move_1h_7d:  number | null
  avg_move_4h_7d:  number | null
  avg_move_24h_7d: number | null

  accuracy_1h_30d:  number | null
  accuracy_4h_30d:  number | null
  accuracy_24h_30d: number | null
  avg_move_1h_30d:  number | null
  avg_move_4h_30d:  number | null
  avg_move_24h_30d: number | null
}
```

---

### UI: `PerformanceClient`

**Card layout (Option A — approved):**

```
┌─────────────────────────────────────────────┐
│ WHALE CONVERGENCE          [7d][30d]    [47] │  ← card header
├───────────────────┬─────────────────────────┤
│      71%          │        +2.4%            │  ← hero row (32px, Geist Mono)
│  Accuracy · 4h    │     Avg Move · 4h       │  ← labels (11px uppercase)
├─────┬─────────────┬─────────────────────────┤
│ 1h  │    58%      │        +0.8%            │  ← breakdown table (11px mono)
│ 4h  │    71%      │        +2.4%            │
│ 24h │    68%      │        +4.1%            │
├─────────────────────────────────────────────┤
│ BTC  ETH  SOL                               │  ← coin tags (tagBg/tagText)
│ 8+ wallets add $500K+ same direction in     │  ← desc (13px, textMuted)
│ under 5 min                                 │
└─────────────────────────────────────────────┘
```

**States:**

- `resolved_7d === 0`: show existing Signal Quality % with muted note "Outcome tracking is live. Data accumulates over 7 days." No red, no misleading numbers.
- `resolved_7d > 0 && resolved_7d < 10`: show outcome data with a muted "Low sample" indicator next to the accuracy number.
- `resolved_7d >= 10`: full display, no caveats.
- `accuracy_Xh` null for a specific timeframe row: show `—` in that cell.
- `avg_move_Xh` positive: `color.green`. Negative: `color.red`. Zero/null: `color.textMuted`.

**Accuracy color:** white-to-green gradient using `winRateColor()` already in the file. Accuracy of 0% = white, 100% = `color.green`. No red — accuracy is not a loss metric.

**7d/30d toggle:** local `useState`, no API refetch. Both datasets in the single response.

**Top coins:** derive from `signal_outcomes` — top 3 coins by signal count for that recipe in the selected window. Add `top_coins_7d` and `top_coins_30d` string arrays to `RecipeStats`. The API route computes this with a second query:

```sql
SELECT recipe_id, coin, COUNT(*) AS n
FROM signal_outcomes
WHERE created_at >= NOW() - INTERVAL '7 days'  -- repeat for 30d
GROUP BY recipe_id, coin
ORDER BY recipe_id, n DESC
```

In the route handler, group rows by `recipe_id` and take the top 3 `coin` values per recipe for each window.

---

## What Is Not Changing

- `recipe_performance` table: no new columns, no schema change
- EV score calculation: unchanged, kept for fallback
- Signal generation logic: no recipe changes
- `signals_history` schema: no changes
- Existing API response fields: all kept, new fields are additive

---

## Rollout Sequence

1. **Migration** — add `signal_outcomes` table + retention cron
2. **Signal capture** — insert into `signal_outcomes` at fire time in refresh-cohort
3. **Resolution cron** — implement `/api/measure-outcomes` handler
4. **API route** — add outcome query, merge into response, update `RecipeStats` type
5. **UI** — update `PerformanceClient` with new card layout and states

Each step is independently deployable. Steps 1-3 are invisible to users. Step 4 adds nullable fields. Step 5 uses them.
