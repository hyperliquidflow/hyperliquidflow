// scripts/factor-rivals.ts
//
// What is the cohort lean actually made of, and does a dumber measurement say
// the same thing?
//
// An external review made the sharpest available criticism of the positioning
// factor: cohort lean and open-interest change could be close to the same
// measurement taken two ways, in which case the wallet layer contributes
// nothing and a far simpler rule would do. Momentum was tested and rejected,
// but the review correctly called momentum the wrong rival.
//
// Historical open interest is not available from the Hyperliquid info API:
// metaAndAssetCtxs reports it only as of now. Candle volume is, and it is the
// closest honest proxy for the same question, since OI change and traded
// volume both measure activity crowding into a coin. This tests volume level
// and volume change as rivals, alongside funding, and reports how much of the
// lean each one explains.
//
//   npx tsx --env-file=.env.local scripts/factor-rivals.ts
//   npx tsx --env-file=.env.local scripts/factor-rivals.ts --refresh-volume
//
// Reads the fill cache, fetches daily volume once and caches it. Writes no
// Supabase and no KV.

import * as fs from "fs/promises";
import { sampleRankCorrelation } from "simple-statistics";
import { fetchCandleSnapshot } from "../lib/hyperliquid-api-client";
import { priceAt, staleTolerance, describe } from "../lib/study-stats";
import { reconstructDailyLean, DAY_MS, type LeanFill } from "../lib/cohort-lean";

const CACHE_FILE = process.argv.find((a) => a.startsWith("--cache="))?.split("=")[1]
  ?? "fill-study-cache.json";
const VOLUME_FILE = "daily-volume-cache.json";
const FUNDING_FILE = "funding-cache.json";
const REFRESH = process.argv.includes("--refresh-volume");
const BURN_IN_DAYS = 14;
const MIN_LEAN_USD = 10_000;
const MIN_COINS = 6;
const GAP_MS = 400;

interface Fill extends LeanFill { p: number }
interface Cache {
  fetched_at: string; days: number; interval?: string;
  fills: Fill[];
  candles: Record<string, [number, number][]>;
}
const BAR_MINUTES: Record<string, number> = { "1m": 1, "5m": 5, "15m": 15, "1h": 60 };

/** Daily notional volume per coin: coin -> [dayStartMs, volumeUsd][]. */
async function loadVolume(coins: string[], from: number, to: number): Promise<Record<string, [number, number][]>> {
  if (!REFRESH) {
    try { return JSON.parse(await fs.readFile(VOLUME_FILE, "utf8")); } catch { /* fetch below */ }
  }
  const out: Record<string, [number, number][]> = {};
  for (const coin of coins) {
    try {
      const bars = (await fetchCandleSnapshot(coin, "1d", from, to)) as Array<{ t: number; v: string; c: string }>;
      // Volume arrives in coin units, so price it to make coins comparable.
      out[coin] = bars.map((b) => [Number(b.t), Number(b.v) * Number(b.c)] as [number, number]);
    } catch (e) {
      console.log(`[rivals] ${coin}: volume fetch failed (${(e as Error).message})`);
    }
    await new Promise((r) => setTimeout(r, GAP_MS));
  }
  await fs.writeFile(VOLUME_FILE, JSON.stringify(out));
  console.log(`[rivals] cached daily volume for ${Object.keys(out).length} coins`);
  return out;
}

/**
 * The last `n`-th daily bar that had fully closed before `cutoff`.
 *
 * Alignment matters more here than it looks. Day boundaries in this study are
 * anchored to the first fill, 13:11 UTC on the archived cache, while daily
 * candles are stamped at 00:00 UTC. Picking the candle whose stamp merely falls
 * inside a study day selects one that closes up to eleven hours after the entry
 * and therefore overlaps the forward return window: high volume during a large
 * move would then predict that same move. Requiring the bar to have closed
 * before entry removes it.
 */
function closedBefore(
  series: [number, number][] | undefined,
  cutoff: number,
  back = 0,
): number | null {
  if (!series) return null;
  const done = series.filter(([t]) => t + DAY_MS <= cutoff);
  const idx = done.length - 1 - back;
  return idx >= 0 ? done[idx][1] : null;
}

async function main() {
  const cache = JSON.parse(await fs.readFile(CACHE_FILE, "utf8")) as Cache;
  const { fills, candles } = cache;
  const tolMs = staleTolerance(BAR_MINUTES[cache.interval ?? "1m"] ?? 1);
  const px = (coin: string, t: number) => priceAt(candles[coin] ?? [], t, tolMs);

  const t0 = Math.min(...fills.map((f) => f.t));
  const t1 = Math.max(...fills.map((f) => f.t));
  const coins = Object.keys(candles);
  const volume = await loadVolume(coins, t0, t1);

  let funding: Record<string, [number, number][]> = {};
  try { funding = JSON.parse(await fs.readFile(FUNDING_FILE, "utf8")); } catch { /* optional */ }

  const byDay = reconstructDailyLean(fills, px);
  console.log(`[rivals] ${byDay.length} daily snapshots, ${coins.length} coins, burn-in ${BURN_IN_DAYS}d\n`);

  // Each candidate gets its own IC against next-day relative return, and its
  // rank correlation with the lean. A rival that both predicts and correlates
  // is the same measurement wearing a different name.
  const ics: Record<string, number[]> = { lean: [], volume: [], volChange: [], funding: [] };
  const vsLean: Record<string, number[]> = { volume: [], volChange: [], funding: [] };

  for (let day = BURN_IN_DAYS; day + 2 < byDay.length; day++) {
    const snap = byDay[day];
    const dayStart = t0 + day * DAY_MS;
    const entryT = t0 + (day + 1) * DAY_MS;
    const exitT = t0 + (day + 2) * DAY_MS;

    const rows: Array<{ lean: number; volume: number; volChange: number; funding: number; fwd: number }> = [];
    for (const [coin, net] of snap) {
      if (Math.abs(net) < MIN_LEAN_USD) continue;
      const pIn = px(coin, entryT), pOut = px(coin, exitT);
      if (pIn === null || pOut === null || pIn <= 0) continue;
      // Both volume bars must have closed before the entry, or the feature
      // would partly measure the return it is being tested against.
      const vNow = closedBefore(volume[coin], entryT, 0);
      const vPrev = closedBefore(volume[coin], entryT, 1);
      if (vNow === null || vPrev === null || vPrev <= 0) continue;
      // Mean hourly funding, restricted to settlements before entry.
      const fh = (funding[coin] ?? []).filter(([t]) => t >= dayStart && t < entryT);
      const fMean = fh.length ? fh.reduce((s, [, r]) => s + r, 0) / fh.length : 0;
      rows.push({
        lean: net,
        volume: vNow,
        volChange: (vNow - vPrev) / vPrev,
        funding: fMean,
        fwd: (pOut - pIn) / pIn,
      });
    }
    if (rows.length < MIN_COINS) continue;

    const meanFwd = rows.reduce((s, r) => s + r.fwd, 0) / rows.length;
    const fwd = rows.map((r) => r.fwd - meanFwd);

    for (const key of ["lean", "volume", "volChange", "funding"] as const) {
      const rho = sampleRankCorrelation(rows.map((r) => r[key]), fwd);
      if (Number.isFinite(rho)) ics[key].push(rho);
    }
    for (const key of ["volume", "volChange", "funding"] as const) {
      const rho = sampleRankCorrelation(rows.map((r) => r.lean), rows.map((r) => r[key]));
      if (Number.isFinite(rho)) vsLean[key].push(rho);
    }
  }

  console.log(`=== Each candidate's own IC against next-day relative return ===`);
  console.log(`  candidate  |  days |      IC |     se |     t`);
  console.log(`  -----------+-------+---------+--------+------`);
  for (const key of ["lean", "volume", "volChange", "funding"] as const) {
    const st = describe(ics[key]);
    if (!st) { console.log(`  ${key.padEnd(10)} | too few days`); continue; }
    console.log(
      `  ${key.padEnd(10)} | ${String(st.n).padStart(5)} | ${st.mean.toFixed(4).padStart(7)} | ` +
      `${st.se.toFixed(4).padStart(6)} | ${st.t.toFixed(2).padStart(5)}`
    );
  }

  console.log(`\n=== How much of the lean each rival explains ===`);
  console.log(`  A rival that both predicts and correlates with the lean is the same`);
  console.log(`  measurement under another name, and the simpler one should win.`);
  console.log(`  rival      | daily rank corr with lean`);
  console.log(`  -----------+--------------------------`);
  for (const key of ["volume", "volChange", "funding"] as const) {
    const st = describe(vsLean[key]);
    if (!st) continue;
    console.log(`  ${key.padEnd(10)} | ${st.mean.toFixed(3).padStart(6)}  (t ${st.t.toFixed(2)})`);
  }

  console.log(`\nNothing was written.`);
}

main().catch((e) => { console.error("[rivals] FAILED:", e.message); process.exit(1); });
