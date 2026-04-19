-- supabase/migrations/013_leverage_and_attrition.sql
-- Sprint 8: leverage capture + cohort attrition tracking.
-- Adds leverage columns to wallets and user_pnl_backtest.
-- Adds cohort_attrition table for anti-survivorship mortality curve.
-- NOTE: max/avg leverage computed from available cohort_snapshots (2 rows
-- retained per wallet). "_60d" suffix is aspirational; empirical window
-- expands when more history is retained. Thresholds re-fit in Sprint 13.

-- ── Leverage columns on wallets ───────────────────────────────────────────────
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS max_leverage_60d    NUMERIC(8, 2);
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS avg_leverage_60d    NUMERIC(8, 2);
-- PnL normalized by (1 + avg_leverage): levels the field between high- and low-leverage traders
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS leverage_adj_return NUMERIC(20, 6);
-- Proximity to blow-up: clamp(1 - max_leverage_60d / 15, 0, 1). Re-fit empirically in Sprint 13.
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS blow_up_distance    NUMERIC(8, 5);

-- ── Leverage columns on user_pnl_backtest ────────────────────────────────────
ALTER TABLE user_pnl_backtest ADD COLUMN IF NOT EXISTS max_leverage_day NUMERIC(8, 2);
ALTER TABLE user_pnl_backtest ADD COLUMN IF NOT EXISTS avg_leverage_day NUMERIC(8, 2);

-- ── cohort_attrition ──────────────────────────────────────────────────────────
-- One row per wallet that has ever entered the active cohort.
-- Survival states at standard horizons let us plot honest mortality curves.
-- state values:
--   active               = wallet survived to and through this milestone
--   deactivated_drawdown = removed due to drawdown or low equity
--   deactivated_inactivity = removed due to inactivity or going quiet
--   deactivated_wash     = removed for wash trading or sybil detection
--   blown_up             = liquidated or max-leverage gate triggered
--   never_reached        = too early to measure (first_active_date + N days > today)
CREATE TABLE IF NOT EXISTS cohort_attrition (
  wallet_address    TEXT        PRIMARY KEY REFERENCES wallets(address) ON DELETE CASCADE,
  wallet_id         UUID        REFERENCES wallets(id) ON DELETE SET NULL,
  first_active_date DATE        NOT NULL,
  last_seen_active  DATE,
  realized_drawdown NUMERIC(8, 5),
  state_30d         TEXT        CHECK (state_30d  IN ('active','deactivated_drawdown','deactivated_inactivity','deactivated_wash','blown_up','never_reached')),
  state_90d         TEXT        CHECK (state_90d  IN ('active','deactivated_drawdown','deactivated_inactivity','deactivated_wash','blown_up','never_reached')),
  state_180d        TEXT        CHECK (state_180d IN ('active','deactivated_drawdown','deactivated_inactivity','deactivated_wash','blown_up','never_reached')),
  state_360d        TEXT        CHECK (state_360d IN ('active','deactivated_drawdown','deactivated_inactivity','deactivated_wash','blown_up','never_reached')),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attrition_first_active
  ON cohort_attrition (first_active_date DESC);
CREATE INDEX IF NOT EXISTS idx_attrition_state_30d
  ON cohort_attrition (state_30d) WHERE state_30d != 'never_reached';
