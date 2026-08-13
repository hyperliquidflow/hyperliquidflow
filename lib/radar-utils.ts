// lib/radar-utils.ts
// Pure bucketing/aggregation helpers for the Market Radar view.
// No I/O. All inputs are plain numbers; callers parse HL string fields upstream.

import type { HlAssetPosition } from "./hyperliquid-api-client";

export const BUCKET_COUNT = 40;
export const RANGE_PCT = 0.3;  // +/- 30% of current price

export interface RadarPosition {
  szi: number;
  entryPx: number;
  positionValue: number;
  liquidationPx: number | null;
}

export interface RadarBucket {
  price_low:        number;
  price_high:       number;
  long_count:       number;
  short_count:      number;
  long_notional:    number;
  short_notional:   number;
}

export interface RadarStats {
  total_positions:       number;
  total_long_notional:   number;
  total_short_notional:  number;
  avg_long_entry:        number | null;
  avg_short_entry:       number | null;
}

export interface RadarResponse {
  asset:         string;
  current_price: number;
  price_range:   { min: number; max: number };
  buckets:       RadarBucket[];
  stats:         RadarStats;
  top_assets:    string[];
  /** Newest snapshot time behind these buckets. Absent on older cached payloads. */
  updated_at?:   string | null;
}

function makeEmptyBuckets(min: number, max: number): RadarBucket[] {
  const width = (max - min) / BUCKET_COUNT;
  return Array.from({ length: BUCKET_COUNT }, (_, i) => ({
    price_low:       min + i * width,
    price_high:      min + (i + 1) * width,
    long_count:      0,
    short_count:     0,
    long_notional:   0,
    short_notional:  0,
  }));
}

function bucketIndex(price: number, min: number, max: number): number {
  const width = (max - min) / BUCKET_COUNT;
  if (width <= 0) return 0;
  const idx = Math.floor((price - min) / width);
  if (idx < 0) return 0;
  if (idx >= BUCKET_COUNT) return BUCKET_COUNT - 1;
  return idx;
}

export function bucketPositions(
  positions: RadarPosition[],
  currentPrice: number,
): RadarBucket[] {
  if (!(currentPrice > 0)) {
    return makeEmptyBuckets(0, 1);
  }
  const min = currentPrice * (1 - RANGE_PCT);
  const max = currentPrice * (1 + RANGE_PCT);
  const buckets = makeEmptyBuckets(min, max);

  for (const p of positions) {
    const isLong = p.szi > 0;
    const entryIdx = bucketIndex(p.entryPx, min, max);
    if (isLong) {
      buckets[entryIdx].long_count  += 1;
      buckets[entryIdx].long_notional += p.positionValue;
    } else {
      buckets[entryIdx].short_count += 1;
      buckets[entryIdx].short_notional += p.positionValue;
    }
  }

  return buckets;
}

export function aggregateTopAssets(
  wallets: { positions: HlAssetPosition[] }[],
  limit: number,
): string[] {
  const totals = new Map<string, number>();
  for (const w of wallets) {
    for (const ap of w.positions) {
      const coin = ap.position.coin;
      const val  = Math.abs(parseFloat(ap.position.positionValue));
      if (!Number.isFinite(val)) continue;
      totals.set(coin, (totals.get(coin) ?? 0) + val);
    }
  }
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([coin]) => coin);
}

export function computeRadarStats(positions: RadarPosition[]): RadarStats {
  let longN = 0, shortN = 0;
  let longWeighted = 0, shortWeighted = 0;
  for (const p of positions) {
    if (p.szi > 0) {
      longN += p.positionValue;
      longWeighted += p.entryPx * p.positionValue;
    } else {
      shortN += p.positionValue;
      shortWeighted += p.entryPx * p.positionValue;
    }
  }
  return {
    total_positions:      positions.length,
    total_long_notional:  longN,
    total_short_notional: shortN,
    avg_long_entry:       longN  > 0 ? longWeighted  / longN  : null,
    avg_short_entry:      shortN > 0 ? shortWeighted / shortN : null,
  };
}
