// app/api/recipe-performance/route.ts

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "@/lib/env";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

export async function GET(): Promise<NextResponse> {
  const { data, error } = await supabase
    .from("recipe_performance")
    .select("recipe_id, signal_count, true_positive, false_positive, avg_ev_score, win_rate, measured_at")
    .order("measured_at", { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Deduplicate: keep most recent per recipe_id
  const latest = new Map<string, Record<string, unknown>>();
  for (const row of data ?? []) {
    if (!latest.has(row.recipe_id)) latest.set(row.recipe_id, row);
  }

  return NextResponse.json([...latest.values()], {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
