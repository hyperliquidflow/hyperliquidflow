// app/coin/page.tsx
// Markets index: every coin the tracked cohort holds, biggest book first.

import { fetchCohortState } from "@/lib/server/kv-fetchers";
import { MarketsClient } from "./MarketsClient";

export default async function MarketsPage() {
  const initialData = await fetchCohortState();
  return <MarketsClient initialData={initialData} />;
}
