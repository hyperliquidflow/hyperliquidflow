// app/wallets/discovery/page.tsx — server component: prefetch scanner stats
import { DiscoveryClient } from "./DiscoveryClient";

export default async function DiscoveryPage() {
  let initialScannerData = null;
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/scanner-stats`, { next: { revalidate: 300 } });
    if (res.ok) initialScannerData = await res.json();
  } catch { /* serve without initial data */ }
  return <DiscoveryClient initialScannerData={initialScannerData} />;
}
