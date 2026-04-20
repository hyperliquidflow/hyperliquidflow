#!/usr/bin/env npx tsx
// scripts/fit-leverage-penalty.ts
// Fits leverage-to-blow-up relationship from cohort_attrition data.
// Outputs JSON to stdout. Update DEFAULT_PENALTY_PARAMS in lib/leverage-risk.ts
// with these values once 10+ blow-up events are available.
//
// Usage: npx tsx scripts/fit-leverage-penalty.ts

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL              = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const MIN_BLOWUP_EVENTS = 10;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const { data: rows, error } = await supabase
    .from("cohort_attrition")
    .select("wallet_address, state_30d, state_90d, state_180d, state_360d");

  if (error) {
    console.error("[fit] cohort_attrition fetch error:", error.message);
    process.exit(1);
  }

  if (!rows || rows.length === 0) {
    console.log("[fit] No attrition data yet. Using DEFAULT_PENALTY_PARAMS.");
    process.exit(0);
  }

  const addresses = rows.map((r) => r.wallet_address);
  const { data: walletRows } = await supabase
    .from("wallets")
    .select("address, max_leverage_60d")
    .in("address", addresses)
    .not("max_leverage_60d", "is", null);

  const leverageMap = new Map(
    (walletRows ?? []).map((w) => [w.address as string, Number(w.max_leverage_60d)])
  );

  type Pair = { maxLev: number; blownUp: boolean };
  const pairs: Pair[] = [];
  for (const row of rows) {
    const maxLev = leverageMap.get(row.wallet_address);
    if (maxLev === undefined) continue;
    const blownUp =
      row.state_30d === "blown_up" ||
      row.state_90d === "blown_up" ||
      row.state_180d === "blown_up" ||
      row.state_360d === "blown_up";
    pairs.push({ maxLev, blownUp });
  }

  const blowupCount = pairs.filter((p) => p.blownUp).length;
  console.log(`[fit] ${pairs.length} wallets with leverage + attrition data, ${blowupCount} blow-ups`);

  if (blowupCount < MIN_BLOWUP_EVENTS) {
    console.log(
      `[fit] WARNING: only ${blowupCount} blow-up events (need ${MIN_BLOWUP_EVENTS}). ` +
      "Empirical fit unreliable. Showing descriptive stats only."
    );
    const blown = pairs.filter((p) => p.blownUp).map((p) => p.maxLev).sort((a, b) => a - b);
    const safe  = pairs.filter((p) => !p.blownUp).map((p) => p.maxLev).sort((a, b) => a - b);
    if (blown.length > 0) {
      const bMed = blown[Math.floor(blown.length / 2)];
      console.log(`[fit] Blown-up wallets max_lev: min=${blown[0].toFixed(1)} median=${bMed.toFixed(1)} max=${blown[blown.length - 1].toFixed(1)}`);
    }
    if (safe.length > 0) {
      const sMed = safe[Math.floor(safe.length / 2)];
      console.log(`[fit] Safe wallets max_lev:    min=${safe[0].toFixed(1)} median=${sMed.toFixed(1)} max=${safe[safe.length - 1].toFixed(1)}`);
    }
    console.log("[fit] Keeping DEFAULT_PENALTY_PARAMS. Re-run when more blow-up data is available.");
    process.exit(0);
  }

  // Bin by leverage quartile and compute blow-up rate per bin
  pairs.sort((a, b) => a.maxLev - b.maxLev);
  const binCount = 4;
  const binSize  = Math.ceil(pairs.length / binCount);
  const bins: Array<{ midLev: number; blowupRate: number; n: number }> = [];

  for (let i = 0; i < binCount; i++) {
    const bin = pairs.slice(i * binSize, (i + 1) * binSize);
    if (bin.length === 0) continue;
    const midLev     = bin.reduce((s, p) => s + p.maxLev, 0) / bin.length;
    const blowupRate = bin.filter((p) => p.blownUp).length / bin.length;
    bins.push({ midLev, blowupRate, n: bin.length });
    console.log(`[fit] bin ${i + 1}: midLev=${midLev.toFixed(1)} blowup_rate=${blowupRate.toFixed(3)} n=${bin.length}`);
  }

  // Find safe_lev: highest contiguous safe bin from the bottom (stop at first unsafe bin)
  let safeLev = 3;
  for (const bin of bins) {
    if (bin.blowupRate < 0.05) {
      safeLev = Math.round(bin.midLev);
    } else {
      break; // first unsafe bin -- stop here
    }
  }

  // Find max_lev: lowest bin midpoint where blow-up rate >= 50%
  let maxLev = 15;
  for (const bin of bins) {
    if (bin.blowupRate >= 0.5) { maxLev = Math.round(bin.midLev); break; }
  }
  if (!bins.some((b) => b.blowupRate >= 0.5)) {
    console.log("[fit] WARNING: no bin reached 50% blow-up rate; max_lev defaulting to prior (15)");
  }

  // Fit exponent: minimise MSE between observed rates and power-curve predictions
  let bestExponent = 1.5;
  let bestMse = Infinity;
  for (let exp = 0.5; exp <= 3.0; exp += 0.1) {
    let mse = 0;
    for (const bin of bins) {
      if (bin.midLev <= safeLev || bin.midLev >= maxLev) continue;
      const t = (bin.midLev - safeLev) / (maxLev - safeLev);
      const predicted = Math.pow(t, exp);
      mse += Math.pow(predicted - bin.blowupRate, 2);
    }
    if (mse < bestMse) { bestMse = mse; bestExponent = exp; }
  }

  const params = {
    safe_lev:  safeLev,
    max_lev:   maxLev,
    exponent:  Math.round(bestExponent * 10) / 10,
  };

  console.log("\n[fit] RESULT -- update DEFAULT_PENALTY_PARAMS in lib/leverage-risk.ts:");
  console.log(JSON.stringify(params, null, 2));
}

main().catch((err) => {
  console.error("[fit] Fatal:", err);
  process.exit(1);
});
