-- supabase/migrations/002_wallet_metrics.sql
-- Adds wallet-discovery columns and pg_cron cleanup jobs.
-- Run AFTER 001_initial_schema.sql.

-- ── Wallet discovery & scoring columns ───────────────────────────────────────
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS win_rate          NUMERIC(6, 5);
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS trade_count_30d   INTEGER;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS realized_pnl_30d  NUMERIC(20, 6);
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS last_scanned_at   TIMESTAMPTZ;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS discovery_source  TEXT
  CHECK (discovery_source IN ('leaderboard_api', 'leaderboard_scrape', 'manual_seed'));

-- Partial index: only active wallets, sorted by win rate (keeps the index small)
CREATE INDEX IF NOT EXISTS idx_wallets_win_rate
  ON wallets (win_rate DESC)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_wallets_last_scanned
  ON wallets (last_scanned_at);

-- ── Seed wallets (manual_seed) ────────────────────────────────────────────────
-- Four verified Hyperliquid addresses used as the bootstrap cohort before
-- the daily scan populates the full 500-wallet set.
INSERT INTO wallets (address, is_active, discovery_source) VALUES
  ('0xa5b0edf6b55128e0ddae8e51ac538c3188401d41', TRUE, 'manual_seed'),
  ('0x6c8512516ce5669d35113a11ca8b8de322fd84f6', TRUE, 'manual_seed'),
  ('0x94d3735543ecb3d339064151118644501c933814', TRUE, 'manual_seed'),
  ('0x0ddf9bae2af4b874b96d287a5ad42eb47138a902', TRUE, 'manual_seed')
ON CONFLICT (address) DO NOTHING;

-- ── pg_cron cleanup jobs ──────────────────────────────────────────────────────
-- These run inside Postgres via the pg_cron extension (enabled in Supabase).
-- They keep the free-tier 500 MB Supabase database from filling up.

-- Retain only the 2 most recent snapshots per wallet (current + previous)
SELECT cron.schedule(
  'cleanup-old-snapshots',
  '0 3 * * *',   -- 03:00 UTC daily
  $$
    DELETE FROM cohort_snapshots
    WHERE id NOT IN (
      SELECT id FROM (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY wallet_id
                 ORDER BY snapshot_time DESC
               ) AS rn
        FROM cohort_snapshots
      ) ranked
      WHERE rn <= 2
    );
  $$
);

-- Retain signals_history for 30 days only
SELECT cron.schedule(
  'cleanup-old-signals',
  '5 3 * * *',   -- 03:05 UTC daily
  $$
    DELETE FROM signals_history
    WHERE detected_at < NOW() - INTERVAL '30 days';
  $$
);

-- Retain recipe_performance for 90 days only
SELECT cron.schedule(
  'cleanup-old-recipe-perf',
  '10 3 * * *',  -- 03:10 UTC daily
  $$
    DELETE FROM recipe_performance
    WHERE measured_at < NOW() - INTERVAL '90 days';
  $$
);
