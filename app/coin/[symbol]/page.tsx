// app/coin/[symbol]/page.tsx
// Server component: first paint from the same KV key /api/deep-dive writes.

import { fetchDeepDive } from "@/lib/server/kv-fetchers";
import { CoinClient } from "./CoinClient";

export default async function CoinPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const coin = decodeURIComponent(symbol).toUpperCase();
  const initialData = await fetchDeepDive(coin);
  return <CoinClient coin={coin} initialData={initialData} />;
}
