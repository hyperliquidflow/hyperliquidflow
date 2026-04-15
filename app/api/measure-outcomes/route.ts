// app/api/measure-outcomes/route.ts
// Vercel Cron endpoint -- runs every hour.
// Fills price_1h, price_4h, price_24h in signal_outcomes for signals whose
// windows have passed. Processes max 50 signals per tick (oldest first).
// Also backfills confirming_recipe_ids for newly written signal_outcomes rows.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { fetchAllMids } from "@/lib/hyperliquid-api-client";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET } from "@/lib/env";
import { getRecipeConfig } from "@/lib/recipe-config";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const BATCH_SIZE = 50;
const ONE_HOUR_MS   = 60 * 60 * 1000;
const FOUR_HOURS_MS = 4 * ONE_HOUR_MS;
const ONE_DAY_MS    = 24 * ONE_HOUR_MS;

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (CRON_SECRET) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const now = Date.now();
  const stats = { filled_1h: 0, filled_4h: 0, filled_24h: 0, wins: 0 };

  try {
    const globalCfg = await getRecipeConfig("global");
    const WIN_THRESHOLD = globalCfg["WIN_THRESHOLD_PCT"] ?? 0.005;

    const cutoffIso = new Date(now - 25 * ONE_HOUR_MS).toISOString();

    const { data: pendingEvents, error: eventsError } = await supabase
      .from("signal_outcomes")
      .select(`
        signal_id, price_at_fire, price_1h, price_4h, price_24h,
        direction_ok_4h, price_win, confirming_recipe_ids,
        signal_events!inner(id, coin, direction, fired_at)
      `)
      .or("price_1h.is.null,price_4h.is.null,price_24h.is.null")
      .gte("signal_events.fired_at", cutoffIso)
      .order("signal_events.fired_at", { ascending: true })
      .limit(BATCH_SIZE);

    if (eventsError) {
      return NextResponse.json({ error: eventsError.message }, { status: 500 });
    }
    if (!pendingEvents || pendingEvents.length === 0) {
      return NextResponse.json({ ok: true, processed: 0, ...stats });
    }

    const allMids = await fetchAllMids();

    for (const row of pendingEvents) {
      const event = Array.isArray(row.signal_events) ? row.signal_events[0] : row.signal_events;
      if (!event) continue;

      const firedAt  = new Date(event.fired_at).getTime();
      const elapsed  = now - firedAt;
      const coinMid  = parseFloat(allMids[event.coin] ?? "0");
      if (coinMid === 0) continue;

      const firePrice = row.price_at_fire;
      const update: Record<string, unknown> = { measured_at: new Date().toISOString() };

      if (elapsed >= ONE_HOUR_MS && row.price_1h === null) {
        const move = (coinMid - firePrice) / firePrice;
        update.price_1h     = coinMid;
        update.move_pct_1h  = move;
        stats.filled_1h++;
      }

      if (elapsed >= FOUR_HOURS_MS && row.price_4h === null) {
        const move = (coinMid - firePrice) / firePrice;
        const signedMove = event.direction === "SHORT" ? -move : move;
        const dirOk = signedMove > 0;

        update.price_4h        = coinMid;
        update.move_pct_4h     = move;
        update.direction_ok_4h = dirOk;
        update.price_win       = dirOk && Math.abs(move) > WIN_THRESHOLD;
        stats.filled_4h++;
        if (update.price_win) stats.wins++;

        if (row.confirming_recipe_ids.length === 0) {
          const windowStart = new Date(firedAt - 10 * 60 * 1000).toISOString();
          const windowEnd   = new Date(firedAt + 10 * 60 * 1000).toISOString();

          const { data: confirmers } = await supabase
            .from("signal_events")
            .select("recipe_id")
            .eq("coin", event.coin)
            .eq("direction", event.direction)
            .neq("id", event.id)
            .gte("fired_at", windowStart)
            .lte("fired_at", windowEnd);

          if (confirmers && confirmers.length > 0) {
            update.confirming_recipe_ids = confirmers.map((c) => c.recipe_id);
            update.confirmation_count    = confirmers.length;
          }
        }
      }

      if (elapsed >= ONE_DAY_MS && row.price_24h === null) {
        const move = (coinMid - firePrice) / firePrice;
        update.price_24h    = coinMid;
        update.move_pct_24h = move;
        stats.filled_24h++;
      }

      if (Object.keys(update).length > 1) {
        await supabase
          .from("signal_outcomes")
          .update(update)
          .eq("signal_id", row.signal_id);
      }
    }

    return NextResponse.json({ ok: true, processed: pendingEvents.length, ...stats });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[measure-outcomes] error:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
