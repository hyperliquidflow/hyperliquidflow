#!/usr/bin/env npx tsx
// scripts/rank-ic.ts
// Computes Spearman rank IC: scores at date D vs realized returns D+1..D+30.
// Reads wallet_score_history (written by daily-wallet-scan.ts Phase 11).
// Writes rank_ic_history. Run by .github/workflows/rank-ic.yml at 02:00 UTC.
//
// Phase 1 gate (docs/preflight/kill-criteria.md):
//   IC must be statistically > MDIC (0.08) after 30+ measurements.
//   If not, halt Phase 2.

import { createClient } from "@supabase/supabase-js";
import { sampleRankCorrelation } from "simple-statistics";

const SUPABASE_URL              = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const HORIZON_DAYS = 30;
export const MDIC  = 0.08; // minimum detectable IC from docs/preflight/rank-ic-power.md

// Conservative cross-sectional correlation adjustment.
// Re-fit after P0.1 power analysis. Until then assume 50% of wallets are correlated.
const ESS_FACTOR = 0.5;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Normal CDF approximation (Abramowitz & Stegun, max error 7.5e-8)
function normalCdf(z: number): number {
  if (z < 0) return 1 - normalCdf(-z);
  const p  = 0.2316419;
  const t  = 1 / (1 + p * z);
  const t2 = t * t, t3 = t2 * t, t4 = t3 * t, t5 = t4 * t;
  const phi = Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
  return 1 - phi * (0.319381530 * t - 0.356563782 * t2 + 1.781477937 * t3
    - 1.821255978 * t4 + 1.330274429 * t5);
}

// Two-tailed p-value using normal approximation (valid for ess >> 30)
function spearmanPValue(rho: number, ess: number): number {
  if (ess < 4) return 1;
  const denominator = 1 - rho * rho;
  if (denominator <= 0) return 0;
  const t = rho * Math.sqrt((ess - 2) / denominator);
  return 2 * (1 - normalCdf(Math.abs(t)));
}

async function computeIcForDate(dateStr: string): Promise<{
  rank_ic: number;
  p_value: number;
  cohort_size: number;
  effective_sample_size: number;
  top_decile_hit_rate: number;
  bottom_decile_avoidance: number;
} | null> {
  // Scores on date D
  const { data: scores, error: scErr } = await supabase
    .from("wallet_score_history")
    .select("wallet_id, overall_score")
    .eq("date", dateStr)
    .not("overall_score", "is", null);

  if (scErr || !scores || scores.length < 20) {
    if (scErr) console.warn(`[rank-ic] ${dateStr} score fetch error:`, scErr.message);
    return null;
  }

  // Realized returns: sum of daily_pnl_usd from D+1 through D+30
  const dStart = new Date(dateStr);
  dStart.setDate(dStart.getDate() + 1);
  const dEnd = new Date(dateStr);
  dEnd.setDate(dEnd.getDate() + HORIZON_DAYS);
  const startStr = dStart.toISOString().slice(0, 10);
  const endStr   = dEnd.toISOString().slice(0, 10);

  const walletIds = scores.map((s) => s.wallet_id);
  const { data: pnlRows, error: pnlErr } = await supabase
    .from("wallet_score_history")
    .select("wallet_id, daily_pnl_usd")
    .in("wallet_id", walletIds)
    .gte("date", startStr)
    .lte("date", endStr);

  if (pnlErr || !pnlRows) {
    if (pnlErr) console.warn(`[rank-ic] ${dateStr} PnL fetch error:`, pnlErr.message);
    return null;
  }

  // Sum PnL per wallet over the horizon window
  const returnMap = new Map<string, number>();
  for (const row of pnlRows) {
    returnMap.set(row.wallet_id, (returnMap.get(row.wallet_id) ?? 0) + (row.daily_pnl_usd ?? 0));
  }

  // Align: only wallets present in both score snapshot and return window
  const pairs: Array<{ score: number; ret: number }> = [];
  for (const s of scores) {
    const ret = returnMap.get(s.wallet_id);
    if (ret !== undefined) pairs.push({ score: s.overall_score, ret });
  }

  if (pairs.length < 20) {
    console.warn(`[rank-ic] ${dateStr}: only ${pairs.length} paired wallets, need 20+, skipping`);
    return null;
  }

  let rho: number;
  try {
    rho = sampleRankCorrelation(
      pairs.map((p) => p.score),
      pairs.map((p) => p.ret),
    );
  } catch (e) {
    console.warn(`[rank-ic] ${dateStr} spearmanCorrelation error:`, e);
    return null;
  }

  if (!Number.isFinite(rho)) {
    console.warn(`[rank-ic] skipping ${dateStr}: correlation not finite`);
    return null;
  }

  const n   = pairs.length;
  const ess = Math.round(n * ESS_FACTOR);
  const pv  = spearmanPValue(rho, ess);

  // Decile hit rates
  const decileN = Math.max(1, Math.round(n * 0.1));
  const sorted  = [...pairs].sort((a, b) => b.score - a.score);
  const topDecile    = sorted.slice(0, decileN);
  const bottomDecile = sorted.slice(-decileN);
  const medianReturn = [...pairs].map((p) => p.ret).sort((a, b) => a - b)[Math.floor(n / 2)];

  const topHitRate  = topDecile.filter((p) => p.ret >= medianReturn).length / decileN;
  const bottomAvoid = bottomDecile.filter((p) => p.ret < medianReturn).length / decileN;

  const row = {
    measurement_date:        dateStr,
    horizon_days:            HORIZON_DAYS,
    cohort_size:             n,
    effective_sample_size:   ess,
    rank_ic:                 rho,
    p_value:                 pv,
    top_decile_hit_rate:     topHitRate,
    bottom_decile_avoidance: bottomAvoid,
    computed_at:             new Date().toISOString(),
  };

  const { error: upsertErr } = await supabase
    .from("rank_ic_history")
    .upsert(row, { onConflict: "measurement_date" });

  if (upsertErr) {
    console.error(`[rank-ic] ${dateStr} upsert error:`, upsertErr.message);
    return null;
  }

  return { rank_ic: rho, p_value: pv, cohort_size: n, effective_sample_size: ess, top_decile_hit_rate: topHitRate, bottom_decile_avoidance: bottomAvoid };
}

async function computeShadowIcForDate(dateStr: string): Promise<number | null> {
  const { data: scores, error: scErr } = await supabase
    .from("wallet_score_history")
    .select("wallet_id, overall_score_shadow")
    .eq("date", dateStr)
    .not("overall_score_shadow", "is", null);

  if (scErr || !scores || scores.length < 20) return null;

  const dStart = new Date(dateStr);
  dStart.setDate(dStart.getDate() + 1);
  const dEnd = new Date(dateStr);
  dEnd.setDate(dEnd.getDate() + HORIZON_DAYS);

  const walletIds = scores.map((s) => s.wallet_id);
  const { data: pnlRows, error: pnlErr } = await supabase
    .from("wallet_score_history")
    .select("wallet_id, daily_pnl_usd")
    .in("wallet_id", walletIds)
    .gte("date", dStart.toISOString().slice(0, 10))
    .lte("date", dEnd.toISOString().slice(0, 10));

  if (pnlErr) console.warn(`[rank-ic] ${dateStr} shadow PnL fetch error:`, pnlErr.message);
  if (!pnlRows) return null;

  const returnMap = new Map<string, number>();
  for (const row of pnlRows) {
    returnMap.set(row.wallet_id, (returnMap.get(row.wallet_id) ?? 0) + (row.daily_pnl_usd ?? 0));
  }

  const pairs: Array<{ score: number; ret: number }> = [];
  for (const s of scores) {
    const ret = returnMap.get(s.wallet_id);
    if (ret !== undefined) pairs.push({ score: s.overall_score_shadow as number, ret });
  }

  if (pairs.length < 20) return null;

  try {
    const rho = sampleRankCorrelation(
      pairs.map((p) => p.score),
      pairs.map((p) => p.ret),
    );
    if (!Number.isFinite(rho)) {
      console.warn(`[rank-ic] skipping ${dateStr} shadow: correlation not finite`);
      return null;
    }
    return rho;
  } catch (e) {
    console.warn(`[rank-ic] ${dateStr} shadow spearmanCorrelation error:`, e);
    return null;
  }
}

// ── OOCV recipe base-rate comparison ─────────────────────────────────────────
// Compares weekly signal fire rates (in-cohort vs. out-of-cohort) per recipe.
// If they diverge materially, wallet selection -- not the recipe -- is driving
// the signal frequency.
//
// Currently: OOCV wallets have no positions tracked (Sprint R11 sets up the
// held-out set; R12 will wire OOCV position tracking).  Until then this
// function logs in-cohort base rates only and notes when OOCV data is absent.
async function computeWeeklyRecipeBaseRates(): Promise<void> {
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();

  // In-cohort: signals fired in the last 7 days
  const { data: signals, error: sigErr } = await supabase
    .from("signal_events")
    .select("recipe_id, wallet_ids")
    .gte("fired_at", weekAgo);

  if (sigErr || !signals || signals.length === 0) {
    console.log("[oocv-base-rates] no signal_events in last 7d, skipping");
    return;
  }

  // Active cohort wallet IDs
  const { data: activeWallets } = await supabase
    .from("wallets")
    .select("id")
    .eq("is_active", true);
  const activeIds = new Set((activeWallets ?? []).map((w: { id: string }) => w.id));

  // OOCV wallet IDs
  const { data: oocvRows } = await supabase
    .from("out_of_cohort_tracking")
    .select("wallet_id")
    .eq("is_active_in_oocv", true)
    .not("wallet_id", "is", null);
  const oocvIds = new Set((oocvRows ?? []).map((r: { wallet_id: string }) => r.wallet_id));

  // Count signal_events rows per recipe that involved at least one in-cohort / OOCV wallet.
  // Metric is firing-frequency (events / wallet count), not participation rate.
  // Sufficient for selection-bias detection; participation rate can be added in R12.
  const inCohortCounts = new Map<string, number>();
  const oocvCounts     = new Map<string, number>();

  for (const row of signals) {
    const recipe   = row.recipe_id as string;
    const wallets  = (row.wallet_ids ?? []) as string[];
    const hasActive = wallets.some((id) => activeIds.has(id));
    const hasOocv   = wallets.some((id) => oocvIds.has(id));
    if (hasActive) inCohortCounts.set(recipe, (inCohortCounts.get(recipe) ?? 0) + 1);
    if (hasOocv)   oocvCounts.set(recipe,    (oocvCounts.get(recipe)    ?? 0) + 1);
  }

  const activeCount = activeIds.size || 1;
  const oocvCount   = oocvIds.size  || 1;

  console.log(`[oocv-base-rates] in-cohort wallets: ${activeIds.size}, oocv wallets: ${oocvIds.size}`);
  if (oocvIds.size === 0) {
    console.log("[oocv-base-rates] OOCV set is empty -- no comparison yet. Position tracking required (Sprint R12).");
  }

  const allRecipes = new Set([...inCohortCounts.keys(), ...oocvCounts.keys()]);
  let divergenceWarnings = 0;

  for (const recipe of [...allRecipes].sort()) {
    const ic   = (inCohortCounts.get(recipe) ?? 0) / activeCount;
    const oc   = (oocvCounts.get(recipe)     ?? 0) / oocvCount;
    const diff = Math.abs(ic - oc);
    // Warn when in-cohort rate is more than 2x the OOCV rate (or vice-versa)
    // and the absolute gap is non-trivial (> 0.05 signals/wallet/week).
    const diverges = diff > 0.05 && (oc > 0 ? ic / oc > 2 || oc / ic > 2 : ic > 0.05);
    if (diverges) divergenceWarnings++;
    console.log(
      `[oocv-base-rates] ${recipe.padEnd(20)} in-cohort: ${ic.toFixed(4)}/wallet  ` +
      `oocv: ${oc.toFixed(4)}/wallet${diverges ? "  *** DIVERGENCE" : ""}`
    );
  }

  if (divergenceWarnings > 0) {
    console.warn(
      `[oocv-base-rates] WARNING: ${divergenceWarnings} recipe(s) diverge materially. ` +
      "Selection bias may be inflating in-cohort signal rates. Review R12 EV decoupling."
    );
  }
}

async function main() {
  const today = new Date();
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - (HORIZON_DAYS + 1));
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  // Find distinct dates with score history that are old enough to measure
  const [{ data: scoreDateRows }, { data: measured }] = await Promise.all([
    supabase
      .from("wallet_score_history")
      .select("date")
      .lte("date", cutoffStr)
      .order("date", { ascending: true })
      .limit(90),
    supabase
      .from("rank_ic_history")
      .select("measurement_date")
      .lte("measurement_date", cutoffStr),
  ]);

  if (!scoreDateRows || scoreDateRows.length === 0) {
    console.log("[rank-ic] No score history with sufficient horizon yet. First IC measurement in ~31 days.");
    return;
  }

  const measuredSet   = new Set((measured ?? []).map((r) => r.measurement_date as string));
  const uniqueDates   = [...new Set(scoreDateRows.map((r) => r.date as string))];
  const unmeasuredDates = uniqueDates.filter((d) => !measuredSet.has(d));

  console.log(
    `[rank-ic] ${unmeasuredDates.length} dates to measure ` +
    `(${uniqueDates.length} available, ${measuredSet.size} already measured)`
  );

  let computed = 0;
  let skipped  = 0;

  for (const dateStr of unmeasuredDates) {
    const result = await computeIcForDate(dateStr);
    if (result) {
      computed++;
      const shadowIc = await computeShadowIcForDate(dateStr);
      if (shadowIc !== null) {
        await supabase
          .from("rank_ic_history")
          .update({ rank_ic_shadow: shadowIc })
          .eq("measurement_date", dateStr);
      }
      const status = result.rank_ic > MDIC ? "ABOVE MDIC" : result.rank_ic > 0 ? "positive" : "negative";
      const shadowStr = shadowIc !== null ? ` shadow=${shadowIc.toFixed(4)}` : "";
      console.log(
        `[rank-ic] ${dateStr}: IC=${result.rank_ic.toFixed(4)} ` +
        `p=${result.p_value.toFixed(4)} n=${result.cohort_size} ess=${result.effective_sample_size}${shadowStr} [${status}]`
      );
    } else {
      skipped++;
    }
  }

  // Gate summary after 30+ measurements
  if (computed + measuredSet.size >= 30) {
    const { data: recent } = await supabase
      .from("rank_ic_history")
      .select("rank_ic, p_value")
      .order("measurement_date", { ascending: false })
      .limit(30);

    if (recent && recent.length >= 30) {
      const sorted30 = [...recent].map((r) => r.rank_ic ?? 0).sort((a, b) => a - b);
      const median = sorted30[Math.floor(sorted30.length / 2)];
      const aboveMdic = recent.filter((r) => (r.rank_ic ?? 0) > MDIC && (r.p_value ?? 1) < 0.05).length;
      console.log(`[rank-ic] Phase 1 gate check: median IC=${median.toFixed(4)}, ${aboveMdic}/30 above MDIC with p<0.05`);
      if (aboveMdic < 15) {
        console.warn("[rank-ic] WARNING: Phase 1 kill criterion approaching. Less than 50% of recent IC measurements above MDIC.");
      }

      const { data: shadowHistory } = await supabase
        .from("rank_ic_history")
        .select("rank_ic_shadow")
        .not("rank_ic_shadow", "is", null)
        .order("measurement_date", { ascending: false })
        .limit(30);

      if (shadowHistory && shadowHistory.length >= 10) {
        const shadowVals = shadowHistory.map((r) => r.rank_ic_shadow ?? 0).sort((a, b) => a - b);
        const shadowMedian = shadowVals[Math.floor(shadowVals.length / 2)];
        console.log(`[rank-ic] Shadow IC (V2 formula): median=${shadowMedian.toFixed(4)} over ${shadowHistory.length} measurements`);
        if (shadowMedian >= median - 0.02) {
          console.log(`[rank-ic] V2 shadow IC within cutover band (shadow=${shadowMedian.toFixed(4)} V1=${median.toFixed(4)}). Gate: PASS`);
        } else {
          console.warn(`[rank-ic] V2 shadow IC below cutover floor (shadow=${shadowMedian.toFixed(4)} V1=${median.toFixed(4)} floor=${(median - 0.02).toFixed(4)}). Gate: FAIL`);
        }
      }
    }
  }

  console.log(`[rank-ic] done. computed=${computed} skipped=${skipped}`);

  // Weekly OOCV vs in-cohort recipe base-rate comparison.
  // Runs every time rank-ic.ts fires (daily at 02:00 UTC).
  await computeWeeklyRecipeBaseRates();
}

main().catch((err) => {
  console.error("[rank-ic] Fatal:", err);
  process.exit(1);
});
