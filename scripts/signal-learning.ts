// scripts/signal-learning.ts
// Nightly stats engine. Called by GitHub Actions at 01:00 UTC.
//
// Phases:
//   1. Cold-start guard: skip learning if < 100 outcomes or < 30 days of history
//   2. ATR backfill: find resolved-but-unsimulated outcomes, fetch ATR per coin,
//      simulate ATR-based exits, write entry_price/exit_price/net_pnl_bps/is_win
//   3. Stats engine: group by recipe, compute win rates + net PnL stats, write
//      agent_findings and update recipe_performance net PnL columns
//
// Exit rules (Sprint R10): first-hit-wins over discrete 1h/4h/24h snapshots.
//   Stop: entry - 2*ATR (LONG) / entry + 2*ATR (SHORT)
//   Target: entry + 3*ATR (LONG) / entry - 3*ATR (SHORT)
//   Time exit: first snapshot where neither stop nor target was hit

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs/promises";
import {
  computeWinRates,
  computeTrend,
  computeMeasuredEV,
  meetsMinSample,
  computeConfidence,
  computeWinRateByRegimeFit,
  simulateAtrExit,
  computeExpectancyBps,
  computeMedianNetPnlBps,
} from "../lib/signal-learning-utils";
import { computeATR } from "../lib/atr";

const SUPABASE_URL              = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const HYPERLIQUID_API_URL       =
  process.env.HYPERLIQUID_API_URL ?? "https://api.hyperliquid.xyz/info";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("FATAL: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ─── ATR fetching ──────────────────────────────────────────────────────────────

async function fetchAtrForCoin(coin: string): Promise<number | null> {
  const endTime   = Date.now();
  const startTime = endTime - 30 * 24 * 60 * 60 * 1000; // 30 days of 4h candles
  try {
    const res = await fetch(HYPERLIQUID_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "candleSnapshot",
        req: { coin, interval: "4h", startTime, endTime },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const candles = (await res.json()) as Array<{ h: string; l: string; c: string }>;
    return computeATR(candles);
  } catch {
    return null;
  }
}

// Fetch ATR for multiple coins, rate-limited to avoid hammering the API.
async function fetchAtrMap(coins: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  for (const coin of coins) {
    const atr = await fetchAtrForCoin(coin);
    if (atr !== null) map.set(coin, atr);
    // Small delay to avoid rate-limit
    await new Promise((r) => setTimeout(r, 200));
  }
  return map;
}

// ─── Phase 1: Cold-start guard ─────────────────────────────────────────────────

async function checkColdStart(): Promise<boolean> {
  const [{ count }, { data: oldest }] = await Promise.all([
    supabase.from("signal_outcomes").select("*", { count: "exact", head: true }),
    supabase
      .from("signal_outcomes")
      .select("created_at")
      .order("created_at", { ascending: true })
      .limit(1),
  ]);

  const totalRows = count ?? 0;
  const oldestDate = oldest?.[0]?.created_at ? new Date(oldest[0].created_at) : null;
  const daysOld = oldestDate
    ? (Date.now() - oldestDate.getTime()) / 86400_000
    : 0;

  if (totalRows < 100 || daysOld < 30) {
    console.log(
      `[signal-learning] Cold start guard: ${totalRows} outcomes, ${daysOld.toFixed(1)} days of data. Monitoring only.`
    );
    await writeAgentLog({
      log_type:         "OBSERVATION",
      recipe_id:        null,
      summary:          `Cold start: ${totalRows} outcomes over ${daysOld.toFixed(1)} days. Minimum 100 outcomes and 30 days required.`,
      content:          `Insufficient history for learning. Accumulated ${totalRows} resolved signal outcomes over ${daysOld.toFixed(1)} days.`,
      agent_confidence: null,
    });
    return true;
  }
  return false;
}

// ─── Phase 2: ATR exit backfill ────────────────────────────────────────────────

async function backfillAtrExits(): Promise<number> {
  const { data: rows, error } = await supabase
    .from("signal_outcomes")
    .select("id, coin, direction, price_at_signal, price_1h, price_4h, price_24h")
    .not("resolved_at", "is", null)
    .is("exit_reason", null)
    .in("direction", ["LONG", "SHORT"]);

  if (error) {
    console.error("[signal-learning] ATR backfill fetch error:", error.message);
    return 0;
  }
  if (!rows || rows.length === 0) {
    console.log("[signal-learning] ATR backfill: no pending rows");
    return 0;
  }

  console.log(`[signal-learning] ATR backfill: ${rows.length} rows to simulate`);

  const coins = [...new Set(rows.map((r) => r.coin as string))];
  console.log(`[signal-learning] Fetching ATR for ${coins.length} coins...`);
  const atrMap = await fetchAtrMap(coins);
  console.log(`[signal-learning] ATR fetched for ${atrMap.size}/${coins.length} coins`);

  const CHUNK = 50;
  let simulated = 0;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await Promise.all(
      chunk.map(async (row) => {
        const atr = atrMap.get(row.coin as string);
        if (!atr) return;
        const entry = parseFloat(String(row.price_at_signal));
        if (!isFinite(entry) || entry <= 0) return;

        const result = simulateAtrExit(
          row.direction as "LONG" | "SHORT",
          entry, atr,
          row.price_1h   != null ? parseFloat(String(row.price_1h))   : null,
          row.price_4h   != null ? parseFloat(String(row.price_4h))   : null,
          row.price_24h  != null ? parseFloat(String(row.price_24h))  : null,
        );
        if (!result) return;

        const { error: updErr } = await supabase
          .from("signal_outcomes")
          .update({
            entry_price:         result.entry_price,
            exit_price:          result.exit_price,
            exit_reason:         result.exit_reason,
            gross_pnl_bps:       result.gross_pnl_bps,
            net_pnl_bps:         result.net_pnl_bps,
            realized_r_multiple: result.realized_r_multiple,
            is_win:              result.is_win,
          })
          .eq("id", row.id);

        if (!updErr) simulated++;
      })
    );
  }

  console.log(`[signal-learning] ATR backfill: simulated ${simulated}/${rows.length} exits`);
  return simulated;
}

// ─── Phase 3: Stats engine ─────────────────────────────────────────────────────

async function runStatsEngine(): Promise<void> {
  console.log("[signal-learning] running stats engine...");

  const cutoff90d = new Date(Date.now() - 90 * 86400_000).toISOString();
  const cutoff60d = new Date(Date.now() - 60 * 86400_000).toISOString();

  const { data: rows, error } = await supabase
    .from("signal_outcomes")
    .select(
      "id, recipe_id, coin, direction, created_at, " +
      "is_win, move_pct_4h, net_pnl_bps, exit_reason"
    )
    .not("resolved_at", "is", null)
    .gte("created_at", cutoff90d);

  if (error || !rows) {
    console.error("[signal-learning] query error:", error?.message);
    return;
  }

  type OutcomeRow = {
    id: string;
    recipe_id: string | null;
    coin: string;
    direction: string | null;
    created_at: string;
    is_win: boolean | null;
    move_pct_4h: number | null;
    net_pnl_bps: number | null;
    exit_reason: string | null;
  };
  const typedRows = rows as unknown as OutcomeRow[];

  // Fetch wallet_regime_fit from signals_history metadata for each row.
  const signalIds = typedRows.map((r) => r.id).filter(Boolean);
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

  const byRecipe = new Map<string, OutcomeRow[]>();
  for (const row of typedRows) {
    const rid = row.recipe_id;
    if (!rid) continue;
    if (!byRecipe.has(rid)) byRecipe.set(rid, []);
    byRecipe.get(rid)!.push(row);
  }

  const findingRows: Record<string, unknown>[] = [];

  for (const [recipeId, recipeRows] of byRecipe) {
    const outcomes = recipeRows.map((r) => ({
      is_win:      r.is_win,
      fired_at:    r.created_at,
      move_pct_4h: r.move_pct_4h,
      net_pnl_bps: r.net_pnl_bps,
    }));

    const { win_rate_7d, win_rate_30d, win_rate_90d } = computeWinRates(
      outcomes.map((o) => ({ is_win: o.is_win, fired_at: o.fired_at }))
    );
    const trend      = computeTrend(win_rate_7d, win_rate_90d);
    const sampleSize = outcomes.filter((o) => o.is_win !== null).length;
    const confidence = computeConfidence(sampleSize, win_rate_30d ?? 0.5);

    // Legacy avg win/loss from move_pct_4h for backcompat display
    const wins   = outcomes.filter((o) => o.is_win && o.move_pct_4h !== null);
    const losses = outcomes.filter((o) => o.is_win === false && o.move_pct_4h !== null);
    const avgWin  = wins.length > 0
      ? wins.reduce((s, o) => s + (o.move_pct_4h ?? 0), 0) / wins.length
      : null;
    const avgLoss = losses.length > 0
      ? losses.reduce((s, o) => s + (o.move_pct_4h ?? 0), 0) / losses.length
      : null;

    const measuredEV = computeMeasuredEV(win_rate_30d, avgWin, avgLoss);

    const regimeFitOutcomes = recipeRows.map((r) => ({
      is_win:     r.is_win,
      regime_fit: regimeFitById.get(r.id) ?? null,
    }));
    const fitBuckets = computeWinRateByRegimeFit(regimeFitOutcomes);

    if (
      fitBuckets.high.win_rate !== null && fitBuckets.low.win_rate !== null &&
      fitBuckets.high.sample >= 5 && fitBuckets.low.sample >= 5 &&
      fitBuckets.high.win_rate - fitBuckets.low.win_rate > 0.05
    ) {
      await writeAgentLog({
        log_type:         "REGIME_FIT_SIGNAL",
        recipe_id:        recipeId,
        summary:          `${recipeId}: HIGH-fit signals win at ${(fitBuckets.high.win_rate * 100).toFixed(1)}% vs LOW-fit ${(fitBuckets.low.win_rate * 100).toFixed(1)}%`,
        content:          JSON.stringify({ high: fitBuckets.high, mid: fitBuckets.mid, low: fitBuckets.low }),
        agent_confidence: Math.min(fitBuckets.high.sample, fitBuckets.low.sample) >= 30 ? 0.8 : 0.5,
      });
    }

    let findingType = "STABLE";
    if (!meetsMinSample(sampleSize)) findingType = "INSUFFICIENT_DATA";
    else if (trend === "DEGRADING" && confidence > 0.70) findingType = "UNDERPERFORMING";
    else if (trend === "IMPROVING") findingType = "IMPROVING";

    findingRows.push({
      recipe_id:                recipeId,
      regime:                   "ALL",
      period_days:              90,
      sample_size:              sampleSize,
      meets_min_sample:         meetsMinSample(sampleSize),
      confidence,
      win_rate_7d,
      win_rate_30d,
      win_rate_90d,
      trend,
      avg_win_pct:              avgWin,
      avg_loss_pct:             avgLoss,
      measured_ev:              measuredEV,
      baseline_ev:              null,
      vs_baseline_ev:           null,
      win_rate_by_regime:       null,
      dominant_regime_last_30d: null,
      finding_type:             findingType,
      recommendation:           null,
      rec_param:                null,
      rec_value:                null,
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

  // Update recipe_performance rows with net PnL stats
  await updateRecipeNetStats(byRecipe, cutoff60d);
}

// ─── Update recipe_performance net PnL fields ─────────────────────────────────

async function updateRecipeNetStats(
  byRecipe: Map<string, Array<{ net_pnl_bps: number | null; is_win: boolean | null; created_at: string }>>,
  cutoff60d: string,
): Promise<void> {
  const recipeIds = [...byRecipe.keys()];
  if (recipeIds.length === 0) return;

  // Find the most recent recipe_performance row per recipe to UPDATE in place
  const { data: latestRows } = await supabase
    .from("recipe_performance")
    .select("id, recipe_id")
    .in("recipe_id", recipeIds)
    .order("measured_at", { ascending: false });

  const latestById = new Map<string, string>();
  for (const row of latestRows ?? []) {
    if (!latestById.has(row.recipe_id as string)) {
      latestById.set(row.recipe_id as string, row.id as string);
    }
  }

  for (const [recipeId, recipeRows] of byRecipe) {
    const id = latestById.get(recipeId);
    if (!id) continue;

    // 60-day window for net PnL stats
    const rows60d = recipeRows.filter(
      (r) => (r.created_at as string) >= cutoff60d && r.net_pnl_bps !== null
    );

    const expectancy = computeExpectancyBps(
      rows60d.map((r) => ({ net_pnl_bps: r.net_pnl_bps as number | null }))
    );
    const median = computeMedianNetPnlBps(
      rows60d.map((r) => ({ net_pnl_bps: r.net_pnl_bps as number | null }))
    );
    const wins60d = rows60d.filter((r) => (r.is_win as boolean | null) === true).length;
    const winRateNet = rows60d.length > 0 ? wins60d / rows60d.length : null;

    await supabase
      .from("recipe_performance")
      .update({
        median_net_pnl_bps:  median,
        win_rate_net:        winRateNet,
        expectancy_bps_net:  expectancy,
        sample_size_60d:     rows60d.length > 0 ? rows60d.length : null,
      })
      .eq("id", id);
  }

  console.log(`[signal-learning] updated net PnL stats for ${latestById.size} recipes`);
}

// ─── Agent log ─────────────────────────────────────────────────────────────────

async function writeAgentLog(entry: {
  log_type:         string;
  recipe_id:        string | null;
  summary:          string;
  content:          string;
  agent_confidence: number | null;
  action_taken?:    string;
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

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("[signal-learning] starting...");
  const startMs = Date.now();

  const isColdStart = await checkColdStart();
  let simulated = 0;

  if (!isColdStart) {
    simulated = await backfillAtrExits();
    await runStatsEngine();
  }

  const summary = {
    ran_at:       new Date().toISOString(),
    cold_start:   isColdStart,
    simulated,
    duration_ms:  Date.now() - startMs,
  };

  await fs.writeFile("learning-summary.json", JSON.stringify(summary, null, 2));
  console.log("[signal-learning] done.", summary);
}

main().catch((err) => {
  console.error("[signal-learning] fatal:", err);
  process.exit(1);
});
