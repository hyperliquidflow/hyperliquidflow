# Sprint Status

Update this file whenever a sprint starts, progresses, or completes.
At the start of each session, read this file to know where to pick up.

## Active Sprint

**Sprint 6 — Auth System**  
Status: NOT STARTED  
Spec: `docs/superpowers/specs/2026-04-13-sprint-6-auth.md`  
Plan: not yet  
Last worked on: n/a

---

## All Sprints

| # | Name | Status | Spec | Plan |
|---|---|---|---|---|
| 1 | Wallet Tier System | COMPLETE | [spec](../superpowers/specs/2026-04-13-sprint-1-wallet-tiers.md) | [plan](../superpowers/plans/2026-04-13-sprint-1-wallet-tiers.md) |
| 2 | Bias Trend Chart | COMPLETE | [spec](../superpowers/specs/2026-04-13-sprint-2-bias-trend.md) | [plan](../superpowers/plans/2026-04-14-sprint-2-bias-trend.md) |
| 3 | Global Position Heatmap | COMPLETE | [spec](../superpowers/specs/2026-04-13-sprint-3-heatmap.md) | pending |
| 4 | Market Radar | COMPLETE | [spec](../superpowers/specs/2026-04-13-sprint-4-market-radar.md) | [plan](../superpowers/plans/2026-04-17-sprint-4-market-radar.md) |
| 5 | Wallet Alerts + Paper Copy Trading | COMPLETE (2026-04-19) | [spec](../superpowers/specs/2026-04-13-sprint-5-alerts-paper-trading.md) | [plan](../superpowers/plans/2026-04-19-sprint-5-wallet-alerts-paper-trading.md) |
| 6 | Auth System | PLANNED (future) | [spec](../superpowers/specs/2026-04-13-sprint-6-auth.md) | not yet |
| 7 | UI Design + Integration Revision | PLANNED (after 4/5/6) | [spec](../superpowers/specs/2026-04-16-sprint-7-ui-revision.md) | not yet |
| 8 | Signal Intelligence Agent | BLOCKED (data gate: 100+ signal_outcomes, 30d history) | [spec](../superpowers/specs/2026-04-15-signal-intelligence-agent-design.md) | not yet |

---

## Signal Pipeline Streams (parallel to sprints)

Waterproof wallet selection system — 6 independent streams (A-F).

| Stream | Name | Status | Spec |
|---|---|---|---|
| A | Cohort Quality (activation gate) | COMPLETE (2026-04-18) | [spec](../superpowers/specs/2026-04-17-stream-a-cohort-quality.md) |
| B | Realtime Hygiene (live blow-up deactivation) | COMPLETE (2026-04-18) | [spec](../superpowers/specs/2026-04-18-stream-b-realtime-hygiene.md) | [plan](../superpowers/plans/2026-04-18-stream-b-realtime-hygiene.md) |
| C | Wash / Sybil Detection | COMPLETE (2026-04-18) | [spec](../superpowers/specs/2026-04-18-stream-c-wash-sybil.md) | [plan](../superpowers/plans/2026-04-18-stream-c-wash-sybil.md) |
| D | Per-Wallet Behavior Profile | COMPLETE (2026-04-18) | [spec](../superpowers/specs/2026-04-18-stream-d-behavior-profile.md) | [plan](../superpowers/plans/2026-04-18-stream-d-behavior-profile.md) |
| E | Signal Validation Feedback | COMPLETE (2026-04-18) | [spec](../superpowers/specs/2026-04-18-stream-e-signal-validation.md) |
| F | Dashboard Truth | COMPLETE (2026-04-18) | [spec](../superpowers/specs/2026-04-18-stream-f-dashboard-truth.md) |

**Stream A results (2026-04-18 scan):** 4496 discovered → 2263 scored → 493 activated (62% reduction from prior ~1285 baseline). Duration 40.3 min, under 50-min budget. Rejection breakdown firing all 9 gate categories.

---

## Remediation Plan Sprints (from .claude/plans/hyperliquidflow-remediation-and-kind-grove.md)

Separate sprint numbering from the product sprints above.

| # | Name | Status | Notes |
|---|---|---|---|
| R7 | Signal-to-entry latency capture | COMPLETE (2026-04-19) | migration 012, signal_timing table, SignalLabResult, freshness API + Overview stat card |
| R8 | Leverage capture + cohort attrition | COMPLETE (2026-04-19) | migration 013, computeLeverageStats, upsertAttritionStates, G10 gate, blow_up_distance |
| R9 | Rank IC measurement | COMPLETE (2026-04-19) | migration 014, wallet_score_history, rank_ic_history, rank-ic.ts, rank-ic.yml, /performance/ranking page, Overview IC badge |
| R10 | Outcome measurement overhaul | COMPLETE (2026-04-19) | migration 015, lib/atr.ts, simulateAtrExit, signal-learning rewrite, recipe_performance net PnL fields |
| R11 | Multi-window selection + OOCV | COMPLETE (2026-04-19) | migration 016, G11/G12/G13 gates, Phase 12/13 in daily-wallet-scan.ts, OOCV rank-ic comparison |
| R12 | EV decouple | COMPLETE (2026-04-19) | migration 017, recipe_calibration + wallet_signal_stats tables, wallet-signal-stats.ts nightly script, Bayesian blend (70/30) in enrichWithEv |
| R13 | Empirically-fit leverage-adjusted scoring | COMPLETE (2026-04-21) | migration 018, lib/leverage-risk.ts, computeCohortScoresV2, Phase 10b shadow scoring, rank_ic_shadow tracking |
| R14-R24 | Phases 2-4 (remainder) | PLANNED | |
| R25 | Audit remediation (Phases 1 to 4) | COMPLETE (2026-04-21) | migrations 019, 020, cron auth hardening, indexes, tokens, eslint CLI migration |
| R26+ | Phase 5: automated execution | GATED on Phase 3 | |

### R13 Canary Cutover Gate

R13 runs V1 and V2 scores in parallel for 30 days via shadow columns. Cutover decision criteria:
- `rank_ic_shadow` median >= `rank_ic` median - 0.02 over 30 measurements
- Check daily in `rank-ic.ts` gate summary logs
- If criteria met: replace `computeCohortScores` calls with `computeCohortScoresV2` in `scripts/daily-wallet-scan.ts`, drop shadow columns from writes, update migration to rename or backfill
- If criteria fail: revert shadow scoring, investigate formula gaps before R14

Scripts / fit:
- `scripts/fit-leverage-penalty.ts` -- re-run after 90+ blow-up events to re-fit penalty params

### Known Gaps (deferred, non-blocking)

- **first_poll_ts backfill gap** (`app/api/cohort-state/route.ts`): backfill only fires on primary KV hit path. Fallback and KV-miss paths skip it. Latency stats are slightly undercounted on rare misses. Fix when Sprint R10 touches outcome measurement.
- **user_pnl_backtest partial upsert** (`scripts/daily-wallet-scan.ts` `computeLeverageStats`): upsert sends only `wallet_id + leverage columns`. Harmless while active wallets always have backtest rows. Would break if a wallet had no prior backtest row. Resolved in R13 -- no schema change was needed; note remains in case backtest schema changes later.
- **R13 shadow IC early cohort size** (`scripts/daily-wallet-scan.ts` Phase 10b, `scripts/rank-ic.ts`): Phase 10b only writes `overall_score_shadow` for wallets with `max_leverage_60d` populated. For the first few weeks of canary, shadow IC is measured on a smaller cohort than V1 IC. This self-corrects as leverage data fills in. Do not interpret early shadow IC volatility as formula weakness.
- **R13 shadow regime_fit approximation** (`scripts/daily-wallet-scan.ts` Phase 10b): shadow scores use `regime_fit = 0.5` (neutral) because the daily scan lacks live clearinghouse state. This is consistent across all shadow IC measurements. Production V2 scores (post-cutover) will use real regime_fit from the cron context.

---

## How to Start a Sprint

1. Read this file to confirm which sprint is active
2. Read the spec doc for that sprint
3. Read the plan doc (once generated) for step-by-step tasks
4. Update "Last worked on" date above when you begin
5. Mark sprint COMPLETE here when all acceptance criteria pass
