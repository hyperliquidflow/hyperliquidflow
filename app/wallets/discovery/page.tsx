// app/wallets/discovery/page.tsx — server component: prefetch scanner stats
import { fetchScannerStats } from "@/lib/server/kv-fetchers";
import { DiscoveryClient } from "./DiscoveryClient";

export default async function DiscoveryPage() {
  const initialScannerData = await fetchScannerStats();
  return <DiscoveryClient initialScannerData={initialScannerData} />;
}
