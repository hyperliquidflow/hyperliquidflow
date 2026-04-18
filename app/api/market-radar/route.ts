// app/api/market-radar/route.ts
// Returns bucketed cohort position density + liquidation density for a given
// asset, spanning +/- 30% of current price. Caches per-asset, per-tier in KV.

import { NextRequest, NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "@/lib/env";
import { fetchAllMids } from "@/lib/hyperliquid-api-client";
import type { HlAssetPosition } from "@/lib/hyperliquid-api-client";
import {
  bucketPositions,
  aggregateTopAssets,
  computeRadarStats,
  RANGE_PCT,
  type RadarPosition,
  type RadarResponse,
} from "@/lib/radar-utils";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CACHE_TTL = 120; // seconds
const TOP_ASSETS_KEY = "market-radar:top-assets";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const asset = req.nextUrl.searchParams.get("asset");
  const tier  = req.nextUrl.searchParams.get("tier") ?? "all";

  if (!asset) {
    return NextResponse.json({ error: "asset is required" }, { status: 400 });
  }

  const cacheKey = `market-radar:${asset}:${tier}`;
  const cached = await kv.get<string>(cacheKey);
  if (cached) {
    const parsed = typeof cached === "string" ? JSON.parse(cached) : cached;
    return NextResponse.json(parsed);
  }

  try {
    // Retention keeps ~2 snapshots per wallet, so fetching the most recent ~2500
    // rows covers the full active cohort. Avoids a 1200-entry .in() URL that
    // exceeds PostgREST's request-line limit.
    let query = supabase
      .from("cohort_snapshots")
      .select("wallet_id, equity_tier, positions, snapshot_time")
      .order("snapshot_time", { ascending: false })
      .limit(2500);
    if (tier !== "all") query = query.eq("equity_tier", tier);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const snapshots = (data ?? []) as Array<{
      wallet_id:    string;
      equity_tier:  string | null;
      positions:    HlAssetPosition[];
      snapshot_time:string;
    }>;

    const latestByWallet = new Map<string, typeof snapshots[number]>();
    for (const s of snapshots) {
      if (!latestByWallet.has(s.wallet_id)) latestByWallet.set(s.wallet_id, s);
    }
    const latest = [...latestByWallet.values()];

    // Price from live mids
    const mids = await fetchAllMids();
    const midPx = parseFloat(mids[asset] ?? "0");

    // Flatten + filter to the selected asset
    const assetPositions: RadarPosition[] = [];
    for (const snap of latest) {
      for (const ap of snap.positions ?? []) {
        if (ap.position.coin !== asset) continue;
        const szi           = parseFloat(ap.position.szi);
        const entryPx       = parseFloat(ap.position.entryPx);
        const positionValue = parseFloat(ap.position.positionValue);
        const liquidationPx = ap.position.liquidationPx != null
          ? parseFloat(ap.position.liquidationPx)
          : null;
        if (!Number.isFinite(szi) || !Number.isFinite(entryPx) || !Number.isFinite(positionValue)) continue;
        assetPositions.push({ szi, entryPx, positionValue, liquidationPx });
      }
    }

    const buckets = bucketPositions(assetPositions, midPx);
    const stats   = computeRadarStats(assetPositions);

    // Top assets: compute once from the same data. Tier-agnostic pool is ideal,
    // but the tier-filtered latest is acceptable: if a user filters to Elite and
    // the dropdown narrows accordingly, that is intuitive.
    const walletsForTopAssets = latest.map((s) => ({ positions: s.positions ?? [] }));
    const topAssets = aggregateTopAssets(walletsForTopAssets, 10);

    // Write a shared top-assets cache only when unfiltered.
    if (tier === "all") {
      await kv.set(TOP_ASSETS_KEY, JSON.stringify(topAssets), { ex: CACHE_TTL });
    }

    const response: RadarResponse = {
      asset,
      current_price: midPx,
      price_range: {
        min: midPx * (1 - RANGE_PCT),
        max: midPx * (1 + RANGE_PCT),
      },
      buckets,
      stats,
      top_assets: topAssets,
    };

    await kv.set(cacheKey, JSON.stringify(response), { ex: CACHE_TTL });
    return NextResponse.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
