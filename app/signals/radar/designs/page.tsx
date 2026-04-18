// app/signals/radar/designs/page.tsx
// Throwaway gallery: 5 radar chart variants rendered from the same live data.
// Delete once a design is chosen.

import { fetchMarketRadar } from "@/lib/server/kv-fetchers";
import { DesignsClient } from "./DesignsClient";

export default async function DesignsPage() {
  const initialData = await fetchMarketRadar("BTC", "all");
  return <DesignsClient initialData={initialData} initialTimeseries={null} />;
}
