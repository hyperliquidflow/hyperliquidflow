// scripts/cohort-skill-test.ts
//
// Answers one question: does this project's wallet scoring predict anything?
//
// Every signal recipe sits on top of the assumption that the cohort contains
// skilled traders. That assumption has never been tested. rank_ic_history has
// held 0 rows for the life of the project because the forward path needs 30
// daily score snapshots plus a 30-day forward window before it can speak.
//
// This measures the same property from data already on disk. Each wallet in
// user_pnl_backtest carries a daily PnL series. Score the wallet on the first
// half of its own series, then rank-correlate that score against what it
// actually earned over the second half. Positive rank IC means the scoring
// ranks wallets in an order that persists. Zero means wallet selection is noise
// and no recipe built on top of it can be profitable.
//
// Reference point: the roadmap's minimum detectable IC is 0.08.

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs/promises";
import { splitDailyPnls, scoreFromDailyPnls, rankIC } from "../lib/skill-test";

const SUPABASE_URL              = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("FATAL: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const MIN_HALF_DAYS  = 15;  // each half needs enough days to score and to measure
const MIN_TRADES     = 5;   // exclude wallets with almost no activity
const MDIC           = 0.08; // minimum detectable IC from the rebuild roadmap

interface Row {
  wallet_id:    string;
  daily_pnls:   number[] | null;
  total_trades: number | null;
  computed_at:  string;
}

/** Decile lift: mean forward PnL of the top decile by score vs the bottom. */
function decileLift(pairs: Array<{ score: number; forwardPnl: number }>) {
  const sorted = [...pairs].sort((a, b) => a.score - b.score);
  const size   = Math.max(1, Math.floor(sorted.length / 10));
  const bottom = sorted.slice(0, size);
  const top    = sorted.slice(-size);
  const mean   = (xs: typeof pairs) => xs.reduce((s, p) => s + p.forwardPnl, 0) / xs.length;
  return { top: mean(top), bottom: mean(bottom), size };
}

async function main(): Promise<void> {
  console.log("[skill-test] loading wallet PnL histories...");

  // Paginated: PostgREST caps a single response at 5,000 rows, which silently
  // truncated the population to whatever came back first.
  const PAGE = 1000;
  const rows: Row[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("user_pnl_backtest")
      .select("wallet_id, daily_pnls, total_trades, computed_at")
      .not("daily_pnls", "is", null)
      .gte("total_trades", MIN_TRADES)
      .order("wallet_id", { ascending: true })
      .range(offset, offset + PAGE - 1);

    if (error) {
      console.error("[skill-test] query error:", error.message);
      process.exit(1);
    }
    const page = (data ?? []) as unknown as Row[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  console.log(`[skill-test] ${rows.length} wallets with a PnL series and ${MIN_TRADES}+ trades`);

  const pairs: Array<{ score: number; forwardPnl: number }> = [];
  let tooShort = 0;

  for (const row of rows) {
    const series = Array.isArray(row.daily_pnls) ? row.daily_pnls.map(Number) : null;
    if (!series || series.some((v) => !isFinite(v))) { tooShort++; continue; }

    const split = splitDailyPnls(series, { minHalf: MIN_HALF_DAYS });
    if (!split) { tooShort++; continue; }

    pairs.push({
      score:      scoreFromDailyPnls(split.train),
      forwardPnl: split.test.reduce((s, v) => s + v, 0),
    });
  }

  console.log(`[skill-test] ${pairs.length} usable, ${tooShort} skipped for a short or invalid series`);

  const ic = rankIC(pairs);
  if (!ic) {
    console.log("[skill-test] VERDICT: not enough usable wallets to measure. No conclusion.");
    await fs.writeFile("skill-test-summary.json", JSON.stringify({ usable: pairs.length, rank_ic: null }, null, 2));
    return;
  }

  const lift = decileLift(pairs);
  const verdict =
    ic.rho >= MDIC  ? `PASS: rank IC ${ic.rho.toFixed(4)} clears the ${MDIC} minimum` :
    ic.rho > 0      ? `WEAK: rank IC ${ic.rho.toFixed(4)} is positive but under the ${MDIC} minimum` :
                      `FAIL: rank IC ${ic.rho.toFixed(4)} is not positive. Scoring does not rank wallets usefully`;

  console.log("");
  console.log("──────────────────────────────────────────────────────────");
  console.log(`  Wallets measured      ${ic.n}`);
  console.log(`  Rank IC               ${ic.rho.toFixed(4)}   (minimum ${MDIC})`);
  console.log(`  Top decile fwd PnL    $${lift.top.toFixed(0)}  (n=${lift.size})`);
  console.log(`  Bottom decile fwd PnL $${lift.bottom.toFixed(0)}  (n=${lift.size})`);
  console.log(`  ${verdict}`);
  console.log("──────────────────────────────────────────────────────────");
  console.log("");

  const summary = {
    ran_at:              new Date().toISOString(),
    wallets_measured:    ic.n,
    rank_ic:             parseFloat(ic.rho.toFixed(4)),
    mdic:                MDIC,
    top_decile_fwd_pnl:  parseFloat(lift.top.toFixed(2)),
    bottom_decile_fwd_pnl: parseFloat(lift.bottom.toFixed(2)),
    decile_size:         lift.size,
    verdict,
  };
  await fs.writeFile("skill-test-summary.json", JSON.stringify(summary, null, 2));
  console.log("[skill-test] wrote skill-test-summary.json");
}

main().catch((err) => {
  console.error("[skill-test] fatal:", err);
  process.exit(1);
});
