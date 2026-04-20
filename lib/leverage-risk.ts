// lib/leverage-risk.ts
// Leverage risk math for scoring V2.
//
// DEFAULT_PENALTY_PARAMS are a conservative prior.
// Run scripts/fit-leverage-penalty.ts against production cohort_attrition data
// to derive empirical replacements (needs 10+ blow-up events for reliability).

import { mean, stddev, clamp } from "@/lib/utils";

export interface LeveragePenaltyParams {
  safe_lev:  number; // leverage at or below this has zero penalty
  max_lev:   number; // leverage at or above this maps to full penalty (1.0)
  exponent:  number; // curve shape: 1=linear, >1=convex (penalises high lev harder)
}

// Conservative prior. Re-fit with fit-leverage-penalty.ts once 10+ blow-up
// events exist in cohort_attrition.
export const DEFAULT_PENALTY_PARAMS: LeveragePenaltyParams = {
  safe_lev:  3,
  max_lev:   15,
  exponent:  1.5,
};

export const SHADOW_FORMULA_VERSION = "v2_r13";

/**
 * Fraction of full blow-up risk attributable to this wallet's max leverage.
 * 0 = safe (leverage <= safe_lev), 1 = at or beyond blow-up threshold.
 */
export function computeBlowUpPenalty(
  maxLeverage: number,
  params: LeveragePenaltyParams = DEFAULT_PENALTY_PARAMS
): number {
  if (maxLeverage <= params.safe_lev) return 0;
  if (maxLeverage >= params.max_lev)  return 1;
  const t = (maxLeverage - params.safe_lev) / (params.max_lev - params.safe_lev);
  return Math.pow(t, params.exponent);
}

/**
 * [0,1] score where 1 = far from blow-up (low leverage) and 0 = at threshold.
 * Used directly as the blow_up_distance factor in V2 scoring.
 */
export function computeBlowUpDistanceScore(
  maxLeverage: number,
  params: LeveragePenaltyParams = DEFAULT_PENALTY_PARAMS
): number {
  return 1 - computeBlowUpPenalty(maxLeverage, params);
}

/**
 * Sharpe proxy computed on leverage-normalised PnL, scaled at 2 (not 3).
 *
 * Normalising by (1 + avgLeverage) levels the field: a wallet running 5x
 * leverage who earns $10K/day is not "better" than one running 1x earning $2K/day
 * if their risk-adjusted returns are identical.
 *
 * @param dailyPnls   30-element array (index 0 = oldest)
 * @param avgLeverage Average leverage observed across snapshots (0 if unknown)
 */
export function computeLevAdjSharpe(dailyPnls: number[], avgLeverage: number): number {
  if (dailyPnls.length === 0) return 0;
  const lev = Math.max(0, avgLeverage);
  const adjPnls = dailyPnls.map((p) => p / (1 + lev));
  const m = mean(adjPnls);
  const s = stddev(adjPnls);
  const raw = m / (s + 0.0001);
  return clamp(raw / 2.0, 0, 1); // normalise at 2, not 3
}
