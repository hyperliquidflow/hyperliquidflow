// app/api/cohort-state/route.ts
// Client polling endpoint — returns the latest cohort snapshot from Vercel KV.
// The browser polls this every 60 seconds via React Query.
// This endpoint NEVER calls Hyperliquid directly.

import { NextResponse, after } from "next/server";
import { kv } from "@vercel/kv";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "@/lib/env";
import type { CohortCachePayload } from "@/app/api/refresh-cohort/route";

const STALE_AFTER_MS = 5 * 60 * 1000; // 5 minutes

/** Fire-and-forget background refresh so the next poll gets fresh data.
 *  Must target the public production alias. VERCEL_URL points to the unique
 *  deployment URL, which Deployment Protection gates behind an SSO 401. */
function triggerBackgroundRefresh(): void {
  const prodHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const base = prodHost
    ? `https://${prodHost}`
    : "http://localhost:3000";
  after(
    fetch(`${base}/api/refresh-cohort`, { method: "GET" }).catch((e) =>
      console.warn("[cohort-state] background refresh failed:", e)
    )
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const KV_COHORT_KEY = "cohort:active";

export async function GET(): Promise<NextResponse> {
  try {
    // ── Primary path: read from Vercel KV ─────────────────────────────────────
    const cached = await kv.get<string>(KV_COHORT_KEY);

    if (cached) {
      const payload: CohortCachePayload =
        typeof cached === "string" ? JSON.parse(cached) : cached;

      // Trigger background refresh if cache is stale (replaces every-minute cron on Hobby plan)
      const ageMs = Date.now() - new Date(payload.updated_at).getTime();
      if (ageMs > STALE_AFTER_MS) {
        triggerBackgroundRefresh();
      }

      // Backfill first_poll_ts for any signals not yet seen by a browser
      const unseenIds = (payload.recent_signals ?? [])
        .map((s) => s.id)
        .filter(Boolean) as string[];
      if (unseenIds.length > 0) {
        after(
          (async () => {
            const { error } = await supabase
              .from("signal_timing")
              .update({ first_poll_ts: new Date().toISOString() })
              .in("signal_id", unseenIds)
              .is("first_poll_ts", null);
            if (error) console.error("[signal-timing] first_poll backfill error:", error.message);
          })()
        );
      }

      return NextResponse.json(payload, {
        headers: {
          "Cache-Control": "public, max-age=55, stale-while-revalidate=10",
        },
      });
    }

    // ── Fallback: KV miss → try secondary key, then Supabase ─────────────────
    console.warn("[cohort-state] KV miss, checking secondary fallback");
    triggerBackgroundRefresh();

    const fallbackRaw = await kv.get<string>("cohort:active:fallback");
    if (fallbackRaw) {
      const fallbackPayload: CohortCachePayload =
        typeof fallbackRaw === "string" ? JSON.parse(fallbackRaw) : fallbackRaw;
      return NextResponse.json(fallbackPayload, {
        headers: { "Cache-Control": "public, max-age=30" },
      });
    }

    console.warn("[cohort-state] secondary fallback miss, falling back to Supabase");

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

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recentSignals } = await supabase
      .from("signals_history")
      .select("id, recipe_id, coin, signal_type, direction, detected_at, ev_score, metadata, wallet_id")
      .gte("detected_at", since24h)
      .order("detected_at", { ascending: false })
      .limit(500);

    // Build a UUID → address map from the wallets already fetched
    const walletAddressMap = new Map<string, string>(
      (wallets ?? []).map((w) => [w.id, w.address] as [string, string])
    );

    // Count total active wallets for accurate display (fallback path queries up to 200)
    const { count: totalActiveCount } = await supabase
      .from("wallets")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true);

    const fallbackPayload: CohortCachePayload = {
      updated_at:           new Date().toISOString(),
      wallet_count:         wallets?.length ?? 0,
      total_active_wallets: totalActiveCount ?? wallets?.length ?? 0,
      regime:               "RANGING",
      btc_return_24h:       0,
      regime_history:       [],
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
          equity_tier:    (snap?.equity_tier as string | null) ?? null,
          trading_style:  null,
        };
      }),
      recent_signals: (recentSignals ?? []).map((s) => ({
        id:             s.id,
        recipe_id:      s.recipe_id,
        coin:           s.coin,
        signal_type:    s.signal_type,
        direction:      s.direction,
        detected_at:    s.detected_at,
        ev_score:       s.ev_score,
        wallet_id:      s.wallet_id,
        wallet_address: s.wallet_id ? (walletAddressMap.get(s.wallet_id) ?? null) : null,
        metadata:       s.metadata,
      })),
      hygiene_breakdown: null,
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
