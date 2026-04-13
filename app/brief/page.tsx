// app/brief/page.tsx - server component: prefetch daily scan
import { fetchDailyScan } from "@/lib/server/kv-fetchers";
import { BriefClient } from "./BriefClient";

export default async function BriefPage() {
  const initialData = await fetchDailyScan();
  return <BriefClient initialData={initialData} />;
}
