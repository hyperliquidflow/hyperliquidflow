-- supabase/migrations/015_outcome_overhaul.sql
-- Sprint R10: ATR-based outcome simulation fields on signal_outcomes,
-- and net PnL aggregate columns on recipe_performance.

-- ── signal_outcomes: ATR exit simulation ─────────────────────────────────────
-- entry_price: price_at_signal (may be latency-adjusted in Sprint 21)
-- exit_price / exit_reason: first ATR rule that fired (stop / target / time_*)
-- gross_pnl_bps: raw PnL in basis points before fees
-- net_pnl_bps: after ROUND_TRIP_FEE_BPS (set to 10 bps by signal-learning.ts)
-- realized_r_multiple: gross pnl as a multiple of the 2-ATR risk unit
-- latency_at_measurement_ms: from signal_timing.total_latency_ms at measurement time
-- is_win: true when net_pnl_bps > 0 (replaces legacy price_win / outcome_4h binary)

ALTER TABLE signal_outcomes
  ADD COLUMN IF NOT EXISTS entry_price               NUMERIC(20,6),
  ADD COLUMN IF NOT EXISTS exit_price                NUMERIC(20,6),
  ADD COLUMN IF NOT EXISTS exit_reason               TEXT,
  ADD COLUMN IF NOT EXISTS gross_pnl_bps             NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS net_pnl_bps               NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS realized_r_multiple       NUMERIC(8,4),
  ADD COLUMN IF NOT EXISTS latency_at_measurement_ms INTEGER,
  ADD COLUMN IF NOT EXISTS is_win                    BOOLEAN;

DO $$ BEGIN
  ALTER TABLE signal_outcomes
    ADD CONSTRAINT signal_outcomes_exit_reason_check
      CHECK (exit_reason IN ('stop','target','time_1h','time_4h','time_24h') OR exit_reason IS NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_signal_outcomes_exit_pending
  ON signal_outcomes (created_at)
  WHERE resolved_at IS NOT NULL AND exit_reason IS NULL;

-- ── recipe_performance: net PnL aggregates ────────────────────────────────────
-- Written by scripts/signal-learning.ts nightly once ATR exit data accumulates.
-- median_net_pnl_bps: median of net_pnl_bps across all resolved trades
-- win_rate_net: fraction of resolved trades with net_pnl_bps > 0
-- expectancy_bps_net: average net_pnl_bps across all resolved trades (EV)
-- sample_size_60d: resolved outcome count in the past 60 days

ALTER TABLE recipe_performance
  ADD COLUMN IF NOT EXISTS median_net_pnl_bps  NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS win_rate_net        NUMERIC(6,4),
  ADD COLUMN IF NOT EXISTS expectancy_bps_net  NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS sample_size_60d     INTEGER;
