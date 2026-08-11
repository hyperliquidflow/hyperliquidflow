-- 025_empirical_exit_structure.sql
--
-- Exit multiples retuned from a path simulation over 2,808 random entries on
-- conviction-gate coins (scripts/exit-structure-analysis.ts): the original
-- 2 ATR stop / 3 ATR target timed out 74% of trades and reached its target
-- 6.9% of the time, so the 3:2 payoff its breakeven math assumed never paid.
-- The shipped structure is now 1 ATR / 1 ATR: 84% of trades resolve at the
-- levels and outcome variance drops from sd 285 bps to 195, which roughly
-- halves the samples needed to detect a given edge.
--
-- Each graded row now records the multiples that graded it, so rows graded
-- under different exit regimes can never be silently mixed again.

ALTER TABLE signal_outcomes
  ADD COLUMN IF NOT EXISTS stop_atr   NUMERIC,
  ADD COLUMN IF NOT EXISTS target_atr NUMERIC;

COMMENT ON COLUMN signal_outcomes.stop_atr IS
  'Stop distance in ATR multiples used when this row was graded.';
COMMENT ON COLUMN signal_outcomes.target_atr IS
  'Target distance in ATR multiples used when this row was graded.';

-- Regrade everything under the new structure. Mixing exit regimes in one table
-- is exactly what the provenance columns exist to prevent.
UPDATE signal_outcomes
SET entry_price = NULL, exit_price = NULL, exit_reason = NULL,
    hold_hours = NULL, cost_bps = NULL, gross_pnl_bps = NULL,
    net_pnl_bps = NULL, realized_r_multiple = NULL, is_win = NULL,
    benchmark_bps = NULL, alpha_bps = NULL, beta = NULL
WHERE exit_reason IS NOT NULL AND exit_reason <> 'no_data';
