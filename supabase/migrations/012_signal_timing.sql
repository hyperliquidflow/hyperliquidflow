-- supabase/migrations/012_signal_timing.sql
-- Sprint 7: signal-to-entry latency capture.
-- One row per emitted signal. Timestamps filled in across the pipeline stages.
-- total_latency_ms is not stored -- compute on read as:
--   EXTRACT(EPOCH FROM (first_poll_ts - COALESCE(whale_fill_ts, snapshot_detect_ts))) * 1000

CREATE TABLE IF NOT EXISTS signal_timing (
  signal_id            UUID        PRIMARY KEY REFERENCES signals_history(id) ON DELETE CASCADE,
  -- Unix-ms from fill.time; NULL until WebSocket ingestion sprint
  whale_fill_ts        TIMESTAMPTZ,
  -- When runSignalLab began processing the snapshot pair
  snapshot_detect_ts   TIMESTAMPTZ NOT NULL,
  -- When the signals_history row was inserted
  signal_emit_ts       TIMESTAMPTZ NOT NULL,
  -- When the KV write for this cycle completed
  kv_write_ts          TIMESTAMPTZ,
  -- When cohort-state first served this signal to a browser
  first_poll_ts        TIMESTAMPTZ
);

-- Fast lookups for the rolling latency chart and for the first_poll backfill
CREATE INDEX ON signal_timing (snapshot_detect_ts DESC);
CREATE INDEX ON signal_timing (first_poll_ts) WHERE first_poll_ts IS NULL;
