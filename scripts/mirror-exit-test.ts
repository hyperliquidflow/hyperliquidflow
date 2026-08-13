// scripts/mirror-exit-test.ts
//
// Pre-registered in docs/research/2026-08-13-preregistration-mirror-exit.md.
// Read that first. The bar was fixed before this file produced a number.
//
// Enter when a cohort wallet opens a position, exit when that same wallet closes
// it. Every prior copy test used a fixed horizon, which for 78% of positions kept
// the trade open after the wallet had already left.
//
// Read only. Writes nothing.
//
//   npx tsx --env-file=.env.local scripts/mirror-exit-test.ts --wallets=150 --days=90

import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, HYPERLIQUID_API_URL } from "@/lib/env";
import { fetchCandleSnapshot, fetchFundingHistory } from "@/lib/hyperliquid-api-client";
import { computeBeta, toReturns, alignReturns } from "@/lib/beta";
import { computeAlpha, marketReturnBps } from "@/lib/benchmark";
import {
  clusterByDay, trimmedMean, bootstrapMeanCI, fundingOverHold, describe, priceAt, staleTolerance, mulberry32,
} from "@/lib/study-stats";

const arg = (n: string, d: number): number => {
  const v = Number(process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1]);
  return Number.isFinite(v) && v > 0 ? v : d;
};

const N_WALLETS = arg("wallets", 150);
const DAYS      = arg("days", 90);
const LAG_MIN   = arg("lag", 10);
// --pool=discovered draws from every wallet discovered before the cutoff,
// survivor or not. is_active selects on having passed the hygiene gates AND
// still trading, which is survivorship reintroduced through a convenient filter.
const POOL      = process.argv.find((a) => a.startsWith("--pool="))?.split("=")[1] ?? "active";
const SEED      = arg("seed", 20260813);

const COST_BPS  = 19;            // 4.5 taker + 5 slippage, both sides
const MIN_EPISODES = 200;        // pre-registered power floor
const MIN_WALLETS  = 30;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface RawFill {
  coin: string; px: string; sz: string; side: string;
  time: number; startPosition: string; dir: string;
}

interface Episode {
  wallet: string; coin: string; direction: "LONG" | "SHORT";
  tOpen: number; tClose: number; holdH: number;
}

async function hl<T>(body: unknown): Promise<T> {
  const r = await fetch(HYPERLIQUID_API_URL, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`HL ${r.status}`);
  return r.json() as Promise<T>;
}

/** Position reconstructed from startPosition, so a partial close does not end an episode. */
function episodes(address: string, fills: RawFill[], discoveredAt: number): Episode[] {
  const out: Episode[] = [];
  const byCoin = new Map<string, RawFill[]>();
  for (const f of fills) {
    const a = byCoin.get(f.coin) ?? []; a.push(f); byCoin.set(f.coin, a);
  }
  for (const [coin, arr] of byCoin) {
    arr.sort((a, b) => a.time - b.time);
    let tOpen: number | null = null;
    let dir: "LONG" | "SHORT" = "LONG";
    for (const f of arr) {
      const before = parseFloat(f.startPosition);
      const after  = before + (f.side === "B" ? 1 : -1) * parseFloat(f.sz);
      if (Math.abs(before) < 1e-9 && Math.abs(after) > 1e-9) {
        tOpen = f.time; dir = after > 0 ? "LONG" : "SHORT";
      } else if (Math.abs(before) > 1e-9 && Math.abs(after) < 1e-9 && tOpen != null) {
        // Frozen pool: no entry may predate the date the wallet became knowable.
        if (tOpen >= discoveredAt) {
          out.push({ wallet: address, coin, direction: dir, tOpen, tClose: f.time,
                     holdH: (f.time - tOpen) / 3_600_000 });
        }
        tOpen = null;
      }
    }
    // Still-open positions are excluded, never treated as closed.
  }
  return out;
}

async function main(): Promise<void> {
  let ws: Array<{ address: string; created_at: string | null }> = [];
  if (POOL === "discovered") {
    // Everything discovered before May, drawn at random with a recorded seed so
    // the draw cannot be conditioned on performance and the run is repeatable.
    const { data, error } = await supabase
      .from("wallets").select("address, created_at")
      .lt("created_at", "2026-05-01").limit(5000);
    if (error) { console.error(error.message); process.exit(1); }
    const pool = (data ?? []) as typeof ws;
    const rng = mulberry32(SEED);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    ws = pool.slice(0, N_WALLETS);
    console.log(`[mirror] pool=discovered, ${pool.length} candidates, sampled ${ws.length} with seed ${SEED}`);
  } else {
    const { data, error } = await supabase
      .from("wallets").select("address, created_at").eq("is_active", true).limit(N_WALLETS);
    if (error) { console.error(error.message); process.exit(1); }
    ws = (data ?? []) as typeof ws;
    console.log(`[mirror] pool=active, ${ws.length} wallets. NOTE: selects on surviving, favours the lead.`);
  }
  console.log(`[mirror] ${DAYS}d window, lag ${LAG_MIN}m`);

  const since = Date.now() - DAYS * 86_400_000;
  const all: Episode[] = [];
  let withFills = 0;

  for (const w of ws ?? []) {
    try {
      const fills = await hl<RawFill[]>({ type: "userFillsByTime", user: w.address, startTime: since });
      if (!Array.isArray(fills) || fills.length === 0) { await sleep(110); continue; }
      withFills++;
      const discoveredAt = w.created_at ? new Date(w.created_at as string).getTime() : 0;
      all.push(...episodes(w.address, fills, discoveredAt));
    } catch { /* one wallet failing is not the study failing */ }
    await sleep(110);
  }
  console.log(`[mirror] ${withFills} wallets with fills, ${all.length} completed episodes`);

  // Price and funding series per coin, fetched once.
  const coins = [...new Set(all.map((e) => e.coin))];
  console.log(`[mirror] ${coins.length} coins, fetching candles and funding`);
  const bars = new Map<string, Array<{ t: number; c: string }>>();
  const funding = new Map<string, Array<readonly [number, number]>>();
  for (const coin of coins) {
    try {
      const c = await fetchCandleSnapshot(coin, "1h", since, Date.now());
      bars.set(coin, c as Array<{ t: number; c: string }>);
      const f = await fetchFundingHistory(coin, since);
      funding.set(coin, f.map((x) => [x.time, parseFloat(x.fundingRate)] as const));
    } catch { /* coin without candles drops out below */ }
    await sleep(90);
  }
  const btc = bars.get("BTC") ?? [];

  // Built once per coin. Rebuilding inside the lookup would be O(bars) per
  // episode and quietly turn a minute of work into an hour.
  const series = new Map<string, Array<readonly [number, number]>>();
  for (const [coin, b] of bars) {
    series.set(coin, b.map((x) => [x.t, parseFloat(x.c)] as const));
  }
  const px = (coin: string, t: number): number | null => {
    const sr = series.get(coin);
    return sr ? priceAt(sr, t, staleTolerance(60)) : null;
  };

  // Per-coin beta to BTC, so the benchmark charges each trade for its exposure.
  const betas = new Map<string, number | null>();
  const btcRets = toReturns(btc.map((b) => ({ t: b.t, c: b.c })));
  for (const coin of coins) {
    const b = bars.get(coin);
    if (!b) { betas.set(coin, null); continue; }
    const cr = toReturns(b.map((x) => ({ t: x.t, c: x.c })));
    const aligned = alignReturns(cr, btcRets);
    betas.set(coin, computeBeta(aligned.coin, aligned.market));
  }

  const lagMs = LAG_MIN * 60_000;
  const rows: Array<{ t: number; r: number }> = [];
  const holds: number[] = [];
  let unpriced = 0;

  for (const e of all) {
    const entry = px(e.coin, e.tOpen + lagMs);
    const exit  = px(e.coin, e.tClose + lagMs);
    if (entry == null || exit == null || entry <= 0) { unpriced++; continue; }

    const sign  = e.direction === "LONG" ? 1 : -1;
    const gross = sign * ((exit - entry) / entry) * 10_000;

    const f = funding.get(e.coin) ?? [];
    const { sum } = fundingOverHold(f, e.tOpen + lagMs, e.tClose + lagMs);
    const fundingBps = sign * sum * 10_000;   // positive sum means longs paid

    const net = gross - COST_BPS - fundingBps;

    const be = px("BTC", e.tOpen + lagMs);
    const bx = px("BTC", e.tClose + lagMs);
    const mkt = be != null && bx != null ? marketReturnBps(be, bx) : null;
    const { alpha_bps } = computeAlpha({
      netPnlBps: net, marketReturnBps: mkt, direction: e.direction, beta: betas.get(e.coin) ?? 1,
    });
    if (alpha_bps == null) { unpriced++; continue; }

    rows.push({ t: e.tOpen, r: alpha_bps });
    holds.push(e.holdH);
  }

  console.log(`[mirror] ${rows.length} priced episodes, ${unpriced} dropped for missing price or benchmark\n`);

  if (rows.length < MIN_EPISODES || withFills < MIN_WALLETS) {
    console.log(`=== UNDERPOWERED, no verdict recorded ===`);
    console.log(`  needs ${MIN_EPISODES}+ episodes across ${MIN_WALLETS}+ wallets, got ${rows.length} across ${withFills}`);
    return;
  }

  const daily = clusterByDay(rows);
  const s = describe(daily);
  if (!s) { console.log("no usable daily series"); return; }
  const t = s.mean / (s.sd / Math.sqrt(daily.length));
  const trim = trimmedMean(daily, 0.1);
  const ci = bootstrapMeanCI(daily, { iters: 2000, seed: 12345 });

  const mid = Math.floor(rows.length / 2);
  const half = (xs: typeof rows) => {
    const d = clusterByDay(xs); const q = describe(d);
    return q ? { mean: q.mean, t: q.mean / (q.sd / Math.sqrt(d.length)), n: d.length } : null;
  };
  const early = half(rows.slice(0, mid));
  const late  = half(rows.slice(mid));

  const hs = [...holds].sort((a, b) => a - b);
  console.log(`=== MIRROR EXIT: enter on their open, exit on their close ===`);
  console.log(`  hold hours   median ${hs[Math.floor(hs.length / 2)].toFixed(1)}, p90 ${hs[Math.floor(hs.length * 0.9)].toFixed(1)}`);
  console.log(`  episodes     ${rows.length} over ${daily.length} days`);
  console.log(`  net alpha    ${s.mean.toFixed(1)} bps per episode`);
  console.log(`  day-clustered t   ${t.toFixed(2)}`);
  console.log(`  trimmed10    ${trim == null ? "n/a" : trim.toFixed(1)} bps`);
  console.log(`  boot95       [${ci ? `${ci.lo.toFixed(1)}, ${ci.hi.toFixed(1)}` : "n/a"}] bps`);
  if (early && late) {
    const agree = Math.sign(early.mean) === Math.sign(late.mean);
    console.log(`  split-half   early ${early.mean.toFixed(1)} (t ${early.t.toFixed(2)}) / late ${late.mean.toFixed(1)} (t ${late.t.toFixed(2)})  ${agree ? "signs agree" : "SIGNS DISAGREE"}`);
  }

  console.log(`\n=== VERDICT against the pre-registered bar ===`);
  const c1 = s.mean > 0 && t >= 2.5;
  const c2 = trim != null && trim > 0;
  const c3 = early != null && late != null && Math.sign(early.mean) === Math.sign(late.mean);
  console.log(`  1. mean > 0 and t >= 2.5      ${c1 ? "PASS" : "FAIL"}`);
  console.log(`  2. trimmed mean > 0           ${c2 ? "PASS" : "FAIL"}`);
  console.log(`  3. split halves agree in sign ${c3 ? "PASS" : "FAIL"}`);
  console.log(`\n  ${c1 && c2 && c3 ? "NOT KILLED by this window. Nothing is confirmed." : "FAIL. Mirror-exit copying is dead per the written consequence."}`);
  console.log(`\nNothing was written.`);
}

void main();
