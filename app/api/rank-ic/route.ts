// app/api/rank-ic/route.ts
// Returns rank_ic_history for the /performance/ranking page and Overview badge.
// Shows honestly empty state until 30+ days of wallet_score_history accumulate.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "@/lib/env";
// Minimum detectable IC from docs/preflight/rank-ic-power.md.
// Phase 1 kill: IC not above this threshold after 30+ measurements.
const MDIC = 0.08;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

export interface RankIcRow {
  measurement_date:        string;
  rank_ic:                 number | null;
  p_value:                 number | null;
  cohort_size:             number;
  effective_sample_size:   number | null;
  top_decile_hit_rate:     number | null;
  bottom_decile_avoidance: number | null;
}

export interface RankIcPayload {
  history:             RankIcRow[];
  latest_ic:           number | null;
  latest_p_value:      number | null;
  total_measurements:  number;
  pct_above_mdic:      number | null;
  mdic:                number;
  /** Earliest day of accumulated wallet scores, or null if none exist yet. */
  score_history_start: string | null;
  /** Days of forward return each measurement waits on. */
  horizon_days:        number;
}

const HORIZON_DAYS = 30;

export async function GET(): Promise<NextResponse> {
  // The projected first-measurement date has to come from real accumulated
  // scores. It used to be Date.now() + 31 days, so it slid forward every day
  // and never arrived (audit 2026-08-08).
  const [{ data, error }, scoreStart] = await Promise.all([
    supabase
      .from("rank_ic_history")
      .select(
        "measurement_date, rank_ic, p_value, cohort_size, effective_sample_size, " +
        "top_decile_hit_rate, bottom_decile_avoidance"
      )
      .order("measurement_date", { ascending: true })
      .limit(180),
    supabase
      .from("wallet_score_history")
      .select("date")
      .order("date", { ascending: true })
      .limit(1),
  ]);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as RankIcRow[];
  const n    = rows.length;

  const latest    = n > 0 ? rows[n - 1] : null;
  const aboveMdic = rows.filter((r) => r.rank_ic != null && r.rank_ic > MDIC).length;

  const payload: RankIcPayload = {
    history:            rows,
    latest_ic:          latest?.rank_ic ?? null,
    latest_p_value:     latest?.p_value ?? null,
    total_measurements: n,
    pct_above_mdic:     n > 0 ? aboveMdic / n : null,
    mdic:               MDIC,
    score_history_start: (scoreStart.data?.[0]?.date as string | undefined) ?? null,
    horizon_days:        HORIZON_DAYS,
  };

  return NextResponse.json(payload, {
    headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=60" },
  });
}
