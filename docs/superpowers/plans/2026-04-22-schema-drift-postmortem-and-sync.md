# Schema-drift postmortem and sync plan

**Date:** 2026-04-22
**Context:** Discovered during R25 (audit remediation) push-to-prod. Migration 019 (RLS) targeted tables that don't exist in prod because migrations 011 through 017 were never applied to the production Supabase project `qcedbargzizmayvimstg`.

---

## What went wrong

**Observed state (prod DB):**
- Only 12 tables exist. Missing: `wallet_profiles`, `signal_timing`, `cohort_attrition`, `wallet_score_history`, `rank_ic_history`, `out_of_cohort_tracking`, `recipe_calibration`, `wallet_signal_stats`.
- `supabase_migrations.schema_migrations` is empty (zero rows).
- Leverage columns on `wallets` (migration 013), regime columns on `user_pnl_backtest` (016), shadow columns (018) are absent.

**Impact window:** Roughly 2026-04-19 (R7 ship date) through today, 2026-04-22. About three days of nightly scans wrote to tables that don't exist.

**Features silently broken in prod despite status showing "COMPLETE":**
- R7 signal timing (latency chart on Overview)
- R8 leverage capture and cohort attrition
- R9 rank IC measurement (the /performance/ranking page shows "insufficient data" because no rows ever wrote, not because time hasn't passed)
- R10 outcome overhaul (migration 015 ran but the updated columns may be partial, needs verification)
- R11 multi-window and OOCV
- R12 EV decouple (Bayesian blend reads calibration rows that don't exist)
- R13 leverage-adjusted scoring shadow (shadow columns don't exist, so the cutover gate has been reading nulls)

## Root cause

1. **No migration automation.** `.github/workflows/` contains daily-scan, freshness-check, rank-ic, signal-learning. Zero migration-apply job. No `supabase db push` anywhere. No Vercel build hook. Migrations apply by humans pasting SQL into the Supabase dashboard.
2. **No version tracking.** `supabase_migrations.schema_migrations` is empty. Supabase's own migration bookkeeping table was never populated, so there's nothing to diff against the `supabase/migrations/` folder.
3. **Soft-fail writes mask drift.** `daily-wallet-scan.ts` uses `.insert().upsert()` and logs errors but does not fail the job when Supabase returns `42P01 relation does not exist`. The nightly job kept reporting "success" while writing to nothing.
4. **Freshness check is the wrong signal.** `freshness-check.yml` verifies `/api/cohort-state.updated_at` is fresh. That only covers the KV cache, not the downstream tables the scan writes to. Schema drift hides from this check entirely.
5. **"COMPLETE" in status.md means "code merged."** Sprints were marked done on PR merge, not on "observed rows flowing in prod for 24h." Without that gate, silent failures accumulate as "green" status.
6. **No `supabase/config.toml`.** The repo isn't linked to the Supabase CLI. There's no canonical dev-to-prod workflow documented anywhere.

## Prevention

Five fixes, ranked by leverage:

### 1. Automate migrations via CI (highest leverage)

Add `.github/workflows/db-migrate.yml` that runs `supabase db push` on every merge to main. Requires:
- `supabase/config.toml` with project ref
- `SUPABASE_DB_PASSWORD` and `SUPABASE_ACCESS_TOKEN` as GitHub secrets
- One-time backfill: mark 001 through 019 as applied in `schema_migrations` so the CLI doesn't try to re-run them

This alone eliminates future drift.

### 2. Hard-fail the nightly scan on Supabase errors

In `scripts/daily-wallet-scan.ts`, treat `PostgrestError` with code `42P01` (relation missing) or `42703` (column missing) as fatal. Currently these log and continue; flip them to `throw`.

This converts silent drift into an alert on the next scan run.

### 3. Row-count smoke test in workflow

Extend `signal-learning.yml` or add a new `schema-health.yml` that runs every 6 hours and checks:
- `wallet_score_history` has at least one row dated in the last 25h (R9)
- `signal_timing` has at least one row dated in the last 25h (R7)
- `recipe_calibration` has at least one row updated in the last 25h (R12)

Fail the workflow if any check fails. GitHub emails repo admins.

### 4. Tighten status.md semantics

Add a column `VERIFIED_IN_PROD` to the sprint table. A sprint is not "COMPLETE" until:
- Code merged to main
- Migration applied to prod (verifiable in `schema_migrations`)
- Target table has non-zero rows after the first nightly run

Until then, the sprint sits in `CODE_MERGED` state.

### 5. Onboarding doc

Add `docs/supabase-migrations.md` covering: local dev with `supabase start`, creating a new migration with `supabase migration new`, and how the CI auto-push works. Pin it in CLAUDE.md.

---

## Catch-up sprint (R26)

Sequentially apply missing migrations on prod with a verification gate between each. All migrations use `IF NOT EXISTS`, so re-applying is safe.

### Preflight

- [ ] Confirm `pg_cron` extension availability on the Supabase project (migration 014 depends on it via `cron.schedule`). If disabled, enable it in the Supabase dashboard or strip the cron block from 014 before running.
- [ ] Backup: take a Supabase PITR snapshot or logical dump before the first migration.
- [ ] Stop the nightly `daily-wallet-scan.yml` workflow for the duration (one click in GitHub Actions).

### Sequenced migrations

Apply via `mcp__supabase-mcp__apply_migration` one at a time. After each, run the verification SELECT and confirm row/column exists before moving on.

| Order | Migration | Creates or adds | Verify |
|---|---|---|---|
| 1 | 011_wallet_profiles | `wallet_profiles` table | `SELECT 1 FROM pg_tables WHERE tablename='wallet_profiles'` |
| 2 | 012_signal_timing | `signal_timing` table | same pattern |
| 3 | 013_leverage_and_attrition | leverage cols on `wallets`+`user_pnl_backtest`, `cohort_attrition` table | check column + table |
| 4 | 014_rank_ic | `wallet_score_history`, `rank_ic_history` tables, pg_cron cleanup job | check tables, check `cron.job` row |
| 5 | 015_outcome_overhaul | (verify current state first; this one may be partially applied) | diff against migration SQL before applying |
| 6 | 016_multi_window_and_oocv | score cols on wallets, `regime_at_day` on backtest, `out_of_cohort_tracking` table | check all three |
| 7 | 017_ev_decouple | `recipe_calibration`, `wallet_signal_stats` tables | check tables |
| 8 | 018_shadow_scoring | shadow columns on `wallets` | check columns |
| 9 | 019_enable_rls (from R25 branch) | RLS default-deny on all tables | `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public'` all true |

### Postflight

- [ ] Re-enable `daily-wallet-scan.yml`.
- [ ] Trigger one manual run of the scan. Tail the logs for no `42P01` or `42703` errors.
- [ ] 24h later: confirm non-zero row counts in the eight previously-missing tables.
- [ ] If all green, close R26 and update status.md: R7 through R13 move from "COMPLETE" to "VERIFIED_IN_PROD" with today's date.

### Estimated blast radius

Low per step, medium total. All migrations are additive. The real risk is that some features may interact poorly when their target tables suddenly start existing (e.g. the EV decouple reads from `recipe_calibration`; if it's empty, the Bayesian blend falls back to neutral, which is the desired degraded behavior, not a crash). Worth watching signal quality for 48h after R26 lands.

---

## Decision on R25 today

**Ship Option A.** Merge R25 code without migration 019. Set `CRON_SECRET` in Vercel prod. Queue R26 (this doc) as the next sprint.

Reasoning:
- R25's security, reliability, and UX wins (CRON_SECRET enforcement, query caps, safe localStorage, typed errors, token cleanup) are independent of RLS and ship cleanly today.
- Migration 019 is low-impact short-term because the server uses `SUPABASE_SERVICE_ROLE_KEY` which bypasses RLS anyway. The browser doesn't hit Supabase directly (everything goes through `/api/*`). No exposed surface gets better or worse by delaying 019 a week.
- The newly-discovered schema drift is a bigger problem than R25 and deserves its own careful sprint, not a rushed tack-on.
- Running 7 sequential migrations on prod right now, on top of a 23-commit merge, without preflight verification, is the wrong risk profile for "one click."
