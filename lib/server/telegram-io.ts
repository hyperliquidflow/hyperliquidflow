// lib/server/telegram-io.ts
// Every read the Telegram bot performs. Isolated here so lib/watchdog.ts can
// stay pure and lib/telegram.ts can stay copy-only.

import { kv } from "@vercel/kv";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "@/lib/env";
import type { CohortCachePayload } from "@/app/api/refresh-cohort/route";
import { CHECK_IDS, type AlertState, type CheckId, type CheckInputs } from "@/lib/watchdog";
import { RECIPE_META } from "@/lib/recipe-meta";
import type { CohortData, ScanData, SignalsData, StatusData } from "@/lib/telegram";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/** KV values arrive as objects or as JSON strings depending on how they were written. */
function parse<T>(raw: unknown): T | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try { return JSON.parse(raw) as T; } catch { return null; }
  }
  return raw as T;
}

const stateKey = (id: CheckId) => `alert:state:${id}`;

async function readCohortCache(): Promise<CohortCachePayload | null> {
  try { return parse<CohortCachePayload>(await kv.get("cohort:active")); }
  catch { return null; }
}

export async function readAlertState(): Promise<Record<string, AlertState | null>> {
  const out: Record<string, AlertState | null> = {};
  await Promise.all(
    CHECK_IDS.map(async (id) => {
      try { out[id] = parse<AlertState>(await kv.get(stateKey(id))); }
      catch { out[id] = null; }
    }),
  );
  return out;
}

export async function writeAlertState(writes: Record<string, AlertState>): Promise<void> {
  await Promise.all(
    Object.entries(writes).map(([id, s]) => kv.set(stateKey(id as CheckId), s)),
  );
}

export async function collectCheckInputs(): Promise<CheckInputs> {
  const now = Date.now();
  const today     = new Date(now).toISOString().slice(0, 10);
  const yesterday = new Date(now - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const since48h  = new Date(now - 48 * 60 * 60 * 1000).toISOString();

  const [cache, beat, hist, active, scoredToday, scoredYesterday, outcomes] = await Promise.all([
    readCohortCache(),
    supabase.from("cohort_snapshots").select("snapshot_time")
      .order("snapshot_time", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("wallet_score_history").select("date")
      .order("date", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("wallets").select("id", { count: "exact", head: true })
      .eq("is_active", true),
    supabase.from("wallet_score_history").select("wallet_id", { count: "exact", head: true })
      .eq("date", today),
    supabase.from("wallet_score_history").select("wallet_id", { count: "exact", head: true })
      .eq("date", yesterday),
    supabase.from("signal_outcomes").select("id", { count: "exact", head: true })
      .gte("resolved_at", since48h),
  ]);

  return {
    now_ms:                  now,
    snapshot_updated_at:     cache?.updated_at ?? null,
    heartbeat_snapshot_time: beat.data?.snapshot_time ?? null,
    score_history_date:      hist.data?.date ?? null,
    active_wallets:          active.error          ? null : active.count          ?? null,
    scored_today:            scoredToday.error     ? null : scoredToday.count     ?? null,
    scored_yesterday:        scoredYesterday.error ? null : scoredYesterday.count ?? null,
    outcomes_resolved_48h:   outcomes.error        ? null : outcomes.count        ?? null,
  };
}

/** One KV read plus the five state keys. Deliberately never touches Supabase. */
export async function fetchStatusData(): Promise<StatusData> {
  const [cache, state] = await Promise.all([readCohortCache(), readAlertState()]);
  const broken = CHECK_IDS.filter((id) => state[id]?.ok === false);
  const updated = cache?.updated_at ? Date.parse(cache.updated_at) : NaN;

  return {
    broken,
    wallet_count: cache?.total_active_wallets ?? cache?.wallet_count ?? null,
    data_age_ms:  Number.isNaN(updated) ? null : Date.now() - updated,
    // Absent when no wallet holds an open position, which is not the same as
    // a balanced book, so it is reported as null and the segment is dropped.
    long_pct:     cache?.cohort_tilt?.long_pct ?? null,
  };
}

export async function fetchCohortData(): Promise<CohortData> {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [active, deactivated, blownUp] = await Promise.all([
    supabase.from("wallets").select("id", { count: "exact", head: true })
      .eq("is_active", true),
    supabase.from("wallets").select("id", { count: "exact", head: true })
      .gte("deactivated_at", since24h),
    supabase.from("cohort_attrition").select("wallet_address", { count: "exact", head: true })
      .eq("state_30d", "blown_up"),
  ]);

  return {
    active:          active.count      ?? 0,
    deactivated_24h: deactivated.count ?? 0,
    blown_up_30d:    blownUp.count     ?? 0,
  };
}

export async function fetchSignalsData(): Promise<SignalsData> {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [count, best] = await Promise.all([
    supabase.from("signal_outcomes").select("id", { count: "exact", head: true })
      .gte("created_at", since24h),
    supabase.from("recipe_performance")
      .select("recipe_id, expectancy_bps_net")
      .not("expectancy_bps_net", "is", null)
      .order("expectancy_bps_net", { ascending: false })
      .limit(1).maybeSingle(),
  ]);

  const recipeId = best.data?.recipe_id ?? null;
  const bps = best.data?.expectancy_bps_net;

  return {
    count_24h:  count.count ?? 0,
    top_recipe: recipeId ? (RECIPE_META[recipeId]?.label ?? recipeId) : null,
    top_expectancy_bps: bps === undefined || bps === null ? null : Number(bps),
  };
}

export async function fetchScanData(): Promise<ScanData> {
  const hist = await supabase.from("wallet_score_history").select("date")
    .order("date", { ascending: false }).limit(1).maybeSingle();

  const date = hist.data?.date ?? null;
  const parsed = date ? Date.parse(date) : NaN;

  return {
    last_date: date,
    age_ms:    Number.isNaN(parsed) ? null : Date.now() - parsed,
  };
}
