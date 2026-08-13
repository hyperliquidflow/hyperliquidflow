// app/api/deep-dive/route.ts
// Serves single-token deep dive data: candles, funding, OI, cohort exposure.

import { NextRequest, NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { createClient } from "@supabase/supabase-js";
import {
  fetchCandleSnapshot,
  fetchMetaAndAssetCtxs,
  fetchFundingHistory,
  buildAssetCtxMap,
} from "@/lib/hyperliquid-api-client";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "@/lib/env";
import type { CohortCachePayload } from "@/app/api/refresh-cohort/route";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type RawPosition = {
  position: {
    coin:           string;
    szi:            string;
    positionValue:  string;
    unrealizedPnl?: string;
    entryPx?:       string;
  };
};

export interface Holder {
  address:        string;
  score:          number;
  direction:      "LONG" | "SHORT";
  notional:       number;
  unrealized_pnl: number;
  entry_px:       number;
}

export interface CohortExposure {
  net_notional:   number;
  long_notional:  number;
  short_notional: number;
  wallet_count:   number;
  direction:      string;
}

/**
 * Change in net exposure between each wallet's two most recent snapshots.
 *
 * Only wallets observed twice are counted. refresh-cohort writes snapshots for a
 * rotating batch, so a wallet absent from the newer pass was probably not
 * sampled rather than flat, and treating absence as a close would invent flow
 * that did not happen. `wallets_compared` is reported so the number can be read
 * against how much of the cohort it covers.
 */
export interface ExposureChange {
  net_delta:        number;
  wallets_compared: number;
  previous_at:      string | null;
}

export interface DeepDivePayload {
  coin:    string;
  candles: unknown[];
  ctx: {
    funding:      string;
    openInterest: string;
    markPx:       string;
    dayNtlVlm:    string;
    prevDayPx:    string;
  } | null;
  fundingHistory: Array<{ time: number; fundingRate: string }>;
  cohortExposure: CohortExposure | null;
  exposureChange: ExposureChange | null;
  holders:        Holder[];
}

/** Signed notional this wallet held in `coin`, 0 if it held none. */
function signedNotional(positions: RawPosition[], coin: string): number {
  const pos = positions.find((p) => p.position.coin === coin);
  if (!pos) return 0;
  const szi = parseFloat(pos.position.szi ?? "0");
  const val = parseFloat(pos.position.positionValue ?? "0");
  if (!Number.isFinite(val) || val <= 0 || szi === 0) return 0;
  return szi > 0 ? val : -val;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const coin     = (req.nextUrl.searchParams.get("coin") ?? "BTC").toUpperCase();
  const interval = req.nextUrl.searchParams.get("interval") ?? "1h";

  const cacheKey = `deep-dive:${coin}:${interval}`;
  const cached   = await kv.get<string>(cacheKey);
  if (cached) {
    const parsed = typeof cached === "string" ? JSON.parse(cached) : cached;
    return NextResponse.json(parsed);
  }

  try {
    const endTime    = Date.now();
    const windowMap: Record<string, number> = {
      "5m": 6 * 60 * 60 * 1000,   // 6h of 5m candles
      "15m": 24 * 60 * 60 * 1000, // 24h of 15m candles
      "1h": 7 * 24 * 60 * 60 * 1000,
      "4h": 30 * 24 * 60 * 60 * 1000,
      "1d": 90 * 24 * 60 * 60 * 1000,
    };
    const startTime = endTime - (windowMap[interval] ?? 7 * 24 * 60 * 60 * 1000);

    const [candles, metaAndCtxs, fundingHistory] = await Promise.all([
      fetchCandleSnapshot(coin, interval, startTime, endTime),
      fetchMetaAndAssetCtxs(),
      fetchFundingHistory(coin, Date.now() - 7 * 24 * 60 * 60 * 1000),
    ]);

    const assetCtxMap = buildAssetCtxMap(metaAndCtxs);
    const ctx = assetCtxMap.get(coin) ?? null;

    // Compute real cohort exposure for this coin from the latest Supabase snapshots.
    // This reads actual position data, not signal metadata (which is unreliable for this).
    let cohortExposure: CohortExposure | null = null;
    let exposureChange: ExposureChange | null = null;
    let holders: Holder[] = [];
    try {
      const cohortRaw = await kv.get<string>("cohort:active");
      if (cohortRaw) {
        const cohort: CohortCachePayload =
          typeof cohortRaw === "string" ? JSON.parse(cohortRaw) : cohortRaw;
        const walletIds = cohort.top_wallets.map((w) => w.wallet_id);
        const walletMeta = new Map(cohort.top_wallets.map((w) => [w.wallet_id, w]));

        if (walletIds.length > 0) {
          const { data: snaps } = await supabase
            .from("cohort_snapshots")
            .select("wallet_id, positions, snapshot_time")
            .in("wallet_id", walletIds)
            .order("snapshot_time", { ascending: false })
            .limit(walletIds.length * 3);

          // Second-newest row per wallet, for the change calculation below.
          const priorSnap = new Map<string, { positions: RawPosition[]; at: string }>();
          const snapCount = new Map<string, number>();
          for (const snap of snaps ?? []) {
            const n = (snapCount.get(snap.wallet_id) ?? 0) + 1;
            snapCount.set(snap.wallet_id, n);
            if (n === 2) {
              priorSnap.set(snap.wallet_id, {
                positions: (snap.positions as RawPosition[]) ?? [],
                at:        snap.snapshot_time as string,
              });
            }
          }

          let netDelta        = 0;
          let walletsCompared = 0;
          let previousAt: string | null = null;

          const seenWallets = new Set<string>();
          let longNotional  = 0;
          let shortNotional = 0;
          let walletCount   = 0;

          for (const snap of snaps ?? []) {
            if (seenWallets.has(snap.wallet_id)) continue;
            seenWallets.add(snap.wallet_id);
            const positions = snap.positions as RawPosition[] ?? [];

            // Change is measured over wallets seen twice, whether or not they
            // hold this coin now, so an exit counts as outflow.
            const prior = priorSnap.get(snap.wallet_id);
            if (prior) {
              netDelta += signedNotional(positions, coin) - signedNotional(prior.positions, coin);
              walletsCompared++;
              if (previousAt == null || prior.at > previousAt) previousAt = prior.at;
            }

            const pos = positions.find((p) => p.position.coin === coin);
            if (!pos) continue;
            const szi = parseFloat(pos.position.szi ?? "0");
            const val = parseFloat(pos.position.positionValue ?? "0");
            if (!Number.isFinite(val) || val <= 0) continue;
            if (szi > 0) longNotional += val;
            else if (szi < 0) shortNotional += val;
            else continue;
            walletCount++;

            const meta = walletMeta.get(snap.wallet_id);
            holders.push({
              address:        meta?.address ?? "",
              score:          meta?.overall_score ?? 0,
              direction:      szi > 0 ? "LONG" : "SHORT",
              notional:       val,
              unrealized_pnl: parseFloat(pos.position.unrealizedPnl ?? "0"),
              entry_px:       parseFloat(pos.position.entryPx ?? "0"),
            });
          }

          // Largest positions first. The tail is noise on a page meant to be read.
          holders = holders.sort((a, b) => b.notional - a.notional).slice(0, 12);

          if (walletsCompared > 0) {
            exposureChange = {
              net_delta:        netDelta,
              wallets_compared: walletsCompared,
              previous_at:      previousAt,
            };
          }

          if (walletCount > 0) {
            const net = longNotional - shortNotional;
            cohortExposure = {
              net_notional:   net,
              long_notional:  longNotional,
              short_notional: shortNotional,
              wallet_count:   walletCount,
              direction:      net > 0 ? "LONG" : net < 0 ? "SHORT" : "FLAT",
            };
          }
        }
      }
    } catch {
      // Non-fatal: cohort exposure is supplemental data
    }

    const result: DeepDivePayload = {
      coin,
      candles: candles.slice(-200), // cap at 200 candles for payload size
      ctx: ctx ? {
        funding:     ctx.funding,
        openInterest: ctx.openInterest,
        markPx:      ctx.markPx,
        dayNtlVlm:   ctx.dayNtlVlm,
        prevDayPx:   ctx.prevDayPx,
      } : null,
      fundingHistory: fundingHistory.slice(-48).map((f) => ({
        time:        f.time,
        fundingRate: f.fundingRate,
      })),
      cohortExposure,
      exposureChange,
      holders,
    };

    await kv.set(cacheKey, JSON.stringify(result), { ex: 60 });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
