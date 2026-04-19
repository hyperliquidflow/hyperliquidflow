// lib/server/kv-fetchers.ts
// Server-only KV read helpers. Called from async server components so pages
// render with data on first paint — no client-side loading skeleton needed.

import { kv } from "@vercel/kv";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "@/lib/env";
import type { CohortCachePayload } from "@/app/api/refresh-cohort/route";
import type { MarketTickerEntry } from "@/app/api/market-ticker/route";
import type { RadarResponse } from "@/lib/radar-utils";
import { fetchGlobalAliases as hsGlobalAliases, type HsGlobalAliases } from "@/lib/hypurrscan-api-client";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function parse<T>(raw: unknown): T | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try { return JSON.parse(raw) as T; } catch { return null; }
  }
  return raw as T;
}

export async function fetchCohortState(): Promise<CohortCachePayload | null> {
  try {
    return parse<CohortCachePayload>(await kv.get("cohort:active"));
  } catch { return null; }
}

export async function fetchMarketTicker(): Promise<MarketTickerEntry[] | null> {
  try {
    return parse<MarketTickerEntry[]>(await kv.get("market-ticker:v4"));
  } catch { return null; }
}

export async function fetchContrarianState(): Promise<unknown> {
  try {
    return parse<unknown>(await kv.get("contrarian:latest"));
  } catch { return null; }
}

/**
 * Read a cached market-radar response from KV (no compute).
 * Returns null on miss; the client then fetches fresh via the API route.
 */
export async function fetchMarketRadar(
  asset: string,
  tier: string,
): Promise<RadarResponse | null> {
  try {
    return parse<RadarResponse>(await kv.get(`market-radar:${asset}:${tier}`));
  } catch { return null; }
}

/**
 * Read the cached top-assets list. Used by the radar page to pick a default
 * asset for first-paint prefetch. Returns null on miss.
 */
export async function fetchRadarTopAssets(): Promise<string[] | null> {
  try {
    return parse<string[]>(await kv.get("market-radar:top-assets"));
  } catch { return null; }
}

export interface RecipeStats {
  // Legacy EV-based fields — kept for fallback display
  recipe_id:      string;
  signal_count:   number;
  true_positive:  number;
  false_positive: number;
  avg_ev_score:   number | null;
  win_rate:       number | null;
  measured_at:    string;

  // Outcome-based fields — null until signal_outcomes has data
  resolved_7d:      number;
  resolved_30d:     number;
  accuracy_1h_7d:   number | null;
  accuracy_4h_7d:   number | null;
  accuracy_24h_7d:  number | null;
  avg_move_1h_7d:   number | null;
  avg_move_4h_7d:   number | null;
  avg_move_24h_7d:  number | null;
  accuracy_1h_30d:  number | null;
  accuracy_4h_30d:  number | null;
  accuracy_24h_30d: number | null;
  avg_move_1h_30d:  number | null;
  avg_move_4h_30d:  number | null;
  avg_move_24h_30d: number | null;
  top_coins_7d:     string[];
  top_coins_30d:    string[];

  // ATR-based net PnL fields (null until signal-learning.ts has simulated exits)
  median_net_pnl_bps: number | null;
  win_rate_net:       number | null;
  expectancy_bps_net: number | null;
  sample_size_60d:    number | null;
}

export const OUTCOME_DEFAULTS = {
  resolved_7d: 0, resolved_30d: 0,
  accuracy_1h_7d: null, accuracy_4h_7d: null, accuracy_24h_7d: null,
  avg_move_1h_7d: null, avg_move_4h_7d: null, avg_move_24h_7d: null,
  accuracy_1h_30d: null, accuracy_4h_30d: null, accuracy_24h_30d: null,
  avg_move_1h_30d: null, avg_move_4h_30d: null, avg_move_24h_30d: null,
  top_coins_7d: [] as string[], top_coins_30d: [] as string[],
  median_net_pnl_bps: null, win_rate_net: null, expectancy_bps_net: null, sample_size_60d: null,
} as const satisfies Omit<RecipeStats, "recipe_id"|"signal_count"|"true_positive"|"false_positive"|"avg_ev_score"|"win_rate"|"measured_at">;

export async function fetchRecipePerformance(): Promise<RecipeStats[] | null> {
  try {
    const [{ data, error }, intradayRaw] = await Promise.all([
      supabase
        .from("recipe_performance")
        .select("recipe_id, signal_count, true_positive, false_positive, avg_ev_score, win_rate, measured_at, median_net_pnl_bps, win_rate_net, expectancy_bps_net, sample_size_60d")
        .order("measured_at", { ascending: false })
        .limit(100),
      kv.get<Record<string, { avg_ev: number; count: number }>>("recipe:intraday_perf"),
    ]);
    if (error || !data) return null;
    const latest = new Map<string, RecipeStats>();
    for (const row of data) {
      if (!latest.has(row.recipe_id)) latest.set(row.recipe_id, { ...row, ...OUTCOME_DEFAULTS });
    }
    // Overlay intraday KV data on daily rows
    const result: RecipeStats[] = [...latest.values()].map((row) => {
      const intraday = intradayRaw?.[row.recipe_id];
      if (!intraday) return row;
      return { ...row, signal_count: intraday.count, avg_ev_score: intraday.avg_ev };
    });
    // Append KV-only recipes not yet in daily table
    if (intradayRaw) {
      for (const [recipe_id, { avg_ev, count }] of Object.entries(intradayRaw)) {
        if (!latest.has(recipe_id)) {
          result.push({
            recipe_id,
            signal_count: count,
            avg_ev_score: avg_ev,
            win_rate: null,
            true_positive: 0,
            false_positive: 0,
            measured_at: new Date().toISOString(),
            ...OUTCOME_DEFAULTS,
          });
        }
      }
    }
    return result;
  } catch { return null; }
}

export interface ScannerStats {
  total_discovered: number;
  total_active: number;
  total_inactive: number;
  avg_win_rate: number;
  last_scan_at: string | null;
  discovery_source: string | null;
  top_win_rates: Array<{ address: string; win_rate: number; trade_count_30d: number; realized_pnl_30d: number }>;
  scan_pipeline: Array<{ step: string; status: "ok" | "warn" | "error"; detail: string }>;
  tier_breakdown: Array<{ tier: string; count: number }>;
}

export async function fetchScannerStats(): Promise<ScannerStats | null> {
  try {
    const [walletStats, topWinRates, tierSnaps] = await Promise.all([
      supabase.from("wallets").select("is_active, win_rate, last_scanned_at, discovery_source, realized_pnl_30d"),
      supabase.from("wallets").select("address, win_rate, trade_count_30d, realized_pnl_30d")
        .not("win_rate", "is", null)
        .order("win_rate", { ascending: false })
        .limit(20),
      supabase.from("cohort_snapshots")
        .select("wallet_id, equity_tier, snapshot_time")
        .not("equity_tier", "is", null)
        .order("snapshot_time", { ascending: false })
        .limit(2000),
    ]);
    const wallets = walletStats.data ?? [];
    const active   = wallets.filter((w) => w.is_active);
    const inactive = wallets.filter((w) => !w.is_active);
    const avgWinRate = active.length > 0
      ? active.reduce((s, w) => s + (w.win_rate ?? 0), 0) / active.length : 0;
    const lastScan = wallets.map((w) => w.last_scanned_at).filter(Boolean).sort().reverse()[0] ?? null;
    const source = wallets.find((w) => w.last_scanned_at)?.discovery_source ?? null;
    const pipeline = [
      { step: "Leaderboard Discovery", status: (wallets.length > 4 ? "ok" : "warn") as "ok" | "warn",
        detail: wallets.length > 4 ? `${wallets.length} addresses discovered via leaderboard API or scrape` : "Only seed wallets present. Daily scan has not run yet." },
      { step: "Fill Scoring (userFillsByTime)", status: (active.length > 0 ? "ok" : "warn") as "ok" | "warn",
        detail: active.length > 0 ? `${active.length} wallets qualified (win_rate >= 52%, >= 30 trades)` : "No wallets have been scored yet" },
      { step: "Cohort Activation", status: (active.length >= 4 ? "ok" : "warn") as "ok" | "warn",
        detail: active.length >= 4 ? `${active.length} wallets active in signal cohort` : "Cohort below minimum (4). Check daily scan logs." },
      { step: "Vercel Cron (refresh-cohort)", status: "ok" as const,
        detail: "Runs every 60s, defined in vercel.json, processes top 100 active wallets" },
      { step: "Supabase pg_cron Cleanup", status: "ok" as const,
        detail: "Retains 2 snapshots/wallet, 30d signals, 90d recipe perf. Keeps DB under 500 MB." },
    ];
    const TIERS = ["Elite", "Major", "Large", "Mid", "Small", "Micro", "Dust"] as const;
    const latestTierByWallet = new Map<string, string>();
    for (const row of tierSnaps.data ?? []) {
      if (!latestTierByWallet.has(row.wallet_id) && row.equity_tier) {
        latestTierByWallet.set(row.wallet_id, row.equity_tier);
      }
    }
    const tierCounts: Record<string, number> = {};
    for (const t of TIERS) tierCounts[t] = 0;
    for (const t of latestTierByWallet.values()) {
      if (tierCounts[t] !== undefined) tierCounts[t]++;
    }
    const tier_breakdown = TIERS.map((t) => ({ tier: t, count: tierCounts[t] }));
    return {
      total_discovered: wallets.length, total_active: active.length, total_inactive: inactive.length,
      avg_win_rate: avgWinRate, last_scan_at: lastScan, discovery_source: source,
      top_win_rates: (topWinRates.data ?? []) as ScannerStats["top_win_rates"],
      scan_pipeline: pipeline,
      tier_breakdown,
    };
  } catch { return null; }
}

const KV_ALIASES_KEY   = "hypurrscan:global_aliases";
const KV_ALIASES_TTL_S = 24 * 3600; // 24 hours

/**
 * Return the Hypurrscan global alias map, reading from KV cache when warm.
 * On KV miss or stale data, fetches from Hypurrscan API and re-caches.
 * Weight cost: 1 (only on cache miss).
 */
export async function fetchGlobalAliasesFromKV(): Promise<HsGlobalAliases> {
  const cached = await kv.get<HsGlobalAliases>(KV_ALIASES_KEY);
  if (cached) return cached;

  const aliases = await hsGlobalAliases();
  await kv.set(KV_ALIASES_KEY, aliases, { ex: KV_ALIASES_TTL_S });
  return aliases;
}
