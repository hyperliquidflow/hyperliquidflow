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
import {
  runBridgeInflowEnrichment,
  runTwapEnrichment,
} from "@/lib/hypurrscan-enrichment";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/** Maximum active wallets processed per cron invocation. */
const MAX_WALLETS_PER_CYCLE = 100;

/** KV key for the cohort cache, read by /api/cohort-state. */
const KV_COHORT_KEY = "cohort:active";

/** KV TTL in seconds. Must exceed the cron interval + drift budget.
 *  Cron pings `/api/refresh-cohort` every 5 min via GitHub Actions, which can drift
 *  several minutes under load — 600s (10 min) keeps the fast path warm through that. */
const KV_TTL_SECONDS = 600;

/** Prior-mids TTL for Recipe 5 cascade-vs-voluntary-exit check.
 *  Kept short so price comparisons stay meaningful (don't compare to hour-old prices). */
const PRIOR_MIDS_TTL_SECONDS = 900;

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
    // Store current BTC mid keyed by current UTC hour; read from 24h-ago hour for stable window.
    const nowHour = new Date().getUTCHours().toString().padStart(2, "0");
    const agoHour = new Date(Date.now() - 24 * 3600 * 1000).getUTCHours().toString().padStart(2, "0");
    const [, priorBtcMid] = await Promise.all([
      kv.set(`btc_mid:${nowHour}`, currentBtcMid, { ex: 25 * 3600 }),
      kv.get<number>(`btc_mid:${agoHour}`),
    ]);
    const prevBtcMid = priorBtcMid ?? currentBtcMid * 0.99;
    const regimeResult = detectRegime(currentBtcMid, prevBtcMid);

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
      .select("recipe_id, win_rate, signal_count")
      .order("measured_at", { ascending: false })
      .limit(50);

    const recipeWinRates = new Map(
      (recipePerf ?? []).map((r) => [r.recipe_id as string, r.win_rate ?? 0])
    );
    const recipeSignalCounts = new Map(
      (recipePerf ?? []).map((r) => [
        r.recipe_id as string,
        ((r as Record<string, unknown>).signal_count as number) ?? 0,
      ])
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
      recipeSignalCounts,
      regime: regimeResult.regime,
    });

    // ── Step 10: Fetch recent signals to include in KV payload ────────────────
    // Need 24h of signals for the heatmap activity bar — 500 is a safe upper bound
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recentSignals } = await supabase
      .from("signals_history")
      .select("recipe_id, coin, signal_type, direction, detected_at, ev_score, metadata, wallet_id")
      .gte("detected_at", since24h)
      .order("detected_at", { ascending: false })
      .limit(500);

    // ── Step 11: Write cohort payload to Vercel KV ────────────────────────────
    // Build a UUID → address map from the full active cohort (not cycle slice)
    const walletAddressMap = new Map<string, string>(
      allActive.map((w) => [w.id, w.address] as [string, string])
    );

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
    };

    await Promise.all([
      kv.set(KV_COHORT_KEY, JSON.stringify(payload), { ex: KV_TTL_SECONDS }),
      // Store allMids for next cycle's Recipe 5 price-confirmation check
      kv.set("market:prior_mids", allMids, { ex: PRIOR_MIDS_TTL_SECONDS }),
    ]);
    // Secondary fallback key: survives cron gaps up to 24h, prevents Supabase fallback on KV miss
    kv.set("cohort:active:fallback", JSON.stringify(payload), { ex: 24 * 3600 }).catch(() => {});

    // Top wallets for TWAP scanning: sort by account_value, take top 20
    const twapCandidates = [...cohortSummary]
      .filter((w) => w.account_value >= 250_000)
      .sort((a, b) => b.account_value - a.account_value)
      .slice(0, 20)
      .map((w) => ({ id: w.wallet_id, address: w.address }));

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

    // Run background tasks after response: prune + enrichment + intraday recipe perf
    after(
      Promise.all([
        pruneUnderperformers().catch((err) =>
          console.error("[refresh-cohort] pruneUnderperformers error:", err)
        ),
        deactivateDustWallets(cohortSummary).catch((err) =>
          console.error("[refresh-cohort] deactivateDustWallets error:", err)
        ),
        runBridgeInflowEnrichment(wallets.map((w) => ({ id: w.id, address: w.address }))).catch((err) =>
          console.error("[refresh-cohort] bridgeInflowEnrichment error:", err)
        ),
        runTwapEnrichment(twapCandidates).catch((err) =>
          console.error("[refresh-cohort] twapEnrichment error:", err)
        ),
        updateIntradayRecipePerformance().catch((err) =>
          console.error("[refresh-cohort] updateIntradayRecipePerformance error:", err)
        ),
      ])
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
// Intraday recipe performance
// ─────────────────────────────────────────────────────────────────────────────

async function updateIntradayRecipePerformance(): Promise<void> {
  const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();

  const { data: rows, error } = await supabase
    .from("signals_history")
    .select("recipe_id, ev_score")
    .gte("detected_at", since);

  if (error) {
    console.error("[recipe-perf] intraday query error:", error.message);
    return;
  }
  if (!rows || rows.length === 0) {
    console.log("[recipe-perf] no intraday signal history to aggregate, skipping");
    return;
  }

  // Group by recipe_id
  const byRecipe = new Map<string, { evScores: number[]; withScore: number; total: number }>();
  for (const row of rows) {
    const id = row.recipe_id as string;
    if (!byRecipe.has(id)) byRecipe.set(id, { evScores: [], withScore: 0, total: 0 });
    const entry = byRecipe.get(id)!;
    entry.total++;
    if (row.ev_score != null) {
      entry.evScores.push(row.ev_score as number);
      if ((row.ev_score as number) > 0) entry.withScore++;
    }
  }

  const insertRows = [...byRecipe.entries()].map(([recipe_id, { evScores, withScore, total }]) => {
    const avg_ev_score = evScores.length > 0
      ? evScores.reduce((a, b) => a + b, 0) / evScores.length
      : null;
    const true_positive  = withScore;
    const false_positive = total - withScore;
    const win_rate       = total > 0 ? withScore / total : 0;
    return {
      recipe_id,
      signal_count:  total,
      true_positive,
      false_positive,
      avg_ev_score,
      win_rate,
      measured_at: new Date().toISOString(),
    };
  });

  const { error: insertError } = await supabase
    .from("recipe_performance")
    .insert(insertRows);

  if (insertError) {
    console.error("[recipe-perf] intraday insert error:", insertError.message);
  } else {
    console.log(`[recipe-perf] intraday wrote ${insertRows.length} recipe performance rows`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Deactivate wallets whose live account equity is below $1K (Dust tier). */
async function deactivateDustWallets(
  summary: CohortWalletSummary[]
): Promise<void> {
  const DUST_THRESHOLD = 1_000;
  const dustIds = summary
    .filter((w) => w.account_value < DUST_THRESHOLD)
    .map((w) => w.wallet_id);

  if (dustIds.length === 0) return;

  const { error } = await supabase
    .from("wallets")
    .update({ is_active: false })
    .in("id", dustIds);

  if (error) {
    console.error("[refresh-cohort] deactivateDustWallets error:", error.message);
  } else {
    console.log(`[refresh-cohort] deactivated ${dustIds.length} dust wallets (equity < $${DUST_THRESHOLD})`);
  }
}

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
    recipe_id:      string;
    coin:           string;
    signal_type:    string;
    direction:      string | null;
    detected_at:    string;
    ev_score:       number | null;
    wallet_id:      string;
    wallet_address: string | null;   // on-chain 0x address; null for cohort-level signals
    metadata:       Record<string, unknown>;
  }>;
}
