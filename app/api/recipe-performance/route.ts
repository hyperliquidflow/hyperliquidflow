// app/api/recipe-performance/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { kv } from "@vercel/kv";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "@/lib/env";
import type { RecipeStats } from "@/lib/server/kv-fetchers";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const OUTCOME_DEFAULTS = {
  resolved_7d: 0, resolved_30d: 0,
  accuracy_1h_7d: null, accuracy_4h_7d: null, accuracy_24h_7d: null,
  avg_move_1h_7d: null, avg_move_4h_7d: null, avg_move_24h_7d: null,
  accuracy_1h_30d: null, accuracy_4h_30d: null, accuracy_24h_30d: null,
  avg_move_1h_30d: null, avg_move_4h_30d: null, avg_move_24h_30d: null,
  top_coins_7d: [] as string[], top_coins_30d: [] as string[],
};

export async function GET(): Promise<NextResponse> {
  const [{ data: perfData, error: perfErr }, intradayRaw, { data: outcomeData }, { data: coinData }] =
    await Promise.all([
      supabase
        .from("recipe_performance")
        .select("recipe_id, signal_count, true_positive, false_positive, avg_ev_score, win_rate, measured_at")
        .order("measured_at", { ascending: false })
        .limit(100),
      kv.get<Record<string, { avg_ev: number; count: number }>>("recipe:intraday_perf"),
      // Outcome accuracy aggregation: 7d and 30d windows via RPC
      supabase.rpc("get_recipe_outcome_stats"),
      // Top coins per recipe: last 30d rows (7d computed client-side)
      supabase
        .from("signal_outcomes")
        .select("recipe_id, coin, created_at")
        .gte("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),
    ]);

  if (perfErr) return NextResponse.json({ error: perfErr.message }, { status: 500 });

  // Build outcome stats map from RPC result
  type OutcomeEntry = typeof OUTCOME_DEFAULTS;
  const outcomeMap = new Map<string, OutcomeEntry>();
  for (const row of outcomeData ?? []) {
    outcomeMap.set(row.recipe_id, {
      resolved_7d:      row.resolved_7d      ?? 0,
      resolved_30d:     row.resolved_30d     ?? 0,
      accuracy_1h_7d:   row.accuracy_1h_7d   ?? null,
      accuracy_4h_7d:   row.accuracy_4h_7d   ?? null,
      accuracy_24h_7d:  row.accuracy_24h_7d  ?? null,
      avg_move_1h_7d:   row.avg_move_1h_7d   ?? null,
      avg_move_4h_7d:   row.avg_move_4h_7d   ?? null,
      avg_move_24h_7d:  row.avg_move_24h_7d  ?? null,
      accuracy_1h_30d:  row.accuracy_1h_30d  ?? null,
      accuracy_4h_30d:  row.accuracy_4h_30d  ?? null,
      accuracy_24h_30d: row.accuracy_24h_30d ?? null,
      avg_move_1h_30d:  row.avg_move_1h_30d  ?? null,
      avg_move_4h_30d:  row.avg_move_4h_30d  ?? null,
      avg_move_24h_30d: row.avg_move_24h_30d ?? null,
      top_coins_7d:  [],
      top_coins_30d: [],
    });
  }

  // Build top coins per recipe per window from the coin query
  const since7d = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const coinCount7d  = new Map<string, Map<string, number>>();
  const coinCount30d = new Map<string, Map<string, number>>();

  for (const row of coinData ?? []) {
    const firedAt = new Date(row.created_at).getTime();

    // All rows within 30d go into 30d counts
    if (!coinCount30d.has(row.recipe_id)) coinCount30d.set(row.recipe_id, new Map());
    const m30 = coinCount30d.get(row.recipe_id)!;
    m30.set(row.coin, (m30.get(row.coin) ?? 0) + 1);

    // Only 7d rows go into 7d counts
    if (firedAt >= since7d) {
      if (!coinCount7d.has(row.recipe_id)) coinCount7d.set(row.recipe_id, new Map());
      const m7 = coinCount7d.get(row.recipe_id)!;
      m7.set(row.coin, (m7.get(row.coin) ?? 0) + 1);
    }
  }

  const topCoins = (m: Map<string, number>) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([coin]) => coin);

  for (const [recipeId, outcome] of outcomeMap) {
    outcome.top_coins_7d  = topCoins(coinCount7d.get(recipeId)  ?? new Map());
    outcome.top_coins_30d = topCoins(coinCount30d.get(recipeId) ?? new Map());
  }

  // Deduplicate perf rows: keep most recent per recipe_id
  const latest = new Map<string, RecipeStats>();
  for (const row of perfData ?? []) {
    if (!latest.has(row.recipe_id)) {
      latest.set(row.recipe_id, {
        ...row,
        ...(outcomeMap.get(row.recipe_id) ?? OUTCOME_DEFAULTS),
      } as RecipeStats);
    }
  }

  // Overlay intraday KV data and build final result
  const result: RecipeStats[] = [...latest.values()].map((row) => {
    const intraday = intradayRaw?.[row.recipe_id];
    if (!intraday) return row;
    return { ...row, signal_count: intraday.count, avg_ev_score: intraday.avg_ev };
  });

  // Add KV-only recipes not yet in the daily table
  if (intradayRaw) {
    for (const [recipe_id, { avg_ev, count }] of Object.entries(intradayRaw)) {
      if (!latest.has(recipe_id)) {
        result.push({
          recipe_id,
          signal_count:  count,
          avg_ev_score:  avg_ev,
          win_rate:      null,
          true_positive: 0,
          false_positive:0,
          measured_at:   new Date().toISOString(),
          ...(outcomeMap.get(recipe_id) ?? OUTCOME_DEFAULTS),
        });
      }
    }
  }

  return NextResponse.json(result, {
    headers: { "Cache-Control": "public, max-age=60" },
  });
}
