-- supabase/migrations/006_signal_intelligence.sql
-- Signal Intelligence Agent: 6 tables, required indexes, agent_config seed.
-- Run AFTER 005_entity_type.sql.

-- ── 1. signal_events ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS signal_events (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  signal_hash           TEXT UNIQUE NOT NULL,
  recipe_id             TEXT NOT NULL,
  coin                  TEXT NOT NULL,
  signal_type           TEXT NOT NULL,
  direction             TEXT,
  ev_score              FLOAT,
  wallet_ids            TEXT[] NOT NULL DEFAULT '{}',
  snapshot_time         TIMESTAMPTZ NOT NULL,
  fired_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  regime_at_fire        TEXT NOT NULL,
  btc_price_at_fire     FLOAT NOT NULL,
  funding_rate_at_fire  FLOAT,
  oi_at_fire            FLOAT,
  volume_24h_at_fire    FLOAT,
  active_config         JSONB NOT NULL DEFAULT '{}',
  metadata              JSONB
);

-- ── 2. signal_outcomes ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS signal_outcomes (
  signal_id             UUID PRIMARY KEY REFERENCES signal_events(id) ON DELETE CASCADE,
  price_at_fire         FLOAT NOT NULL,
  price_1h              FLOAT,
  price_4h              FLOAT,
  price_24h             FLOAT,
  move_pct_1h           FLOAT,
  move_pct_4h           FLOAT,
  move_pct_24h          FLOAT,
  direction_ok_4h       BOOLEAN,
  price_win             BOOLEAN,
  is_win                BOOLEAN,
  wallet_return_avg     FLOAT,
  wallet_outcome        TEXT NOT NULL DEFAULT 'OPEN',
  confirming_recipe_ids TEXT[] NOT NULL DEFAULT '{}',
  confirmation_count    INT NOT NULL DEFAULT 0,
  measured_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 3. agent_config ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_config (
  recipe_id             TEXT NOT NULL,
  param_name            TEXT NOT NULL,
  param_value           FLOAT NOT NULL,
  locked_by_human       BOOLEAN NOT NULL DEFAULT false,
  next_eligible_change  TIMESTAMPTZ,
  last_change_run_id    TEXT,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (recipe_id, param_name)
);

-- ── 4. agent_config_history ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_config_history (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  recipe_id       TEXT NOT NULL,
  param_name      TEXT NOT NULL,
  old_value       FLOAT NOT NULL,
  new_value       FLOAT NOT NULL,
  changed_by      TEXT NOT NULL,
  change_reason   TEXT NOT NULL,
  agent_log_id    UUID,
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 5. agent_findings ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_findings (
  id                       UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  recipe_id                TEXT NOT NULL,
  regime                   TEXT NOT NULL,
  period_days              INT NOT NULL,
  sample_size              INT NOT NULL,
  meets_min_sample         BOOLEAN NOT NULL,
  confidence               FLOAT NOT NULL,
  win_rate_7d              FLOAT,
  win_rate_30d             FLOAT,
  win_rate_90d             FLOAT,
  trend                    TEXT NOT NULL,
  avg_win_pct              FLOAT,
  avg_loss_pct             FLOAT,
  measured_ev              FLOAT,
  baseline_ev              FLOAT,
  vs_baseline_ev           FLOAT,
  win_rate_by_regime       JSONB,
  dominant_regime_last_30d TEXT,
  finding_type             TEXT NOT NULL,
  recommendation           TEXT,
  rec_param                TEXT,
  rec_value                FLOAT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 6. agent_log ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_log (
  log_id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  log_type              TEXT NOT NULL,
  recipe_id             TEXT,
  content               TEXT NOT NULL,
  summary               TEXT NOT NULL,
  agent_confidence      FLOAT,
  action_taken          TEXT,
  follow_up_due_at      TIMESTAMPTZ,
  follow_up_finding_id  UUID REFERENCES agent_findings(id),
  resolution            TEXT,
  metadata              JSONB
);

-- Add FK from agent_config_history to agent_log (both tables now exist)
ALTER TABLE agent_config_history
  ADD CONSTRAINT fk_agent_log
  FOREIGN KEY (agent_log_id) REFERENCES agent_log(log_id);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX ON signal_events (recipe_id, fired_at, regime_at_fire);
CREATE INDEX ON signal_events (coin, fired_at);
CREATE INDEX ON signal_outcomes (measured_at) WHERE price_4h IS NULL;
CREATE INDEX ON signal_outcomes (wallet_outcome) WHERE wallet_outcome = 'OPEN';
CREATE INDEX ON agent_log (recipe_id, created_at DESC);
CREATE INDEX ON agent_log (resolution) WHERE resolution = 'PENDING';
CREATE INDEX ON agent_log (follow_up_due_at) WHERE follow_up_due_at IS NOT NULL;
CREATE INDEX ON agent_findings (recipe_id, created_at DESC);

-- ── Seed agent_config with current hardcoded values from signal-lab.ts ────────
INSERT INTO agent_config (recipe_id, param_name, param_value) VALUES
  -- momentum_stack (Recipe 1)
  ('momentum_stack',        'MIN_WALLETS',              3),
  ('momentum_stack',        'COMBINED_NOTIONAL',        500000),
  ('momentum_stack',        'WINDOW_MS',                300000),
  -- divergence_squeeze (Recipe 2)
  ('divergence_squeeze',    'LIQ_BUFFER_THRESHOLD',     0.08),
  ('divergence_squeeze',    'PRICE_FLAT_PCT',           0.005),
  ('divergence_squeeze',    'MIN_NOTIONAL_DELTA',       75000),
  ('divergence_squeeze',    'MIN_WALLET_SCORE',         0.65),
  ('divergence_squeeze',    'MIN_WALLETS',              3),
  -- accumulation_reentry (Recipe 3)
  ('accumulation_reentry',  'HIGH_SCORE',               0.65),
  ('accumulation_reentry',  'DRAWDOWN_MULTIPLIER',      2.0),
  ('accumulation_reentry',  'DRAWDOWN_MIN',             0.06),
  ('accumulation_reentry',  'DRAWDOWN_MAX',             0.15),
  -- rotation_carry (Recipe 4)
  ('rotation_carry',        'MIN_FUNDING',              0.0003),
  ('rotation_carry',        'MIN_HISTORICAL_WINRATE',   0.60),
  -- liq_rebound (Recipe 5)
  ('liq_rebound',           'POSITION_SHRINK_PCT',      0.05),
  ('liq_rebound',           'PRICE_SPIKE_PCT_MAJOR',    0.015),
  ('liq_rebound',           'PRICE_SPIKE_PCT_ALT',      0.035),
  -- streak_continuation (Recipe 6)
  ('streak_continuation',   'MIN_STREAK',               5),
  ('streak_continuation',   'MIN_SHARPE',               0.60),
  -- funding_divergence (Recipe 7)
  ('funding_divergence',    'FUNDING_THRESHOLD',        0.0005),
  -- whale_validated (Recipe 8)
  ('whale_validated',       'MIN_SCORE',                0.75),
  ('whale_validated',       'MIN_WALLETS',              3),
  -- anti_whale_trap (Recipe 9)
  ('anti_whale_trap',       'HIGH_SCORE',               0.70),
  ('anti_whale_trap',       'REDUCTION_PCT',            0.30),
  -- global outcome measurement threshold
  ('global',                'WIN_THRESHOLD_PCT',        0.005)
ON CONFLICT DO NOTHING;
