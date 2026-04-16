-- supabase/migrations/008_recipe_calibration.sql
-- Recipe calibration: threshold updates + token tier multiplier params.
-- Run AFTER 007_signal_outcomes.sql.

-- ── Threshold updates ─────────────────────────────────────────────────────────
-- momentum_stack MIN_WALLETS stays at 3 (no change)
UPDATE agent_config SET param_value = 3    WHERE recipe_id = 'streak_continuation' AND param_name = 'MIN_STREAK';
UPDATE agent_config SET param_value = 0.20 WHERE recipe_id = 'anti_whale_trap'    AND param_name = 'REDUCTION_PCT';

-- ── Token tier multipliers ────────────────────────────────────────────────────
-- LARGE tier = 50% of base, SMALL tier = 20% of base.
-- Applied in: momentum_stack, divergence_squeeze, liq_rebound, wallet_churn.
INSERT INTO agent_config (recipe_id, param_name, param_value) VALUES
  ('momentum_stack',     'NOTIONAL_LARGE_MULT',  0.5),
  ('momentum_stack',     'NOTIONAL_SMALL_MULT',  0.2),
  ('divergence_squeeze', 'NOTIONAL_LARGE_MULT',  0.5),
  ('divergence_squeeze', 'NOTIONAL_SMALL_MULT',  0.2),
  ('liq_rebound',        'MIN_BEFORE_NOTIONAL',  1000000),
  ('liq_rebound',        'NOTIONAL_LARGE_MULT',  0.5),
  ('liq_rebound',        'NOTIONAL_SMALL_MULT',  0.2),
  ('wallet_churn',       'WALLET_THRESHOLD',      3),
  ('wallet_churn',       'COMBINED_NOTIONAL',     500000),
  ('wallet_churn',       'WINDOW_MS',             300000),
  ('wallet_churn',       'NOTIONAL_LARGE_MULT',  0.5),
  ('wallet_churn',       'NOTIONAL_SMALL_MULT',  0.2)
ON CONFLICT DO NOTHING;
