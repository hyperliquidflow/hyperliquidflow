-- supabase/migrations/001_initial_schema.sql
-- Run via: supabase db push  OR  paste into Supabase SQL editor.
-- All statements are idempotent (IF NOT EXISTS guards everywhere).

-- ── Extensions ────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_cron";        -- needed for cleanup jobs in 002

-- ── wallets ───────────────────────────────────────────────────────────────────
-- One row per tracked Hyperliquid wallet address.
-- is_active = TRUE means the wallet is in the active signal cohort.
CREATE TABLE IF NOT EXISTS wallets (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  address           TEXT        NOT NULL UNIQUE
                                  CHECK (address ~ '^0x[0-9a-fA-F]{40}$'),
  label             TEXT,                      -- optional human name
  is_active         BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── cohort_snapshots ──────────────────────────────────────────────────────────
-- Point-in-time state for each active wallet, written every 60 s by the cron.
-- Only the 2 most recent rows per wallet are retained (cleanup in 002).
CREATE TABLE IF NOT EXISTS cohort_snapshots (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  wallet_id         UUID        NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  snapshot_time     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Financials from clearinghouseState.marginSummary
  account_value     NUMERIC(20, 6) NOT NULL DEFAULT 0,
  total_notional    NUMERIC(20, 6) NOT NULL DEFAULT 0,
  total_margin_used NUMERIC(20, 6) NOT NULL DEFAULT 0,
  unrealized_pnl    NUMERIC(20, 6) NOT NULL DEFAULT 0,
  withdrawable      NUMERIC(20, 6) NOT NULL DEFAULT 0,

  -- Derived: (account_value - total_margin_used) / account_value
  -- Used by Recipe 2 (Divergence Squeeze liq-buffer check)
  liq_buffer_pct    NUMERIC(8, 5),

  position_count    INTEGER     NOT NULL DEFAULT 0,

  -- Full clearinghouseState.assetPositions array serialised as JSONB
  positions         JSONB       NOT NULL DEFAULT '[]',

  -- Scoring components (all [0,1])
  overall_score     NUMERIC(6, 4),
  sharpe_proxy      NUMERIC(6, 4),
  drawdown_score    NUMERIC(6, 4),
  pnl_consistency   NUMERIC(6, 4),
  regime_fit        NUMERIC(6, 4)
);

CREATE INDEX IF NOT EXISTS idx_cohort_wallet_time
  ON cohort_snapshots (wallet_id, snapshot_time DESC);

-- ── signals_history ───────────────────────────────────────────────────────────
-- Every signal event fired by any recipe.
CREATE TABLE IF NOT EXISTS signals_history (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  wallet_id     UUID        NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  recipe_id     TEXT        NOT NULL,     -- e.g. "conviction_build"
  coin          TEXT        NOT NULL,     -- e.g. "BTC"
  signal_type   TEXT        NOT NULL
                              CHECK (signal_type IN ('ENTRY','EXIT','SCALE_IN','SCALE_OUT','FLIP','ALERT')),
  direction     TEXT
                  CHECK (direction IN ('LONG','SHORT','FLAT') OR direction IS NULL),
  detected_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ev_score      NUMERIC(6, 4),           -- normalised [0,1]; NULL = insufficient data
  metadata      JSONB       NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_signals_detected
  ON signals_history (detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_signals_recipe
  ON signals_history (recipe_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_signals_wallet
  ON signals_history (wallet_id, detected_at DESC);

-- ── user_pnl_backtest ─────────────────────────────────────────────────────────
-- One row per wallet, upserted by the daily scan. Stores 30-day backtest results.
CREATE TABLE IF NOT EXISTS user_pnl_backtest (
  wallet_id            UUID        PRIMARY KEY REFERENCES wallets(id) ON DELETE CASCADE,
  computed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  win_rate             NUMERIC(6, 5),   -- winning closes / total closes
  avg_win_usd          NUMERIC(20, 6),  -- avg closedPnl on winning trades
  avg_loss_usd         NUMERIC(20, 6),  -- abs(avg closedPnl) on losing trades
  profit_factor        NUMERIC(8, 4),   -- total_win_pnl / abs(total_loss_pnl)
  total_trades         INTEGER,
  total_pnl_usd        NUMERIC(20, 6),
  max_drawdown_pct     NUMERIC(8, 5),   -- [0,1] fraction
  sharpe_ratio         NUMERIC(10, 6),
  backtest_window_days INTEGER         NOT NULL DEFAULT 30,
  -- Streak data
  current_win_streak   INTEGER         NOT NULL DEFAULT 0,
  current_loss_streak  INTEGER         NOT NULL DEFAULT 0,
  max_win_streak       INTEGER         NOT NULL DEFAULT 0
);

-- ── recipe_performance ────────────────────────────────────────────────────────
-- Aggregate performance stats per recipe, computed during the daily scan.
CREATE TABLE IF NOT EXISTS recipe_performance (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipe_id         TEXT        NOT NULL,
  measured_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  signal_count      INTEGER     NOT NULL DEFAULT 0,
  true_positive     INTEGER     NOT NULL DEFAULT 0,  -- signals followed by favourable price move
  false_positive    INTEGER     NOT NULL DEFAULT 0,
  avg_ev_score      NUMERIC(6, 4),
  win_rate          NUMERIC(6, 4),                   -- true_positive / signal_count
  notes             TEXT
);

CREATE INDEX IF NOT EXISTS idx_recipe_perf
  ON recipe_performance (recipe_id, measured_at DESC);

-- ── rate_limit_tokens ─────────────────────────────────────────────────────────
-- Server-side token bucket persisted in Supabase so all Vercel cold-start
-- instances share the same rate-limit state.
-- One row per logical endpoint category.
CREATE TABLE IF NOT EXISTS rate_limit_tokens (
  endpoint    TEXT        PRIMARY KEY,
  tokens      NUMERIC     NOT NULL DEFAULT 10,
  last_refill TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed initial token rows for each endpoint category
INSERT INTO rate_limit_tokens (endpoint, tokens) VALUES
  ('clearinghouseState',       10),
  ('userFills',                10),
  ('allMids',                  10),
  ('l2Book',                   10),
  ('metaAndAssetCtxs',         10),
  ('candleSnapshot',           10),
  ('fundingHistory',           10),
  ('leaderboard',              10)
ON CONFLICT (endpoint) DO NOTHING;

-- ── Trigger: auto-update wallets.updated_at ───────────────────────────────────
CREATE OR REPLACE FUNCTION fn_update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_wallets_updated_at ON wallets;
CREATE TRIGGER trg_wallets_updated_at
  BEFORE UPDATE ON wallets
  FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();
