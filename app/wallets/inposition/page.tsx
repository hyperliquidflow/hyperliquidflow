// app/wallets/inposition/page.tsx - server component: prefetch cohort state
import { fetchCohortState } from "@/lib/server/kv-fetchers";
import { InPositionClient } from "./InPositionClient";

export default async function InPositionPage() {
  const initialData = await fetchCohortState();
  return <InPositionClient initialData={initialData} />;
}
