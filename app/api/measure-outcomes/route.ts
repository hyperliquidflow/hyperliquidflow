// app/api/measure-outcomes/route.ts
import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "@/lib/env";
import { verifyCronAuth } from "@/lib/auth/cron";
import { computeOutcome, computeMovePct, priceAt } from "@/lib/outcome-helpers";
import { fetchCandleSnapshot } from "@/lib/hyperliquid-api-client";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const CHUNK_SIZE = 100;
const HOUR_MS = 60 * 60 * 1000;
// Prices come from historical candles at each row's true horizon, so this
// window only bounds how far back we retry unresolved rows. Retention is 180d.
const HORIZON_MS = 30 * 24 * HOUR_MS;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const startMs = Date.now();

  // Verify Vercel Cron secret header in production (timing-safe compare).
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 1. Fetch pending rows: missing price_24h and within resolution horizon
  const horizon = new Date(Date.now() - HORIZON_MS).toISOString();
  const { data: pending, error: fetchErr } = await supabase
    .from("signal_outcomes")
    .select("id, coin, direction, price_at_signal, price_1h, price_4h, price_24h, created_at")
    .is("price_24h", null)
    .gte("created_at", horizon);

  if (fetchErr) {
    console.error("[measure-outcomes] fetch error:", fetchErr.message);
    return NextResponse.json({ ok: false, error: fetchErr.message }, { status: 500 });
  }
  if (!pending || pending.length === 0) {
    return NextResponse.json({ ok: true, resolved: 0, duration_ms: Date.now() - startMs });
  }

  // 2. Price each row from historical candles at its true horizon.
  // Using a single spot price for every horizon meant price_4h held whatever
  // the price was when the job ran (about 25h later on a daily schedule).
  const byCoin = new Map<string, typeof pending>();
  for (const row of pending) {
    const list = byCoin.get(row.coin) ?? [];
    list.push(row);
    byCoin.set(row.coin, list);
  }

  const now = Date.now();
  const updates: { id: string; patch: Record<string, unknown> }[] = [];
  let delisted = 0;

  for (const [coin, coinRows] of byCoin) {
    const minCreated = Math.min(...coinRows.map((r) => new Date(r.created_at).getTime()));

    let candles;
    try {
      candles = await fetchCandleSnapshot(coin, "1h", minCreated - HOUR_MS, now);
    } catch (err) {
      console.error(`[measure-outcomes] candle fetch failed for ${coin}:`, err);
      delisted += coinRows.length;
      continue;
    }
    if (!candles || candles.length === 0) {
      delisted += coinRows.length;
      continue;
    }

    for (const row of coinRows) {
      const firedMs = new Date(row.created_at).getTime();
      const ageMs   = now - firedMs;
      const entry   = Number(row.price_at_signal);
      const patch: Record<string, unknown> = {};

      const horizons: Array<{ hours: number; label: "1h" | "4h" | "24h"; existing: number | null }> = [
        { hours: 1,  label: "1h",  existing: row.price_1h },
        { hours: 4,  label: "4h",  existing: row.price_4h },
        { hours: 24, label: "24h", existing: row.price_24h },
      ];

      for (const { hours, label, existing } of horizons) {
        if (ageMs < hours * HOUR_MS || existing != null) continue;
        const price = priceAt(candles, firedMs + hours * HOUR_MS);
        if (price == null) continue;
        patch[`price_${label}`]    = price;
        patch[`move_pct_${label}`] = parseFloat(computeMovePct(entry, price).toFixed(4));
        patch[`outcome_${label}`]  = computeOutcome(row.direction, entry, price);
        // resolved_at gated on price columns, not outcome booleans
        if (label === "24h") patch.resolved_at = new Date().toISOString();
      }

      if (Object.keys(patch).length > 0) {
        updates.push({ id: row.id, patch });
      }
    }
  }

  // 4. Batch-update in chunks of CHUNK_SIZE
  let resolved = 0;
  for (let i = 0; i < updates.length; i += CHUNK_SIZE) {
    const chunk = updates.slice(i, i + CHUNK_SIZE);
    const results = await Promise.all(
      chunk.map(({ id, patch }) =>
        supabase.from("signal_outcomes").update(patch).eq("id", id)
      )
    );
    for (const { error: uErr } of results) {
      if (uErr) {
        console.error("[measure-outcomes] update error:", uErr.message);
      } else {
        resolved++;
      }
    }
  }

  console.log(
    JSON.stringify({
      event: "measure_outcomes_complete",
      pending: pending.length,
      resolved,
      delisted,
      duration_ms: Date.now() - startMs,
    })
  );

  return NextResponse.json({ ok: true, resolved, delisted, duration_ms: Date.now() - startMs });
}
