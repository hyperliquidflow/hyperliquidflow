// app/signals/performance/page.tsx — server component: prefetch recipe performance
import { fetchRecipePerformance } from "@/lib/server/kv-fetchers";
import { PerformanceClient } from "./PerformanceClient";

export default async function PerformancePage() {
  const initialData = await fetchRecipePerformance();
  return <PerformanceClient initialData={initialData} />;
}
