// scripts/signal-learning.ts
// Nightly stats engine. Called by GitHub Actions at 01:00 UTC.
//
// Phases:
//   1. Grading: walk hourly candles for every ungraded outcome whose 24h holding
//      window has closed, and write entry/exit/cost/net_pnl_bps/is_win.
//      Runs per row with no population quorum; the old cold-start gate could
//      never open under 30-day retention (audit 2026-08-08).
//   2. Stats engine: group by recipe, compute win rates + net PnL stats, write
//      agent_findings and update recipe_performance net PnL columns. Low-sample
//      recipes are marked INSUFFICIENT_DATA rather than hidden.
//
// Exit rules: first-hit-wins over the 1h candle path, capped at a 24h hold.
//   Stop: entry - 2*ATR (LONG) / entry + 2*ATR (SHORT)
//   Target: entry + 3*ATR (LONG) / entry - 3*ATR (SHORT)
//   Time exit: close of the last bar in the holding window
//
// Stops and targets are tested against each bar's high and low, not its close.
// The previous version compared three close prices and broke out of its loop on
// the first one, so an adverse excursion at hour 4 or hour 20 was invisible and
// every trade recorded a 1-hour time exit. ATR is measured from bars that had
// closed by the signal timestamp, and net PnL carries fees, tier-based slippage
// and realised funding.

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs/promises";
import {
  computeWinRates,
  computeTrend,
  computeMeasuredEV,
  meetsMinSample,
  confidenceAboveBreakeven,
  breakevenWinRate,
  computeWinRateByRegimeFit,
  simulateExitFromCandles,
  slippageBpsForCoin,
  computeExpectancyBps,
  computeRecipeNetStats,
  EXIT_STOP_ATR,
  EXIT_TARGET_ATR,
} from "../lib/signal-learning-utils";
import { computeATRAsOf } from "../lib/atr";
import { computeAlpha, marketReturnBps } from "../lib/benchmark";
import { toReturns, alignReturns, computeBeta } from "../lib/beta";
import {
  fetchCandleSnapshot,
  fetchFundingHistory,
  type HlCandle,
} from "../lib/hyperliquid-api-client";

const SUPABASE_URL              = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("FATAL: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ─── Market data per coin ──────────────────────────────────────────────────────

const HOUR_MS       = 3600_000;
const FOUR_H_MS     = 4 * HOUR_MS;
const MAX_HOLD_HOURS = 24;
// 4h candles reaching this far back so a signal always has 14 closed bars
// available for its point-in-time ATR.
const ATR_LOOKBACK_MS = 30 * 24 * HOUR_MS;
// Past this age, a coin with no candle history is treated as gone for good.
const NO_DATA_GIVE_UP_MS = 7 * 24 * HOUR_MS;

interface CoinMarketData {
  bars1h:   HlCandle[];
  bars4h:   HlCandle[];
  /** Hourly funding rates in bps, ascending by time. Positive means longs pay. */
  funding:  Array<{ t: number; bps: number }>;
}

async function fetchCoinMarketData(
  coin: string,
  fromMs: number,
): Promise<CoinMarketData | null> {
  const now = Date.now();
  try {
    const [bars1h, bars4h, fundingRaw] = await Promise.all([
      fetchCandleSnapshot(coin, "1h", fromMs - HOUR_MS, now),
      fetchCandleSnapshot(coin, "4h", fromMs - ATR_LOOKBACK_MS, now),
      fetchFundingHistory(coin, fromMs - HOUR_MS).catch(() => []),
    ]);
    if (!bars1h?.length || !bars4h?.length) return null;
    const funding = (fundingRaw ?? [])
      .map((f) => ({ t: f.time, bps: parseFloat(f.fundingRate) * 10_000 }))
      .filter((f) => isFinite(f.bps))
      .sort((a, b) => a.t - b.t);
    return { bars1h, bars4h, funding };
  } catch (err) {
    console.warn(`[signal-learning] market data fetch failed for ${coin}:`, err);
    return null;
  }
}

/**
 * Mean hourly funding over the maximum holding window from entry. The exact
 * hold is not known until the exit resolves, so the rate is averaged across the
 * window and the simulator scales it by the hold it actually produces.
 */
function meanFundingBpsPerHour(
  funding: Array<{ t: number; bps: number }>,
  entryMs: number,
): number {
  const windowEnd = entryMs + MAX_HOLD_HOURS * HOUR_MS;
  const inWindow  = funding.filter((f) => f.t >= entryMs && f.t < windowEnd);
  if (inWindow.length === 0) return 0;
  return inWindow.reduce((s, f) => s + f.bps, 0) / inWindow.length;
}

// ─── Phase 1: grade outcomes against the hourly path ───────────────────────────

async function gradeOutcomes(): Promise<number> {
  // Grading needs the full holding window to have elapsed, and nothing else.
  // It reads candles directly rather than the price_1h/4h/24h columns, so it no
  // longer waits on /api/measure-outcomes to have run first.
  const readyBefore = new Date(Date.now() - MAX_HOLD_HOURS * HOUR_MS).toISOString();

  const { data: rows, error } = await supabase
    .from("signal_outcomes")
    .select("id, coin, direction, price_at_signal, created_at")
    .is("exit_reason", null)
    .in("direction", ["LONG", "SHORT"])
    .lte("created_at", readyBefore)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[signal-learning] grading fetch error:", error.message);
    return 0;
  }
  if (!rows || rows.length === 0) {
    console.log("[signal-learning] grading: no rows ready");
    return 0;
  }

  const byCoin = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byCoin.get(row.coin as string) ?? [];
    list.push(row);
    byCoin.set(row.coin as string, list);
  }

  console.log(`[signal-learning] grading ${rows.length} rows across ${byCoin.size} coins`);

  // BTC over the full grading span, fetched once, used as the market benchmark
  // for every outcome. Without it, expectancy cannot separate edge from beta.
  const earliestOverall = Math.min(...rows.map((r) => new Date(r.created_at as string).getTime()));
  const [btcBars, btcBars4h] = await Promise.all([
    fetchCandleSnapshot("BTC", "1h", earliestOverall - HOUR_MS, Date.now())
      .catch(() => [] as HlCandle[]),
    // 4h bars over the ATR lookback, used to estimate each coin's beta to BTC.
    fetchCandleSnapshot("BTC", "4h", earliestOverall - ATR_LOOKBACK_MS, Date.now())
      .catch(() => [] as HlCandle[]),
  ]);
  if (btcBars.length === 0) {
    console.warn("[signal-learning] BTC benchmark unavailable, alpha will be null this run");
  }
  const btcReturns4h = toReturns(btcBars4h);

  /** BTC close at or after the given time. */
  const btcPriceAt = (ms: number): number | null => {
    for (const b of btcBars) {
      if (b.t >= ms) {
        const px = parseFloat(b.c);
        return isFinite(px) && px > 0 ? px : null;
      }
    }
    return null;
  };

  let graded = 0;
  let noData = 0;
  let noAtr  = 0;

  for (const [coin, coinRows] of byCoin) {
    const earliest = Math.min(...coinRows.map((r) => new Date(r.created_at as string).getTime()));
    const market = await fetchCoinMarketData(coin, earliest);
    await new Promise((r) => setTimeout(r, 200)); // rate-limit courtesy

    if (!market) {
      noData += coinRows.length;
      // A coin with no candle history past the retry window is delisted, not
      // slow. Mark those rows terminal so they stop being re-fetched nightly
      // for the rest of the 180-day retention period.
      const staleIds = coinRows
        .filter((r) => new Date(r.created_at as string).getTime() < Date.now() - NO_DATA_GIVE_UP_MS)
        .map((r) => r.id);
      if (staleIds.length > 0) {
        await supabase
          .from("signal_outcomes")
          .update({ exit_reason: "no_data" })
          .in("id", staleIds);
        console.log(`[signal-learning] ${coin}: ${staleIds.length} rows marked no_data`);
      }
      continue;
    }

    const slippageBps = slippageBpsForCoin(coin);

    for (const row of coinRows) {
      const entryMs = new Date(row.created_at as string).getTime();
      const entry   = parseFloat(String(row.price_at_signal));
      if (!isFinite(entry) || entry <= 0) continue;

      const atr = computeATRAsOf(market.bars4h, entryMs, { intervalMs: FOUR_H_MS });
      if (atr === null || atr <= 0) {
        noAtr++;
        continue;
      }

      const result = simulateExitFromCandles({
        direction:         row.direction as "LONG" | "SHORT",
        entryPrice:        entry,
        atr,
        entryMs,
        bars:              market.bars1h,
        maxHoldHours:      MAX_HOLD_HOURS,
        slippageBps,
        fundingBpsPerHour: meanFundingBpsPerHour(market.funding, entryMs),
      });
      if (!result) continue;

      // Charge the trade for the market exposure it was riding over the same
      // window it actually held, scaled by how much this coin moves with BTC.
      // Beta is estimated only from bars that closed before the signal, so the
      // trade is never scored using information it could not have had.
      const coinReturnsBefore = toReturns(
        market.bars4h.filter((b) => b.t + FOUR_H_MS <= entryMs)
      );
      const btcReturnsBefore = btcReturns4h.filter((r) => r.t + FOUR_H_MS <= entryMs);
      const aligned = alignReturns(coinReturnsBefore, btcReturnsBefore);
      const beta    = computeBeta(aligned.coin, aligned.market);

      const btcEntry = btcPriceAt(entryMs);
      const btcExit  = btcPriceAt(entryMs + result.hold_hours * HOUR_MS);
      const { benchmark_bps, alpha_bps } = computeAlpha({
        netPnlBps:       result.net_pnl_bps,
        marketReturnBps: btcEntry !== null && btcExit !== null
          ? marketReturnBps(btcEntry, btcExit)
          : null,
        direction:       row.direction as "LONG" | "SHORT",
        beta,
      });

      const { error: updErr } = await supabase
        .from("signal_outcomes")
        .update({
          entry_price:         result.entry_price,
          exit_price:          result.exit_price,
          exit_reason:         result.exit_reason,
          hold_hours:          result.hold_hours,
          gross_pnl_bps:       result.gross_pnl_bps,
          cost_bps:            result.cost_bps,
          net_pnl_bps:         result.net_pnl_bps,
          realized_r_multiple: result.realized_r_multiple,
          is_win:              result.is_win,
          benchmark_bps,
          alpha_bps,
          beta,
          resolved_at:         new Date().toISOString(),
        })
        .eq("id", row.id);

      if (updErr) console.error("[signal-learning] grade update error:", updErr.message);
      else graded++;
    }
  }

  console.log(
    `[signal-learning] graded ${graded}/${rows.length} ` +
    `(no market data: ${noData}, no point-in-time ATR: ${noAtr})`
  );
  return graded;
}

// ─── Phase 2: Stats engine ─────────────────────────────────────────────────────

async function runStatsEngine(): Promise<void> {
  console.log("[signal-learning] running stats engine...");

  const cutoff90d = new Date(Date.now() - 90 * 86400_000).toISOString();
  const cutoff60d = new Date(Date.now() - 60 * 86400_000).toISOString();

  const { data: rows, error } = await supabase
    .from("signal_outcomes")
    .select(
      "id, signal_id, recipe_id, coin, direction, created_at, " +
      "is_win, move_pct_4h, net_pnl_bps, alpha_bps, exit_reason"
    )
    .not("resolved_at", "is", null)
    .gte("created_at", cutoff90d);

  if (error || !rows) {
    console.error("[signal-learning] query error:", error?.message);
    return;
  }

  type OutcomeRow = {
    id: string;
    signal_id: string | null;
    recipe_id: string | null;
    coin: string;
    direction: string | null;
    created_at: string;
    is_win: boolean | null;
    move_pct_4h: number | null;
    net_pnl_bps: number | null;
    alpha_bps: number | null;
    exit_reason: string | null;
  };
  const typedRows = rows as unknown as OutcomeRow[];

  // Fetch wallet_regime_fit from signals_history metadata for each row.
  // Keyed on signal_id: signal_outcomes.id is its own primary key, so joining
  // on it matched nothing and this stratification never saw a single value.
  const signalIds = typedRows.map((r) => r.signal_id).filter(Boolean);
  let regimeFitBySignalId = new Map<string, number | null>();
  if (signalIds.length > 0) {
    const { data: metaRows } = await supabase
      .from("signals_history")
      .select("id, metadata")
      .in("id", signalIds);
    regimeFitBySignalId = new Map(
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
    // A 2-ATR stop against a 3-ATR target breaks even at 40%, so confidence is
    // measured against that, not against a coin flip.
    const breakeven  = breakevenWinRate(EXIT_STOP_ATR, EXIT_TARGET_ATR);
    const confidence = confidenceAboveBreakeven(sampleSize, win_rate_30d ?? breakeven, breakeven);

    // Average win and loss in percent, taken from the same simulated exits that
    // set is_win. Sourcing magnitudes from move_pct_4h while sourcing the
    // win/loss label from the exit simulation mixed two different trades.
    const wins   = outcomes.filter((o) => o.is_win === true  && o.net_pnl_bps !== null);
    const losses = outcomes.filter((o) => o.is_win === false && o.net_pnl_bps !== null);
    const avgWin  = wins.length > 0
      ? wins.reduce((s, o) => s + (o.net_pnl_bps ?? 0), 0) / wins.length / 100
      : null;
    const avgLoss = losses.length > 0
      ? losses.reduce((s, o) => s + (o.net_pnl_bps ?? 0), 0) / losses.length / 100
      : null;

    const measuredEV = computeMeasuredEV(win_rate_30d, avgWin, avgLoss);
    const expectancy = computeExpectancyBps(
      outcomes.map((o) => ({ net_pnl_bps: o.net_pnl_bps }))
    );

    const regimeFitOutcomes = recipeRows.map((r) => ({
      is_win:     r.is_win,
      regime_fit: r.signal_id ? regimeFitBySignalId.get(r.signal_id) ?? null : null,
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

    // Prove or kill: expectancy decides, not win rate. A recipe can win often
    // and still lose money, and with a 3:2 payoff it can lose often and make it.
    let findingType = "STABLE";
    if (!meetsMinSample(sampleSize))              findingType = "INSUFFICIENT_DATA";
    else if (expectancy !== null && expectancy <= 0) findingType = "UNDERPERFORMING";
    else if (trend === "IMPROVING")               findingType = "IMPROVING";

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
      `[signal-learning] ${recipeId}: n=${sampleSize}, wr30d=${win_rate_30d?.toFixed(2)} ` +
      `(breakeven ${breakeven.toFixed(2)}), expectancy=${expectancy ?? "n/a"} bps, ` +
      `conf_above_breakeven=${confidence.toFixed(2)}, trend=${trend}, finding=${findingType}`
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
  byRecipe: Map<string, Array<{ net_pnl_bps: number | null; is_win: boolean | null; alpha_bps: number | null; created_at: string }>>,
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

    // Withheld below the minimum sample so no reader can publish an expectancy
    // built from a handful of trades.
    const stats = computeRecipeNetStats(
      rows60d.map((r) => ({
        net_pnl_bps: r.net_pnl_bps as number | null,
        is_win:      r.is_win as boolean | null,
        alpha_bps:   r.alpha_bps as number | null,
      }))
    );

    await supabase
      .from("recipe_performance")
      .update(stats)
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

  // Grading is per row and idempotent, so it runs unconditionally. The old
  // quorum gate (100 outcomes AND 30 days) could never open while retention
  // deleted at 30 days, so nothing was ever graded (audit 2026-08-08).
  // Statistical caution now lives where it belongs: runStatsEngine still marks
  // low-sample recipes INSUFFICIENT_DATA rather than hiding them.
  const simulated = await gradeOutcomes();
  await runStatsEngine();

  const [{ count: gradedCount }, { data: oldestRow }] = await Promise.all([
    supabase.from("signal_outcomes").select("*", { count: "exact", head: true }).not("is_win", "is", null),
    supabase.from("signal_outcomes").select("created_at").order("created_at", { ascending: true }).limit(1),
  ]);
  const graded = gradedCount ?? 0;
  const oldestDays = oldestRow?.[0]?.created_at
    ? (Date.now() - new Date(oldestRow[0].created_at).getTime()) / 86_400_000
    : 0;

  await writeAgentLog({
    log_type:         "OBSERVATION",
    recipe_id:        null,
    summary:          `Graded ${simulated} outcomes this run. ${graded} graded total over ${oldestDays.toFixed(1)} days of history.`,
    content:          `Per-outcome grading run. Newly simulated exits: ${simulated}. Cumulative graded outcomes: ${graded}. Oldest retained outcome: ${oldestDays.toFixed(1)} days.`,
    agent_confidence: null,
  });

  const summary = {
    ran_at:        new Date().toISOString(),
    simulated,
    graded_total:  graded,
    history_days:  parseFloat(oldestDays.toFixed(1)),
    duration_ms:   Date.now() - startMs,
  };

  await fs.writeFile("learning-summary.json", JSON.stringify(summary, null, 2));
  console.log("[signal-learning] done.", summary);
}

main().catch((err) => {
  console.error("[signal-learning] fatal:", err);
  process.exit(1);
});
