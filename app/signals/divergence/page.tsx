// app/signals/divergence/page.tsx — server component: prefetch contrarian state
import { fetchContrarianState } from "@/lib/server/kv-fetchers";
import { DivergenceClient } from "./DivergenceClient";

export default async function DivergencePage() {
  const initialData = await fetchContrarianState();
  return <DivergenceClient initialData={initialData} />;
}
