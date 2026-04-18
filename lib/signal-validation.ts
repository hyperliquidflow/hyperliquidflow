// lib/signal-validation.ts
// Pure functions for per-wallet and per-signal regime fit scoring.
// No I/O -- all inputs are plain data.

/**
 * How well does one wallet perform in the current regime, relative to its
 * own regime spread?
 *
 * Returns [0, 1] where 1 = current regime is this wallet's best, 0 = worst.
 * Returns null when all three regime pnl values are null (no profile data).
 * Returns 0.5 when best === worst (wallet doesn't differentiate across regimes).
 */
export function computeWalletRegimeFit(
  bullPnl:       number | null,
  bearPnl:       number | null,
  rangingPnl:    number | null,
  currentRegime: "BULL" | "BEAR" | "RANGING",
): number | null {
  const lookup: Record<"BULL" | "BEAR" | "RANGING", number | null> = {
    BULL:    bullPnl,
    BEAR:    bearPnl,
    RANGING: rangingPnl,
  };
  const currentPnl = lookup[currentRegime];

  const available = [bullPnl, bearPnl, rangingPnl].filter(
    (v): v is number => v !== null,
  );
  if (available.length === 0) return null;

  const best  = Math.max(...available);
  const worst = Math.min(...available);

  if (best === worst) return 0.5;

  // If the current regime has no pnl data, treat as worst case
  const pnl = currentPnl ?? worst;
  const raw = (pnl - worst) / (best - worst);
  return Math.max(0, Math.min(1, raw));
}

/**
 * Aggregate fit score for a multi-wallet signal.
 * Returns the mean of all non-null per-wallet fits, or null if none are available.
 */
export function computeSignalRegimeFit(
  walletFits: (number | null)[],
): number | null {
  const valid = walletFits.filter((v): v is number => v !== null);
  if (valid.length === 0) return null;
  return valid.reduce((s, v) => s + v, 0) / valid.length;
}

/**
 * Bucket a fit score into a human-readable tier.
 * LOW < 0.33, MID 0.33-0.67, HIGH >= 0.67
 */
export function regimeFitLabel(fit: number | null): "HIGH" | "MID" | "LOW" | null {
  if (fit === null) return null;
  if (fit >= 0.67) return "HIGH";
  if (fit >= 0.33) return "MID";
  return "LOW";
}
