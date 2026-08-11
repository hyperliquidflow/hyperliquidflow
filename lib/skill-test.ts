// lib/skill-test.ts
// Out-of-sample cohort skill measurement. Pure functions, no I/O.
//
// The production rank IC path (scripts/rank-ic.ts) needs 30 daily score
// snapshots plus a 30-day forward window before it can say anything, so it has
// produced 0 rows for the life of the project. This measures the same property
// retrospectively: score a wallet on the first half of its own daily PnL series,
// then rank-correlate that score against what it actually earned in the second
// half. It answers the foundational question, which is whether wallet selection
// predicts anything at all, without waiting 60 days for the forward path.

import { sampleRankCorrelation } from "simple-statistics";
import {
  computeSharpeProxy,
  computePnlConsistency,
  computeDrawdownScore,
} from "./cohort-engine";

export interface SplitSeries {
  train: number[];
  test:  number[];
}

/**
 * Split a daily PnL series into an earlier half used for scoring and a later
 * half used for measuring what actually happened next. An odd day goes to the
 * training half so the forward window is never the shorter of the two.
 */
export function splitDailyPnls(
  series: number[],
  opts: { minHalf: number },
): SplitSeries | null {
  const testLen  = Math.floor(series.length / 2);
  const trainLen = series.length - testLen;
  if (testLen < opts.minHalf || trainLen < opts.minHalf) return null;
  return { train: series.slice(0, trainLen), test: series.slice(trainLen) };
}

// The production overall_score weights sharpe 35, consistency 25, drawdown 25,
// regime_fit 15. regime_fit needs a live clearinghouse snapshot and cannot be
// reconstructed for a past date, so the three PnL factors are renormalised to
// sum to 1. This measures the same ordering the live scorer would produce,
// minus the regime term.
const W_SHARPE      = 0.35 / 0.85;
const W_CONSISTENCY = 0.25 / 0.85;
const W_DRAWDOWN    = 0.25 / 0.85;

/** Score a wallet from a daily PnL series, using only that series. */
export function scoreFromDailyPnls(dailyPnls: number[]): number {
  const score =
    W_SHARPE      * computeSharpeProxy(dailyPnls) +
    W_CONSISTENCY * computePnlConsistency(dailyPnls) +
    W_DRAWDOWN    * computeDrawdownScore(dailyPnls);
  return Math.min(1, Math.max(0, score));
}

export interface RankICResult {
  rho: number;
  n:   number;
}

/** Minimum pairs before a rank correlation is worth reporting. */
export const RANK_IC_MIN_PAIRS = 20;

/**
 * Spearman rank correlation between assigned score and realised forward PnL.
 * Null below the minimum sample, and null when scores are all tied, since a
 * constant has no ordering to correlate and the underlying routine would
 * return NaN.
 */
export function rankIC(
  pairs: Array<{ score: number; forwardPnl: number }>,
): RankICResult | null {
  if (pairs.length < RANK_IC_MIN_PAIRS) return null;

  const scores  = pairs.map((p) => p.score);
  const forward = pairs.map((p) => p.forwardPnl);
  if (new Set(scores).size < 2 || new Set(forward).size < 2) return null;

  const rho = sampleRankCorrelation(scores, forward);
  if (!Number.isFinite(rho)) return null;

  return { rho, n: pairs.length };
}
