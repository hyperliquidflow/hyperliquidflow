// app/api/cohort-state/route.ts
// Client polling endpoint — returns the latest cohort snapshot from Vercel KV.
// The browser polls this every 60 seconds via React Query.
// This endpoint NEVER calls Hyperliquid directly.

import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "@/lib/env";
import type { CohortCachePayload } from "@/app/api/refresh-cohort/route";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const KV_COHORT_KEY = "cohort:active";

export async function GET(): Promise<NextResponse> {
  try {
    // ── Primary path: read from Vercel KV ─────────────────────────────────────
    const cached = await kv.get<string>(KV_COHORT_KEY);

    if (cached) {
      const payload: CohortCachePayload =
        typeof cached === "string" ? JSON.parse(cached) : cached;

      return NextResponse.json(payload, {
        headers: {
          // Cache just under the 60s cron interval so clients always get fresh data
          "Cache-Control": "public, max-age=55, stale-while-revalidate=10",
        },
      });
    }

    // ── Fallback: KV miss → read directly from Supabase ───────────────────────
    console.warn("[cohort-state] KV miss — falling back to Supabase");

    const { data: wallets, error: walletErr } = await supabase
      .from("wallets")
      .select(
        "id, address, win_rate"
      )
      .eq("is_active", true)
      .order("win_rate", { ascending: false })
      .limit(200);

    if (walletErr) throw new Error(walletErr.message);

    const walletIds = (wallets ?? []).map((w) => w.id);

    // Fetch latest snapshot per wallet
    const { data: snapshots } = await supabase
      .from("cohort_snapshots")
      .select("*")
      .in("wallet_id", walletIds)
      .order("snapshot_time", { ascending: false })
      .limit(walletIds.length * 2);

    const latestByWallet = new Map<string, Record<string, unknown>>();
    for (const snap of snapshots ?? []) {
      if (!latestByWallet.has(snap.wallet_id)) {
        latestByWallet.set(snap.wallet_id, snap);
      }
    }

    const { data: recentSignals } = await supabase
      .from("signals_history")
      .select("recipe_id, coin, signal_type, direction, detected_at, ev_score, metadata, wallet_id")
      .order("detected_at", { ascending: false })
      .limit(20);

    const fallbackPayload: CohortCachePayload = {
      updated_at:    new Date().toISOString(),
      wallet_count:  wallets?.length ?? 0,
      regime:        "RANGING",
      btc_return_24h: 0,
      top_wallets:   (wallets ?? []).map((w) => {
        const snap = latestByWallet.get(w.id) as Record<string, number | null> | undefined;
        return {
          wallet_id:      w.id,
          address:        w.address,
          overall_score:  (snap?.overall_score as number) ?? 0,
          account_value:  (snap?.account_value as number) ?? 0,
          unrealized_pnl: (snap?.unrealized_pnl as number) ?? 0,
          position_count: (snap?.position_count as number) ?? 0,
          regime_fit:     (snap?.regime_fit as number) ?? 0,
          win_rate:       w.win_rate ?? null,
          liq_buffer_pct: (snap?.liq_buffer_pct as number | null) ?? null,
        };
      }),
      recent_signals: (recentSignals ?? []).map((s) => ({
        recipe_id:   s.recipe_id,
        coin:        s.coin,
        signal_type: s.signal_type,
        direction:   s.direction,
        detected_at: s.detected_at,
        ev_score:    s.ev_score,
        wallet_id:   s.wallet_id,
        metadata:    s.metadata,
      })),
    };

    return NextResponse.json(fallbackPayload, {
      headers: { "Cache-Control": "public, max-age=30" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cohort-state] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
