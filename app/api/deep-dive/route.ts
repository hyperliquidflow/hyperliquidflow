// app/api/deep-dive/route.ts
// Serves single-token deep dive data: candles, funding, OI, cohort exposure.

import { NextRequest, NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import {
  fetchCandleSnapshot,
  fetchMetaAndAssetCtxs,
  fetchFundingHistory,
  buildAssetCtxMap,
} from "@/lib/hyperliquid-api-client";
import type { CohortCachePayload } from "@/app/api/refresh-cohort/route";

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

    // Get cohort exposure from KV
    let cohortExposure = null;
    const cohortRaw = await kv.get<string>("cohort:active");
    if (cohortRaw) {
      const cohort: CohortCachePayload =
        typeof cohortRaw === "string" ? JSON.parse(cohortRaw) : cohortRaw;
      // Sum net notional for this coin from recent signals
      const coinSignals = cohort.recent_signals.filter((s) => s.coin === coin);
      if (coinSignals.length > 0) {
        const lastSignal = coinSignals[0];
        cohortExposure = {
          net_notional:  lastSignal.metadata?.net_notional as number ?? 0,
          wallet_count:  lastSignal.metadata?.wallet_count  as number ?? 0,
          direction:     lastSignal.direction ?? "FLAT",
        };
      }
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
