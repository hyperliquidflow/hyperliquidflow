// app/api/recipe-performance/route.ts

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { kv } from "@vercel/kv";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "@/lib/env";
import type { RecipeStats } from "@/lib/server/kv-fetchers";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

export async function GET(): Promise<NextResponse> {
  const [{ data, error }, intradayRaw] = await Promise.all([
    supabase
      .from("recipe_performance")
      .select("recipe_id, signal_count, true_positive, false_positive, avg_ev_score, win_rate, measured_at")
      .order("measured_at", { ascending: false })
      .limit(100),
    kv.get<Record<string, { avg_ev: number; count: number }>>("recipe:intraday_perf"),
  ]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Deduplicate: keep most recent per recipe_id
  const latest = new Map<string, RecipeStats>();
  for (const row of data ?? []) {
    if (!latest.has(row.recipe_id)) latest.set(row.recipe_id, row as RecipeStats);
  }

  // Build result: start with daily rows, overlay intraday KV data
  const result: RecipeStats[] = [...latest.values()].map((row) => {
    const intraday = intradayRaw?.[row.recipe_id];
    if (!intraday) return row;
    return {
      ...row,
      signal_count: intraday.count,
      avg_ev_score: intraday.avg_ev,
    };
  });

  // Add KV-only recipes not yet in the daily table
  if (intradayRaw) {
    for (const [recipe_id, { avg_ev, count }] of Object.entries(intradayRaw)) {
      if (!latest.has(recipe_id)) {
        result.push({
          recipe_id,
          signal_count: count,
          avg_ev_score: avg_ev,
          win_rate: null,
          true_positive: 0,
          false_positive: 0,
          measured_at: new Date().toISOString(),
        });
      }
    }
  }

  return NextResponse.json(result, {
    headers: { "Cache-Control": "public, max-age=60" },
  });
}
