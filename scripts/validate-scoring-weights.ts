// scripts/validate-scoring-weights.ts
// Validates whether current scoring weights outperform alternatives by correlating
// wallet scores with signal EV scores from the last 30 days.
//
// Run via: npx tsx scripts/validate-scoring-weights.ts
// Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "@supabase/supabase-js";

// -- Environment validation -------------------------------------------------------

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("FATAL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// -- Weight configurations --------------------------------------------------------

interface WeightSet {
  name: string;
  sharpe: number;
  consistency: number;
  drawdown: number;
  regime: number;
}

const WEIGHT_SETS: WeightSet[] = [
  {
    name: "current (35/25/25/15)",
    sharpe: 0.35,
    consistency: 0.25,
    drawdown: 0.25,
    regime: 0.15,
  },
  {
    name: "equal (25/25/25/25)",
    sharpe: 0.25,
    consistency: 0.25,
    drawdown: 0.25,
    regime: 0.25,
  },
  {
    name: "sharpe-heavy (50/20/20/10)",
    sharpe: 0.5,
    consistency: 0.2,
    drawdown: 0.2,
    regime: 0.1,
  },
];

// -- Types ------------------------------------------------------------------------

interface SignalRow {
  wallet_id: string;
  recipe_id: string;
  coin: string;
  ev_score: number;
  detected_at: string;
}

interface SnapshotRow {
  wallet_id: string;
  overall_score: number;
  sharpe_proxy: number;
  pnl_consistency: number;
  drawdown_score: number;
  regime_fit: number;
  snapshot_time: string;
}

interface Pair {
  evScore: number;
  sharpeProxy: number;
  pnlConsistency: number;
  drawdownScore: number;
  regimeFit: number;
}

// -- Math -------------------------------------------------------------------------

function pearsonCorrelation(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;

  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let num = 0;
  let denX = 0;
  let denY = 0;

  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }

  const denom = Math.sqrt(denX * denY);
  return denom === 0 ? 0 : num / denom;
}

function weightedScore(pair: Pair, w: WeightSet): number {
  return (
    w.sharpe * pair.sharpeProxy +
    w.consistency * pair.pnlConsistency +
    w.drawdown * pair.drawdownScore +
    w.regime * pair.regimeFit
  );
}

// -- Main -------------------------------------------------------------------------

async function main(): Promise<void> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // 1. Fetch signals with ev_score from last 30 days
  console.log("Fetching signals_history (last 30 days)...");
  const { data: signals, error: signalsError } = await supabase
    .from("signals_history")
    .select("wallet_id, recipe_id, coin, ev_score, detected_at")
    .gte("detected_at", since)
    .not("ev_score", "is", null)
    .limit(5000);

  if (signalsError) {
    throw new Error(`signals_history fetch failed: ${signalsError.message}`);
  }
  if (!signals || signals.length === 0) {
    console.error("No signals found in last 30 days with ev_score set.");
    process.exit(1);
  }

  const typedSignals = signals as SignalRow[];
  console.log(`  Found ${typedSignals.length} signals`);

  // 2. Fetch cohort_snapshots for the wallet_ids seen in signals
  const walletIds = [...new Set(typedSignals.map((s) => s.wallet_id))];
  console.log(
    `Fetching cohort_snapshots for ${walletIds.length} unique wallets...`
  );

  const { data: snapshots, error: snapshotsError } = await supabase
    .from("cohort_snapshots")
    .select(
      "wallet_id, overall_score, sharpe_proxy, pnl_consistency, drawdown_score, regime_fit, snapshot_time"
    )
    .in("wallet_id", walletIds)
    .gte("snapshot_time", since)
    .order("snapshot_time", { ascending: false });

  if (snapshotsError) {
    throw new Error(`cohort_snapshots fetch failed: ${snapshotsError.message}`);
  }

  const typedSnapshots = (snapshots ?? []) as SnapshotRow[];
  console.log(`  Found ${typedSnapshots.length} snapshots`);

  // Group snapshots by wallet_id for fast lookup
  const snapshotsByWallet = new Map<string, SnapshotRow[]>();
  for (const snap of typedSnapshots) {
    const bucket = snapshotsByWallet.get(snap.wallet_id) ?? [];
    bucket.push(snap);
    snapshotsByWallet.set(snap.wallet_id, bucket);
  }
  // Each wallet's list is already sorted desc by snapshot_time (Supabase ordered desc above)

  // 3. Build signal/snapshot pairs
  const pairs: Pair[] = [];
  let skippedNoSnapshot = 0;

  for (const sig of typedSignals) {
    const walletSnaps = snapshotsByWallet.get(sig.wallet_id);
    if (!walletSnaps || walletSnaps.length === 0) {
      skippedNoSnapshot++;
      continue;
    }

    // Find the closest snapshot BEFORE the signal time (no lookahead)
    const sigTime = new Date(sig.detected_at).getTime();
    let closest: SnapshotRow | null = null;
    for (const snap of walletSnaps) {
      // walletSnaps is desc by snapshot_time; find first one strictly before signal
      if (new Date(snap.snapshot_time).getTime() < sigTime) {
        closest = snap;
        break;
      }
    }

    if (!closest) {
      skippedNoSnapshot++;
      continue;
    }

    pairs.push({
      evScore: sig.ev_score,
      sharpeProxy: closest.sharpe_proxy,
      pnlConsistency: closest.pnl_consistency,
      drawdownScore: closest.drawdown_score,
      regimeFit: closest.regime_fit,
    });
  }

  console.log(
    `  Matched ${pairs.length} signal/snapshot pairs (${skippedNoSnapshot} skipped - no preceding snapshot)`
  );

  if (pairs.length < 2) {
    console.error(
      "Not enough pairs to compute correlation. Need at least 2 matched pairs."
    );
    process.exit(1);
  }

  const evScores = pairs.map((p) => p.evScore);

  // 4. Compute Pearson correlation for each weight set
  const results: Array<{ name: string; correlation: number }> = [];

  for (const w of WEIGHT_SETS) {
    const scores = pairs.map((p) => weightedScore(p, w));
    const r = pearsonCorrelation(scores, evScores);
    results.push({ name: w.name, correlation: r });
  }

  // 5. Print results table
  const n = pairs.length;
  console.log(`\nWeight validation results (N=${n} signal/snapshot pairs):\n`);

  const col1 = "Weight set";
  const col2 = "Correlation with ev_score";
  const maxName = Math.max(col1.length, ...results.map((r) => r.name.length));

  console.log(`${col1.padEnd(maxName + 3)}${col2}`);

  for (const r of results) {
    const corrStr = r.correlation.toFixed(3);
    console.log(`${r.name.padEnd(maxName + 3)}${corrStr}`);
  }

  const best = results.reduce((a, b) =>
    b.correlation > a.correlation ? b : a
  );
  console.log(`\nBest: ${best.name} (r=${best.correlation.toFixed(3)})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
