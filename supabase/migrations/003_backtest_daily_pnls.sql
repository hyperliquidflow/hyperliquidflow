-- supabase/migrations/003_backtest_daily_pnls.sql
-- Adds daily_pnls array to user_pnl_backtest so the real-time cron
-- can read actual per-day PnL instead of scoring on zeros.
-- Run AFTER 002_wallet_metrics.sql.

ALTER TABLE user_pnl_backtest
  ADD COLUMN IF NOT EXISTS daily_pnls JSONB NOT NULL DEFAULT '[]';
