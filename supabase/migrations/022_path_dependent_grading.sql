-- 022_path_dependent_grading.sql
--
-- Grading moved from three close-price snapshots to a bar-by-bar walk of the
-- hourly candles. Two new diagnostic columns, and every existing grade is
-- cleared so the nightly run regrades it under the new rules.
--
-- Why the reset: the old simulator broke out of its snapshot loop on the first
-- non-null price, so a stop breached at hour 4 or hour 20 was never seen and
-- the trade recorded a 1-hour time exit instead. Every row graded before this
-- migration carries that bias.

ALTER TABLE signal_outcomes
  ADD COLUMN IF NOT EXISTS hold_hours INTEGER,
  ADD COLUMN IF NOT EXISTS cost_bps   NUMERIC;

COMMENT ON COLUMN signal_outcomes.hold_hours IS
  'Hours held before the exit fired, from signal time through the exit bar.';
COMMENT ON COLUMN signal_outcomes.cost_bps IS
  'Round-trip cost charged against gross: fees + slippage + signed funding.';

-- exit_reason values are now stop | target | time (was stop | target | time_1h |
-- time_4h | time_24h). 'no_data' is terminal: the coin has no retrievable candle
-- history, usually a delisting, so the row can never be graded and should stop
-- being retried every night.
ALTER TABLE signal_outcomes DROP CONSTRAINT IF EXISTS signal_outcomes_exit_reason_check;
ALTER TABLE signal_outcomes ADD CONSTRAINT signal_outcomes_exit_reason_check
  CHECK (exit_reason IN ('stop', 'target', 'time', 'no_data') OR exit_reason IS NULL);

UPDATE signal_outcomes
SET entry_price         = NULL,
    exit_price          = NULL,
    exit_reason         = NULL,
    gross_pnl_bps       = NULL,
    net_pnl_bps         = NULL,
    realized_r_multiple = NULL,
    is_win              = NULL
WHERE exit_reason IS NOT NULL;

-- Recipe aggregates were computed from those grades. Null them so the UI shows
-- an honest empty state until the nightly run repopulates from regraded rows.
UPDATE recipe_performance
SET median_net_pnl_bps = NULL,
    win_rate_net       = NULL,
    expectancy_bps_net = NULL,
    sample_size_60d    = NULL;

CREATE INDEX IF NOT EXISTS idx_signal_outcomes_ungraded
  ON signal_outcomes (created_at)
  WHERE exit_reason IS NULL;

-- The pre-migration grades were snapshotted into signal_outcomes_pre022_backup
-- before the reset above, so the regrade can be diffed against what it replaced.
-- RLS enabled to match every other table (migration 019). Safe to drop after the
-- Phase 2 prove-or-kill review.
