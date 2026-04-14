// app/api/deep-dive/route.ts
// Serves single-token deep dive data: candles, funding, OI, cohort exposure.

import { NextRequest, NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { createClient } from "@supabase/supabase-js";
import {
  fetchCandleSnapshot,
  fetchMetaAndAssetCtxs,
  fetchFundingHistory,
  buildAssetCtxMap,
} from "@/lib/hyperliquid-api-client";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "@/lib/env";
import type { CohortCachePayload } from "@/app/api/refresh-cohort/route";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

export async function GET(req: NextRequest): Promise<NextResponse> {
  const coin     = (req.nextUrl.searchParams.get("coin") ?? "BTC").toUpperCase();
  const interval = req.nextUrl.searchParams.get("interval") ?? "1h";

  const cacheKey = `deep-dive:${coin}:${interval}`;
  const cached   = await kv.get<string>(cacheKey);
  if (cached) {
    const parsed = typeof cached === "string" ? JSON.parse(cached) : cached;
    return NextResponse.json(parsed);
  }

  try {
    const endTime    = Date.now();
    const windowMap: Record<string, number> = {
      "5m": 6 * 60 * 60 * 1000,   // 6h of 5m candles
      "15m": 24 * 60 * 60 * 1000, // 24h of 15m candles
      "1h": 7 * 24 * 60 * 60 * 1000,
      "4h": 30 * 24 * 60 * 60 * 1000,
      "1d": 90 * 24 * 60 * 60 * 1000,
    };
    const startTime = endTime - (windowMap[interval] ?? 7 * 24 * 60 * 60 * 1000);

    const [candles, metaAndCtxs, fundingHistory] = await Promise.all([
      fetchCandleSnapshot(coin, interval, startTime, endTime),
      fetchMetaAndAssetCtxs(),
      fetchFundingHistory(coin, Date.now() - 7 * 24 * 60 * 60 * 1000),
    ]);

    const assetCtxMap = buildAssetCtxMap(metaAndCtxs);
    const ctx = assetCtxMap.get(coin) ?? null;

    // Compute real cohort exposure for this coin from the latest Supabase snapshots.
    // This reads actual position data, not signal metadata (which is unreliable for this).
    let cohortExposure: { net_notional: number; wallet_count: number; direction: string } | null = null;
    try {
      const cohortRaw = await kv.get<string>("cohort:active");
      if (cohortRaw) {
        const cohort: CohortCachePayload =
          typeof cohortRaw === "string" ? JSON.parse(cohortRaw) : cohortRaw;
        const walletIds = cohort.top_wallets.map((w) => w.wallet_id);

        if (walletIds.length > 0) {
          const { data: snaps } = await supabase
            .from("cohort_snapshots")
            .select("wallet_id, positions")
            .in("wallet_id", walletIds)
            .order("snapshot_time", { ascending: false })
            .limit(walletIds.length * 2);

          const seenWallets = new Set<string>();
          let netNotional = 0;
          let walletCount = 0;

          for (const snap of snaps ?? []) {
            if (seenWallets.has(snap.wallet_id)) continue;
            seenWallets.add(snap.wallet_id);
            const positions = snap.positions as Array<{ position: { coin: string; szi: string; positionValue: string } }> ?? [];
            const pos = positions.find((p) => p.position.coin === coin);
            if (!pos) continue;
            const szi = parseFloat(pos.position.szi ?? "0");
            const val = parseFloat(pos.position.positionValue ?? "0");
            netNotional += szi > 0 ? val : -val;
            walletCount++;
          }

          if (walletCount > 0) {
            cohortExposure = {
              net_notional: netNotional,
              wallet_count: walletCount,
              direction:    netNotional > 0 ? "LONG" : netNotional < 0 ? "SHORT" : "FLAT",
            };
          }
        }
      }
    } catch {
      // Non-fatal: cohort exposure is supplemental data
    }

    const result = {
      coin,
      candles: candles.slice(-200), // cap at 200 candles for payload size
      ctx: ctx ? {
        funding:     ctx.funding,
        openInterest: ctx.openInterest,
        markPx:      ctx.markPx,
        dayNtlVlm:   ctx.dayNtlVlm,
        prevDayPx:   ctx.prevDayPx,
      } : null,
      fundingHistory: fundingHistory.slice(-48).map((f) => ({
        time:        f.time,
        fundingRate: f.fundingRate,
      })),
      cohortExposure,
    };

    await kv.set(cacheKey, JSON.stringify(result), { ex: 60 });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
