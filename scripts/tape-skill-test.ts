// scripts/tape-skill-test.ts
//
// Step 1 of docs/sprints/2026-08-13-tape-program.md.
//
// Does wallet skill persist in a population that was NOT selected on winning?
//
// Rank IC 0.0939 is the one hypothesis this project has still standing, and it
// was measured on wallets discovered through the Hyperliquid leaderboard, which
// ranks by realised PnL. Those wallets were known to us because they had already
// won. This runs the identical statistic against a population discovered from
// the public tape, where an address appears because it traded.
//
// Reuses lib/skill-test.ts unchanged, deliberately. A reimplementation here would
// make the two numbers incomparable, which is the whole point of the exercise.
//
// Read only.
//
//   npx tsx --env-file=.env.local scripts/tape-skill-test.ts
//   npx tsx --env-file=.env.local scripts/tape-skill-test.ts --min-active=5 --min-half=10

import { readFileSync, existsSync } from "node:fs";
import {
  splitDailyPnls,
  scoreFromDailyPnls,
  normalizedForwardPerformance,
  rankIC,
} from "@/lib/skill-test";

const CACHE = "tape-population-cache.json";

const arg = (name: string, fallback: number): number => {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

const MIN_HALF_DAYS   = arg("min-half", 7);
const MIN_ACTIVE_DAYS = arg("min-active", 5);
// Designated in docs/sprints/2026-08-13-tape-program.md before the real run. It
// lived only in the doc, so the first corrected run printed a verdict line on 205
// pairs. A threshold that is not in the code is not a threshold.
const MIN_PAIRS       = arg("min-pairs", 250);

interface WalletRecord {
  address: string; equity: number | null; truncated: boolean;
  daily: Array<[number, number]>;   // [utc day index, realised pnl]
}

/**
 * Realised PnL per UTC day, dense across the observed span.
 *
 * Dense matters: a sparse series would let a wallet that traded twice look like
 * a two-day history with no drawdown, which flatters the score. Days with no
 * fills are real zeros for a realised-PnL series.
 */
function dailySeries(daily: Array<[number, number]>): number[] {
  if (!daily || daily.length === 0) return [];
  const byDay = new Map(daily);
  const days = daily.map((d) => d[0]).sort((a, b) => a - b);
  const out: number[] = [];
  for (let d = days[0]; d <= days[days.length - 1]; d++) out.push(byDay.get(d) ?? 0);
  return out;
}

function pct(xs: number[], p: number): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))];
}

function main(): void {
  if (!existsSync(CACHE)) {
    console.error(`No ${CACHE}. Run scripts/tape-population.ts --fetch first.`);
    process.exit(1);
  }
  const cache = JSON.parse(readFileSync(CACHE, "utf8")) as {
    fetched_at: string; days: number; discovery: string; wallets: WalletRecord[];
  };

  console.log(`[tape-skill] cache ${cache.fetched_at}, ${cache.days}d, discovery=${cache.discovery}`);
  console.log(`[tape-skill] ${cache.wallets.length} wallets in population`);
  if (cache.discovery !== "tape") {
    console.error("[tape-skill] REFUSING: cache was not built by tape discovery, so this measures nothing new.");
    process.exit(1);
  }

  const pairs:       Array<{ score: number; forwardPnl: number }> = [];
  const normPairs:   Array<{ score: number; forwardPnl: number }> = [];
  const activePairs: Array<{ score: number; forwardPnl: number }> = [];

  let tooShort = 0, noPnl = 0, truncated = 0;
  const forwardDollars: number[] = [];

  for (const w of cache.wallets) {
    if (w.truncated) truncated++;
    const series = dailySeries(w.daily);
    if (series.length === 0) { noPnl++; continue; }

    const split = splitDailyPnls(series, { minHalf: MIN_HALF_DAYS });
    if (!split) { tooShort++; continue; }

    const score   = scoreFromDailyPnls(split.train);
    const forward = split.test.reduce((s, v) => s + v, 0);
    pairs.push({ score, forwardPnl: forward });
    forwardDollars.push(forward);

    const normalized = normalizedForwardPerformance(split.train, split.test);
    if (normalized !== null) normPairs.push({ score, forwardPnl: normalized });

    // A wallet that stopped trading contributes zero forward PnL, which is an
    // absence of a measurement rather than a measurement of no skill. Selection
    // uses the train half only, so no forward information enters the filter.
    const active = (xs: number[]) => xs.filter((v) => v !== 0).length;
    if (active(split.train) >= MIN_ACTIVE_DAYS && normalized !== null) {
      activePairs.push({ score, forwardPnl: normalized });
    }
  }

  console.log(`[tape-skill] usable ${pairs.length}, too short ${tooShort}, no realised PnL ${noPnl}, page-capped ${truncated}`);
  if (truncated > 0) {
    console.log(`[tape-skill] WARNING: ${truncated} wallets hit the fill page cap, so their series is partial.`);
  }

  const report = (label: string, ps: Array<{ score: number; forwardPnl: number }>) => {
    const r = rankIC(ps);
    if (!r) { console.log(`  ${label.padEnd(34)} n/a (below minimum pairs or no ordering)`); return; }
    // Fisher z gives an approximate t for a rank correlation. One pair per
    // wallet, so there is no within-wallet clustering to collapse here.
    const t = r.rho * Math.sqrt((r.n - 2) / Math.max(1e-9, 1 - r.rho * r.rho));
    console.log(`  ${label.padEnd(34)} IC ${r.rho.toFixed(4)}  n ${String(r.n).padStart(4)}  t ${t.toFixed(2)}`);
  };

  console.log(`\n=== Rank IC on a tape-discovered population ===`);
  console.log(`  bar: IC above 0.08 with t above 2 (MDIC, already on the books)`);
  console.log(`  primary: active in train half, forward PnL in own risk units\n`);
  report("forward PnL, dollars", pairs);
  report("forward PnL, own risk units", normPairs);
  report("PRIMARY active in train half", activePairs);

  if (activePairs.length < MIN_PAIRS) {
    console.log(`\n=== UNDERPOWERED, no verdict recorded ===`);
    console.log(`  primary has ${activePairs.length} pairs against a designated minimum of ${MIN_PAIRS}.`);
    console.log(`  A reading here may be cited only to reject an effect far larger than the bar,`);
    console.log(`  never to accept or reject the bar itself.`);
  }

  if (forwardDollars.length > 0) {
    console.log(`\n=== Base rate, the number nobody had ===`);
    const profitable = forwardDollars.filter((v) => v > 0).length;
    console.log(`  profitable in forward half   ${profitable}/${forwardDollars.length} = ${(profitable / forwardDollars.length * 100).toFixed(1)}%`);
    console.log(`  forward PnL p10 / median / p90  $${pct(forwardDollars, 0.1).toFixed(0)} / $${pct(forwardDollars, 0.5).toFixed(0)} / $${pct(forwardDollars, 0.9).toFixed(0)}`);
  }

  console.log(`\nNothing was written.`);
}

main();
