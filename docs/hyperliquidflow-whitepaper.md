# HyperliquidFLOW

**Technical whitepaper, v2.0, April 2026**

---

## 1. The thesis

Hyperliquid publishes complete position and fill data for every wallet through a free public API. Most traders do not read it. The ones who do cannot process 1.6 million accounts.

HyperliquidFLOW does one thing: it filters that crowd down to wallets that have actually proven themselves, reads what those wallets are doing in real time, and fires a signal when their behavior matches a pattern we can describe with a rule.

No predictions. No machine-learning black box. No paid data. Just a public API, a set of filters, and a set of behavioral recipes that either fire or they don't.

---

## 2. How we choose which wallets to watch

Of the ~1.6M wallets on Hyperliquid, we watch roughly 500 at any given time. The number is a consequence of the filters, not a target.

Every day at 00:00 UTC the pipeline:

1. **Discovers** candidates from two sources: the public leaderboard API, and fills on the top-10 coins by 24h volume. Typical run: ~4,500 candidates.
2. **Scores** each candidate against 30 days of their realized (closing) fills.
3. **Activates** only the ones that pass every gate in the Stream A quality pipeline: nine independent checks covering win rate, trade count, equity, drawdown behavior, regime fit, and trading recency. Typical run: ~500 wallets activated.
4. **Rejects** the rest with a recorded reason, so the funnel is auditable.

The activated set is the cohort. Everything downstream operates on it.

### Keeping the cohort honest

Activation is one-time-per-day. In between, three background processes keep the cohort from going stale or getting gamed:

- **Hygiene gates (Stream B).** Every cycle, we check whether an active wallet has gone quiet, blown up, or stopped trading. Wallets that fail deactivate immediately, not at the next daily scan.
- **Wash and sybil detection (Stream C).** Wallets that trade with themselves, or cluster into coordinated rings, are flagged and removed. This runs during the daily scan against the last 30 days of fills.
- **Behavior profiling (Stream D).** For every active wallet we build a profile: trading style (scalper, swing, position), conviction level (size concentration), regime tendency (long-bias, short-bias, neutral). Profiles are used by the ranking and UI layers, and by the signal validation loop.

A wallet in the active cohort has survived all three continuously.

### Scoring

Activated wallets are ranked by a four-factor composite score, each normalized to [0, 1]:

- **Sharpe proxy (35%):** `mean(daily_pnls) / stddev`, normalized so a raw Sharpe of 3 maps to 1.0.
- **PnL consistency (25%):** fraction of 7-day windows in the last 30 days with positive sum.
- **Drawdown score (25%):** `1 − max_drawdown` from the cumulative 30-day PnL curve.
- **Regime fit (15%):** alignment between the wallet's current directional bias and the BTC regime (BULL / BEAR / RANGING, based on BTC 24h return crossing ±1%).

All three history factors read from a single 30-element array of realized daily PnL, built from closing fills only. Unrealized PnL is never counted.

The 35/25/25/15 weights are an engineering assumption. A weight-validation script correlates scores against forward EV performance, but the weights are not empirically optimized. We consider this a known limitation, not a claim.

### Hypurrscan enrichment

Wallet addresses are enriched with public Hypurrscan labels where available (exchange hot wallets, known market makers, public traders). The enrichment is advisory: it surfaces context in the UI but does not affect scoring or activation.

---

## 3. How we read their behavior

The cohort produces a continuous stream of position changes. We watch those changes through 13 behavioral recipes. Each recipe takes a snapshot pair (this cycle's positions, last cycle's positions) and returns zero or more signal events. That's the entire surface area.

The recipes fall into five groups.

**Momentum.** Three wallets or more adding the same coin in the same direction inside a narrow window. Whale Convergence fires on coordinated additions; Coordinated Exit fires on coordinated reductions; Dip Conviction fires when a high-score wallet adds during a pullback sized to the coin's own 4h range.

**Structural risk.** Not directional trades, but warnings. Silent Loading fires when multiple wallets quietly accumulate into low liquidity buffers on a flat-priced coin. Crowded Coin fires when the cohort has concentrated more than 60% of its notional (70% for ETH, BTC excluded) into a single name.

**Carry and funding.** Funded Edge enters when a wallet opens a position aligned with a positive funding carry, gated by prior-signal win rate. Smart Money vs. Retail fires when the cohort's direction opposes the funding sign (using funding as a crude crowd proxy). Funding Surge fires when a coin's funding has risen for three consecutive cycles and crossed 0.03%/hr.

**Liquidation and cascade.** Liquidation Flush is a best-effort approximation: cohort notional drops sharply on a coin while price moves by the coin's own threshold (1.5% for BTC/ETH, 3.5% for alts). True liquidation detection requires the Hyperliquid WebSocket stream; this is roadmap.

**Quality filters and lifecycle.** Hot Streak watches high-score wallets on 5+ winning days. Alpha Confirmation re-emits any other recipe's signal when 3+ wallets with score ≥0.75 have fresh exposure in the same direction; the original signal is removed so the feed never double-counts. Smart Exit fires when a high-score wallet cuts ≥20% of exposure in a regime they're now misaligned with. Patience Trap fires when a high-score wallet holds an underwater position for two consecutive cycles without reducing.

A signal is a fact ("these three wallets added $600K of ETH in the last 5 minutes"), not a prediction. What it means is a separate question, which brings us to scoring.

### Confidence scoring

Every per-wallet signal carries an EV score between 0 and 1:

```
EV       = win_prob × avg_win − loss_prob × avg_loss − trade_cost
ev_score = clamp(EV / (5 × avg_loss), 0, 1)
```

A 5x expected edge maps to 1.0. Scores above 0.6 are considered actionable.

`win_prob`, `avg_win`, and `avg_loss` come from the signaling wallet's own 30-day backtest. `trade_cost` is the Hyperliquid 0.035% taker fee plus walk-the-book slippage on a $10K reference notional against the live L2 book, fetched each cycle for the top 10 coins by cohort notional. Signals on less liquid coins use fee-only cost, which understates slippage.

Cohort-level signals (Crowded Coin, Liquidation Flush, Smart Money vs. Retail, Funding Surge) do not carry EV scores. They don't belong to a wallet.

### Waterproofing (Stream E)

Confidence is not just a formula. Every signal that fires gets its outcome measured against price action in the following window, and the result is written to `signal_outcomes`. A nightly learning job aggregates those outcomes per recipe and per wallet, producing a reliability stat that the ranking layer uses to down-weight recipes or wallets whose historical signals have not paid out.

The feedback loop is why Stream E exists. Without it, a broken recipe keeps firing forever. With it, poor recipes get muted and good wallets get surfaced.

### Dashboard truth (Stream F)

Stream F enforces that the UI only surfaces signals and wallets backed by enough validated history to be trustworthy. New wallets, new recipes, and signals without measurable outcomes are tagged accordingly in the feed rather than presented as settled. This is an integrity layer, not a hiding layer. Raw data is still accessible on the detail pages.

---

## 4. What the user sees

The app has four surfaces:

**Overview.** A live snapshot: active cohort size, current regime, BTC 24h return, top signals from the latest cycle, leaderboard excerpt.

**Wallets.** Leaderboard (ranked by composite score), Discovery (funnel stats, inline address lookup), In-Position (live open positions across the cohort).

**Signals.** Feed (chronological events, filterable), Divergence (coins where cohort direction opposes the crowd), Radar (per-token cohort positioning with historical bias trend), Performance (per-recipe accuracy, win rate, average EV, intraday 6h rolling).

**Edge cases** like new wallets with no backtest, or coins outside the top-10 liquidity tier, are surfaced explicitly. They are not hidden.

---

## 5. Infrastructure, briefly

Two processes do the work:

- **Daily scan (GitHub Actions, 00:00 UTC):** discovery, Streams A/C/D, backtests, Supabase writes, scan summary artifact. Budget: 50 minutes.
- **Live signal detection (GitHub Actions keepalive pinging the Vercel route):** snapshot the cohort, diff against last cycle, run the recipes, enrich with EV, write signals and a cache payload. Budget: 10 seconds per cycle. KV TTL 120s with a 24h fallback key.

The client polls a cached snapshot at 60s and triggers a background refresh if the cache is more than 5 minutes stale. The Vercel daily cron is seed-only (Hobby plan restriction).

A nightly signal-learning job (01:00 UTC) closes the loop by updating outcome stats. A 15-minute freshness check fails loudly if the cache goes stale.

Data splits cleanly: realized PnL lives in `user_pnl_backtest`, live positions live in `cohort_snapshots`, signal events in `signals_history`, outcomes in `signal_outcomes`, hygiene state in `wallet_hygiene`, clustering results in `wash_sybil`, profiles in `wallet_profiles`. We never mix realized and unrealized.

---

## 6. What we don't do

An honest list. Any of these could mislead a user if not stated.

1. **We don't predict prices.** Signals describe what happened, not what will happen.
2. **We don't catch liquidations in real time.** Liquidation Flush is an approximation. Real-time detection requires WebSocket infrastructure that is incompatible with our current serverless architecture. Roadmap.
3. **Regime is BTC-only.** A wallet correctly positioned in a trending altcoin while BTC is ranging gets penalized on `regime_fit`. We don't have per-coin regime.
4. **EV uses a fixed $10K reference notional.** It does not scale to the signaling wallet's actual position size. A $5M whale and a $50K account get the same slippage estimate.
5. **Slippage is zero on less liquid coins.** Only the top 10 coins by cohort notional have their L2 books walked. Everything else uses fee-only cost.
6. **Scoring weights are assumed, not optimized.** The 35/25/25/15 split is a reasonable prior that has not been fit to forward performance.
7. **New wallets have null EV.** Until the nightly scan produces a backtest, their signals fire without confidence scores. We mark them as such.
8. **Leaderboard discovery has a non-functional fallback.** If the Hyperliquid leaderboard API fails, we fall back to fills-mining only, which covers the top-10 coins but misses wallets active elsewhere.

We prefer to surface these than hide them.

---

## 7. Roadmap

Short list, roughly ordered.

- **Per-coin regime.** Remove the BTC-only assumption.
- **WebSocket liquidation stream.** Replace the R5 approximation with ground truth.
- **Position-scaled EV.** Use the signaling wallet's actual notional, not a fixed reference.
- **Wallet alerts and paper copy-trading** (Sprint 5, next).
- **Authenticated user accounts** (Sprint 6).
- **Autonomous documentation agent.** Watches `lib/*.ts` for behavioral drift against this whitepaper and opens review PRs when a gate threshold, recipe rule, or data-flow step changes. Phase 1 ships drift detection; Phase 2 auto-patches.

---

## 8. Glossary

**Active cohort:** Wallets currently passing Stream A activation and all of Streams B/C/D hygiene. Typically ~500.

**Closing fill:** A fill where `closedPnl !== "0"`. The only source of realized PnL.

**Daily PnL array:** 30-element vector of per-day realized PnL, index 0 = 30 days ago. Source of Sharpe proxy, consistency, drawdown.

**EV score:** `clamp(EV / (5 × avg_loss), 0, 1)`. A 5x expected edge maps to 1.0. Actionable above 0.6.

**Hygiene gate:** A per-cycle check (quiet, blown up, stopped trading) that deactivates wallets between daily scans.

**Regime:** BULL / BEAR / RANGING. Derived from BTC 24h return crossing ±1%.

**Regime fit:** Alignment between wallet bias (signed notional / total notional) and current regime. Flat wallets score 0.5.

**Signal event:** An output of one of the 13 recipes for a given cycle. Persisted to `signals_history` with metadata including EV score and validation state.

**Signal outcome:** The measured price outcome of a fired signal, recorded in `signal_outcomes` and fed into Stream E's reliability stats.

**Snapshot pair:** Two consecutive `cohort_snapshots` rows for one wallet. Signal recipes diff them.

**Wash / sybil cluster:** A group of wallets flagged by Stream C as trading with themselves or each other in a coordinated pattern.

**Waterproofing:** Shorthand for Streams D/E/F: profile, validate, surface truthfully.
