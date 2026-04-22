-- supabase/migrations/019_enable_rls.sql
-- Default-deny RLS across all application tables.
-- Server code uses SUPABASE_SERVICE_ROLE_KEY (bypasses RLS) and is unaffected.
-- Anon-key callers (browser) see zero rows unless an explicit policy grants access.

ALTER TABLE wallets                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE cohort_snapshots         ENABLE ROW LEVEL SECURITY;
ALTER TABLE signals_history          ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_pnl_backtest        ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_performance       ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limit_tokens        ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_events            ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_outcomes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_config             ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_config_history     ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_findings           ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_log                ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_timing            ENABLE ROW LEVEL SECURITY;
ALTER TABLE cohort_attrition         ENABLE ROW LEVEL SECURITY;
ALTER TABLE out_of_cohort_tracking   ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_calibration       ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_signal_stats      ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_score_history     ENABLE ROW LEVEL SECURITY;
ALTER TABLE rank_ic_history          ENABLE ROW LEVEL SECURITY;

-- No policies created = default deny for all non-service-role roles.
