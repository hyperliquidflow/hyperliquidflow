// scripts/tape-skill-robustness.ts
//
// Attack the Step 1 result before believing it.
//
// The primary statistic correlates a score against forward performance expressed
// in the wallet's own risk units. The score contains a Sharpe proxy,
// mean(train)/sd(train), and the forward variable is mean(test)/sd(train). **Both
// sides carry sd(train) in the denominator.** A wallet with a quiet training half
// therefore scores higher AND posts a larger normalised forward number, for any
// given dollar outcome, which manufactures a positive rank correlation out of
// arithmetic rather than skill.
//
// This script does not assume the artifact is fatal or harmless. It measures how
// much of the reading survives each control:
//
//   1. dollars, which shares no denominator but lets account size in as noise
//   2. a score with the Sharpe proxy removed, so no sd(train) is on the left
//   3. stratifying by sd(train), the standard control: inside a narrow volatility
//      band the shared denominator is near constant, so what survives is real
//   4. split-half over wallets, per the standing rule
//
// Read only. Writes nothing.
//
//   npx tsx --env-file=.env.local scripts/tape-skill-robustness.ts --min-active=5

import { readFileSync, existsSync } from "node:fs";
import { splitDailyPnls, scoreFromDailyPnls, normalizedForwardPerformance, rankIC } from "@/lib/skill-test";
import { computePnlConsistency, computeDrawdownScore } from "@/lib/cohort-engine";

const CACHE = "tape-population-cache.json";

const arg = (name: string, fallback: number): number => {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

const MIN_HALF_DAYS   = arg("min-half", 7);
const MIN_ACTIVE_DAYS = arg("min-active", 5);
const SEED            = arg("seed", 20260814);

interface WalletRecord {
  address: string; truncated: boolean; daily: Array<[number, number]>;
}

function dailySeries(daily: Array<[number, number]>): number[] {
  if (!daily || daily.length === 0) return [];
  const byDay = new Map(daily);
  const days = daily.map((d) => d[0]).sort((a, b) => a - b);
  const out: number[] = [];
  for (let d = days[0]; d <= days[days.length - 1]; d++) out.push(byDay.get(d) ?? 0);
  return out;
}

function sd(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = xs.reduce((s, v) => s + v, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / xs.length);
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Row {
  score: number;        // the shipped score, contains the Sharpe proxy
  scoreNoSharpe: number; // consistency and drawdown only, no sd(train) anywhere
  fwdNorm: number;      // mean(test) / sd(train), the primary's forward variable
  fwdDollars: number;   // mean(test) in dollars
  sdTrain: number;
}

const report = (label: string, ps: Array<{ score: number; forwardPnl: number }>) => {
  const r = rankIC(ps);
  if (!r) { console.log(`  ${label.padEnd(42)} n/a`); return; }
  const t = r.rho * Math.sqrt((r.n - 2) / Math.max(1e-9, 1 - r.rho * r.rho));
  console.log(`  ${label.padEnd(42)} IC ${r.rho.toFixed(4).padStart(8)}  n ${String(r.n).padStart(4)}  t ${t.toFixed(2).padStart(6)}`);
};

function main(): void {
  if (!existsSync(CACHE)) { console.error(`No ${CACHE}.`); process.exit(1); }
  const cache = JSON.parse(readFileSync(CACHE, "utf8")) as { fetched_at: string; wallets: WalletRecord[] };
  console.log(`[robust] cache ${cache.fetched_at}, ${cache.wallets.length} wallets\n`);

  const rows: Row[] = [];
  for (const w of cache.wallets) {
    if (w.truncated) continue;
    const series = dailySeries(w.daily);
    if (series.length === 0) continue;
    const split = splitDailyPnls(series, { minHalf: MIN_HALF_DAYS });
    if (!split) continue;
    const active = split.train.filter((v) => v !== 0).length;
    if (active < MIN_ACTIVE_DAYS) continue;
    const fwdNorm = normalizedForwardPerformance(split.train, split.test);
    if (fwdNorm === null) continue;
    const s = sd(split.train);
    if (s === 0) continue;

    rows.push({
      score:         scoreFromDailyPnls(split.train),
      scoreNoSharpe: 0.5 * computePnlConsistency(split.train) + 0.5 * computeDrawdownScore(split.train),
      fwdNorm,
      fwdDollars:    split.test.reduce((a, v) => a + v, 0) / split.test.length,
      sdTrain:       s,
    });
  }
  console.log(`[robust] ${rows.length} wallets in the primary set\n`);

  console.log(`=== 1. The reading, and the same reading in dollars ===`);
  report("PRIMARY score vs forward, risk units", rows.map((r) => ({ score: r.score, forwardPnl: r.fwdNorm })));
  report("score vs forward, dollars", rows.map((r) => ({ score: r.score, forwardPnl: r.fwdDollars })));

  console.log(`\n=== 2. Remove sd(train) from the left-hand side ===`);
  console.log(`  If the shared denominator drives the primary, a score with no Sharpe`);
  console.log(`  proxy should lose most of it against the normalised forward.`);
  report("score without Sharpe vs risk units", rows.map((r) => ({ score: r.scoreNoSharpe, forwardPnl: r.fwdNorm })));
  report("score without Sharpe vs dollars", rows.map((r) => ({ score: r.scoreNoSharpe, forwardPnl: r.fwdDollars })));

  console.log(`\n=== 3. The direct check: is the score just measuring quietness? ===`);
  report("score vs sd(train), rank", rows.map((r) => ({ score: r.score, forwardPnl: r.sdTrain })));
  report("forward risk units vs sd(train), rank", rows.map((r) => ({ score: r.fwdNorm, forwardPnl: r.sdTrain })));

  console.log(`\n=== 4. Stratified by sd(train): the shared denominator held near constant ===`);
  const byVol = [...rows].sort((a, b) => a.sdTrain - b.sdTrain);
  const K = 5, per = Math.floor(byVol.length / K);
  let wSum = 0, wN = 0, wSumD = 0;
  for (let k = 0; k < K; k++) {
    const slice = byVol.slice(k * per, k === K - 1 ? byVol.length : (k + 1) * per);
    const rNorm = rankIC(slice.map((r) => ({ score: r.score, forwardPnl: r.fwdNorm })));
    const rDol  = rankIC(slice.map((r) => ({ score: r.score, forwardPnl: r.fwdDollars })));
    const lo = slice[0].sdTrain, hi = slice[slice.length - 1].sdTrain;
    console.log(`  q${k + 1} sd $${lo.toFixed(0)} to $${hi.toFixed(0)}  n ${String(slice.length).padStart(3)}   risk units ${rNorm ? rNorm.rho.toFixed(4).padStart(8) : "   n/a"}   dollars ${rDol ? rDol.rho.toFixed(4).padStart(8) : "   n/a"}`);
    if (rNorm) { wSum += rNorm.rho * rNorm.n; wN += rNorm.n; }
    if (rDol)  { wSumD += rDol.rho * rDol.n; }
  }
  if (wN > 0) {
    console.log(`  within-stratum average, risk units  ${(wSum / wN).toFixed(4)}`);
    console.log(`  within-stratum average, dollars     ${(wSumD / wN).toFixed(4)}`);
  }

  console.log(`\n=== 5. Split-half over wallets, seeded ===`);
  const rng = mulberry32(SEED);
  const shuffled = [...rows];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const mid = Math.floor(shuffled.length / 2);
  report("half A, risk units", shuffled.slice(0, mid).map((r) => ({ score: r.score, forwardPnl: r.fwdNorm })));
  report("half B, risk units", shuffled.slice(mid).map((r) => ({ score: r.score, forwardPnl: r.fwdNorm })));

  console.log(`\nNothing was written.`);
}

main();
