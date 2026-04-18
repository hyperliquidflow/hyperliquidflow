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
  liq_long_count:   number;
  liq_short_count:  number;
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
    liq_long_count:  0,
    liq_short_count: 0,
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

    if (p.liquidationPx != null && Number.isFinite(p.liquidationPx)) {
      const liqIdx = bucketIndex(p.liquidationPx, min, max);
      if (isLong) buckets[liqIdx].liq_long_count += 1;
      else        buckets[liqIdx].liq_short_count += 1;
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

export interface TimeseriesBin {
  t_start: number;
  t_end:   number;
  // notional sum of liquidationPx falling into each price bucket, split by side
  liq_long_notional:  number[];
  liq_short_notional: number[];
}

export interface OhlcCandle {
  t: number;   // open time unix ms
  o: number;
  h: number;
  l: number;
  c: number;
}

export interface TimeseriesResponse {
  asset:         string;
  current_price: number;
  price_range:   { min: number; max: number };
  bin_minutes:   number;
  bins:          TimeseriesBin[];
  candles:       OhlcCandle[];
}

export interface TimeseriesSample {
  t: number;           // unix ms
  wallet_id: string;
  szi: number;
  liquidationPx: number | null;
  positionValue: number;
}

export function bucketTimeseries(
  samples: TimeseriesSample[],
  currentPrice: number,
  binMinutes: number,
  binCount: number,
  nowMs: number,
): TimeseriesBin[] {
  const binMs = binMinutes * 60 * 1000;
  const min   = currentPrice * (1 - RANGE_PCT);
  const max   = currentPrice * (1 + RANGE_PCT);
  const bins: TimeseriesBin[] = Array.from({ length: binCount }, (_, i) => {
    const t_end   = nowMs - (binCount - 1 - i) * binMs;
    const t_start = t_end - binMs;
    return {
      t_start,
      t_end,
      liq_long_notional:  Array(BUCKET_COUNT).fill(0) as number[],
      liq_short_notional: Array(BUCKET_COUNT).fill(0) as number[],
    };
  });

  if (!(currentPrice > 0)) return bins;

  const firstBinStart = bins[0].t_start;

  // Step 1: find each wallet's latest snapshot before each bin ends (carry-forward).
  // Build a sorted timeline of all samples per wallet.
  const walletTimeline = new Map<string, TimeseriesSample[]>();
  for (const s of samples) {
    const arr = walletTimeline.get(s.wallet_id) ?? [];
    arr.push(s);
    walletTimeline.set(s.wallet_id, arr);
  }
  for (const arr of walletTimeline.values()) {
    arr.sort((a, b) => a.t - b.t);
  }

  for (let bi = 0; bi < binCount; bi++) {
    const binEnd = bins[bi].t_end;
    if (binEnd < firstBinStart) continue;

    for (const [, timeline] of walletTimeline) {
      // Binary search for latest sample with t <= binEnd
      let lo = 0, hi = timeline.length - 1, found = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (timeline[mid].t <= binEnd) { found = mid; lo = mid + 1; }
        else hi = mid - 1;
      }
      if (found < 0) continue;
      const s = timeline[found];
      if (s.liquidationPx == null || !Number.isFinite(s.liquidationPx)) continue;
      const priceIdx = bucketIndex(s.liquidationPx, min, max);
      const notional = Math.abs(s.positionValue);
      if (s.szi > 0) bins[bi].liq_long_notional[priceIdx]  += notional;
      else           bins[bi].liq_short_notional[priceIdx] += notional;
    }
  }

  return bins;
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
