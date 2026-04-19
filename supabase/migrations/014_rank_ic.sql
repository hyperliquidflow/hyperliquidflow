-- supabase/migrations/014_rank_ic.sql
-- Sprint R9: rank IC measurement infrastructure.
--
-- wallet_score_history: daily snapshot of active wallet scores + same-day PnL.
--   Written by Phase 11 of daily-wallet-scan.ts.
--   Used by scripts/rank-ic.ts to correlate scores at D with returns D+1..D+30.
--
-- rank_ic_history: one row per measurement date written by scripts/rank-ic.ts.
--   MDIC threshold = 0.08 (from docs/preflight/rank-ic-power.md).
--   Phase 1 kill: IC not statistically above MDIC after 30+ measurements -> halt Phase 2.

-- ── wallet_score_history ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wallet_score_history (
  date           DATE        NOT NULL,
  wallet_id      UUID        NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  overall_score  NUMERIC(6, 4),
  daily_pnl_usd  NUMERIC(20, 6),
  PRIMARY KEY (date, wallet_id)
);

CREATE INDEX IF NOT EXISTS idx_wsh_date    ON wallet_score_history (date DESC);
CREATE INDEX IF NOT EXISTS idx_wsh_wallet  ON wallet_score_history (wallet_id, date DESC);

-- Retain 90 days only (free-tier budget)
SELECT cron.schedule(
  'cleanup-score-history',
  '15 3 * * *',
  $$
    DELETE FROM wallet_score_history
    WHERE date < CURRENT_DATE - INTERVAL '90 days';
  $$
);

-- ── rank_ic_history ───────────────────────────────────────────────────────────
-- Spearman rank correlation: scores at measurement_date vs realized returns
-- over the following horizon_days (default 30).
--
-- effective_sample_size = cohort_size * 0.5 (conservative clustering adjustment;
-- re-fit after P0.1 power analysis completes in Sprint R13).
CREATE TABLE IF NOT EXISTS rank_ic_history (
  measurement_date        DATE        PRIMARY KEY,
  horizon_days            INTEGER     NOT NULL DEFAULT 30,
  cohort_size             INTEGER     NOT NULL,
  effective_sample_size   NUMERIC(8, 2),
  rank_ic                 NUMERIC(8, 4),
  p_value                 NUMERIC(8, 4),
  top_decile_hit_rate     NUMERIC(8, 4),
  bottom_decile_avoidance NUMERIC(8, 4),
  computed_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rank_ic_date ON rank_ic_history (measurement_date DESC);
