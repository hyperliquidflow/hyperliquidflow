// app/api/signals-feed/route.ts
// Cursor-paginated signals_history for the feed infinite scroll.
// GET /api/signals-feed?before=<ISO timestamp>&limit=50
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "@/lib/env";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

export async function GET(req: NextRequest) {
  const before = req.nextUrl.searchParams.get("before");
  const limit   = Math.min(
    Number(req.nextUrl.searchParams.get("limit") ?? DEFAULT_LIMIT),
    MAX_LIMIT,
  );

  let query = supabase
    .from("signals_history")
    .select("recipe_id, coin, signal_type, direction, detected_at, ev_score, wallet_id, metadata")
    .order("detected_at", { ascending: false })
    .limit(limit + 1); // one extra to detect hasMore

  if (before) {
    query = query.lt("detected_at", before);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows    = data ?? [];
  const signals = rows.slice(0, limit);
  const hasMore = rows.length > limit;

  return NextResponse.json({ signals, hasMore });
}
