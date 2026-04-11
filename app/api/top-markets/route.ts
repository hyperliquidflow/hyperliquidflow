// app/api/top-markets/route.ts
// Returns top N coins sorted by 24h notional volume.

import { NextRequest, NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { fetchMetaAndAssetCtxs, buildAssetCtxMap } from "@/lib/hyperliquid-api-client";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const n = parseInt(req.nextUrl.searchParams.get("n") ?? "12");

  const cacheKey = `top-markets:${n}`;
  const cached = await kv.get<string>(cacheKey);
  if (cached) {
    const parsed = typeof cached === "string" ? JSON.parse(cached) : cached;
    return NextResponse.json(parsed);
  }

  try {
    const metaAndCtxs = await fetchMetaAndAssetCtxs();
    const assetCtxMap = buildAssetCtxMap(metaAndCtxs);

    const ranked = Array.from(assetCtxMap.entries())
      .map(([name, ctx]) => ({ name, volume: parseFloat(ctx.dayNtlVlm ?? "0") }))
      .sort((a, b) => b.volume - a.volume)
      .slice(0, n)
      .map((x) => x.name);

    await kv.set(cacheKey, JSON.stringify(ranked), { ex: 300 }); // cache 5 min
    return NextResponse.json(ranked);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
