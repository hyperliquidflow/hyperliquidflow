// lib/hyperliquid-api-client.ts
// Typed client for the Hyperliquid public Info API.
// All calls are server-side only. Never import this file in client components.
//
// IMPORTANT: Some response shapes (notably "leaderboard") are unverified.
// Any endpoint marked UNVERIFIED will log the raw response on first call
// and throw a descriptive error if the shape doesn't match expectations.

import { HYPERLIQUID_API_URL } from "@/lib/env";
import { sleep, isValidAddress } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Error type
// ─────────────────────────────────────────────────────────────────────────────

export class HyperliquidApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    public readonly endpoint: string
  ) {
    super(`Hyperliquid API error ${status} on ${endpoint}: ${body.slice(0, 200)}`);
    this.name = "HyperliquidApiError";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Response type definitions
// All shapes are verified against official Hyperliquid docs unless noted.
// ─────────────────────────────────────────────────────────────────────────────

/** A single open position within a wallet. */
export interface HlPosition {
  coin: string;
  /** Signed position size as string (positive = long, negative = short) */
  szi: string;
  entryPx: string;
  positionValue: string;
  unrealizedPnl: string;
  returnOnEquity: string;
  liquidationPx: string | null;
  leverage: {
    type: "isolated" | "cross";
    value: number;
  };
  cumFunding: {
    allTime: string;
    sinceChange: string;
    sinceOpen: string;
  };
}

export interface HlAssetPosition {
  position: HlPosition;
  type: "oneWay";
}

export interface HlMarginSummary {
  accountValue: string;
  totalNtlPos: string;
  totalRawUsd: string;
  totalMarginUsed: string;
}

/** Response from clearinghouseState endpoint. */
export interface HlClearinghouseState {
  assetPositions: HlAssetPosition[];
  crossMarginSummary: HlMarginSummary;
  marginSummary: HlMarginSummary;
  withdrawable: string;
  time?: number;
}

/** A single fill (trade) returned by userFills / userFillsByTime. */
export interface HlUserFill {
  coin: string;
  /** Fill price as string */
  px: string;
  /** Fill size as string */
  sz: string;
  /** "B" = buy/long side, "A" = ask/sell side */
  side: "B" | "A";
  /** Unix timestamp milliseconds */
  time: number;
  startPosition: string;
  /** Human-readable direction, e.g. "Open Long" */
  dir: string;
  /**
   * Realized PnL for this fill.
   * "0" for opening fills — only non-zero on closing fills.
   */
  closedPnl: string;
  hash: string;
  oid: number;
  crossed: boolean;
  fee: string;
  tid: number;
}

/** One entry in the allMids response: coin → mid price string. */
export type HlAllMids = Record<string, string>;

/** One level in an L2 book (bid or ask). */
export interface HlBookLevel {
  px: string;
  sz: string;
  /** Number of orders at this level */
  n: number;
}

/** Response from l2Book endpoint. */
export interface HlL2Book {
  coin: string;
  time: number;
  /** levels[0] = bids (desc price), levels[1] = asks (asc price) */
  levels: [HlBookLevel[], HlBookLevel[]];
}

/** Per-asset trading context from metaAndAssetCtxs. */
export interface HlAssetCtx {
  dayNtlVlm: string;
  /** Current 1-hour funding rate as string */
  funding: string;
  impactPxs: [string, string];
  markPx: string;
  midPx: string | null;
  openInterest: string;
  oraclePx: string;
  premium: string | null;
  prevDayPx: string;
}

export interface HlMeta {
  universe: Array<{
    name: string;
    szDecimals: number;
    maxLeverage: number;
    onlyIsolated: boolean;
  }>;
}

/** Response from metaAndAssetCtxs: [meta, assetCtxs] — parallel indexed. */
export type HlMetaAndAssetCtxs = [HlMeta, HlAssetCtx[]];

/** One candle from candleSnapshot. */
export interface HlCandle {
  /** Open time ms */
  t: number;
  /** Close time ms */
  T: number;
  s: string;
  i: string;
  o: string;
  c: string;
  h: string;
  l: string;
  v: string;
  n: number;
}

/** One funding history entry. */
export interface HlFundingEntry {
  coin: string;
  /** 1-hour funding rate as string */
  fundingRate: string;
  /** Premium component */
  premium: string;
  /** Unix ms timestamp */
  time: number;
}


// ─────────────────────────────────────────────────────────────────────────────
// Core fetch wrapper with retry/backoff
// ─────────────────────────────────────────────────────────────────────────────

const MAX_RETRIES = 4;
const BASE_BACKOFF_MS = 1000;

/**
 * POST to the Hyperliquid info endpoint with typed response, timeout, and
 * exponential backoff on 429 / 5xx responses.
 *
 * @param body    Request body object (will be JSON-serialised)
 * @param timeoutMs  Abort timeout per attempt in milliseconds (default 8000)
 * @returns Parsed JSON response cast to T
 * @throws HyperliquidApiError on non-recoverable HTTP errors
 */
async function hlPost<T>(body: unknown, timeoutMs = 8000): Promise<T> {
  const endpoint = (body as Record<string, string>).type ?? "unknown";
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(HYPERLIQUID_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (res.status === 429 || res.status >= 500) {
        const waitMs = Math.min(BASE_BACKOFF_MS * 2 ** attempt, 30_000);
        console.warn(
          `[hl-api] ${endpoint} got ${res.status} on attempt ${attempt + 1}/${MAX_RETRIES + 1}. ` +
            `Retrying in ${waitMs}ms.`
        );
        await sleep(waitMs);
        lastError = new HyperliquidApiError(res.status, await res.text(), endpoint);
        continue;
      }

      if (!res.ok) {
        throw new HyperliquidApiError(res.status, await res.text(), endpoint);
      }

      return res.json() as Promise<T>;
    } catch (err) {
      clearTimeout(timer);
      if ((err as Error).name === "AbortError") {
        console.warn(`[hl-api] ${endpoint} timed out on attempt ${attempt + 1}`);
        lastError = new Error(`${endpoint} request timed out after ${timeoutMs}ms`);
        await sleep(Math.min(BASE_BACKOFF_MS * 2 ** attempt, 16_000));
        continue;
      }
      throw err; // unexpected network error — don't retry
    }
  }

  throw lastError;
}

// ─────────────────────────────────────────────────────────────────────────────
// Endpoint functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch the clearinghouse state for a single wallet.
 * Weight: 2
 *
 * @param address 0x-prefixed Ethereum address (40 hex chars)
 * @throws if address format is invalid
 */
export async function fetchClearinghouseState(
  address: string
): Promise<HlClearinghouseState> {
  if (!isValidAddress(address)) {
    throw new Error(`Invalid address: ${address}`);
  }
  return hlPost<HlClearinghouseState>({ type: "clearinghouseState", user: address });
}

/**
 * Fetch clearinghouse states for multiple wallets concurrently with
 * a capped concurrency semaphore (max 10 parallel requests).
 * Falls back to individual calls since batchClearinghouseStates
 * is not in the official public API spec.
 *
 * @param addresses Array of 0x addresses
 * @param concurrency Max parallel requests (default 10)
 * @returns Map of address → state (null if the call failed for that wallet)
 */
export async function fetchBatchClearinghouseStates(
  addresses: string[],
  concurrency = 10
): Promise<Map<string, HlClearinghouseState | null>> {
  const results = new Map<string, HlClearinghouseState | null>();
  const valid = addresses.filter(isValidAddress);

  // Simple semaphore via a running promise queue
  let active = 0;
  const queue: Array<() => void> = [];

  const acquire = (): Promise<void> =>
    new Promise((resolve) => {
      if (active < concurrency) {
        active++;
        resolve();
      } else {
        queue.push(() => {
          active++;
          resolve();
        });
      }
    });

  const release = (): void => {
    active--;
    const next = queue.shift();
    if (next) next();
  };

  await Promise.allSettled(
    valid.map(async (address) => {
      await acquire();
      try {
        const state = await fetchClearinghouseState(address);
        results.set(address, state);
      } catch (err) {
        console.error(`[hl-api] fetchClearinghouseState failed for ${address}:`, err);
        results.set(address, null);
      } finally {
        release();
      }
    })
  );

  return results;
}

/**
 * Fetch all closed fills for a wallet (no time filter).
 * Weight: 20
 *
 * @param address 0x wallet address
 */
export async function fetchUserFills(address: string): Promise<HlUserFill[]> {
  if (!isValidAddress(address)) throw new Error(`Invalid address: ${address}`);
  return hlPost<HlUserFill[]>({ type: "userFills", user: address });
}

/**
 * Fetch fills for a wallet within a time range.
 * Weight: 20
 *
 * @param address   0x wallet address
 * @param startTime Unix millisecond timestamp (inclusive)
 * @param endTime   Unix millisecond timestamp (inclusive)
 */
export async function fetchUserFillsByTime(
  address: string,
  startTime: number,
  endTime: number
): Promise<HlUserFill[]> {
  if (!isValidAddress(address)) throw new Error(`Invalid address: ${address}`);
  return hlPost<HlUserFill[]>({
    type: "userFillsByTime",
    user: address,
    startTime,
    endTime,
  });
}

/**
 * Fetch mid prices for all tradeable coins.
 * Weight: 2
 */
export async function fetchAllMids(): Promise<HlAllMids> {
  return hlPost<HlAllMids>({ type: "allMids" });
}

/**
 * Fetch the L2 order book for a coin.
 * Weight: 2
 *
 * @param coin Coin symbol, e.g. "BTC"
 */
export async function fetchL2Book(coin: string): Promise<HlL2Book> {
  return hlPost<HlL2Book>({ type: "l2Book", coin });
}

/**
 * Fetch the full asset universe with current funding rates and OI.
 * Weight: 2
 * Returns [meta, assetCtxs] where both arrays are parallel-indexed.
 */
export async function fetchMetaAndAssetCtxs(): Promise<HlMetaAndAssetCtxs> {
  return hlPost<HlMetaAndAssetCtxs>({ type: "metaAndAssetCtxs" });
}

/**
 * Fetch historical candles for a coin.
 * Weight: 20
 *
 * @param coin      Coin symbol
 * @param interval  One of: "1m","3m","5m","15m","30m","1h","2h","4h","8h","12h","1d","3d","1w","2w","1M"
 * @param startTime Unix ms
 * @param endTime   Unix ms
 */
export async function fetchCandleSnapshot(
  coin: string,
  interval: string,
  startTime: number,
  endTime: number
): Promise<HlCandle[]> {
  return hlPost<HlCandle[]>({
    type: "candleSnapshot",
    req: { coin, interval, startTime, endTime },
  });
}

/**
 * Fetch historical funding rates for a coin.
 * Weight: 20
 *
 * @param coin      Coin symbol, e.g. "BTC"
 * @param startTime Unix ms — fetch funding since this timestamp
 */
export async function fetchFundingHistory(
  coin: string,
  startTime: number
): Promise<HlFundingEntry[]> {
  return hlPost<HlFundingEntry[]>({ type: "fundingHistory", coin, startTime });
}

// Note: leaderboard discovery is handled by scripts/daily-wallet-scan.ts which
// fetches from stats-data.hyperliquid.xyz/Mainnet/leaderboard via GET.
// A { type: "leaderboard" } POST to the info API is not a valid endpoint.

// ─────────────────────────────────────────────────────────────────────────────
// Convenience helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract only closing fills (those with non-zero closedPnl) from a fills array.
 * Opening fills always have closedPnl === "0".
 */
export function closingFills(fills: HlUserFill[]): HlUserFill[] {
  return fills.filter((f) => parseFloat(f.closedPnl) !== 0);
}

/**
 * Parse a position's signed size into a direction string.
 *
 * @param szi Signed position size string from assetPositions
 */
export function positionDirection(szi: string): "LONG" | "SHORT" | "FLAT" {
  const n = parseFloat(szi);
  if (n > 0) return "LONG";
  if (n < 0) return "SHORT";
  return "FLAT";
}

/**
 * Build a lookup map of coin → HlAssetCtx from a metaAndAssetCtxs response.
 */
export function buildAssetCtxMap(
  [meta, ctxs]: HlMetaAndAssetCtxs
): Map<string, HlAssetCtx> {
  const map = new Map<string, HlAssetCtx>();
  meta.universe.forEach((asset, i) => {
    if (ctxs[i]) map.set(asset.name, ctxs[i]);
  });
  return map;
}
