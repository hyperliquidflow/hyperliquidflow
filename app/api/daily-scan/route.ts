// app/api/daily-scan/route.ts
// Serves the daily alpha scan. Generated once per day by GitHub Actions
// and cached in Supabase. This endpoint reads from KV (fast) or builds on demand.

import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "@/lib/env";
import type { CohortCachePayload } from "@/app/api/refresh-cohort/route";
import { truncateAddress } from "@/lib/utils";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const KV_KEY   = "daily:scan";
const KV_TTL   = 3600; // cache for 1 hour

const RECIPE_LABELS: Record<string, string> = {
  momentum_stack:       "Whale Convergence",
  divergence_squeeze:   "Silent Loading",
  accumulation_reentry: "Dip Conviction",
  rotation_carry:       "Funded Edge",
  liq_rebound:          "Liquidation Flush",
  streak_continuation:  "Hot Streak",
  funding_divergence:   "Smart Money vs. Retail",
  whale_validated:      "Alpha Confirmation",
  anti_whale_trap:      "Smart Exit Signal",
};

export async function GET(): Promise<NextResponse> {
  // Try KV cache first
  const cached = await kv.get<string>(KV_KEY);
  if (cached) {
    const parsed = typeof cached === "string" ? JSON.parse(cached) : cached;
    return NextResponse.json(parsed);
  }

  try {
    // Load cohort from KV
    const cohortRaw = await kv.get<string>("cohort:active");
    const cohort: CohortCachePayload | null = cohortRaw
      ? (typeof cohortRaw === "string" ? JSON.parse(cohortRaw) : cohortRaw)
      : null;

    // Load last 24h signals from Supabase
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: signals } = await supabase
      .from("signals_history")
      .select("recipe_id, coin, direction, ev_score, detected_at")
      .gte("detected_at", since24h)
      .order("ev_score", { ascending: false })
      .limit(20);

    // Load top wallets
    const { data: topWallets } = await supabase
      .from("wallets")
      .select("address, win_rate, realized_pnl_30d")
      .eq("is_active", true)
      .order("win_rate", { ascending: false })
      .limit(5);

    // Extract top movers (coins with most signal activity)
    const coinActivity: Record<string, { count: number; direction: string; notional: number }> = {};
    for (const s of signals ?? []) {
      if (!coinActivity[s.coin]) coinActivity[s.coin] = { count: 0, direction: s.direction ?? "FLAT", notional: 0 };
      coinActivity[s.coin].count++;
    }
    const topMovers = Object.entries(coinActivity)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5)
      .map(([coin, { direction, count }]) => ({
        coin, direction,
        notional: `${count} signals`,
      }));

    // Watch list = unique coins from top signals
    const watchList = [...new Set((signals ?? []).map((s) => s.coin))].slice(0, 8);

    // Regime from cohort
    const regime = cohort?.regime ?? "RANGING";
    const btcReturn = cohort?.btc_return_24h ?? 0;

    // Summary text (rule-based, no LLM)
    const walletCount = cohort?.wallet_count ?? 0;
    const avgScore = cohort && cohort.top_wallets.length > 0
      ? cohort.top_wallets.reduce((s, w) => s + w.overall_score, 0) / cohort.top_wallets.length
      : 0;
    const inProfit = cohort?.top_wallets.filter((w) => w.unrealized_pnl > 0).length ?? 0;
    const signalCount = signals?.length ?? 0;
    const topCoin = topMovers[0]?.coin ?? "N/A";

    const summary = [
      `Market is in a ${regime} regime. BTC moved ${btcReturn >= 0 ? "+" : ""}${(btcReturn * 100).toFixed(2)}% in the last 24 hours.`,
      walletCount > 0
        ? `The smart money cohort currently has ${walletCount} active wallets with an average score of ${avgScore.toFixed(2)}.`
        : "Cohort data is pending. Daily scan may not have run yet.",
      signalCount > 0
        ? `${signalCount} signals were detected in the last 24 hours. Most activity on ${topCoin}.`
        : "No signals were detected in the last 24 hours.",
      inProfit > 0
        ? `${inProfit} of ${walletCount} wallets hold open positions in profit.`
        : "",
      watchList.length > 0
        ? `Coins to watch today: ${watchList.join(", ")}.`
        : "",
    ].filter(Boolean).join(" ");

    const scan = {
      generated_at: new Date().toISOString(),
      regime,
      btc_return_24h: btcReturn,
      top_signals: (signals ?? []).slice(0, 6).map((s) => ({
        recipe:    RECIPE_LABELS[s.recipe_id] ?? s.recipe_id,
        coin:      s.coin,
        direction: s.direction ?? "FLAT",
        ev:        s.ev_score,
      })),
      top_movers: topMovers,
      cohort_health: {
        active_wallets:    walletCount,
        avg_score:         avgScore,
        wallets_in_profit: inProfit,
      },
      top_wallets: (topWallets ?? []).map((w) => ({
        address: truncateAddress(w.address),
        score:   w.win_rate ?? 0,
        pnl:     w.realized_pnl_30d != null ? `$${(w.realized_pnl_30d / 1000).toFixed(1)}K` : "N/A",
      })),
      watch_list: watchList,
      summary,
    };

    await kv.set(KV_KEY, JSON.stringify(scan), { ex: KV_TTL });
    return NextResponse.json(scan);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
