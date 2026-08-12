// lib/factor-book.ts
//
// Turn the forward record's raw rows into one honest number per day.
//
// The daily book is long the coins the cohort leans into hardest and short the
// ones it leans away from, held for a day. Its return is market neutral by
// construction: every leg is measured against the mean move of the coins that
// were rankable that day, so a day when everything rose is not a winning day.
//
// This lives in lib rather than in the recorder because the page, the API and
// the command line all report the same track record, and a track record that
// differs by which surface you read it from is not a track record.

export interface BookRow {
  measurement_date: string;
  coin: string;
  leg: "long" | "short" | null;
  raw_return: number | null;
  /** Summed hourly funding over the hold. Positive means longs paid. */
  funding_sum: number | null;
}

export interface BookDay {
  date: string;
  /** Net return for the day, after funding and turnover cost. */
  net: number;
  /** Before costs, so the cost drag is visible rather than buried. */
  gross: number;
  longs: string[];
  shorts: string[];
  /** Names replaced since the previous day, which is what turnover charges. */
  replaced: number;
  coinsRanked: number;
}

export interface BookConfig {
  /** Round-trip cost per name replaced, as a fraction. */
  roundTrip: number;
  /** Fewer rankable coins than this and the cross section is too thin. */
  minCoins: number;
}

export const DEFAULT_BOOK_CONFIG: BookConfig = {
  // 4.5 bps fee and 5 bps slippage a side, verified 2026-08-12.
  roundTrip: (2 * (4.5 + 5)) / 10_000,
  minCoins: 6,
};

/**
 * One entry per scorable day, oldest first.
 *
 * A day is scorable when enough coins resolved to rank a cross section and both
 * legs survived. Turnover is charged only on names that actually changed, which
 * is what a real rebalance pays; the first day is charged in full because the
 * book has to be built from nothing.
 */
export function buildBookDays(
  rows: readonly BookRow[],
  config: BookConfig = DEFAULT_BOOK_CONFIG,
): BookDay[] {
  const byDay = new Map<string, BookRow[]>();
  for (const r of rows) {
    if (!byDay.has(r.measurement_date)) byDay.set(r.measurement_date, []);
    byDay.get(r.measurement_date)!.push(r);
  }

  const out: BookDay[] = [];
  let prevLong = new Set<string>();
  let prevShort = new Set<string>();

  for (const [date, dayRows] of [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const scored = dayRows.filter((r) => r.raw_return !== null);
    if (scored.length < config.minCoins) continue;

    const longs = scored.filter((r) => r.leg === "long");
    const shorts = scored.filter((r) => r.leg === "short");
    if (longs.length === 0 || shorts.length === 0) continue;

    // Market neutral: every leg is measured against the day's own mean move.
    const market = scored.reduce((s, r) => s + (r.raw_return as number), 0) / scored.length;
    const legReturn = (rs: BookRow[], sign: 1 | -1, withFunding: boolean) =>
      rs.reduce((s, r) => {
        const rel = ((r.raw_return as number) - market) * sign;
        const fund = withFunding ? (r.funding_sum ?? 0) * sign : 0;
        return s + rel - fund;
      }, 0) / rs.length;

    const longNames = longs.map((r) => r.coin);
    const shortNames = shorts.map((r) => r.coin);
    const replaced =
      longNames.filter((c) => !prevLong.has(c)).length +
      shortNames.filter((c) => !prevShort.has(c)).length;
    const turnover =
      prevLong.size === 0
        ? 2 * config.roundTrip
        : (replaced * config.roundTrip) / Math.max(longs.length, 1);

    out.push({
      date,
      gross: legReturn(longs, 1, false) + legReturn(shorts, -1, false),
      net: legReturn(longs, 1, true) + legReturn(shorts, -1, true) - turnover,
      longs: longNames,
      shorts: shortNames,
      replaced: prevLong.size === 0 ? longNames.length + shortNames.length : replaced,
      coinsRanked: scored.length,
    });

    prevLong = new Set(longNames);
    prevShort = new Set(shortNames);
  }

  return out;
}

/** Cumulative net return, compounded, one point per scorable day. */
export function equityCurve(days: readonly BookDay[]): Array<{ date: string; equity: number }> {
  let equity = 1;
  return days.map((d) => {
    equity *= 1 + d.net;
    return { date: d.date, equity };
  });
}
