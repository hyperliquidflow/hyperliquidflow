// app/api/market-ticker/route.ts
// Returns price + 24h change + real sparkline (12 x 2h closes) for 6 coins:
// BTC, ETH, SOL, HYPE, XMR + highest-volume market outside the 5 pinned.

import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import {
  fetchMetaAndAssetCtxs,
  buildAssetCtxMap,
  fetchCandleSnapshot,
} from "@/lib/hyperliquid-api-client";

const PINNED = ["BTC", "ETH", "SOL", "HYPE", "XMR"];
const CACHE_KEY = "market-ticker:v4";
const CACHE_TTL = 300; // 5 min

export interface MarketTickerEntry {
  coin:      string;
  price:     number;
  change24h: number;   // decimal, e.g. 0.0234 = +2.34%
  sparkline: number[]; // normalized close prices 0 to 1, oldest to newest (12 pts)
}

async function getSparkline(coin: string): Promise<number[]> {
  try {
    const now      = Date.now();
    const start24h = now - 24 * 60 * 60 * 1000;
    const candles  = await fetchCandleSnapshot(coin, "2h", start24h, now);
    const closes   = candles.slice(-12).map((c) => parseFloat(c.c));
    if (closes.length < 2) return [];
    const min   = Math.min(...closes);
    const max   = Math.max(...closes);
    const range = max - min || 1;
    return closes.map((p) => (p - min) / range);
  } catch {
    return [];
  }
}

export async function GET(): Promise<NextResponse> {
  const cached = await kv.get<MarketTickerEntry[]>(CACHE_KEY);
  if (cached) return NextResponse.json(cached);

  try {
    const metaAndCtxs = await fetchMetaAndAssetCtxs();
    const map = buildAssetCtxMap(metaAndCtxs);

    // Find highest-volume coin outside PINNED
    const topVolCoin = Array.from(map.entries())
      .filter(([name]) => !PINNED.includes(name))
      .sort((a, b) => parseFloat(b[1].dayNtlVlm ?? "0") - parseFloat(a[1].dayNtlVlm ?? "0"))[0]?.[0];

    const coins = topVolCoin ? [...PINNED, topVolCoin] : PINNED;

    // Fetch price info + sparklines in parallel
    const entries = await Promise.all(
      coins.map(async (coin): Promise<MarketTickerEntry | null> => {
        const ctx = map.get(coin);
        if (!ctx) return null;
        const price     = parseFloat(ctx.markPx);
        const prevDay   = parseFloat(ctx.prevDayPx);
        const change24h = prevDay > 0 ? (price - prevDay) / prevDay : 0;
        const sparkline = await getSparkline(coin);
        return { coin, price, change24h, sparkline };
      })
    );

    const ticker = entries.filter((e): e is MarketTickerEntry => e !== null);
    await kv.set(CACHE_KEY, ticker, { ex: CACHE_TTL });
    return NextResponse.json(ticker);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
