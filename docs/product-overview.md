# HyperliquidFLOW — Product Overview

HyperliquidFLOW is a real-time trading intelligence dashboard for Hyperliquid perpetuals. It tracks a curated set of high-performing wallets and surfaces patterns in their behavior as actionable signals, regime context, and divergence alerts.

Everything runs on a 60-second refresh cycle. No AI inference. No paid data feeds. Rule-based throughout.

---

## What It Does

The dashboard answers one question continuously: what are the wallets that have proven themselves on Hyperliquid actually doing right now, and what does that mean for the market?

To answer it, the system:

1. Discovers wallet addresses from the Hyperliquid leaderboard API daily, supplemented by fills-based mining on the top-10 traded coins
2. Scores each wallet using a four-factor model built from 30 days of closing fills
3. Snapshots positions every 60 seconds, rotating across all active wallets via a KV offset counter so no wallet goes stale
4. Runs 13 signal detectors against each snapshot delta
5. Enriches signals with EV estimates from each wallet's historical trade stats
6. Detects divergences between smart money and crowd positioning (using funding rate sign as the crowd proxy)

---

## Pages

### Overview

The landing page. Shows the current state of the active cohort at a glance:

- Wallet count, active signal count, current regime (Bull / Bear / Ranging), BTC 24h return
- Top signals from the last cycle: recipe name, coin, direction, EV score
- Wallet leaderboard snapshot sorted by composite score

### Wallets

Three sub-pages:

**Leaderboard** — full ranked list of active wallets. Columns include rank, address, composite score, tier badge, win rate, Sharpe proxy, drawdown score.

**Discovery** — wallet discovery stats and tier breakdown. Inline address lookup for any Hyperliquid address.

**In Position** — wallets with open positions right now.

### Signals

Two tabs:

**Feed** — live signal events from the last cron cycle. Filterable by recipe, direction, and coin.

**Divergence** — coins where smart money direction diverges from the crowd (via funding rate sign). Each row shows direction, confidence score, and a rule-based trade plan (entry zone, stop, take profit, Kelly size, funding rate).

### Edge

Performance analytics for all 13 signal recipes. Shows signal count, historical win rate proxy, average EV score, and intraday performance (6h rolling) per recipe.

---

## Scoring Model

Wallets are scored on four factors, each normalized to [0, 1]:

| Factor | Weight | What it measures |
|---|---|---|
| Sharpe Proxy | 35% | `mean(daily_pnls) / (stddev + ε) / 3`. Raw Sharpe of 3 maps to 1.0. |
| PnL Consistency | 25% | Fraction of 7-day windows (stepping through all 30 days, including partial final window) with positive sum. |
| Drawdown Score | 25% | `1 - max_drawdown` from the cumulative 30-day PnL curve. |
| Regime Fit | 15% | How well the wallet's current directional bias aligns with BTC regime. Flat wallets score 0.5. |

Composite: `overall_score = 0.35 × sharpe + 0.25 × consistency + 0.25 × drawdown + 0.15 × regime_fit`

All three history-based factors read from `user_pnl_backtest.daily_pnls`, a 30-element array of per-day realized PnL built from closing fills only. Regime fit is computed live from current open positions each cycle.

**Activation criteria** (daily scan): win_rate >= 52%, trade_count_30d >= 30.
**Pruning threshold** (post-cron): overall_score < 0.35, minimum 4 wallets always retained.

---

## Wallet Tiers

Account equity from `cohort_snapshots.account_value`:

| Tier | Threshold |
|---|---|
| Elite | $5M+ |
| Major | $1M – $5M |
| Large | $500K – $1M |
| Mid | $100K – $500K |
| Small | $50K – $100K |
| Micro | $1K – $50K |
| Dust | Under $1K |

Tier is stored in `cohort_snapshots.equity_tier` on every snapshot write. Wallets without a current snapshot show no tier badge.

---

## Signal Recipes

13 rule-based detectors. All receive consecutive snapshot pairs for the current wallet window. Recipes 10 and 13 are async (they read/write KV state between cycles).

| Recipe ID | Display Name | Signal type | What it detects |
|---|---|---|---|
| `momentum_stack` | Whale Convergence | ENTRY | 3+ wallets add combined $500K+ notional same direction within 5 min |
| `divergence_squeeze` | Silent Loading | ALERT | Per-wallet: exposure rising >$25K, price flat last 30m (<0.5%), liq buffer below 10%, wallet score >=0.55; 20-min cooldown per wallet+coin |
| `accumulation_reentry` | Dip Conviction | SCALE_IN | High-score wallet (>=0.65) increases position after coin drops from 4h high by a per-coin threshold: 2x the coin's 4h range, clamped [6%, 15%] |
| `rotation_carry` | Funded Edge | ENTRY | New position with positive funding (>0.03%/hr); requires >=10 prior signals before win-rate gate activates |
| `liq_rebound` | Liquidation Flush | ALERT | Cohort notional drops >5% on a coin AND price moves vs prior cycle mid by a per-coin threshold: BTC/ETH >1.5%, alts >3.5%. Direction derived from price move. First cycle silently skips until prior mids are in KV. |
| `streak_continuation` | Hot Streak | ALERT | Wallet on 5+ win streak with normalized Sharpe proxy above 0.6. Streak data updated by daily scan; UI shows staleness indicator. |
| `funding_divergence` | Smart Money vs. Retail | ALERT | Cohort direction opposite to crowd direction (funding rate sign). Fires in both long and short cohort scenarios. |
| `whale_validated` | Alpha Confirmation | ENTRY | Any R1-R7, R10-R13 signal corroborated by 3+ wallets with score >= 0.75 that entered or added >5% to their position this cycle |
| `anti_whale_trap` | Smart Exit Signal | EXIT | High-score wallet (>=0.65) cuts total exposure >=20% with regime fit below 0.35 |
| `position_aging` | Patience Trap | ALERT | High-score wallet holding a position down >5% of position value for 2+ consecutive cycles without reducing. State tracked in KV key `cohort:underwater_counts`. |
| `concentration_risk` | Crowded Coin | ALERT | Cohort-level: one coin accounts for >60% of total cohort notional (ETH threshold 70%, BTC excluded). Includes top-3 wallets by exposure. |
| `wallet_churn` | Coordinated Exit | EXIT | 3+ wallets simultaneously reducing the same coin by >= $500K combined within 5 min |
| `funding_trend` | Funding Surge | ALERT | Coin funding rate rising for 3+ consecutive cycles and above 0.03%/hr. State tracked per coin in KV keys `market:funding_history:{coin}`. Direction SHORT (rising funding implies overextended longs). |

**Cohort-level recipes** (no single wallet): `liq_rebound`, `concentration_risk`, `funding_divergence`, `funding_trend`. Persisted in `signals_history` with the first active wallet as a placeholder and `cohort_level: true` in metadata. Recipe 11 emits `direction: null` (concentration is a risk signal, not directional).

**Whale validation scope:** Recipe 8 validates signals from all other recipes (R1-R7, R10-R13). Signals re-emitted as `whale_validated` are removed from the deduped pre-validation set so the feed never shows both the original and the validated version.

---

## EV Score

Computed per-wallet using:

```
EV = (win_prob × avg_win) - (loss_prob × avg_loss) - trade_cost
ev_score = clamp(EV / (5 × avg_loss), 0, 1)
```

A 5x edge maps to 1.0. Scores above 0.6 are considered actionable.

Trade cost uses 0.035% taker fee plus L2 book walk-the-book slippage on a $10K reference notional. L2 books are fetched only for the top 10 coins by cohort notional per cycle; signals on other coins use fee-only cost.

Returns null for: cohort-level signals (`liq_rebound`, `funding_divergence`, `concentration_risk`, `funding_trend`), new wallets without backtest data, wallets with no loss history (perfect win rate), and any wallet not yet processed by the daily scan.

---

## Data Flow

### Path A — Vercel Cron (every 60s)

1. Load all active wallets. Read KV offset counter (`cohort:cycle_offset`) to select a rotating 100-wallet window; increment and store offset. With 200 active wallets, full cohort coverage every ~2 minutes.
2. `fetchBatchClearinghouseStates()` for the window (10 concurrent, weight 2 each)
3. Fetch in parallel: `fetchAllMids()`, `fetchMetaAndAssetCtxs()`, `market:prior_mids` from KV (prior cycle's allMids, used by Recipe 5)
4. Detect BTC regime: write `btc_mid:{HH}` (current UTC hour) to KV; read `btc_mid:{agoHour}` (24h earlier) as the prior price. Fallback: `currentBtcMid * 0.99` on KV miss.
5. Load prior `cohort_snapshots` from Supabase (one per wallet in the current window)
6. Load `user_pnl_backtest` from Supabase for scoring factors 1-3
7. Score each wallet, fire-and-forget `saveCohortSnapshot()` per wallet
8. Fetch L2 books + 5m candles (4h window) for top 10 coins by cohort notional
9. Load `recipe_performance` (latest 50 rows) for Recipe 4's win-rate gate and signal counts
10. `runSignalLab()`: run all 13 recipes (R10 and R13 are async KV reads, run in parallel); enrich with EV; compute intraday perf aggregate (last 6h of `signals_history`, cached as `recipe:intraday_perf` in KV); persist to `signals_history`
11. Load last 20 rows from `signals_history`
12. Write `CohortCachePayload` to KV key `cohort:active` (TTL 120s); write `market:prior_mids` (current allMids for next cycle's R5); write `cohort:active:fallback` (TTL 24h, fire-and-forget)
13. Background via `after()`: `pruneUnderperformers()`

KV payload contains: regime, btc_return_24h, top 200 wallets by score (with account metrics, tier, win_rate, liq_buffer), last 20 signal events.

### Path B — GitHub Actions (daily, 00:00 UTC)

1. GET leaderboard from `stats-data.hyperliquid.xyz/Mainnet/leaderboard`
2. Pre-filter: month ROI >= 3%, month PnL >= $5K, all-time ROI >= 0
3. Upsert all pre-qualified addresses to `wallets` table
4. Supplementary discovery: mine addresses from fills on the top-10 coins by 24h volume (from `metaAndAssetCtxs`); apply same pre-filter; upsert new addresses
5. Score batch: all active wallets + inactive candidates (stalest first, ≤5000 total), concurrency 3, 600ms delay per slot
6. Per wallet: `userFillsByTime` (last 30d) → compute all metrics → upsert `user_pnl_backtest` + update `wallets`
7. Aggregate `signals_history` (last 30d) by recipe → insert into `recipe_performance`
8. Write `scan-summary.json` artifact

The cron reads `user_pnl_backtest.daily_pnls` written by the daily scan for real-time scoring. Wallets not yet processed by the daily scan get only a regime_fit-based score (factors 1-3 = 0).

### Tables

| Table | Written by | Used by |
|---|---|---|
| `wallets` | daily scan | cron (load active), pruning |
| `user_pnl_backtest` | daily scan | cron (scoring factors 1-3), EV enrichment |
| `cohort_snapshots` | cron (per cycle) | signal recipes (prev snapshot), scoring history |
| `signals_history` | cron (via runSignalLab) | KV payload, Edge page, recipe_performance, intraday perf |
| `recipe_performance` | daily scan | Recipe 4 win-rate and cold-start gate, Edge page |

### KV Keys

| Key | TTL | Purpose |
|---|---|---|
| `cohort:active` | 120s | Primary cohort cache read by client poll |
| `cohort:active:fallback` | 24h | Fallback if primary expires between cron cycles; prevents cold Supabase hits |
| `cohort:cycle_offset` | 25h | Rotating window pointer for 100-wallet cron batching |
| `btc_mid:{HH}` | 25h | Per-hour BTC mid price; 24 keys (00-23), used for stable 24h regime window |
| `market:prior_mids` | 10 min | allMids from prior cycle; Recipe 5 price-confirmation input |
| `market:funding_history:{coin}` | 25h | Last 4 funding rate readings per coin; Recipe 13 trend detection |
| `cohort:underwater_counts` | 25h | Per wallet+coin consecutive-cycle underwater count; Recipe 10 state |
| `recipe:intraday_perf` | 7h | 6h rolling avg ev_score per recipe; supplements daily recipe_performance |

---

## Regime Detection

BTC 24h return thresholds:
- `> +1%` → BULL (rewards long-biased wallets in scoring)
- `< -1%` → BEAR (rewards short-biased wallets)
- Between → RANGING (rewards neutral wallets)

Each cron cycle writes the current BTC mid to `btc_mid:{HH}` (0-padded UTC hour, TTL 25h). The prior price is read from the key corresponding to the same hour 24 hours ago. This gives a stable 24h window that does not drift with cron timing. On KV miss for the 24h-ago key, fallback assumes 1% lower than current.

Regime is BTC-only — no per-coin or altcoin regime tracking.

---

## Pipeline Engineering Backlog

Tracked separately from product sprints (Sprints 1-6 in `docs/superpowers/specs/2026-04-13-roadmap-master.md`). Full spec in `docs/superpowers/plans/2026-04-14-pipeline-engineering-backlog.md`.

| Item | Status |
|---|---|
| R7: funding direction fix | DONE |
| R5: price confirmation | DONE |
| R8: freshness gate | DONE |
| 100-wallet window rotation | DONE |
| R4: cold-start gate | DONE |
| BTC regime hourly storage | DONE |
| R6: streak staleness indicator (UI label) | DONE |
| KV secondary fallback (24h TTL) | DONE |
| Recipe 10: position_aging | DONE |
| Recipe 11: concentration_risk | DONE |
| Recipe 12: wallet_churn | DONE |
| Recipe 13: funding_trend | DONE |
| Intraday recipe_performance feedback | DONE |
| Scoring weight validation script | DONE |
| pnl_consistency covers all 30 days | DONE |
| Supplementary fills-based discovery | DONE |
| R6: intraday streak data refresh | open — UI label shipped; underlying data still daily-scan frequency |
| WebSocket for Recipe 5 | Phase 3 — requires persistent WS process outside Vercel serverless |

---

## Known Limitations

**Recipe 5 (liq_rebound) is an approximation.** Cohort position shrinkage + >2% price move vs prior cycle is used as a proxy for a liquidation cascade. Direction is derived from price move direction (drop = long rebound, rise = short rebound). True detection requires the Hyperliquid WebSocket liquidation stream (Phase 3). The first cycle after deploy skips the recipe silently until prior mids are in KV.

**Recipe 6 (streak_continuation) win streaks are daily-scan frequency.** The streak data in `user_pnl_backtest` updates once per day. A streak broken intraday is not reflected until the next daily scan. The UI shows a staleness indicator; the underlying data fix is open.

**Recipe 4 (rotation_carry) is suppressed during cold start.** With fewer than 10 prior `rotation_carry` signals in `recipe_performance`, the recipe does not fire. This prevents free-firing during bootstrap but means the recipe is silent on fresh deployments until history accumulates.

**EV scores are not position-size-scaled.** The reference notional is $10K regardless of wallet tier or actual position size.

**New wallets have null EV scores** until the daily scan processes them and writes a `user_pnl_backtest` row.

**Coins outside the top 10 get EV with fee only, no slippage.** L2 books are fetched for the top 10 coins by cohort notional per cycle.

**Regime is BTC-only.** Altcoin-specific trends are not captured. A wallet correctly positioned in a trending altcoin during a BTC-ranging environment is penalized on regime_fit.

**The discovery fallback path is non-functional.** If the leaderboard GET endpoint fails, the fallback returns hardcoded placeholder addresses. Wallet discovery falls back to the fills-based supplementary path (top-10 coins), which provides partial coverage but does not replace the full leaderboard scan.

All backtest data derives from realized (closing) fills. Unrealized PnL is never counted.
