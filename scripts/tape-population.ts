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

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface Fill {
  coin: string; px: string; sz: string; side: string;
  time: number; closedPnl?: string; dir?: string; hash?: string;
}

interface WalletRecord {
  address:       string;
  tape_notional: number;   // notional seen on the tape during discovery
  tape_minutes:  number;   // distinct minutes active, a crude activity measure
  equity:        number | null;
  position_count: number | null;
  /** Realised PnL per UTC day index, sparse. Raw fills are not kept: 300 wallets
   *  of them is over a million objects and JSON.stringify dies on the string
   *  length, which is the 1GB-fetch defect this repo already recorded once. */
  daily:         Array<[number, number]>;
  fill_count:    number;
  fill_pages:    number;
  truncated:     boolean;  // hit the page cap, more history exists
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

async function hlPost<T>(body: unknown): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(HYPERLIQUID_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return res.json() as Promise<T>;
    // 429 and 5xx get a backoff. Anything else is a real error worth surfacing.
    if (res.status !== 429 && res.status < 500) throw new Error(`HL ${res.status}`);
    await sleep(1_000 * Math.pow(2, attempt));
  }
  throw new Error("HL retries exhausted");
}

/**
 * Discovered population, from the flow tables the collector writes.
 * Ranked by notional so a truncated run keeps the addresses that matter.
 */
async function discoverFromTape(): Promise<Array<{ address: string; notional: number; minutes: number }>> {
  const { data, error } = await supabase
    .from("flow_address_minute")
    .select("address, coin, minute, side_b_notional, side_a_notional")
    .limit(200_000);
  if (error) throw new Error(`flow_address_minute read failed: ${error.message}`);

  const agg = new Map<string, { notional: number; minutes: Set<string>; coins: Set<string> }>();
  const allMinutes = new Set<string>();
  for (const r of data ?? []) {
    allMinutes.add(r.minute as string);
    const a = agg.get(r.address) ?? { notional: 0, minutes: new Set<string>(), coins: new Set<string>() };
    a.notional += Number(r.side_b_notional) + Number(r.side_a_notional);
    a.minutes.add(r.minute as string);
    a.coins.add(r.coin as string);
    agg.set(r.address, a);
  }
  const span = Math.max(1, allMinutes.size);

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

/**
 * Paginate past the 2,000 fill cap by advancing startTime past the newest fill
 * seen, per the measured limit in CLAUDE.md. The cap has no truncation signal,
 * so a full page is the only hint that more exists.
 */
async function fetchFills(address: string, sinceMs: number): Promise<{ fills: Fill[]; pages: number; truncated: boolean }> {
  const out: Fill[] = [];
  let cursor = sinceMs;
  let pages  = 0;
  const MAX_PAGES = 12;

  while (pages < MAX_PAGES) {
    const page = await hlPost<Fill[]>({ type: "userFillsByTime", user: address, startTime: cursor });
    pages++;
    if (!Array.isArray(page) || page.length === 0) return { fills: out, pages, truncated: false };
    out.push(...page);
    if (page.length < 2_000) return { fills: out, pages, truncated: false };

    const newest = Math.max(...page.map((f) => f.time));
    if (newest <= cursor) return { fills: out, pages, truncated: true };  // no progress, stop
    cursor = newest + 1;
    await sleep(120);
  }
  return { fills: out, pages, truncated: true };
}

async function main(): Promise<void> {
  if (FROM_CKPT) {
    const raw = JSON.parse(readFileSync(CHECKPOINT, "utf8")) as Record<string, WalletRecord & { fills?: Fill[] }>;
    const wallets = Object.values(raw).map((w) => ({
      ...w,
      daily:      w.daily ?? toDaily(w.fills ?? []),
      fill_count: w.fill_count ?? (w.fills?.length ?? 0),
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
    console.log(`truncated    ${wallets.filter((w) => w.truncated).length} wallets hit the page cap`);
    const eq = wallets.map((w) => w.equity ?? 0).filter((e) => e > 0).sort((a, b) => a - b);
    if (eq.length > 0) {
      console.log(`equity       median $${(eq[Math.floor(eq.length / 2)] / 1e3).toFixed(0)}k, max $${(eq[eq.length - 1] / 1e6).toFixed(2)}M`);
    }
    return;
  }

  const discovered = await discoverFromTape();
  console.log(`[tape] ${discovered.length} addresses above $${MIN_NOTIONAL.toLocaleString("en-US")} on the tape`);
  const targets = discovered.slice(0, MAX_WALLETS);
  console.log(`[tape] fetching history for ${targets.length}, ${DAYS} days back`);

  const done: Record<string, WalletRecord> = existsSync(CHECKPOINT)
    ? JSON.parse(readFileSync(CHECKPOINT, "utf8"))
    : {};
  const sinceMs = Date.now() - DAYS * 86_400_000;

  let i = 0;
  for (const t of targets) {
    i++;
    if (done[t.address]) continue;
    try {
      const [state, fillsRes] = await Promise.all([
        hlPost<{ marginSummary?: { accountValue?: string }; assetPositions?: unknown[] }>(
          { type: "clearinghouseState", user: t.address }),
        fetchFills(t.address, sinceMs),
      ]);
      done[t.address] = {
        address:        t.address,
        tape_notional:  Math.round(t.notional),
        tape_minutes:   t.minutes,
        equity:         parseFloat(state?.marginSummary?.accountValue ?? "0") || null,
        position_count: state?.assetPositions?.length ?? null,
        daily:          toDaily(fillsRes.fills),
        fill_count:     fillsRes.fills.length,
        fill_pages:     fillsRes.pages,
        truncated:      fillsRes.truncated,
      };
    } catch (err) {
      console.error(`[tape] ${t.address} failed:`, err instanceof Error ? err.message : err);
    }
    if (i % 25 === 0) {
      writeFileSync(CHECKPOINT, JSON.stringify(done));
      console.log(`[tape] ${i}/${targets.length}, checkpointed`);
    }
    await sleep(150);
  }

  const wallets = Object.values(done);
  writeFileSync(CACHE, JSON.stringify({
    fetched_at: new Date().toISOString(),
    days:       DAYS,
    min_notional: MIN_NOTIONAL,
    discovery:  "tape",   // NOT leaderboard. The whole point.
    wallets,
  }));
  console.log(`[tape] wrote ${CACHE}: ${wallets.length} wallets, ${wallets.reduce((s, w) => s + w.fill_count, 0).toLocaleString("en-US")} fills condensed to daily`);
}

void main();
