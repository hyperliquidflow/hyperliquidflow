# Stream D — Implementation Plan

**Spec:** [docs/superpowers/specs/2026-04-18-stream-d-behavior-profile.md](../specs/2026-04-18-stream-d-behavior-profile.md)
**Date:** 2026-04-18

---

## Key design decisions

**Separate table, not columns on `wallets`:** `wallet_profiles` with `wallet_id` as PK + FK. Keeps identity table clean; profiles are derived, not identity.

**BTC candle alignment:** `windowStart = Date.now() - SCORING_WINDOW_DAYS * 86400 * 1000` — the same origin used by `buildDailyPnls`. This guarantees that `daily_pnls[i]` and `btcCandles[i]` refer to the same calendar day. One 60-candle API call at the start of `computeWalletProfiles()`.

**Snapshot dedup in JS:** PostgREST has no `DISTINCT ON`. Fetch all `cohort_snapshots` rows for active wallet IDs (pg_cron keeps ≤2 per wallet, so ≤~1000 rows), dedup to latest per wallet in JS via a `Map<walletId, latestRow>`.

**Consistency uses non-zero days only:** Zeros are trading-off days. Including them in stddev/mean wrongly classifies low-frequency traders as inconsistent. Filter `daily_pnls` to non-zero entries before computing.

**Regime edge nullability:** If fewer than 2 regimes have ≥ `MIN_REGIME_DAYS` days, `regime_edge = null`. Regime PnL fields are individually nullable (a 60d bull run has no BEAR days).

**Profiles for all active wallets:** `computeWalletProfiles()` runs on `is_active = true` wallets, not just the current scoring batch. Same approach as `applyHygieneGates` in Stream B.

**scan-summary output:** `profiles_computed` and `profiles_skipped` go at top level of the summary object.

---

## Steps

### Step 1 — Migration `011_wallet_profiles.sql`

```sql
create table if not exists wallet_profiles (
  wallet_id         uuid primary key references wallets(id) on delete cascade,
  computed_at       timestamptz not null default now(),
  trading_style     text check (trading_style in ('SCALPER', 'SWING', 'TREND')),
  pnl_consistency   numeric(6, 4),
  bull_daily_pnl    numeric(12, 2),
  bear_daily_pnl    numeric(12, 2),
  ranging_daily_pnl numeric(12, 2),
  regime_edge       numeric(6, 4),
  current_coins     text[],
  regime_day_counts jsonb
);

create index if not exists idx_wallet_profiles_style
  on wallet_profiles(trading_style)
  where trading_style is not null;
```

---

### Step 2 — Pure functions in `lib/wallet-profile.ts` (new file)

```ts
export type TradingStyle = "SCALPER" | "SWING" | "TREND";

export interface RegimeStats {
  bull_daily_pnl:    number | null;
  bear_daily_pnl:    number | null;
  ranging_daily_pnl: number | null;
  regime_edge:       number | null;
  regime_day_counts: { BULL: number; BEAR: number; RANGING: number };
}
```

**`classifyTradingStyle(totalTrades: number): TradingStyle`**
- `> 300` → `"SCALPER"`
- `60–300` → `"SWING"`
- `< 60` → `"TREND"`

**`computeConsistency(dailyPnls: number[]): number`**
- Filter to non-zero entries (`activeDays`).
- Return `0` if `activeDays.length < 5` or `mean(activeDays) <= 0`.
- Otherwise: `1 - clamp(stddev(activeDays) / mean(activeDays), 0, 1)`.

**`computeRegimeStats(dailyPnls: number[], regimeLabels: string[]): RegimeStats`**
- `regimeLabels` is a parallel array (index i = same day as `dailyPnls[i]`), values `"BULL" | "BEAR" | "RANGING"`.
- Group daily PnL values by regime label.
- Compute avg per regime; null if that regime has fewer than `MIN_REGIME_DAYS` days.
- Compute `regime_edge` only when ≥2 regimes have enough data:
  ```
  best  = max(non-null regime avgs)
  worst = min(non-null regime avgs)
  regime_edge = clamp((best - worst) / max(|best| + |worst|, 1), -1, 1)
  ```
  Otherwise `regime_edge = null`.
- Return all regime PnL fields, `regime_edge`, and `regime_day_counts`.

**`extractTopCoins(positions: unknown[], maxCoins: number): string[]`**
- Parse positions as `{ position: { coin: string; positionValue: string } }[]`.
- Sort by `Math.abs(parseFloat(positionValue))` descending.
- Return up to `maxCoins` coin symbols.

---

### Step 3 — Unit tests in `lib/__tests__/wallet-profile.test.ts` (new file)

| Test group | Cases |
|---|---|
| `classifyTradingStyle` | boundary at 300 (SCALPER), boundary at 60 (TREND), midpoint 150 (SWING), 0 (TREND) |
| `computeConsistency` | fewer than 5 active days returns 0, mean ≤ 0 returns 0, uniform daily PnL returns ~1.0, highly variable returns low value |
| `computeRegimeStats` | all days same regime → other regimes null, two regimes present → regime_edge computed, MIN_REGIME_DAYS boundary (4 days → null, 5 days → non-null), regime_edge clamped to [-1,1] |
| `extractTopCoins` | sorted by |positionValue| descending, capped at maxCoins, empty positions returns [] |

---

### Step 4 — Update `scripts/daily-wallet-scan.ts`

#### 4a. Add constants

```ts
const SCALPER_THRESHOLD   = 300;
const TREND_THRESHOLD     = 60;
const MIN_REGIME_DAYS     = 5;
const MAX_PROFILE_COINS   = 5;
```

#### 4b. Add import

```ts
import {
  classifyTradingStyle,
  computeConsistency,
  computeRegimeStats,
  extractTopCoins,
} from "../lib/wallet-profile";
```

#### 4c. Add `profiles_computed` and `profiles_skipped` to the `summary` object in `main()`

```ts
profiles_computed: 0,
profiles_skipped:  0,
```

#### 4d. Implement `computeWalletProfiles()` function

```ts
async function computeWalletProfiles(supabase: SupabaseClient): Promise<{ computed: number; skipped: number }>
```

Steps inside:

1. **Fetch BTC 1d candles.** One call using the same `windowStart` as `buildDailyPnls`:
   ```ts
   const windowStart = Date.now() - SCORING_WINDOW_DAYS * 86400 * 1000;
   const btcCandles = await candleSnapshot("BTC", "1d", windowStart, SCORING_WINDOW_DAYS);
   ```
   Build `regimeLabels: string[]` of length 60 — index 0 = oldest day, index 59 = most recent:
   ```ts
   const regimeLabels = btcCandles.map(c => {
     const ret = (c.close - c.open) / c.open;
     return ret > 0.01 ? "BULL" : ret < -0.01 ? "BEAR" : "RANGING";
   });
   ```

2. **Fetch all active wallet IDs.**
   ```ts
   const { data: activeWallets } = await supabase
     .from("wallets")
     .select("id")
     .eq("is_active", true);
   ```

3. **Fetch `user_pnl_backtest` rows** for active wallet IDs — one query:
   ```ts
   .from("user_pnl_backtest")
   .select("wallet_id, total_trades, daily_pnls")
   .in("wallet_id", activeWalletIds)
   ```
   Build `Map<walletId, row>`.

4. **Fetch `cohort_snapshots` rows** for active wallet IDs — one query:
   ```ts
   .from("cohort_snapshots")
   .select("wallet_id, positions, created_at")
   .in("wallet_id", activeWalletIds)
   ```
   JS-dedup to latest per wallet:
   ```ts
   const latestSnapshot = new Map<string, { positions: unknown[]; created_at: string }>();
   for (const row of snapshotRows) {
     const existing = latestSnapshot.get(row.wallet_id);
     if (!existing || row.created_at > existing.created_at) {
       latestSnapshot.set(row.wallet_id, row);
     }
   }
   ```

5. **Compute profile per wallet.** For each active wallet:
   - If no `user_pnl_backtest` row → increment `skipped`, continue.
   - `trading_style = classifyTradingStyle(row.total_trades)`
   - `pnl_consistency = computeConsistency(row.daily_pnls)`
   - `regimeStats = computeRegimeStats(row.daily_pnls, regimeLabels)`
   - `current_coins = latestSnapshot.get(id) ? extractTopCoins(snapshot.positions, MAX_PROFILE_COINS) : []`
   - Push upsert row to batch array.
   - Increment `computed`.

6. **Upsert batch** into `wallet_profiles`:
   ```ts
   await supabase.from("wallet_profiles").upsert(batchRows, { onConflict: "wallet_id" });
   ```
   Upsert also updates `computed_at` to `now()`.

#### 4e. Call `computeWalletProfiles()` from `main()` after `detectSybilClusters()`

```ts
const profileResult = await computeWalletProfiles(supabase);
summary.profiles_computed = profileResult.computed;
summary.profiles_skipped  = profileResult.skipped;
```

---

### Step 5 — Verify and test

```bash
npm run typecheck
npm run test
```

All existing tests must continue to pass. `wallet-profile.test.ts` should add green.

---

### Step 6 — Docs

Update `docs/sprints/status.md`: Stream D status `SPEC READY → PLAN READY`.
After scan runs and acceptance criteria pass: mark `COMPLETE`.

---

## File summary

| File | Action |
|---|---|
| `supabase/migrations/011_wallet_profiles.sql` | NEW |
| `lib/wallet-profile.ts` | NEW (pure functions) |
| `lib/__tests__/wallet-profile.test.ts` | NEW |
| `scripts/daily-wallet-scan.ts` | MODIFY (constants, import, summary fields, `computeWalletProfiles` function + call) |
| `docs/sprints/status.md` | MODIFY |

No cron changes. No API route changes. One new Hyperliquid API call (BTC 1d candles, 60 rows).

---

## Non-goals

- Coin-level PnL profiling (requires adding `coin` to `FillRecord` — deferred Stream D revision)
- Profile exposure in API routes or UI (Stream F)
- Real-time profile updates in the cron (daily scan only)
