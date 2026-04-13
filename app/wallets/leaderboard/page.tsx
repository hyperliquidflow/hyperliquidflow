// app/wallets/leaderboard/page.tsx - server component: prefetch cohort state
import { fetchCohortState } from "@/lib/server/kv-fetchers";
import { LeaderboardClient } from "./LeaderboardClient";

export default async function LeaderboardPage() {
  const initialData = await fetchCohortState();
  return <LeaderboardClient initialData={initialData} />;
}
