// scripts/tape-population.ts
//
// Build a wallet population discovered from the public tape rather than the
// leaderboard, and fetch its history.
//
// Why this exists. Discovery today reads the Hyperliquid leaderboard, which ranks
// by realised PnL, so a wallet enters this project's universe *because it already
// won*. That conditioning is the reason --freeze-pool exists, the reason the clean
// window is capped near 123 days, and a defect sitting under every number in
// docs/research. Addresses seen on the tape are selected on having traded, not on
// having profited.
//
// It is not bias free and the register entry must say so: a wallet that blew up
// and stopped trading never appears on today's tape. That is survivorship of
// activity, which is far weaker than survivorship of performance, but it is not
// nothing.
//
// Read only. Writes a cache file, never Supabase or KV.
//
//   npx tsx --env-file=.env.local scripts/tape-population.ts --fetch --days=30
//   npx tsx --env-file=.env.local scripts/tape-population.ts --fetch --days=30 --max-wallets=300
//   npx tsx --env-file=.env.local scripts/tape-population.ts            (summarise cache)

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, HYPERLIQUID_API_URL } from "@/lib/env";

const CACHE      = "tape-population-cache.json";
const CHECKPOINT = "tape-population-checkpoint.json";
// The drawn sample, frozen. The collector adds addresses continuously, so the
// eligible list grows between runs and a same-seed redraw is a DIFFERENT sample:
// measured 2026-08-14, a restart minutes later shared only 42 of 100 addresses
// with the draw it was resuming. Freezing the target list is what makes the run
// reproducible and lets a restart resume instead of silently resampling.
const TARGETS    = "tape-population-targets.json";

const arg = (name: string, fallback: number): number => {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const DO_FETCH    = process.argv.includes("--fetch");
// Convert a checkpoint written in the old raw-fill shape without refetching.
const FROM_CKPT   = process.argv.includes("--from-checkpoint");
const DAYS        = arg("days", 30);
const MAX_WALLETS = arg("max-wallets", 400);
const MIN_NOTIONAL = arg("min-notional", 50_000);
// Exclude persistent, broad-quoting addresses. Ranking by notional selects for
// market makers: measured 2026-08-14, the top 300 by notional was 13% maker-like
// and 71% recurring high-frequency, which is not the population a discretionary
// skill score is measuring. Two-sidedness cannot be used to detect them because
// both counterparties inherit the trade's single `side` field, so persistence and
// breadth are the signals that survive.
const MAX_MINUTE_SHARE = Number(process.argv.find((a) => a.startsWith("--max-minute-share="))?.split("=")[1] ?? 0.20);
const MAX_COINS        = arg("max-coins", 3);
const RANDOM_SAMPLE    = !process.argv.includes("--by-notional");
const SEED             = arg("seed", 20260814);
// 12 page-capped 31 of 331 wallets on 2026-08-14, and a capped wallet is scored
// on partial history. Raising the cap shrinks that set; whatever still caps is
// marked and excluded from the primary statistic rather than silently scored.
const MAX_PAGES        = arg("max-pages", 30);
const CONCURRENCY      = arg("concurrency", 3);
const REDRAW           = process.argv.includes("--redraw");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface Fill {
  coin: string; px: string; sz: string; side: string;
  time: number; closedPnl?: string; dir?: string; hash?: string;
}

interface WalletRecord {
  address:       string;
  tape_notional: number;   // notional seen on the tape during discovery
  tape_minutes:  number;   // distinct minutes active, a crude activity measure
  tape_coins:    number;   // distinct coins traded on the tape
  equity:        number | null;
  position_count: number | null;
  /** Realised PnL per UTC day index, sparse. Raw fills are not kept: 300 wallets
   *  of them is over a million objects and JSON.stringify dies on the string
   *  length, which is the 1GB-fetch defect this repo already recorded once. */
  daily:         Array<[number, number]>;
  fill_count:    number;
  fill_pages:    number;
  truncated:     boolean;  // history is partial, for either reason below
  truncation:    Truncation;
}

/** Sum closedPnl per UTC day. Sparse, so absent days carry no row. */
function toDaily(fills: Fill[]): Array<[number, number]> {
  const byDay = new Map<number, number>();
  for (const f of fills) {
    const pnl = parseFloat(f.closedPnl ?? "0");
    if (!Number.isFinite(pnl)) continue;
    const d = Math.floor(f.time / 86_400_000);
    byDay.set(d, (byDay.get(d) ?? 0) + pnl);
  }
  return [...byDay.entries()].sort((a, b) => a[0] - b[0]);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A 429 and a 5xx need opposite treatment and the old single budget conflated
 * them. A 429 is our own rate and always deserves the full backoff. A 5xx on this
 * endpoint is usually a query the server will not serve rather than a blip:
 * measured 2026-08-14, 30 of 378 addresses failed all four attempts, so 15
 * seconds of backoff each rescued none of them and only slowed the run.
 */
async function hlPost<T>(body: unknown, opts: { serverAttempts?: number } = {}): Promise<T> {
  const maxServer = opts.serverAttempts ?? 4;
  let serverFails = 0;
  let rateFails   = 0;
  for (;;) {
    let res: Response;
    try {
      res = await fetch(HYPERLIQUID_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (err) {
      // A transport failure throws rather than returning a status, so the
      // status-based branches below never saw it: 21 of 22 dropouts on the
      // 2026-08-14 draw were `TypeError: fetch failed` and were never retried
      // once. Treated as a server fault, which is what a dropped socket is.
      if (++serverFails >= maxServer) throw err;
      await sleep(1_000 * serverFails);
      continue;
    }
    if (res.ok) return res.json() as Promise<T>;
    if (res.status === 429) {
      if (++rateFails >= 6) throw new Error("HL 429 retries exhausted");
      await sleep(1_000 * Math.pow(2, Math.min(rateFails, 4)));
      continue;
    }
    if (res.status >= 500) {
      if (++serverFails >= maxServer) throw new Error(`HL ${res.status} after ${serverFails} attempts`);
      await sleep(500 * serverFails);
      continue;
    }
    throw new Error(`HL ${res.status}`);
  }
}

/**
 * Discovered population, from the flow tables the collector writes.
 * Ranked by notional so a truncated run keeps the addresses that matter.
 */
/** Observed tape span in minutes, set by discovery and written into the cache so
 *  a presence share stays comparable across runs of different length. */
let tapeSpanMinutes = 0;

interface AddressMinuteRow {
  address: string; coin: string; minute: string;
  side_b_notional: number | string; side_a_notional: number | string;
}

/**
 * Read every `flow_address_minute` row, in pages.
 *
 * PostgREST caps a response at 5,000 rows and **says nothing when it does**: a
 * `.limit(200_000)` returns 5,000 with no error and no truncation flag. Measured
 * 2026-08-14, that silently drew the population from the oldest 2.5 hours of a
 * 21.6-hour tape, which is why an extra 15 hours of collection produced the same
 * 378 eligible addresses. Same family as the candleSnapshot cap in CLAUDE.md.
 *
 * The order clause is not decoration. Without one, PostgREST gives no ordering
 * guarantee, so paging by range can repeat or skip rows.
 */
async function readAllAddressMinutes(): Promise<AddressMinuteRow[]> {
  const PAGE = 5_000;
  const out: AddressMinuteRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("flow_address_minute")
      .select("address, coin, minute, side_b_notional, side_a_notional")
      .order("minute", { ascending: true })
      .order("address", { ascending: true })
      .order("coin", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`flow_address_minute read failed: ${error.message}`);
    const page = (data ?? []) as AddressMinuteRow[];
    out.push(...page);
    if (page.length < PAGE) break;
  }
  console.log(`[tape] read ${out.length.toLocaleString("en-US")} address-minute rows`);
  return out;
}

async function discoverFromTape(): Promise<Array<{ address: string; notional: number; minutes: number; coins: number }>> {
  const rows = await readAllAddressMinutes();

  const agg = new Map<string, { notional: number; minutes: Set<string>; coins: Set<string> }>();
  const allMinutes = new Set<string>();
  for (const r of rows) {
    allMinutes.add(r.minute as string);
    const a = agg.get(r.address) ?? { notional: 0, minutes: new Set<string>(), coins: new Set<string>() };
    a.notional += Number(r.side_b_notional) + Number(r.side_a_notional);
    a.minutes.add(r.minute as string);
    a.coins.add(r.coin as string);
    agg.set(r.address, a);
  }
  const span = Math.max(1, allMinutes.size);
  tapeSpanMinutes = span;

  const eligible = [...agg.entries()]
    .map(([address, v]) => ({
      address, notional: v.notional, minutes: v.minutes.size,
      share: v.minutes.size / span, coins: v.coins.size,
    }))
    .filter((w) => w.notional >= MIN_NOTIONAL)
    // A maker is on the tape most minutes across many coins. Excluding by
    // behaviour, not by a guessed size threshold.
    .filter((w) => !(w.share >= MAX_MINUTE_SHARE && w.coins >= MAX_COINS));

  const excluded = [...agg.values()].filter((v) =>
    v.notional >= MIN_NOTIONAL && v.minutes.size / span >= MAX_MINUTE_SHARE && v.coins.size >= MAX_COINS).length;
  console.log(`[tape] ${eligible.length} eligible, ${excluded} excluded as maker-like (>=${MAX_MINUTE_SHARE * 100}% of minutes and >=${MAX_COINS} coins)`);

  if (!RANDOM_SAMPLE) return eligible.sort((a, b) => b.notional - a.notional);

  // Random, because sorting by notional is itself the maker filter in reverse.
  const rng = mulberry32(SEED);
  for (let i = eligible.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
  }
  console.log(`[tape] random sample, seed ${SEED}`);
  return eligible;
}

/** Same seeded PRNG the study scripts use, so a draw is repeatable. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Why a wallet's history may be incomplete. Any value but "none" means the
 *  daily series ends before the wallet did, so its score is computed on partial
 *  history and it is excluded from the primary statistic. */
type Truncation = "none" | "page_cap" | "fetch_error";

interface FillResult { fills: Fill[]; pages: number; truncated: boolean; truncation: Truncation }

/**
 * Paginate past the 2,000 fill cap by advancing startTime past the newest fill
 * seen, per the measured limit in CLAUDE.md. The cap has no truncation signal,
 * so a full page is the only hint that more exists.
 *
 * A failed page keeps the pages already retrieved and marks the wallet rather
 * than discarding it, because a dropped address biases the sample and a marked
 * one can simply be excluded from the primary statistic.
 */
async function fetchFills(address: string, sinceMs: number): Promise<FillResult> {
  const out: Fill[] = [];
  let cursor = sinceMs;
  let pages  = 0;

  while (pages < MAX_PAGES) {
    let page: Fill[];
    try {
      page = await hlPost<Fill[]>(
        { type: "userFillsByTime", user: address, startTime: cursor },
        { serverAttempts: 2 },
      );
    } catch {
      return { fills: out, pages, truncated: true, truncation: "fetch_error" };
    }
    pages++;
    if (!Array.isArray(page) || page.length === 0) return { fills: out, pages, truncated: false, truncation: "none" };
    out.push(...page);
    if (page.length < 2_000) return { fills: out, pages, truncated: false, truncation: "none" };

    const newest = Math.max(...page.map((f) => f.time));
    if (newest <= cursor) return { fills: out, pages, truncated: true, truncation: "page_cap" };  // no progress, stop
    cursor = newest + 1;
    await sleep(120);
  }
  return { fills: out, pages, truncated: true, truncation: "page_cap" };
}

async function main(): Promise<void> {
  if (FROM_CKPT) {
    const raw = JSON.parse(readFileSync(CHECKPOINT, "utf8")) as Record<string, WalletRecord & { fills?: Fill[] }>;
    const wallets = Object.values(raw).map((w) => ({
      ...w,
      daily:      w.daily ?? toDaily(w.fills ?? []),
      fill_count: w.fill_count ?? (w.fills?.length ?? 0),
      truncation: w.truncation ?? (w.truncated ? "page_cap" : "none"),
      fills:      undefined,
    }));
    writeFileSync(CACHE, JSON.stringify({
      fetched_at: new Date().toISOString(), days: DAYS, min_notional: MIN_NOTIONAL,
      discovery: "tape", wallets,
    }));
    console.log(`[tape] salvaged ${wallets.length} wallets from checkpoint into ${CACHE}`);
    return;
  }
  if (!DO_FETCH) {
    if (!existsSync(CACHE)) { console.log(`No ${CACHE}. Run with --fetch first.`); return; }
    const c = JSON.parse(readFileSync(CACHE, "utf8"));
    const wallets: WalletRecord[] = c.wallets ?? [];
    const withFills = wallets.filter((w) => w.daily.length > 0);
    const totalFills = wallets.reduce((s, w) => s + w.fill_count, 0);
    console.log(`cache        fetched_at ${c.fetched_at}, days ${c.days}`);
    console.log(`wallets      ${wallets.length} (${withFills.length} with realised PnL)`);
    console.log(`fills        ${totalFills.toLocaleString("en-US")}`);
    console.log(`truncated    ${wallets.filter((w) => w.truncated).length} partial (${wallets.filter((w) => w.truncation === "page_cap").length} page cap, ${wallets.filter((w) => w.truncation === "fetch_error").length} fetch error)`);
    console.log(`dropped      ${(c.dropped ?? []).length} addresses never fetched`);
    const eq = wallets.map((w) => w.equity ?? 0).filter((e) => e > 0).sort((a, b) => a - b);
    if (eq.length > 0) {
      console.log(`equity       median $${(eq[Math.floor(eq.length / 2)] / 1e3).toFixed(0)}k, max $${(eq[eq.length - 1] / 1e6).toFixed(2)}M`);
    }
    return;
  }

  interface Target { address: string; notional: number; minutes: number; coins: number }
  interface TargetFile { drawn_at: string; seed: number | null; eligible: number; span_minutes: number; targets: Target[] }

  let targets: Target[];
  let eligibleCount: number;
  if (existsSync(TARGETS) && !REDRAW) {
    const f = JSON.parse(readFileSync(TARGETS, "utf8")) as TargetFile;
    targets = f.targets;
    eligibleCount = f.eligible;
    tapeSpanMinutes = f.span_minutes;
    console.log(`[tape] reusing the frozen draw from ${f.drawn_at}: ${targets.length} of ${f.eligible} eligible`);
    console.log(`[tape] pass --redraw to sample again, which produces a DIFFERENT sample because the tape has grown`);
  } else {
    const discovered = await discoverFromTape();
    eligibleCount = discovered.length;
    console.log(`[tape] ${discovered.length} addresses above $${MIN_NOTIONAL.toLocaleString("en-US")} on the tape`);
    targets = discovered.slice(0, MAX_WALLETS).map((t) => ({
      address: t.address, notional: t.notional, minutes: t.minutes, coins: t.coins,
    }));
    const file: TargetFile = {
      drawn_at: new Date().toISOString(), seed: RANDOM_SAMPLE ? SEED : null,
      eligible: eligibleCount, span_minutes: tapeSpanMinutes, targets,
    };
    writeFileSync(TARGETS, JSON.stringify(file));
    console.log(`[tape] froze the draw into ${TARGETS}`);
  }
  console.log(`[tape] fetching history for ${targets.length}, ${DAYS} days back`);

  const done: Record<string, WalletRecord> = existsSync(CHECKPOINT)
    ? JSON.parse(readFileSync(CHECKPOINT, "utf8"))
    : {};
  const sinceMs = Date.now() - DAYS * 86_400_000;

  // Dropouts are not random: an address whose query the server refuses is
  // plausibly one with a large history, so silently losing them trims the
  // high-volume tail. Counted and written into the cache so the register entry
  // can state the size of the hole rather than omit it.
  const dropped: string[] = [];
  let partialFetches = 0;

  // Serial, this is latency-bound rather than rate-bound: measured 2.7 wallets a
  // minute, which is roughly 14 requests a minute against an endpoint that allows
  // far more. A small pool cuts a 900-wallet draw from about five hours to under
  // two. Kept small deliberately, because 429s are handled by backing off and a
  // storm of them would be slower than going serially.
  const pending = targets.filter((t) => !done[t.address]);
  console.log(`[tape] ${targets.length - pending.length} already in the checkpoint, ${pending.length} to fetch, concurrency ${CONCURRENCY}`);

  let cursor = 0, finished = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const t = pending[cursor++];
      if (!t) return;
      try {
        // Equity is context, not an input to any statistic here, so a failed
        // state lookup degrades to null rather than costing the whole wallet.
        // Losing a wallet's history because a second endpoint was unavailable is
        // sample loss for nothing.
        const [state, fillsRes] = await Promise.all([
          hlPost<{ marginSummary?: { accountValue?: string }; assetPositions?: unknown[] }>(
            { type: "clearinghouseState", user: t.address }).catch(() => null),
          fetchFills(t.address, sinceMs),
        ]);
        done[t.address] = {
          address:        t.address,
          tape_notional:  Math.round(t.notional),
          tape_minutes:   t.minutes,
          tape_coins:     t.coins,
          equity:         parseFloat(state?.marginSummary?.accountValue ?? "0") || null,
          position_count: state?.assetPositions?.length ?? null,
          daily:          toDaily(fillsRes.fills),
          fill_count:     fillsRes.fills.length,
          fill_pages:     fillsRes.pages,
          truncated:      fillsRes.truncated,
          truncation:     fillsRes.truncation,
        };
        if (fillsRes.truncation === "fetch_error") partialFetches++;
      } catch (err) {
        dropped.push(t.address);
        console.error(`[tape] ${t.address} failed:`, err instanceof Error ? err.message : err);
      }
      // Single-threaded, so the write cannot interleave with another worker's.
      if (++finished % 25 === 0) {
        writeFileSync(CHECKPOINT, JSON.stringify(done));
        console.log(`[tape] ${finished}/${pending.length}, checkpointed`);
      }
      await sleep(150);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  writeFileSync(CHECKPOINT, JSON.stringify(done));

  // Only the frozen draw. The checkpoint can carry wallets from an earlier draw,
  // and writing those would make the cache a union of two samples rather than one
  // draw, which is the quiet kind of contamination this project keeps meeting.
  const inDraw = new Set(targets.map((t) => t.address));
  const carried = Object.keys(done).filter((a) => !inDraw.has(a)).length;
  const wallets = Object.values(done).filter((w) => inDraw.has(w.address));
  if (carried > 0) console.log(`[tape] ${carried} checkpoint wallets are outside this draw and were not written`);

  writeFileSync(CACHE, JSON.stringify({
    fetched_at: new Date().toISOString(),
    days:       DAYS,
    min_notional: MIN_NOTIONAL,
    discovery:  "tape",   // NOT leaderboard. The whole point.
    seed:       RANDOM_SAMPLE ? SEED : null,
    max_pages:  MAX_PAGES,
    tape_span_minutes: tapeSpanMinutes,
    eligible:   eligibleCount,
    attempted:  targets.length,
    dropped,
    wallets,
  }));
  console.log(`[tape] wrote ${CACHE}: ${wallets.length} wallets, ${wallets.reduce((s, w) => s + w.fill_count, 0).toLocaleString("en-US")} fills condensed to daily`);
  console.log(`[tape] attempted ${targets.length}, dropped ${dropped.length}, partial from fetch error ${partialFetches}, page-capped ${wallets.filter((w) => w.truncation === "page_cap").length}`);
}

void main();
