-- supabase/migrations/007_signal_outcomes.sql
-- Drop the prior Signal Intelligence schema (migration 006) and replace
-- with the outcome-tracking schema keyed to signals_history.
DROP TABLE IF EXISTS signal_outcomes CASCADE;

CREATE TABLE IF NOT EXISTS signal_outcomes (
  id               UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  signal_id        UUID          NOT NULL REFERENCES signals_history(id) ON DELETE CASCADE,
  recipe_id        TEXT          NOT NULL,
  coin             TEXT          NOT NULL,
  direction        TEXT          CHECK (direction IN ('LONG','SHORT','FLAT') OR direction IS NULL),
  price_at_signal  NUMERIC(20,6) NOT NULL,
  price_1h         NUMERIC(20,6),
  price_4h         NUMERIC(20,6),
  price_24h        NUMERIC(20,6),
  outcome_1h       BOOLEAN,
  outcome_4h       BOOLEAN,
  outcome_24h      BOOLEAN,
  move_pct_1h      NUMERIC(8,4),
  move_pct_4h      NUMERIC(8,4),
  move_pct_24h     NUMERIC(8,4),
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  resolved_at      TIMESTAMPTZ
);

-- Partial index: fast lookup of unresolved rows by the resolution cron
CREATE INDEX IF NOT EXISTS idx_signal_outcomes_unresolved
  ON signal_outcomes (created_at)
  WHERE price_24h IS NULL;

-- Aggregate index: fast GROUP BY recipe_id queries in the API route
CREATE INDEX IF NOT EXISTS idx_signal_outcomes_recipe
  ON signal_outcomes (recipe_id, created_at DESC);

-- FK lookup index
CREATE INDEX IF NOT EXISTS idx_signal_outcomes_signal
  ON signal_outcomes (signal_id);

-- Retain signal_outcomes for 30 days (matches signals_history retention)
SELECT cron.schedule(
  'cleanup-old-signal-outcomes',
  '15 3 * * *',
  $$
    DELETE FROM signal_outcomes
    WHERE created_at < NOW() - INTERVAL '30 days';
  $$
);
