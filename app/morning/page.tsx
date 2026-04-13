// app/morning/page.tsx — server component; prefetches morning scan from KV.

import { fetchMorningScan } from "@/lib/server/kv-fetchers";
import { MorningClient } from "./MorningClient";

export default async function MorningScanPage() {
  const initialData = await fetchMorningScan();
  return <MorningClient initialData={initialData} />;
}
