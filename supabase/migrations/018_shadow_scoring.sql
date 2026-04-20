-- supabase/migrations/018_shadow_scoring.sql
-- Sprint R13: shadow scoring columns for 30-day canary rollout.
--
-- overall_score_shadow:    V2 formula score (lev-adj Sharpe + blow-up penalty).
--                          Written by Phase 10b of daily-wallet-scan.ts.
--                          NULL until Phase 10b first runs.
-- shadow_formula_version:  Identifies the V2 formula variant in use.
--                          Allows future formula updates to be tracked.
--
-- wallet_score_history.overall_score_shadow:
--   Written by writeScoreHistory() alongside overall_score.
--   Enables rank-ic.ts to compute shadow IC using the same lookback data.
--
-- rank_ic_history.rank_ic_shadow:
--   Shadow IC computed by rank-ic.ts using overall_score_shadow.
--   30-day comparison against rank_ic decides cutover.

ALTER TABLE wallets
  ADD COLUMN IF NOT EXISTS overall_score_shadow   NUMERIC(6, 4),
  ADD COLUMN IF NOT EXISTS shadow_formula_version TEXT;

ALTER TABLE wallet_score_history
  ADD COLUMN IF NOT EXISTS overall_score_shadow NUMERIC(6, 4);

ALTER TABLE rank_ic_history
  ADD COLUMN IF NOT EXISTS rank_ic_shadow NUMERIC(8, 4);
