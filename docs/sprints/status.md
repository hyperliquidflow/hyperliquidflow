# Sprint Status

Update this file whenever a sprint starts, progresses, or completes.
At the start of each session, read this file to know where to pick up.

## Active Sprint

**Recovery Phase 2: Prove or Kill (2026-08-08 audit)**  
Status: ACTIVE, started 2026-08-09. This phase is mostly waiting plus a weekly
review. No code work is required to progress it.

Phases 0 and 1 are COMPLETE and verified in production (2026-08-08/09):
- Phase 0 resurrected the pipelines: all 5 workflows active, keepalive prevents
  the 60-day auto-disable that killed everything in June, UptimeRobot drives a
  5-minute heartbeat, migrations 020 and 021 applied.
- Phase 1 made outcomes measurable: outcomes priced from candles at true
  horizons, per-outcome grading (the old quorum could never open), calibration
  wired nightly, recipes cut 15 to 6, 312 tests including first-ever signal-lab
  and V1 scoring coverage, UI states real data age everywhere.
- **Grading loop verified working 2026-08-09**: signal_outcomes carries real
  is_win, net_pnl_bps, exit_reason. That was 0 for the project's entire history.
- **momentum_stack fired for the first time ever** after the cadence-aware
  window fix. It had no record of firing in 4 months.

**Grading loop rebuilt 2026-08-10** (branch `fix/grading-loop-correctness`,
migration 022). The 2026-08-09 "grading loop verified working" note above was
premature: rows were being written, but every one recorded a 1h time exit
because the simulator broke out of its snapshot loop on the first non-null
price. Stops and targets could only ever trigger at the 1h mark. Regrading
moved measured expectancy from +2.5 bps to -97.4 bps at an unchanged 48.1% win
rate. Grading now walks the hourly candle path, uses point-in-time ATR, and
charges slippage and funding. Recipe headline stats are withheld below 30
graded outcomes, so the Performance page shows a sample count and nothing else
until the sample is real.

Still open from the same audit, in priority order:
1. **Signal supply.** 33 signals in the 30 days to 2026-08-09, zero on 25 of
   those days. The cohort sits at 59 to 75 active wallets and shrinks intraday.
   No amount of grading fixes a sample this thin.
2. **No benchmark leg.** A LONG that makes 200 bps in a market that ran 180 bps
   is beta, not edge. Every outcome needs a paired counterfactual before any
   expectancy number means anything.
3. **Correlated signals counted as independent.** 71 of the ungraded rows are
   KAITO LONGs from one recipe over a few hours. That is one trade idea, not 71
   samples, and it makes every confidence interval far too narrow.

### Weekly review checklist (the whole job this phase)

1. Rank IC: needs 30 daily measurements, then compare median against MDIC 0.08.
   `select count(*), round(avg(rank_ic)::numeric,4) from rank_ic_history;`
2. Per recipe: at 30+ graded outcomes each, compute win_rate_net and expectancy.
   Positive expectancy survives, anything else is deleted, not tuned.
   `select recipe_id, count(*), round(avg(net_pnl_bps)::numeric,1) from signal_outcomes where is_win is not null group by 1;`
3. funding_divergence: suspended from the feed, still recording. Reinstate only
   at 30 graded outcomes with non-negative expectancy, otherwise cut it. It is
   currently producing most signal volume, so watch it closely.
4. R13 V2 canary: decide at 30 shadow measurements, cut over or delete V2.
   Counting starts 2026-08-11, not earlier. Phase 10b never wrote a single
   shadow score: its upsert omitted wallets.address (NOT NULL, no default), so
   Postgres rejected every chunk with 23502 and the error was swallowed by a
   console.error. Fixed 2026-08-10. Verify the next nightly scan leaves
   overall_score_shadow non-null, then expect the gate around 2026-09-10.
5. Cohort size: G10 was raised 15x to 25x on 2026-08-09, which should lift the
   cohort well above 77 on the next nightly scan. Verify it did.

Caveat for early data: outcomes created before 2026-08-09 were priced under the
old broken horizon logic (price_4h held a ~25h price). Treat their magnitudes as
indicative only.

Plan (Phase 0): `docs/superpowers/plans/2026-08-08-phase0-clean-house-and-resurrection.md`  
Plan (Phase 1): `docs/superpowers/plans/2026-08-08-phase1-measurable-outcomes.md`  
Roadmap: `docs/superpowers/specs/2026-08-08-rebuild-roadmap.md`  
Full audit: `docs/audit/2026-08-08-full-audit.md`

The 2026-08-08 audit found the entire measurement layer dead or never-connected:
all 4 GitHub workflows disabled since 2026-06-22 (60-day inactivity), rank IC at
0 rows ever (phantom column), the heartbeat (cron-job.org) dead since ~Jul 16,
cohort melted 493 to 58, learning loop structurally deadlocked. Sprint 6 (Auth)
and Sprint 7 (UI revision) are deferred until the roadmap's Phase 2 produces a
prove-or-kill verdict. Sprint 8's data gate was found never met (retention had
wiped the outcomes); it is superseded by the roadmap. Sprint 2 (Bias Trend) is
marked COMPLETE below but its feature branch was never merged; it survives on
`feature/sprint-2-bias-trend`.

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
| R28 | Telegram ops bot | COMPLETE (2026-08-08) | 5 read-only commands, transition-based alerts (alert once, recover once), nightly scan digest. Spec: `2026-08-08-telegram-ops-bot-design.md`. Blocked on owner setup: `CRON_SECRET` must be added to GitHub repo secrets or the watchdog 401s every run |

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
- **measure-outcomes horizon mismatch (RESOLVED 2026-04-22)** (`app/api/measure-outcomes/route.ts`): prior 26h horizon filter combined with a daily cron dropped ~97% of outcomes (rows aged 26 to 48h between runs were permanently excluded). Only 45 of 1807 rows resolved. Fix: widened horizon to 72h and ran `scripts/backfill-signal-outcomes.ts` to sweep orphaned rows using `candleSnapshot` for historical prices. Post-backfill: 1719 resolved. Sprint 8 outcomes gate (100+) cleared; calendar gate (30 days of signal_outcomes history) remaining (~2026-05-17).

---

## How to Start a Sprint

1. Read this file to confirm which sprint is active
2. Read the spec doc for that sprint
3. Read the plan doc (once generated) for step-by-step tasks
4. Update "Last worked on" date above when you begin
5. Mark sprint COMPLETE here when all acceptance criteria pass
