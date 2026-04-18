import { describe, it, expect } from "vitest";
import {
  computeFeeRatio,
  pearsonR,
  nonZeroDays,
  findSybilClusters,
  clusterIdFromWalletIds,
} from "../wash-sybil";

describe("computeFeeRatio", () => {
  it("returns fees / gross for normal case", () => {
    expect(computeFeeRatio(1_000, 10_000)).toBeCloseTo(0.1);
  });
  it("uses floor of 1 when gross is zero", () => {
    expect(computeFeeRatio(500, 0)).toBe(500);
  });
  it("uses floor of 1 when gross is less than 1", () => {
    expect(computeFeeRatio(100, 0.5)).toBeCloseTo(100);
  });
  it("handles gross exactly 1 (floor boundary)", () => {
    expect(computeFeeRatio(1, 1)).toBe(1);
  });
  it("returns 0 for zero fees", () => {
    expect(computeFeeRatio(0, 5_000)).toBe(0);
  });
  it("uses |gross_pnl| so negative gross doesn't invert ratio", () => {
    expect(computeFeeRatio(1_000, -10_000)).toBeCloseTo(0.1);
  });
});

describe("nonZeroDays", () => {
  it("counts non-zero entries", () => {
    expect(nonZeroDays([0, 1, 0, -1, 2])).toBe(3);
  });
  it("returns 0 for all-zero series", () => {
    expect(nonZeroDays([0, 0, 0])).toBe(0);
  });
  it("returns length for all non-zero series", () => {
    expect(nonZeroDays([1, 2, 3])).toBe(3);
  });
  it("returns 0 for empty series", () => {
    expect(nonZeroDays([])).toBe(0);
  });
});

describe("pearsonR", () => {
  it("returns 1 for perfect positive correlation", () => {
    expect(pearsonR([1, 2, 3, 4, 5], [2, 4, 6, 8, 10])).toBeCloseTo(1);
  });
  it("returns -1 for perfect negative correlation", () => {
    expect(pearsonR([1, 2, 3, 4, 5], [10, 8, 6, 4, 2])).toBeCloseTo(-1);
  });
  it("returns 0 for zero correlation", () => {
    // [1,0,-1,0] and [0,1,0,-1] are orthogonal, r = 0 exactly
    expect(pearsonR([1, 0, -1, 0], [0, 1, 0, -1])).toBeCloseTo(0);
  });
  it("returns 0 when one series is constant (zero std dev)", () => {
    expect(pearsonR([1, 2, 3], [5, 5, 5])).toBe(0);
  });
  it("returns 0 for both constant series", () => {
    expect(pearsonR([3, 3, 3], [7, 7, 7])).toBe(0);
  });
  it("returns 0 for empty arrays", () => {
    expect(pearsonR([], [])).toBe(0);
  });
  it("handles single element", () => {
    expect(pearsonR([5], [5])).toBe(0);
  });
});

describe("clusterIdFromWalletIds", () => {
  it("is deterministic regardless of input order", () => {
    const a = clusterIdFromWalletIds(["0xAAA", "0xBBB"]);
    const b = clusterIdFromWalletIds(["0xBBB", "0xAAA"]);
    expect(a).toBe(b);
  });
  it("produces different IDs for different wallet sets", () => {
    const a = clusterIdFromWalletIds(["0xAAA", "0xBBB"]);
    const b = clusterIdFromWalletIds(["0xAAA", "0xCCC"]);
    expect(a).not.toBe(b);
  });
  it("returns an 8-character hex string", () => {
    const id = clusterIdFromWalletIds(["0xAAA"]);
    expect(id).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("findSybilClusters", () => {
  const THRESHOLD = 0.95;
  const MIN_DAYS = 3;

  // Perfect correlation: [1,2,3,4,5] scale variants
  const seriesA = [10, 20, 30, 40, 50];
  const seriesB = [11, 22, 33, 44, 55]; // r ≈ 1.0
  const seriesC = [12, 24, 36, 48, 60]; // r ≈ 1.0 with A and B
  const seriesD = [50, 10, 30, 20, 40]; // uncorrelated with A

  it("returns empty map when no pairs exceed threshold", () => {
    const series = new Map([
      ["w1", seriesA],
      ["w2", seriesD],
    ]);
    expect(findSybilClusters(series, THRESHOLD, MIN_DAYS).size).toBe(0);
  });

  it("returns one cluster for a correlated pair", () => {
    const series = new Map([
      ["w1", seriesA],
      ["w2", seriesB],
    ]);
    const clusters = findSybilClusters(series, THRESHOLD, MIN_DAYS);
    expect(clusters.size).toBe(1);
    const [members] = [...clusters.values()];
    expect(members.sort()).toEqual(["w1", "w2"]);
  });

  it("merges transitive clusters (A-B and B-C => one cluster of 3)", () => {
    const series = new Map([
      ["w1", seriesA],
      ["w2", seriesB],
      ["w3", seriesC],
      ["w4", seriesD],
    ]);
    const clusters = findSybilClusters(series, THRESHOLD, MIN_DAYS);
    expect(clusters.size).toBe(1);
    const [members] = [...clusters.values()];
    expect(members.sort()).toEqual(["w1", "w2", "w3"]);
  });

  it("skips pair when either series has fewer than minNonZeroDays non-zero values", () => {
    const sparse = [0, 0, 100, 0, 0]; // only 1 non-zero day
    const series = new Map([
      ["w1", seriesA],
      ["w2", sparse],
    ]);
    expect(findSybilClusters(series, THRESHOLD, MIN_DAYS).size).toBe(0);
  });

  it("does not flag single-wallet groups", () => {
    const series = new Map([["w1", seriesA]]);
    expect(findSybilClusters(series, THRESHOLD, MIN_DAYS).size).toBe(0);
  });

  it("cluster ID is deterministic for the same member set", () => {
    const series = new Map([
      ["w1", seriesA],
      ["w2", seriesB],
    ]);
    const c1 = findSybilClusters(series, THRESHOLD, MIN_DAYS);
    const c2 = findSybilClusters(series, THRESHOLD, MIN_DAYS);
    expect([...c1.keys()][0]).toBe([...c2.keys()][0]);
  });
});
