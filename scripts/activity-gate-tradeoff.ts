// scripts/activity-gate-tradeoff.ts
//
// The skill test found rank IC rises monotonically with how many days a wallet
// actually traded: 0.043 at 1 active day in the scoring half, 0.077 at 3, 0.094
// at 5, 0.119 at 10, 0.260 at 20. The obvious move is to gate activation on
// trading days rather than raw trade count.
//
// The obvious move is also how this project has hurt itself before. Cohort size
// is the binding constraint on signal supply, and every gate shrinks it. A gate
// that lifts IC while cutting the cohort to twenty wallets buys nothing, because
// coordination recipes need bodies. So this measures both sides of the trade
// before anything ships: what each threshold costs in wallets, against what it
// is worth in rank IC.
//
// Read-only. Writes nothing.
//
//   npx tsx --env-file=.env.local scripts/activity-gate-tradeoff.ts

import { createClient } from "@supabase/supabase-js";
import { splitDailyPnls, scoreFromDailyPnls, rankIC, normalizedForwardPerformance } from "../lib/skill-test";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const MIN_HALF_DAYS = 15;
const THRESHOLDS = [0, 1, 2, 3, 5, 7, 10, 15, 20];

interface Row {
  wallet_id: string;
  daily_pnls: number[] | null;
  total_trades: number | null;
}

async function main() {
  // Which wallets are live right now, so the cost side is measured on the cohort
  // that actually produces signals rather than on the whole discovery archive.
  const { data: activeRows } = await supabase
    .from("wallets").select("id").eq("is_active", true).limit(5000);
  const activeIds = new Set((activeRows ?? []).map((r) => r.id as string));
  console.log(`[gate] ${activeIds.size} wallets currently active\n`);

  const PAGE = 1000;
  const rows: Row[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("user_pnl_backtest")
      .select("wallet_id, daily_pnls, total_trades")
      .not("daily_pnls", "is", null)
      .order("wallet_id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as unknown as Row[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  console.log(`[gate] ${rows.length} wallets carry a PnL series\n`);

  const activeDays = (xs: number[]) => xs.filter((v) => v !== 0).length;

  // Per wallet: score from the train half, forward performance from the test
  // half, and the train-half activity the gate would actually see.
  const records: Array<{ id: string; score: number; fwd: number; trainActive: number; live: boolean }> = [];
  const activeDaysFullWindow = new Map<string, number>();

  for (const row of rows) {
    const series = Array.isArray(row.daily_pnls) ? row.daily_pnls.map(Number) : null;
    if (!series || series.some((v) => !isFinite(v))) continue;
    activeDaysFullWindow.set(row.wallet_id, activeDays(series));

    const split = splitDailyPnls(series, { minHalf: MIN_HALF_DAYS });
    if (!split) continue;
    const fwd = normalizedForwardPerformance(split.train, split.test);
    if (fwd === null) continue;
    records.push({
      id: row.wallet_id,
      score: scoreFromDailyPnls(split.train),
      fwd,
      trainActive: activeDays(split.train),
      live: activeIds.has(row.wallet_id),
    });
  }

  console.log(`[gate] ${records.length} wallets measurable, ${records.filter((r) => r.live).length} of them live\n`);

  console.log(`min active days | rank IC |     se | wallets measured | LIVE cohort kept | live lost`);
  console.log(`----------------+---------+--------+------------------+------------------+----------`);

  const liveTotal = [...activeIds].filter((id) => activeDaysFullWindow.has(id)).length;

  for (const t of THRESHOLDS) {
    const kept = records.filter((r) => r.trainActive >= t);
    const ic = rankIC(kept.map((r) => ({ score: r.score, forwardPnl: r.fwd })));
    // Cost side uses the full window, since that is what the activation gate
    // would see at scan time, and doubles the equivalent threshold to match.
    const liveKept = [...activeIds].filter((id) => (activeDaysFullWindow.get(id) ?? 0) >= t * 2).length;
    const se = ic ? 1 / Math.sqrt(Math.max(ic.n - 1, 1)) : 0;
    console.log(
      `${String(t).padStart(15)} | ${(ic ? ic.rho.toFixed(4) : "  n/a ").padStart(7)} | ` +
      `${(ic ? se.toFixed(4) : " n/a ").padStart(6)} | ${String(ic?.n ?? 0).padStart(16)} | ` +
      `${String(liveKept).padStart(16)} | ${String(liveTotal - liveKept).padStart(9)}`
    );
  }

  console.log(`\n(live cohort column applies the threshold doubled, because the gate sees the`);
  console.log(` full backtest window while the IC is measured on its scoring half)`);

  // Distribution, so the threshold is chosen against the shape of the data
  // rather than against a round number.
  const liveDays = [...activeIds]
    .map((id) => activeDaysFullWindow.get(id))
    .filter((v): v is number => v !== undefined)
    .sort((a, b) => a - b);
  if (liveDays.length) {
    const q = (p: number) => liveDays[Math.floor(p * (liveDays.length - 1))];
    console.log(`\nactive trading days across the live cohort (full window, n=${liveDays.length}):`);
    console.log(`  min=${q(0)} p10=${q(0.1)} p25=${q(0.25)} median=${q(0.5)} p75=${q(0.75)} p90=${q(0.9)} max=${q(1)}`);
  }
}

main().catch((e) => { console.error("[gate] FAILED:", e.message); process.exit(1); });
