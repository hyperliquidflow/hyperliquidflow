// scripts/signal-learning.ts
// Nightly stats engine. Called by GitHub Actions at 01:00 UTC.
// Reads signal_outcomes, computes performance findings per recipe,
// writes to agent_findings. (Claude agent integration added in Phase 2.)

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs/promises";
import {
  computeWinRates,
  computeTrend,
  computeMeasuredEV,
  meetsMinSample,
  computeConfidence,
  computeWinRateByRegime,
  computeWinRateByRegimeFit,
  dominantRegime,
} from "../lib/signal-learning-utils";

const SUPABASE_URL              = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("FATAL: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function checkColdStart(): Promise<boolean> {
  const { count } = await supabase
    .from("signal_outcomes")
    .select("*", { count: "exact", head: true });

  const { data: oldest } = await supabase
    .from("signal_events")
    .select("fired_at")
    .order("fired_at", { ascending: true })
    .limit(1);

  const totalRows = count ?? 0;
  const oldestDate = oldest?.[0]?.fired_at ? new Date(oldest[0].fired_at) : null;
  const daysOld = oldestDate
    ? (Date.now() - oldestDate.getTime()) / 86400_000
    : 0;

  if (totalRows < 100 || daysOld < 30) {
    console.log(
      `[signal-learning] Cold start guard: ${totalRows} outcomes, ${daysOld.toFixed(1)} days of data. Monitoring only.`
    );
    await writeAgentLog({
      log_type: "OBSERVATION",
      recipe_id: null,
      summary: `Cold start: ${totalRows} outcomes over ${daysOld.toFixed(1)} days. Minimum 100 outcomes and 30 days required.`,
      content: `Insufficient history for learning. Accumulated ${totalRows} resolved signal outcomes over ${daysOld.toFixed(1)} days. Minimum thresholds: 100 outcomes, 30 days. Will monitor and re-evaluate tomorrow.`,
      agent_confidence: null,
    });
    return true;
  }
  return false;
}

async function runStatsEngine(): Promise<void> {
  console.log("[signal-learning] running stats engine...");

  const cutoff90d = new Date(Date.now() - 90 * 86400_000).toISOString();

  const { data: rows, error } = await supabase
    .from("signal_outcomes")
    .select(`
      signal_id, price_win, is_win, move_pct_4h, wallet_return_avg, wallet_outcome,
      signal_events!inner(
        recipe_id, coin, direction, fired_at, regime_at_fire, active_config
      )
    `)
    .not("price_win", "is", null)
    .gte("signal_events.fired_at", cutoff90d);

  if (error || !rows) {
    console.error("[signal-learning] query error:", error?.message);
    return;
  }

  // Fetch wallet_regime_fit from signals_history.metadata for each resolved outcome.
  // signal_outcomes.signal_id is a FK to signals_history(id).
  const signalIds = rows.map((r) => r.signal_id as string).filter(Boolean);
  let regimeFitById = new Map<string, number | null>();
  if (signalIds.length > 0) {
    const { data: metaRows } = await supabase
      .from("signals_history")
      .select("id, metadata")
      .in("id", signalIds);
    regimeFitById = new Map(
      (metaRows ?? []).map((m) => [
        m.id as string,
        ((m.metadata as Record<string, unknown>)?.wallet_regime_fit as number | null) ?? null,
      ])
    );
  }

  const byRecipe = new Map<string, typeof rows>();
  for (const row of rows) {
    const event = Array.isArray(row.signal_events) ? row.signal_events[0] : row.signal_events;
    const rid   = (event as { recipe_id?: string } | null)?.recipe_id;
    if (!rid) continue;
    if (!byRecipe.has(rid)) byRecipe.set(rid, []);
    byRecipe.get(rid)!.push(row);
  }

  const findingRows: Record<string, unknown>[] = [];

  for (const [recipeId, recipeRows] of byRecipe) {
    const outcomes = recipeRows.map((r) => {
      const event = Array.isArray(r.signal_events) ? r.signal_events[0] : r.signal_events;
      const e = event as { fired_at?: string; regime_at_fire?: string } | null;
      return {
        is_win:         (r.is_win ?? r.price_win) as boolean | null,
        fired_at:       e?.fired_at ?? new Date().toISOString(),
        regime_at_fire: e?.regime_at_fire ?? "RANGING",
        move_pct_4h:    r.move_pct_4h as number | null,
      };
    });

    const { win_rate_7d, win_rate_30d, win_rate_90d } = computeWinRates(outcomes);
    const trend      = computeTrend(win_rate_7d, win_rate_90d);
    const sampleSize = outcomes.filter((o) => o.is_win !== null).length;
    const confidence = computeConfidence(sampleSize, win_rate_30d ?? 0.5);

    const wins   = outcomes.filter((o) => o.is_win && o.move_pct_4h !== null);
    const losses = outcomes.filter((o) => o.is_win === false && o.move_pct_4h !== null);
    const avgWin  = wins.length > 0
      ? wins.reduce((s, o) => s + (o.move_pct_4h ?? 0), 0) / wins.length
      : null;
    const avgLoss = losses.length > 0
      ? losses.reduce((s, o) => s + (o.move_pct_4h ?? 0), 0) / losses.length
      : null;

    const measuredEV    = computeMeasuredEV(win_rate_30d, avgWin, avgLoss);
    const winsByRegime  = computeWinRateByRegime(outcomes);
    const dominant      = dominantRegime(outcomes);

    const regimeFitOutcomes = recipeRows.map((r) => ({
      is_win:      (r.is_win ?? r.price_win) as boolean | null,
      regime_fit:  regimeFitById.get(r.signal_id as string) ?? null,
    }));
    const fitBuckets = computeWinRateByRegimeFit(regimeFitOutcomes);

    // Log a REGIME_FIT_SIGNAL finding when HIGH-fit signals outperform LOW-fit by >5pp
    const highWr = fitBuckets.high.win_rate;
    const lowWr  = fitBuckets.low.win_rate;
    if (
      highWr !== null && lowWr !== null &&
      fitBuckets.high.sample >= 5 && fitBuckets.low.sample >= 5 &&
      highWr - lowWr > 0.05
    ) {
      await writeAgentLog({
        log_type: "REGIME_FIT_SIGNAL",
        recipe_id: recipeId,
        summary: `${recipeId}: HIGH-fit signals win at ${(highWr * 100).toFixed(1)}% vs LOW-fit ${(lowWr * 100).toFixed(1)}% (${fitBuckets.high.sample} vs ${fitBuckets.low.sample} samples)`,
        content: JSON.stringify({ high: fitBuckets.high, mid: fitBuckets.mid, low: fitBuckets.low }),
        agent_confidence: Math.min(fitBuckets.high.sample, fitBuckets.low.sample) >= 30 ? 0.8 : 0.5,
      });
    }

    let findingType = "STABLE";
    if (!meetsMinSample(sampleSize)) findingType = "INSUFFICIENT_DATA";
    else if (trend === "DEGRADING" && confidence > 0.70) findingType = "UNDERPERFORMING";
    else if (trend === "IMPROVING") findingType = "IMPROVING";

    findingRows.push({
      recipe_id:               recipeId,
      regime:                  "ALL",
      period_days:             90,
      sample_size:             sampleSize,
      meets_min_sample:        meetsMinSample(sampleSize),
      confidence,
      win_rate_7d,
      win_rate_30d,
      win_rate_90d,
      trend,
      avg_win_pct:             avgWin,
      avg_loss_pct:            avgLoss,
      measured_ev:             measuredEV,
      baseline_ev:             null,
      vs_baseline_ev:          null,
      win_rate_by_regime:      winsByRegime,
      dominant_regime_last_30d: dominant,
      finding_type:            findingType,
      recommendation:          null,
      rec_param:               null,
      rec_value:               null,
    });

    console.log(
      `[signal-learning] ${recipeId}: n=${sampleSize}, wr7d=${win_rate_7d?.toFixed(2)}, ` +
      `wr30d=${win_rate_30d?.toFixed(2)}, wr90d=${win_rate_90d?.toFixed(2)}, ` +
      `trend=${trend}, finding=${findingType}`
    );
  }

  if (findingRows.length > 0) {
    const { error: insertError } = await supabase
      .from("agent_findings")
      .insert(findingRows);

    if (insertError) {
      console.error("[signal-learning] findings insert error:", insertError.message);
    } else {
      console.log(`[signal-learning] wrote ${findingRows.length} agent_findings rows`);
    }
  }
}

async function writeAgentLog(entry: {
  log_type: string;
  recipe_id: string | null;
  summary: string;
  content: string;
  agent_confidence: number | null;
  action_taken?: string;
}): Promise<string | null> {
  const { data, error } = await supabase
    .from("agent_log")
    .insert({
      log_type:         entry.log_type,
      recipe_id:        entry.recipe_id,
      summary:          entry.summary,
      content:          entry.content,
      agent_confidence: entry.agent_confidence,
      action_taken:     entry.action_taken ?? null,
    })
    .select("log_id")
    .single();

  if (error) {
    console.error("[signal-learning] agent_log insert error:", error.message);
    return null;
  }
  return (data as { log_id?: string } | null)?.log_id ?? null;
}

async function main(): Promise<void> {
  console.log("[signal-learning] starting...");
  const startMs = Date.now();

  const isColdStart = await checkColdStart();

  if (!isColdStart) {
    await runStatsEngine();
  }

  const summary = {
    ran_at:      new Date().toISOString(),
    cold_start:  isColdStart,
    duration_ms: Date.now() - startMs,
  };

  await fs.writeFile("learning-summary.json", JSON.stringify(summary, null, 2));
  console.log("[signal-learning] done.", summary);
}

main().catch((err) => {
  console.error("[signal-learning] fatal:", err);
  process.exit(1);
});
