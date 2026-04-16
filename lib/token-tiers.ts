// lib/token-tiers.ts
// Coin tier classification for threshold scaling.
// MAJOR: BTC, ETH — full thresholds apply.
// LARGE: liquid alts (SOL, HYPE, ARB, AVAX, DOGE, SUI) — 50% by default.
// SMALL: everything else — 20% by default.

export type CoinTier = "MAJOR" | "LARGE" | "SMALL";

export const MAJOR_COINS = new Set(["BTC", "ETH"]);
export const LARGE_COINS = new Set(["SOL", "HYPE", "ARB", "AVAX", "DOGE", "SUI"]);

export function getCoinTier(coin: string): CoinTier {
  if (MAJOR_COINS.has(coin)) return "MAJOR";
  if (LARGE_COINS.has(coin)) return "LARGE";
  return "SMALL";
}

/**
 * Scale a notional threshold by coin tier.
 * Pass largeMult / smallMult from agent_config so the learning agent can tune them.
 */
export function tieredNotional(
  base: number,
  coin: string,
  largeMult = 0.5,
  smallMult = 0.2,
): number {
  const tier = getCoinTier(coin);
  if (tier === "MAJOR") return base;
  if (tier === "LARGE") return base * largeMult;
  return base * smallMult;
}
