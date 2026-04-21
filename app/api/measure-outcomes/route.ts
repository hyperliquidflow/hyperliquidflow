// app/api/measure-outcomes/route.ts
import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, HYPERLIQUID_API_URL } from "@/lib/env";
import { verifyCronAuth } from "@/lib/auth/cron";
import { computeOutcome, computeMovePct } from "@/lib/outcome-helpers";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const CHUNK_SIZE = 100;
// 26h = 24h window + 2h buffer for hourly cron granularity
const HORIZON_MS = 26 * 60 * 60 * 1000;

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

  // 2. Fetch current prices from Hyperliquid (one call, all coins)
  let allMids: Record<string, string> = {};
  try {
    const res = await fetch(HYPERLIQUID_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "allMids" }),
    });
    if (!res.ok) {
      console.error("[measure-outcomes] allMids non-200:", res.status);
      return NextResponse.json({ ok: false, error: `allMids HTTP ${res.status}` }, { status: 502 });
    }
    allMids = await res.json() as Record<string, string>;
  } catch (err) {
    console.error("[measure-outcomes] allMids fetch failed:", err);
    return NextResponse.json({ ok: false, error: "allMids fetch failed" }, { status: 502 });
  }

  const now = Date.now();

  // 3. Compute updates
  const updates: { id: string; patch: Record<string, unknown> }[] = [];
  for (const row of pending) {
    const firedAt  = new Date(row.created_at).getTime();
    const ageMs    = now - firedAt;
    const priceNow = parseFloat(allMids[row.coin] ?? "");
    const patch: Record<string, unknown> = {};

    // Skip if coin is delisted / missing from allMids
    if (!isFinite(priceNow) || priceNow <= 0) continue;

    if (ageMs >= 60 * 60 * 1000 && row.price_1h == null) {
      patch.price_1h    = priceNow;
      patch.move_pct_1h = parseFloat(computeMovePct(Number(row.price_at_signal), priceNow).toFixed(4));
      patch.outcome_1h  = computeOutcome(row.direction, Number(row.price_at_signal), priceNow);
    }
    if (ageMs >= 4 * 60 * 60 * 1000 && row.price_4h == null) {
      patch.price_4h    = priceNow;
      patch.move_pct_4h = parseFloat(computeMovePct(Number(row.price_at_signal), priceNow).toFixed(4));
      patch.outcome_4h  = computeOutcome(row.direction, Number(row.price_at_signal), priceNow);
    }
    if (ageMs >= 24 * 60 * 60 * 1000 && row.price_24h == null) {
      patch.price_24h    = priceNow;
      patch.move_pct_24h = parseFloat(computeMovePct(Number(row.price_at_signal), priceNow).toFixed(4));
      patch.outcome_24h  = computeOutcome(row.direction, Number(row.price_at_signal), priceNow);
      // resolved_at gated on price columns, not outcome booleans
      patch.resolved_at  = new Date().toISOString();
    }

    if (Object.keys(patch).length > 0) {
      updates.push({ id: row.id, patch });
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
      duration_ms: Date.now() - startMs,
    })
  );

  return NextResponse.json({ ok: true, resolved, duration_ms: Date.now() - startMs });
}
