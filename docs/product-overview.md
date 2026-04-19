# HyperliquidFLOW — Product Overview

HyperliquidFLOW is a trading-intelligence dashboard for Hyperliquid perpetuals. It filters the ~1.6M Hyperliquid wallets down to an activated cohort of roughly 500 that have proven themselves over the last 30 days, watches what they do, and fires signals when their behavior matches one of 13 rule-based patterns.

No ML. No paid data. Public API end to end.

---

## How it works, in one page

1. **Discover** — Each day, pull candidates from the Hyperliquid leaderboard API and from fills on the top-10 coins by volume. Typical: ~4,500 candidates.
2. **Activate (Stream A)** — Run each candidate through 9 quality gates (win rate, trade count, equity, drawdown, regime fit, trading recency, etc.). Typical: ~500 activated.
3. **Keep honest** —
   - Stream B deactivates wallets that go quiet, blow up, or stop trading (per-cycle).
   - Stream C flags wash trading and sybil clusters (during the daily scan).
   - Stream D builds a behavior profile per wallet (style, conviction, regime tendency).
4. **Score** — Four factors: Sharpe proxy (35%), PnL consistency (25%), drawdown (25%), regime fit (15%).
5. **Snapshot** — Diff cohort positions each cycle. Run 13 recipes. Enrich with EV.
6. **Waterproof (Stream E)** — Measure every signal's outcome; feed reliability stats back into ranking.
7. **Surface (Stream F)** — UI only promotes wallets and recipes backed by validated history.

---

## Pages

| Route | Purpose |
|---|---|
| `/` | Overview — cohort size, regime, BTC 24h, top signals, leaderboard excerpt |
| `/wallets/leaderboard` | Full ranked leaderboard |
| `/wallets/discovery` | Discovery funnel stats + address lookup |
| `/wallets/inposition` | Wallets with open positions right now |
| `/signals/feed` | Chronological signal events, filterable |
| `/signals/divergence` | Cohort vs. crowd direction per coin |
| `/signals/radar` | Per-token cohort positioning + bias trend (Sprint 4) |
| `/signals/performance` | Per-recipe accuracy, win rate, avg EV, intraday 6h rolling |

Legacy routes (`/scanner`, `/stalker`, `/contrarian`, `/imbalance`, `/recipes`, `/performance`, `/edge`) redirect to their current equivalents.

---

## Scoring

Each wallet gets a composite score in [0, 1]:

```
overall_score = 0.35 × sharpe_proxy
              + 0.25 × pnl_consistency
              + 0.25 × drawdown_score
              + 0.15 × regime_fit
```

All three history factors read from `user_pnl_backtest.daily_pnls` — a 30-element array of per-day realized PnL built from closing fills only. Regime fit is computed live from `assetPositions` each cycle.

**Activation** (daily scan, Stream A): 9 quality gates. See `lib/cohort-engine.ts` + Stream A spec for the current gate list and thresholds.

**Pruning** (between scans):
- Score < 0.35 → deactivate after cycle (top 4 always retained).
- Stream B hygiene failure → deactivate immediately.

---

## Wallet tiers

Tier is derived from `cohort_snapshots.account_value` on every snapshot write. Badges are visual only; tier does not affect scoring.

| Tier | Threshold |
|---|---|
| Elite | $5M+ |
| Major | $1M – $5M |
| Large | $500K – $1M |
| Mid | $100K – $500K |
| Small | $50K – $100K |
| Micro | $1K – $50K |
| Dust | < $1K |

---

## Signal recipes

13 rule-based detectors. All receive `SnapshotPair` objects and return zero or more `SignalEvent`s. Recipes R10 and R13 are async (KV-stateful across cycles).

| ID | Display | Type | Level | Trigger |
|---|---|---|---|---|
| `momentum_stack` | Whale Convergence | ENTRY | Cohort | 3+ wallets add combined ≥$500K same direction in 5 min |
| `divergence_squeeze` | Silent Loading | ALERT | Cohort | 2+ wallets (score ≥0.60) each adding >$25K on a coin flat (<0.5%) for 30m with liq buffer <10%. 20-min cooldown per coin |
| `accumulation_reentry` | Dip Conviction | SCALE_IN | Per-wallet | Score ≥0.65 wallet adds after coin drops from 4h high by 2× its 4h range, clamped [6%, 15%] |
| `rotation_carry` | Funded Edge | ENTRY | Per-wallet | New position with funding >0.03%/hr; gated on ≥10 prior signals + win rate |
| `liq_rebound` | Liquidation Flush | ALERT | Cohort | Cohort notional on coin drops >5% AND price moves >1.5% (BTC/ETH) or >3.5% (alts) vs prior cycle. Approximated |
| `streak_continuation` | Hot Streak | ALERT | Per-wallet | Score ≥0.65 wallet on 5+ win streak with Sharpe proxy ≥0.6. Streak updated daily — UI shows staleness |
| `funding_divergence` | Smart Money vs. Retail | ALERT | Cohort | Cohort direction opposite to funding rate sign, funding >0.05%/hr |
| `whale_validated` | Alpha Confirmation | ENTRY | Meta | Any R1–R7 or R10–R13 signal corroborated by 3+ wallets (score ≥0.75) with fresh exposure. Original removed |
| `anti_whale_trap` | Smart Exit Signal | EXIT | Per-wallet | Score ≥0.65 wallet cuts ≥20% of exposure with regime fit <0.35 |
| `position_aging` | Patience Trap | ALERT | Per-wallet | Score ≥0.65 wallet underwater >5% for 2+ consecutive cycles, not reducing. KV state |
| `concentration_risk` | Crowded Coin | ALERT | Cohort | One coin >60% of cohort notional (70% for ETH, BTC excluded) |
| `wallet_churn` | Coordinated Exit | EXIT | Cohort | 3+ wallets reducing same coin by combined ≥$500K in 5 min |
| `funding_trend` | Funding Surge | ALERT | Cohort | Funding rising 3+ consecutive cycles AND above 0.03%/hr. KV state. Direction SHORT |

Canonical thresholds and edge cases live in `lib/signal-lab.ts` and `lib/recipe-config.ts`. Display strings are in `lib/recipe-meta.ts`.

**Cohort-level recipes** (no single wallet): `liq_rebound`, `funding_divergence`, `concentration_risk`, `funding_trend`. Persisted to `signals_history` with `cohort_level: true` and `ev_score: null`.

---

## EV score

```
EV       = win_prob × avg_win − loss_prob × avg_loss − trade_cost
ev_score = clamp(EV / (5 × avg_loss), 0, 1)
```

A 5x expected edge maps to 1.0. Actionable above 0.6.

Trade cost = 0.035% taker fee + L2 walk-the-book slippage on a $10K reference notional. L2 books are fetched only for the top 10 coins by cohort notional per cycle; other coins use fee-only cost.

Returns `null` for cohort-level signals, new wallets without backtest data, perfect-win-rate wallets (no loss history), and any wallet not yet processed by the daily scan.

---

## Waterproofing (Streams E + F)

**Stream E — Signal Validation.** Every fired signal has its outcome measured against subsequent price action, written to `signal_outcomes`. A nightly job (`scripts/signal-learning.ts`, 01:00 UTC) aggregates outcomes per recipe and per wallet. Reliability stats feed back into ranking and surface gating.

**Stream F — Dashboard Truth.** The UI only promotes signals and wallets backed by validated history. New wallets, new recipes, and unmeasured signals are tagged explicitly. Raw data remains accessible on detail pages.

---

## Data flow

### Daily scan (GitHub Actions, 00:00 UTC, 50-min budget)

1. Discovery: leaderboard GET + top-10-coin fills mining.
2. Stream A activation gates (9 checks per candidate).
3. Stream C wash/sybil detection across last 30d of fills.
4. Stream D behavior profiling.
5. Backtests: `userFillsByTime` (30d) → `user_pnl_backtest`.
6. `recipe_performance` aggregation from `signals_history` (last 30d).
7. Emit `scan-summary.json` artifact (7-day retention).

### Signal detection (GitHub Actions keepalive → Vercel route, ~10s budget)

1. Load active wallets; read `cohort:cycle_offset`; select 100-wallet rotating window.
2. Fetch `clearinghouseState`, `allMids`, `metaAndAssetCtxs`, prior mids.
3. Regime detection (hourly `btc_mid:{HH}` keys for stable 24h window).
4. Load prior snapshots + backtest rows for scoring.
5. Score window, write snapshots fire-and-forget.
6. Fetch L2 books for top 10 coins by cohort notional.
7. `runSignalLab()`: all 13 recipes, EV enrichment, intraday perf, persist `signals_history`.
8. Write `cohort:active` KV (TTL 120s), `cohort:active:fallback` (TTL 24h).
9. Background via `after()`: `pruneUnderperformers()`, hygiene gates.

### Signal learning (GitHub Actions, 01:00 UTC)

1. Run `scripts/signal-learning.ts`: compute outcomes for unmeasured signals, update aggregates, emit `learning-summary.json` (14-day retention).

### Client

React Query polls `/api/cohort-state` at 60s. Reads KV snapshot. Fires a background refresh if `updated_at` is >5 min stale. Freshness-check workflow runs every 15 min and fails loudly at 20 min stale.

---

## Tables

| Table | Written by | Read by |
|---|---|---|
| `wallets` | daily scan | cron, pruning |
| `user_pnl_backtest` | daily scan | cron scoring, EV enrichment |
| `cohort_snapshots` | cron (per cycle) | recipes, scoring history |
| `signals_history` | cron (`runSignalLab`) | KV payload, Performance page, outcomes job |
| `recipe_performance` | daily scan + cron intraday | R4 win-rate gate, Performance page |
| `signal_outcomes` (007) | signal-learning job | Stream E reliability stats |
| `recipe_calibration` (008) | signal-learning job | recipe ranking |
| `wallet_hygiene` (009) | cohort-hygiene engine (cron) | activation gates, UI flags |
| `wash_sybil` (010) | daily scan (Stream C) | activation gates, UI flags |
| `wallet_profiles` (011) | daily scan (Stream D) | ranking, UI detail pages |

---

## KV keys

| Key | TTL | Purpose |
|---|---|---|
| `cohort:active` | 120s | Primary cache, read by client |
| `cohort:active:fallback` | 24h | Fallback on primary miss |
| `cohort:cycle_offset` | 25h | Rotating 100-wallet window pointer |
| `btc_mid:{HH}` | 25h | Per-hour BTC mid, 24 keys for stable 24h window |
| `market:prior_mids` | 10 min | Previous cycle's allMids, R5 input |
| `market:funding_history:{coin}` | 25h | Last 4 funding readings per coin, R13 state |
| `cohort:underwater_counts` | 25h | Consecutive-cycle underwater count, R10 state |
| `recipe:intraday_perf` | 7h | 6h rolling avg EV per recipe |

---

## Regime detection

BTC 24h return:
- `> +1%` → BULL
- `< −1%` → BEAR
- Between → RANGING

Each cycle writes current BTC mid to `btc_mid:{HH}` and reads the same key 24h earlier. Fallback on miss: assume 1% lower. No per-coin regime.

---

## Hypurrscan enrichment

Addresses are enriched with public Hypurrscan labels (exchange hot wallets, market makers, public traders) via `lib/hypurrscan-enrichment.ts`. The index is seeded by `scripts/bootstrap-hypurrscan-index.ts`. Labels are advisory — they surface context in the UI but do not affect scoring or activation.

---

## Known limitations

1. **Liquidation detection is approximate.** R5 uses cohort shrinkage + price move as a proxy. True detection needs the Hyperliquid WebSocket liquidation stream. Roadmap.
2. **R6 streak data is daily.** Intraday streak breaks are not reflected until the next scan. UI shows a staleness indicator.
3. **R4 is cold-start-suppressed.** Requires ≥10 prior `rotation_carry` signals before the win-rate gate activates.
4. **EV uses a fixed $10K reference notional.** Does not scale to actual position size.
5. **New wallets have null EV** until the nightly scan produces a backtest row.
6. **Slippage = 0 for coins outside the top 10** by cohort notional. Understates cost on less liquid names.
7. **Regime is BTC-only.** No per-coin or sector regime.
8. **Leaderboard discovery fallback is non-functional.** On GET failure, discovery falls back to fills-mining only.
9. **Scoring weights are assumed, not optimized.** The 35/25/25/15 split is a prior, not a fit.

Unrealized PnL is never counted.

---

## Sprint roadmap

Tracked in [docs/sprints/status.md](sprints/status.md). Active: Sprint 5 (Wallet Alerts + Paper Copy Trading). Completed: Sprints 1–4 + Streams A–F.
