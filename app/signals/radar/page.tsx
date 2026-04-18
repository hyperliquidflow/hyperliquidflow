// app/signals/radar/page.tsx
// Server component: prefetch default radar view for first paint.

import { fetchMarketRadar, fetchRadarTopAssets } from "@/lib/server/kv-fetchers";
import { RadarClient } from "./RadarClient";

export default async function RadarPage() {
  const topAssets = await fetchRadarTopAssets();
  const defaultAsset = topAssets?.[0] ?? "BTC";
  const initialData = await fetchMarketRadar(defaultAsset, "all");
  return (
    <RadarClient
      initialData={initialData}
      initialAsset={defaultAsset}
      initialTier="all"
    />
  );
}
