// scripts/restore-liq-gate-false-positives.ts
//
// One-off remediation for the 2026-08-11 liquidation gate defect.
//
// Until that date the hygiene liq gate read liq_buffer_pct, the fraction of
// equity not committed as margin. That is a leverage statistic, not a distance
// to liquidation, so wallets that deployed their whole balance scored 0 and
// were removed as "liquidation imminent" while price sat a long way from their
// liquidation price. Of 36 wallets removed in the 48h before the fix, 30 were
// nowhere near being liquidated.
//
// This restores the ones the correct gate would have kept. It does not trust a
// captured ID list: every candidate is re-checked against live Hyperliquid
// state at run time, so a wallet that has genuinely deteriorated since removal
// stays out.
//
// Restoration criteria, all required:
//   - removed with deactivation_reason = 'liq_imminent' inside the window
//   - still inactive
//   - live equity >= the activation floor
//   - passes the corrected liquidation gate on live positions
//
// Dry run by default. Pass --apply to write. Writes an audit file either way.
//
//   npx tsx --env-file=.env.local scripts/restore-liq-gate-false-positives.ts
//   npx tsx --env-file=.env.local scripts/restore-liq-gate-false-positives.ts --apply
//
// To reverse: the audit file lists every restored id. Setting is_active=false
// with deactivation_reason='liq_imminent' on those ids returns the prior state.

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs/promises";
import { liquidationDistance } from "../lib/risk-engine";
import { failsLiquidationGate } from "../lib/cohort-hygiene";

const SUPABASE_URL              = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const HYPERLIQUID_API_URL       = process.env.HYPERLIQUID_API_URL ?? "https://api.hyperliquid.xyz/info";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("FATAL: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const APPLY        = process.argv.includes("--apply");
const WINDOW_HOURS = Number(process.argv.find((a) => a.startsWith("--hours="))?.split("=")[1] ?? 48);
const EQUITY_FLOOR = 10_000;
const REQUEST_GAP_MS = 200;

interface Candidate {
  id: string;
  address: string;
  equity: number;
  positionCount: number;
  liqDistance: number | null;
  verdict: "restore" | "still_at_risk" | "unfunded" | "unreadable";
}

async function clearinghouseState(address: string): Promise<unknown> {
  const res = await fetch(HYPERLIQUID_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "clearinghouseState", user: address }),
  });
  if (!res.ok) throw new Error(`Hyperliquid ${res.status}`);
  return res.json();
}

async function main() {
  const since = new Date(Date.now() - WINDOW_HOURS * 3_600_000).toISOString();
  console.log(`[restore] window: last ${WINDOW_HOURS}h  mode: ${APPLY ? "APPLY" : "dry run"}`);

  const { data: removed, error } = await supabase
    .from("wallets")
    .select("id, address, is_active, deactivated_at")
    .eq("deactivation_reason", "liq_imminent")
    .gte("deactivated_at", since)
    .eq("is_active", false)
    .limit(5000);

  if (error) throw new Error(`wallet query failed: ${error.message}`);
  const rows = removed ?? [];
  console.log(`[restore] candidates removed as liq_imminent and still inactive: ${rows.length}`);

  const candidates: Candidate[] = [];

  for (const row of rows) {
    try {
      const state = (await clearinghouseState(row.address)) as {
        marginSummary?: { accountValue?: string };
        assetPositions?: unknown[];
      };
      const equity    = parseFloat(state?.marginSummary?.accountValue ?? "");
      const positions = Array.isArray(state?.assetPositions) ? state.assetPositions : [];
      const distance  = liquidationDistance(positions);

      let verdict: Candidate["verdict"];
      if (!Number.isFinite(equity))                                verdict = "unreadable";
      else if (equity < EQUITY_FLOOR)                              verdict = "unfunded";
      else if (failsLiquidationGate(distance, positions.length))   verdict = "still_at_risk";
      else                                                         verdict = "restore";

      candidates.push({
        id: row.id, address: row.address,
        equity: Number.isFinite(equity) ? equity : 0,
        positionCount: positions.length,
        liqDistance: distance,
        verdict,
      });
    } catch (err) {
      candidates.push({
        id: row.id, address: row.address,
        equity: 0, positionCount: 0, liqDistance: null,
        verdict: "unreadable",
      });
      console.warn(`[restore] ${row.address.slice(0, 10)} unreadable: ${(err as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, REQUEST_GAP_MS));
  }

  const toRestore = candidates.filter((c) => c.verdict === "restore");
  const tally = (v: Candidate["verdict"]) => candidates.filter((c) => c.verdict === v).length;

  console.log(`\n  restore:       ${tally("restore")}`);
  console.log(`  still at risk: ${tally("still_at_risk")}   (correctly excluded, the gate now agrees)`);
  console.log(`  unfunded:      ${tally("unfunded")}   (drained below $${EQUITY_FLOOR.toLocaleString()} since removal)`);
  console.log(`  unreadable:    ${tally("unreadable")}   (left alone)`);
  console.log(`  equity restored: $${Math.round(toRestore.reduce((s, c) => s + c.equity, 0)).toLocaleString()}`);

  const audit = {
    ran_at: new Date().toISOString(),
    mode: APPLY ? "apply" : "dry_run",
    window_hours: WINDOW_HOURS,
    restored_ids: toRestore.map((c) => c.id),
    candidates,
  };
  await fs.writeFile("restore-liq-false-positives.json", JSON.stringify(audit, null, 2));
  console.log(`\n[restore] audit written to restore-liq-false-positives.json`);

  if (!APPLY) {
    console.log("[restore] dry run, no writes issued. Pass --apply to restore.");
    return;
  }
  if (toRestore.length === 0) {
    console.log("[restore] nothing to restore.");
    return;
  }

  // Grace counters are cleared alongside the flag: a stale low_buffer_cycles
  // would otherwise carry a wallet straight back to the deactivation threshold.
  const CHUNK = 100;
  let restored = 0;
  for (let i = 0; i < toRestore.length; i += CHUNK) {
    const ids = toRestore.slice(i, i + CHUNK).map((c) => c.id);
    const { error: updErr } = await supabase
      .from("wallets")
      .update({
        is_active: true,
        deactivation_reason: null,
        deactivated_at: null,
        low_equity_cycles: 0,
        low_buffer_cycles: 0,
      })
      .in("id", ids);
    if (updErr) console.error(`[restore] update failed: ${updErr.message}`);
    else restored += ids.length;
  }

  const { count } = await supabase
    .from("wallets")
    .select("*", { count: "exact", head: true })
    .eq("is_active", true);

  console.log(`[restore] restored ${restored} wallets. Active cohort now ${count}.`);
}

main().catch((e) => {
  console.error("[restore] FAILED:", e.message);
  process.exit(1);
});
