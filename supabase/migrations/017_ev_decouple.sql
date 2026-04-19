-- supabase/migrations/017_ev_decouple.sql
-- Sprint R12: EV decouple -- breaks circularity between wallet score and EV score.
--
-- Problem: enrichWithEv previously used the signaling wallet's own backtest
-- win_rate as win_probability. Wallets with high scores (high win_rate) got
-- higher EV scores, which inflated their ranking further. Pearson(ev_score,
-- wallet.score) was ~0.8.
--
-- Fix: Bayesian blend -- recipe base rate weighted 70%, wallet adjustment 30%.
-- recipe_calibration holds the recipe-level base rates sourced (eventually) from
-- the OOCV pool; wallet_signal_stats holds per-wallet per-recipe net win rates for
-- the wallet-specific 30% adjustment.

-- ── recipe_calibration ────────────────────────────────────────────────────────
-- Per-recipe aggregated calibration sourced from signal_outcomes.
-- Populated nightly by scripts/wallet-signal-stats.ts.
--
-- win_rate: fraction of resolved outcomes with net_pnl_bps > 0
-- avg_win_bps / avg_loss_bps: signed average returns on winning / losing trades
-- sample_size_30d: resolved outcome count in the past 30 days
-- confidence_interval_low / high: 95% Wilson CI on win_rate
-- source: "in_cohort" until OOCV position tracking is wired (Sprint R12+); will
--   switch to "oocv" once OOCV sample size reaches 30+ resolved outcomes per recipe.

CREATE TABLE IF NOT EXISTS recipe_calibration (
  recipe_id               TEXT        PRIMARY KEY,
  win_rate                NUMERIC(6,4),
  avg_win_bps             NUMERIC(10,2),
  avg_loss_bps            NUMERIC(10,2),
  sample_size_30d         INTEGER,
  confidence_interval_low  NUMERIC(6,4),
  confidence_interval_high NUMERIC(6,4),
  source                  TEXT        NOT NULL DEFAULT 'in_cohort',
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE recipe_calibration
    ADD CONSTRAINT recipe_calibration_source_check
      CHECK (source IN ('in_cohort', 'oocv', 'blended'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_recipe_calibration_updated
  ON recipe_calibration (updated_at DESC);

-- ── wallet_signal_stats ───────────────────────────────────────────────────────
-- Per-wallet, per-recipe win statistics for the 30% wallet adjustment.
-- PK on (wallet_address, recipe_id, window_days) so multiple lookback windows
-- can coexist (30d default for now; longer windows added as data accumulates).
-- Populated nightly by scripts/wallet-signal-stats.ts.

CREATE TABLE IF NOT EXISTS wallet_signal_stats (
  wallet_address TEXT        NOT NULL,
  recipe_id      TEXT        NOT NULL,
  window_days    INTEGER     NOT NULL,
  win_rate_net   NUMERIC(6,4),
  signal_count   INTEGER,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (wallet_address, recipe_id, window_days)
);

CREATE INDEX IF NOT EXISTS idx_wallet_signal_stats_address
  ON wallet_signal_stats (wallet_address);

CREATE INDEX IF NOT EXISTS idx_wallet_signal_stats_recipe
  ON wallet_signal_stats (recipe_id, window_days);
