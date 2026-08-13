// app/api/positioning/route.ts
//
// The plainest question a market participant asks: what is the money that is
// winning actually positioned in, and is that different from everyone else?
//
// Answers it by ranking every open position in the tracked cohort by unrealised
// PnL and comparing the top slice against the whole. Descriptive only. A position
// showing the largest unrealised gain is winning *now*, which in a falling market
// mostly means it is short, so this reports what is happening rather than what
// will happen. The comparison against the losing half is what stops it being a
// pure restatement of the last 24 hours of price.

import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "@/lib/env";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const CACHE_KEY = "positioning:v1";
const TOP_N = 100;

export interface PositioningBucket {
  label:            string;
  longs:            number;
  shorts:           number;
  long_notional:    number;
  short_notional:   number;
  pct_short_notional: number | null;
}

export interface PositioningPayload {
  buckets:     PositioningBucket[];
  total_positions: number;
  wallets:     number;
  updated_at:  string | null;
}

type RawPos = {
  position?: { coin?: string; szi?: string; positionValue?: string; unrealizedPnl?: string };
};

interface Flat { szi: number; notional: number; upnl: number }

function bucket(label: string, rows: Flat[]): PositioningBucket {
  const longN  = rows.filter((r) => r.szi > 0).reduce((s, r) => s + r.notional, 0);
  const shortN = rows.filter((r) => r.szi < 0).reduce((s, r) => s + r.notional, 0);
  const tot    = longN + shortN;
  return {
    label,
    longs:  rows.filter((r) => r.szi > 0).length,
    shorts: rows.filter((r) => r.szi < 0).length,
    long_notional:  Math.round(longN),
    short_notional: Math.round(shortN),
    pct_short_notional: tot > 0 ? Math.round((shortN / tot) * 1000) / 10 : null,
  };
}

export async function GET(): Promise<NextResponse> {
  try {
    const cached = await kv.get<string>(CACHE_KEY);
    if (cached) {
      return NextResponse.json(typeof cached === "string" ? JSON.parse(cached) : cached);
    }

    const since = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const { data, error } = await supabase
      .from("cohort_snapshots")
      .select("wallet_id, positions, snapshot_time")
      .gte("snapshot_time", since)
      .order("snapshot_time", { ascending: false })
      .limit(5_000);
    if (error) throw new Error(error.message);

    // Newest snapshot per wallet only. Without this a wallet sampled ten times
    // in the window would count its positions ten times.
    const seen = new Set<string>();
    const flat: Flat[] = [];
    let newest: string | null = null;
    for (const row of data ?? []) {
      if (seen.has(row.wallet_id)) continue;
      seen.add(row.wallet_id);
      if (newest == null || (row.snapshot_time as string) > newest) newest = row.snapshot_time as string;
      for (const ap of ((row.positions ?? []) as RawPos[])) {
        const szi      = parseFloat(ap.position?.szi ?? "0");
        const notional = Math.abs(parseFloat(ap.position?.positionValue ?? "0"));
        const upnl     = parseFloat(ap.position?.unrealizedPnl ?? "0");
        if (!ap.position?.coin || !Number.isFinite(notional) || notional <= 0 || szi === 0) continue;
        flat.push({ szi, notional, upnl: Number.isFinite(upnl) ? upnl : 0 });
      }
    }

    const byPnl = [...flat].sort((a, b) => b.upnl - a.upnl);
    const payload: PositioningPayload = {
      buckets: [
        bucket(`Top ${TOP_N} by open profit`, byPnl.slice(0, TOP_N)),
        bucket("Positions in loss",           flat.filter((r) => r.upnl < 0)),
        bucket("Every tracked position",      flat),
      ],
      total_positions: flat.length,
      wallets:         seen.size,
      updated_at:      newest,
    };

    await kv.set(CACHE_KEY, JSON.stringify(payload), { ex: 60 });
    return NextResponse.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
