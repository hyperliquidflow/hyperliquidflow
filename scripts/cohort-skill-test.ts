// scripts/cohort-skill-test.ts
//
// Answers one question: does this project's wallet scoring predict anything?
//
// Every signal recipe sits on top of the assumption that the cohort contains
// skilled traders. That assumption has never been tested. rank_ic_history has
// held 0 rows for the life of the project because the forward path needs 30
// daily score snapshots plus a 30-day forward window before it can speak.
//
// This measures the same property from data already on disk. Each wallet in
// user_pnl_backtest carries a daily PnL series. Score the wallet on the first
// half of its own series, then rank-correlate that score against what it
// actually earned over the second half. Positive rank IC means the scoring
// ranks wallets in an order that persists. Zero means wallet selection is noise
// and no recipe built on top of it can be profitable.
//
// Reference point: the roadmap's minimum detectable IC is 0.08.

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs/promises";
import {
  splitDailyPnls,
  scoreFromDailyPnls,
  rankIC,
  normalizedForwardPerformance,
} from "../lib/skill-test";

const SUPABASE_URL              = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("FATAL: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const MIN_HALF_DAYS  = 15;  // each half needs enough days to score and to measure
const MIN_TRADES     = 5;   // exclude wallets with almost no activity
const MDIC           = 0.08; // minimum detectable IC from the rebuild roadmap
// Non-zero PnL days a wallet needs before it counts as genuinely trading.
// Overridable so the reading can be swept for threshold sensitivity: a result
// that only appears at one cutoff is a fitted artifact, not a finding.
const MIN_ACTIVE_DAYS_PER_HALF = Number(
  process.argv.find((a) => a.startsWith("--min-active="))?.split("=")[1] ?? 5,
);

interface Row {
  wallet_id:    string;
  daily_pnls:   number[] | null;
  total_trades: number | null;
  computed_at:  string;
}

/**
 * Decile lift: forward performance of the top decile by score against the
 * bottom. Reports median alongside mean.
 *
 * The median is the one to read on the risk-normalized measure. That measure
 * divides by train-half volatility, so a wallet that barely traded in the train
 * half has a tiny denominator and an exploded forward value. A handful of those
 * move a mean by more than the entire real effect, and they concentrate in the
 * bottom decile, because a small negative train mean over a tiny sd scores low.
 * On the first run this inverted the decile ordering on means while the rank
 * correlation stayed positive, which is the signature of tail explosions rather
 * than of a real reversal.
 */
function decileLift(pairs: Array<{ score: number; forwardPnl: number }>) {
  const sorted = [...pairs].sort((a, b) => a.score - b.score);
  const size   = Math.max(1, Math.floor(sorted.length / 10));
  const bottom = sorted.slice(0, size);
  const top    = sorted.slice(-size);
  const mean   = (xs: typeof pairs) => xs.reduce((s, p) => s + p.forwardPnl, 0) / xs.length;
  const median = (xs: typeof pairs) => {
    const v = xs.map((p) => p.forwardPnl).sort((a, b) => a - b);
    const m = Math.floor(v.length / 2);
    return v.length % 2 === 1 ? v[m] : (v[m - 1] + v[m]) / 2;
  };
  return {
    top: mean(top), bottom: mean(bottom),
    topMedian: median(top), bottomMedian: median(bottom),
    size,
  };
}

async function main(): Promise<void> {
  console.log("[skill-test] loading wallet PnL histories...");

  // Paginated: PostgREST caps a single response at 5,000 rows, which silently
  // truncated the population to whatever came back first.
  const PAGE = 1000;
  const rows: Row[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("user_pnl_backtest")
      .select("wallet_id, daily_pnls, total_trades, computed_at")
      .not("daily_pnls", "is", null)
      .gte("total_trades", MIN_TRADES)
      .order("wallet_id", { ascending: true })
      .range(offset, offset + PAGE - 1);

    if (error) {
      console.error("[skill-test] query error:", error.message);
      process.exit(1);
    }
    const page = (data ?? []) as unknown as Row[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  console.log(`[skill-test] ${rows.length} wallets with a PnL series and ${MIN_TRADES}+ trades`);

  const pairs: Array<{ score: number; forwardPnl: number }> = [];
  // Same wallets, forward performance in units of each wallet's own daily risk
  // rather than dollars. The dollar measure lets account size into the forward
  // variable, which a scale-free score cannot predict, so the two readings
  // together say whether a thin IC is weak selection or just size noise.
  const normPairs: Array<{ score: number; forwardPnl: number }> = [];
  // Same again, restricted to wallets that traded on both sides of the split.
  const activePairs: Array<{ score: number; forwardPnl: number }> = [];
  // Selected on the train half alone, so no forward information enters the filter.
  const trainActivePairs: Array<{ score: number; forwardPnl: number }> = [];
  let tooShort = 0;
  let unnormalizable = 0;

  for (const row of rows) {
    const series = Array.isArray(row.daily_pnls) ? row.daily_pnls.map(Number) : null;
    if (!series || series.some((v) => !isFinite(v))) { tooShort++; continue; }

    const split = splitDailyPnls(series, { minHalf: MIN_HALF_DAYS });
    if (!split) { tooShort++; continue; }

    const score = scoreFromDailyPnls(split.train);
    pairs.push({
      score,
      forwardPnl: split.test.reduce((s, v) => s + v, 0),
    });

    const normalized = normalizedForwardPerformance(split.train, split.test);
    if (normalized === null) unnormalizable++;
    else normPairs.push({ score, forwardPnl: normalized });

    // A wallet that stopped trading contributes a forward value of zero, which
    // is not a measurement of skill, it is an absence of one. The first run put
    // the bottom decile's median at exactly 0.0000, which is what a population
    // padded with dormant accounts looks like. This slice keeps only wallets
    // that actually traded on both sides of the split.
    const activeDays = (xs: number[]) => xs.filter((v) => v !== 0).length;
    const trainActive = activeDays(split.train) >= MIN_ACTIVE_DAYS_PER_HALF;
    const testActive  = activeDays(split.test)  >= MIN_ACTIVE_DAYS_PER_HALF;

    if (normalized !== null && trainActive && testActive) {
      activePairs.push({ score, forwardPnl: normalized });
    }

    // The strictly clean version. Filtering on test-half activity conditions on
    // the forward period, which no live system can do. This one selects on the
    // train half alone, so every wallet is chosen using information that
    // existed at decision time. If the lift survives here it is real. If it
    // collapses back toward the full-population reading, the lift was
    // survivorship: wallets that keep trading are wallets that did not blow up.
    if (normalized !== null && trainActive) {
      trainActivePairs.push({ score, forwardPnl: normalized });
    }
  }

  console.log(`[skill-test] ${pairs.length} usable, ${tooShort} skipped for a short or invalid series`);

  const ic = rankIC(pairs);
  if (!ic) {
    console.log("[skill-test] VERDICT: not enough usable wallets to measure. No conclusion.");
    await fs.writeFile("skill-test-summary.json", JSON.stringify({ usable: pairs.length, rank_ic: null }, null, 2));
    return;
  }

  const lift      = decileLift(pairs);
  const normIc    = rankIC(normPairs);
  const normLift  = normPairs.length ? decileLift(normPairs) : null;
  const activeIc   = rankIC(activePairs);
  const activeLift = activePairs.length ? decileLift(activePairs) : null;

  // The headline verdict reads off the normalized measure. The dollar measure
  // is reported beside it because the gap between the two is the size effect.
  const headline = normIc ?? ic;
  const measure  = normIc ? "risk-normalized" : "dollar (normalized measure unavailable)";
  const verdict =
    headline.rho >= MDIC ? `PASS: rank IC ${headline.rho.toFixed(4)} clears the ${MDIC} minimum` :
    headline.rho > 0     ? `WEAK: rank IC ${headline.rho.toFixed(4)} is positive but under the ${MDIC} minimum` :
                           `FAIL: rank IC ${headline.rho.toFixed(4)} is not positive. Scoring does not rank wallets usefully`;

  // Standard error of a Spearman rho under the null is about 1/sqrt(n-1).
  const se = 1 / Math.sqrt(Math.max(headline.n - 1, 1));

  console.log("");
  console.log("──────────────────────────────────────────────────────────");
  console.log(`  Wallets measured        ${ic.n}`);
  console.log(`  Headline measure        ${measure}`);
  if (normIc) {
    console.log(`  Rank IC (risk-norm)     ${normIc.rho.toFixed(4)}   (minimum ${MDIC}, se ~${se.toFixed(4)}, n=${normIc.n})`);
  }
  console.log(`  Rank IC (dollar)        ${ic.rho.toFixed(4)}   <- carries account size in the forward variable`);
  if (normLift) {
    console.log(`  Top decile risk-adj     median ${normLift.topMedian.toFixed(4)}   mean ${normLift.top.toFixed(4)}  (n=${normLift.size})`);
    console.log(`  Bot decile risk-adj     median ${normLift.bottomMedian.toFixed(4)}   mean ${normLift.bottom.toFixed(4)}  (n=${normLift.size})`);
    console.log(`  (read the medians: the mean is not safe against tiny-denominator tails)`);
  }
  console.log(`  Top decile fwd PnL      $${lift.top.toFixed(0)}  (n=${lift.size})`);
  console.log(`  Bottom decile fwd PnL   $${lift.bottom.toFixed(0)}  (n=${lift.size})`);
  if (activeIc && activeLift) {
    const activeSe = 1 / Math.sqrt(Math.max(activeIc.n - 1, 1));
    console.log("  ---");
    console.log(`  ACTIVE ONLY (>=${MIN_ACTIVE_DAYS_PER_HALF} trading days each half), n=${activeIc.n}`);
    console.log(`  Rank IC (risk-norm)     ${activeIc.rho.toFixed(4)}   (se ~${activeSe.toFixed(4)})`);
    console.log(`  Top decile risk-adj     median ${activeLift.topMedian.toFixed(4)}  (n=${activeLift.size})`);
    console.log(`  Bot decile risk-adj     median ${activeLift.bottomMedian.toFixed(4)}  (n=${activeLift.size})`);
  } else {
    console.log(`  ACTIVE ONLY: too few wallets traded on both sides of the split to measure`);
  }
  const trainIc   = rankIC(trainActivePairs);
  const trainLift = trainActivePairs.length ? decileLift(trainActivePairs) : null;
  if (trainIc && trainLift) {
    const trainSe = 1 / Math.sqrt(Math.max(trainIc.n - 1, 1));
    console.log("  ---");
    console.log(`  TRAIN-ACTIVE ONLY (no forward information in the filter), n=${trainIc.n}`);
    console.log(`  Rank IC (risk-norm)     ${trainIc.rho.toFixed(4)}   (se ~${trainSe.toFixed(4)})`);
    console.log(`  Top decile risk-adj     median ${trainLift.topMedian.toFixed(4)}  (n=${trainLift.size})`);
    console.log(`  Bot decile risk-adj     median ${trainLift.bottomMedian.toFixed(4)}  (n=${trainLift.size})`);
    console.log(`  <- this is the honest number. The active-only row above conditions on the future.`);
  }
  console.log(`  ${verdict}`);
  console.log("──────────────────────────────────────────────────────────");
  console.log("");
  if (unnormalizable > 0) {
    console.log(`[skill-test] ${unnormalizable} wallets had a flat train half and no risk-normalized reading`);
  }

  const summary = {
    ran_at:              new Date().toISOString(),
    wallets_measured:    ic.n,
    headline_measure:    measure,
    rank_ic:             normIc ? parseFloat(normIc.rho.toFixed(4)) : null,
    rank_ic_standard_error: parseFloat(se.toFixed(4)),
    rank_ic_dollar:      parseFloat(ic.rho.toFixed(4)),
    mdic:                MDIC,
    top_decile_fwd_risk_adjusted_median:    normLift ? parseFloat(normLift.topMedian.toFixed(4)) : null,
    bottom_decile_fwd_risk_adjusted_median: normLift ? parseFloat(normLift.bottomMedian.toFixed(4)) : null,
    top_decile_fwd_risk_adjusted_mean:      normLift ? parseFloat(normLift.top.toFixed(4)) : null,
    bottom_decile_fwd_risk_adjusted_mean:   normLift ? parseFloat(normLift.bottom.toFixed(4)) : null,
    top_decile_fwd_pnl:  parseFloat(lift.top.toFixed(2)),
    bottom_decile_fwd_pnl: parseFloat(lift.bottom.toFixed(2)),
    decile_size:         lift.size,
    unnormalizable,
    active_only: activeIc && activeLift ? {
      min_active_days_per_half: MIN_ACTIVE_DAYS_PER_HALF,
      wallets: activeIc.n,
      rank_ic: parseFloat(activeIc.rho.toFixed(4)),
      standard_error: parseFloat((1 / Math.sqrt(Math.max(activeIc.n - 1, 1))).toFixed(4)),
      top_decile_median: parseFloat(activeLift.topMedian.toFixed(4)),
      bottom_decile_median: parseFloat(activeLift.bottomMedian.toFixed(4)),
    } : null,
    train_active_only: trainIc && trainLift ? {
      note: "selected on the train half alone, no forward information in the filter",
      wallets: trainIc.n,
      rank_ic: parseFloat(trainIc.rho.toFixed(4)),
      standard_error: parseFloat((1 / Math.sqrt(Math.max(trainIc.n - 1, 1))).toFixed(4)),
      top_decile_median: parseFloat(trainLift.topMedian.toFixed(4)),
      bottom_decile_median: parseFloat(trainLift.bottomMedian.toFixed(4)),
    } : null,
    verdict,
  };
  await fs.writeFile("skill-test-summary.json", JSON.stringify(summary, null, 2));
  console.log("[skill-test] wrote skill-test-summary.json");
}

main().catch((err) => {
  console.error("[skill-test] fatal:", err);
  process.exit(1);
});
