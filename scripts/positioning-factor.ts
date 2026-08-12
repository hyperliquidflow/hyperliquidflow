// scripts/positioning-factor.ts
//
// Copy exposure, not trades.
//
// The fill study killed entry copying: following this cohort into a trade is
// negative after benchmark and costs at every hold inside four hours and zero
// beyond, coordinated or not, even at zero latency. Entry copying demands
// immediacy, and by the time a fill prints, whatever the trader knew is in the
// price. Racing that costs 7 bps a round trip and wins nothing.
//
// But rank IC on wallet scoring is 0.0939 clean of lookahead, so the skilled
// wallets genuinely are positioned better than the unskilled ones. That is a
// statement about what they hold, not about when they trade. Holding is not a
// race. It amortises cost over days instead of paying a round trip per hour.
//
// So this asks a cross-sectional question instead of a timing one: on each day,
// rank coins by how hard the cohort leans into them, and ask whether that
// ranking predicts the next day's relative return. A long-short book over the
// top and bottom of that ranking is the tradeable form.
//
// Positions are reconstructed from fills rather than read from cohort_snapshots,
// because the snapshot table is sparse historically (one snapshot every 5 to 8
// hours through May and June, with a six-week hole) while fills are complete.
//
//   npx tsx --env-file=.env.local scripts/fill-study.ts --fetch --days=120 --interval=1h --pool=all
//   npx tsx --env-file=.env.local scripts/positioning-factor.ts
//
// Reads the fill-study cache. Writes nothing.

import * as fs from "fs/promises";
import { sampleRankCorrelation } from "simple-statistics";
import {
  priceAt,
  staleTolerance,
  describe as stats,
  trimmedMean,
  bootstrapMeanCI,
  fundingOverHold,
} from "../lib/study-stats";

const CACHE_FILE = "fill-study-cache.json";
const FUNDING_CACHE_FILE = "funding-cache.json";
const DAY_MS = 86_400_000;
const ROUND_TRIP_BPS = 7;

// Pre-registered full cost model (docs/research/2026-08-12-preregistration-leads.md).
// The 7 bps legacy constant stays on the original sections so their numbers
// remain comparable with the register history.
const FEE_BPS_SIDE  = 4.5;  // verified base-tier taker, 2026-08-12
const SLIP_BPS_SIDE = 5;    // haircut until a depth model exists
const RT = (2 * (FEE_BPS_SIDE + SLIP_BPS_SIDE)) / 10_000; // 19 bps per replaced name

interface Fill {
  w: string; c: string; p: number; s: number; t: number;
  d: 1 | -1; o: 0 | 1; pnl: number; sc: number;
}
interface Cache {
  fetched_at: string; days: number; interval?: string;
  fills: Fill[];
  candles: Record<string, [number, number][]>;
}
const BAR_MINUTES: Record<string, number> = { "1m": 1, "5m": 5, "15m": 15, "1h": 60 };

async function main() {
  const cache = JSON.parse(await fs.readFile(CACHE_FILE, "utf8")) as Cache;
  const { fills, candles } = cache;
  const closes = fills.filter((f) => f.o === 0).length;
  console.log(`[factor] ${fills.length} fills (${closes} closing), window ${cache.days}d, interval ${cache.interval}`);
  if (closes === 0) {
    console.error(`[factor] cache holds no closing fills, so positions cannot be reconstructed.`);
    console.error(`[factor] refetch with the current fill-study.ts first.`);
    process.exit(1);
  }

  let funding: Record<string, [number, number][]> = {};
  try {
    funding = JSON.parse(await fs.readFile(FUNDING_CACHE_FILE, "utf8"));
  } catch {
    console.log(`[factor] no ${FUNDING_CACHE_FILE}; the full-cost book will report 0% funding coverage`);
  }

  // One and a half bars, same rule as fill-study. On the 1h cache this is 90
  // minutes, identical to the tolerance every recorded run used.
  const tolMs = staleTolerance(BAR_MINUTES[cache.interval ?? "1m"] ?? 1);

  // ── Reconstruct signed size held per wallet per coin, walked forward ───────
  // An open adds to the position on its side, a close removes from it. The sum
  // over wallets at any instant is the cohort's net lean on that coin.
  const sorted = [...fills].sort((a, b) => a.t - b.t);
  const t0 = sorted[0].t, t1 = sorted[sorted.length - 1].t;
  const dayIndex = (t: number) => Math.floor((t - t0) / DAY_MS);
  const totalDays = dayIndex(t1);

  const pos = new Map<string, number>();                 // wallet|coin -> signed size
  // netByDay[day] -> coin -> signed notional, sampled at each day boundary
  const netByDay: Array<Map<string, number>> = [];
  let cursor = 0;

  for (let day = 0; day <= totalDays; day++) {
    const boundary = t0 + (day + 1) * DAY_MS;
    while (cursor < sorted.length && sorted[cursor].t < boundary) {
      const f = sorted[cursor++];
      const k = `${f.w}|${f.c}`;
      const delta = (f.o === 1 ? 1 : -1) * f.d * f.s;
      pos.set(k, (pos.get(k) ?? 0) + delta);
    }
    // Snapshot the cohort's net notional per coin at this boundary.
    const snap = new Map<string, number>();
    for (const [k, size] of pos) {
      if (Math.abs(size) < 1e-12) continue;
      const coin = k.slice(k.indexOf("|") + 1);
      const px = priceAt(candles[coin] ?? [], boundary, tolMs);
      if (px === null) continue;
      snap.set(coin, (snap.get(coin) ?? 0) + size * px);
    }
    netByDay.push(snap);
  }

  console.log(`[factor] reconstructed ${netByDay.length} daily snapshots across ${new Set(fills.map(f=>f.c)).size} coins, first 14 days discarded as burn-in\n`);

  // ── Cross-sectional test ──────────────────────────────────────────────────
  // Signal on day d: cohort net notional per coin, normalised by that coin's
  // gross so a big coin does not dominate purely on size. Outcome: the coin's
  // return from day d+1 boundary to day d+2 boundary. Rank correlate the two.
  const ics: number[] = [];
  const spreads: number[] = [];
  // Pre-registered full-cost book plus the dumb baseline, accumulated alongside.
  const fullSpreads: number[] = [];
  const momSpreads: number[] = [];
  const momIcs: number[] = [];
  const leanMomCorr: number[] = [];
  let prevLong = new Set<string>();
  let prevShort = new Set<string>();
  let fundCovPts = 0, fundCovExp = 0;
  // A solid IC with a marginal traded spread means the ranking knows something
  // the book is too concentrated to collect. Three names a side on a 20 to 30
  // coin cross section is a handful of positions carrying all the variance, so
  // the leg width is swept rather than assumed.
  const TOP_N = Number(process.argv.find((a) => a.startsWith("--legs="))?.split("=")[1] ?? 3);

  // Reconstruction starts every wallet flat, so a position opened before the
  // window and closed inside it registers as a phantom short. That error decays
  // as real opens accumulate, but it is worst at the start, so the opening
  // stretch is discarded rather than trusted.
  const BURN_IN_DAYS = 14;

  for (let day = BURN_IN_DAYS; day + 2 < netByDay.length; day++) {
    const snap = netByDay[day];
    const entryT = t0 + (day + 1) * DAY_MS;
    const exitT  = t0 + (day + 2) * DAY_MS;

    const rows: Array<{ coin: string; lean: number; fwd: number; mom: number | null }> = [];
    for (const [coin, net] of snap) {
      const gross = Math.abs(net);
      if (gross < 10_000) continue;                    // ignore dust leans
      const pIn  = priceAt(candles[coin] ?? [], entryT, tolMs);
      const pOut = priceAt(candles[coin] ?? [], exitT,  tolMs);
      if (pIn === null || pOut === null || pIn <= 0) continue;
      // Trailing one-day return: the dumb signal the lean has to beat.
      const pPrev = priceAt(candles[coin] ?? [], entryT - DAY_MS, tolMs);
      const mom = pPrev !== null && pPrev > 0 ? (pIn - pPrev) / pPrev : null;
      rows.push({ coin, lean: net, fwd: (pOut - pIn) / pIn, mom });
    }
    if (rows.length < 6) continue;

    // Demean the day's returns so this measures relative performance, not the
    // market. A long-short book is market neutral by construction anyway.
    const meanFwd = rows.reduce((s, r) => s + r.fwd, 0) / rows.length;
    for (const r of rows) r.fwd -= meanFwd;

    const rho = sampleRankCorrelation(rows.map((r) => r.lean), rows.map((r) => r.fwd));
    if (Number.isFinite(rho)) ics.push(rho);

    const byLean = [...rows].sort((a, b) => a.lean - b.lean);
    const k = Math.min(TOP_N, Math.floor(byLean.length / 2));
    if (k >= 1) {
      const longLeg  = byLean.slice(-k).reduce((s, r) => s + r.fwd, 0) / k;
      const shortLeg = byLean.slice(0, k).reduce((s, r) => s + r.fwd, 0) / k;
      // Both legs turn over daily, so charge the round trip on each.
      spreads.push(longLeg - shortLeg - 2 * ROUND_TRIP_BPS / 10_000);

      // FULL-COST book (pre-registered): same legs, but funding charged on
      // every held name (longs pay a positive rate, shorts receive it) and a
      // full round trip charged only on names that actually changed since
      // yesterday, so the fee reflects real turnover rather than assuming the
      // whole book is rebuilt daily.
      const longNames  = byLean.slice(-k).map((r) => r.coin);
      const shortNames = byLean.slice(0, k).map((r) => r.coin);
      let fundLong = 0, fundShort = 0;
      for (const c of longNames) {
        const f = fundingOverHold(funding[c] ?? [], entryT, exitT);
        fundLong += f.sum / k; fundCovPts += f.points; fundCovExp += f.expectedPoints;
      }
      for (const c of shortNames) {
        const f = fundingOverHold(funding[c] ?? [], entryT, exitT);
        fundShort += f.sum / k; fundCovPts += f.points; fundCovExp += f.expectedPoints;
      }
      const replaced =
        longNames.filter((c) => !prevLong.has(c)).length +
        shortNames.filter((c) => !prevShort.has(c)).length;
      const turnoverCost = prevLong.size === 0 ? 2 * RT : (replaced * RT) / k;
      fullSpreads.push((longLeg - shortLeg) - fundLong + fundShort - turnoverCost);
      prevLong = new Set(longNames);
      prevShort = new Set(shortNames);

      // Momentum baseline book: identical machinery, ranked by the trailing
      // one-day return instead of the cohort lean. Full daily turnover is
      // assumed for it, which flatters nobody.
      const momRows = rows.filter((r) => r.mom !== null) as Array<{ coin: string; lean: number; fwd: number; mom: number }>;
      if (momRows.length >= 6) {
        const byMom = [...momRows].sort((a, b) => a.mom - b.mom);
        const km = Math.min(TOP_N, Math.floor(byMom.length / 2));
        if (km >= 1) {
          const ml = byMom.slice(-km).reduce((s, r) => s + r.fwd, 0) / km;
          const ms = byMom.slice(0, km).reduce((s, r) => s + r.fwd, 0) / km;
          momSpreads.push(ml - ms - 2 * RT);
        }
        const rhoMom = sampleRankCorrelation(momRows.map((r) => r.mom), momRows.map((r) => r.fwd));
        if (Number.isFinite(rhoMom)) momIcs.push(rhoMom);
        const rhoLeanMom = sampleRankCorrelation(momRows.map((r) => r.lean), momRows.map((r) => r.mom));
        if (Number.isFinite(rhoLeanMom)) leanMomCorr.push(rhoLeanMom);
      }
    }
  }

  const icStat = stats(ics);
  console.log(`=== Daily cross-sectional IC: cohort lean vs next-day relative return ===`);
  if (icStat) {
    console.log(`  days measured ${icStat.n}`);
    console.log(`  mean IC       ${icStat.mean.toFixed(4)}   (se ${icStat.se.toFixed(4)}, t ${icStat.t.toFixed(2)})`);
    console.log(`  share of days positive ${(icStat.winRate * 100).toFixed(0)}%`);
  } else console.log(`  not enough days`);

  const spStat = stats(spreads);
  console.log(`\n=== Long-short book: top ${TOP_N} leaned-into vs bottom ${TOP_N}, daily rebalance ===`);
  if (spStat) {
    const annual = spStat.mean * 365 * 100;
    console.log(`  days traded   ${spStat.n}`);
    console.log(`  mean per day  ${(spStat.mean * 10_000).toFixed(1)} bps  (t ${spStat.t.toFixed(2)}, net of ${2 * ROUND_TRIP_BPS} bps costs)`);
    console.log(`  win rate      ${(spStat.winRate * 100).toFixed(0)}%`);
    console.log(`  naive annual  ${annual.toFixed(0)}%  (no compounding, no capacity limit, indicative only)`);
    const half = Math.floor(spreads.length / 2);
    const early = stats(spreads.slice(0, half)), late = stats(spreads.slice(half));
    if (early && late) {
      console.log(`  split-half    early ${(early.mean * 10_000).toFixed(1)} bps (t ${early.t.toFixed(2)}) / late ${(late.mean * 10_000).toFixed(1)} bps (t ${late.t.toFixed(2)})`);
    }
  } else console.log(`  not enough days`);

  const fullStat = stats(fullSpreads);
  console.log(`\n=== FULL-COST book (pre-registered): funding + ${(RT * 10_000).toFixed(0)} bps per replaced name ===`);
  if (fullStat) {
    const tm = trimmedMean(fullSpreads, 0.1);
    const ci = bootstrapMeanCI(fullSpreads, { iters: 2000, seed: 42 });
    console.log(`  days ${fullStat.n}  mean ${(fullStat.mean * 10_000).toFixed(1)} bps/day  t ${fullStat.t.toFixed(2)}  win ${(fullStat.winRate * 100).toFixed(0)}%`);
    console.log(`  trimmed10 ${tm === null ? "n/a" : (tm * 10_000).toFixed(1)} bps  boot95 [${ci ? `${(ci.lo * 10_000).toFixed(1)}, ${(ci.hi * 10_000).toFixed(1)}` : "n/a"}] bps`);
    console.log(`  funding coverage ${fundCovExp > 0 ? ((fundCovPts / fundCovExp) * 100).toFixed(0) : 0}% of expected settlements`);
    const half = Math.floor(fullSpreads.length / 2);
    const e = stats(fullSpreads.slice(0, half)), l = stats(fullSpreads.slice(half));
    if (e && l) {
      console.log(`  split-half    early ${(e.mean * 10_000).toFixed(1)} bps (t ${e.t.toFixed(2)}) / late ${(l.mean * 10_000).toFixed(1)} bps (t ${l.t.toFixed(2)})`);
    }
  } else console.log(`  not enough days`);

  const momIcStat = stats(momIcs);
  const momSpStat = stats(momSpreads);
  const lmStat = stats(leanMomCorr);
  console.log(`\n=== Momentum baseline: the dumb alternative the lean has to beat ===`);
  if (momIcStat) console.log(`  momentum IC   ${momIcStat.mean.toFixed(4)}   (se ${momIcStat.se.toFixed(4)}, t ${momIcStat.t.toFixed(2)})`);
  if (momSpStat) console.log(`  momentum book ${(momSpStat.mean * 10_000).toFixed(1)} bps/day  (t ${momSpStat.t.toFixed(2)}, full turnover charged)`);
  if (lmStat) console.log(`  daily rank corr(lean, momentum) ${lmStat.mean.toFixed(3)}: how much of the lean is chasing yesterday`);

  console.log(`\nNothing was written.`);
}

main().catch((e) => { console.error("[factor] FAILED:", e.message); process.exit(1); });
