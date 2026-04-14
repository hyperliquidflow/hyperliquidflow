// lib/hypurrscan-api-client.ts
// Typed client for the Hypurrscan public API (https://api.hypurrscan.io).
// Rate limit: 1000 weight / minute / IP. Endpoint weights noted per function.
// All calls are server-side only. Never import in client components.

import { HYPURRSCAN_API_URL } from "@/lib/env";

// ─────────────────────────────────────────────────────────────────────────────
// Error type
// ─────────────────────────────────────────────────────────────────────────────

export class HypurrscanApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    public readonly endpoint: string
  ) {
    super(`Hypurrscan API error ${status} on ${endpoint}: ${body.slice(0, 200)}`);
    this.name = "HypurrscanApiError";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Response types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map of address → human-readable label for known entities.
 * Community-maintained: includes CEXes, deployers, fund wallets, burn addresses.
 * Loaded once per day and cached in KV.
 */
export type HsGlobalAliases = Record<string, string>;

/**
 * Map of address → array of tag strings for that address.
 * Returned by POST /tags/addresses (batch lookup).
 */
export type HsTagsMap = Record<string, string[]>;

/**
 * A single bridge or transfer transaction from the L1 ledger.
 * Action type varies: "withdraw3", "VoteEthDepositAction", "spotSend",
 * "subAccountTransfer", "usdClassTransfer".
 */
export interface HsL1Transaction {
  time: number;
  user: string;
  action: {
    type: string;
    [key: string]: unknown;
  };
  block: number;
  hash: string;
  error: string | null;
}

/**
 * A single TWAP order record.
 */
export interface HsTwapRecord {
  time: number;
  user: string;
  action: {
    type: string;
    [key: string]: unknown;
  };
  block: number;
  hash: string;
  error: string | null;
  ended: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Entity classification
// ─────────────────────────────────────────────────────────────────────────────

export type EntityType =
  | "cex"        // centralised exchange wallet
  | "deployer"   // token deployer / dev wallet
  | "protocol"   // burn address, liquidator, protocol-internal
  | "gambling"   // labelled gambling wallet
  | "fund"       // known fund, treasury, or trading firm
  | "known"      // labelled but doesn't fit above categories
  | "unknown";   // no label found

/**
 * Classify an address label string into an EntityType.
 * Called with labels from /globalAliases or /tags.
 */
export function classifyEntityLabel(label: string): EntityType {
  const l = label.toLowerCase();
  if (/bybit|binance|kucoin|gate\.io|okx|coinbase|kraken|bitfinex|huobi|mexc|bitget|deribit/.test(l))
    return "cex";
  if (/deployer|dev wallet|\bdev\b/.test(l))
    return "deployer";
  if (/burn|liquidat|hip-2|airdrop/.test(l))
    return "protocol";
  if (/gambl/.test(l))
    return "gambling";
  if (/fund|treasury|capital|trading firm|research/.test(l))
    return "fund";
  return "known";
}

/**
 * Resolve entity type for an address given the global aliases map.
 * Returns "unknown" if the address has no alias.
 */
export function resolveEntityType(
  address: string,
  aliases: HsGlobalAliases
): { entity_type: EntityType; entity_label: string | null } {
  const label = aliases[address.toLowerCase()] ?? aliases[address];
  if (!label) return { entity_type: "unknown", entity_label: null };
  return { entity_type: classifyEntityLabel(label), entity_label: label };
}

// ─────────────────────────────────────────────────────────────────────────────
// Rolling weight budget (1000 weight / 60 seconds / process)
// ─────────────────────────────────────────────────────────────────────────────

const WEIGHT_LIMIT = 1000;
const WINDOW_MS    = 60_000;

// Timestamps of weight units consumed in the current window
const weightLog: number[] = [];

/**
 * Consume `weight` units from the rolling budget.
 * If the window is full, waits until enough units expire before returning.
 */
export async function consumeWeight(weight: number): Promise<void> {
  const now = () => Date.now();

  // Purge expired entries
  const prune = (): void => {
    const cutoff = now() - WINDOW_MS;
    while (weightLog.length > 0 && weightLog[0] < cutoff) weightLog.shift();
  };

  prune();

  while (weightLog.length + weight > WEIGHT_LIMIT) {
    // Wait until the oldest entry expires
    const waitMs = weightLog[0] + WINDOW_MS - now() + 10;
    await new Promise((r) => setTimeout(r, Math.max(waitMs, 50)));
    prune();
  }

  const ts = now();
  for (let i = 0; i < weight; i++) weightLog.push(ts);
}

// ─────────────────────────────────────────────────────────────────────────────
// Core GET wrapper
// ─────────────────────────────────────────────────────────────────────────────

const MAX_RETRIES    = 3;
const BASE_BACKOFF   = 1000;

async function hsGet<T>(path: string, weight: number, timeoutMs = 10_000): Promise<T> {
  await consumeWeight(weight);

  const url = `${HYPURRSCAN_API_URL}${path}`;
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.status === 429 || res.status >= 500) {
        const wait = Math.min(BASE_BACKOFF * 2 ** attempt, 30_000);
        console.warn(`[hs-api] ${path} got ${res.status} (attempt ${attempt + 1}). Retry in ${wait}ms.`);
        lastError = new HypurrscanApiError(res.status, await res.text(), path);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }

      if (!res.ok) {
        throw new HypurrscanApiError(res.status, await res.text(), path);
      }

      return res.json() as Promise<T>;
    } catch (err) {
      clearTimeout(timer);
      if ((err as Error).name === "AbortError") {
        lastError = new Error(`${path} timed out after ${timeoutMs}ms`);
        await new Promise((r) => setTimeout(r, Math.min(BASE_BACKOFF * 2 ** attempt, 16_000)));
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}

// ─────────────────────────────────────────────────────────────────────────────
// Endpoint functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch the full global alias map: address → label.
 * Weight: 1. Intended for once-per-day caching.
 */
export async function fetchGlobalAliases(): Promise<HsGlobalAliases> {
  return hsGet<HsGlobalAliases>("/globalAliases", 1);
}

/**
 * Batch-fetch tags for an array of addresses.
 * Weight: 4 per call. Pass all addresses in a single POST body.
 * NOTE: This endpoint is POST, not GET — handled separately from hsGet.
 */
export async function fetchTagsBatch(addresses: string[]): Promise<HsTagsMap> {
  await consumeWeight(4);

  const url = `${HYPURRSCAN_API_URL}/tags/addresses`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ addresses }),
  });

  if (!res.ok) {
    throw new HypurrscanApiError(res.status, await res.text(), "/tags/addresses");
  }
  return res.json() as Promise<HsTagsMap>;
}

/**
 * Register an address with Hypurrscan's tracking index.
 * Call this once per wallet during bootstrap. Response: "Added" | "Already there".
 * Weight: 1.
 */
export async function addAddressToIndex(address: string): Promise<string> {
  return hsGet<string>(`/addAddress/${address}`, 1);
}

/**
 * Fetch the most recent bridge deposit/withdrawal transactions.
 * Covers ETH, Arbitrum, BSC, Polygon activity.
 * Weight: 1.
 */
export async function fetchRecentBridges(): Promise<HsL1Transaction[]> {
  return hsGet<HsL1Transaction[]>("/bridges", 1);
}

/**
 * Fetch the most recent L1 transfer transactions.
 * Covers subAccountTransfer, spotSend, usdClassTransfer.
 * Weight: 1.
 */
export async function fetchRecentTransfers(): Promise<HsL1Transaction[]> {
  return hsGet<HsL1Transaction[]>("/transfers", 1);
}

/**
 * Fetch TWAP orders for a specific wallet address.
 * Weight: 1 (by address).
 */
export async function fetchTwapByAddress(address: string): Promise<HsTwapRecord[]> {
  return hsGet<HsTwapRecord[]>(`/twap/${address}`, 1);
}
