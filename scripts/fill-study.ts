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
const REQUEST_GAP  = 120;                     // ms between Hyperliquid calls

// candleSnapshot returns at most ~5,000 candles and silently truncates to the
// most recent ones rather than erroring. A 7-day 1m request therefore came back
// covering only the last 3.6 days, which put old fills outside the candle span
// entirely: they resolved at long horizons and not at short ones, so each row
// of the decay table was computed on a different set of trades. The window is
// now held under the cap in a single request per coin, so a coin either has
// full coverage or none.
const CANDLE_CAP    = 5_000;
const FORWARD_BUFFER_MIN = 6 * 60;            // horizons reach past the last fill

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

async function hl<T>(body: unknown, attempt = 0): Promise<T> {
  const res = await fetch(HL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 429 && attempt < 4) {
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    return hl<T>(body, attempt + 1);
  }
  if (!res.ok) throw new Error(`Hyperliquid ${res.status}`);
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
const HOLDS     = [15, 60, 240, 1440];            // minutes held

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
  console.log(`\n=== Follower net PnL: enter L min late, hold H min, less ${ROUND_TRIP_BPS} bps ===`);
  console.log(`same ${followSet.length} fills in every cell`);
  const header = HOLDS.map((h) => `${h}m`.padStart(11)).join(" |");
  console.log(`latency |${header}`);
  console.log(`--------+${HOLDS.map(() => "-".repeat(12)).join("+")}`);
  for (const L of LATENCIES) {
    const cells: string[] = [];
    for (const H of HOLDS) {
      const rs: number[] = [];
      for (const f of followSet) {
        const entry = priceAt(candles[f.c], f.t + L * MIN);
        const exit  = priceAt(candles[f.c], f.t + (L + H) * MIN);
        if (entry === null || exit === null || entry <= 0) continue;
        const raw = ((exit - entry) / entry) * f.d;
        // The cohort is mostly long and the market drifts, so a signed raw
        // return collects market beta and calls it edge. Subtract BTC over the
        // same window, signed the same way. Beta is taken as 1, which
        // understates the correction on high-beta alts and is the conservative
        // direction for a positive result.
        const bEntry = priceAt(candles["BTC"] ?? [], f.t + L * MIN);
        const bExit  = priceAt(candles["BTC"] ?? [], f.t + (L + H) * MIN);
        const bench  = bEntry && bExit && bEntry > 0 ? ((bExit - bEntry) / bEntry) * f.d : 0;
        rs.push(raw - bench - ROUND_TRIP_BPS / 10_000);
      }
      const s = stats(rs);
      cells.push(s ? `${bps(s.mean).toFixed(1)}(t${s.t.toFixed(1)})`.padStart(11) : "n/a".padStart(11));
    }
    console.log(`${String(L).padStart(6)}m |${cells.join(" |")}`);
  }

  // ── Slice 3: does the wallet score separate the flow ──────────────────────
  // If following works, the top score decile should lead the bottom. If the
  // bottom leads, fading it is the trade and no skill hypothesis is needed.
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
