// app/api/markets/route.ts
// Exchange-wide context for the markets index: funding, open interest and the
// 24h move, keyed by coin. The cohort side of the table comes from cohort:active
// on the client, so this route stays a thin, cacheable join of public facts.

import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { fetchMetaAndAssetCtxs, buildAssetCtxMap } from "@/lib/hyperliquid-api-client";

export interface MarketCtx {
  coin:          string;
  mark:          number;
  change24h:     number;
  funding1h:     number;   // fraction, not percent
  open_interest: number;   // notional USD
}

export interface MarketsPayload {
  markets: MarketCtx[];
}

const CACHE_KEY = "markets:ctx:v1";

export async function GET(): Promise<NextResponse> {
  try {
    const cached = await kv.get<string>(CACHE_KEY);
    if (cached) {
      return NextResponse.json(typeof cached === "string" ? JSON.parse(cached) : cached);
    }

    const map = buildAssetCtxMap(await fetchMetaAndAssetCtxs());

    const markets: MarketCtx[] = [];
    for (const [coin, ctx] of map) {
      const mark = parseFloat(ctx.markPx);
      const prev = parseFloat(ctx.prevDayPx);
      if (!Number.isFinite(mark) || mark <= 0) continue;
      markets.push({
        coin,
        mark,
        change24h:     Number.isFinite(prev) && prev > 0 ? (mark - prev) / prev : 0,
        funding1h:     parseFloat(ctx.funding) || 0,
        open_interest: (parseFloat(ctx.openInterest) || 0) * mark,
      });
    }

    const payload: MarketsPayload = { markets };
    await kv.set(CACHE_KEY, JSON.stringify(payload), { ex: 60 });
    return NextResponse.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
