// app/api/refresh-cohort/route.ts
// Vercel Cron endpoint — runs every 60 seconds (defined in vercel.json).
// Fetches live data from Hyperliquid, scores the active cohort,
// runs all 9 signal recipes, and writes results to Supabase + Vercel KV.
//
// Execution budget: must complete within Vercel free-tier 10s timeout.
// Strategy: process max 100 active wallets per cycle; GitHub Actions handles full scoring.

import { NextRequest, NextResponse, after } from "next/server";
import { kv } from "@vercel/kv";
import { createClient } from "@supabase/supabase-js";
import {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  CRON_SECRET,
} from "@/lib/env";
import {
  fetchBatchClearinghouseStates,
  fetchAllMids,
  fetchMetaAndAssetCtxs,
  fetchCandleSnapshot,
  fetchL2Book,
  buildAssetCtxMap,
  type HlClearinghouseState,
} from "@/lib/hyperliquid-api-client";
import {
  computeCohortScores,
  detectRegime,
  getEquityTier,
  saveCohortSnapshot,
  fetchActiveWallets,
  pruneUnderperformers,
} from "@/lib/cohort-engine";
import { runSignalLab, type SnapshotPair, type SnapshotRow } from "@/lib/signal-lab";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/** Maximum active wallets processed per cron invocation. */
const MAX_WALLETS_PER_CYCLE = 100;

/** KV key for the cohort cache, read by /api/cohort-state. */
const KV_COHORT_KEY = "cohort:active";

/** KV TTL in seconds (slightly longer than the cron interval). */
const KV_TTL_SECONDS = 120;

// ─────────────────────────────────────────────────────────────────────────────
// GET handler — called by Vercel Cron (also accepts POST for manual trigger)
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  return handleRefresh(req);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return handleRefresh(req);
}

async function handleRefresh(req: NextRequest): Promise<NextResponse> {
  const startMs = Date.now();

  // Optional: verify Vercel Cron secret header to prevent unauthorised calls
  if (CRON_SECRET) {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let cycleWeight = 0;

  try {
    // ── Step 1: Load active wallets with rotating window ─────────────────────
    // Each cycle processes a different 100-wallet slice so all active wallets
    // get intraday snapshots and signal coverage, not just the top 100 by win_rate.
    const allActive = await fetchActiveWallets();
    let wallets = allActive;
    if (allActive.length > MAX_WALLETS_PER_CYCLE) {
      const offset = (await kv.get<number>("cohort:cycle_offset")) ?? 0;
      const start  = offset % allActive.length;
      const end    = start + MAX_WALLETS_PER_CYCLE;
      wallets = end <= allActive.length
        ? allActive.slice(start, end)
        : [...allActive.slice(start), ...allActive.slice(0, end - allActive.length)];
      const nextOffset = end % allActive.length;
      kv.set("cohort:cycle_offset", nextOffset, { ex: 25 * 3600 }).catch(() => {});
    }

    if (wallets.length === 0) {
      console.log("[refresh-cohort] No active wallets — skipping cycle");
      return NextResponse.json({ ok: true, cycle_weight: 0, wallet_count: 0 });
    }

    // ── Step 2: Fetch clearinghouse states for all active wallets ─────────────
    const addresses = wallets.map((w) => w.address);
    const stateMap = await fetchBatchClearinghouseStates(addresses);
    cycleWeight += wallets.length * 2; // weight 2 per clearinghouseState

    // ── Step 3: Fetch market data (shared across all wallets) ─────────────────
    // Load prior allMids from KV before fetching fresh — used by Recipe 5
    // price-confirmation check to distinguish cascade from voluntary exit.
    const [allMids, metaAndCtxs, priorAllMids] = await Promise.all([
      fetchAllMids(),
      fetchMetaAndAssetCtxs(),
      kv.get<Record<string, string>>("market:prior_mids"),
    ]);
    cycleWeight += 2 + 2; // allMids + metaAndAssetCtxs weight

    const assetCtxMap = buildAssetCtxMap(metaAndCtxs);

    // ── Step 4: Detect market regime from BTC price ───────────────────────────
    const currentBtcMid = parseFloat(allMids["BTC"] ?? "0");
    // Load BTC mid from 24h ago (stored in KV from previous day)
    const storedBtcMid = await kv.get<number>("btc_mid_24h_ago");
    const prevBtcMid = storedBtcMid ?? currentBtcMid * 0.99; // fallback: assume slight change
    const regimeResult = detectRegime(currentBtcMid, prevBtcMid);

    // Rotate the 24h BTC mid: store current as tomorrow's "24h ago" value (every 24h)
    const lastBtcRefresh = await kv.get<number>("btc_mid_refresh_ts");
    if (!lastBtcRefresh || Date.now() - lastBtcRefresh > 24 * 60 * 60 * 1000) {
      await kv.set("btc_mid_24h_ago", currentBtcMid, { ex: 25 * 3600 });
      await kv.set("btc_mid_refresh_ts", Date.now(), { ex: 25 * 3600 });
    }

    // ── Step 5: Load previous snapshots from Supabase ────────────────────────
    const walletIds = wallets.map((w) => w.id);
    const { data: prevSnapshots } = await supabase
      .from("cohort_snapshots")
      .select("*")
      .in("wallet_id", walletIds)
      .order("snapshot_time", { ascending: false })
      .limit(wallets.length * 2); // at most 2 per wallet

    const prevByWallet = new Map<string, SnapshotRow>();
    for (const snap of prevSnapshots ?? []) {
      if (!prevByWallet.has(snap.wallet_id)) {
        prevByWallet.set(snap.wallet_id, snap as SnapshotRow);
      }
    }

    // ── Step 6: Load backtest data from Supabase ──────────────────────────────
    const { data: backtestRows } = await supabase
      .from("user_pnl_backtest")
      .select("*")
      .in("wallet_id", walletIds);

    const backtestMap = new Map(
      (backtestRows ?? []).map((r) => [
        r.wallet_id,
        {
          win_rate:     r.win_rate          ?? 0,
          avg_win_usd:  r.avg_win_usd       ?? 0,
          avg_loss_usd: r.avg_loss_usd      ?? 0,
          win_streak:   r.current_win_streak ?? 0,
          sharpe_ratio: r.sharpe_ratio       ?? 0,
          // 30-element daily PnL array written by the daily scan
          daily_pnls:   Array.isArray(r.daily_pnls) ? (r.daily_pnls as number[]) : [],
        },
      ])
    );

    // ── Step 7: Score each wallet and build snapshot pairs ────────────────────
    const pairs: SnapshotPair[] = [];
    const cohortSummary: CohortWalletSummary[] = [];

    for (const wallet of wallets) {
      const state = stateMap.get(wallet.address);
      if (!state) continue;

      // Use the 30-day daily PnL series written by the daily scan.
      // Falls back to an empty array for wallets not yet scored by the daily scan,
      // which yields regime_fit-only scoring (sharpe/consistency/drawdown = 0).
      const bt = backtestMap.get(wallet.id);
      const dailyPnls = bt?.daily_pnls ?? [];

      const scores = computeCohortScores(
        dailyPnls,
        state,
        regimeResult.regime
      );

      // Save new snapshot to Supabase (async, don't await — fire and forget to save time)
      saveCohortSnapshot(wallet.id, state, scores).catch((err) =>
        console.error(`[refresh-cohort] saveCohortSnapshot error for ${wallet.id}:`, err)
      );

      const currSnap = buildSnapshotRow(wallet.id, wallet.address, state, scores);
      const prevSnap = prevByWallet.get(wallet.id) ?? null;

      pairs.push({
        walletId:      wallet.id,
        walletAddress: wallet.address,
        overallScore:  scores.overall_score,
        curr:          currSnap,
        prev:          prevSnap,
      });

      cohortSummary.push({
        wallet_id:      wallet.id,
        address:        wallet.address,
        overall_score:  scores.overall_score,
        account_value:  parseFloat(state.marginSummary.accountValue),
        unrealized_pnl: state.assetPositions.reduce(
          (s, ap) => s + parseFloat(ap.position.unrealizedPnl), 0
        ),
        position_count: state.assetPositions.length,
        regime_fit:     scores.regime_fit,
        win_rate:       bt?.win_rate ?? null,
        liq_buffer_pct: computeLiqBuffer(state),
        equity_tier:    getEquityTier(parseFloat(state.marginSummary.accountValue)),
      });
    }

    // ── Step 8: Fetch L2 books + candles for top coins ────────────────────────
    // Top 10 by total cohort notional: covers both L2 book (EV) and candle recipes.
    const topCoins = getTopCoins(pairs, 10);
    const l2Books    = new Map<string, Awaited<ReturnType<typeof fetchL2Book>>>();
    const candles4h  = new Map<string, Awaited<ReturnType<typeof fetchCandleSnapshot>>>();

    const fourHoursAgo = Date.now() - 4 * 60 * 60 * 1000;
    await Promise.allSettled(
      topCoins.map(async (coin) => {
        const [book, candles] = await Promise.all([
          fetchL2Book(coin),
          fetchCandleSnapshot(coin, "5m", fourHoursAgo, Date.now()),
        ]);
        l2Books.set(coin, book);
        candles4h.set(coin, candles);
        cycleWeight += 4; // 2 per call
      })
    );

    // candles5m reuses the same 5m series fetched above.
    // Recipe 2 uses it for price-flatness detection (first vs last close).
    const candles5m = candles4h;

    // ── Step 9: Run all 9 signal recipes ──────────────────────────────────────
    const { data: recipePerf } = await supabase
      .from("recipe_performance")
      .select("recipe_id, win_rate")
      .order("measured_at", { ascending: false })
      .limit(50);

    const recipeWinRates = new Map(
      (recipePerf ?? []).map((r) => [r.recipe_id as string, r.win_rate ?? 0])
    );

    const signalEvents = await runSignalLab({
      pairs,
      candles5m,
      candles4h,
      assetCtxMap,
      allMids,
      priorAllMids: priorAllMids ?? null,
      backtestMap,
      l2Books,
      recipeWinRates,
      regime: regimeResult.regime,
    });

    // ── Step 10: Fetch recent signals to include in KV payload ────────────────
    const { data: recentSignals } = await supabase
      .from("signals_history")
      .select("recipe_id, coin, signal_type, direction, detected_at, ev_score, metadata, wallet_id")
      .order("detected_at", { ascending: false })
      .limit(20);

    // ── Step 11: Write cohort payload to Vercel KV ────────────────────────────
    const payload: CohortCachePayload = {
      updated_at:           new Date().toISOString(),
      wallet_count:         cohortSummary.length,
      total_active_wallets: allActive.length,
      regime:               regimeResult.regime,
      btc_return_24h: regimeResult.btc_return_24h,
      top_wallets:   cohortSummary
        .sort((a, b) => b.overall_score - a.overall_score)
        .slice(0, 200),
      recent_signals: (recentSignals ?? []).map((s) => ({
        recipe_id:     s.recipe_id,
        coin:          s.coin,
        signal_type:   s.signal_type,
        direction:     s.direction,
        detected_at:   s.detected_at,
        ev_score:      s.ev_score,
        wallet_id:     s.wallet_id,
        metadata:      s.metadata,
      })),
    };

    await Promise.all([
      kv.set(KV_COHORT_KEY, JSON.stringify(payload), { ex: KV_TTL_SECONDS }),
      // Store allMids for next cycle's Recipe 5 price-confirmation check
      kv.set("market:prior_mids", allMids, { ex: KV_TTL_SECONDS * 5 }),
    ]);

    const durationMs = Date.now() - startMs;

    console.log(
      JSON.stringify({
        event:                "refresh_cycle_complete",
        wallet_count:         cohortSummary.length,
        total_active_wallets: allActive.length,
        signal_count:         signalEvents.length,
        cycle_weight:         cycleWeight,
        duration_ms:          durationMs,
        regime:               regimeResult.regime,
      })
    );

    // Prune underperformers in the background so it doesn't eat into the 10s cron budget
    after(
      pruneUnderperformers().catch((err) =>
        console.error("[refresh-cohort] pruneUnderperformers error:", err)
      )
    );

    return NextResponse.json({
      ok:                   true,
      cycle_weight:         cycleWeight,
      wallet_count:         cohortSummary.length,
      total_active_wallets: allActive.length,
      signal_count:         signalEvents.length,
      duration_ms:          durationMs,
      regime:               regimeResult.regime,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[refresh-cohort] cycle failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function computeLiqBuffer(state: HlClearinghouseState): number | null {
  const av = parseFloat(state.marginSummary.accountValue);
  const mu = parseFloat(state.marginSummary.totalMarginUsed);
  if (av <= 0) return null;
  return Math.max(0, (av - mu) / av);
}

function buildSnapshotRow(
  walletId: string,
  walletAddress: string,
  state: HlClearinghouseState,
  scores: ReturnType<typeof computeCohortScores>
): SnapshotRow {
  const ms = state.marginSummary;
  return {
    id:               crypto.randomUUID(),
    wallet_id:        walletId,
    wallet_address:   walletAddress,
    overall_score:    scores.overall_score,
    snapshot_time:    new Date().toISOString(),
    account_value:    parseFloat(ms.accountValue),
    total_notional:   parseFloat(ms.totalNtlPos),
    total_margin_used: parseFloat(ms.totalMarginUsed),
    liq_buffer_pct:   computeLiqBuffer(state),
    position_count:   state.assetPositions.length,
    positions:        state.assetPositions as SnapshotRow["positions"],
    sharpe_proxy:     scores.sharpe_proxy,
    regime_fit:       scores.regime_fit,
    unrealized_pnl:   state.assetPositions.reduce(
      (s, ap) => s + parseFloat(ap.position.unrealizedPnl), 0
    ),
    withdrawable:     parseFloat(state.withdrawable),
  };
}

function getTopCoins(pairs: SnapshotPair[], limit: number): string[] {
  const coinNotional = new Map<string, number>();
  for (const { curr } of pairs) {
    for (const ap of curr.positions) {
      const coin = ap.position.coin;
      const val  = parseFloat(ap.position.positionValue);
      coinNotional.set(coin, (coinNotional.get(coin) ?? 0) + val);
    }
  }
  return [...coinNotional.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([coin]) => coin);
}

// ─────────────────────────────────────────────────────────────────────────────
// KV Payload type (shared with cohort-state route)
// ─────────────────────────────────────────────────────────────────────────────

interface CohortWalletSummary {
  wallet_id:      string;
  address:        string;
  overall_score:  number;
  account_value:  number;
  unrealized_pnl: number;
  position_count: number;
  regime_fit:     number;
  win_rate:       number | null;
  liq_buffer_pct: number | null;
  equity_tier:    string | null;
}

export interface CohortCachePayload {
  updated_at:            string;
  wallet_count:          number;
  // Total active wallets in DB. May exceed wallet_count (cron only processes top 100).
  total_active_wallets:  number;
  regime:                "BULL" | "BEAR" | "RANGING";
  btc_return_24h:        number;
  top_wallets:           CohortWalletSummary[];
  recent_signals: Array<{
    recipe_id:   string;
    coin:        string;
    signal_type: string;
    direction:   string | null;
    detected_at: string;
    ev_score:    number | null;
    wallet_id:   string;
    metadata:    Record<string, unknown>;
  }>;
}
