// scripts/factor-shadow.ts
//
// The forward out-of-sample record for the positioning factor.
//
// Every number this project has on the factor comes from re-slicing one cached
// history. Extending that cache backward makes a bigger backtest, not an
// out-of-sample test, and a hypothesis cannot be confirmed on the data that
// suggested it. Only data that did not exist when the hypothesis was written
// can do that, so this script starts producing it today, one day at a time.
//
// It is also the only gate that cannot be hurried. The backtest gates finish
// the moment a fetch finishes; this one finishes 60 days after it starts, which
// is the reason to start it before anything else is settled. It doubles as the
// live track record that any later product claim would need.
//
// Two phases per run, resolve before record so a run never scores a row it just
// wrote:
//
//   resolve  every row older than MIN_HOLD_H with no exit yet gets its exit
//            price and the funding that accrued while it was held
//   record   today's cohort lean per coin, the legs it implies, and the entry
//            price observed right now
//
// Nothing here reads a research cache and nothing is ever backfilled: a row
// whose entry price was not observed live is worthless for this purpose.
//
//   npx tsx --env-file=.env.local scripts/factor-shadow.ts            record + resolve
//   npx tsx --env-file=.env.local scripts/factor-shadow.ts --report   print standing only
//
// Pre-registration: docs/research/2026-08-12-preregistration-leads.md
//   Lead 1 forward gate. Legs fixed at 5 a side by Amendment 1. Judged at 60
//   calendar days on the day-clustered mean of the traded book, net of the
//   full cost model.

import { createClient } from "@supabase/supabase-js";
import { fetchAllMids, fetchFundingHistory } from "../lib/hyperliquid-api-client";
import { describe, trimmedMean, bootstrapMeanCI } from "../lib/study-stats";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const REPORT_ONLY = process.argv.includes("--report");

/** Legs a side, fixed before the run that judges them (Amendment 1). */
const LEGS = 5;
/** A coin must carry this much cohort lean to be rankable at all. */
const MIN_LEAN_USD = 10_000;
/** Fewer coins than this and the cross section is too thin to rank. */
const MIN_COINS = 6;
/** Do not resolve before this many hours, so a row is a genuine one-day hold. */
const MIN_HOLD_H = 20;
/** Snapshots older than this are not current positions. */
const SNAPSHOT_MAX_AGE_H = 12;

// Same verified cost model as the backtest instruments.
const FEE_BPS_SIDE = 4.5;
const SLIP_BPS_SIDE = 5;
const RT = (2 * (FEE_BPS_SIDE + SLIP_BPS_SIDE)) / 10_000;

interface ShadowRow {
  measurement_date: string;
  coin: string;
  snapshot_at: string;
  lean_notional: number;
  wallets_in_coin: number;
  coins_in_day: number;
  leg: "long" | "short" | null;
  entry_price: number;
  exit_price: number | null;
  resolved_at: string | null;
  hours_held: number | null;
  raw_return: number | null;
  funding_sum: number | null;
}

// ─── resolve ────────────────────────────────────────────────────────────────

async function resolve(): Promise<number> {
  const cutoff = new Date(Date.now() - MIN_HOLD_H * 3_600_000).toISOString();
  const { data, error } = await supabase
    .from("factor_shadow")
    .select("*")
    .is("resolved_at", null)
    .lt("snapshot_at", cutoff)
    .order("measurement_date", { ascending: true });
  if (error) throw new Error(`resolve read failed: ${error.message}`);
  const rows = (data ?? []) as ShadowRow[];
  if (rows.length === 0) {
    console.log(`[shadow] nothing to resolve`);
    return 0;
  }

  const mids = await fetchAllMids();
  const now = Date.now();
  let resolved = 0;

  for (const row of rows) {
    const mid = Number(mids[row.coin]);
    if (!Number.isFinite(mid) || mid <= 0) {
      console.log(`[shadow] ${row.measurement_date} ${row.coin}: no live price, left open`);
      continue;
    }
    const t0 = new Date(row.snapshot_at).getTime();
    const hours = (now - t0) / 3_600_000;

    // Funding that settled while the position was held. Positive means longs
    // paid. Only the legs actually held need it, but recording it for every
    // coin costs one call and makes the unheld rows usable as a control later.
    let fundingSum: number | null = null;
    if (row.leg !== null) {
      try {
        const hist = await fetchFundingHistory(row.coin, t0);
        fundingSum = hist
          .filter((h) => h.time > t0 && h.time <= now)
          .reduce((s, h) => s + Number(h.fundingRate), 0);
      } catch (e) {
        console.log(`[shadow] ${row.coin}: funding fetch failed (${(e as Error).message}), left null`);
      }
      await new Promise((r) => setTimeout(r, 250));
    }

    const { error: upErr } = await supabase
      .from("factor_shadow")
      .update({
        exit_price: mid,
        raw_return: mid / Number(row.entry_price) - 1,
        funding_sum: fundingSum,
        hours_held: Number(hours.toFixed(3)),
        resolved_at: new Date(now).toISOString(),
      })
      .eq("measurement_date", row.measurement_date)
      .eq("coin", row.coin);
    if (upErr) throw new Error(`resolve write failed: ${upErr.message}`);
    resolved++;
  }

  console.log(`[shadow] resolved ${resolved} of ${rows.length} open rows`);
  return resolved;
}

// ─── record ─────────────────────────────────────────────────────────────────

async function record(): Promise<number> {
  const since = new Date(Date.now() - SNAPSHOT_MAX_AGE_H * 3_600_000).toISOString();
  const { data: active, error: aErr } = await supabase
    .from("wallets")
    .select("id")
    .eq("is_active", true);
  if (aErr) throw new Error(`wallet read failed: ${aErr.message}`);
  const activeIds = new Set((active ?? []).map((w) => w.id as string));
  if (activeIds.size === 0) {
    console.log(`[shadow] no active wallets, nothing recorded`);
    return 0;
  }

  const { data: snaps, error: sErr } = await supabase
    .from("cohort_snapshots")
    .select("wallet_id, snapshot_time, positions")
    .gt("snapshot_time", since)
    .order("snapshot_time", { ascending: false });
  if (sErr) throw new Error(`snapshot read failed: ${sErr.message}`);

  // Latest snapshot per active wallet only. Anything staler than the window is
  // not a current position and must not contribute to a live lean.
  const latest = new Map<string, { positions: unknown; t: string }>();
  for (const s of snaps ?? []) {
    const id = s.wallet_id as string;
    if (!activeIds.has(id) || latest.has(id)) continue;
    latest.set(id, { positions: s.positions, t: s.snapshot_time as string });
  }
  if (latest.size === 0) {
    console.log(`[shadow] no fresh snapshots inside ${SNAPSHOT_MAX_AGE_H}h, nothing recorded`);
    return 0;
  }

  const leanByCoin = new Map<string, { lean: number; wallets: number }>();
  for (const { positions } of latest.values()) {
    for (const entry of (positions as Array<{ position?: Record<string, string> }>) ?? []) {
      const p = entry?.position;
      if (!p) continue;
      const szi = Number(p.szi);
      const value = Number(p.positionValue);
      if (!Number.isFinite(szi) || !Number.isFinite(value) || szi === 0) continue;
      const signed = Math.sign(szi) * value;
      const cur = leanByCoin.get(p.coin) ?? { lean: 0, wallets: 0 };
      cur.lean += signed;
      cur.wallets += 1;
      leanByCoin.set(p.coin, cur);
    }
  }

  const mids = await fetchAllMids();
  const ranked = [...leanByCoin.entries()]
    .filter(([coin, v]) => Math.abs(v.lean) >= MIN_LEAN_USD && Number(mids[coin]) > 0)
    .map(([coin, v]) => ({ coin, ...v, price: Number(mids[coin]) }))
    .sort((a, b) => a.lean - b.lean);

  if (ranked.length < MIN_COINS) {
    console.log(`[shadow] only ${ranked.length} rankable coins, below the ${MIN_COINS} minimum, nothing recorded`);
    return 0;
  }

  const k = Math.min(LEGS, Math.floor(ranked.length / 2));
  const shortNames = new Set(ranked.slice(0, k).map((r) => r.coin));
  const longNames = new Set(ranked.slice(-k).map((r) => r.coin));

  const snapshotAt = new Date().toISOString();
  const measurementDate = snapshotAt.slice(0, 10);
  const rows = ranked.map((r) => ({
    measurement_date: measurementDate,
    coin: r.coin,
    snapshot_at: snapshotAt,
    lean_notional: r.lean,
    wallets_in_coin: r.wallets,
    coins_in_day: ranked.length,
    leg: longNames.has(r.coin) ? "long" : shortNames.has(r.coin) ? "short" : null,
    entry_price: r.price,
  }));

  // ignoreDuplicates: a second run on the same day must not overwrite an entry
  // price that was already observed live, which would quietly rewrite history.
  const { error: insErr, count } = await supabase
    .from("factor_shadow")
    .upsert(rows, { onConflict: "measurement_date,coin", ignoreDuplicates: true, count: "exact" });
  if (insErr) throw new Error(`record write failed: ${insErr.message}`);

  console.log(
    `[shadow] recorded ${count ?? 0} of ${rows.length} rows for ${measurementDate} ` +
    `from ${latest.size} wallets, ${ranked.length} rankable coins, legs ${k} a side`
  );
  console.log(`[shadow]   long  ${[...longNames].join(", ")}`);
  console.log(`[shadow]   short ${[...shortNames].join(", ")}`);
  return count ?? 0;
}

// ─── report ─────────────────────────────────────────────────────────────────

async function report(): Promise<void> {
  const { data, error } = await supabase
    .from("factor_shadow")
    .select("*")
    .not("resolved_at", "is", null)
    .order("measurement_date", { ascending: true });
  if (error) throw new Error(`report read failed: ${error.message}`);
  const rows = (data ?? []) as ShadowRow[];

  const byDay = new Map<string, ShadowRow[]>();
  for (const r of rows) {
    if (!byDay.has(r.measurement_date)) byDay.set(r.measurement_date, []);
    byDay.get(r.measurement_date)!.push(r);
  }

  // One traded return per day: the long leg minus the short leg, each demeaned
  // against every rankable coin that day so the book is market neutral, less
  // funding on the legs and a full round trip on both.
  const daily: number[] = [];
  let prevLong = new Set<string>(), prevShort = new Set<string>();
  for (const [, dayRows] of [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const scored = dayRows.filter((r) => r.raw_return !== null);
    if (scored.length < MIN_COINS) continue;
    const market = scored.reduce((s, r) => s + (r.raw_return as number), 0) / scored.length;
    const longs = scored.filter((r) => r.leg === "long");
    const shorts = scored.filter((r) => r.leg === "short");
    if (longs.length === 0 || shorts.length === 0) continue;

    const legReturn = (rs: ShadowRow[], sign: 1 | -1) =>
      rs.reduce((s, r) => {
        const rel = ((r.raw_return as number) - market) * sign;
        const fund = (r.funding_sum ?? 0) * sign;   // longs pay a positive rate
        return s + rel - fund;
      }, 0) / rs.length;

    const longNames = new Set(longs.map((r) => r.coin));
    const shortNames = new Set(shorts.map((r) => r.coin));
    const replaced =
      [...longNames].filter((c) => !prevLong.has(c)).length +
      [...shortNames].filter((c) => !prevShort.has(c)).length;
    const turnover = prevLong.size === 0 ? 2 * RT : (replaced * RT) / Math.max(longs.length, 1);
    prevLong = longNames; prevShort = shortNames;

    daily.push(legReturn(longs, 1) + legReturn(shorts, -1) - turnover);
  }

  console.log(`\n=== Positioning factor, forward out-of-sample record ===`);
  console.log(`  pre-registered gate: 60 days, day-clustered t at least 1.5, mean above 0`);
  if (daily.length === 0) {
    console.log(`  ${byDay.size} day(s) recorded, none scorable yet. The gate needs 60.`);
    return;
  }
  const st = describe(daily);
  if (!st) {
    console.log(`  ${daily.length} scorable day(s). At least 2 needed before a statistic means anything.`);
    return;
  }
  const tm = trimmedMean(daily, 0.1);
  const ci = bootstrapMeanCI(daily, { iters: 2000, seed: 42 });
  console.log(`  days scored   ${st.n} of 60`);
  console.log(`  mean per day  ${(st.mean * 10_000).toFixed(1)} bps  (t ${st.t.toFixed(2)}, win ${(st.winRate * 100).toFixed(0)}%)`);
  console.log(`  trimmed10     ${tm === null ? "n/a" : (tm * 10_000).toFixed(1)} bps`);
  console.log(`  boot95        [${ci ? `${(ci.lo * 10_000).toFixed(1)}, ${(ci.hi * 10_000).toFixed(1)}` : "n/a"}] bps`);
  if (st.n < 60) console.log(`  VERDICT WITHHELD until 60 days. Nothing here is evidence yet.`);
}

async function main() {
  if (!REPORT_ONLY) {
    await resolve();
    await record();
  }
  await report();
}

main().catch((e) => {
  console.error("[shadow] FAILED:", e.message);
  process.exit(1);
});
