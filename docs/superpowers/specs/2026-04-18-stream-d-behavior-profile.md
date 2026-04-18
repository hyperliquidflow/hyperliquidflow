# Stream D — Per-Wallet Behavior Profile

**Date:** 2026-04-18
**Status:** Draft
**Depends on:** Stream A (active cohort, daily_pnls data), Stream C (clean cohort — profiles only meaningful without wash/sybil noise)
**Unlocks:** Stream E (signal validation — regime-conditional accuracy needs per-wallet regime skill)

---

## Goal

Build a behavioral fingerprint for each active wallet that captures *how* they trade, not just *how well*. This unlocks regime-aware signal weighting (trust a BULL-specialist's signals more in a bull market), better cohort segmentation, and richer UI cards.

---

## Problem

All active wallets currently look the same to the signal recipes. A wallet with 900 trades/month (scalper) and one with 20 trades/month (trend follower) get equal signal weight. A wallet that only makes money in BULL markets gets equal weight in BEAR markets. These are different actors — treating them identically degrades signal quality.

---

## Scope: what's computable from existing data

### Constraint: only 2 cohort snapshots per wallet

The pg_cron cleanup (`migration 002`) retains only the 2 most recent `cohort_snapshots` rows per wallet. Deriving dominant coins from snapshot *history* is not viable — we get 2 data points. Coin-level profiling from fills (which coins produce the most PnL) requires adding `coin` to `FillRecord` and per-fill storage — deferred to a future Stream D revision. This stream works entirely from existing DB data plus one cheap BTC candles call.

### Five profile dimensions

**1. Trading style** — `SCALPER` | `SWING` | `TREND`

From `user_pnl_backtest.total_trades` (60d window):
- `> 300` trades → SCALPER (avg 5+/day — high-frequency, small edge per trade)
- `60–300` trades → SWING (avg 1–5/day — tactical, holds hours to days)
- `< 60` trades → TREND (avg <1/day — position-based, conviction-driven)

**2. PnL consistency** — `[0, 1]`

Measures how stable the daily_pnl stream is. High = reliable edge; low = feast-or-famine.

```
active_days = daily_pnls.filter(v => v !== 0)
consistency = 1 - clamp(stddev(active_days) / max(mean(active_days), 1), 0, 1)
```

Computed over **non-zero days only** — zeros are trading-off days and should not dilute the signal. A wallet trading 10 days with $500/day is highly consistent; including 50 zero days in the mean/stddev would wrongly classify it as inconsistent.

Only computed when `active_days.length >= 5` and `mean(active_days) > 0`. Otherwise 0.

**3. Regime-conditional PnL** — `bull_pnl`, `bear_pnl`, `ranging_pnl` (avg daily USD)

Label each of the 60 daily_pnls entries by the BTC regime that day. Average PnL per regime.

BTC regime labels: fetch 60 1d candles for BTC using `windowStart = Date.now() - SCORING_WINDOW_DAYS * 86400 * 1000` as `startTime` — the same window origin used by `buildDailyPnls`. This ensures index 0 of `daily_pnls` aligns with the first candle. Label each day BULL (return > +1%) / BEAR (return < -1%) / RANGING (otherwise). One `candleSnapshot` API call, same endpoint already used in the cron.

**4. Regime edge** — `[-1, 1]` normalized score

How much better a wallet performs in its best regime vs its worst. A wallet that only makes money in BULL markets should be de-weighted in BEAR.

```
best  = max(bull_pnl, bear_pnl, ranging_pnl)   -- only non-null values
worst = min(bull_pnl, bear_pnl, ranging_pnl)
regime_edge = clamp((best - worst) / max(abs(best) + abs(worst), 1), -1, 1)
```

Only computed when at least two regimes have data (each with ≥ `MIN_REGIME_DAYS` days). If only one or zero regimes have enough data, `regime_edge = null`.

High regime_edge = specialist (regime-dependent, strong in best, weak in worst).
Low regime_edge = generalist (performs similarly across regimes).

**5. Current coin exposure** (best-effort, single snapshot)

From the latest `cohort_snapshots.positions` row — list of open coins at last scoring time. Position objects have the shape `{ position: { coin: string, positionValue: string, szi: string } }`. Sort by `|positionValue|` descending, take top 5 coin symbols. Stored as `text[]`. This is a snapshot of *current* book, not a historical pattern. Labeled as such in the UI. Worth storing for the dashboard even with the caveat.

---

## Schema — `011_wallet_profiles.sql`

New table, not columns on `wallets`, to keep the identity table clean:

```sql
create table if not exists wallet_profiles (
  wallet_id         uuid primary key references wallets(id) on delete cascade,
  computed_at       timestamptz not null default now(),
  trading_style     text check (trading_style in ('SCALPER', 'SWING', 'TREND')),
  pnl_consistency   numeric(6, 4),   -- [0,1]
  bull_daily_pnl    numeric(12, 2),  -- avg daily PnL on BULL days (null if no BULL days in window)
  bear_daily_pnl    numeric(12, 2),
  ranging_daily_pnl numeric(12, 2),
  regime_edge       numeric(6, 4),   -- [-1,1]
  current_coins     text[],          -- open coins at latest snapshot, notional-ordered, max 5
  regime_day_counts jsonb            -- {"BULL": N, "BEAR": N, "RANGING": N} for transparency
);

create index if not exists idx_wallet_profiles_style
  on wallet_profiles(trading_style)
  where trading_style is not null;
```

---

## Where it runs

New `computeWalletProfiles()` function in `scripts/daily-wallet-scan.ts`, called after Stream C's `detectSybilClusters()` — i.e., after the cohort is clean. Runs on all currently active wallets (not just this scan's qualifiers — all is_active wallets get a profile refresh).

Steps inside `computeWalletProfiles()`:
1. Fetch 60d BTC 1d candles (one API call at start of function).
2. Build `btcRegimeLabels: Map<date_string, "BULL" | "BEAR" | "RANGING">` for each of the 60 days.
3. Read `user_pnl_backtest` rows for all active wallets — one query.
4. Read all `cohort_snapshots` rows for active wallet IDs (at most 2 per wallet due to pg_cron cleanup, so ≤ ~1000 rows total) and dedupe to latest per wallet in JS. PostgREST does not support `DISTINCT ON`; JS dedup is cheaper than a custom RPC function.
5. Compute all four dimensions per wallet.
6. Upsert into `wallet_profiles` — one batched upsert.

---

## Thresholds

| Constant | Value | Rationale |
|---|---|---|
| `SCALPER_THRESHOLD` | `300` | >300 trades/60d = 5+/day. Strategy is frequency, not conviction. |
| `TREND_THRESHOLD` | `60` | <60 trades/60d = <1/day. Position-based, low-frequency. |
| `MIN_REGIME_DAYS` | `5` | Need at least 5 days in a regime to compute a meaningful average. Fewer → null. |
| `MAX_PROFILE_COINS` | `5` | Top 5 coins by notional from latest snapshot. |

---

## Output in scan-summary.json

```json
{
  "profiles_computed": 493,
  "profiles_skipped": 12
}
```

Skipped = active wallets with no `user_pnl_backtest` row (shouldn't happen post-Stream A, but defensive).

---

## Files changed

| Action | File | What |
|---|---|---|
| NEW | `supabase/migrations/011_wallet_profiles.sql` | `wallet_profiles` table |
| MODIFY | `scripts/daily-wallet-scan.ts` | Add `computeWalletProfiles()` post-scan |
| NEW | `lib/wallet-profile.ts` | Pure functions: `classifyTradingStyle`, `computeConsistency`, `computeRegimeStats` |
| NEW | `lib/__tests__/wallet-profile.test.ts` | Unit tests for pure functions |
| MODIFY | `docs/sprints/status.md` | Mark Stream D complete when done |

No cron changes. No new routes. One new Hyperliquid API call (BTC 1d candles, 60 rows — negligible budget).

---

## Acceptance criteria

1. `npx tsc --noEmit` passes
2. `npm run test` passes including `wallet-profile.test.ts`
3. Migration 011 applies cleanly
4. After next daily scan, `select count(*) from wallet_profiles` matches `select count(*) from wallets where is_active = true` (all active wallets get a profile)
5. `trading_style` distribution is non-trivial: at least two of the three styles present
6. At least one wallet has a non-null `bull_daily_pnl` and non-null `bear_daily_pnl` with different values
7. `profiles_computed` appears in scan-summary.json with count > 0

---

## Risks and open questions

1. **Coin exposure from 1 snapshot is noisy.** A wallet that just closed all positions looks flat; one that just opened looks concentrated. This is a snapshot, not a pattern. Document it clearly in the UI (Stream F). Do not use it for gating decisions.
2. **Regime label coverage.** A 60d window in a sustained bull market may have 0 BEAR days, leaving `bear_daily_pnl = null`. Handled by `MIN_REGIME_DAYS` floor and null-safe regime_edge computation.
3. **BTC candles API call cadence.** One call per scan run — negligible. Same endpoint as the cron's regime detection, so we know it works.
4. **Profiles for newly-activated wallets.** A wallet activated in today's scan won't have a `user_pnl_backtest` row until `saveBacktestRow` runs (earlier in the same scan). Since `computeWalletProfiles()` runs after scoring, the row will exist. No ordering issue.
5. **Profile staleness for wallets not in today's scoring batch.** A wallet active in DB but absent from today's leaderboard won't have its `user_pnl_backtest` updated. Its profile is computed from last-scan data — potentially days old. Acceptable; profile is "last scored" not real-time. Stream B's hygiene gates deactivate truly stale wallets.
6. **Deferred: coin-level PnL profiling.** Adding `coin` to `FillRecord` (already returned by the Hyperliquid API, just not captured) would let us compute which coins each wallet makes money on. This is the highest-value next step for Stream D — but it requires per-fill storage decisions and a schema design for `wallet_coin_stats`. Scoped as a Stream D revision after the base profile is running and validated.
