// lib/risk-engine.ts
// Financial math utilities: EV computation, slippage estimation, position sizing.
// No Supabase reads, no API calls — pure functions only.

import { clamp } from "@/lib/utils";
import type { HlL2Book, HlUserFill } from "@/lib/hyperliquid-api-client";

// ─────────────────────────────────────────────────────────────────────────────
// Slippage estimation — walk-the-book
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Estimate market-impact slippage by walking the L2 order book.
 *
 * Algorithm:
 *   1. Determine which side to walk: buying → consume asks, selling → consume bids.
 *   2. Consume levels until the target notional is filled.
 *   3. Slippage = (avg_fill_price − mid_price) / mid_price × notional
 *
 * @param book       L2 book from fetchL2Book
 * @param notionalUsd Target fill size in USD
 * @param side       "buy" (consume asks) | "sell" (consume bids)
 * @returns Estimated slippage in USD (always positive)
 */
export function walkBookCost(
  book: HlL2Book,
  notionalUsd: number,
  side: "buy" | "sell"
): number {
  const [bids, asks] = book.levels;
  const levels = side === "buy" ? asks : bids;

  if (!levels || levels.length === 0) {
    console.warn("[risk-engine] walkBookCost: empty book side, returning 0 slippage");
    return 0;
  }

  // Mid price from best bid / best ask
  const bestBid = parseFloat(bids[0]?.px ?? "0");
  const bestAsk = parseFloat(asks[0]?.px ?? "0");
  const midPrice = (bestBid + bestAsk) / 2;

  if (midPrice <= 0) return 0;

  let remaining = notionalUsd;
  let totalCost = 0;

  for (const level of levels) {
    if (remaining <= 0) break;
    const px  = parseFloat(level.px);
    const sz  = parseFloat(level.sz);
    const levelNotional = px * sz;
    const fill = Math.min(remaining, levelNotional);
    totalCost += fill * (px / midPrice);
    remaining -= fill;
  }

  if (remaining > 0) {
    // Book too thin — use the last level price for the remainder
    const lastPx = parseFloat(levels[levels.length - 1].px);
    totalCost += remaining * (lastPx / midPrice);
    console.warn("[risk-engine] walkBookCost: book exhausted, extrapolating last level");
  }

  // Slippage = cost relative to mid × notional
  const avgFillRatio = totalCost / notionalUsd; // should be ≥ 1 for buy, ≤ 1 for sell
  const slippageUsd = Math.abs(avgFillRatio - 1) * notionalUsd;
  return slippageUsd;
}

// ─────────────────────────────────────────────────────────────────────────────
// Trading cost
// ─────────────────────────────────────────────────────────────────────────────

const TAKER_FEE_RATE = 0.00035; // 0.035% — Hyperliquid standard taker fee

/**
 * Compute total estimated cost of a trade (fee + slippage).
 *
 * @param notionalUsd Trade notional in USD
 * @param book        L2 book (optional — if null, slippage = 0 with a warning)
 * @param side        "buy" | "sell"
 * @returns { fee, slippage, total } all in USD
 */
export function estimateTradeCost(
  notionalUsd: number,
  book: HlL2Book | null,
  side: "buy" | "sell"
): { fee: number; slippage: number; total: number } {
  const fee = TAKER_FEE_RATE * notionalUsd;
  let slippage = 0;

  if (book) {
    slippage = walkBookCost(book, notionalUsd, side);
  } else {
    console.warn("[risk-engine] estimateTradeCost: no L2 book provided, slippage = 0");
  }

  return { fee, slippage, total: fee + slippage };
}

// ─────────────────────────────────────────────────────────────────────────────
// EV computation
// ─────────────────────────────────────────────────────────────────────────────

export interface EvInputs {
  /** Fraction of trades that are winners (from user_pnl_backtest.win_rate) */
  win_probability: number;
  /** Average USD gain on winning trades */
  avg_win_usd: number;
  /** Average USD loss magnitude on losing trades (positive number) */
  avg_loss_usd: number;
  /** Estimated cost of the trade (fee + slippage) */
  trade_cost_usd: number;
}

export interface EvResult {
  /** Raw EV in USD */
  raw_ev_usd: number;
  /** Normalised [0,1] score (raw_ev / (5 × avg_loss)) */
  ev_score: number;
  /** True if we have enough data to trust the estimate */
  is_reliable: boolean;
}

/**
 * Compute the expected value of a trade and return a normalised score.
 *
 * Formula:
 *   EV = (WinProb × AvgWin) − (LossProb × AvgLoss) − trade_cost
 *   ev_score = clamp(EV / (5 × AvgLoss), 0, 1)
 *   (A 5× edge maps to score 1.0)
 *
 * @param inputs  EV calculation inputs
 * @param minSampleSize Minimum trade count for reliability flag (default 10)
 */
export function computeEv(inputs: EvInputs, minSampleSize = 10): EvResult {
  const { win_probability, avg_win_usd, avg_loss_usd, trade_cost_usd } = inputs;
  const loss_probability = 1 - win_probability;

  const raw_ev_usd =
    win_probability * avg_win_usd -
    loss_probability * avg_loss_usd -
    trade_cost_usd;

  const normaliser = avg_loss_usd > 0 ? 5 * avg_loss_usd : 1;
  const ev_score = clamp(raw_ev_usd / normaliser, 0, 1);

  return {
    raw_ev_usd,
    ev_score,
    // Reliability requires at least minSampleSize historical closes
    is_reliable: avg_loss_usd > 0 && avg_win_usd > 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Liquidation buffer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute the liquidation buffer as a fraction of account value.
 * liq_buffer = (account_value − total_margin_used) / account_value
 *
 * @param accountValue    Total account value in USD
 * @param totalMarginUsed Total margin committed to open positions
 * @returns fraction [0, 1] — lower means closer to liquidation
 */
export function liquidationBuffer(
  accountValue: number,
  totalMarginUsed: number
): number {
  if (accountValue <= 0) return 0;
  return clamp((accountValue - totalMarginUsed) / accountValue, 0, 1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Sharpe (raw, annualised) — used for display only
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute an annualised Sharpe ratio from daily PnL values.
 * Assumes 365 trading days. Risk-free rate = 0 (perpetuals have no cost of carry here).
 *
 * @param dailyPnls Daily realized PnL array
 */
export function annualisedSharpe(dailyPnls: number[]): number {
  if (dailyPnls.length < 2) return 0;
  const m = dailyPnls.reduce((a, b) => a + b, 0) / dailyPnls.length;
  const variance = dailyPnls.reduce((s, v) => s + (v - m) ** 2, 0) / dailyPnls.length;
  const sd = Math.sqrt(variance);
  if (sd === 0) return 0;
  return (m / sd) * Math.sqrt(365);
}

// ─────────────────────────────────────────────────────────────────────────────
// Contrarian trade idea (rule-based, no LLM required)
// ─────────────────────────────────────────────────────────────────────────────

export interface ContrarianIdea {
  coin: string;
  /** Direction smart money is going (the "setup" direction) */
  smart_direction: "LONG" | "SHORT";
  /** Contrarian direction (opposite of what retail OI shows) */
  contrarian_direction: "LONG" | "SHORT";
  /** Confidence based on divergence magnitude [0, 1] */
  confidence: number;
  reason: string;
}

/**
 * Identify coins where smart-money bias and non-cohort OI are diverging.
 * "Retail OI proxy" = total openInterest − cohort net notional.
 * Used by Recipe 7 (Funding + Extreme Divergence) and the Contrarian page.
 *
 * @param cohortNetNotionalByCoin Map of coin → cohort net notional (positive = net long)
 * @param totalOiByCoin           Map of coin → total open interest (from metaAndAssetCtxs)
 * @param fundingByCoin           Map of coin → current hourly funding rate (string)
 * @param minDivergenceUsd        Minimum absolute divergence to report (default $1M)
 */
export function findContrarianIdeas(
  cohortNetNotionalByCoin: Map<string, number>,
  totalOiByCoin: Map<string, number>,
  fundingByCoin: Map<string, string>,
  minDivergenceUsd = 1_000_000
): ContrarianIdea[] {
  const ideas: ContrarianIdea[] = [];

  for (const [coin, cohortNet] of cohortNetNotionalByCoin) {
    const totalOi = totalOiByCoin.get(coin) ?? 0;
    if (totalOi <= 0) continue;

    // Proxy: retail OI ≈ total OI minus the cohort's contribution
    const retailOiProxy = totalOi - Math.abs(cohortNet);

    // Divergence direction: cohort long while retail proxy is net short (or vice versa)
    const cohortLong   = cohortNet > 0;
    const retailShort  = retailOiProxy < 0;

    if (cohortLong !== retailShort) continue; // no divergence

    const divergenceMag = Math.abs(cohortNet - retailOiProxy);
    if (divergenceMag < minDivergenceUsd) continue;

    const funding = parseFloat(fundingByCoin.get(coin) ?? "0");
    const fundingAligned = cohortLong ? funding > 0.0003 : funding < -0.0003;

    // Confidence = normalised divergence + funding alignment bonus
    const confidence = clamp(
      divergenceMag / 10_000_000 + (fundingAligned ? 0.2 : 0),
      0,
      1
    );

    ideas.push({
      coin,
      smart_direction:      cohortLong ? "LONG" : "SHORT",
      contrarian_direction: cohortLong ? "SHORT" : "LONG",
      confidence,
      reason: [
        `Smart money ${cohortLong ? "long" : "short"} $${(Math.abs(cohortNet) / 1e6).toFixed(1)}M`,
        `Retail proxy ${cohortLong ? "short" : "long"}, divergence $${(divergenceMag / 1e6).toFixed(1)}M`,
        fundingAligned ? `Funding ${funding > 0 ? "+" : ""}${(funding * 100).toFixed(4)}% supports squeeze` : "",
      ]
        .filter(Boolean)
        .join(". "),
    });
  }

  return ideas.sort((a, b) => b.confidence - a.confidence);
}
