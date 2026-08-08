// app/api/scanner-stats/route.ts
// Client polling endpoint for the Discovery page. Delegates to the same
// fetcher the server component uses, so the first paint and every later poll
// agree. This route previously duplicated the logic with its own hardcoded
// pipeline text and counted active wallets from a truncated page of the
// wallets table, which reported a fraction of the real cohort.

import { NextResponse } from "next/server";
import { fetchScannerStats } from "@/lib/server/kv-fetchers";

export async function GET(): Promise<NextResponse> {
  const stats = await fetchScannerStats();
  if (!stats) {
    return NextResponse.json({ error: "scanner stats unavailable" }, { status: 500 });
  }
  return NextResponse.json(stats);
}
