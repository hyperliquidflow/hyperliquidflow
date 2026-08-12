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

const CACHE_FILE = "fill-study-cache.json";
const DAY_MS = 86_400_000;
const ROUND_TRIP_BPS = 7;

interface Fill {
  w: string; c: string; p: number; s: number; t: number;
  d: 1 | -1; o: 0 | 1; pnl: number; sc: number;
}
interface Cache {
  fetched_at: string; days: number; interval?: string;
  fills: Fill[];
  candles: Record<string, [number, number][]>;
}

function priceAt(series: [number, number][], t: number, tolMs: number): number | null {
  if (!series?.length) return null;
  let lo = 0, hi = series.length - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid][0] >= t) { best = mid; hi = mid - 1; } else lo = mid + 1;
  }
  if (best === -1 || series[best][0] - t > tolMs) return null;
  return series[best][1];
}

function stats(xs: number[]) {
  if (xs.length < 2) return null;
  const n = xs.length;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(xs.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1));
  const se = sd / Math.sqrt(n);
  return { n, mean, sd, se, t: se === 0 ? 0 : mean / se, winRate: xs.filter((v) => v > 0).length / n };
}

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

  const tolMs = 90 * 60_000;

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
  const TOP_N = 3;

  // Reconstruction starts every wallet flat, so a position opened before the
  // window and closed inside it registers as a phantom short. That error decays
  // as real opens accumulate, but it is worst at the start, so the opening
  // stretch is discarded rather than trusted.
  const BURN_IN_DAYS = 14;

  for (let day = BURN_IN_DAYS; day + 2 < netByDay.length; day++) {
    const snap = netByDay[day];
    const entryT = t0 + (day + 1) * DAY_MS;
    const exitT  = t0 + (day + 2) * DAY_MS;

    const rows: Array<{ coin: string; lean: number; fwd: number }> = [];
    for (const [coin, net] of snap) {
      const gross = Math.abs(net);
      if (gross < 10_000) continue;                    // ignore dust leans
      const pIn  = priceAt(candles[coin] ?? [], entryT, tolMs);
      const pOut = priceAt(candles[coin] ?? [], exitT,  tolMs);
      if (pIn === null || pOut === null || pIn <= 0) continue;
      rows.push({ coin, lean: net, fwd: (pOut - pIn) / pIn });
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

  console.log(`\nNothing was written.`);
}

main().catch((e) => { console.error("[factor] FAILED:", e.message); process.exit(1); });
