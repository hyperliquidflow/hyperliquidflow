// scripts/compact-fill-cache.ts
//
// Cache size has bounded every study so far, not data availability.
//
// A 500-wallet 120-day fetch heads for roughly 500MB of raw fills and would
// blow the heap on parse, so each run has had to trade wallets against window
// length. But nothing downstream reads an individual fill. The entry analyses
// collapse fills into episodes, and the positioning work only needs signed size
// changes per wallet per coin per hour. Both survive aggregation intact.
//
// This rewrites a cache in place at hourly resolution:
//   fills of one wallet, coin, side and open/close, inside one hour
//   -> a single row at the size-weighted price, summed size, summed PnL
//
// Hourly is not arbitrary. The candles are hourly on the long runs, so nothing
// downstream can resolve finer than that anyway, and the 30-minute episode
// window used for entry clustering still works because episode grouping runs on
// timestamps rather than on fill identity.
//
// Compaction is lossy for sub-hour latency questions. Those belong to the short
// 1m-bar runs, which are small enough not to need this.
//
//   npx tsx scripts/compact-fill-cache.ts                 # rewrites fill-study-cache.json
//   npx tsx scripts/compact-fill-cache.ts --dry           # reports the saving only
//
// Writes only the cache file, never Supabase or KV.

// The bucketing and the conservation check live in lib/fill-compaction.ts,
// where they are tested and shared with the fetch path, which now compacts as
// fills arrive. This script remains for caches fetched raw.
import * as fs from "fs/promises";
import { compactFills, checkConservation } from "../lib/fill-compaction";

const CACHE_FILE = process.argv.find((a) => a.startsWith("--cache="))?.split("=")[1]
  ?? "fill-study-cache.json";
const DRY = process.argv.includes("--dry");

interface Fill {
  w: string; c: string; p: number; s: number; t: number;
  d: 1 | -1; o: 0 | 1; pnl: number; sc: number;
}
interface Cache {
  fetched_at: string; days: number; interval?: string; compacted?: boolean;
  fills: Fill[];
  candles: Record<string, [number, number][]>;
}

async function main() {
  const raw = await fs.readFile(CACHE_FILE, "utf8");
  const cache = JSON.parse(raw) as Cache;

  if (cache.compacted) {
    console.log(`[compact] cache is already compacted, nothing to do`);
    return;
  }

  const before = cache.fills.length;
  const compacted = compactFills(cache.fills);
  const after = compacted.length;
  const ratio = before > 0 ? after / before : 1;

  // Aggregation must conserve the quantities every downstream slice sums. If it
  // does not, the compaction is wrong and the cache stays untouched.
  const { sizeDrift, pnlDrift, ok } = checkConservation(cache.fills, compacted);

  console.log(`[compact] fills ${before.toLocaleString()} -> ${after.toLocaleString()} (${(ratio * 100).toFixed(1)}%)`);
  console.log(`[compact] net signed size drift ${(sizeDrift * 100).toExponential(2)}%`);
  console.log(`[compact] realized PnL drift    ${(pnlDrift * 100).toExponential(2)}%`);

  if (!ok) {
    console.error(`[compact] ABORT: aggregation did not conserve position or PnL. Cache left untouched.`);
    process.exit(1);
  }

  if (DRY) {
    const est = Math.round((raw.length * ratio) / 1e6);
    console.log(`[compact] dry run. Estimated cache ${Math.round(raw.length / 1e6)}MB -> ~${est}MB. Nothing written.`);
    return;
  }

  cache.fills = compacted;
  cache.compacted = true;
  await fs.writeFile(CACHE_FILE, JSON.stringify(cache));
  const now = (await fs.stat(CACHE_FILE)).size;
  console.log(`[compact] rewrote ${CACHE_FILE}, now ${Math.round(now / 1e6)}MB`);
}

main().catch((e) => { console.error("[compact] FAILED:", e.message); process.exit(1); });
