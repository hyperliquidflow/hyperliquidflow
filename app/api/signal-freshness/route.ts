// app/api/signal-freshness/route.ts
// Rolling 1h latency stats from signal_timing.
// Used by the SignalFreshness stat on the Overview page.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "@/lib/env";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

export interface SignalFreshnessPayload {
  p50_ms:  number | null;
  p95_ms:  number | null;
  count:   number;
  // ISO timestamp of the most recent snapshot_detect_ts in the window
  last_detect_at: string | null;
}

export async function GET(): Promise<NextResponse> {
  const since1h = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("signal_timing")
    .select("snapshot_detect_ts, first_poll_ts")
    .gte("snapshot_detect_ts", since1h)
    .not("first_poll_ts", "is", null)
    .order("snapshot_detect_ts", { ascending: false })
    .limit(500);

  if (error) {
    return NextResponse.json({ p50_ms: null, p95_ms: null, count: 0, last_detect_at: null });
  }

  if (!data || data.length === 0) {
    return NextResponse.json({ p50_ms: null, p95_ms: null, count: 0, last_detect_at: null });
  }

  const latencies = data
    .map((r) => new Date(r.first_poll_ts!).getTime() - new Date(r.snapshot_detect_ts).getTime())
    .filter((l) => l > 0)
    .sort((a, b) => a - b);

  const p50 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.5)] : null;
  const p95 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.95)] : null;

  const payload: SignalFreshnessPayload = {
    p50_ms:         p50,
    p95_ms:         p95,
    count:          latencies.length,
    last_detect_at: data[0]?.snapshot_detect_ts ?? null,
  };

  return NextResponse.json(payload, {
    headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=60" },
  });
}
