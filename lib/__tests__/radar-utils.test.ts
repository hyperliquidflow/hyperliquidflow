import { describe, it, expect } from "vitest";
import {
  bucketPositions,
  aggregateTopAssets,
  computeRadarStats,
  BUCKET_COUNT,
  RANGE_PCT,
  type RadarPosition,
} from "../radar-utils";
import type { HlAssetPosition } from "../hyperliquid-api-client";

function pos(overrides: Partial<RadarPosition> = {}): RadarPosition {
  return {
    szi: 1,
    entryPx: 100,
    positionValue: 100,
    liquidationPx: null,
    ...overrides,
  };
}

function assetPos(
  coin: string,
  szi: number,
  entryPx: number,
  positionValue: number,
  liquidationPx: string | null = null,
): HlAssetPosition {
  return {
    type: "oneWay",
    position: {
      coin,
      szi: String(szi),
      entryPx: String(entryPx),
      positionValue: String(positionValue),
      unrealizedPnl: "0",
      returnOnEquity: "0",
      liquidationPx,
      leverage: { type: "cross", value: 5 },
      cumFunding: { allTime: "0", sinceChange: "0", sinceOpen: "0" },
    },
  };
}

describe("bucketPositions", () => {
  it("returns exactly BUCKET_COUNT buckets", () => {
    const out = bucketPositions([], 100);
    expect(out).toHaveLength(BUCKET_COUNT);
  });

  it("covers [currentPrice*(1-RANGE_PCT), currentPrice*(1+RANGE_PCT)]", () => {
    const currentPrice = 100;
    const out = bucketPositions([], currentPrice);
    const expectedMin = currentPrice * (1 - RANGE_PCT);
    const expectedMax = currentPrice * (1 + RANGE_PCT);
    expect(out[0].price_low).toBeCloseTo(expectedMin, 6);
    expect(out[out.length - 1].price_high).toBeCloseTo(expectedMax, 6);
  });

  it("buckets are contiguous and uniform width", () => {
    const out = bucketPositions([], 100);
    const width = out[0].price_high - out[0].price_low;
    for (let i = 1; i < out.length; i++) {
      expect(out[i].price_low).toBeCloseTo(out[i - 1].price_high, 6);
      expect(out[i].price_high - out[i].price_low).toBeCloseTo(width, 6);
    }
  });

  it("separates longs from shorts by szi sign", () => {
    const positions: RadarPosition[] = [
      pos({ szi: 1, entryPx: 100, positionValue: 500 }),   // long at center
      pos({ szi: -1, entryPx: 100, positionValue: 300 }),  // short at center
    ];
    const out = bucketPositions(positions, 100);
    const centerBucket = out.find((b) => 100 >= b.price_low && 100 < b.price_high)!;
    expect(centerBucket.long_count).toBe(1);
    expect(centerBucket.short_count).toBe(1);
    expect(centerBucket.long_notional).toBe(500);
    expect(centerBucket.short_notional).toBe(300);
  });

  it("clamps out-of-range entries into first or last bucket", () => {
    const positions: RadarPosition[] = [
      pos({ szi: 1, entryPx: 10, positionValue: 100 }),    // far below range
      pos({ szi: -1, entryPx: 1000, positionValue: 200 }), // far above range
    ];
    const out = bucketPositions(positions, 100);
    expect(out[0].long_count).toBe(1);
    expect(out[0].long_notional).toBe(100);
    expect(out[out.length - 1].short_count).toBe(1);
    expect(out[out.length - 1].short_notional).toBe(200);
  });

  it("places liquidationPx in the correct liq bucket when present", () => {
    const positions: RadarPosition[] = [
      pos({ szi: 1, entryPx: 100, positionValue: 500, liquidationPx: 85 }),
      pos({ szi: -1, entryPx: 100, positionValue: 500, liquidationPx: 115 }),
    ];
    const out = bucketPositions(positions, 100);
    const liqLongBucket = out.find((b) => 85 >= b.price_low && 85 < b.price_high)!;
    const liqShortBucket = out.find((b) => 115 >= b.price_low && 115 < b.price_high)!;
    expect(liqLongBucket.liq_long_count).toBe(1);
    expect(liqShortBucket.liq_short_count).toBe(1);
  });

  it("skips positions with null liquidationPx from liq overlay but counts entry", () => {
    const positions: RadarPosition[] = [
      pos({ szi: 1, entryPx: 100, positionValue: 500, liquidationPx: null }),
    ];
    const out = bucketPositions(positions, 100);
    const totalLiq = out.reduce(
      (s, b) => s + b.liq_long_count + b.liq_short_count,
      0,
    );
    expect(totalLiq).toBe(0);
    const totalLong = out.reduce((s, b) => s + b.long_count, 0);
    expect(totalLong).toBe(1);
  });

  it("handles empty positions without throwing", () => {
    const out = bucketPositions([], 100);
    expect(out.every((b) => b.long_count === 0 && b.short_count === 0)).toBe(true);
  });

  it("handles currentPrice of 0 or negative by returning empty-shaped buckets without throwing", () => {
    expect(() => bucketPositions([], 0)).not.toThrow();
    expect(() => bucketPositions([], -50)).not.toThrow();
  });
});

describe("aggregateTopAssets", () => {
  it("ranks assets by summed positionValue across all wallets", () => {
    const wallets = [
      { positions: [assetPos("BTC", 1, 80000, 10000), assetPos("ETH", 1, 3000, 5000)] },
      { positions: [assetPos("BTC", 1, 80000, 15000), assetPos("SOL", 1, 150, 8000)] },
    ];
    const out = aggregateTopAssets(wallets, 10);
    expect(out[0]).toBe("BTC");   // 25000
    expect(out[1]).toBe("SOL");   // 8000
    expect(out[2]).toBe("ETH");   // 5000
  });

  it("treats shorts as positive notional (positionValue is absolute)", () => {
    const wallets = [
      { positions: [assetPos("BTC", -1, 80000, 20000)] },
    ];
    const out = aggregateTopAssets(wallets, 10);
    expect(out[0]).toBe("BTC");
  });

  it("caps result at limit", () => {
    const wallets = [
      {
        positions: [
          assetPos("A", 1, 1, 100),
          assetPos("B", 1, 1, 90),
          assetPos("C", 1, 1, 80),
          assetPos("D", 1, 1, 70),
        ],
      },
    ];
    const out = aggregateTopAssets(wallets, 2);
    expect(out).toEqual(["A", "B"]);
  });

  it("returns empty array for empty input", () => {
    expect(aggregateTopAssets([], 10)).toEqual([]);
  });
});

describe("computeRadarStats", () => {
  it("totals positions and long/short notional", () => {
    const positions: RadarPosition[] = [
      pos({ szi: 1, entryPx: 100, positionValue: 500 }),
      pos({ szi: 1, entryPx: 110, positionValue: 500 }),
      pos({ szi: -1, entryPx: 120, positionValue: 300 }),
    ];
    const stats = computeRadarStats(positions);
    expect(stats.total_positions).toBe(3);
    expect(stats.total_long_notional).toBe(1000);
    expect(stats.total_short_notional).toBe(300);
  });

  it("computes notional-weighted average entry per side", () => {
    const positions: RadarPosition[] = [
      pos({ szi: 1, entryPx: 100, positionValue: 200 }),  // contributes 100*200
      pos({ szi: 1, entryPx: 200, positionValue: 800 }),  // contributes 200*800
    ];
    const stats = computeRadarStats(positions);
    // weighted avg = (100*200 + 200*800) / (200+800) = 180000/1000 = 180
    expect(stats.avg_long_entry).toBeCloseTo(180, 6);
  });

  it("returns null for avg_*_entry when side has no positions", () => {
    const stats = computeRadarStats([pos({ szi: 1, entryPx: 100, positionValue: 100 })]);
    expect(stats.avg_short_entry).toBeNull();
  });

  it("handles empty positions", () => {
    const stats = computeRadarStats([]);
    expect(stats.total_positions).toBe(0);
    expect(stats.total_long_notional).toBe(0);
    expect(stats.total_short_notional).toBe(0);
    expect(stats.avg_long_entry).toBeNull();
    expect(stats.avg_short_entry).toBeNull();
  });
});
