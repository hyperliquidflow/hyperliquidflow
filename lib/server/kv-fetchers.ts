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
  last_snapshot_at: string | null;
  discovery_source: string | null;
  top_win_rates: Array<{ address: string; win_rate: number; trade_count_30d: number; realized_pnl_30d: number }>;
  scan_pipeline: Array<{ step: string; status: "ok" | "warn" | "error"; detail: string }>;
  tier_breakdown: Array<{ tier: string; count: number }>;
}

const HOUR_MS = 60 * 60 * 1000;

function ageHours(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Date.now() - ms) / HOUR_MS;
}

/** "4 hours ago" style phrasing for pipeline detail lines. */
function agePhrase(hours: number): string {
  if (hours < 1)  return `${Math.round(hours * 60)} minutes ago`;
  if (hours < 48) return `${Math.round(hours)} hours ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/**
 * Pipeline health computed from the newest scan, the newest position snapshot
 * and the live wallet counts. These five rows used to be hardcoded strings with
 * two permanent "ok" statuses, which reported a healthy pipeline for months
 * while nothing ran (audit 2026-08-08).
 */
function buildScanPipeline(args: {
  discovered: number;
  active: number;
  scored: number;
  lastScanAt: string | null;
  lastSnapshotAt: string | null;
}): ScannerStats["scan_pipeline"] {
  const { discovered, active, scored, lastScanAt, lastSnapshotAt } = args;
  const scanAge = ageHours(lastScanAt);
  const snapAge = ageHours(lastSnapshotAt);

  const scanStatus: "ok" | "warn" | "error" =
    scanAge == null ? "error" : scanAge <= 36 ? "ok" : scanAge <= 72 ? "warn" : "error";

  const snapStatus: "ok" | "warn" | "error" =
    snapAge == null ? "error" : snapAge <= 0.25 ? "ok" : snapAge <= 1 ? "warn" : "error";

  return [
    {
      step:   "Wallet discovery",
      status: discovered > 4 ? scanStatus : "error",
      detail: discovered > 4
        ? `${discovered.toLocaleString("en-US")} candidate wallets on file. Last search ${scanAge == null ? "never completed" : agePhrase(scanAge)}.`
        : "Only the starter wallets are on file. The daily search has not completed yet.",
    },
    {
      step:   "Trade history review",
      status: scored > 0 ? scanStatus : "error",
      detail: scored > 0
        ? `${scored.toLocaleString("en-US")} wallets have a scored trade record.`
        : "No wallet has been scored yet.",
    },
    {
      step:   "Cohort selection",
      status: active >= 4 ? "ok" : "error",
      detail: active >= 4
        ? `${active.toLocaleString("en-US")} wallets passed the quality checks and are being tracked.`
        : `Only ${active} wallets passed the quality checks, below the minimum of 4.`,
    },
    {
      step:   "Position tracking",
      status: snapStatus,
      detail: snapAge == null
        ? "No positions have been recorded yet."
        : `Positions last recorded ${agePhrase(snapAge)}.`,
    },
  ];
}

export async function fetchScannerStats(): Promise<ScannerStats | null> {
  try {
    // Counts come from exact count queries, never from a fetched page. Selecting
    // every wallet row and counting in memory silently truncated at PostgREST's
    // row cap, so a 39k-row table reported a few thousand discovered and a
    // fraction of the real active count.
    const [
      discoveredCount, activeCount, scoredCount,
      activeWallets, topWinRates, newestSnapshot, newestScan,
    ] = await Promise.all([
      supabase.from("wallets").select("id", { count: "exact", head: true }),
      supabase.from("wallets").select("id", { count: "exact", head: true }).eq("is_active", true),
      supabase.from("wallets").select("id", { count: "exact", head: true }).not("win_rate", "is", null),
      // The active cohort is bounded (hundreds), so this page is safe to fetch.
      supabase.from("wallets").select("id, win_rate").eq("is_active", true),
      supabase.from("wallets").select("address, win_rate, trade_count_30d, realized_pnl_30d")
        .not("win_rate", "is", null)
        .order("win_rate", { ascending: false })
        .limit(20),
      supabase.from("cohort_snapshots").select("snapshot_time")
        .order("snapshot_time", { ascending: false })
        .limit(1),
      supabase.from("wallets").select("last_scanned_at, discovery_source")
        .not("last_scanned_at", "is", null)
        .order("last_scanned_at", { ascending: false })
        .limit(1),
    ]);

    const discovered = discoveredCount.count ?? 0;
    const active     = activeWallets.data ?? [];
    const activeTotal = activeCount.count ?? active.length;
    const inactiveTotal = Math.max(0, discovered - activeTotal);

    const activeIds = active.map((w) => w.id).filter(Boolean);
    const tierSnaps = activeIds.length > 0
      ? await supabase.from("cohort_snapshots")
          .select("wallet_id, equity_tier, snapshot_time")
          .in("wallet_id", activeIds)
          .not("equity_tier", "is", null)
          .order("snapshot_time", { ascending: false })
          .limit(activeIds.length * 2)
      : { data: [] };
    const avgWinRate = active.length > 0
      ? active.reduce((s, w) => s + (w.win_rate ?? 0), 0) / active.length : 0;
    const lastScan = newestScan.data?.[0]?.last_scanned_at ?? null;
    const lastSnapshot = newestSnapshot.data?.[0]?.snapshot_time ?? null;
    const source = newestScan.data?.[0]?.discovery_source ?? null;
    const pipeline = buildScanPipeline({
      discovered:     discovered,
      active:         activeTotal,
      scored:         scoredCount.count ?? 0,
      lastScanAt:     lastScan,
      lastSnapshotAt: lastSnapshot,
    });
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
      total_discovered: discovered, total_active: activeTotal, total_inactive: inactiveTotal,
      avg_win_rate: avgWinRate, last_scan_at: lastScan, last_snapshot_at: lastSnapshot,
      discovery_source: source,
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
