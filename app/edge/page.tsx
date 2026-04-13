// app/edge/page.tsx — server component: prefetch recipe performance
import { fetchRecipePerformance } from "@/lib/server/kv-fetchers";
import { EdgeClient } from "./EdgeClient";

export default async function EdgePage() {
  const initialData = await fetchRecipePerformance();
  return <EdgeClient initialData={initialData} />;
}
