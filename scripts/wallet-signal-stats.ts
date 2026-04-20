#!/usr/bin/env npx tsx
// scripts/wallet-signal-stats.ts
// Nightly script (run after signal-learning.ts) that populates:
//   recipe_calibration  -- recipe-level win rates + avg bps for the 70% EV base rate
//   wallet_signal_stats -- per-wallet per-recipe net win rates for the 30% EV adjustment
//
// Both tables are consumed by lib/signal-lab.ts enrichWithEv() to break the
// circular scoring where wallet.win_rate drove both the cohort rank and the
// EV score on that wallet's signals.
//
// Source: signal_outcomes WHERE resolved_at IS NOT NULL AND net_pnl_bps IS NOT NULL
// in the last 30 days.  Joined to signals_history for wallet_ids.
//
// Called by .github/workflows/signal-learning.yml after signal-learning.ts.

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs/promises";

const SUPABASE_URL              = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("FATAL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const WINDOW_DAYS        = 30;
const MIN_SAMPLE_RECIPE  = 10;  // min resolved outcomes before recipe calibration is trusted
const MIN_SAMPLE_WALLET  = 5;   // min resolved outcomes per wallet-recipe pair

// ── Wilson 95% CI on a win rate ───────────────────────────────────────────────
function wilsonCI(wins: number, n: number): [number, number] {
  if (n === 0) return [0, 1];
  const z  = 1.96;
  const p  = wins / n;
  const d  = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / d;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

async function main(): Promise<void> {
  const startMs = Date.now();
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();

  // ── Step 1: Fetch resolved signal outcomes in the last WINDOW_DAYS ───────────
  const { data: outcomes, error: outErr } = await supabase
    .from("signal_outcomes")
    .select("signal_id, recipe_id, net_pnl_bps, is_win, resolved_at")
    .not("resolved_at", "is", null)
    .not("net_pnl_bps", "is", null)
    .gte("resolved_at", since);

  if (outErr) {
    console.error("[wallet-signal-stats] signal_outcomes fetch error:", outErr.message);
    process.exit(1);
  }

  if (!outcomes || outcomes.length === 0) {
    console.log("[wallet-signal-stats] no resolved outcomes in last 30d, skipping");
    await fs.writeFile("wallet-signal-stats-summary.json", JSON.stringify({ resolved: 0, recipes: 0, wallets: 0 }, null, 2));
    return;
  }

  console.log(`[wallet-signal-stats] ${outcomes.length} resolved outcomes in last 30d`);

  // ── Step 2: Fetch signals_history for wallet_ids lookup ──────────────────────
  const signalIds = [...new Set(outcomes.map((o) => o.signal_id as string))];
  const walletIdsBySigId = new Map<string, string[]>();

  const CHUNK = 200;
  for (let i = 0; i < signalIds.length; i += CHUNK) {
    const { data: sigRows, error: sigErr } = await supabase
      .from("signals_history")
      .select("id, wallet_id")
      .in("id", signalIds.slice(i, i + CHUNK));
    if (sigErr) {
      console.warn("[wallet-signal-stats] signals_history fetch error:", sigErr.message);
      continue;
    }
    for (const row of sigRows ?? []) {
      const wid = row.wallet_id as string | null;
      walletIdsBySigId.set(row.id as string, wid ? [wid] : []);
    }
  }

  // ── Step 3: Compute recipe_calibration aggregates ────────────────────────────
  type RecipeStats = {
    wins: number;
    total: number;
    winBpsSum: number;
    lossBpsSum: number;
  };
  const recipeStatsMap = new Map<string, RecipeStats>();

  for (const o of outcomes) {
    const recipe = o.recipe_id as string;
    if (!recipeStatsMap.has(recipe)) {
      recipeStatsMap.set(recipe, { wins: 0, total: 0, winBpsSum: 0, lossBpsSum: 0 });
    }
    const rs = recipeStatsMap.get(recipe)!;
    rs.total++;
    const bps = Number(o.net_pnl_bps ?? 0);
    if (o.is_win) {
      rs.wins++;
      rs.winBpsSum += bps;
    } else {
      rs.lossBpsSum += Math.abs(bps);
    }
  }

  const recipeCalibrationRows = [];
  for (const [recipe_id, rs] of recipeStatsMap) {
    if (rs.total < MIN_SAMPLE_RECIPE) continue;
    const win_rate   = rs.wins / rs.total;
    const [ci_low, ci_high] = wilsonCI(rs.wins, rs.total);
    const avg_win_bps  = rs.wins > 0 ? rs.winBpsSum / rs.wins : 0;
    const lossSamples  = rs.total - rs.wins;
    const avg_loss_bps = lossSamples > 0 ? rs.lossBpsSum / lossSamples : 0;

    recipeCalibrationRows.push({
      recipe_id,
      win_rate,
      avg_win_bps,
      avg_loss_bps:            -avg_loss_bps, // store as signed negative
      sample_size_30d:         rs.total,
      confidence_interval_low:  ci_low,
      confidence_interval_high: ci_high,
      source:                  "in_cohort",
      updated_at:              new Date().toISOString(),
    });
  }

  if (recipeCalibrationRows.length > 0) {
    const { error } = await supabase
      .from("recipe_calibration")
      .upsert(recipeCalibrationRows, { onConflict: "recipe_id" });
    if (error) console.error("[wallet-signal-stats] recipe_calibration upsert error:", error.message);
    else console.log(`[wallet-signal-stats] upserted ${recipeCalibrationRows.length} recipe_calibration rows`);
  }

  // ── Step 4: Compute per-wallet per-recipe stats ───────────────────────────────
  // Walk outcomes, look up wallet_ids from signals_history, accumulate stats.
  type WalletRecipeKey = string; // `${wallet_id}:${recipe_id}`
  type WalletRecipeStats = { wins: number; total: number };
  const walletRecipeMap = new Map<WalletRecipeKey, WalletRecipeStats>();

  for (const o of outcomes) {
    const walletIds = walletIdsBySigId.get(o.signal_id as string) ?? [];
    const recipe    = o.recipe_id as string;
    for (const walletId of walletIds) {
      const key = `${walletId}:${recipe}`;
      if (!walletRecipeMap.has(key)) walletRecipeMap.set(key, { wins: 0, total: 0 });
      const ws = walletRecipeMap.get(key)!;
      ws.total++;
      if (o.is_win) ws.wins++;
    }
  }

  // ── Step 5: Resolve wallet_id -> address ─────────────────────────────────────
  const allWalletIds = [...new Set(
    [...walletRecipeMap.keys()].map((k) => k.split(":")[0])
  )];
  const idToAddress = new Map<string, string>();

  for (let i = 0; i < allWalletIds.length; i += CHUNK) {
    const { data: walletRows } = await supabase
      .from("wallets")
      .select("id, address")
      .in("id", allWalletIds.slice(i, i + CHUNK));
    for (const w of walletRows ?? []) {
      idToAddress.set(w.id as string, w.address as string);
    }
  }

  // ── Step 6: Build and upsert wallet_signal_stats ─────────────────────────────
  const walletStatRows = [];
  const now = new Date().toISOString();

  for (const [key, ws] of walletRecipeMap) {
    if (ws.total < MIN_SAMPLE_WALLET) continue;
    const [walletId, recipe_id] = key.split(":");
    const address = idToAddress.get(walletId);
    if (!address) continue;

    walletStatRows.push({
      wallet_address: address,
      recipe_id,
      window_days:    WINDOW_DAYS,
      win_rate_net:   ws.wins / ws.total,
      signal_count:   ws.total,
      updated_at:     now,
    });
  }

  let walletRowsWritten = 0;
  for (let i = 0; i < walletStatRows.length; i += CHUNK) {
    const { error } = await supabase
      .from("wallet_signal_stats")
      .upsert(walletStatRows.slice(i, i + CHUNK), {
        onConflict: "wallet_address,recipe_id,window_days",
      });
    if (error) console.error("[wallet-signal-stats] wallet_signal_stats upsert error:", error.message);
    else walletRowsWritten += Math.min(CHUNK, walletStatRows.length - i);
  }

  console.log(`[wallet-signal-stats] upserted ${walletRowsWritten} wallet_signal_stats rows`);

  const summary = {
    resolved_outcomes:     outcomes.length,
    recipes_calibrated:    recipeCalibrationRows.length,
    wallet_recipe_pairs:   walletStatRows.length,
    duration_ms:           Date.now() - startMs,
  };
  console.log("[wallet-signal-stats] done:", JSON.stringify(summary));
  await fs.writeFile("wallet-signal-stats-summary.json", JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error("[wallet-signal-stats] Fatal:", err);
  process.exit(1);
});
