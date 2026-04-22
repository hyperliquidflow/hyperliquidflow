// app/api/agent-readiness/route.ts
// Reports whether the Signal Intelligence Agent (Sprint 8) has enough
// accumulated data to leave cold-start. Gates: 100+ resolved outcomes
// and 30+ days of signal history.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "@/lib/env";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const MIN_OUTCOMES = 100;
const MIN_HISTORY_DAYS = 30;

export interface AgentReadinessPayload {
  outcomes_resolved: number;
  outcomes_total:    number;
  oldest_event_at:   string | null;
  oldest_event_age_days: number | null;
  gates: {
    outcomes_ok: boolean;
    history_ok: boolean;
  };
  cold_start: boolean;
  thresholds: {
    min_outcomes: number;
    min_history_days: number;
  };
}

export async function GET(): Promise<NextResponse> {
  const [resolvedRes, totalRes, oldestRes] = await Promise.all([
    supabase
      .from("signal_outcomes")
      .select("id", { count: "exact", head: true })
      .not("price_24h", "is", null),
    supabase
      .from("signal_outcomes")
      .select("id", { count: "exact", head: true }),
    supabase
      .from("signals_history")
      .select("detected_at")
      .order("detected_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  const outcomes_resolved = resolvedRes.count ?? 0;
  const outcomes_total    = totalRes.count ?? 0;
  const oldest_event_at   = oldestRes.data?.detected_at ?? null;

  const oldest_event_age_days = oldest_event_at
    ? (Date.now() - new Date(oldest_event_at).getTime()) / (1000 * 60 * 60 * 24)
    : null;

  const outcomes_ok = outcomes_resolved >= MIN_OUTCOMES;
  const history_ok  =
    oldest_event_age_days !== null && oldest_event_age_days >= MIN_HISTORY_DAYS;

  const payload: AgentReadinessPayload = {
    outcomes_resolved,
    outcomes_total,
    oldest_event_at,
    oldest_event_age_days:
      oldest_event_age_days === null
        ? null
        : Math.round(oldest_event_age_days * 10) / 10,
    gates: { outcomes_ok, history_ok },
    cold_start: !(outcomes_ok && history_ok),
    thresholds: {
      min_outcomes: MIN_OUTCOMES,
      min_history_days: MIN_HISTORY_DAYS,
    },
  };

  return NextResponse.json(payload, {
    headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=60" },
  });
}
