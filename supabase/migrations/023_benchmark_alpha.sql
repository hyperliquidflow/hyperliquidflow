-- 023_benchmark_alpha.sql
--
-- Every graded outcome now records what the market did over the same holding
-- window, and what was left after paying for that exposure.
--
-- Without this, expectancy cannot distinguish a signal from a rising market. A
-- LONG returning 200 bps while BTC ran 180 looks identical to real edge, and a
-- bull month would read as a working system.

ALTER TABLE signal_outcomes
  ADD COLUMN IF NOT EXISTS benchmark_bps NUMERIC,
  ADD COLUMN IF NOT EXISTS alpha_bps     NUMERIC;

COMMENT ON COLUMN signal_outcomes.benchmark_bps IS
  'BTC return over the same holding window, signed by trade direction. A SHORT is benchmarked against the inverse, since being short a falling market is also beta.';
COMMENT ON COLUMN signal_outcomes.alpha_bps IS
  'net_pnl_bps minus benchmark_bps. This is the number that has to be positive for the signal to be worth anything. Not beta-scaled per coin: high-beta alts are flattered.';

-- Existing grades predate the benchmark. Clear their exit so the nightly run
-- regrades them and fills both columns, rather than leaving a permanent block
-- of rows that can never be compared against the market.
UPDATE signal_outcomes
SET entry_price         = NULL,
    exit_price          = NULL,
    exit_reason         = NULL,
    hold_hours          = NULL,
    cost_bps            = NULL,
    gross_pnl_bps       = NULL,
    net_pnl_bps         = NULL,
    realized_r_multiple = NULL,
    is_win              = NULL
WHERE exit_reason IS NOT NULL
  AND exit_reason <> 'no_data';

CREATE INDEX IF NOT EXISTS idx_signal_outcomes_alpha
  ON signal_outcomes (recipe_id, alpha_bps)
  WHERE alpha_bps IS NOT NULL;

-- Mean alpha per recipe, surfaced alongside the existing net stats and gated by
-- the same minimum sample.
ALTER TABLE recipe_performance
  ADD COLUMN IF NOT EXISTS expectancy_alpha_bps NUMERIC;

COMMENT ON COLUMN recipe_performance.expectancy_alpha_bps IS
  'Mean alpha_bps across graded outcomes in the 60d window. Positive means the recipe beat passive market exposure. Null until the sample clears the minimum.';
