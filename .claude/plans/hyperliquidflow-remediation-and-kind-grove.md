# HyperliquidFLOW Remediation Plan (v2, post self-audit)

## Context

The whitepaper audit surfaced structural issues: circular EV scoring (win_prob sourced from the signaling wallet's own backtest), leverage-blind cohort ranking, naive outcome measurement (price-only at T+4h), no forward-validated PnL, and unmeasured signal-to-entry latency. The goal is to turn HyperliquidFLOW from a plausible-looking intelligence dashboard into a system whose claims are forward-measurable. If it can generate meaningful returns, we can prove it. If it can't, we stop polishing it.

**This is a private personal copy-trading tool, not a SaaS product.** Phase 5 is automated execution for personal use, not subscriber acquisition. Infra must stay as cheap as possible -- trades cover costs. No marketing spend, no subscriber churn, no CAC. P0.4 unit economics and P0.3 regulatory review are dropped; the only economic bar is trading PnL exceeding infra costs (~$30-50/mo).

A v1 draft of this plan was written, then self-audited. The self-audit found that v1 solved the measurement problem but not the edge problem, the adverse-selection problem, or the distribution problem. V2 incorporates those fixes as pre-flight work and as explicit kill criteria throughout.

**Core sequencing**: measurement before prediction. A rank-IC gate at the end of Phase 1 decides whether Phases 2 through 4 are worth building.

## Codebase reality check

From direct exploration of the code on 2026-04-19:

| Draft claim | Reality | Source |
|---|---|---|
| 30-day scoring window | 60 days | scripts/daily-wallet-scan.ts (`SCORING_WINDOW_DAYS = 60`; column names keep legacy `_30d` suffix) |
| Leverage not captured at API | Captured, typed, stored in `cohort_snapshots.positions` JSONB; unused in scoring/profiling | lib/hyperliquid-api-client.ts |
| Latest migration is 008 | 015 is latest (015_outcome_overhaul) | supabase/migrations/ |
| 9 Stream A gates | 9 hard gates plus 1 conditional wash gate | scripts/daily-wallet-scan.ts |
| Cron runs every 60s | Vercel cron is `0 0 * * *` (daily). GitHub Actions ping keeps it alive every 15 min. Client polls 60s. | vercel.json, .github/workflows/freshness-check.yml |
| Signals untimestamped | `detected_at` stamped at DB insert; `whale_fill_ts` now captured via R7 | lib/signal-lab.ts |
| Recipe-level win rates absent | `recipeWinRates: Map<string, number>` exists but used by only recipe4 (rotation_carry) for firing, never for EV | lib/signal-lab.ts |
| No performance dashboard | Exists, publishes 24h directional accuracy by recipe (not rank IC, not PnL, not benchmarks) | app/signals/performance/PerformanceClient.tsx |
| Sybil filter universal | Runs only on qualified wallets (post-Stream-A); pre-activation sybils never correlated | scripts/daily-wallet-scan.ts |

Confirmed problems addressed by R7-R10:
- **EV circularity**: lib/signal-lab.ts `enrichWithEv` pulls `win_probability` from `backtestMap.get(event.wallet_id)`. Still present, addressed in R12 (Sprint 12).
- **Scoring is leverage-blind**: lib/cohort-engine.ts. `0.35*sharpe_proxy + 0.25*pnl_consistency + 0.25*drawdown + 0.15*regime_fit`. Addressed in R8 (G10 gate + attrition tracking). Scoring formula rewrite in R13.
- **Outcome classification was price-only at T+4h**: Fixed in R10 (ATR-based exit simulation).
- **No signal-to-entry latency**: Partially fixed in R7 (signal_timing table, first_poll_ts backfill, Signal Speed card). **Known gap**: `whale_fill_ts` is hardcoded `null` in `app/api/refresh-cohort/route.ts:489` -- the field is typed on `SignalEvent` (`lib/signal-lab.ts:74`) but the fill timestamp is not passed from the Hyperliquid fill object through to the timing insert. Latency stats are therefore incomplete (signal_emit_ts minus first_poll_ts only). Fix when R21 WebSocket work rethreads fill data.
- **No rank IC**: Fixed in R9 (rank_ic_history, rank-ic.ts, /performance/ranking).

---

## Phase 0: Pre-flight work (COMPLETE)

Preflight docs checked in to docs/preflight/:
- rank-ic-power.md (MDIC analysis)
- kill-criteria.md (phase kill conditions)
- unit-economics.md (private use only -- economic bar is trading PnL > infra costs)

---

## Phase 1: Instrumentation (Sprints R7 through R10) -- COMPLETE

All four sprints complete as of 2026-04-19.

### Sprint R7: Signal-to-entry latency capture -- COMPLETE (2026-04-19)
- migration 012_signal_timing.sql
- signal_timing table, SignalLabResult, freshness API, Overview Signal Speed card

### Sprint R8: Leverage capture + cohort attrition -- COMPLETE (2026-04-19)
- migration 013_leverage_and_attrition.sql
- computeLeverageStats, upsertAttritionStates, G10 gate, blow_up_distance

### Sprint R9: Rank IC measurement -- COMPLETE (2026-04-19)
- migration 014_rank_ic.sql
- wallet_score_history, rank_ic_history, rank-ic.ts, rank-ic.yml, /performance/ranking page, Overview IC badge

### Sprint R10: Outcome measurement overhaul -- COMPLETE (2026-04-19)
- migration 015_outcome_overhaul.sql
- lib/atr.ts, simulateAtrExit, signal-learning.ts rewrite, recipe_performance net PnL fields

**Phase 1 gate**: after 60 days with 30+ rank-IC measurements, statistically significant positive IC above the MDIC threshold. If not, stop.

---

## Phase 2: Decoupling, anti-survivorship, anti-circularity (Sprints R11 through R16)

### Sprint R11: Multi-window selection + out-of-cohort validation set -- COMPLETE (2026-04-19)
- Migration 016_multi_window_and_oocv.sql: score_30d/90d/180d + bull/bear/ranging_days + score_stability on wallets; regime_at_day on user_pnl_backtest; out_of_cohort_tracking table
- daily-wallet-scan.ts Phase 12: 180d fill fetch (G13), 3-window score computation, G11 (score_stability > 0.25) + G12 (< 10 active days per regime bucket) deactivation gates
- daily-wallet-scan.ts Phase 13: stratified-random OOCV sample (target 400) from pre-filter-passing but activation-failing wallets
- rank-ic.ts: computeWeeklyRecipeBaseRates() -- in-cohort vs OOCV firing-frequency comparison per recipe
- **Post-review corrections (2026-04-19)**: C1 rejection_breakdown += not =; C2 computeWindowScore uses MIN_REGIME_DAYS=5 not 1; I1 regime_at_day sliced to SCORING_WINDOW_DAYS for daily_pnls alignment; I3 oocv_sampled uses final.length not unreliable upsert count; I5 btcCandles sorted ascending before regime mapping
- **Known gaps carried forward**: regime_at_day is 60d-aligned (matches daily_pnls); 180d PnL storage deferred to R13 when backtest schema changes. OOCV signal tracking not yet wired (R12 scope).

### Sprint R12: EV decouple -- COMPLETE (2026-04-19)
- `supabase/migrations/017_ev_decouple.sql`: `recipe_calibration` (recipe_id PK, win_rate, avg_win_bps, avg_loss_bps, sample_size_30d, Wilson 95% CI bounds, source CHECK IN ('in_cohort','oocv','blended')) + `wallet_signal_stats` (wallet_address, recipe_id, window_days, win_rate_net, signal_count; PK on all three).
- `scripts/wallet-signal-stats.ts`: nightly script (runs after signal-learning.ts in signal-learning.yml). Fetches resolved signal_outcomes last 30d, batch-looks up wallet_ids from signals_history, upserts both tables. MIN_SAMPLE_RECIPE=10, MIN_SAMPLE_WALLET=5, Wilson CI z=1.96.
- `lib/signal-lab.ts`: `enrichWithEv` rewritten with Bayesian blend (RECIPE_WEIGHT=0.70, WALLET_WEIGHT=0.30). Recipe base rate activates only when sample_size_30d >= RECIPE_MIN_SAMPLE (30); falls back to wallet-only win_rate otherwise. `SignalLabInputs.recipeCalibrationMap` added (optional, backward-compat).
- `app/api/refresh-cohort/route.ts`: loads `recipe_calibration` at Step 9, passes `recipeCalibrationMap` to `runSignalLab`.
- Success criterion: Pearson(ev_score, wallet.score) drops from ~0.8 to 0.2-0.4 after 30d of production data (measured in R16).

### Sprint R13: Empirically-fit leverage-adjusted scoring -- COMPLETE (2026-04-21)
- migration 018_shadow_scoring.sql: `overall_score_shadow`, `shadow_formula_version` on `wallets`; `overall_score_shadow` on `wallet_score_history`; `rank_ic_shadow` on `rank_ic_history`
- lib/leverage-risk.ts (new): `computeBlowUpPenalty`, `computeBlowUpDistanceScore`, `computeLevAdjSharpe`, `DEFAULT_PENALTY_PARAMS { safe_lev:3, max_lev:15, exponent:1.5 }`, `SHADOW_FORMULA_VERSION = "v2_r13"`
- scripts/fit-leverage-penalty.ts (new): empirical param fitting from `cohort_attrition`; graceful exit if < 10 blow-up events
- lib/cohort-engine.ts: `CohortScoresV2` type + `computeCohortScoresV2` -- V2 formula running alongside V1 (non-breaking)
- scripts/daily-wallet-scan.ts: Phase 10b computes and batch-upserts shadow scores; `writeScoreHistory` includes `overall_score_shadow`
- scripts/rank-ic.ts: `computeShadowIcForDate`, shadow IC written to `rank_ic_shadow`, gate summary logs V2 vs V1 median
- Canary running: cutover gated on 30-day shadow IC comparison (criteria in docs/sprints/status.md)

### Sprint R14: Entity classification with labeled training set
- Pre-work: manually label 300 wallets across expected entity types using Hypurrscan tags + manual fill inspection. Store in docs/preflight/entity-training-set.csv.
- Train simple decision tree (sklearn via scripts/train-entity-classifier.py) or logistic regression on hedge_ratio, fill_frequency, hold_duration, notional_concentration. Target confusion matrix precision > 0.8 on MM and arb classes.
- lib/entity-classifier.ts (new): applies learned thresholds, not hand-chosen ones.
- Migration 019_entity_classify.sql: adds `entity_type`, `entity_confidence`, `hedge_ratio`, `fill_frequency_per_day` to `wallet_profiles`.
- New gate G14 excludes MM and arb.

### Sprint R15: Adverse-selection detection
- Migration 020_adverse_selection.sql: new table `wallet_fade_signals` (`wallet_address`, `measured_at`, `fade_score`, `evidence_json`).
- lib/fade-detector.ts (new): rolling "fade score" based on fill pattern reversals, PnL divergence between followable entries and overall entries, cross-venue signals.
- Wallets with sustained high fade scores get auto-deactivated via a new hygiene gate.
- Publish "fade-watch" panel on ranking page.

### Sprint R16: EV decoupling validation (30-day wait)
- Pure measurement sprint. No code changes.
- Verify all Phase 2 success criteria hold for 30 days of production data.
- Plot: old cohort rank IC, new cohort rank IC, OOCV recipe stats, Pearson(ev_score, wallet.score), fade-watch false-positive rate.
- Write up results in docs/sprint-16-results.md.
- **Phase 2 kill criterion**: new rank IC materially below Phase 1 baseline, or OOCV recipe stats materially worse than in-cohort. Revert and halt.

---

## Phase 3: Forward validation (Sprints R17 through R20)

### Sprint R17: Paper trader with cumulative impact
- Migration 021_paper_trader.sql: `paper_trader_configs`, `paper_trades`, `paper_equity_curves`.
- lib/paper-trader.ts with cumulative-impact state: running book-displacement tracker per coin, decaying exponentially over ~10 minutes.
- scripts/paper-trader-cron.ts ticked by GitHub Actions.
- Five configs:
  - `all_signals` (ev > 0)
  - `high_ev_only` (ev > 0.6)
  - `top_wallets_only` (top decile by lev-adj score)
  - `btc_hold` benchmark
  - `random_cohort_risk_matched` benchmark: random wallet subset weighted to match active cohort on volatility, avg trade frequency, avg hold duration -- not a uniform random draw.

### Sprint R18: Follower-realistic cost model
- lib/risk-engine.ts: extend L2 book fetching from top 10 to top 50 by exchange volume. Fallback slippage estimate for illiquid coins (volume-ratio based). Followers always market-take.
- Re-run outcome measurement with new cost model. Document delta in expectancy_bps_net.

### Sprint R19: Capacity surface + coin eligibility
- lib/capacity-model.ts: inverse-solve lib/risk-engine.ts `walkBookCost` for notional that produces 20bps impact, per coin per cycle.
- Per-signal followable capacity exposed in UI. Aggregate daily system capacity shown on performance page.
- Coin eligibility exit: a coin is eligible if ALL three hold:
  1. followable_capacity_usd > $50K
  2. signal_count_30d >= 30
  3. expectancy_bps_net > 0 after realistic follower costs
- Store eligible set in KV key `eligible_coins:v1`. Refresh monthly.

### Sprint R20: Published performance dashboard
- Extend app/signals/performance/PerformanceClient.tsx (do not replace).
- New panels: paper equity curves including both benchmarks, rank IC with CI bands + MDIC floor line, per-recipe net expectancy, latency histogram, cohort mortality curve, fade-watch count, in-cohort vs OOCV divergence metric.
- Include scenario band (downside / midpoint / upside) on any forward projection.

**Phase 3 gate**: `all_signals` beats `btc_hold` net of realistic costs over 90-day walk-forward AND beats `random_cohort_risk_matched` over 60 days. If either fails, stop.

---

## Phase 4: Architecture and recipe upgrades (Sprints R21 through R24)

### Sprint R21: WebSocket ingestion
- Separate Fly.io or Railway worker for WS connection, writes to Redis pub/sub that Vercel consumes.
- Infra budget $100-300/month once monitoring, alerting, reconnection logic, rate-limit handling, multi-region failover included.
- Target: p50 `total_latency_ms` under 3000 on BTC/ETH, under 10000 on alts.

### Sprint R22: Personal alerts via Telegram bot
- Telegram bot webhook only. No Supabase Auth, no Web Push, no subscriber management.
- Bot fires on signal emit with coin, direction, EV score, current latency.

### Sprint R23: Per-coin regime detection
- Replace BTC-only lib/cohort-engine.ts `detectRegime` with per-coin version.

### Sprint R24: Recipe fixes
- R2 hot-streak redesign (currently chases a mean-reverting stat): replacement fires on momentum confluence with regime alignment.
- R7 funding flip: add OI-change crowding confirmation.
- R4/R6 crowded coin: fire on transitions, not steady-state.
- R3 regime exit: per-coin regime dependency.

---

## Phase 5: Automated execution (Sprint R25+)

Gated on Phase 3 success. No regulatory clearance needed. No subscribers. No marketing.

- lib/execution-client.ts: wraps Hyperliquid order API (market orders, position sizing from capacity model, stop placement from ATR layer).
- scripts/execution-cron.ts: reads live signals from KV, checks `eligible_coins:v1`, sizes position against configurable max notional per coin, fires market order.
- Position tracking in `live_trades` Supabase table (entry price, size, signal_id FK, stop level, target level, status).
- Dashboard panel: live open positions, closed trade log, running PnL vs paper trader benchmark.

Kill condition: if live trading produces drawdown exceeding the paper trader's 30% Phase 3 limit, halt execution, revert to paper mode, and diagnose before resuming.

---

## Critical files to be modified

| Area | File |
|---|---|
| Signal + timing | lib/signal-lab.ts (timing is in app/api/refresh-cohort/route.ts, no separate signal-timing.ts file) |
| Scoring | lib/cohort-engine.ts, lib/leverage-risk.ts (new) |
| EV + costs | lib/risk-engine.ts, lib/signal-learning-utils.ts |
| Ingest | lib/hyperliquid-api-client.ts, lib/ws-ingest.ts (R21) |
| Profiling | lib/wallet-profile.ts, lib/entity-classifier.ts (new), lib/fade-detector.ts (new) |
| Scan | scripts/daily-wallet-scan.ts |
| Outcomes | scripts/signal-learning.ts, scripts/rank-ic.ts, lib/atr.ts |
| Paper trading | lib/paper-trader.ts (new), scripts/paper-trader-cron.ts (new) |
| Capacity | lib/capacity-model.ts (new) |
| API | app/api/refresh-cohort/route.ts, app/api/cohort-state/route.ts |
| UI | app/signals/performance/PerformanceClient.tsx |
| Execution | lib/execution-client.ts (new), scripts/execution-cron.ts (new) |
| Workflows | .github/workflows/rank-ic.yml |

## Migrations (correct next numbers)

016_multi_window_and_oocv.sql, 017_ev_decouple.sql, 018_shadow_scoring.sql, 019_entity_classify.sql, 020_adverse_selection.sql, 021_paper_trader.sql.
