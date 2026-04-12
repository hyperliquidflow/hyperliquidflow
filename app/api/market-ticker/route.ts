// app/api/market-ticker/route.ts
// Returns price + 24h change for BTC, ETH, SOL, HYPE.
// Caches in KV for 5 minutes.

import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { fetchMetaAndAssetCtxs, buildAssetCtxMap } from "@/lib/hyperliquid-api-client";

const COINS = ["BTC", "ETH", "SOL", "HYPE"];
const CACHE_KEY = "market-ticker:v1";
const CACHE_TTL = 300; // 5 min

export interface MarketTickerEntry {
  coin:       string;
  price:      number;
  change24h:  number; // decimal, e.g. 0.0234 = +2.34%
}

export async function GET(): Promise<NextResponse> {
  const cached = await kv.get<MarketTickerEntry[]>(CACHE_KEY);
  if (cached) return NextResponse.json(cached);

  try {
    const metaAndCtxs = await fetchMetaAndAssetCtxs();
    const map = buildAssetCtxMap(metaAndCtxs);

    const ticker: MarketTickerEntry[] = COINS.flatMap((coin) => {
      const ctx = map.get(coin);
      if (!ctx) return [];
      const price     = parseFloat(ctx.markPx);
      const prevDay   = parseFloat(ctx.prevDayPx);
      const change24h = prevDay > 0 ? (price - prevDay) / prevDay : 0;
      return [{ coin, price, change24h }];
    });

    await kv.set(CACHE_KEY, ticker, { ex: CACHE_TTL });
    return NextResponse.json(ticker);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
