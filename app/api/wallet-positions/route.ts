import { NextRequest, NextResponse } from "next/server";
import { fetchClearinghouseState } from "@/lib/hyperliquid-api-client";
import type { PositionSnapshot } from "@/lib/alert-engine";

export const runtime = "nodejs";

export interface WalletPositionsResponse {
  wallets: { address: string; positions: PositionSnapshot[] }[];
}

export async function POST(req: NextRequest) {
  let addresses: string[];
  try {
    const body = await req.json() as { addresses?: unknown };
    if (!Array.isArray(body.addresses)) return NextResponse.json({ wallets: [] });
    addresses = (body.addresses as unknown[])
      .filter((a): a is string => typeof a === "string")
      .slice(0, 20);
  } catch {
    return NextResponse.json({ wallets: [] });
  }

  if (addresses.length === 0) return NextResponse.json({ wallets: [] });

  const results = await Promise.allSettled(
    addresses.map(async (address) => {
      const state = await fetchClearinghouseState(address);
      const positions: PositionSnapshot[] = state.assetPositions
        .map(({ position: p }) => ({
          coin:     p.coin,
          szi:      parseFloat(p.szi),
          entry_px: parseFloat(p.entryPx),
          side:     (parseFloat(p.szi) >= 0 ? "long" : "short") as "long" | "short",
        }))
        .filter(p => p.szi !== 0);
      return { address, positions };
    })
  );

  const wallets = results
    .filter((r): r is PromiseFulfilledResult<{ address: string; positions: PositionSnapshot[] }> =>
      r.status === "fulfilled")
    .map(r => r.value);

  return NextResponse.json({ wallets } satisfies WalletPositionsResponse);
}
