-- supabase/migrations/016_multi_window_and_oocv.sql
-- Sprint R11: Multi-window selection + out-of-cohort validation set.
--
-- Adds three scoring windows (30d / 90d / 180d) to wallets so G11/G12 gates
-- can reject flash-performers and regime-sparse wallets.  Out-of-cohort
-- tracking (OOCV) gives a held-out control group for recipe base-rate
-- comparison (R12 will populate signal stats once OOCV position tracking
-- is wired in).

-- ── wallets: multi-window score columns ──────────────────────────────────────
-- score_30d / score_90d / score_180d: composite 4-factor score over each window.
--   Computed by Phase 12 of daily-wallet-scan.ts for every active wallet.
-- bull_days / bear_days / ranging_days: trading-day count per BTC regime bucket
--   over the 180d window. Used for G12 (regime_coverage) gate.
-- score_stability: max(score_30d, score_90d, score_180d) - min(...).
--   Gate G11 rejects wallets where this exceeds 0.25.

ALTER TABLE wallets
  ADD COLUMN IF NOT EXISTS score_30d        NUMERIC(6,4),
  ADD COLUMN IF NOT EXISTS score_90d        NUMERIC(6,4),
  ADD COLUMN IF NOT EXISTS score_180d       NUMERIC(6,4),
  ADD COLUMN IF NOT EXISTS bull_days        INTEGER,
  ADD COLUMN IF NOT EXISTS bear_days        INTEGER,
  ADD COLUMN IF NOT EXISTS ranging_days     INTEGER,
  ADD COLUMN IF NOT EXISTS score_stability  NUMERIC(6,4);

-- ── user_pnl_backtest: per-day regime labels ─────────────────────────────────
-- regime_at_day: JSONB array of "BULL"/"BEAR"/"RANGING" strings, aligned
--   index-for-index with the 180d daily PnL array. Populated by Phase 12
--   alongside the multi-window scores.  NULL until Phase 12 first runs.

ALTER TABLE user_pnl_backtest
  ADD COLUMN IF NOT EXISTS regime_at_day JSONB;

-- ── out_of_cohort_tracking ────────────────────────────────────────────────────
-- Holds the held-out OOCV set: wallets that pass basic liquidity gates but
-- are explicitly excluded from the active cohort.  Sampled by Phase 13 of
-- daily-wallet-scan.ts (stratified by rejection reason, target ~400 wallets).
--
-- Signals from these wallets are never served to users.  Their recipe base
-- rates are measured weekly in scripts/rank-ic.ts once OOCV position
-- tracking is enabled (Sprint R12).
--
-- basis: why/how this wallet was sampled ('stratified_random', etc.)
-- is_active_in_oocv: false once the wallet graduates into the active cohort
--   or is removed from the held-out set.

CREATE TABLE IF NOT EXISTS out_of_cohort_tracking (
  wallet_address    TEXT        PRIMARY KEY,
  wallet_id         UUID        REFERENCES wallets(id),
  added_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  basis             TEXT,
  is_active_in_oocv BOOLEAN     NOT NULL DEFAULT TRUE,
  removed_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_oocv_active
  ON out_of_cohort_tracking (is_active_in_oocv)
  WHERE is_active_in_oocv = TRUE;

CREATE INDEX IF NOT EXISTS idx_oocv_wallet_id
  ON out_of_cohort_tracking (wallet_id);
