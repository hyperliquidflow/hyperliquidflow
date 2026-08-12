// scripts/signal-stack.ts
//
// Signals as features, not as competing trading systems.
//
// Every test so far asked one hypothesis to be a trading system on its own and
// judged it pass or fail. That is the wrong frame for weak signals. A feature
// with an information coefficient of 0.03 is useless alone and genuinely
// valuable in combination, provided it is not saying the same thing as its
// neighbours. Judging each in isolation guarantees they all "fail" and throws
// away the part that would have worked together.
//
// So this stops asking "does X beat costs" and starts asking "what does X know,
// and does the stack of them know more than any one".
//
// Each feature is computed per coin per day, standardised across coins that day
// so the pieces are comparable, and scored against the next day's cross
// sectional return with the day's mean removed. Reported per feature: rank IC.
// Then the combination, plus the correlation between features, because two
// features saying the same thing do not add.
//
// Costs are charged only on the tradeable long-short version at the end. The
// ICs above it are diagnostics, not claims of profit.
//
//   npx tsx --env-file=.env.local scripts/signal-stack.ts
//
// Reads the fill-study cache. Writes nothing.

import * as fs from "fs/promises";
import { sampleRankCorrelation } from "simple-statistics";
import { scoreFromDailyPnls } from "../lib/skill-test";
import {
  priceAt as priceAtBar,
  staleTolerance,
  describe as summarise,
  zscore,
} from "../lib/study-stats";

const CACHE_FILE = "fill-study-cache.json";
const DAY_MS = 86_400_000;
const ROUND_TRIP_BPS = 7;
const BURN_IN_DAYS = 14;
const SCORE_LOOKBACK_DAYS = 60;
const SCORE_MIN_ACTIVE_DAYS = 5;
const MIN_COINS_PER_DAY = 8;
const FUNDING_CACHE = "funding-cache.json";
const HL_URL = process.env.HYPERLIQUID_API_URL ?? "https://api.hyperliquid.xyz/info";

interface Fill {
  w: string; c: string; p: number; s: number; t: number;
  d: 1 | -1; o: 0 | 1; pnl: number; sc: number;
}
interface Cache {
  fetched_at: string; days: number; interval?: string;
  fills: Fill[];
  candles: Record<string, [number, number][]>;
}

// Bars are hourly on the long runs, so the staleness tolerance scales to that
// rather than sitting at a fixed ten minutes, which silently drops samples.
const TOL_MS = staleTolerance(60);
const priceAt = (series: [number, number][], t: number) => priceAtBar(series, t, TOL_MS);

// Feature names in a fixed order so the correlation matrix reads consistently.
const FEATURES = [
  "lean",        // level of cohort net exposure
  "leanFlow",    // change in that exposure, which is flow rather than level
  "entryFlow",   // net opening notional, the entry-copy signal as a feature
  "strongFlow",  // net opening notional from top-scored wallets only
  "weakFade",    // net opening notional from bottom-scored wallets, sign flipped
  "breadth",     // distinct wallets involved, the coordination signal as a feature
  "fundingFade", // funding rate, sign flipped: pay to hold means crowded
] as const;
type FeatureName = typeof FEATURES[number];

/**
 * Funding rate per coin per day, sign flipped so a positive feature means
 * "crowded the other way".
 *
 * Every other feature here is derived from the cohort, so they risk all saying
 * one thing: what these 60 wallets are doing. Funding is market wide and
 * mechanical. Longs paying shorts means positioning is crowded long, which is a
 * read on the whole book rather than on our sample, and it needs nobody to be
 * skilled. That independence is the point: features that agree do not stack.
 */
async function loadFunding(coins: string[], startMs: number, endMs: number): Promise<Map<string, Map<number, number>>> {
  let cached: Record<string, Array<[number, number]>> = {};
  try {
    cached = JSON.parse(await fs.readFile(FUNDING_CACHE, "utf8"));
  } catch { /* first run */ }

  const missing = coins.filter((c) => !cached[c]);
  if (missing.length) {
    console.log(`[stack] fetching funding history for ${missing.length} coins...`);
    for (const coin of missing) {
      const series: Array<[number, number]> = [];
      let cursor = startMs;
      for (let page = 0; page < 30; page++) {
        try {
          const res = await fetch(HL_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "fundingHistory", coin, startTime: cursor, endTime: endMs }),
          });
          if (!res.ok) break;
          const rows = (await res.json()) as Array<{ time: number; fundingRate: string }>;
          if (!rows?.length) break;
          let newest = cursor;
          for (const r of rows) {
            const t = Number(r.time), v = parseFloat(r.fundingRate);
            if (Number.isFinite(t) && Number.isFinite(v)) { series.push([t, v]); if (t > newest) newest = t; }
          }
          if (newest <= cursor) break;
          cursor = newest + 1;
          if (cursor >= endMs) break;
        } catch { break; }
        await new Promise((r) => setTimeout(r, 250));
      }
      cached[coin] = series;
    }
    await fs.writeFile(FUNDING_CACHE, JSON.stringify(cached));
  }

  // Collapse to a mean rate per coin per absolute day.
  const out = new Map<string, Map<number, number>>();
  for (const [coin, series] of Object.entries(cached)) {
    const byDay = new Map<number, number[]>();
    for (const [t, v] of series) {
      const d = Math.floor(t / DAY_MS);
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d)!.push(v);
    }
    const m = new Map<number, number>();
    for (const [d, vs] of byDay) m.set(d, vs.reduce((a, b) => a + b, 0) / vs.length);
    out.set(coin, m);
  }
  return out;
}

async function main() {
  const cache = JSON.parse(await fs.readFile(CACHE_FILE, "utf8")) as Cache;
  const { fills, candles } = cache;
  const closes = fills.filter((f) => f.o === 0).length;
  console.log(`[stack] ${fills.length} fills (${closes} closing), ${cache.days}d, interval ${cache.interval}`);
  if (closes === 0) {
    console.error(`[stack] cache has no closing fills. Refetch with the current fill-study.ts.`);
    process.exit(1);
  }

  const sorted = [...fills].sort((a, b) => a.t - b.t);
  const t0 = sorted[0].t;
  const dayOfAbs = (t: number) => Math.floor(t / DAY_MS);
  const dayIdx = (t: number) => Math.floor((t - t0) / DAY_MS);
  const totalDays = dayIdx(sorted[sorted.length - 1].t);

  // ── Point-in-time wallet scores, rebuilt from realized PnL ────────────────
  const pnlByWalletDay = new Map<string, Map<number, number>>();
  for (const f of fills) {
    if (f.o !== 0 || !Number.isFinite(f.pnl) || f.pnl === 0) continue;
    if (!pnlByWalletDay.has(f.w)) pnlByWalletDay.set(f.w, new Map());
    const m = pnlByWalletDay.get(f.w)!;
    const d = dayOfAbs(f.t);
    m.set(d, (m.get(d) ?? 0) + f.pnl);
  }
  const scoreCache = new Map<string, number | null>();
  function scoreAsOf(wallet: string, t: number): number | null {
    const today = dayOfAbs(t);
    const key = `${wallet}|${today}`;
    if (scoreCache.has(key)) return scoreCache.get(key)!;
    const m = pnlByWalletDay.get(wallet);
    let out: number | null = null;
    if (m) {
      const series: number[] = [];
      let active = 0;
      for (let d = today - SCORE_LOOKBACK_DAYS; d < today; d++) {
        const v = m.get(d) ?? 0;
        series.push(v);
        if (v !== 0) active++;
      }
      if (active >= SCORE_MIN_ACTIVE_DAYS) out = scoreFromDailyPnls(series);
    }
    scoreCache.set(key, out);
    return out;
  }

  // ── Walk fills forward, building per-coin-per-day features ────────────────
  const pos = new Map<string, number>();                       // wallet|coin -> signed size
  type DayFeat = Map<string, Record<FeatureName, number>>;     // coin -> features
  const byDay: DayFeat[] = [];
  let prevLean = new Map<string, number>();
  let cursor = 0;

  for (let day = 0; day <= totalDays; day++) {
    const boundary = t0 + (day + 1) * DAY_MS;
    const dayStart = t0 + day * DAY_MS;

    const entryNotional = new Map<string, number>();
    const strongNotional = new Map<string, number>();
    const weakNotional = new Map<string, number>();
    const walletsPerCoin = new Map<string, Set<string>>();

    while (cursor < sorted.length && sorted[cursor].t < boundary) {
      const f = sorted[cursor++];
      pos.set(`${f.w}|${f.c}`, (pos.get(`${f.w}|${f.c}`) ?? 0) + (f.o === 1 ? 1 : -1) * f.d * f.s);
      if (f.o !== 1 || f.t < dayStart) continue;

      const notional = f.p * f.s * f.d;
      entryNotional.set(f.c, (entryNotional.get(f.c) ?? 0) + notional);
      if (!walletsPerCoin.has(f.c)) walletsPerCoin.set(f.c, new Set());
      walletsPerCoin.get(f.c)!.add(f.w);

      const sc = scoreAsOf(f.w, f.t);
      if (sc !== null) {
        // Split at the midpoint of the score's own [0,1] range rather than a
        // fitted cut, so this is not a threshold chosen against the outcome.
        if (sc >= 0.5) strongNotional.set(f.c, (strongNotional.get(f.c) ?? 0) + notional);
        else weakNotional.set(f.c, (weakNotional.get(f.c) ?? 0) + notional);
      }
    }

    const lean = new Map<string, number>();
    for (const [k, size] of pos) {
      if (Math.abs(size) < 1e-12) continue;
      const coin = k.slice(k.indexOf("|") + 1);
      const px = priceAt(candles[coin] ?? [], boundary);
      if (px === null) continue;
      lean.set(coin, (lean.get(coin) ?? 0) + size * px);
    }

    const feats: DayFeat = new Map();
    for (const coin of new Set([...lean.keys(), ...entryNotional.keys()])) {
      if (!candles[coin]?.length) continue;
      feats.set(coin, {
        lean:       lean.get(coin) ?? 0,
        leanFlow:   (lean.get(coin) ?? 0) - (prevLean.get(coin) ?? 0),
        entryFlow:  entryNotional.get(coin) ?? 0,
        strongFlow: strongNotional.get(coin) ?? 0,
        weakFade:   -(weakNotional.get(coin) ?? 0),          // fade: take the other side
        breadth:    (walletsPerCoin.get(coin)?.size ?? 0) * Math.sign(entryNotional.get(coin) ?? 0),
        fundingFade: 0,   // filled in after the walk
      });
    }
    byDay.push(feats);
    prevLean = lean;
  }

  const coinList = [...new Set(fills.map((f) => f.c))].filter((c) => candles[c]?.length);
  const funding = await loadFunding(coinList, t0, t0 + (totalDays + 2) * DAY_MS);

  // Attach funding after the walk, since it is fetched per coin rather than
  // accumulated from fills.
  for (let day = 0; day < byDay.length; day++) {
    const absDay = Math.floor((t0 + day * DAY_MS) / DAY_MS);
    for (const [coin, f] of byDay[day]) {
      f.fundingFade = -(funding.get(coin)?.get(absDay) ?? 0);
    }
  }

  console.log(`[stack] ${byDay.length} days built, first ${BURN_IN_DAYS} discarded as burn-in`);
  console.log(`[stack] funding loaded for ${[...funding.keys()].length} coins\n`);

  // ── Per-day cross section: standardise features, measure IC ───────────────
  const icByFeature: Record<string, number[]> = Object.fromEntries(FEATURES.map((f) => [f, []]));
  const icCombined: number[] = [];
  const spreadCombined: number[] = [];
  const featureSamples: Record<string, number[]> = Object.fromEntries(FEATURES.map((f) => [f, []]));
  const TOP_N = 3;

  for (let day = BURN_IN_DAYS; day + 2 < byDay.length; day++) {
    const feats = byDay[day];
    const entryT = t0 + (day + 1) * DAY_MS;
    const exitT  = t0 + (day + 2) * DAY_MS;

    const coins: string[] = [];
    const fwd: number[] = [];
    const raw: Record<FeatureName, number[]> = Object.fromEntries(
      FEATURES.map((f) => [f, [] as number[]])
    ) as Record<FeatureName, number[]>;

    for (const [coin, f] of feats) {
      const pIn = priceAt(candles[coin] ?? [], entryT);
      const pOut = priceAt(candles[coin] ?? [], exitT);
      if (pIn === null || pOut === null || pIn <= 0) continue;
      coins.push(coin);
      fwd.push((pOut - pIn) / pIn);
      for (const name of FEATURES) raw[name].push(f[name]);
    }
    if (coins.length < MIN_COINS_PER_DAY) continue;

    // Market neutral: remove the day's mean so this measures relative moves.
    const meanFwd = fwd.reduce((a, b) => a + b, 0) / fwd.length;
    const rel = fwd.map((v) => v - meanFwd);

    const z: Record<FeatureName, number[]> = Object.fromEntries(
      FEATURES.map((name) => [name, zscore(raw[name])])
    ) as Record<FeatureName, number[]>;

    for (const name of FEATURES) {
      const rho = sampleRankCorrelation(z[name], rel);
      if (Number.isFinite(rho)) icByFeature[name].push(rho);
      featureSamples[name].push(...z[name]);
    }

    // Equal weight is the honest default. Weighting by measured IC fits the
    // weights on the same data the IC came from, which inflates the result.
    const combined = coins.map((_, i) => FEATURES.reduce((s, name) => s + z[name][i], 0) / FEATURES.length);
    const rhoC = sampleRankCorrelation(combined, rel);
    if (Number.isFinite(rhoC)) icCombined.push(rhoC);

    const order = combined.map((v, i) => ({ v, r: rel[i] })).sort((a, b) => a.v - b.v);
    const k = Math.min(TOP_N, Math.floor(order.length / 2));
    if (k >= 1) {
      const longLeg = order.slice(-k).reduce((s, o) => s + o.r, 0) / k;
      const shortLeg = order.slice(0, k).reduce((s, o) => s + o.r, 0) / k;
      spreadCombined.push(longLeg - shortLeg - 2 * ROUND_TRIP_BPS / 10_000);
    }
  }

  console.log(`=== Feature information coefficients, next-day relative return ===`);
  console.log(`feature    |   mean IC |     se |    t | days`);
  console.log(`-----------+-----------+--------+------+------`);
  for (const name of FEATURES) {
    const st = summarise(icByFeature[name]);
    if (!st) { console.log(`${name.padEnd(10)} |       n/a`); continue; }
    console.log(
      `${name.padEnd(10)} | ${st.mean.toFixed(4).padStart(9)} | ${st.se.toFixed(4).padStart(6)} | ` +
      `${st.t.toFixed(1).padStart(4)} | ${String(st.n).padStart(4)}`
    );
  }
  const stC = summarise(icCombined);
  if (stC) {
    console.log(`-----------+-----------+--------+------+------`);
    console.log(
      `${"COMBINED".padEnd(10)} | ${stC.mean.toFixed(4).padStart(9)} | ${stC.se.toFixed(4).padStart(6)} | ` +
      `${stC.t.toFixed(1).padStart(4)} | ${String(stC.n).padStart(4)}`
    );
  }

  // Two features that say the same thing do not add. This is what decides
  // whether stacking is worth anything.
  console.log(`\n=== Feature correlation (do they say different things) ===`);
  console.log(`           |` + FEATURES.map((f) => f.slice(0, 9).padStart(10)).join(""));
  for (const a of FEATURES) {
    const cells = FEATURES.map((b) => {
      const n = Math.min(featureSamples[a].length, featureSamples[b].length);
      if (n < 50) return "n/a".padStart(10);
      const rho = sampleRankCorrelation(featureSamples[a].slice(0, n), featureSamples[b].slice(0, n));
      return (Number.isFinite(rho) ? rho.toFixed(2) : "n/a").padStart(10);
    });
    console.log(`${a.padEnd(10)} |` + cells.join(""));
  }

  const sp = summarise(spreadCombined);
  console.log(`\n=== Combined stack traded long-short, top ${TOP_N} vs bottom ${TOP_N}, daily ===`);
  if (sp) {
    console.log(`  days          ${sp.n}`);
    console.log(`  mean per day  ${(sp.mean * 10_000).toFixed(1)} bps  (t ${sp.t.toFixed(2)}, net of ${2 * ROUND_TRIP_BPS} bps)`);
    console.log(`  win rate      ${(sp.winRate * 100).toFixed(0)}%`);
    const half = Math.floor(spreadCombined.length / 2);
    const e = summarise(spreadCombined.slice(0, half)), l = summarise(spreadCombined.slice(half));
    if (e && l) {
      console.log(`  split-half    early ${(e.mean * 10_000).toFixed(1)} bps (t ${e.t.toFixed(2)}) / late ${(l.mean * 10_000).toFixed(1)} bps (t ${l.t.toFixed(2)})`);
    }
  } else console.log(`  not enough days`);

  console.log(`\nNothing was written.`);
}

main().catch((e) => { console.error("[stack] FAILED:", e.message); process.exit(1); });
