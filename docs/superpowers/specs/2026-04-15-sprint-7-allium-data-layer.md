# Sprint 7 — Allium Data Layer

**Date:** 2026-04-15  
**Status:** Ready to plan  
**Depends on:** None (pure backend, no UI)  
**Blocks:** Sprint 8 (Wallet Detail Page), Sprint 9 (Leaderboard Upgrade)

---

## Goal

Replace the 30-day native-API fill backtest with a 90-day Allium-powered backtest. Add liquidation detection, regime-split sub-period scoring, and a divergence flag (recent 30d vs full 90d performance). The scoring engine becomes significantly more accurate — longer history, liquidation-aware, and regime-consistent.

---

## Background: Why Allium

The native Hyperliquid API returns fills for the last 30 days only, with no liquidation metadata and no pre/post position snapshots. Allium indexes from genesis (2023) with enriched fields: `liquidation` object per fill, `twapId`, `builderFee`. Their Developer API mirrors the native API shape, so integration is low-friction. Their Explorer SQL API enables batch historical backfills via async SQL queries.

**Free tier:** 100 Explorer Units (SQL batch) + 20,000 Developer API Units. Sufficient for prototyping and top-100 wallet daily updates. Full 1,200-wallet daily coverage requires a paid plan — contact sales before enabling full scale.

---

## New Scoring Concepts

### 1. 90-day flat window (no decay)

Used for: drawdown score, Sharpe proxy, regime-split consistency. Longer window = more stable signal, less noise from a single bad week.

### 2. Liquidation-aware scoring

If `liquidation_rate > 0.15` (more than 15% of closing trades were forced liquidations), apply a 0.75 penalty multiplier to `overall_score`. A wallet that blows up regularly is not smart money regardless of PnL.

### 3. Regime-split sub-period analysis

Split the 90-day fill history by detected regime per day (BULL/BEAR/RANGING based on daily BTC return). Compute separate win_rate and Sharpe proxy for each regime. Stored as JSONB. Surfaces wallets with consistent edge across all regimes vs wallets that are just riding bull markets.

### 4. Divergence flag

`divergence_score` = abs(score_30d - score_90d). If > 0.15, the wallet's recent performance diverges significantly from their longer-term baseline. Could mean they've found a new edge (positive) or are deteriorating (negative). Surfaced as a flag on the wallet page — not a scoring penalty.

Note: divergence is score-based, not Sharpe-based. Both `score_30d` and `score_90d` must be computed before this can be derived.

---

## Data Model

### New columns on `user_pnl_backtest`

```sql
ALTER TABLE user_pnl_backtest
  ADD COLUMN IF NOT EXISTS daily_pnls_90d      FLOAT[]  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS score_30d           FLOAT    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS score_90d           FLOAT    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS liquidation_rate    FLOAT    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS regime_performance  JSONB    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS divergence_score    FLOAT    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS backtest_source     TEXT     DEFAULT 'native'
    CHECK (backtest_source IN ('native', 'allium'));
```

`score_30d` — `overall_score` computed using only `daily_pnls` (30-element window). Always set when Allium data is present so the 30d vs 90d comparison is available.

`score_90d` — `overall_score` computed using `daily_pnls_90d` (90-element window) with the liquidation penalty applied. This becomes the primary `overall_score` in the leaderboard for Allium-enriched wallets.

`regime_performance` shape:
```json
{
  "BULL":     { "win_rate": 0.71, "sharpe_proxy": 0.82, "trade_count": 34 },
  "BEAR":     { "win_rate": 0.55, "sharpe_proxy": 0.41, "trade_count": 18 },
  "RANGING":  { "win_rate": 0.63, "sharpe_proxy": 0.59, "trade_count": 22 }
}
```

`daily_pnls_90d` is a 90-element float array ordered oldest-to-newest, same structure as the existing `daily_pnls` (30-element).

---

## New Environment Variable

```
ALLIUM_API_KEY=          # Required for Developer API and Explorer SQL API
```

Add to `lib/env.ts` using the existing `requiredEnv()` pattern. Add to `.env.local` docs in CLAUDE.md.

---

## Files

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `lib/allium-api-client.ts` | Typed API client: auth, Explorer SQL async pattern, Developer API fills |
| Create | `lib/__tests__/allium-api-client.test.ts` | Unit tests for fill processing helpers |
| Create | `supabase/migrations/006_allium_backtest.sql` | Add new columns to user_pnl_backtest |
| Modify | `lib/cohort-engine.ts` | Extend `computeCohortScores` to accept 90d data and liquidation_rate |
| Modify | `lib/env.ts` | Add `ALLIUM_API_KEY` |
| Modify | `scripts/daily-wallet-scan.ts` | Phase 7: 90-day Allium backfill + new scoring fields |
| Create | `scripts/allium-backfill.ts` | One-time: backfill 90-day data for all existing wallets via Explorer SQL |

---

## `lib/allium-api-client.ts`

**Before writing this file, read:**
- `lib/hypurrscan-api-client.ts` (follow the same structural pattern: error class, typed responses, weight/retry logic)
- `lib/env.ts` (use the existing env access pattern)
- Allium Developer API fills docs: `https://docs.allium.so/api/developer/hyperliquid/fills`
- Allium Explorer API docs: `https://docs.allium.so/api/explorer/overview`

**Do not invent API endpoint paths.** Read the Allium docs before writing any URL strings.

Key exports:

```typescript
// Auth header for all Allium requests
// X-API-KEY: <ALLIUM_API_KEY>

export class AlliumApiError extends Error {
  constructor(public status: number, public body: string, public endpoint: string) { ... }
}

// Fill shape returned by Allium Developer API — mirrors native Hyperliquid fill shape
// but adds: liquidation?: { liquidatedUser: string; markPx: string; method: string }
// and: twapId?: number, builderFee?: string
export type AlliumFill = { ... } // derive exact shape from Allium docs

// Explorer SQL async pattern:
export async function submitExplorerQuery(sql: string): Promise<string>  // returns queryId
export async function pollQueryResult<T>(queryId: string): Promise<T[]>  // polls until done, throws AlliumApiError on failure

// Developer API (realtime, mirrors native Hyperliquid fills endpoint):
export async function fetchWalletFills90d(address: string): Promise<AlliumFill[]>

// Pure helpers (easily unit-tested):
export function isLiquidationFill(fill: AlliumFill): boolean
export function buildDailyPnlSeries(fills: AlliumFill[], windowDays: number): number[]
export function computeLiquidationRate(fills: AlliumFill[]): number
export function computeRegimePerformance(
  fills: AlliumFill[],
  dailyRegimes: Map<string, 'BULL' | 'BEAR' | 'RANGING'>  // date string (YYYY-MM-DD) → regime
): RegimePerformance
```

**String encoding note:** The native Hyperliquid API returns financial fields (`closedPnl`, `px`, `sz`) as string-encoded numbers. Verify whether Allium's Developer API does the same before using `parseFloat()` — do not assume. Check the actual API response shape against the Allium docs before finalising `AlliumFill`.

**`pollQueryResult` must implement a timeout:** Max 300 poll attempts at 1-second intervals (5 minutes total). Throw `AlliumApiError` if the query has not completed by then.

---

## `lib/cohort-engine.ts` — scoring changes

**Before modifying, read the full file.** Do not change any existing function signatures — add an optional extended parameter.

Current signature:
```typescript
export function computeCohortScores(
  dailyPnls: number[],
  state: HlClearinghouseState,
  regime: 'BULL' | 'BEAR' | 'RANGING'
): CohortScores
```

New signature (backwards-compatible — new params are optional):
```typescript
export function computeCohortScores(
  dailyPnls: number[],
  state: HlClearinghouseState,
  regime: 'BULL' | 'BEAR' | 'RANGING',
  extended?: {
    dailyPnls90d?: number[]       // if present, use for sharpe_proxy and drawdown_score
    liquidationRate?: number      // if > 0.15, apply 0.75 penalty multiplier to overall_score
  }
): CohortScores
```

`CohortScores` gains two new output fields:
- `divergence_score: number | null` — abs(score_30d - score_90d), null if no 90d data
- `liquidation_penalty_applied: boolean`

---

## `scripts/daily-wallet-scan.ts` — Phase 7

**Before modifying, read the full file.** Phase 7 runs after Phase 6 (identity enrichment).

For the top 100 wallets by `overall_score` (not all 1,200 — stays within free tier):

1. **Identify top 100:** Use the `walletScores` map built in Phase 3 of the same scan run to sort by `overall_score` and take the top 100. Do not make an extra DB query.
2. **Fetch BTC 90-day candles once** (shared across all wallets): call `fetchCandleSnapshot('BTC', '1d', Date.now() - 90 * 86400 * 1000, Date.now())` from `lib/hyperliquid-api-client.ts`. Build a `dailyRegimes: Map<string, 'BULL' | 'BEAR' | 'RANGING'>` keyed by `YYYY-MM-DD` date string using the same `detectRegime` thresholds from `lib/cohort-engine.ts` (read that file to confirm threshold values — do not hardcode them here).
3. **Per wallet:** Call `fetchWalletFills90d(address)` via Allium Developer API. Add 100ms delay between requests.
4. **Compute:** `daily_pnls_90d`, `liquidation_rate`, `regime_performance` (using `dailyRegimes`), `score_30d` (run `computeCohortScores` with existing `daily_pnls` only), `score_90d` (run `computeCohortScores` with `dailyPnls90d` + `liquidationRate`), `divergence_score` = abs(score_30d - score_90d).
5. **Upsert** all fields into `user_pnl_backtest` with `backtest_source = 'allium'`.

**Scoring clarification:** When Allium data is present, `score_90d` becomes the wallet's primary quality score. `score_30d` is stored separately as a comparison signal. For wallets without Allium data, `score_30d` and `score_90d` remain null — `overall_score` from `cohort_snapshots` is still the 30-day native score and is unaffected.

For wallets with no Allium data: leave existing `backtest_source = 'native'` unchanged.

---

## `scripts/allium-backfill.ts`

One-time script. Uses Explorer SQL API to batch-fetch 90-day fills for all tracked wallets in a single query (more efficient than 1,200 individual Developer API calls). Pattern:

```sql
SELECT user, coin, px, sz, closedPnl, time, liquidation, twapId
FROM hyperliquid.raw.fills
WHERE user IN (<wallet_addresses>)
  AND time >= CURRENT_TIMESTAMP - INTERVAL '90 days'
  AND closedPnl != '0'
ORDER BY user, time
```

**Batching required:** If wallet count exceeds 500, split into batches of 500 addresses per query and merge results before processing. A single IN clause with 1,200 addresses produces a ~60KB SQL string that may hit query size limits.

Submit query → poll for completion (max 5 minutes per `pollQueryResult`) → process results → upsert all wallets in batch.

**Note on Explorer Units:** This query will consume multiple Explorer Units from the 100-unit free tier. Run once to establish baseline, then rely on the daily Developer API updates.

---

## Acceptance Criteria

- [ ] `lib/allium-api-client.ts` created, typecheck passes
- [ ] `isLiquidationFill`, `buildDailyPnlSeries`, `computeLiquidationRate`, `computeRegimePerformance` unit-tested (all pure functions, no API calls needed)
- [ ] `supabase/migrations/006_allium_backtest.sql` applied, new columns exist
- [ ] `computeCohortScores` accepts optional `extended` param without breaking existing callers
- [ ] Liquidation penalty (0.75 multiplier) applies when `liquidationRate > 0.15`
- [ ] `divergence_score` output is correct: abs(sharpe_30d - sharpe_90d)
- [ ] Phase 7 in daily scan runs for top 100 wallets, upserts new columns
- [ ] `scripts/allium-backfill.ts` runs end-to-end against real Allium API (requires `ALLIUM_API_KEY` in env)
- [ ] `backtest_source` correctly set to `'allium'` for updated wallets
- [ ] No existing tests broken, full suite passes
- [ ] `ALLIUM_API_KEY` added to `lib/env.ts` and documented in CLAUDE.md
