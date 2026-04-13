-- Add equity_tier column to cohort_snapshots
ALTER TABLE cohort_snapshots ADD COLUMN IF NOT EXISTS equity_tier text;

-- Backfill existing rows based on account_value
UPDATE cohort_snapshots SET equity_tier =
  CASE
    WHEN account_value >= 5000000  THEN 'Elite'
    WHEN account_value >= 1000000  THEN 'Major'
    WHEN account_value >= 500000   THEN 'Large'
    WHEN account_value >= 100000   THEN 'Mid'
    WHEN account_value >= 50000    THEN 'Small'
    WHEN account_value >= 1000     THEN 'Micro'
    WHEN account_value >= 0        THEN 'Dust'
    ELSE NULL
  END
WHERE equity_tier IS NULL;
