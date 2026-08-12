// lib/slippage.ts
//
// What it costs to actually get filled, as a function of size.
//
// Every edge this project has measured is quoted in basis points per day on an
// unspecified amount of capital, and both external reviews of the 2026-08-12
// audit made the same point: a 39 bps daily edge is coffee money on a small
// book and impossible on a large one, so the number is meaningless until the
// capital it survives at is known. The measured leads trade a handful of alt
// perpetuals with thin books, rebalanced daily, which is exactly where a
// paper edge dies on contact.
//
// This walks a real order book level by level and reports the average
// execution price against the mid. Pure, so it can be tested against known
// books rather than trusted.

export interface BookLevel {
  /** price */
  px: number;
  /** size available at this price, in coin units */
  sz: number;
}

export interface FillEstimate {
  /** Size-weighted average execution price. */
  avgPx: number;
  /** Cost against the mid, in basis points, always positive. */
  slippageBps: number;
  /** Notional actually fillable, which is less than requested on a thin book. */
  filledUsd: number;
  /** True when the book ran out before the order did. */
  exhausted: boolean;
}

/**
 * Walk one side of the book until `notionalUsd` is filled.
 *
 * Levels must be ordered best-price-first: ascending for asks (a buy), and
 * descending for bids (a sell). A book that runs out reports what it could
 * fill and flags it, rather than silently pricing the unfillable remainder at
 * the last level, which would understate the cost of size.
 */
export function walkBook(
  levels: readonly BookLevel[],
  notionalUsd: number,
  mid: number,
  side: "buy" | "sell",
): FillEstimate | null {
  if (!levels.length || notionalUsd <= 0 || mid <= 0) return null;

  let remaining = notionalUsd;
  let coins = 0;
  let spent = 0;

  for (const level of levels) {
    if (remaining <= 0) break;
    if (!(level.px > 0) || !(level.sz > 0)) continue;
    const levelUsd = level.px * level.sz;
    const take = Math.min(remaining, levelUsd);
    coins += take / level.px;
    spent += take;
    remaining -= take;
  }

  if (coins <= 0) return null;
  const avgPx = spent / coins;
  // A buy fills above the mid and a sell below it; both are a cost.
  const raw = side === "buy" ? (avgPx - mid) / mid : (mid - avgPx) / mid;
  return {
    avgPx,
    slippageBps: raw * 10_000,
    filledUsd: spent,
    exhausted: remaining > 1e-9,
  };
}

/**
 * Round-trip cost of holding one name at a given size: in and out, both sides
 * crossing the spread, plus the taker fee on each side.
 */
export function roundTripCostBps(
  bids: readonly BookLevel[],
  asks: readonly BookLevel[],
  notionalUsd: number,
  mid: number,
  feeBpsPerSide: number,
): { totalBps: number; exhausted: boolean } | null {
  const inLeg = walkBook(asks, notionalUsd, mid, "buy");
  const outLeg = walkBook(bids, notionalUsd, mid, "sell");
  if (!inLeg || !outLeg) return null;
  return {
    totalBps: inLeg.slippageBps + outLeg.slippageBps + 2 * feeBpsPerSide,
    exhausted: inLeg.exhausted || outLeg.exhausted,
  };
}
