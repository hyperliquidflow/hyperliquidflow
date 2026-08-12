// app/api/factor-journal/route.ts
//
// The paper journal: what the positioning factor is holding today, and how the
// book it implies has done on data that did not exist when the idea was formed.
//
// Public and read only, like every other data route here. It reports a paper
// record; nothing in this system can place a trade.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "@/lib/env";
import { buildBookDays, equityCurve, type BookRow } from "@/lib/factor-book";
import { describe, trimmedMean } from "@/lib/study-stats";
import { expectedT } from "@/lib/power";

export const dynamic = "force-dynamic";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/** Pre-registered horizons, Amendment 3. Powered against the observed effect. */
const CHECKPOINT_DAYS = 60;
const CONFIRM_DAYS = 283;
/** The backtest reading the forward record is being compared against. */
const BACKTEST_T = 1.42;
const BACKTEST_DAYS = 104;

export async function GET() {
  const { data, error } = await supabase
    .from("factor_shadow")
    .select("measurement_date, coin, leg, lean_notional, entry_price, raw_return, funding_sum, resolved_at")
    .order("measurement_date", { ascending: false })
    .limit(5000);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = data ?? [];
  const days = buildBookDays(rows as BookRow[]);
  const curve = equityCurve(days);
  const netReturns = days.map((d) => d.net);
  const stats = describe(netReturns);

  // Today's book: the most recent day recorded, resolved or not, because the
  // point of the journal is to show what is being held right now.
  const latestDate = rows.length ? (rows[0].measurement_date as string) : null;
  const latestRows = rows.filter((r) => r.measurement_date === latestDate);
  const holding = latestRows
    .filter((r) => r.leg !== null)
    .map((r) => ({
      coin: r.coin as string,
      leg: r.leg as "long" | "short",
      lean_notional: Number(r.lean_notional),
      entry_price: Number(r.entry_price),
      resolved: r.resolved_at !== null,
      return_pct: r.raw_return === null ? null : Number(r.raw_return) * 100,
    }))
    .sort((a, b) => b.lean_notional - a.lean_notional);

  return NextResponse.json({
    as_of: latestDate,
    coins_ranked: latestRows.length,
    holding,
    days_scored: days.length,
    checkpoint_days: CHECKPOINT_DAYS,
    confirm_days: CONFIRM_DAYS,
    // What the record should look like at this length if the backtest effect is
    // real. Without it, an early t below 1 reads as failure when it is simply
    // the number of days available so far.
    expected_t_now: days.length > 0 ? expectedT(BACKTEST_T, BACKTEST_DAYS, days.length) : null,
    mean_bps: stats ? stats.mean * 10_000 : null,
    trimmed_bps: netReturns.length ? (trimmedMean(netReturns, 0.1) ?? 0) * 10_000 : null,
    t_stat: stats ? stats.t : null,
    win_rate: stats ? stats.winRate : null,
    cumulative_pct: curve.length ? (curve[curve.length - 1].equity - 1) * 100 : 0,
    history: days.map((d, i) => ({
      date: d.date,
      net_bps: d.net * 10_000,
      gross_bps: d.gross * 10_000,
      replaced: d.replaced,
      coins_ranked: d.coinsRanked,
      equity_pct: (curve[i].equity - 1) * 100,
    })),
  });
}
