// app/api/contrarian/route.ts
// Serves contrarian trade ideas using cached cohort data + live market data.
// Rule-based Smart Trade Plan: ATR-derived SL/TP, Kelly position sizing.

import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "@/lib/env";
import { fetchMetaAndAssetCtxs, fetchCandleSnapshot, buildAssetCtxMap } from "@/lib/hyperliquid-api-client";
import { findContrarianIdeas } from "@/lib/risk-engine";
import type { CohortCachePayload } from "@/app/api/refresh-cohort/route";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CACHE_KEY = "contrarian:latest";
const CACHE_TTL = 65;

export async function GET(): Promise<NextResponse> {
  // Try KV cache first
  const cached = await kv.get<string>(CACHE_KEY);
  if (cached) {
    const parsed = typeof cached === "string" ? JSON.parse(cached) : cached;
    return NextResponse.json(parsed);
  }

  try {
    // Load cohort state from KV
    const cohortRaw = await kv.get<string>("cohort:active");
    if (!cohortRaw) {
      return NextResponse.json({ ideas: [], updated_at: new Date().toISOString() });
    }
    const cohort: CohortCachePayload =
      typeof cohortRaw === "string" ? JSON.parse(cohortRaw) : cohortRaw;

    // Build cohort net notional per coin from latest Supabase snapshots
    const cohortNet = new Map<string, number>();
    const walletIds = cohort.top_wallets.map((w) => w.wallet_id);
    if (walletIds.length > 0) {
      const { data: snapshots } = await supabase
        .from("cohort_snapshots")
        .select("wallet_id, positions")
        .in("wallet_id", walletIds)
        .order("snapshot_time", { ascending: false })
        .limit(walletIds.length * 2);

      const seenWallets = new Set<string>();
      for (const snap of snapshots ?? []) {
        if (seenWallets.has(snap.wallet_id)) continue;
        seenWallets.add(snap.wallet_id);
        for (const ap of (snap.positions as Array<{ position: { coin: string; szi: string; positionValue: string } }> ?? [])) {
          const coin   = ap.position.coin;
          const szi    = parseFloat(ap.position.szi ?? "0");
          const posVal = parseFloat(ap.position.positionValue ?? "0");
          cohortNet.set(coin, (cohortNet.get(coin) ?? 0) + (szi > 0 ? posVal : -posVal));
        }
      }
    }

    // Fetch live market data
    const metaAndCtxs = await fetchMetaAndAssetCtxs();
    const assetCtxMap = buildAssetCtxMap(metaAndCtxs);

    const totalOiByCoin = new Map<string, number>();
    const fundingByCoin = new Map<string, string>();
    const [meta, ctxs] = metaAndCtxs;
    meta.universe.forEach((asset, i) => {
      const ctx = ctxs[i];
      if (!ctx) return;
      totalOiByCoin.set(asset.name, parseFloat(ctx.openInterest));
      fundingByCoin.set(asset.name, ctx.funding);
    });

    const ideas = findContrarianIdeas(cohortNet, totalOiByCoin, fundingByCoin);

    // For each idea, build a rule-based trade plan using candles
    const enrichedIdeas = await Promise.allSettled(
      ideas.slice(0, 10).map(async (idea) => {
        const endTime   = Date.now();
        const startTime = endTime - 4 * 60 * 60 * 1000; // 4h candles
        const candles   = await fetchCandleSnapshot(idea.coin, "15m", startTime, endTime);

        if (candles.length < 4) return { ...idea, trade_plan: null };

        const highs  = candles.map((c) => parseFloat(c.h));
        const lows   = candles.map((c) => parseFloat(c.l));
        const closes = candles.map((c) => parseFloat(c.c));
        const lastClose = closes[closes.length - 1];

        // ATR (Average True Range) over last 14 candles
        const atrCandles = candles.slice(-14);
        const trueRanges = atrCandles.map((c, i) => {
          const prevClose = i > 0 ? parseFloat(atrCandles[i - 1].c) : parseFloat(c.o);
          return Math.max(
            parseFloat(c.h) - parseFloat(c.l),
            Math.abs(parseFloat(c.h) - prevClose),
            Math.abs(parseFloat(c.l) - prevClose)
          );
        });
        const atr = trueRanges.reduce((a, b) => a + b, 0) / trueRanges.length;

        const isLong = idea.smart_direction === "LONG";
        const swingLow  = Math.min(...lows.slice(-8));
        const swingHigh = Math.max(...highs.slice(-8));

        const entry       = lastClose;
        const stopLoss    = isLong ? Math.min(swingLow, lastClose - 1.5 * atr) : Math.max(swingHigh, lastClose + 1.5 * atr);
        const riskPerUnit = Math.abs(entry - stopLoss);
        const takeProfit  = isLong ? entry + 2 * riskPerUnit : entry - 2 * riskPerUnit;
        const rr          = riskPerUnit > 0 ? (Math.abs(takeProfit - entry) / riskPerUnit).toFixed(1) : "N/A";

        // Kelly criterion: f = (p*b - q) / b where b = R:R ratio, p = win_rate, q = 1-p
        const winRate = idea.confidence; // proxy: use confidence as win rate estimate
        const rrNum   = parseFloat(rr) || 2;
        const kelly   = Math.max(0, (winRate * rrNum - (1 - winRate)) / rrNum);
        const kellyPct = Math.min(kelly * 0.25, 0.05); // quarter-Kelly, cap at 5% of account

        const ctx = assetCtxMap.get(idea.coin);
        const fundingPct = ctx ? (parseFloat(ctx.funding) * 100).toFixed(4) + "%" : "N/A";

        return {
          ...idea,
          trade_plan: {
            entry_zone:  `$${entry.toFixed(2)} ± ${(atr * 0.5).toFixed(2)}`,
            stop_loss:   `$${stopLoss.toFixed(2)} (${(Math.abs(entry - stopLoss) / entry * 100).toFixed(2)}% risk)`,
            take_profit: `$${takeProfit.toFixed(2)}`,
            risk_reward: `${rr}:1`,
            kelly_size:  `${(kellyPct * 100).toFixed(1)}% of account (¼-Kelly)`,
            funding_rate: fundingPct,
          },
        };
      })
    );

    const result = {
      ideas: enrichedIdeas
        .map((r) => (r.status === "fulfilled" ? r.value : null))
        .filter(Boolean),
      updated_at: new Date().toISOString(),
    };

    await kv.set(CACHE_KEY, JSON.stringify(result), { ex: CACHE_TTL });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message, ideas: [], updated_at: new Date().toISOString() }, { status: 500 });
  }
}
