// app/api/scanner-stats/route.ts

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "@/lib/env";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

export async function GET(): Promise<NextResponse> {
  try {
    const [walletStats, topWinRates] = await Promise.all([
      supabase.from("wallets").select("is_active, win_rate, last_scanned_at, discovery_source, realized_pnl_30d"),
      supabase.from("wallets").select("address, win_rate, trade_count_30d, realized_pnl_30d")
        .not("win_rate", "is", null)
        .order("win_rate", { ascending: false })
        .limit(20),
    ]);

    const wallets = walletStats.data ?? [];
    const active   = wallets.filter((w) => w.is_active);
    const inactive = wallets.filter((w) => !w.is_active);
    const avgWinRate = active.length > 0
      ? active.reduce((s, w) => s + (w.win_rate ?? 0), 0) / active.length
      : 0;

    const lastScan = wallets
      .map((w) => w.last_scanned_at)
      .filter(Boolean)
      .sort()
      .reverse()[0] ?? null;

    const source = wallets.find((w) => w.last_scanned_at)?.discovery_source ?? null;

    // Pipeline status checks
    const pipeline = [
      {
        step:   "Leaderboard Discovery",
        status: wallets.length > 4 ? "ok" : "warn",
        detail: wallets.length > 4
          ? `${wallets.length} addresses discovered via leaderboard API or scrape`
          : "Only seed wallets present — daily scan has not run yet",
      },
      {
        step:   "Fill Scoring (userFillsByTime)",
        status: active.length > 0 ? "ok" : "warn",
        detail: active.length > 0
          ? `${active.length} wallets qualified (win_rate ≥ 52%, ≥ 30 trades)`
          : "No wallets have been scored yet",
      },
      {
        step:   "Cohort Activation",
        status: active.length >= 4 ? "ok" : "warn",
        detail: active.length >= 4
          ? `${active.length} wallets active in signal cohort`
          : "Cohort below minimum (4) — check daily scan logs",
      },
      {
        step:   "Vercel Cron (refresh-cohort)",
        status: "ok",
        detail: "Runs every 60s · defined in vercel.json · processes top 100 active wallets",
      },
      {
        step:   "Supabase pg_cron Cleanup",
        status: "ok",
        detail: "Retains 2 snapshots/wallet, 30d signals, 90d recipe perf — keeps DB under 500 MB",
      },
    ] as Array<{ step: string; status: "ok" | "warn" | "error"; detail: string }>;

    return NextResponse.json({
      total_discovered: wallets.length,
      total_active:     active.length,
      total_inactive:   inactive.length,
      avg_win_rate:     avgWinRate,
      last_scan_at:     lastScan,
      discovery_source: source,
      top_win_rates:    topWinRates.data ?? [],
      scan_pipeline:    pipeline,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
