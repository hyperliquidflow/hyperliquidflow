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
import { readFileSync } from "fs";
import { toReturns, alignReturns, computeBeta, BETA_MIN_SAMPLE } from "../lib/beta";
import { scoreFromDailyPnls } from "../lib/skill-test";
import { fetchDiscoveryDates, freezeToDiscovery, describeFreeze, type DiscoveryQuery } from "../lib/discovery";
import { compactFills, checkConservation } from "../lib/fill-compaction";
import {
  priceAt as priceAtBar,
  staleTolerance,
  toEpisodes as toEpisodesShared,
  clusterByCoinDay as clusterShared,
  clusterByDay,
  trimmedMean,
  bootstrapMeanCI,
  fundingOverHold,
} from "../lib/study-stats";

const SUPABASE_URL              = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const HL_URL = process.env.HYPERLIQUID_API_URL ?? "https://api.hyperliquid.xyz/info";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("FATAL: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const DO_FETCH     = process.argv.includes("--fetch");
const FREEZE_POOL  = process.argv.includes("--freeze-pool");
// Analysing an archived cache while a fresh fetch writes the default one, and
// re-deriving an old result without refetching, both need this.
const CACHE_OVERRIDE = process.argv.find((a) => a.startsWith("--cache="))?.split("=")[1];
const CACHE_FILE = CACHE_OVERRIDE ?? "fill-study-cache.json";
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

// Compact while fetching on hourly runs, where the bucket matches the finest
// resolution anything downstream can see anyway. Short-bar runs ask sub-hour
// questions that compaction would destroy, and they are small enough not to
// need it. --raw forces the old behaviour.
const COMPACT_ON_FETCH = INTERVAL === "1h" && !process.argv.includes("--raw");

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
// KNOWN OPTIMISTIC: verified 2026-08-12, the base-tier taker fee is 4.5 bps a
// side, and this constant charges no slippage or funding. Existing tables keep
// it so their numbers stay comparable with the register history; the
// pre-registered executioner section below charges the full model.
const ROUND_TRIP_BPS = 7;

// Pre-registered full cost model (docs/research/2026-08-12-preregistration-leads.md).
const FEE_BPS_SIDE  = 4.5;  // verified base-tier taker, 2026-08-12
const SLIP_BPS_SIDE = 5;    // haircut until a depth model exists
const FULL_RT = (2 * (FEE_BPS_SIDE + SLIP_BPS_SIDE)) / 10_000; // 19 bps round trip
const FUNDING_CACHE_FILE = "funding-cache.json";
const CHECKPOINT_FILE = "fill-study-checkpoint.json";
const CHECKPOINT_EVERY = 25;

/** Everything needed to resume a fetch, plus the parameters that define it. */
interface Checkpoint {
  params: string;
  fills: Fill[];
  fetchedWalletIds: string[];
  rawFillCount: number;
}

/**
 * The parameters that make two runs the same study. A checkpoint from a
 * different window, interval, pool or wallet count describes different data,
 * so resuming across them would silently blend two samples.
 */
function checkpointParams(): string {
  const pool = process.argv.find((a) => a.startsWith("--pool="))?.split("=")[1] ?? "traders";
  return `${DAYS}|${INTERVAL}|${pool}|${MAX_WALLETS}|${COMPACT_ON_FETCH}`;
}

async function readCheckpoint(): Promise<Checkpoint | null> {
  try {
    const cp = JSON.parse(await fs.readFile(CHECKPOINT_FILE, "utf8")) as Checkpoint;
    if (cp.params !== checkpointParams()) {
      console.log(`[fill-study] checkpoint is from a different run (${cp.params}), ignoring it`);
      return null;
    }
    return cp;
  } catch {
    return null;
  }
}

async function writeCheckpoint(state: Omit<Checkpoint, "params">): Promise<void> {
  // Write beside the target and rename, so a crash mid-write cannot leave a
  // half-written checkpoint that the next run would happily resume from.
  const tmp = `${CHECKPOINT_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ params: checkpointParams(), ...state }));
  await fs.rename(tmp, CHECKPOINT_FILE);
}

interface Fill {
  w: string;      // wallet id
  c: string;      // coin
  p: number;      // fill price
  s: number;      // size
  t: number;      // ms timestamp
  d: 1 | -1;      // 1 = long side, -1 = short side
  o: 0 | 1;       // 1 = opening the position, 0 = closing it
  pnl: number;    // realized PnL on this fill, non-zero only on closes
  sc: number;     // wallet overall_score at scan time (leaks; see score slice)
}

interface Cache {
  fetched_at: string;
  days: number;
  interval?: string;
  /** true when fills were collapsed to hourly rows, on fetch or afterwards */
  compacted?: boolean;
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
  // Pool selection is not cosmetic. --pool=all once ordered by last_scanned_at,
  // which has nothing to do with whether a wallet trades: after a nightly scan
  // re-scored a different set, the identical command drew a mostly dormant
  // sample and fills fell 33x, with whole stretches of 50 wallets contributing
  // nothing. "traders" orders by trade count from the backtest table so the pool
  // is wallets that actually trade, which is the population the live system
  // draws its cohort from. That selects on activity, not on outcome.
  const POOL = process.argv.find((a) => a.startsWith("--pool="))?.split("=")[1] ?? "traders";
  let wallets: Array<{ id: string; address: string }> = [];

  if (POOL === "active") {
    const { data, error } = await supabase
      .from("wallets").select("id, address").eq("is_active", true).limit(MAX_WALLETS);
    if (error) throw new Error(`wallet query: ${error.message}`);
    wallets = (data ?? []) as typeof wallets;
  } else {
    // Ordering by trade count alone selects the highest frequency accounts,
    // which are bots and market makers: the first attempt drew wallets averaging
    // 8,500 trades over 120 days. The scan itself rejects those, MAX_TRADES_30D
    // is 1000 and commented "wash/farm", so that pool is the opposite of the
    // population the system follows. Band it to the scan's own activity window
    // so the sample is the kind of wallet the cohort is actually drawn from.
    const { data: bt, error: btErr } = await supabase
      .from("user_pnl_backtest")
      .select("wallet_id, total_trades")
      .gte("total_trades", 60)
      .lte("total_trades", 1000)
      .order("total_trades", { ascending: false })
      .limit(MAX_WALLETS);
    if (btErr) throw new Error(`backtest query: ${btErr.message}`);
    const ids = (bt ?? []).map((r) => r.wallet_id as string);
    const CHUNK = 200;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { data, error } = await supabase
        .from("wallets").select("id, address").in("id", ids.slice(i, i + CHUNK));
      if (error) throw new Error(`wallet query: ${error.message}`);
      wallets.push(...((data ?? []) as typeof wallets));
    }
    const rank = new Map(ids.map((id, i) => [id, i]));
    wallets.sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9));
  }
  console.log(`[fill-study] pool=${POOL}, ${wallets.length} wallets, interval=${INTERVAL}`);

  const ids = wallets.map((w) => w.id);
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

  console.log(`[fill-study] fetching ${DAYS}d of fills for ${wallets.length} wallets...`);
  const fills: Fill[] = [];
  let done = 0;
  let rawFillCount = 0;
  const fetchedWalletIds: string[] = [];

  // Resume a run that died partway, provided it was the same run: a checkpoint
  // from different parameters describes a different study and is ignored rather
  // than silently mixed in.
  const resumed = await readCheckpoint();
  const alreadyFetched = new Set<string>();
  if (resumed) {
    fills.push(...resumed.fills);
    fetchedWalletIds.push(...resumed.fetchedWalletIds);
    for (const id of resumed.fetchedWalletIds) alreadyFetched.add(id);
    rawFillCount = resumed.rawFillCount;
    done = resumed.fetchedWalletIds.length;
    console.log(
      `[fill-study] resuming from checkpoint: ${done} wallets already fetched, ` +
      `${fills.length} rows carried forward`
    );
  }

  let truncatedWallets = 0;
  let failedWallets = 0;

  for (const w of wallets) {
    if (alreadyFetched.has(w.id)) continue;
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

      const walletFills: Fill[] = [];
      for (const f of raw ?? []) {
        const dir = String(f.dir ?? "");
        // Opening and closing fills both kept. Closes are needed to reconstruct
        // what each wallet actually held over time, which is the input to the
        // positioning factor, and a close is its own untested hypothesis.
        const isOpen = dir.startsWith("Open");
        if (!isOpen && !dir.startsWith("Close")) continue;
        const p = parseFloat(String(f.px));
        const s = parseFloat(String(f.sz));
        const t = Number(f.time);
        if (!Number.isFinite(p) || !Number.isFinite(s) || !Number.isFinite(t)) continue;
        walletFills.push({
          w: w.id, c: String(f.coin), p, s, t,
          d: dir.includes("Long") ? 1 : -1,
          o: isOpen ? 1 : 0,
          pnl: parseFloat(String(f.closedPnl ?? "0")) || 0,
          sc: scoreByWallet.get(w.id) ?? 0,
        });
      }

      // Compact per wallet, as the fills arrive, rather than holding the raw
      // firehose to the end of the run. A 400-wallet 200-day fetch produces
      // over six million raw fills, roughly a gigabyte of JSON, which is at the
      // limit of a single string and past what is comfortable to parse. The
      // 2026-08-12 attempt was killed halfway for exactly that reason.
      //
      // Only on hourly runs. Compaction is lossy below its bucket, and the
      // short-bar runs that ask sub-hour questions are small enough not to
      // need it. Conservation is checked per wallet so a bad aggregation
      // surfaces at the wallet that caused it rather than as a total at the end.
      if (COMPACT_ON_FETCH) {
        const compacted = compactFills(walletFills);
        const check = checkConservation(walletFills, compacted);
        if (!check.ok) {
          throw new Error(
            `compaction did not conserve wallet ${w.id}: size drift ${check.sizeDrift}, pnl drift ${check.pnlDrift}`
          );
        }
        rawFillCount += walletFills.length;
        fills.push(...compacted);
      } else {
        rawFillCount += walletFills.length;
        fills.push(...walletFills);
      }
    } catch (e) {
      failedWallets++;
      console.warn(`[fill-study] fills failed for ${w.address.slice(0, 10)}: ${(e as Error).message}`);
    }
    done++;
    fetchedWalletIds.push(w.id);
    if (done % 50 === 0) {
      const shape = COMPACT_ON_FETCH
        ? `${rawFillCount} fills to ${fills.length} hourly rows`
        : `${fills.length} fills`;
      console.log(`[fill-study]   ${done}/${wallets.length} wallets, ${shape}`);
    }
    // Checkpoint. A 400-wallet 200-day fetch runs for hours, and one died
    // silently to memory pressure on 2026-08-12 with nothing written and
    // nothing in the log to say why. Losing 25 wallets is an inconvenience;
    // losing three hours twice is how a measurement programme stalls.
    if (done % CHECKPOINT_EVERY === 0) {
      await writeCheckpoint({ fills, fetchedWalletIds, rawFillCount });
    }
    await new Promise((r) => setTimeout(r, REQUEST_GAP));
  }

  // Only fetch candles for coins that carry enough fills to say anything.
  const byCoin = new Map<string, number>();
  for (const f of fills) byCoin.set(f.c, (byCoin.get(f.c) ?? 0) + 1);
  const coins = [...byCoin.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_COINS).map(([c]) => c);
  const dropped = fills.length - fills.filter((f) => coins.includes(f.c)).length;
  console.log(`[fill-study] ${fills.length} fills across ${byCoin.size} coins`);
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

  if (COMPACT_ON_FETCH) {
    console.log(
      `[fill-study] compacted on fetch: ${rawFillCount} raw fills to ${fills.length} hourly rows ` +
      `(${rawFillCount > 0 ? ((fills.length / rawFillCount) * 100).toFixed(1) : "0"}%)`
    );
  }
  return {
    fetched_at: new Date().toISOString(),
    days: DAYS,
    interval: INTERVAL,
    compacted: COMPACT_ON_FETCH,
    fills,
    candles,
  };
}

// ── Analysis ─────────────────────────────────────────────────────────────────

/** Close of the first candle at or after `t`, or null past the end of the series. */
// priceAt, toEpisodes and clusterByCoinDay live in lib/study-stats.ts where
// they are covered by tests. They decide whether a research number is real,
// and each exists because its naive version produced a confident wrong answer
// first, so a silent regression here would not look like a failure, it would
// look like a discovery.
let staleToleranceMs = staleTolerance(1);
const priceAt = (series: [number, number][], t: number) => priceAtBar(series, t, staleToleranceMs);

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

const EPISODE_GAP_MIN = 30;
const toEpisodes = (fills: Fill[]): Fill[] => toEpisodesShared(fills, EPISODE_GAP_MIN);
const clusterByCoinDay = (rows: Array<{ coin: string; t: number; r: number }>): number[] =>
  clusterShared(rows);

function main(cache: Cache) {
  const { fills, candles } = cache;
  // One and a half bars: wide enough that a legitimate next bar always matches,
  // tight enough that a genuine data hole still fails.
  const barMin = BAR_MINUTES[cache.interval ?? "1m"] ?? 1;
  staleToleranceMs = staleTolerance(barMin);
  const onCoveredCoins = toEpisodes(fills.filter((f) => candles[f.c]?.length && f.o === 1));
  console.log(`\n[fill-study] window ${cache.days}d, fetched ${cache.fetched_at}`);
  console.log(`[fill-study] ${fills.length} opening fills, ${onCoveredCoins.length} on coins with candles`);

  // Hourly funding rates per coin, fetched by signal-stack. Missing coins
  // contribute zero and show up in the coverage column instead of silently
  // understating the charge.
  let funding: Record<string, [number, number][]> = {};
  try {
    funding = JSON.parse(readFileSync(FUNDING_CACHE_FILE, "utf8"));
  } catch {
    console.log(`[fill-study] no ${FUNDING_CACHE_FILE}; executioner rows will show 0% funding coverage`);
  }

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

  // ── Non-overlapping windows ──────────────────────────────────────────────
  // clusterByCoinDay collapses same coin, same day. It does nothing about a 72
  // hour forward window overlapping the next two days of entries on that coin,
  // and those share most of their price path, so they are close to one
  // observation rather than three. Long holds are exactly where that bites, and
  // long holds are where the positive result lives, so the t-statistics above
  // are overstated by an unmeasured amount.
  //
  // This re-scores each hold using entries spaced at least one full hold apart
  // per coin, greedily from the earliest. Sample drops hard, which is the
  // honest cost of independence: if the effect survives here it is real, and if
  // it evaporates the earlier t-statistics were counting the same move twice.
  console.log(`\n=== Non-overlapping windows, enter +10m, per-coin beta ===`);
  console.log(`  hold |      n |  mean bps |    t | win%`);
  console.log(`  -----+--------+-----------+------+------`);
  for (const H of HOLDS) {
    const pool = fullyCovered(onCoveredCoins, candles, 10 + H).slice().sort((a, b) => a.t - b.t);
    const lastByCoin = new Map<string, number>();
    const picked: Fill[] = [];
    for (const f of pool) {
      const last = lastByCoin.get(f.c) ?? -Infinity;
      if (f.t - last < H * MIN) continue;
      picked.push(f);
      lastByCoin.set(f.c, f.t);
    }
    const rs: number[] = [];
    for (const f of picked) {
      const entry = priceAt(candles[f.c], f.t + 10 * MIN);
      const exit  = priceAt(candles[f.c], f.t + (10 + H) * MIN);
      const bEntry = priceAt(btc, f.t + 10 * MIN);
      const bExit  = priceAt(btc, f.t + (10 + H) * MIN);
      if (entry === null || exit === null || bEntry === null || bExit === null) continue;
      if (entry <= 0 || bEntry <= 0) continue;
      const beta = betaBefore(candles[f.c], btc, f.t, `${f.c}|${f.t}`);
      rs.push(((exit - entry) / entry) * f.d - ((bExit - bEntry) / bEntry) * f.d * beta - ROUND_TRIP_BPS / 10_000);
    }
    const st = stats(rs);
    if (!st) { console.log(`  ${String(H).padStart(4)}m |  too few`); continue; }
    console.log(
      `  ${String(H).padStart(4)}m | ${String(st.n).padStart(6)} | ${bps(st.mean).toFixed(1).padStart(9)} | ` +
      `${st.t.toFixed(1).padStart(4)} | ${(st.winRate * 100).toFixed(0)}%`
    );
  }

  // ── Pre-registered executioner: full costs, day clustering, robust stats ──
  // docs/research/2026-08-12-preregistration-leads.md, Lead 2. Same
  // non-overlapping spacing as the table above, but charged the verified full
  // cost model (4.5 bps fee plus 5 bps slippage per side, plus the path-wise
  // hourly funding the position would have paid, signed by direction), then
  // clustered BY DAY rather than coin-day because alts co-move within a day,
  // with a 10% trimmed mean and a seeded day-bootstrap interval so a right
  // tail cannot carry the verdict unexamined.
  //
  // The momentum row is the dumb baseline: identical entry times and coins,
  // but direction replaced by the sign of the coin's trailing 24h return. If
  // it matches or beats the wallet row, the wallet layer adds nothing at that
  // hold and the lead fails in its wallet-following form.
  console.log(`\n=== EXECUTIONER (pre-registered): non-overlap, full costs, day-clustered ===`);
  console.log(`  costs: ${(FULL_RT * 10_000).toFixed(0)} bps round trip + path-wise funding, signed by direction`);
  console.log(`  hold | signal   |    n | days | mean bps | trim10 |    t | boot95 bps     | fund cov`);
  console.log(`  -----+----------+------+------+----------+--------+------+----------------+---------`);
  for (const H of HOLDS) {
    const pool = fullyCovered(onCoveredCoins, candles, 10 + H).slice().sort((a, b) => a.t - b.t);
    const lastByCoin = new Map<string, number>();
    const picked: Fill[] = [];
    for (const f of pool) {
      const last = lastByCoin.get(f.c) ?? -Infinity;
      if (f.t - last < H * MIN) continue;
      picked.push(f);
      lastByCoin.set(f.c, f.t);
    }
    for (const which of ["wallet", "momentum"] as const) {
      const rows: Array<{ t: number; r: number }> = [];
      let fundPoints = 0, fundExpected = 0;
      for (const f of picked) {
        const tIn = f.t + 10 * MIN, tOut = f.t + (10 + H) * MIN;
        const entry = priceAt(candles[f.c], tIn);
        const exit  = priceAt(candles[f.c], tOut);
        const bEntry = priceAt(btc, tIn);
        const bExit  = priceAt(btc, tOut);
        if (entry === null || exit === null || bEntry === null || bExit === null) continue;
        if (entry <= 0 || bEntry <= 0) continue;
        let d: 1 | -1 = f.d;
        if (which === "momentum") {
          const pPrev = priceAt(candles[f.c], f.t - 1440 * MIN);
          if (pPrev === null || pPrev <= 0) continue;
          d = entry >= pPrev ? 1 : -1;
        }
        const beta = betaBefore(candles[f.c], btc, f.t, `${f.c}|${f.t}`);
        const fund = fundingOverHold(funding[f.c] ?? [], tIn, tOut);
        fundPoints += fund.points; fundExpected += fund.expectedPoints;
        const r =
          ((exit - entry) / entry) * d -
          ((bExit - bEntry) / bEntry) * d * beta -
          d * fund.sum -
          FULL_RT;
        rows.push({ t: f.t, r });
      }
      const byDay = clusterByDay(rows);
      const st = stats(byDay);
      if (!st || st.n < 2) { console.log(`  ${String(H).padStart(4)}m | ${which.padEnd(8)} | too few`); continue; }
      const tm = trimmedMean(byDay, 0.1);
      const ci = bootstrapMeanCI(byDay, { iters: 2000, seed: 42 });
      const cov = fundExpected > 0 ? ((fundPoints / fundExpected) * 100).toFixed(0) : "0";
      const ciStr = ci ? `[${bps(ci.lo).toFixed(0)}, ${bps(ci.hi).toFixed(0)}]` : "n/a";
      console.log(
        `  ${String(H).padStart(4)}m | ${which.padEnd(8)} | ${String(rows.length).padStart(4)} | ${String(st.n).padStart(4)} | ` +
        `${bps(st.mean).toFixed(1).padStart(8)} | ${tm === null ? "   n/a" : bps(tm).toFixed(1).padStart(6)} | ` +
        `${st.t.toFixed(1).padStart(4)} | ${ciStr.padEnd(14)} | ${cov}%`
      );
    }
  }

  // ── Exit copying: the half of the follow premise never measured ──────────
  // docs/research/2026-08-12-preregistration-leads.md, Hypothesis 3. Every
  // table above measures entries. Whether this cohort knows when to get out is
  // a separate claim, and the cache already carries the closing fills.
  //
  // A close of a long is a sell, so the follower's direction is the opposite of
  // the position being closed. Same machinery as the executioner: episodes,
  // non-overlapping windows, per-coin beta, full costs with path-wise funding,
  // day clustering, trimmed mean, bootstrap. The momentum row substitutes the
  // trailing 24h sign for the cohort's, and if it matches, the exits carry
  // nothing the price did not already say.
  const closingEpisodes = toEpisodes(fills.filter((f) => candles[f.c]?.length && f.o === 0));
  console.log(`\n=== EXIT COPYING (pre-registered): follow the close, full costs, day-clustered ===`);
  console.log(`  ${closingEpisodes.length} closing episodes; follower direction is opposite the position closed`);
  console.log(`  hold | signal   |    n | days | mean bps | trim10 |    t | boot95 bps     | fund cov`);
  console.log(`  -----+----------+------+------+----------+--------+------+----------------+---------`);
  for (const H of HOLDS) {
    const pool = fullyCovered(closingEpisodes, candles, 10 + H).slice().sort((a, b) => a.t - b.t);
    const lastByCoin = new Map<string, number>();
    const picked: Fill[] = [];
    for (const f of pool) {
      const last = lastByCoin.get(f.c) ?? -Infinity;
      if (f.t - last < H * MIN) continue;
      picked.push(f);
      lastByCoin.set(f.c, f.t);
    }
    for (const which of ["exit", "momentum"] as const) {
      const rows: Array<{ t: number; r: number }> = [];
      let fundPoints = 0, fundExpected = 0;
      for (const f of picked) {
        const tIn = f.t + 10 * MIN, tOut = f.t + (10 + H) * MIN;
        const entry = priceAt(candles[f.c], tIn);
        const exit  = priceAt(candles[f.c], tOut);
        const bEntry = priceAt(btc, tIn);
        const bExit  = priceAt(btc, tOut);
        if (entry === null || exit === null || bEntry === null || bExit === null) continue;
        if (entry <= 0 || bEntry <= 0) continue;
        // Opposite the position that was closed: a closed long is a sell.
        let d: 1 | -1 = (f.d === 1 ? -1 : 1);
        if (which === "momentum") {
          const pPrev = priceAt(candles[f.c], f.t - 1440 * MIN);
          if (pPrev === null || pPrev <= 0) continue;
          d = entry >= pPrev ? 1 : -1;
        }
        const beta = betaBefore(candles[f.c], btc, f.t, `${f.c}|${f.t}`);
        const fund = fundingOverHold(funding[f.c] ?? [], tIn, tOut);
        fundPoints += fund.points; fundExpected += fund.expectedPoints;
        rows.push({
          t: f.t,
          r: ((exit - entry) / entry) * d
             - ((bExit - bEntry) / bEntry) * d * beta
             - d * fund.sum
             - FULL_RT,
        });
      }
      const byDay = clusterByDay(rows);
      const st = stats(byDay);
      if (!st || st.n < 2) { console.log(`  ${String(H).padStart(4)}m | ${which.padEnd(8)} | too few`); continue; }
      const tm = trimmedMean(byDay, 0.1);
      const ci = bootstrapMeanCI(byDay, { iters: 2000, seed: 42 });
      const cov = fundExpected > 0 ? ((fundPoints / fundExpected) * 100).toFixed(0) : "0";
      const ciStr = ci ? `[${bps(ci.lo).toFixed(0)}, ${bps(ci.hi).toFixed(0)}]` : "n/a";
      console.log(
        `  ${String(H).padStart(4)}m | ${which.padEnd(8)} | ${String(rows.length).padStart(4)} | ${String(st.n).padStart(4)} | ` +
        `${bps(st.mean).toFixed(1).padStart(8)} | ${tm === null ? "   n/a" : bps(tm).toFixed(1).padStart(6)} | ` +
        `${st.t.toFixed(1).padStart(4)} | ${ciStr.padEnd(14)} | ${cov}%`
      );
    }
  }

  // ── Coordination: the only version of the follow premise still standing ──
  // Every recipe assumes several wallets entering the same coin and direction
  // together differs from one wallet doing it alone. The tables above measured
  // average entries and found nothing tradeable, which leaves this untested and
  // load-bearing. A coordinated signal fires at the moment the Nth distinct
  // wallet joins, which is the earliest a follower could have acted on it.
  console.log(`\n=== Coordination: does an N-wallet cluster beat an average entry? ===`);
  const COORD_WINDOW_MIN = 120;
  const coordSet = fullyCovered(onCoveredCoins, candles, 60 + 1440);

  console.log(`  N | signals |   60m net |  240m net | 1440m net | (bps, beta-adj, less ${ROUND_TRIP_BPS}, coin-day clustered)`);
  console.log(`----+---------+-----------+-----------+-----------+`);

  for (const N of [1, 2, 3, 4, 5]) {
    // Group by coin and direction, then slide a window and fire when the count
    // of DISTINCT wallets inside it first reaches N.
    const byKey = new Map<string, Fill[]>();
    for (const f of coordSet) {
      const k = `${f.c}|${f.d}`;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k)!.push(f);
    }

    const signals: Fill[] = [];
    for (const group of byKey.values()) {
      group.sort((a, b) => a.t - b.t);
      let lastFire = -Infinity;
      for (let i = 0; i < group.length; i++) {
        if (group[i].t - lastFire < COORD_WINDOW_MIN * MIN) continue;  // one signal per window
        const wallets = new Set<string>();
        for (let j = i; j < group.length && group[j].t - group[i].t <= COORD_WINDOW_MIN * MIN; j++) {
          wallets.add(group[j].w);
          if (wallets.size >= N) {
            signals.push({ ...group[j] });   // fires when the Nth distinct wallet joins
            lastFire = group[j].t;
            break;
          }
        }
      }
    }

    const cells: string[] = [];
    for (const H of [60, 240, 1440]) {
      const rows: Array<{ coin: string; t: number; r: number }> = [];
      for (const f of signals) {
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
      cells.push(st ? `${bps(st.mean).toFixed(1)}(t${st.t.toFixed(1)})`.padStart(9) : "n/a".padStart(9));
    }
    // The one cell that looks alive gets the same split-half treatment that
    // killed the 45-day result, rather than being dismissed on shape alone.
    let halves = "";
    if (signals.length > 200) {
      const ts = signals.map((f) => f.t).sort((a, b) => a - b);
      const midT = ts[Math.floor(ts.length / 2)];
      const halfStat = (set: Fill[]) => {
        const rows: Array<{ coin: string; t: number; r: number }> = [];
        for (const f of set) {
          const entry = priceAt(candles[f.c], f.t + 10 * MIN);
          const exit  = priceAt(candles[f.c], f.t + (10 + 1440) * MIN);
          const bEntry = priceAt(btc, f.t + 10 * MIN);
          const bExit  = priceAt(btc, f.t + (10 + 1440) * MIN);
          if (entry === null || exit === null || bEntry === null || bExit === null || entry <= 0 || bEntry <= 0) continue;
          const beta = betaBefore(candles[f.c], btc, f.t, `${f.c}|${f.t}`);
          rows.push({ coin: f.c, t: f.t,
            r: ((exit - entry) / entry) * f.d - ((bExit - bEntry) / bEntry) * f.d * beta - ROUND_TRIP_BPS / 10_000 });
        }
        const st = stats(clusterByCoinDay(rows));
        return st ? `${bps(st.mean).toFixed(0)}(t${st.t.toFixed(1)})` : "n/a";
      };
      halves = `  24h halves: early ${halfStat(signals.filter((f) => f.t < midT))} / late ${halfStat(signals.filter((f) => f.t >= midT))}`;
    }
    console.log(`  ${String(N).padStart(1)} | ${String(signals.length).padStart(7)} | ${cells.join(" | ")} |${halves}`);
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

  // ── Score decile on reconstructed point-in-time scores ───────────────────
  // The cached `sc` field is the wallet's score today, computed from PnL that
  // includes the very trades being ranked, so sorting by it leaks the outcome
  // and produced a monotonic decile at t above 50. wallet_score_history cannot
  // fix it either: 648 rows starting 2026-08-08 cannot score a 120-day window,
  // and waiting for it means December.
  //
  // So the score is rebuilt instead. overall_score is a function of trailing
  // daily PnL, and closing fills carry realized PnL with a timestamp, so each
  // wallet can be scored from its own history strictly before each entry. No
  // lookahead, no waiting.
  const SCORE_LOOKBACK_DAYS = 60;
  const SCORE_MIN_ACTIVE_DAYS = 5;   // the skill test's activity floor

  // wallet -> day index -> realized PnL that day
  const pnlByWalletDay = new Map<string, Map<number, number>>();
  const dayOf = (t: number) => Math.floor(t / 86_400_000);
  for (const f of fills) {
    if (f.o !== 0 || !Number.isFinite(f.pnl) || f.pnl === 0) continue;
    if (!pnlByWalletDay.has(f.w)) pnlByWalletDay.set(f.w, new Map());
    const m = pnlByWalletDay.get(f.w)!;
    const d = dayOf(f.t);
    m.set(d, (m.get(d) ?? 0) + f.pnl);
  }

  function scoreAsOf(wallet: string, t: number): number | null {
    const m = pnlByWalletDay.get(wallet);
    if (!m) return null;
    const today = dayOf(t);
    const series: number[] = [];
    let active = 0;
    for (let d = today - SCORE_LOOKBACK_DAYS; d < today; d++) {
      const v = m.get(d) ?? 0;
      series.push(v);
      if (v !== 0) active++;
    }
    if (active < SCORE_MIN_ACTIVE_DAYS) return null;
    return scoreFromDailyPnls(series);
  }

  console.log(`\n=== Score decile on point-in-time scores, enter +10m, hold 4h, net ===`);
  const ptSet = fullyCovered(onCoveredCoins, candles, 250);
  const ptScored = ptSet
    .map((f) => ({ f, s: scoreAsOf(f.w, f.t) }))
    .filter((x): x is { f: Fill; s: number } => x.s !== null)
    .sort((a, b) => a.s - b.s);

  console.log(`  ${ptScored.length} of ${ptSet.length} episodes carry enough history to score`);
  const dz = Math.floor(ptScored.length / 10);
  if (dz >= 30) {
    console.log(`  decile | score range   |  mean bps |    t | n(coin-days)`);
    console.log(`  -------+---------------+-----------+------+-------------`);
    for (let d = 0; d < 10; d++) {
      const bucket = ptScored.slice(d * dz, (d + 1) * dz);
      const rows: Array<{ coin: string; t: number; r: number }> = [];
      for (const { f } of bucket) {
        const entry = priceAt(candles[f.c], f.t + 10 * MIN);
        const exit  = priceAt(candles[f.c], f.t + 250 * MIN);
        const bEntry = priceAt(btc, f.t + 10 * MIN);
        const bExit  = priceAt(btc, f.t + 250 * MIN);
        if (entry === null || exit === null || bEntry === null || bExit === null) continue;
        if (entry <= 0 || bEntry <= 0) continue;
        const beta = betaBefore(candles[f.c], btc, f.t, `${f.c}|${f.t}`);
        rows.push({ coin: f.c, t: f.t,
          r: ((exit - entry) / entry) * f.d - ((bExit - bEntry) / bEntry) * f.d * beta - ROUND_TRIP_BPS / 10_000 });
      }
      const st = stats(clusterByCoinDay(rows));
      if (!st) continue;
      const lo = bucket[0].s.toFixed(3), hi = bucket[bucket.length - 1].s.toFixed(3);
      console.log(
        `  ${String(d + 1).padStart(6)} | ${`${lo}-${hi}`.padStart(13)} | ` +
        `${bps(st.mean).toFixed(1).padStart(9)} | ${st.t.toFixed(1).padStart(4)} | ${String(st.n).padStart(12)}`
      );
    }
    console.log(`  A monotone rise means selection works and the top is the trade.`);
    console.log(`  A monotone fall in the bottom deciles means fading weak flow is the trade.`);
  } else {
    console.log(`  too few scorable episodes to decile`);
  }

  // The legacy slice using today's score is kept only behind a flag, as a
  // demonstration of what the leak looks like.
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

/** Restrict the cache to entries a real-time follower could have acted on. */
async function applyFreeze(cache: Cache): Promise<Cache> {
  const ids = [...new Set(cache.fills.map((f) => f.w))];
  // Cast to the narrow slice this uses; the full client type is large enough
  // to blow the compiler's structural comparison budget.
  const discovered = await fetchDiscoveryDates(supabase as unknown as DiscoveryQuery, ids);
  const result = freezeToDiscovery(cache.fills, discovered);
  for (const line of describeFreeze(result, "[fill-study]")) console.log(line);
  return { ...cache, fills: result.kept };
}

(async () => {
  let cache: Cache;
  if (DO_FETCH) {
    cache = await fetchAll();
    await fs.writeFile(CACHE_FILE, JSON.stringify(cache));
    console.log(`[fill-study] cached to ${CACHE_FILE}`);
    // The run completed, so the checkpoint is now a stale copy of a finished
    // study and would confuse the next one.
    await fs.rm(CHECKPOINT_FILE, { force: true });
  } else {
    try {
      cache = JSON.parse(await fs.readFile(CACHE_FILE, "utf8")) as Cache;
    } catch {
      console.error(`[fill-study] no cache at ${CACHE_FILE}. Run with --fetch first.`);
      process.exit(1);
    }
  }
  if (FREEZE_POOL) cache = await applyFreeze(cache);
  main(cache);
})().catch((e) => {
  console.error("[fill-study] FAILED:", e.message);
  process.exit(1);
});
