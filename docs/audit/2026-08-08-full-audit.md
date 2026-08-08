# HyperliquidFLOW Full Audit, 2026-08-08

**Audit head commit:** `81bd56c` (working tree identical to origin/main)
**Method:** ground-state forensics against live prod (Supabase project qcedbargzizmayvimstg, Vercel deployment, GitHub API), then 5 parallel verification agents over the code with file:line evidence (180 tool invocations). Full report published as a Claude artifact (owner has the link).
**Supersedes:** `2026-07-22-full-project-audit.md`, which reported `wallet_score_history` and `rank_ic_history` as "populated" without querying them (both had 0 rows), claimed the nightly scan was running (disabled a month earlier), and missed both pipeline deaths. Treat unverified claims in that document with suspicion; its code-level findings (sections 5-11) were largely re-verified and confirmed.

## Verdict

No measured edge exists, and none was ever measurable. In four months the system produced zero rank IC measurements, zero surviving graded signal outcomes, and zero recipe calibrations. The only surviving performance telemetry (a flawed ev-proxy metric) showed the busiest directional recipe (funding_divergence) at a median net loss of 316 bps per signal, and the flagship smart-money recipe (momentum_stack) has no record of ever firing. The machinery is well built; integration and observability failed, silently, in five specific places.

## The five root causes

1. **Phantom column (since 2026-04-19).** `scripts/daily-wallet-scan.ts` Phase 11 selected `wallets.overall_score`, a column that never existed in any migration (`overall_score` lives on `cohort_snapshots`). The PostgREST error was swallowed (`console.error` + `return {written: 0}`), the job stayed green for 64 runs. Result: `wallet_score_history` 0 rows ever, `rank_ic_history` 0 rows ever, R13 shadow canary never received a data point.
2. **GitHub disabled all 4 scheduled workflows on 2026-06-22** (60 days after the last commit, `disabled_inactivity`). The freshness watchdog was itself a scheduled workflow and died in the same event; auto-disable produces no failed run, so no email was sent. Cohort then melted 493 to 58 (cron-side hygiene pruning with zero scan inflow; prune floor is 4).
3. **The real 24/7 heartbeat was cron-job.org**, external and unversioned (in-repo 5-min ping workflow deleted 2026-04-18, commit `f73d8fd`). It died silently ~2026-07-16. Only the daily Vercel cron survived: one refresh per 24h, which structurally kills 3 recipes (300s pair windows, 900s KV TTL) and starves 7 more. Only the 3 funding-based recipes could still fire (~1 signal/week).
4. **Learning deadlock.** signal_outcomes retention was 30 days while the cold-start gate needed 100 outcomes AND 30 days of history (`signal-learning.ts:107`), requiring >3.3 signals/day to ever open. All 5 surviving outcome rows had `is_win = null` and could never be graded. Bonus defect: `measure-outcomes` filled `price_4h` with a ~25.4h price (single daily 02:00 pass), so even May's ~248 graded outcomes used mislabeled horizons.
5. **EV circularity.** `scripts/wallet-signal-stats.ts` (the R12 calibration filler) was never wired into any workflow despite its header claiming so; `recipe_calibration` and `wallet_signal_stats` had 0 rows ever, so `enrichWithEv` permanently fell back to backtest win_rate, the exact circularity R12 was built to remove. Cohort-level signals get no EV at all and were counted as losses by the intraday stats writer.

Cross-cutting: the UI fabricated health (permanent green "Monitoring" dot, pipeline card hardcoded "ok", "Outcome tracking is live" over a dead learning job, Supabase fallback stamping `updated_at = now` on day-old data).

## Component verdicts (summary)

- **KEEP:** hyperliquid-api-client, wash-sybil, design tokens + UI shell, rank IC page (honest empty state).
- **FIX:** scan Phase 11 + error handling, refresh cadence + heartbeat, measure-outcomes horizons, signal-learning gates, wallet-signal-stats wiring, cohort-hygiene inflow guard, freshness monitoring, all data pages (staleness honesty), signal-lab harness (tests, EV), env.ts (R27).
- **CUT:** signal_events table + dead readers, rate_limit_tokens, AlertBell, old /performance client, /signals/radar/designs, cron-job.org dependency, 9 of 15 recipes (position_aging, concentration_risk, funding_trend, streak_continuation, liq_rebound, wallet_churn, anti_whale_trap, bridge_inflow, twap_accumulation).
- **UNPROVEN (the point of the rebuild):** V1 scoring predictiveness, the 6 surviving recipes (momentum_stack, divergence_squeeze, accumulation_reentry, whale_validated, rotation_carry fixed, funding_divergence suspended), risk-engine EV math, paper trading as validation.

## Fix path

Phase 0 (resurrection + clean house): `docs/superpowers/plans/2026-08-08-phase0-clean-house-and-resurrection.md`
Phases 1-3 + market intelligence workstream: `docs/superpowers/specs/2026-08-08-rebuild-roadmap.md`

Organizing principle: minimum time to verdict. Rank IC needs ~30 daily measurements; recipes need ~30 graded outcomes each. "No edge exists" is an acceptable outcome; it ends the guessing.
