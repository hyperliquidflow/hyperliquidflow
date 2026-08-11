// scripts/funding-reachability.ts
//
// Can the funding-gated recipes ever fire on the coins the conviction gate
// lets through?
//
// funding_divergence requires |funding| >= 0.05%/hr. rotation_carry requires
// funding >= 0.03%/hr. Both thresholds predate the conviction gate, when most
// signal volume came from illiquid names where funding runs hot. If those
// levels essentially never occur on eligible coins, the recipes are not
// suspended hypotheses, they are structurally unreachable code.
//
//   npx tsx scripts/funding-reachability.ts

import { fetchFundingHistory } from "../lib/hyperliquid-api-client";

const COINS = ["BTC", "ETH", "HYPE", "PUMP", "NEAR", "DOGE", "ZEC", "TAO", "SOL", "kPEPE", "XPL", "MON"];
const DAYS  = 30;
const FUNDING_DIVERGENCE_THRESHOLD = 0.0005; // |funding| per hour
const ROTATION_CARRY_THRESHOLD     = 0.0003; // funding per hour, positive only

async function main(): Promise<void> {
  const from = Date.now() - DAYS * 86_400_000;

  console.log(`Funding reachability on eligible coins, last ${DAYS} days`);
  console.log("coin  |  hours  |  p50%/hr  p99%/hr   max%/hr  | >=0.05% (fd)  >=0.03% (rc)");
  console.log("------+---------+-------------------------------+---------------------------");

  let fdReachableHours = 0;
  let rcReachableHours = 0;
  let totalHours = 0;

  for (const coin of COINS) {
    let entries;
    try {
      entries = await fetchFundingHistory(coin, from);
    } catch {
      console.log(`${coin.padEnd(5)} |  fetch failed`);
      continue;
    }
    await new Promise((r) => setTimeout(r, 200));
    const rates = (entries ?? [])
      .map((e) => parseFloat(e.fundingRate))
      .filter((v) => isFinite(v));
    if (rates.length === 0) continue;

    const absSorted = rates.map(Math.abs).sort((a, b) => a - b);
    const q = (s: number[], p: number) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
    const fdHours = rates.filter((v) => Math.abs(v) >= FUNDING_DIVERGENCE_THRESHOLD).length;
    const rcHours = rates.filter((v) => v >= ROTATION_CARRY_THRESHOLD).length;

    fdReachableHours += fdHours;
    rcReachableHours += rcHours;
    totalHours += rates.length;

    console.log(
      `${coin.padEnd(5)} |  ${String(rates.length).padStart(5)}  |` +
      `  ${(q(absSorted, 0.5) * 100).toFixed(4)}` +
      `  ${(q(absSorted, 0.99) * 100).toFixed(4)}` +
      `  ${(Math.max(...absSorted) * 100).toFixed(4)}  |` +
      `  ${(fdHours / rates.length * 100).toFixed(2).padStart(6)}%` +
      `  ${(rcHours / rates.length * 100).toFixed(2).padStart(12)}%`
    );
  }

  console.log("");
  console.log(
    `Across all eligible coins: funding_divergence threshold reachable in ` +
    `${(fdReachableHours / totalHours * 100).toFixed(2)}% of coin-hours, ` +
    `rotation_carry in ${(rcReachableHours / totalHours * 100).toFixed(2)}%.`
  );
}

main().catch((err) => {
  console.error("[funding-reachability] fatal:", err);
  process.exit(1);
});
