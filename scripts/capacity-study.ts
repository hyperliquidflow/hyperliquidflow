// scripts/capacity-study.ts
//
// What is a surviving edge actually worth, and how much money can it hold?
//
// Every lead this project has is quoted in basis points per day on unspecified
// capital. Both external reviews of the 2026-08-12 audit said the same thing:
// that number is meaningless until the capital it survives at is known, and
// the calculation should happen before committing a quarter to confirmation
// runs, because it might reroute the effort entirely.
//
// The positioning factor trades a handful of alt perpetuals, rebalanced daily.
// Thin books and daily turnover are exactly where a paper edge dies on contact,
// so this walks the real order book for the names the factor is actually long
// and short right now, and reports the net edge at each size.
//
// Reads today's legs from factor_shadow and the live books from Hyperliquid.
// Writes nothing.
//
//   npx tsx --env-file=.env.local scripts/capacity-study.ts
//   npx tsx --env-file=.env.local scripts/capacity-study.ts --edge=39
//
// --edge sets the gross daily edge in bps before costs. The default is the
// measured full-cost book from the frozen 120-day run, which already has fees
// and funding inside it, so the sweep below re-derives cost from the book
// rather than double-charging: it strips the flat assumption and substitutes
// the depth-aware one.

import { createClient } from "@supabase/supabase-js";
import { fetchL2Book, fetchAllMids } from "../lib/hyperliquid-api-client";
import { roundTripCostBps, type BookLevel } from "../lib/slippage";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

/** Gross daily edge in bps, before depth-aware execution cost. */
const EDGE_BPS = Number(process.argv.find((a) => a.startsWith("--edge="))?.split("=")[1] ?? 39);
/** The flat cost already baked into that measured number, per replaced name. */
const ASSUMED_RT_BPS = 19;
const FEE_BPS_SIDE = 4.5;
/** Book sizes per name, in USD. */
const SIZES = [1_000, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000];

async function main() {
  const { data, error } = await supabase
    .from("factor_shadow")
    .select("coin, leg, measurement_date")
    .not("leg", "is", null)
    .order("measurement_date", { ascending: false })
    .limit(40);
  if (error) throw new Error(`shadow read failed: ${error.message}`);

  const rows = data ?? [];
  if (rows.length === 0) {
    console.error(`[capacity] factor_shadow holds no legs yet. Run scripts/factor-shadow.ts first.`);
    process.exit(1);
  }
  const day = rows[0].measurement_date as string;
  const legs = rows.filter((r) => r.measurement_date === day);
  const coins = [...new Set(legs.map((r) => r.coin as string))];

  console.log(`[capacity] legs held on ${day}: ${legs.length} names across both sides`);
  console.log(`[capacity] gross daily edge assumed ${EDGE_BPS} bps, measured with a flat ${ASSUMED_RT_BPS} bps cost inside it\n`);

  const mids = await fetchAllMids();
  const books = new Map<string, { bids: BookLevel[]; asks: BookLevel[]; mid: number }>();
  for (const coin of coins) {
    try {
      const book = await fetchL2Book(coin);
      const mid = Number(mids[coin]);
      const toLevels = (ls: Array<{ px: string; sz: string }>): BookLevel[] =>
        ls.map((l) => ({ px: Number(l.px), sz: Number(l.sz) }));
      books.set(coin, {
        bids: toLevels(book.levels[0] ?? []),
        asks: toLevels(book.levels[1] ?? []),
        mid,
      });
    } catch (e) {
      console.log(`[capacity] ${coin}: book fetch failed (${(e as Error).message}), excluded`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  // Per-name execution cost at each size, averaged across the book's names.
  console.log(`=== Round-trip execution cost by size, per name ===`);
  console.log(`  size/name |  mean bps |  worst bps | names exhausting the book`);
  console.log(`  ----------+-----------+------------+--------------------------`);

  // A name that exhausts its book has not been priced, it has been truncated:
  // walkBook reports the cost of the portion that fit. Averaging that in would
  // understate the cost of size exactly where size is the question, so an
  // exhausted name is excluded from the mean and counted as unfillable.
  const costBySize = new Map<number, { mean: number; fillable: number }>();
  for (const size of SIZES) {
    const costs: number[] = [];
    const exhausted: string[] = [];
    for (const [coin, b] of books) {
      if (!(b.mid > 0)) continue;
      const rt = roundTripCostBps(b.bids, b.asks, size, b.mid, FEE_BPS_SIDE);
      if (!rt) continue;
      if (rt.exhausted) { exhausted.push(coin); continue; }
      costs.push(rt.totalBps);
    }
    if (costs.length === 0) {
      console.log(`  ${("$" + (size / 1000) + "k").padStart(9)} |  no name can absorb this size at all`);
      continue;
    }
    const mean = costs.reduce((a, b) => a + b, 0) / costs.length;
    const worst = Math.max(...costs);
    costBySize.set(size, { mean, fillable: costs.length });
    console.log(
      `  ${("$" + (size / 1000) + "k").padStart(9)} | ${mean.toFixed(1).padStart(9)} | ${worst.toFixed(1).padStart(10)} | ` +
      `${exhausted.length === 0 ? "none" : `${exhausted.length}: ${exhausted.join(", ")}`}`
    );
  }

  // Net edge at each book size. The measured edge already carries a flat cost
  // assumption, so replace it rather than stack a second one on top.
  console.log(`\n=== Net daily edge and annual dollars, by book size ===`);
  console.log(`  Only sizes every leg can absorb are quoted. Once a name exhausts its book`);
  console.log(`  the strategy cannot hold that name at that size, so the row is not a smaller`);
  console.log(`  edge, it is a different and less diversified strategy.`);
  console.log(`\n  per name |  book | fill | exec bps | net bps/day |  $/day | $/year`);
  console.log(`  ---------+-------+------+----------+-------------+--------+--------`);

  const names = books.size;
  let lastFullSize = 0;
  for (const size of SIZES) {
    const entry = costBySize.get(size);
    if (entry === undefined) continue;
    const full = entry.fillable === names;
    // The measured edge already carries a flat cost assumption, so the
    // depth-aware figure replaces it rather than stacking on top of it.
    const netBps = EDGE_BPS + ASSUMED_RT_BPS - entry.mean;
    const bookUsd = size * entry.fillable;
    const perDay = (netBps / 10_000) * bookUsd;
    if (full) lastFullSize = size;
    console.log(
      `  ${("$" + size / 1000 + "k").padStart(8)} | ${("$" + Math.round(bookUsd / 1000) + "k").padStart(5)} | ` +
      `${`${entry.fillable}/${names}`.padStart(4)} | ${entry.mean.toFixed(1).padStart(8)} | ${netBps.toFixed(1).padStart(11)} | ` +
      `${("$" + Math.round(perDay)).padStart(6)} | $${Math.round(perDay * 365).toLocaleString()}` +
      `${full ? "" : "   <- partial book, not the measured strategy"}`
    );
  }

  const fullBook = lastFullSize * names;
  console.log(`\n  Largest size every leg can absorb: $${lastFullSize / 1000}k per name, $${Math.round(fullBook / 1000)}k of book.`);
  console.log(`  Beyond that the thin names drop out, so more capital buys a different strategy, not more of this one.`);
  console.log(`  Live books at one moment, and a real book pays this cost every day it turns over.`);
  console.log(`  The edge itself is unconfirmed: this prices the prize, it does not claim it.`);
  console.log(`\nNothing was written.`);
}

main().catch((e) => { console.error("[capacity] FAILED:", e.message); process.exit(1); });
