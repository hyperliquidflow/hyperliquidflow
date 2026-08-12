// scripts/cache-audit.ts
//
// Is the cache actually what the exchange says?
//
// Every research number this project has produced is computed from
// fill-study-cache.json, and the cache has never been checked against the API
// it came from. The twice-run reproduction of the overlap correction proved the
// pipeline is deterministic, which is a different claim: determinism says two
// runs agree with each other, not that either agrees with reality. A cache
// built from a truncated, misaligned or stale fetch would reproduce perfectly
// and be wrong in exactly the same way both times.
//
// This re-fetches a sample directly from the exchange and compares. It writes
// nothing and touches neither Supabase nor the cache.
//
//   npx tsx --env-file=.env.local scripts/cache-audit.ts
//   npx tsx --env-file=.env.local scripts/cache-audit.ts --coins=10 --cache=path.json

import * as fs from "fs/promises";
import { fetchCandleSnapshot } from "../lib/hyperliquid-api-client";

const CACHE_FILE = process.argv.find((a) => a.startsWith("--cache="))?.split("=")[1]
  ?? "fill-study-cache.json";
const SAMPLE_COINS = Number(process.argv.find((a) => a.startsWith("--coins="))?.split("=")[1] ?? 6);
/** Polite: a long fetch may be running against the same rate limit. */
const GAP_MS = 600;
/** A close matching to this relative tolerance is the same close. */
const PRICE_TOL = 1e-9;

interface Cache {
  fetched_at: string;
  days: number;
  interval?: string;
  fills: Array<{ c: string; t: number }>;
  candles: Record<string, [number, number][]>;
}

/** Deterministic pick so a rerun audits the same sample. */
function evenlySpaced<T>(xs: T[], n: number): T[] {
  if (xs.length <= n) return xs;
  const step = xs.length / n;
  return Array.from({ length: n }, (_, i) => xs[Math.floor(i * step)]);
}

async function main() {
  const cache = JSON.parse(await fs.readFile(CACHE_FILE, "utf8")) as Cache;
  const interval = cache.interval ?? "1h";
  const coins = Object.keys(cache.candles).filter((c) => (cache.candles[c]?.length ?? 0) > 50);
  const sample = evenlySpaced(coins.sort(), SAMPLE_COINS);

  console.log(`[audit] cache ${CACHE_FILE}`);
  console.log(`[audit] fetched_at ${cache.fetched_at}, ${cache.days}d at ${interval}, ${coins.length} coins with candles`);
  console.log(`[audit] auditing ${sample.length} coins against the live exchange\n`);

  console.log(`  coin        | cached | matched | mismatched | missing | worst rel diff`);
  console.log(`  ------------+--------+---------+------------+---------+---------------`);

  let totalMismatch = 0, totalMissing = 0, totalMatched = 0;
  let worstSeen = 0;

  for (const coin of sample) {
    const cached = cache.candles[coin];
    // Audit the middle of the span: the edges are where a partial bar or a
    // truncated request legitimately differs, and they would mask a real fault.
    const lo = cached[Math.floor(cached.length * 0.25)][0];
    const hi = cached[Math.floor(cached.length * 0.75)][0];

    let live: Array<{ t: number; c: string }> = [];
    try {
      live = (await fetchCandleSnapshot(coin, interval, lo, hi)) as Array<{ t: number; c: string }>;
    } catch (e) {
      console.log(`  ${coin.padEnd(11)} | fetch failed: ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, GAP_MS));
      continue;
    }

    const liveByTs = new Map<number, number>();
    for (const bar of live) liveByTs.set(Number(bar.t), Number(bar.c));

    const inWindow = cached.filter(([t]) => t >= lo && t <= hi);
    let matched = 0, mismatched = 0, missing = 0, worst = 0;
    for (const [t, close] of inWindow) {
      const liveClose = liveByTs.get(t);
      if (liveClose === undefined) { missing++; continue; }
      const rel = Math.abs(liveClose - close) / Math.max(Math.abs(liveClose), 1e-12);
      if (rel > PRICE_TOL) { mismatched++; worst = Math.max(worst, rel); }
      else matched++;
    }

    totalMatched += matched; totalMismatch += mismatched; totalMissing += missing;
    worstSeen = Math.max(worstSeen, worst);
    console.log(
      `  ${coin.padEnd(11)} | ${String(inWindow.length).padStart(6)} | ${String(matched).padStart(7)} | ` +
      `${String(mismatched).padStart(10)} | ${String(missing).padStart(7)} | ${worst === 0 ? "0" : worst.toExponential(1)}`
    );
    await new Promise((r) => setTimeout(r, GAP_MS));
  }

  const checked = totalMatched + totalMismatch + totalMissing;
  console.log(`\n  ${checked} bars checked: ${totalMatched} identical, ${totalMismatch} different, ${totalMissing} absent from the live series`);
  console.log(`  worst relative price difference ${worstSeen === 0 ? "0" : worstSeen.toExponential(2)}`);

  // A cached bar the exchange no longer reports is the failure that matters:
  // it means the study priced a trade against something that did not happen.
  const agrees = totalMismatch === 0 && totalMissing === 0;
  console.log(`\n  VERDICT: ${agrees ? "cache agrees with the exchange on every bar sampled" : "DISAGREEMENT FOUND, treat every number computed from this cache as suspect"}`);
  console.log(`\nNothing was written.`);
  if (!agrees) process.exitCode = 1;
}

main().catch((e) => { console.error("[audit] FAILED:", e.message); process.exit(1); });
