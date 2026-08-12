// scripts/fill-study.ts
//
// Does following this cohort into a trade make money, and how fast does the
// opportunity decay?
//
// The project has been trying to answer that forward, one graded signal at a
// time, at roughly 1 signal a day. At the measured outcome sd of 195 bps that
// path needs 331 outcomes to detect a 30 bps edge, which is six months. It can
// only confirm an edge around +90 bps, which is larger than a whale-following
// edge has any business being.
//
// The same question is answerable backwards, right now. Every fill the cohort
// has made is public and the daily scan already downloads it, then reduces it
// to a win rate and throws the rest away. A fill carries coin, side, size,
// price, and a timestamp to the second. Join that against minute candles and
// each fill becomes one observation of "the cohort bought here, then what?".
// Thousands of observations instead of nine.
//
// Two phases. --fetch downloads fills and candles once and caches them to disk.
// Analysis reads the cache, so a new hypothesis costs a re-slice, not a
// re-download. That is the point: the cost of asking a question should be
// minutes, not a quarter.
//
//   npx tsx --env-file=.env.local scripts/fill-study.ts --fetch --days=7
//   npx tsx --env-file=.env.local scripts/fill-study.ts
//
// Nothing is written to Supabase or KV. The cache file is local and gitignored.

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs/promises";
import { toReturns, alignReturns, computeBeta, BETA_MIN_SAMPLE } from "../lib/beta";

const SUPABASE_URL              = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const HL_URL = process.env.HYPERLIQUID_API_URL ?? "https://api.hyperliquid.xyz/info";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("FATAL: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CACHE_FILE   = "fill-study-cache.json";
const DO_FETCH     = process.argv.includes("--fetch");
const DAYS         = Number(process.argv.find((a) => a.startsWith("--days="))?.split("=")[1] ?? 7);
const MAX_WALLETS  = Number(process.argv.find((a) => a.startsWith("--wallets="))?.split("=")[1] ?? 400);
const TOP_COINS    = Number(process.argv.find((a) => a.startsWith("--coins="))?.split("=")[1] ?? 25);
const REQUEST_GAP  = Number(process.argv.find((a) => a.startsWith("--gap="))?.split("=")[1] ?? 250);

// candleSnapshot returns at most ~5,000 candles and silently truncates to the
// most recent ones rather than erroring. A 7-day 1m request therefore came back
// covering only the last 3.6 days, which put old fills outside the candle span
// entirely: they resolved at long horizons and not at short ones, so each row
// of the decay table was computed on a different set of trades. The window is
// now held under the cap in a single request per coin, so a coin either has
// full coverage or none.
const CANDLE_CAP    = 5_000;
// Candles must run past the last fill by the longest thing measured on it,
// otherwise fullyCovered quietly discards every recent entry and the sample
// skews old. Derived rather than hardcoded so widening HOLDS cannot outgrow it.
const MAX_LATENCY_MIN = 60;
const MAX_HOLD_MIN    = 4320;
const FORWARD_BUFFER_MIN = MAX_LATENCY_MIN + MAX_HOLD_MIN + 60;

/**
 * Minutes per bar by interval, and the calendar window each can reach inside
 * the ~5,000 bar cap. Measured against the live API on 2026-08-11:
 *   1m -> 3.5d, 5m -> 17.4d, 15m -> 52.1d, 1h -> 208.3d
 * Finer bars resolve latency, coarser bars buy sample. Nothing resolves both,
 * so the latency question and the hold question want separate runs.
 */
const BAR_MINUTES: Record<string, number> = { "1m": 1, "5m": 5, "15m": 15, "1h": 60 };
const INTERVAL = process.argv.find((a) => a.startsWith("--interval="))?.split("=")[1] ?? "1m";

/**
 * userFillsByTime returns at most 2,000 fills per call, oldest first from
 * startTime, and gives no indication that it truncated. A busy wallet can spend
 * that budget in under a quarter of a day, so a single call over a long window
 * silently yields only the oldest sliver of that wallet's history. Paginate by
 * walking startTime forward past the newest fill seen.
 */
const FILL_PAGE_CAP  = 2_000;
const MAX_FILL_PAGES = 40;

// Round-trip taker cost. Hyperliquid taker is 3.5 bps a side, so 7 bps in and
// out, before any market impact.
const ROUND_TRIP_BPS = 7;

interface Fill {
  w: string;      // wallet id
  c: string;      // coin
  p: number;      // fill price
  s: number;      // size
  t: number;      // ms timestamp
  d: 1 | -1;      // 1 = opening long, -1 = opening short
  sc: number;     // wallet overall_score at scan time
}

interface Cache {
  fetched_at: string;
  days: number;
  interval?: string;
  fills: Fill[];
  candles: Record<string, [number, number][]>; // coin -> [ms, close][] ascending
}

/**
 * Rate-limit handling has to be patient rather than merely slow. A wallet that
 * needs many pages issues many calls, so it is likelier to exhaust retries and
 * be dropped, which biases the sample against exactly the busiest traders the
 * study is about. Retries are generous and every give-up is counted so the bias
 * is visible in the output instead of silent.
 */
let droppedCalls = 0;

async function hl<T>(body: unknown, attempt = 0): Promise<T> {
  let res: Response;
  try {
    res = await fetch(HL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    if (attempt < 7) {
      await new Promise((r) => setTimeout(r, Math.min(30_000, 500 * 2 ** attempt)));
      return hl<T>(body, attempt + 1);
    }
    droppedCalls++;
    throw e;
  }
  if ((res.status === 429 || res.status >= 500) && attempt < 7) {
    await new Promise((r) => setTimeout(r, Math.min(30_000, 500 * 2 ** attempt)));
    return hl<T>(body, attempt + 1);
  }
  if (!res.ok) {
    droppedCalls++;
    throw new Error(`Hyperliquid ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ── Fetch ────────────────────────────────────────────────────────────────────

async function fetchAll(): Promise<Cache> {
  const end   = Date.now();
  const start = end - DAYS * 24 * 3600_000;

  // The active cohort is ~98 wallets, which is what limited the first run to
  // 269 episodes. Thousands more have been discovered and scored and still have
  // public fill history, and whether they are active today has no bearing on
  // what their past trades did next. --pool=all widens to every wallet the scan
  // has ever scored.
  const POOL = process.argv.find((a) => a.startsWith("--pool="))?.split("=")[1] ?? "active";
  let query = supabase.from("wallets").select("id, address");
  if (POOL === "active") query = query.eq("is_active", true);
  else query = query.not("last_scanned_at", "is", null);
  const { data: wallets, error } = await query
    .order("last_scanned_at", { ascending: false })
    .limit(MAX_WALLETS);
  if (error) throw new Error(`wallet query: ${error.message}`);
  console.log(`[fill-study] pool=${POOL}, ${wallets?.length ?? 0} wallets, interval=${INTERVAL}`);

  const ids = (wallets ?? []).map((w) => w.id as string);
  const { data: snaps } = await supabase
    .from("cohort_snapshots")
    .select("wallet_id, overall_score, snapshot_time")
    .in("wallet_id", ids)
    .order("snapshot_time", { ascending: false })
    .limit(30000);
  const scoreByWallet = new Map<string, number>();
  for (const s of snaps ?? []) {
    if (!scoreByWallet.has(s.wallet_id)) scoreByWallet.set(s.wallet_id, Number(s.overall_score ?? 0));
  }

  console.log(`[fill-study] fetching ${DAYS}d of fills for ${wallets?.length ?? 0} wallets...`);
  const fills: Fill[] = [];
  let done = 0;

  let truncatedWallets = 0;
  let failedWallets = 0;

  for (const w of wallets ?? []) {
    try {
      // Walk startTime forward until a page comes back short of the cap.
      // Dedup by tid because a page boundary can land inside a group of fills
      // sharing a millisecond, and advancing the cursor past them would drop
      // trades while advancing to them exactly would loop forever.
      const raw: Array<Record<string, unknown>> = [];
      const seenTid = new Set<number>();
      let cursor = start;
      let pages = 0;
      for (; pages < MAX_FILL_PAGES; pages++) {
        const page = await hl<Array<Record<string, unknown>>>({
          type: "userFillsByTime",
          user: w.address,
          startTime: cursor,
          endTime: end,
        });
        if (!page?.length) break;
        let newest = cursor;
        for (const f of page) {
          const tid = Number(f.tid);
          if (Number.isFinite(tid) && seenTid.has(tid)) continue;
          if (Number.isFinite(tid)) seenTid.add(tid);
          raw.push(f);
          const t = Number(f.time);
          if (Number.isFinite(t) && t > newest) newest = t;
        }
        if (page.length < FILL_PAGE_CAP) break;
        if (newest <= cursor) break;   // no forward progress, stop rather than spin
        cursor = newest;
        await new Promise((r) => setTimeout(r, REQUEST_GAP));
      }
      if (pages >= MAX_FILL_PAGES) truncatedWallets++;

      for (const f of raw ?? []) {
        const dir = String(f.dir ?? "");
        // Opening fills only. A close is the cohort leaving a trade, which is a
        // different hypothesis and gets its own slice later.
        if (!dir.startsWith("Open")) continue;
        const p = parseFloat(String(f.px));
        const s = parseFloat(String(f.sz));
        const t = Number(f.time);
        if (!Number.isFinite(p) || !Number.isFinite(s) || !Number.isFinite(t)) continue;
        fills.push({
          w: w.id, c: String(f.coin), p, s, t,
          d: dir.includes("Long") ? 1 : -1,
          sc: scoreByWallet.get(w.id) ?? 0,
        });
      }
    } catch (e) {
      failedWallets++;
      console.warn(`[fill-study] fills failed for ${w.address.slice(0, 10)}: ${(e as Error).message}`);
    }
    done++;
    if (done % 50 === 0) console.log(`[fill-study]   ${done}/${wallets?.length} wallets, ${fills.length} opening fills`);
    await new Promise((r) => setTimeout(r, REQUEST_GAP));
  }

  // Only fetch candles for coins that carry enough fills to say anything.
  const byCoin = new Map<string, number>();
  for (const f of fills) byCoin.set(f.c, (byCoin.get(f.c) ?? 0) + 1);
  const coins = [...byCoin.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_COINS).map(([c]) => c);
  const dropped = fills.length - fills.filter((f) => coins.includes(f.c)).length;
  console.log(`[fill-study] ${fills.length} opening fills across ${byCoin.size} coins`);
  console.log(`[fill-study] keeping top ${coins.length} coins, dropping ${dropped} fills on thinner coins`);

  if (truncatedWallets > 0) {
    console.warn(`[fill-study] ${truncatedWallets} wallets hit the ${MAX_FILL_PAGES}-page ceiling and are incomplete`);
  }
  if (failedWallets > 0 || droppedCalls > 0) {
    console.warn(
      `[fill-study] ${failedWallets} wallets failed outright, ${droppedCalls} calls gave up after retries. ` +
      `Busy wallets need more calls, so drops skew the sample away from active traders.`
    );
  }

  const barMin = BAR_MINUTES[INTERVAL];
  if (!barMin) {
    console.error(`[fill-study] FATAL: unknown interval ${INTERVAL}. Use one of ${Object.keys(BAR_MINUTES).join(", ")}`);
    process.exit(1);
  }
  const candleEnd = end + FORWARD_BUFFER_MIN * MIN;
  const requestedBars = Math.ceil((candleEnd - start) / MIN / barMin);
  if (requestedBars > CANDLE_CAP) {
    const maxDays = Math.floor((CANDLE_CAP * barMin - FORWARD_BUFFER_MIN) / 1440);
    console.error(
      `[fill-study] FATAL: ${requestedBars} ${INTERVAL} bars requested per coin, cap is ${CANDLE_CAP}. ` +
      `Hyperliquid truncates silently, which breaks horizon comparability. ` +
      `At ${INTERVAL} the window ceiling is ${maxDays}d, so use --days=${maxDays} or a coarser --interval.`
    );
    process.exit(1);
  }

  const candles: Record<string, [number, number][]> = {};
  for (const coin of coins) {
    const series: [number, number][] = [];
    try {
      const raw = await hl<Array<Record<string, unknown>>>({
        type: "candleSnapshot",
        req: { coin, interval: INTERVAL, startTime: start, endTime: candleEnd },
      });
      for (const c of raw ?? []) {
        const t = Number(c.t);
        const close = parseFloat(String(c.c));
        if (Number.isFinite(t) && Number.isFinite(close)) series.push([t, close]);
      }
    } catch (e) {
      console.warn(`[fill-study] candles failed ${coin}: ${(e as Error).message}`);
    }
    series.sort((a, b) => a[0] - b[0]);
    candles[coin] = series;

    const coverage = series.length / requestedBars;
    const flag = coverage < 0.9 ? "  <- thin, fills outside the span are dropped in analysis" : "";
    console.log(`[fill-study]   ${coin}: ${series.length} ${INTERVAL} bars, ${(coverage * 100).toFixed(0)}% coverage${flag}`);
    await new Promise((r) => setTimeout(r, REQUEST_GAP));
  }

  return { fetched_at: new Date().toISOString(), days: DAYS, interval: INTERVAL, fills, candles };
}

// ── Analysis ─────────────────────────────────────────────────────────────────

/** Close of the first candle at or after `t`, or null past the end of the series. */
let staleToleranceMs = 10 * 60_000;   // set from the cache's bar interval at analysis time

function priceAt(series: [number, number][], t: number): number | null {
  if (!series.length) return null;
  let lo = 0, hi = series.length - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid][0] >= t) { best = mid; hi = mid - 1; } else { lo = mid + 1; }
  }
  if (best === -1) return null;
  // Refuse a match too far past the request: a gap that wide means the market
  // data is missing, not that the price simply did not change. The tolerance
  // has to scale with the bar interval. Fixed at 10 minutes it silently dropped
  // a third of a 15m-bar run, because bars are 15 minutes apart and most
  // lookups legitimately land more than 10 minutes before the next one, and the
  // rows that survived were not a random subset.
  if (series[best][0] - t > staleToleranceMs) return null;
  return series[best][1];
}

const MIN = 60_000;
const LATENCIES = [0, 1, 5, 10, 15, 30, 60];      // minutes behind the whale
const HOLDS     = [60, 240, 720, 1440, 2880, 4320];  // minutes held

function stats(xs: number[]) {
  if (!xs.length) return null;
  const n = xs.length;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(xs.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(n - 1, 1));
  const sorted = [...xs].sort((a, b) => a - b);
  const median = sorted[Math.floor(n / 2)];
  const se = sd / Math.sqrt(n);
  return { n, mean, median, sd, se, t: se === 0 ? 0 : mean / se, winRate: xs.filter((v) => v > 0).length / n };
}

const bps = (x: number) => (x * 10_000);

/**
 * Fills whose entry and whose furthest forward horizon both sit inside the
 * coin's candle span. Without this each row of a table is computed on whatever
 * subset happened to resolve, so a horizon that reaches past the data silently
 * swaps in an earlier, different set of trades and the rows stop being
 * comparable. Requiring full coverage up front costs sample and buys the right
 * to read the rows against each other.
 */
function fullyCovered(
  fills: Fill[],
  candles: Record<string, [number, number][]>,
  maxHorizonMin: number,
): Fill[] {
  const span = new Map<string, [number, number]>();
  for (const [coin, s] of Object.entries(candles)) {
    if (s.length) span.set(coin, [s[0][0], s[s.length - 1][0]]);
  }
  return fills.filter((f) => {
    const sp = span.get(f.c);
    if (!sp) return false;
    return f.t >= sp[0] && f.t + maxHorizonMin * MIN <= sp[1];
  });
}

/**
 * Collapse fills into entry episodes.
 *
 * A wallet opening one position emits many fills seconds apart on the same coin
 * and side. Treated as separate observations they are near-duplicates of each
 * other, so n counts them all while the independent information is one trade.
 * That inflates every t-statistic by roughly the square root of the cluster
 * size, which is how a first pass produced t-stats above 50 on a market edge.
 *
 * Fills of the same wallet, coin and direction within EPISODE_GAP_MIN of the
 * previous fill merge into one episode, priced at the size-weighted average and
 * stamped at the first fill, which is when a follower could first have acted.
 */
const EPISODE_GAP_MIN = 30;

function toEpisodes(fills: Fill[]): Fill[] {
  const keyed = new Map<string, Fill[]>();
  for (const f of fills) {
    const k = `${f.w}|${f.c}|${f.d}`;
    if (!keyed.has(k)) keyed.set(k, []);
    keyed.get(k)!.push(f);
  }

  const episodes: Fill[] = [];
  for (const group of keyed.values()) {
    group.sort((a, b) => a.t - b.t);
    let bucket: Fill[] = [];
    const flush = () => {
      if (!bucket.length) return;
      const size = bucket.reduce((s, f) => s + f.s, 0);
      const notional = bucket.reduce((s, f) => s + f.p * f.s, 0);
      episodes.push({
        ...bucket[0],
        p: size > 0 ? notional / size : bucket[0].p,
        s: size,
        t: bucket[0].t,
      });
      bucket = [];
    };
    for (const f of group) {
      if (bucket.length && f.t - bucket[bucket.length - 1].t > EPISODE_GAP_MIN * MIN) flush();
      bucket.push(f);
    }
    flush();
  }
  return episodes.sort((a, b) => a.t - b.t);
}

/**
 * Beta of a coin against BTC estimated from the bars immediately before an
 * entry, so the correction never uses information the trade could not have had.
 * Falls back to 1 when there is not enough history, which is the unscaled
 * benchmark and the conservative direction for a positive result.
 */
const BETA_LOOKBACK_BARS = 200;

const betaCache = new Map<string, number>();

function betaBefore(
  coinSeries: [number, number][],
  btcSeries: [number, number][],
  t: number,
  key?: string,
): number {
  // Beta depends only on the coin and the entry time, but the tables call it
  // once per latency and hold cell, which turns 35k episodes into over a
  // million regressions. Memoise on coin and timestamp.
  if (key !== undefined) {
    const hit = betaCache.get(key);
    if (hit !== undefined) return hit;
  }
  const value = computeBetaUncached(coinSeries, btcSeries, t);
  if (key !== undefined) betaCache.set(key, value);
  return value;
}

function computeBetaUncached(
  coinSeries: [number, number][],
  btcSeries: [number, number][],
  t: number,
): number {
  const slice = (s: [number, number][]) => {
    let hi = s.length - 1, lo = 0, idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (s[mid][0] < t) { idx = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    if (idx < 0) return [];
    return s.slice(Math.max(0, idx - BETA_LOOKBACK_BARS), idx + 1);
  };
  const c = slice(coinSeries), m = slice(btcSeries);
  if (c.length < BETA_MIN_SAMPLE || m.length < BETA_MIN_SAMPLE) return 1;
  const toBars = (s: [number, number][]) => s.map(([bt, close]) => ({ t: bt, c: String(close) }));
  const aligned = alignReturns(toReturns(toBars(c)), toReturns(toBars(m)));
  if (aligned.coin.length < BETA_MIN_SAMPLE) return 1;
  const b = computeBeta(aligned.coin, aligned.market);
  return b === null || !Number.isFinite(b) ? 1 : b;
}

/**
 * Collapse episodes that share a coin and a calendar day into one observation.
 *
 * toEpisodes removed correlation inside a wallet. It did nothing about fifty
 * different wallets buying the same coin on the same afternoon, which resolve
 * against one market move and carry one unit of information between them. Left
 * uncollapsed those inflate t in the cross section exactly as duplicate fills
 * did within a wallet, and the 24h column depends on it most because a 24h
 * forward window overlaps nearly every other entry that day.
 */
function clusterByCoinDay(rows: Array<{ coin: string; t: number; r: number }>): number[] {
  const groups = new Map<string, number[]>();
  for (const row of rows) {
    const day = Math.floor(row.t / 86_400_000);
    const k = `${row.coin}|${day}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(row.r);
  }
  return [...groups.values()].map((rs) => rs.reduce((a, b) => a + b, 0) / rs.length);
}

function main(cache: Cache) {
  const { fills, candles } = cache;
  // One and a half bars: wide enough that a legitimate next bar always matches,
  // tight enough that a genuine data hole still fails.
  const barMin = BAR_MINUTES[cache.interval ?? "1m"] ?? 1;
  staleToleranceMs = Math.max(10 * 60_000, barMin * 1.5 * 60_000);
  const onCoveredCoins = toEpisodes(fills.filter((f) => candles[f.c]?.length));
  console.log(`\n[fill-study] window ${cache.days}d, fetched ${cache.fetched_at}`);
  console.log(`[fill-study] ${fills.length} opening fills, ${onCoveredCoins.length} on coins with candles`);

  // ── Slice 1: how fast does the move happen after the cohort trades ─────────
  // Cumulative return from the cohort's own fill price, signed by direction.
  const MOVE_HORIZONS = [1, 5, 10, 15, 30, 60, 240];
  const moveSet = fullyCovered(onCoveredCoins, candles, Math.max(...MOVE_HORIZONS));
  console.log(`\n=== Move from the cohort's fill price (signed, gross) ===`);
  console.log(`same ${moveSet.length} fills on every row`);
  console.log(`horizon |      n |  mean bps | median bps |    t | win%`);
  console.log(`--------+--------+-----------+------------+------+------`);
  for (const h of MOVE_HORIZONS) {
    const rs: number[] = [];
    for (const f of moveSet) {
      const p = priceAt(candles[f.c], f.t + h * MIN);
      if (p === null) continue;
      rs.push(((p - f.p) / f.p) * f.d);
    }
    const s = stats(rs);
    if (!s) continue;
    console.log(
      `${String(h).padStart(6)}m | ${String(s.n).padStart(6)} | ${bps(s.mean).toFixed(1).padStart(9)} | ` +
      `${bps(s.median).toFixed(1).padStart(10)} | ${s.t.toFixed(1).padStart(4)} | ${(s.winRate * 100).toFixed(0)}%`
    );
  }

  // ── Slice 2: the follower's actual PnL at each latency ────────────────────
  // Enter L minutes after the cohort's fill, hold H minutes, pay the round trip.
  const followSet = fullyCovered(
    onCoveredCoins, candles, Math.max(...LATENCIES) + Math.max(...HOLDS),
  );
  const btc = candles["BTC"] ?? [];

  // Diagnostic first: a long-biased book in a drifting market reproduces a flat
  // positive long-horizon result with no alpha in it at all.
  const longs = followSet.filter((f) => f.d === 1).length;
  const drift = btc.length ? ((btc[btc.length - 1][1] - btc[0][1]) / btc[0][1]) * 100 : 0;
  console.log(`\n=== Diagnostics ===`);
  console.log(`  episodes ${followSet.length}, long ${longs} (${((longs / Math.max(followSet.length,1)) * 100).toFixed(0)}%), short ${followSet.length - longs}`);
  console.log(`  BTC over the window: ${drift >= 0 ? "+" : ""}${drift.toFixed(1)}%`);
  const coinDays = new Set(followSet.map((f) => `${f.c}|${Math.floor(f.t / 86400000)}`)).size;
  console.log(`  distinct coin-days: ${coinDays}  <- the real independent count for long horizons`);

  console.log(`\n=== Follower net PnL, per-coin beta, clustered by coin-day, less ${ROUND_TRIP_BPS} bps ===`);
  const header = HOLDS.map((h) => `${h}m`.padStart(13)).join(" |");
  console.log(`latency |${header}`);
  console.log(`--------+${HOLDS.map(() => "-".repeat(14)).join("+")}`);
  for (const L of LATENCIES) {
    const cells: string[] = [];
    for (const H of HOLDS) {
      const rows: Array<{ coin: string; t: number; r: number }> = [];
      for (const f of followSet) {
        const entry = priceAt(candles[f.c], f.t + L * MIN);
        const exit  = priceAt(candles[f.c], f.t + (L + H) * MIN);
        if (entry === null || exit === null || entry <= 0) continue;
        const bEntry = priceAt(btc, f.t + L * MIN);
        const bExit  = priceAt(btc, f.t + (L + H) * MIN);
        if (bEntry === null || bExit === null || bEntry <= 0) continue;
        const beta = betaBefore(candles[f.c], btc, f.t, `${f.c}|${f.t}`);
        const raw   = ((exit - entry) / entry) * f.d;
        const bench = ((bExit - bEntry) / bEntry) * f.d * beta;
        rows.push({ coin: f.c, t: f.t, r: raw - bench - ROUND_TRIP_BPS / 10_000 });
      }
      const s2 = stats(clusterByCoinDay(rows));
      cells.push(s2 ? `${bps(s2.mean).toFixed(1)}(t${s2.t.toFixed(1)},n${s2.n})`.padStart(13) : "n/a".padStart(13));
    }
    console.log(`${String(L).padStart(6)}m |${cells.join(" |")}`);
  }

  // A single window in a single regime is one observation of a strategy, not
  // evidence about it. Split the window and require the effect in both halves.
  console.log(`\n=== Split-half robustness, enter at +10m, per-coin beta, coin-day clustered ===`);
  const times = followSet.map((f) => f.t).sort((a, b) => a - b);
  const mid = times[Math.floor(times.length / 2)];
  console.log(`half   |` + HOLDS.map((h) => `${h}m`.padStart(13)).join(" |"));
  console.log(`-------+` + HOLDS.map(() => "-".repeat(14)).join("+"));
  for (const [label, set] of [
    ["early", followSet.filter((f) => f.t < mid)],
    ["late ", followSet.filter((f) => f.t >= mid)],
  ] as Array<[string, Fill[]]>) {
    const cells: string[] = [];
    for (const H of HOLDS) {
      const rows: Array<{ coin: string; t: number; r: number }> = [];
      for (const f of set) {
        const entry = priceAt(candles[f.c], f.t + 10 * MIN);
        const exit  = priceAt(candles[f.c], f.t + (10 + H) * MIN);
        const bEntry = priceAt(btc, f.t + 10 * MIN);
        const bExit  = priceAt(btc, f.t + (10 + H) * MIN);
        if (entry === null || exit === null || bEntry === null || bExit === null) continue;
        if (entry <= 0 || bEntry <= 0) continue;
        const beta = betaBefore(candles[f.c], btc, f.t, `${f.c}|${f.t}`);
        rows.push({ coin: f.c, t: f.t,
          r: ((exit - entry) / entry) * f.d - ((bExit - bEntry) / bEntry) * f.d * beta - ROUND_TRIP_BPS / 10_000 });
      }
      const st = stats(clusterByCoinDay(rows));
      cells.push(st ? `${bps(st.mean).toFixed(1)}(t${st.t.toFixed(1)},n${st.n})`.padStart(13) : "n/a".padStart(13));
    }
    console.log(`${label}  |` + cells.join(" |"));
  }

  // ── Exit structure implied by the cohort's own entries ───────────────────
  // exit-structure-analysis.ts answers what the market can reach from random
  // entries. This asks the narrower question that actually sets the exits: from
  // the entries this system would take, how far does price run our way before it
  // runs against us? A stop and target chosen from random-entry excursions is
  // fitted to the wrong distribution if cohort entries have any edge at all.
  const EXIT_HORIZON_H = 24;
  const excursions: Array<{ mfe: number; mae: number; coin: string; t: number }> = [];
  for (const f of fullyCovered(onCoveredCoins, candles, (EXIT_HORIZON_H + 1) * 60)) {
    const series = candles[f.c];
    const entry = priceAt(series, f.t + 10 * MIN);
    if (entry === null || entry <= 0) continue;
    let mfe = 0, mae = 0;
    for (let h = 1; h <= EXIT_HORIZON_H; h++) {
      const px = priceAt(series, f.t + (10 + h * 60) * MIN);
      if (px === null) continue;
      const r = ((px - entry) / entry) * f.d;
      if (r > mfe) mfe = r;
      if (r < mae) mae = r;
    }
    excursions.push({ mfe, mae, coin: f.c, t: f.t });
  }

  console.log(`\n=== Excursion over ${EXIT_HORIZON_H}h from cohort entries (enter +10m), n=${excursions.length} ===`);
  if (excursions.length >= 50) {
    const q = (xs: number[], p: number) => {
      const v = [...xs].sort((a, b) => a - b);
      return v[Math.floor(p * (v.length - 1))];
    };
    const mfes = excursions.map((e) => e.mfe), maes = excursions.map((e) => e.mae);
    console.log(`  MFE bps: p25=${bps(q(mfes,0.25)).toFixed(0)} median=${bps(q(mfes,0.5)).toFixed(0)} p75=${bps(q(mfes,0.75)).toFixed(0)} p90=${bps(q(mfes,0.9)).toFixed(0)}`);
    console.log(`  MAE bps: p10=${bps(q(maes,0.1)).toFixed(0)} p25=${bps(q(maes,0.25)).toFixed(0)} median=${bps(q(maes,0.5)).toFixed(0)} p75=${bps(q(maes,0.75)).toFixed(0)}`);

    // Grid of stop/target pairs, scored on the same coin-day clustering as
    // everything else. Whichever pair wins here is fitted to this window and
    // needs out-of-sample confirmation before it ships.
    console.log(`\n  Expectancy by stop/target, net of ${ROUND_TRIP_BPS} bps, coin-day clustered:`);
    console.log(`  target\\stop |` + [50, 100, 150, 200, 300].map((x) => `${x}bps`.padStart(12)).join(" |"));
    for (const target of [50, 100, 150, 200, 300, 500]) {
      const cells: string[] = [];
      for (const stop of [50, 100, 150, 200, 300]) {
        const rows = excursions.map((e) => {
          // Path order is unknown within the hour, so charge the pessimistic
          // reading: if both levels were touched, assume the stop came first.
          const hitStop   = e.mae <= -stop / 10_000;
          const hitTarget = e.mfe >= target / 10_000;
          const r = hitStop ? -stop / 10_000 : hitTarget ? target / 10_000 : 0;
          return { coin: e.coin, t: e.t, r: r - ROUND_TRIP_BPS / 10_000 };
        });
        const st = stats(clusterByCoinDay(rows));
        cells.push(st ? `${bps(st.mean).toFixed(0)}(t${st.t.toFixed(1)})`.padStart(12) : "n/a".padStart(12));
      }
      console.log(`  ${String(target).padStart(9)}bps |` + cells.join(" |"));
    }
  } else {
    console.log(`  too few covered entries to fit an exit structure`);
  }

  // The score decile slice is disabled, not deleted. `sc` is read from the most
  // recent snapshot, but overall_score is computed from recent PnL, so for a
  // study window inside that lookback the score already knows how these very
  // trades turned out. Sorting by it produced a clean monotonic decile with a
  // t-stat above 50, which is what a tautology looks like, not an edge.
  // Re-enable once wallet_score_history can supply a score as of the fill date.
  const SCORE_SLICE_ENABLED = process.argv.includes("--unsafe-score-slice");
  if (!SCORE_SLICE_ENABLED) {
    console.log(`\n=== By wallet score decile: SKIPPED ===`);
    console.log(`  overall_score is computed from the same window these fills sit in, so`);
    console.log(`  ranking by it leaks the outcome. Needs point-in-time scores from`);
    console.log(`  wallet_score_history. Pass --unsafe-score-slice to print it anyway.`);
  }
  if (SCORE_SLICE_ENABLED) console.log(`\n=== By wallet score decile, enter at +10m, hold 4h, net ===`);
  const sliceSet = fullyCovered(onCoveredCoins, candles, 250);
  const scored = sliceSet.filter((f) => f.sc > 0).sort((a, b) => a.sc - b.sc);
  const dsize = Math.floor(scored.length / 10);
  if (SCORE_SLICE_ENABLED && dsize >= 30) {
    console.log(`decile | score range   |      n |  mean bps |    t | win%`);
    console.log(`-------+---------------+--------+-----------+------+------`);
    for (let d = 0; d < 10; d++) {
      const bucket = scored.slice(d * dsize, (d + 1) * dsize);
      const rs: number[] = [];
      for (const f of bucket) {
        const entry = priceAt(candles[f.c], f.t + 10 * MIN);
        const exit  = priceAt(candles[f.c], f.t + 250 * MIN);
        if (entry === null || exit === null || entry <= 0) continue;
        rs.push(((exit - entry) / entry) * f.d - ROUND_TRIP_BPS / 10_000);
      }
      const s = stats(rs);
      if (!s) continue;
      const lo = bucket[0].sc.toFixed(3), hi = bucket[bucket.length - 1].sc.toFixed(3);
      console.log(
        `${String(d + 1).padStart(6)} | ${`${lo}-${hi}`.padStart(13)} | ${String(s.n).padStart(6)} | ` +
        `${bps(s.mean).toFixed(1).padStart(9)} | ${s.t.toFixed(1).padStart(4)} | ${(s.winRate * 100).toFixed(0)}%`
      );
    }
  } else if (SCORE_SLICE_ENABLED) {
    console.log(`  too few scored episodes to decile (${scored.length})`);
  }

  // ── Slice 4: size ─────────────────────────────────────────────────────────
  // Conviction should show up as size. If big fills lead and small ones do not,
  // that is a usable filter and it needs no scoring model at all.
  console.log(`\n=== By fill notional, enter at +10m, hold 4h, net ===`);
  const byNotional = [...sliceSet].sort((a, b) => a.p * a.s - b.p * b.s);
  const qsize = Math.floor(byNotional.length / 5);
  if (qsize >= 30) {
    console.log(`quintile | notional range      |      n |  mean bps |    t`);
    console.log(`---------+---------------------+--------+-----------+------`);
    for (let q = 0; q < 5; q++) {
      const bucket = byNotional.slice(q * qsize, (q + 1) * qsize);
      const rs: number[] = [];
      for (const f of bucket) {
        const entry = priceAt(candles[f.c], f.t + 10 * MIN);
        const exit  = priceAt(candles[f.c], f.t + 250 * MIN);
        if (entry === null || exit === null || entry <= 0) continue;
        rs.push(((exit - entry) / entry) * f.d - ROUND_TRIP_BPS / 10_000);
      }
      const s = stats(rs);
      if (!s) continue;
      const lo = Math.round(bucket[0].p * bucket[0].s);
      const hi = Math.round(bucket[bucket.length - 1].p * bucket[bucket.length - 1].s);
      console.log(
        `${String(q + 1).padStart(8)} | ${`$${lo.toLocaleString()}-$${hi.toLocaleString()}`.padStart(19)} | ` +
        `${String(s.n).padStart(6)} | ${bps(s.mean).toFixed(1).padStart(9)} | ${s.t.toFixed(1).padStart(4)}`
      );
    }
  }

  console.log(`\nNothing was written.`);
}

(async () => {
  let cache: Cache;
  if (DO_FETCH) {
    cache = await fetchAll();
    await fs.writeFile(CACHE_FILE, JSON.stringify(cache));
    console.log(`[fill-study] cached to ${CACHE_FILE}`);
  } else {
    try {
      cache = JSON.parse(await fs.readFile(CACHE_FILE, "utf8")) as Cache;
    } catch {
      console.error(`[fill-study] no cache at ${CACHE_FILE}. Run with --fetch first.`);
      process.exit(1);
    }
  }
  main(cache);
})().catch((e) => {
  console.error("[fill-study] FAILED:", e.message);
  process.exit(1);
});
