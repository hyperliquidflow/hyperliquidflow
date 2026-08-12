import { describe as suite, it, expect } from "vitest";
import {
  buildBookDays,
  equityCurve,
  DEFAULT_BOOK_CONFIG,
  type BookRow,
} from "@/lib/factor-book";

const NO_COST = { roundTrip: 0, minCoins: 6 };

/** Six rankable coins on one day: two long legs, two short, two unheld. */
function day(
  date: string,
  opts: {
    longs: Array<[string, number]>;
    shorts: Array<[string, number]>;
    rest: Array<[string, number]>;
    funding?: Record<string, number>;
  },
): BookRow[] {
  const fund = (c: string) => opts.funding?.[c] ?? null;
  return [
    ...opts.longs.map(([coin, r]) => ({ measurement_date: date, coin, leg: "long" as const, raw_return: r, funding_sum: fund(coin) })),
    ...opts.shorts.map(([coin, r]) => ({ measurement_date: date, coin, leg: "short" as const, raw_return: r, funding_sum: fund(coin) })),
    ...opts.rest.map(([coin, r]) => ({ measurement_date: date, coin, leg: null, raw_return: r, funding_sum: fund(coin) })),
  ];
}

suite("buildBookDays", () => {
  it("pays when the long leg beats the market and the short leg lags it", () => {
    const rows = day("2026-08-13", {
      longs: [["A", 0.05], ["B", 0.04]],
      shorts: [["C", -0.04], ["D", -0.05]],
      rest: [["E", 0.0], ["F", 0.0]],
    });
    const [d] = buildBookDays(rows, NO_COST);
    // Market mean is 0, so the book earns the long mean minus the short mean.
    expect(d.gross).toBeCloseTo(0.045 + 0.045, 9);
  });

  // A day when everything rose is not a winning day.
  it("is market neutral, so a rising tide pays nothing", () => {
    const rows = day("2026-08-13", {
      longs: [["A", 0.10], ["B", 0.10]],
      shorts: [["C", 0.10], ["D", 0.10]],
      rest: [["E", 0.10], ["F", 0.10]],
    });
    const [d] = buildBookDays(rows, NO_COST);
    expect(d.gross).toBeCloseTo(0, 9);
  });

  it("loses when the ranking is backwards", () => {
    const rows = day("2026-08-13", {
      longs: [["A", -0.05], ["B", -0.04]],
      shorts: [["C", 0.04], ["D", 0.05]],
      rest: [["E", 0], ["F", 0]],
    });
    const [d] = buildBookDays(rows, NO_COST);
    expect(d.gross).toBeLessThan(0);
  });

  // Positive funding means longs pay it and shorts collect it.
  it("charges the long leg and credits the short leg for funding", () => {
    const base = { longs: [["A", 0], ["B", 0]] as Array<[string, number]>, shorts: [["C", 0], ["D", 0]] as Array<[string, number]>, rest: [["E", 0], ["F", 0]] as Array<[string, number]> };
    const [withoutFunding] = buildBookDays(day("2026-08-13", base), NO_COST);
    const [withFunding] = buildBookDays(
      day("2026-08-13", { ...base, funding: { A: 0.001, B: 0.001, C: 0.001, D: 0.001 } }),
      NO_COST,
    );
    expect(withoutFunding.net).toBeCloseTo(0, 9);
    // Longs pay 0.001 each, shorts collect 0.001 each, so the two cancel.
    expect(withFunding.net).toBeCloseTo(0, 9);
    expect(withFunding.gross).toBeCloseTo(withoutFunding.gross, 9);
  });

  it("charges the full book on the first day and only replacements after", () => {
    const d1 = day("2026-08-13", { longs: [["A", 0], ["B", 0]], shorts: [["C", 0], ["D", 0]], rest: [["E", 0], ["F", 0]] });
    // Second day keeps every name, so nothing is replaced.
    const d2 = day("2026-08-14", { longs: [["A", 0], ["B", 0]], shorts: [["C", 0], ["D", 0]], rest: [["E", 0], ["F", 0]] });
    const days = buildBookDays([...d1, ...d2], DEFAULT_BOOK_CONFIG);
    expect(days[0].replaced).toBe(4);
    expect(days[0].net).toBeLessThan(0);          // paid to build the book
    expect(days[1].replaced).toBe(0);
    expect(days[1].net).toBeCloseTo(0, 9);        // held everything, paid nothing
  });

  it("charges turnover in proportion to the names that changed", () => {
    const d1 = day("2026-08-13", { longs: [["A", 0], ["B", 0]], shorts: [["C", 0], ["D", 0]], rest: [["E", 0], ["F", 0]] });
    const d2 = day("2026-08-14", { longs: [["A", 0], ["X", 0]], shorts: [["C", 0], ["D", 0]], rest: [["E", 0], ["F", 0]] });
    const days = buildBookDays([...d1, ...d2], DEFAULT_BOOK_CONFIG);
    expect(days[1].replaced).toBe(1);
    expect(days[1].net).toBeCloseTo(-DEFAULT_BOOK_CONFIG.roundTrip / 2, 9);
  });

  it("skips a day with too thin a cross section", () => {
    const rows = day("2026-08-13", { longs: [["A", 0.01]], shorts: [["B", -0.01]], rest: [] });
    expect(buildBookDays(rows, NO_COST)).toHaveLength(0);
  });

  it("skips a day where a leg never resolved", () => {
    const rows: BookRow[] = [
      { measurement_date: "2026-08-13", coin: "A", leg: "long", raw_return: 0.01, funding_sum: null },
      ...[..."BCDEF"].map((c) => ({ measurement_date: "2026-08-13", coin: c, leg: null, raw_return: 0.0, funding_sum: null })),
    ];
    expect(buildBookDays(rows, NO_COST)).toHaveLength(0);
  });

  it("ignores unresolved rows rather than treating them as zero", () => {
    const rows = day("2026-08-13", {
      longs: [["A", 0.05], ["B", 0.04]],
      shorts: [["C", -0.04], ["D", -0.05]],
      rest: [["E", 0], ["F", 0]],
    });
    rows.push({ measurement_date: "2026-08-13", coin: "G", leg: null, raw_return: null, funding_sum: null });
    const [d] = buildBookDays(rows, NO_COST);
    expect(d.coinsRanked).toBe(6);
  });

  it("returns days oldest first", () => {
    const later = day("2026-08-14", { longs: [["A", 0], ["B", 0]], shorts: [["C", 0], ["D", 0]], rest: [["E", 0], ["F", 0]] });
    const earlier = day("2026-08-13", { longs: [["A", 0], ["B", 0]], shorts: [["C", 0], ["D", 0]], rest: [["E", 0], ["F", 0]] });
    const days = buildBookDays([...later, ...earlier], NO_COST);
    expect(days.map((d) => d.date)).toEqual(["2026-08-13", "2026-08-14"]);
  });

  it("handles an empty record", () => {
    expect(buildBookDays([], NO_COST)).toEqual([]);
  });
});

suite("equityCurve", () => {
  it("compounds daily returns", () => {
    const days = [
      { date: "d1", net: 0.1, gross: 0.1, longs: [], shorts: [], replaced: 0, coinsRanked: 6 },
      { date: "d2", net: 0.1, gross: 0.1, longs: [], shorts: [], replaced: 0, coinsRanked: 6 },
    ];
    const curve = equityCurve(days);
    expect(curve[1].equity).toBeCloseTo(1.21, 9);
  });

  it("is empty for no days", () => {
    expect(equityCurve([])).toEqual([]);
  });
});
