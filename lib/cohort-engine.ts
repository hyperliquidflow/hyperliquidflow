// lib/cohort-engine.ts
// Scores each tracked wallet using a four-factor model.
// Reads fills from Supabase (user_pnl_backtest) and live positions
// from cohort_snapshots. Called by the 60-second Vercel cron.

import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "@/lib/env";
import { clamp, stddev, mean, groupBy } from "@/lib/utils";
import type { HlUserFill, HlAllMids, HlClearinghouseState } from "@/lib/hyperliquid-api-client";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface CohortScores {
  sharpe_proxy:    number; // [0,1]
  pnl_consistency: number; // [0,1]
  drawdown_score:  number; // [0,1]
  regime_fit:      number; // [0,1]
  overall_score:   number; // [0,1]
}

export interface WalletBacktest {
  win_rate:          number;
  avg_win_usd:       number;
  avg_loss_usd:      number;
  profit_factor:     number;
  total_trades:      number;
  total_pnl_usd:     number;
  max_drawdown_pct:  number;
  sharpe_ratio:      number;
  current_win_streak:  number;
  current_loss_streak: number;
  max_win_streak:      number;
  daily_pnls:        number[]; // raw 30-day array for scoring
}

export interface RegimeDetection {
  regime: "BULL" | "BEAR" | "RANGING";
  btc_return_24h: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Wallet Tier Classification
// ─────────────────────────────────────────────────────────────────────────────

export type EquityTier =
  | "Elite"
  | "Major"
  | "Large"
  | "Mid"
  | "Small"
  | "Micro"
  | "Dust";

/**
 * Classify a wallet by account equity into one of 7 tiers.
 * Returns null if accountValue is null, undefined, or negative.
 *
 * Thresholds:
 *   Elite    $5M+
 *   Major    $1M - $5M
 *   Large    $500K - $1M
 *   Mid      $100K - $500K
 *   Small    $50K - $100K
 *   Micro    $1K - $50K
 *   Dust     under $1K
 */
export function getEquityTier(accountValue: number | null | undefined): EquityTier | null {
  if (accountValue == null || accountValue < 0) return null;
  if (accountValue >= 5_000_000) return "Elite";
  if (accountValue >= 1_000_000) return "Major";
  if (accountValue >= 500_000)   return "Large";
  if (accountValue >= 100_000)   return "Mid";
  if (accountValue >= 50_000)    return "Small";
  if (accountValue >= 1_000)     return "Micro";
  return "Dust";
}

// ─────────────────────────────────────────────────────────────────────────────
// Factor 1 — sharpe_proxy
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute a normalised Sharpe proxy from a 30-day daily PnL series.
 * Formula:
 *   raw_sharpe = mean(daily_pnls) / (stddev(daily_pnls) + ε)
 *   sharpe_proxy = clamp(raw_sharpe / 3.0, 0, 1)
 * Mapping: Sharpe ≥ 3 → score 1.0 | Sharpe 0 → 0.0 | negative → 0.0
 *
 * @param dailyPnls Array of per-day realized PnL values (may include zeros)
 */
export function computeSharpeProxy(dailyPnls: number[]): number {
  if (dailyPnls.length === 0) return 0;
  const m = mean(dailyPnls);
  const s = stddev(dailyPnls);
  const raw = m / (s + 0.0001);
  return clamp(raw / 3.0, 0, 1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Factor 2 — pnl_consistency
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fraction of 7-day windows (non-overlapping, 4 within 30 days) with positive PnL.
 * Formula:
 *   Split daily_pnls into 4 windows of 7 days.
 *   pnl_consistency = count(windows where sum > 0) / count(windows with data)
 *
 * @param dailyPnls Array of 30 daily PnL values (index 0 = oldest day)
 */
export function computePnlConsistency(dailyPnls: number[]): number {
  const WINDOW = 7;
  const TOTAL = 30;
  let positiveWindows = 0;
  let totalWindows = 0;

  for (let start = 0; start < TOTAL; start += WINDOW) {
    const slice = dailyPnls.slice(start, start + WINDOW);
    if (slice.length === 0) continue;
    const hasData = slice.some((v) => v !== 0);
    if (!hasData) continue;
    totalWindows++;
    if (slice.reduce((a, b) => a + b, 0) > 0) positiveWindows++;
  }

  return totalWindows > 0 ? positiveWindows / totalWindows : 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Factor 3 — drawdown_score
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 1 − max_drawdown_fraction from the cumulative 30-day PnL curve.
 * Formula:
 *   Build cumulative PnL series.
 *   max_drawdown = max (peak − trough) / (|peak| + ε) over all peaks.
 *   drawdown_score = clamp(1 − max_drawdown, 0, 1)
 *
 * @param dailyPnls Array of per-day realized PnL values (chronological)
 */
export function computeDrawdownScore(dailyPnls: number[]): number {
  if (dailyPnls.length === 0) return 0;

  // Build cumulative series
  const cumulative: number[] = [];
  let running = 0;
  for (const pnl of dailyPnls) {
    running += pnl;
    cumulative.push(running);
  }

  let peak = -Infinity;
  let maxDrawdown = 0;

  for (const value of cumulative) {
    if (value > peak) peak = value;
    if (peak <= 0) continue; // no meaningful peak yet
    const dd = (peak - value) / (Math.abs(peak) + 0.0001);
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  return clamp(1 - maxDrawdown, 0, 1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Factor 4 — regime_fit
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detect the current market regime from a 24-hour BTC price delta.
 *
 * @param allMids Current allMids snapshot (coin → price string)
 * @param prevBtcMid BTC mid price 24h ago (from stored snapshot)
 */
export function detectRegime(
  currentBtcMid: number,
  prevBtcMid: number
): RegimeDetection {
  const btc_return_24h =
    prevBtcMid > 0 ? (currentBtcMid - prevBtcMid) / prevBtcMid : 0;

  let regime: "BULL" | "BEAR" | "RANGING";
  if (btc_return_24h > 0.01)       regime = "BULL";
  else if (btc_return_24h < -0.01) regime = "BEAR";
  else                              regime = "RANGING";

  return { regime, btc_return_24h };
}

/**
 * Score how well a wallet's open-position bias aligns with the detected regime.
 *
 * @param state    Current clearinghouseState for the wallet
 * @param regime   Detected market regime
 */
export function computeRegimeFit(
  state: HlClearinghouseState,
  regime: RegimeDetection["regime"]
): number {
  const positions = state.assetPositions;
  if (positions.length === 0) return 0.5; // neutral — no penalty for flat wallets

  let netDelta = 0;
  let totalNotional = 0;

  for (const { position } of positions) {
    const szi = parseFloat(position.szi);
    const val = parseFloat(position.positionValue);
    netDelta     += (szi > 0 ? 1 : -1) * Math.abs(val);
    totalNotional += Math.abs(val);
  }

  const bias = totalNotional > 0 ? netDelta / (totalNotional + 0.0001) : 0; // [-1, 1]

  switch (regime) {
    case "BULL":    return clamp((bias + 1) / 2, 0, 1);       // rewards long bias
    case "BEAR":    return clamp((1 - bias) / 2, 0, 1);       // rewards short bias
    case "RANGING": return clamp(1 - Math.abs(bias), 0, 1);   // rewards neutral bias
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Aggregate score
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute all four sub-scores and the weighted overall score.
 * Weights: sharpe 35% | consistency 25% | drawdown 25% | regime 15%
 *
 * @param dailyPnls   30-element array of per-day PnL (index 0 = oldest)
 * @param state       Current clearinghouseState snapshot
 * @param regime      Detected market regime
 */
export function computeCohortScores(
  dailyPnls: number[],
  state: HlClearinghouseState,
  regime: RegimeDetection["regime"]
): CohortScores {
  const sharpe_proxy    = computeSharpeProxy(dailyPnls);
  const pnl_consistency = computePnlConsistency(dailyPnls);
  const drawdown_score  = computeDrawdownScore(dailyPnls);
  const regime_fit      = computeRegimeFit(state, regime);

  const overall_score = clamp(
    0.35 * sharpe_proxy +
    0.25 * pnl_consistency +
    0.25 * drawdown_score +
    0.15 * regime_fit,
    0,
    1
  );

  return { sharpe_proxy, pnl_consistency, drawdown_score, regime_fit, overall_score };
}

// ─────────────────────────────────────────────────────────────────────────────
// Backtest computation from fills
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a 30-day backtest from a fills array.
 * Only closing fills (closedPnl !== "0") are counted.
 *
 * @param fills       All fills for this wallet (any time range)
 * @param windowMs    Backtest window in milliseconds (default 30 days)
 */
export function computeBacktest(
  fills: HlUserFill[],
  windowMs = 30 * 24 * 60 * 60 * 1000
): WalletBacktest {
  const cutoff = Date.now() - windowMs;
  const closing = fills.filter(
    (f) => f.time >= cutoff && parseFloat(f.closedPnl) !== 0
  );

  // Group by UTC day → sum daily PnL
  const byDay = groupBy(closing, (f) =>
    new Date(f.time).toISOString().slice(0, 10)
  );
  const sortedDays = Object.keys(byDay).sort();

  // Build 30-slot array (index 0 = 30 days ago)
  const daily_pnls: number[] = new Array(30).fill(0);
  const today = new Date();
  for (const day of sortedDays) {
    const daysAgo = Math.floor(
      (today.getTime() - new Date(day).getTime()) / 86_400_000
    );
    if (daysAgo >= 0 && daysAgo < 30) {
      daily_pnls[29 - daysAgo] = byDay[day].reduce(
        (s, f) => s + parseFloat(f.closedPnl),
        0
      );
    }
  }

  // Win/loss stats
  const winFills  = closing.filter((f) => parseFloat(f.closedPnl) > 0);
  const lossFills = closing.filter((f) => parseFloat(f.closedPnl) < 0);

  const total_trades = closing.length;
  const win_rate     = total_trades > 0 ? winFills.length / total_trades : 0;
  const avg_win_usd  = winFills.length  > 0
    ? winFills.reduce((s, f) => s + parseFloat(f.closedPnl), 0) / winFills.length
    : 0;
  const avg_loss_usd = lossFills.length > 0
    ? Math.abs(lossFills.reduce((s, f) => s + parseFloat(f.closedPnl), 0) / lossFills.length)
    : 0;
  const total_pnl_usd = closing.reduce((s, f) => s + parseFloat(f.closedPnl), 0);

  const totalWin  = winFills.reduce((s, f) => s + parseFloat(f.closedPnl), 0);
  const totalLoss = Math.abs(lossFills.reduce((s, f) => s + parseFloat(f.closedPnl), 0));
  const profit_factor = totalLoss > 0 ? totalWin / totalLoss : totalWin > 0 ? Infinity : 0;

  const max_drawdown_pct = computeDrawdownScore(daily_pnls); // stored inverse — 1-dd
  const sharpe_ratio     = computeSharpeProxy(daily_pnls);   // normalised

  // Streak tracking (sorted chronologically)
  const chronological = [...closing].sort((a, b) => a.time - b.time);
  let curWin = 0, curLoss = 0, maxWin = 0;
  for (const f of chronological) {
    if (parseFloat(f.closedPnl) > 0) {
      curWin++;
      curLoss = 0;
      if (curWin > maxWin) maxWin = curWin;
    } else {
      curLoss++;
      curWin = 0;
    }
  }

  return {
    win_rate,
    avg_win_usd,
    avg_loss_usd,
    profit_factor,
    total_trades,
    total_pnl_usd,
    max_drawdown_pct: 1 - max_drawdown_pct, // back to drawdown fraction
    sharpe_ratio,
    current_win_streak:  curWin,
    current_loss_streak: curLoss,
    max_win_streak:      maxWin,
    daily_pnls,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Supabase persistence helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Upsert a wallet's backtest results into user_pnl_backtest.
 *
 * @param walletId  Supabase UUID
 * @param backtest  Computed backtest object
 */
export async function saveBacktest(
  walletId: string,
  backtest: WalletBacktest
): Promise<void> {
  const { error } = await supabase.from("user_pnl_backtest").upsert({
    wallet_id:           walletId,
    computed_at:         new Date().toISOString(),
    win_rate:            backtest.win_rate,
    avg_win_usd:         backtest.avg_win_usd,
    avg_loss_usd:        backtest.avg_loss_usd,
    profit_factor:       isFinite(backtest.profit_factor) ? backtest.profit_factor : 999,
    total_trades:        backtest.total_trades,
    total_pnl_usd:       backtest.total_pnl_usd,
    max_drawdown_pct:    backtest.max_drawdown_pct,
    sharpe_ratio:        backtest.sharpe_ratio,
    current_win_streak:  backtest.current_win_streak,
    current_loss_streak: backtest.current_loss_streak,
    max_win_streak:      backtest.max_win_streak,
  });

  if (error) {
    console.error(`[cohort-engine] saveBacktest failed for ${walletId}:`, error.message);
  }
}

/**
 * Fetch all active wallets from Supabase.
 * @returns Array of { id, address } rows
 */
export async function fetchActiveWallets(): Promise<Array<{ id: string; address: string }>> {
  const { data, error } = await supabase
    .from("wallets")
    .select("id, address")
    .eq("is_active", true)
    .order("win_rate", { ascending: false });

  if (error) throw new Error(`fetchActiveWallets failed: ${error.message}`);
  return data ?? [];
}

/**
 * Write a new cohort snapshot row to Supabase.
 *
 * @param walletId Supabase UUID
 * @param state    Current clearinghouseState
 * @param scores   Computed CohortScores
 */
export async function saveCohortSnapshot(
  walletId: string,
  state: HlClearinghouseState,
  scores: CohortScores
): Promise<void> {
  const ms = state.marginSummary;
  const accountValue    = parseFloat(ms.accountValue);
  const totalMarginUsed = parseFloat(ms.totalMarginUsed);
  const liqBuffer =
    accountValue > 0
      ? (accountValue - totalMarginUsed) / accountValue
      : null;

  const { error } = await supabase.from("cohort_snapshots").insert({
    wallet_id:         walletId,
    snapshot_time:     new Date().toISOString(),
    account_value:     accountValue,
    total_notional:    parseFloat(ms.totalNtlPos),
    total_margin_used: totalMarginUsed,
    unrealized_pnl:    state.assetPositions.reduce(
      (s, ap) => s + parseFloat(ap.position.unrealizedPnl),
      0
    ),
    withdrawable:      parseFloat(state.withdrawable),
    liq_buffer_pct:    liqBuffer,
    position_count:    state.assetPositions.length,
    positions:         state.assetPositions,
    equity_tier:       getEquityTier(accountValue),
    overall_score:     scores.overall_score,
    sharpe_proxy:      scores.sharpe_proxy,
    drawdown_score:    scores.drawdown_score,
    pnl_consistency:   scores.pnl_consistency,
    regime_fit:        scores.regime_fit,
  });

  if (error) {
    console.error(`[cohort-engine] saveCohortSnapshot failed for ${walletId}:`, error.message);
  }
}

/**
 * Deactivate wallets whose overall_score has fallen below the pruning threshold.
 * Minimum cohort floor: the top 3 by score are always retained regardless.
 *
 * @param PRUNE_THRESHOLD Wallets below this score are deactivated (default 0.35)
 * @param MIN_COHORT      Minimum wallets to keep active (default 4)
 */
export async function pruneUnderperformers(
  PRUNE_THRESHOLD = 0.35,
  MIN_COHORT = 4
): Promise<void> {
  // Get latest scores for all active wallets
  const { data: snapshots, error } = await supabase
    .from("cohort_snapshots")
    .select("wallet_id, overall_score, snapshot_time")
    .order("snapshot_time", { ascending: false });

  if (error || !snapshots) return;

  // Keep only the most recent snapshot per wallet
  const latestByWallet = new Map<string, number>();
  for (const snap of snapshots) {
    if (!latestByWallet.has(snap.wallet_id)) {
      latestByWallet.set(snap.wallet_id, snap.overall_score ?? 0);
    }
  }

  // Sort descending by score
  const sorted = [...latestByWallet.entries()].sort((a, b) => b[1] - a[1]);

  // Always keep top MIN_COHORT
  const toDeactivate = sorted
    .slice(MIN_COHORT)
    .filter(([, score]) => score < PRUNE_THRESHOLD)
    .map(([walletId]) => walletId);

  if (toDeactivate.length === 0) return;

  const { error: updateError } = await supabase
    .from("wallets")
    .update({ is_active: false })
    .in("id", toDeactivate);

  if (updateError) {
    console.error("[cohort-engine] pruneUnderperformers error:", updateError.message);
  } else {
    console.log(`[cohort-engine] deactivated ${toDeactivate.length} underperforming wallets`);
  }
}
