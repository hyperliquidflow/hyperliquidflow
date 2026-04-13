// app/page.tsx — server component: prefetch cohort + ticker for zero-skeleton first paint
import { fetchCohortState, fetchMarketTicker } from "@/lib/server/kv-fetchers";
import { OverviewClient } from "@/app/OverviewClient";

export default async function OverviewPage() {
  const [initialData, initialTicker] = await Promise.all([
    fetchCohortState(),
    fetchMarketTicker(),
  ]);
  return <OverviewClient initialData={initialData} initialTicker={initialTicker} />;
}
