// app/signals/feed/page.tsx - server component: prefetch cohort state
import { fetchCohortState } from "@/lib/server/kv-fetchers";
import { FeedClient } from "./FeedClient";

export default async function FeedPage() {
  const initialData = await fetchCohortState();
  return <FeedClient initialData={initialData} />;
}
