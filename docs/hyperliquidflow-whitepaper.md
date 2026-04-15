# HyperliquidFLOW: Technical Whitepaper

**April 2026 — v1.0**

---

## Abstract

HyperliquidFLOW is a real-time trading intelligence platform for the Hyperliquid perpetuals exchange. It tracks a curated cohort of high-performing wallets, scores them against a four-factor quantitative model, and runs 13 rule-based signal detectors against live position snapshots on a 60-second cycle. All intelligence derives from the Hyperliquid public API. No machine learning, no paid data feeds, no privileged access.

For the technical reader: the platform operates two data paths — a Vercel serverless cron (60s, rotating 100-wallet window) and a GitHub Actions daily scan (full cohort scoring from 30-day closing fills). Wallet scores are computed from a 35/25/25/15-weighted composite of Sharpe proxy, PnL consistency, drawdown score, and regime fit. Signal recipes range from per-wallet momentum detection to cohort-level structural risk. Expected value enrichment uses a walk-the-book slippage model on a $10K reference notional. Known approximations are documented in Section 8.

---

## 1. Introduction

The Hyperliquid perpetuals exchange publishes complete, real-time position and fill data for every wallet via a free public API. This makes a specific class of analysis possible: observe what the best traders are actually holding, track how those positions change cycle to cycle, and surface patterns before they resolve.

"Smart money on Hyperliquid" is operationally defined here as wallets that passed a statistical activation gate (win rate >= 52%, >= 30 trades in 30 days), maintain a composite score above 0.35 across four risk-adjusted performance factors, and have demonstrably survived the pruning cycle. The cohort is not curated by hand. It is rebuilt daily from the Hyperliquid leaderboard and supplementary fills-based discovery, then filtered by the scoring model.

The platform does not predict prices. It detects what high-scoring wallets are doing with their positions right now, and whether that behavior matches patterns historically associated with favorable outcomes.

---

## 2. Cohort Architecture

> **ELI5:** Every day, the platform finds the best traders on Hyperliquid by scanning the public leaderboard. It then filters out anyone who isn't consistently profitable and keeps a live list of wallets worth watching.

### 2.1 Wallet Discovery

Discovery runs daily at 00:00 UTC via GitHub Actions. The primary source is a GET request to `stats-data.hyperliquid.xyz/Mainnet/leaderboard`. Pre-filter criteria:

| Criterion | Threshold |
|---|---|
| Month ROI | >= 3% |
| Month PnL | >= $5,000 |
| All-time ROI | >= 0 |

All addresses passing the pre-filter are upserted to the `wallets` table.

A supplementary discovery path mines fills from the top-10 coins by 24h volume (from `metaAndAssetCtxs`). Addresses appearing in those fills are run through the same pre-filter and upserted as new candidates. This provides coverage for high-activity wallets that may not rank prominently on the leaderboard at scan time.

**Fallback status:** If the leaderboard GET fails, the fallback path returns hardcoded placeholder addresses. Discovery in that case falls back entirely to the fills-based supplementary path, which provides partial coverage but does not replace the full leaderboard scan.

### 2.2 Activation and Pruning

Not every discovered wallet enters the active cohort. Activation requires:

- `win_rate >= 0.52` (52%)
- `trade_count_30d >= 30`

These gates are evaluated by the daily scan after backtest computation. New wallets that pass discovery but have not yet been scored by the daily scan receive only a regime_fit-based score (factors 1-3 = 0) and no EV enrichment.

Pruning runs after each cron cycle as a fire-and-forget background task via Next.js `after()`. A wallet is deactivated when its `overall_score` falls below 0.35 across its most recent snapshot. The top 4 wallets by score are always retained regardless of threshold, preventing the cohort from emptying during market dislocations.

### 2.3 Tier Classification

Account equity from `cohort_snapshots.account_value` determines tier. Tier is re-computed on every snapshot write.

| Tier | Equity |
|---|---|
| Elite | >= $5,000,000 |
| Major | $1,000,000 – $4,999,999 |
| Large | $500,000 – $999,999 |
| Mid | $100,000 – $499,999 |
| Small | $50,000 – $99,999 |
| Micro | $1,000 – $49,999 |
| Dust | < $1,000 |

Wallets without a current snapshot show no tier badge. Negative account values return null.

---

## 3. Scoring Model

> **ELI5:** Each wallet gets a score from 0 to 1. The score answers: "How consistently profitable is this trader, and are they on the right side of the current market?" Higher is better. Scores below 0.35 get cut.

### 3.1 Data Foundation

All three history-based scoring factors read from `user_pnl_backtest.daily_pnls`: a 30-element array of per-day realized PnL. The array is built from closing fills only — fills where `closedPnl !== "0"`. Opening fills are excluded because they carry no realized P&L.

The build process: all fills within the last 30 days are grouped by UTC date. Each group's `closedPnl` values are summed to produce the day's entry in the array (index 0 = 30 days ago, index 29 = today). Days with no closing activity remain 0.

### 3.2 Factor Definitions

**Factor 1 — Sharpe Proxy (weight: 35%)**

```
raw_sharpe = mean(daily_pnls) / (stddev(daily_pnls) + 0.0001)
sharpe_proxy = clamp(raw_sharpe / 3.0, 0, 1)
```

The epsilon (0.0001) prevents division by zero for wallets with perfectly flat days. The divisor 3.0 sets the ceiling: a raw Sharpe of 3 produces a score of 1.0. Negative Sharpes floor at 0.

**Factor 2 — PnL Consistency (weight: 25%)**

```
Split daily_pnls into non-overlapping 7-day windows (including partial final window).
pnl_consistency = count(windows where sum > 0) / count(windows with at least one non-zero day)
```

A 30-day array produces up to 5 windows (days 0-6, 7-13, 14-20, 21-27, 28-29). Windows where all values are zero are excluded from the denominator, so wallets with sparse trading history are not penalized for inactivity.

**Factor 3 — Drawdown Score (weight: 25%)**

```
Build cumulative PnL series from daily_pnls.
For each peak in the cumulative series where peak > 0:
  drawdown_fraction = (peak - current_value) / (|peak| + 0.0001)
max_drawdown = max(drawdown_fraction) over all peaks
drawdown_score = clamp(1 - max_drawdown, 0, 1)
```

Peaks at or below zero are skipped — wallets that never accumulated positive cumulative PnL have no meaningful drawdown to measure.

**Factor 4 — Regime Fit (weight: 15%)**

Computed live from `assetPositions` each cycle. Net directional bias is derived from signed position values:

```
bias = sum(signed_notional) / (total_notional + 0.0001)   // range [-1, 1]

BULL regime:    regime_fit = clamp((bias + 1) / 2, 0, 1)   // rewards long bias
BEAR regime:    regime_fit = clamp((1 - bias) / 2, 0, 1)   // rewards short bias
RANGING regime: regime_fit = clamp(1 - |bias|, 0, 1)       // rewards neutral bias
```

Wallets with no open positions (flat) return 0.5 — a neutral score that neither rewards nor penalizes inactivity.

### 3.3 Composite Score

```
overall_score = 0.35 × sharpe_proxy + 0.25 × pnl_consistency + 0.25 × drawdown_score + 0.15 × regime_fit
```

The 35/25/25/15 weighting is a calibration assumption. It has not been empirically validated against wallet forward performance. A weight validation script (`scripts/validate-scoring-weights.ts`) correlates wallet scores against 30-day EV scores to assess whether the weighting is directionally sound, but it does not produce an optimized weight vector.

### 3.4 Regime Detection

BTC 24h return drives the three-state regime:

- `> +1.0%` → BULL
- `< -1.0%` → BEAR
- Between → RANGING

Each cron cycle writes the current BTC mid price to `btc_mid:{HH}` (UTC hour, zero-padded, TTL 25h). The 24h-prior price is read from the key corresponding to the same hour 24 hours earlier. This gives a stable 24h window that does not drift with cron timing variance. On KV miss for the 24h-ago key, the fallback assumes the current BTC mid was 1% lower 24 hours ago.

Regime is BTC-only. No per-coin or altcoin regime tracking exists.

---

## 4. Signal Architecture

> **ELI5:** Every 60 seconds, the platform takes a snapshot of every tracked wallet's open positions and compares it to the last snapshot. If the change matches one of 13 defined patterns, it fires a signal. Think of it as a smoke detector, not a crystal ball.

### 4.1 Snapshot Pair Model

Each cron cycle produces a `SnapshotPair` per wallet:

```typescript
interface SnapshotPair {
  walletId:      string;
  walletAddress: string;
  overallScore:  number;
  curr:          SnapshotRow;   // this cycle's clearinghouseState
  prev:          SnapshotRow | null; // prior cycle's snapshot from Supabase
}
```

Signal recipes compute deltas by diffing `curr.positions` against `prev.positions`. `prev` is null for wallets seen for the first time; all recipes skip the pair in this case.

Snapshot data captures open positions and margin metrics, not realized P&L. Realized P&L comes exclusively from `userFills.closedPnl`.

### 4.2 Recipe Catalog

| ID | Display Name | Type | Level | Trigger | Notes |
|---|---|---|---|---|---|
| `momentum_stack` | Whale Convergence | ENTRY | Cohort | 3+ wallets add combined $500K+ same direction within 5 min | — |
| `divergence_squeeze` | Silent Loading | ALERT | Per-wallet | Exposure rising, price flat (<0.5%), liq buffer <15% | — |
| `accumulation_reentry` | Dip Conviction | SCALE_IN | Per-wallet | Score >=0.65 wallet adds to position after coin drops >8% from 4h high | — |
| `rotation_carry` | Funded Edge | ENTRY | Per-wallet | New position with funding >0.03%/hr; requires >=10 prior signals before win-rate gate activates | Cold-start suppressed |
| `liq_rebound` | Liquidation Flush | ALERT | Cohort | Cohort notional on coin drops >5%, price moves >2% vs prior cycle | Approximated; see §8 |
| `streak_continuation` | Hot Streak | ALERT | Per-wallet | Score >=0.65 wallet on 5+ win streak with Sharpe proxy >=0.6 | Streak data is daily-scan frequency |
| `funding_divergence` | Smart Money vs. Retail | ALERT | Cohort | Cohort direction opposite to funding rate sign (crowd proxy) with funding >0.05%/hr | — |
| `whale_validated` | Alpha Confirmation | ENTRY | Meta | R1-R7 or R10-R13 signal corroborated by 3+ wallets with score >=0.75, fresh entry or >5% size growth this cycle | Dedup: original signal removed |
| `anti_whale_trap` | Smart Exit Signal | EXIT | Per-wallet | Score >=0.65 wallet cuts total exposure >=20% with regime_fit <0.35 | — |
| `position_aging` | Patience Trap | ALERT | Per-wallet | Score >=0.65 wallet underwater >5% of position value for 2+ consecutive cycles, not reducing | Async; KV state |
| `concentration_risk` | Crowded Coin | ALERT | Cohort | One coin >60% of total cohort notional | Direction: null |
| `wallet_churn` | Coordinated Exit | EXIT | Cohort | 3+ wallets reducing same coin by combined $500K+ within 5 min | — |
| `funding_trend` | Funding Surge | ALERT | Cohort | Coin funding rising for 3+ consecutive cycles and above 0.03%/hr | Async; KV state; direction: SHORT |

**Recipe groupings by behavioral category:**

- **Momentum detection (R1, R3, R12):** All three detect directional commitment from multiple wallets within a narrow time window. R1 and R12 are mirror images: R1 fires on coordinated addition, R12 on coordinated reduction. R3 narrows to high-score wallets buying dips.
- **Structural risk (R2, R11):** Neither is a directional trade signal. R2 identifies wallets accumulating exposure under liquidity pressure. R11 identifies macro concentration that could amplify drawdown across the cohort.
- **Carry and funding (R4, R7, R13):** All three use funding rates. R4 looks for individual wallets entering when carry is positive. R7 uses funding sign as a retail crowd proxy. R13 detects trend acceleration in the funding rate itself across cycles.
- **Cascade approximation (R5):** Attempts to identify forced liquidation events from cohort-level position shrinkage combined with price confirmation. An explicit approximation — see Section 8.
- **Streak and quality filters (R6, R8, R9):** R6 watches high-quality wallets on hot streaks. R8 validates signals from all other recipes by checking whether high-score wallets recently acted in the same direction. R9 watches high-score wallets defensively exit.
- **Position lifecycle (R10):** Tracks positions that have been underwater for multiple cycles without reduction — a pattern that can precede a forced close.

### 4.3 Whale Validation (R8)

Recipe 8 does not generate independent signals. It re-emits signals from any other recipe when the coin and direction have fresh activity from 3 or more wallets with `overall_score >= 0.75`.

"Fresh" is defined as: the position was opened this cycle (no prior snapshot entry) or the position size grew by more than 5% since the previous cycle. Whales holding unchanged week-old positions do not qualify — this prevents stale large positions from validating unrelated signals indefinitely.

When a signal is re-emitted as `whale_validated`, the original signal is removed from the deduplicated set. The feed never shows both the original recipe signal and its validated version.

### 4.4 Async Recipes (R10, R13)

Recipes 10 and 13 require state across cron cycles.

**R10** reads and writes `cohort:underwater_counts` (a JSON map of `walletId:coin` → consecutive-cycle count, TTL 25h). The recipe fires only when a position's consecutive underwater cycle count reaches 2. The count resets to 0 when the position improves, the wallet reduces size by more than 5%, or the position is closed.

**R13** reads and writes `market:funding_history:{coin}` (a 4-element rolling array of funding rate readings per coin, TTL 25h). The recipe fires when the current funding is above 0.03%/hr and the last three readings are strictly increasing.

Both recipes run in parallel with the synchronous recipes inside `runSignalLab()`.

---

## 5. EV Enrichment

> **ELI5:** Each signal gets a score between 0 and 1 representing how good the trade looks based on that wallet's historical track record. 0.6+ is considered worth acting on. Cohort-level signals don't get a score because they don't belong to a single wallet.

### 5.1 Formula

```
EV = (win_probability × avg_win_usd) - (loss_probability × avg_loss_usd) - trade_cost_usd
ev_score = clamp(EV / (5 × avg_loss_usd), 0, 1)
```

A 5x edge (EV equals 5 times the average loss) maps to score 1.0. `win_probability` and `avg_win_usd` / `avg_loss_usd` come from the wallet's `user_pnl_backtest` row.

`trade_cost_usd` = taker fee (0.035% of notional) + slippage estimate. Slippage uses a walk-the-book model on the L2 order book for the signal's coin. The reference notional is $10,000 for all signals regardless of wallet tier or actual position size.

L2 books are fetched for the top 10 coins by cohort notional per cycle. Signals on coins outside the top 10 use fee-only cost (slippage = 0).

### 5.2 Slippage Model

```
Walk the appropriate book side (buys consume asks, sells consume bids).
For each level: consume min(remaining_notional, level_notional).
Slippage = |avg_fill_price / mid_price - 1| × notional
If book is exhausted before fill is complete, extrapolate from the last level price.
```

`mid_price` is derived from the best bid/ask at the time the book is fetched.

### 5.3 Null Conditions

EV score is null for:

- Cohort-level signals (`liq_rebound`, `funding_divergence`, `concentration_risk`, `funding_trend`)
- Wallets without a `user_pnl_backtest` row (not yet processed by the daily scan)
- Wallets with a perfect win rate (no loss history — EV denominator would be undefined)
- `is_reliable` is false when `avg_win_usd = 0`, `avg_loss_usd = 0`, `win_probability = 0`, or `win_probability = 1`

---

## 6. Data Infrastructure

> **ELI5:** The platform has two jobs: a fast one running every 60 seconds that watches wallets and fires signals, and a slow one running once a day that rescores everyone. Data lives in a database (Supabase) and a fast cache (KV). The 60-second job must finish in under 10 seconds.

### 6.1 Dual-Path Architecture

**Path A — Vercel Cron (every 60 seconds):**

1. Load active wallets from `wallets` table. Read KV offset (`cohort:cycle_offset`) and select a 100-wallet rotating window. Increment and store offset. With 200 active wallets, the full cohort cycles every ~2 minutes.
2. `fetchBatchClearinghouseStates()` for the window — up to 10 concurrent requests, each at API weight 2.
3. Parallel fetch: `fetchAllMids()`, `fetchMetaAndAssetCtxs()`, `market:prior_mids` from KV.
4. Regime detection: write current BTC mid to `btc_mid:{HH}`, read `btc_mid:{agoHour}` for 24h prior.
5. Load prior `cohort_snapshots` from Supabase (one per wallet in the window).
6. Load `user_pnl_backtest` rows for scoring factors 1-3.
7. Score each wallet. Fire-and-forget `saveCohortSnapshot()` per wallet.
8. Fetch L2 books and 5m candles (4h window) for top 10 coins by cohort notional.
9. Load last 50 rows of `recipe_performance` for Recipe 4's win-rate gate.
10. Run `runSignalLab()`: all 13 recipes (R10 and R13 async in parallel), EV enrichment, intraday performance cache, persist to `signals_history`.
11. Load last 20 rows from `signals_history`.
12. Write `CohortCachePayload` to `cohort:active` (TTL 120s). Write `market:prior_mids`. Write `cohort:active:fallback` (TTL 24h, fire-and-forget).
13. Background via `after()`: `pruneUnderperformers()`.

**Path B — GitHub Actions (daily, 00:00 UTC):**

1. GET leaderboard; apply pre-filter (month ROI >= 3%, month PnL >= $5K, all-time ROI >= 0).
2. Upsert all qualifying addresses to `wallets`.
3. Supplementary discovery: mine fills from top-10 coins by 24h volume; apply same pre-filter.
4. Score batch: active wallets + inactive candidates (stalest first, up to 5,000 total), concurrency 3, 600ms delay per slot. Per wallet: `userFillsByTime` (last 30 days) → compute backtest → upsert `user_pnl_backtest` + update `wallets`.
5. Aggregate `signals_history` (last 30 days) by recipe → insert into `recipe_performance`.
6. Write `scan-summary.json` artifact.

### 6.2 Supabase Table Reference

| Table | Written by | Read by |
|---|---|---|
| `wallets` | Daily scan | Cron (load active), pruning |
| `user_pnl_backtest` | Daily scan | Cron (scoring factors 1-3), EV enrichment |
| `cohort_snapshots` | Cron (per cycle) | Signal recipes (prev snapshot), scoring |
| `signals_history` | Cron (via `runSignalLab`) | KV payload, Edge page, `recipe_performance`, intraday perf |
| `recipe_performance` | Daily scan | Recipe 4 win-rate gate, Edge page |

### 6.3 KV Key Reference

| Key | TTL | Purpose |
|---|---|---|
| `cohort:active` | 120s | Primary cohort cache; read by client poll |
| `cohort:active:fallback` | 24h | Fallback if primary expires between cycles |
| `cohort:cycle_offset` | 25h | Rotating window pointer for 100-wallet batching |
| `btc_mid:{HH}` | 25h | Per-hour BTC mid; 24 keys (00-23); stable 24h regime window |
| `market:prior_mids` | 10 min | allMids from prior cycle; R5 price confirmation input |
| `market:funding_history:{coin}` | 25h | Last 4 funding readings per coin; R13 trend state |
| `cohort:underwater_counts` | 25h | Per wallet+coin consecutive underwater cycle count; R10 state |
| `recipe:intraday_perf` | 7h | 6h rolling avg EV score per recipe; intraday supplement |

### 6.4 Cron Budget

The Vercel free tier enforces a ~10-second execution ceiling on cron functions. The design separates work accordingly:

- Heavy scoring and full-cohort backtesting run in GitHub Actions (Path B), not the cron.
- Snapshot writes are fire-and-forget (no awaiting write confirmation in the cron hot path).
- Pruning runs via `after()`, which executes after the response is returned and does not count against the function timeout.
- The rotating 100-wallet window bounds the API call count per cycle even as the cohort grows.

---

## 7. Known Limitations and Approximations

> **ELI5:** This section is the honest part. The system works, but some things it says are estimates or have gaps. Here's the full list.

1. **Recipe 5 (liq_rebound) is approximated.** The recipe fires when cohort notional on a coin drops more than 5% and price moves more than 2% versus the prior cycle mid. This combination is a reasonable proxy for forced liquidation but cannot confirm the position reduction was involuntary. True detection requires the Hyperliquid WebSocket liquidation stream, which exposes actual liquidation transactions in real time. A persistent WebSocket process is incompatible with Vercel serverless. This is tagged Phase 3. The recipe silently skips its first cycle after deploy until `market:prior_mids` is populated.

2. **Recipe 6 (streak_continuation) win streaks update daily, not intraday.** Streak data in `user_pnl_backtest` is written by the daily scan at 00:00 UTC. A streak broken during trading hours is not reflected until the next scan. The UI shows a staleness indicator. The underlying fix (intraday streak refresh) remains open.

3. **Recipe 4 (rotation_carry) is suppressed on fresh deploys.** The recipe requires at least 10 prior `rotation_carry` signals in `recipe_performance` before applying the 60% win-rate gate. Until that history accumulates, the recipe does not fire. This prevents bootstrap noise but means the recipe is silent on new deployments for an indeterminate period.

4. **EV scores are not scaled to actual position size.** The reference notional is $10,000 regardless of whether the signaling wallet holds $50K or $5M in that position. A wallet-tier-adjusted notional would produce more accurate cost estimates.

5. **New wallets have null EV scores.** Wallets discovered via leaderboard or fills mining but not yet scored by the daily scan have no `user_pnl_backtest` row. Their signals fire with `ev_score: null`. EV becomes available on the first nightly scan.

6. **L2 slippage is estimated for the top 10 coins only.** Signals on coins outside the top 10 by cohort notional use fee-only trade cost (slippage = 0). This understates cost for less liquid coins.

7. **Regime is BTC-only.** A wallet correctly positioned in a trending altcoin during a BTC-ranging environment is penalized on `regime_fit`. There is no per-coin or sector-level regime tracking.

8. **The leaderboard discovery fallback is non-functional.** If the leaderboard GET request fails, the system falls back to hardcoded placeholder addresses. Discovery in that scenario relies entirely on the fills-based supplementary path, which provides partial but incomplete coverage.

9. **Scoring weights are assumed, not empirically optimized.** The 35/25/25/15 weight vector is a reasonable starting point based on risk-adjusted performance intuition. The validation script (`scripts/validate-scoring-weights.ts`) checks correlation but does not produce an optimized vector.

---

## 8. Glossary

**SnapshotPair** — A pair of consecutive `cohort_snapshots` rows for a single wallet: `curr` (this cycle) and `prev` (prior cycle). Signal recipes operate on SnapshotPairs and return zero or more `SignalEvent` objects.

**closing fill** — A trade fill where `closedPnl !== "0"`. Opening fills (new position entries) always carry `closedPnl = "0"` and are excluded from all backtest computation.

**daily_pnls array** — A 30-element array of realized PnL per UTC day, index 0 = 30 days ago, index 29 = today. Built from closing fills. Stored in `user_pnl_backtest`. The source for Sharpe proxy, PnL consistency, and drawdown score.

**sharpe_proxy (normalized)** — `clamp(mean(daily_pnls) / (stddev(daily_pnls) + 0.0001) / 3.0, 0, 1)`. A raw Sharpe of 3 maps to 1.0. The normalized form is used in scoring; the raw annualized form is available separately via `annualisedSharpe()` for display.

**liq_buffer_pct** — `(account_value - total_margin_used) / account_value`. Fraction of account value not committed to margin. Lower values indicate proximity to liquidation.

**cohort-level event** — A signal emitted by `liq_rebound`, `funding_divergence`, `concentration_risk`, or `funding_trend`. These recipes evaluate cohort aggregate state, not individual wallets. They are persisted to `signals_history` with the first active wallet as a placeholder address and `cohort_level: true` in metadata. EV score is always null for cohort-level events.

**EV score** — `clamp(EV / (5 × avg_loss_usd), 0, 1)`, where `EV = (win_prob × avg_win) - (loss_prob × avg_loss) - trade_cost`. Normalized so a 5x expected edge maps to 1.0. Scores above 0.6 are considered actionable.

**regime fit** — The fourth scoring factor. Measures alignment between a wallet's current directional bias (net signed notional / total notional) and the detected BTC regime (BULL/BEAR/RANGING). Flat wallets score 0.5.
