-- 024_beta_scaled_benchmark.sql
--
-- The benchmark now scales BTC's move by each coin's own sensitivity to it.
--
-- Comparing every coin 1:1 against BTC flatters high-beta names: an alt that
-- returns 300 bps while BTC returns 100 reads as 200 bps of alpha, when a beta
-- of 3 means it earned exactly what its exposure implied and the true alpha is
-- zero. Beta is estimated from 4h returns that closed before the signal fired,
-- so no trade is scored with information it could not have had.

ALTER TABLE signal_outcomes ADD COLUMN IF NOT EXISTS beta NUMERIC;

COMMENT ON COLUMN signal_outcomes.beta IS
  'OLS beta of this coin against BTC, estimated from 4h returns that closed before the signal fired. Null when it could not be estimated, in which case benchmark_bps used a beta of 1.';

-- Clear prior grades so the nightly run refills them with a beta-scaled
-- benchmark. Without this the table mixes scaled and unscaled alpha.
UPDATE signal_outcomes
SET entry_price = NULL, exit_price = NULL, exit_reason = NULL,
    hold_hours = NULL, cost_bps = NULL, gross_pnl_bps = NULL,
    net_pnl_bps = NULL, realized_r_multiple = NULL, is_win = NULL,
    benchmark_bps = NULL, alpha_bps = NULL
WHERE exit_reason IS NOT NULL AND exit_reason <> 'no_data';

-- Archive tables for scripts/dedupe-signal-episodes.ts, which collapses the
-- poll-cadence repeats recorded before the 2026-08-11 emission fix. Rows land
-- here before deletion so the collapse is reversible.
CREATE TABLE IF NOT EXISTS signal_outcomes_superseded
  (LIKE signal_outcomes INCLUDING DEFAULTS);
CREATE TABLE IF NOT EXISTS signals_history_superseded
  (LIKE signals_history INCLUDING DEFAULTS);

ALTER TABLE signal_outcomes_superseded ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE signals_history_superseded ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE signal_outcomes_superseded ENABLE ROW LEVEL SECURITY;
ALTER TABLE signals_history_superseded ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION archive_superseded_outcomes(ids uuid[])
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO signal_outcomes_superseded SELECT *, now() FROM signal_outcomes WHERE id = ANY(ids);
$$;

CREATE OR REPLACE FUNCTION archive_superseded_signals(ids uuid[])
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO signals_history_superseded SELECT *, now() FROM signals_history WHERE id = ANY(ids);
$$;
