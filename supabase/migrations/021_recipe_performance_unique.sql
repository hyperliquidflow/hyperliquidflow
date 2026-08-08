-- One row per recipe per day. Append-only writes buried the nightly net-PnL
-- stats under intraday rows with null net columns (audit 2026-08-08).

ALTER TABLE recipe_performance
  ADD COLUMN IF NOT EXISTS measured_day DATE
  GENERATED ALWAYS AS ((measured_at AT TIME ZONE 'UTC')::date) STORED;

-- Collapse existing duplicates, keeping the newest row per recipe per day.
DELETE FROM recipe_performance a
USING recipe_performance b
WHERE a.recipe_id = b.recipe_id
  AND a.measured_day = b.measured_day
  AND a.measured_at < b.measured_at;

CREATE UNIQUE INDEX IF NOT EXISTS recipe_performance_recipe_day_uniq
  ON recipe_performance (recipe_id, measured_day);
