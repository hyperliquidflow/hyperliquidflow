// scripts/backfill-signal-outcomes.ts
// One-shot backfill for signal_outcomes rows orphaned by the old 26h
// horizon in /api/measure-outcomes. Uses Hyperliquid candleSnapshot to
// fetch historical prices at T+1h / T+4h / T+24h per row.
//
// Run:  npx tsx scripts/backfill-signal-outcomes.ts
// Flags:
//   --dry         log intended updates without writing
//   --limit=N     cap rows processed (default: all within retention)

import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "@/lib/env";
import { fetchCandleSnapshot, type HlCandle } from "@/lib/hyperliquid-api-client";
import { computeOutcome, computeMovePct } from "@/lib/outcome-helpers";

const HOUR_MS = 60 * 60 * 1000;
const RETENTION_MS = 30 * 24 * HOUR_MS;

interface PendingRow {
  id: string;
  coin: string;
  direction: string | null;
  price_at_signal: number;
  price_1h:  number | null;
  price_4h:  number | null;
  price_24h: number | null;
  created_at: string;
}

function parseArgs(): { dry: boolean; limit: number | null } {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry");
  const limitArg = args.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : null;
  return { dry, limit: isFinite(limit!) ? limit : null };
}

/** Find the first candle whose open time (t) is >= targetMs. */
function priceAt(candles: HlCandle[], targetMs: number): number | null {
  for (const c of candles) {
    if (c.t >= targetMs) {
      const p = parseFloat(c.c);
      return isFinite(p) && p > 0 ? p : null;
    }
  }
  return null;
}

async function main() {
  const { dry, limit } = parseArgs();
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const retentionCutoff = new Date(Date.now() - RETENTION_MS).toISOString();

  let query = supabase
    .from("signal_outcomes")
    .select("id, coin, direction, price_at_signal, price_1h, price_4h, price_24h, created_at")
    .is("price_24h", null)
    .gte("created_at", retentionCutoff)
    .order("created_at", { ascending: true });

  if (limit) query = query.limit(limit);

  const { data, error } = await query;
  if (error) {
    console.error("fetch error:", error.message);
    process.exit(1);
  }
  const rows = (data ?? []) as PendingRow[];
  if (rows.length === 0) {
    console.log("nothing to backfill");
    return;
  }

  const byCoin = new Map<string, PendingRow[]>();
  for (const r of rows) {
    const list = byCoin.get(r.coin) ?? [];
    list.push(r);
    byCoin.set(r.coin, list);
  }

  console.log(
    JSON.stringify({
      event: "backfill_start",
      rows: rows.length,
      coins: byCoin.size,
      dry,
    })
  );

  let updated = 0;
  let skippedDelisted = 0;
  let skippedTooYoung = 0;

  for (const [coin, coinRows] of byCoin) {
    const minCreated = Math.min(...coinRows.map((r) => new Date(r.created_at).getTime()));
    const rangeStart = minCreated - HOUR_MS;
    const rangeEnd   = Date.now();

    let candles: HlCandle[];
    try {
      candles = await fetchCandleSnapshot(coin, "1h", rangeStart, rangeEnd);
    } catch (err) {
      console.error(`[${coin}] candle fetch failed:`, (err as Error).message);
      skippedDelisted += coinRows.length;
      continue;
    }
    if (!candles || candles.length === 0) {
      skippedDelisted += coinRows.length;
      continue;
    }

    for (const r of coinRows) {
      const firedMs = new Date(r.created_at).getTime();
      const ageMs   = Date.now() - firedMs;
      const patch: Record<string, unknown> = {};

      if (ageMs >= 1 * HOUR_MS && r.price_1h == null) {
        const p = priceAt(candles, firedMs + 1 * HOUR_MS);
        if (p != null) {
          patch.price_1h    = p;
          patch.move_pct_1h = parseFloat(computeMovePct(r.price_at_signal, p).toFixed(4));
          patch.outcome_1h  = computeOutcome(r.direction, r.price_at_signal, p);
        }
      }
      if (ageMs >= 4 * HOUR_MS && r.price_4h == null) {
        const p = priceAt(candles, firedMs + 4 * HOUR_MS);
        if (p != null) {
          patch.price_4h    = p;
          patch.move_pct_4h = parseFloat(computeMovePct(r.price_at_signal, p).toFixed(4));
          patch.outcome_4h  = computeOutcome(r.direction, r.price_at_signal, p);
        }
      }
      if (ageMs >= 24 * HOUR_MS && r.price_24h == null) {
        const p = priceAt(candles, firedMs + 24 * HOUR_MS);
        if (p != null) {
          patch.price_24h    = p;
          patch.move_pct_24h = parseFloat(computeMovePct(r.price_at_signal, p).toFixed(4));
          patch.outcome_24h  = computeOutcome(r.direction, r.price_at_signal, p);
          patch.resolved_at  = new Date().toISOString();
        }
      }

      if (Object.keys(patch).length === 0) {
        if (ageMs < 24 * HOUR_MS) skippedTooYoung++;
        continue;
      }

      if (dry) {
        console.log(JSON.stringify({ id: r.id, coin, patch }));
        updated++;
      } else {
        const { error: uErr } = await supabase
          .from("signal_outcomes")
          .update(patch)
          .eq("id", r.id);
        if (uErr) {
          console.error(`[${coin}] update ${r.id} failed:`, uErr.message);
        } else {
          updated++;
        }
      }
    }

    // Light rate-limit: Hyperliquid info API is 1200/min; we're well under but be polite
    await new Promise((res) => setTimeout(res, 50));
  }

  console.log(
    JSON.stringify({
      event: "backfill_complete",
      total: rows.length,
      updated,
      skipped_delisted: skippedDelisted,
      skipped_too_young: skippedTooYoung,
      dry,
    })
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
