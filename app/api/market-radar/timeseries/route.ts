// app/api/market-radar/timeseries/route.ts
// Coinglass-style price (Y) x time (X) liquidation density heatmap.
// Queries cohort_snapshots for the last N hours, carry-forwards each wallet's
// last-known liq level into every subsequent bin until a newer snapshot arrives,
// and overlays historical OHLC candles from Hyperliquid.

import { NextRequest, NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, HYPERLIQUID_API_URL } from "@/lib/env";
import { fetchAllMids } from "@/lib/hyperliquid-api-client";
import type { HlAssetPosition } from "@/lib/hyperliquid-api-client";
import {
  bucketTimeseries,
  RANGE_PCT,
  type OhlcCandle,
  type TimeseriesResponse,
  type TimeseriesSample,
} from "@/lib/radar-utils";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CACHE_TTL     = 180;
const DEFAULT_HOURS = 72;
const DEFAULT_BIN   = 30;

async function fetchCandles(asset: string, startMs: number, endMs: number): Promise<OhlcCandle[]> {
  try {
    const res = await fetch(HYPERLIQUID_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "candleSnapshot",
        req: { coin: asset, interval: "1h", startTime: startMs, endTime: endMs },
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const raw = await res.json() as Array<{ t: number; o: string; h: string; l: string; c: string }>;
    return raw.map((c) => ({
      t: c.t,
      o: parseFloat(c.o),
      h: parseFloat(c.h),
      l: parseFloat(c.l),
      c: parseFloat(c.c),
    }));
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const asset = req.nextUrl.searchParams.get("asset");
  const tier  = req.nextUrl.searchParams.get("tier")  ?? "all";
  const hours = Math.min(168, Math.max(6,  parseInt(req.nextUrl.searchParams.get("hours") ?? "", 10) || DEFAULT_HOURS));
  const binM  = Math.min(120, Math.max(5,  parseInt(req.nextUrl.searchParams.get("bin")   ?? "", 10) || DEFAULT_BIN));

  if (!asset) {
    return NextResponse.json({ error: "asset is required" }, { status: 400 });
  }

  const cacheKey = `market-radar:ts2:${asset}:${tier}:${hours}h:${binM}m`;
  const cached = await kv.get<string>(cacheKey);
  if (cached) {
    const parsed = typeof cached === "string" ? JSON.parse(cached) : cached;
    return NextResponse.json(parsed);
  }

  try {
    const nowMs = Date.now();
    const sinceMs = nowMs - hours * 3600 * 1000;
    const since = new Date(sinceMs).toISOString();

    let query = supabase
      .from("cohort_snapshots")
      .select("wallet_id, equity_tier, positions, snapshot_time")
      .gte("snapshot_time", since)
      .order("snapshot_time", { ascending: false })
      .limit(20000);
    if (tier !== "all") query = query.eq("equity_tier", tier);

    const [{ data, error }, mids, candles] = await Promise.all([
      query,
      fetchAllMids(),
      fetchCandles(asset, sinceMs, nowMs),
    ]);

    if (error) throw new Error(error.message);
    const snaps = (data ?? []) as Array<{
      wallet_id:    string;
      equity_tier:  string | null;
      positions:    HlAssetPosition[];
      snapshot_time:string;
    }>;

    const midPx = parseFloat(mids[asset] ?? "0");

    const samples: TimeseriesSample[] = [];
    for (const snap of snaps) {
      const t = new Date(snap.snapshot_time).getTime();
      for (const ap of snap.positions ?? []) {
        if (ap.position.coin !== asset) continue;
        const szi           = parseFloat(ap.position.szi);
        const positionValue = parseFloat(ap.position.positionValue);
        const liquidationPx = ap.position.liquidationPx != null
          ? parseFloat(ap.position.liquidationPx)
          : null;
        if (!Number.isFinite(szi) || !Number.isFinite(positionValue)) continue;
        samples.push({ t, wallet_id: snap.wallet_id, szi, liquidationPx, positionValue });
      }
    }

    const binCount = Math.floor((hours * 60) / binM);
    const bins = bucketTimeseries(samples, midPx, binM, binCount, nowMs);

    const response: TimeseriesResponse = {
      asset,
      current_price: midPx,
      price_range: {
        min: midPx * (1 - RANGE_PCT),
        max: midPx * (1 + RANGE_PCT),
      },
      bin_minutes: binM,
      bins,
      candles,
    };

    await kv.set(cacheKey, JSON.stringify(response), { ex: CACHE_TTL });
    return NextResponse.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
