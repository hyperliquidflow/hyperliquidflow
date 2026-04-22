import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "@/lib/env";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ─── Constants ────────────────────────────────────────────────────────────────

const DEACTIVATION_EQUITY_FLOOR    = 10_000;
const EQUITY_GRACE_CYCLES          = 3;
const MIN_LIQ_BUFFER               = 0.05;
const LIQ_BUFFER_GRACE_CYCLES      = 2;
const MAX_7D_DRAWDOWN              = 0.50;
const MIN_DRAWDOWN_SNAPSHOTS       = 3;
const MAX_CYCLE_DEACTIVATION_PCT   = 0.25;
const SNAPSHOT_FRESHNESS_MS        = 30 * 60_000;
const IDLE_THRESHOLD_MS            = 3 * 24 * 60 * 60_000;

// ─── Types ────────────────────────────────────────────────────────────────────

export type DeactivationReason = "low_equity" | "liq_imminent" | "drawdown_7d" | "idle";

export interface HygieneBreakdown {
  low_equity:                   number;
  liq_imminent:                 number;
  drawdown_7d:                  number;
  idle:                         number;
  total_deactivated_this_cycle: number;
  cohort_size_pre:              number;
  cohort_size_post:             number;
}

export interface HygieneResult {
  deactivated: Array<{ wallet_id: string; reason: DeactivationReason }>;
  breakdown:   HygieneBreakdown;
}

// ─── Pure predicates (unit-testable) ─────────────────────────────────────────

export function isSnapshotFresh(
  snapshotTime: string,
  nowMs:        number,
  maxAgeMs:     number = SNAPSHOT_FRESHNESS_MS,
): boolean {
  return nowMs - new Date(snapshotTime).getTime() <= maxAgeMs;
}

export function failsIdleGate(
  snapshotTime: string | null | undefined,
  nowMs:        number,
  maxIdleMs:    number = IDLE_THRESHOLD_MS,
): boolean {
  if (!snapshotTime) return true;
  return nowMs - new Date(snapshotTime).getTime() > maxIdleMs;
}

export function failsEquityGate(
  accountValue: number,
  floor:        number = DEACTIVATION_EQUITY_FLOOR,
): boolean {
  return accountValue < floor;
}

export function failsLiqBufferGate(
  liqBuffer:     number | null,
  positionCount: number,
  minBuffer:     number = MIN_LIQ_BUFFER,
): boolean {
  if (positionCount === 0 || liqBuffer === null) return false;
  return liqBuffer < minBuffer;
}

/** Returns true if 7d peak-to-current drawdown exceeds threshold.
 *  Returns false (safe) if fewer than minSnapshots values are present. */
export function failsDrawdownGate(
  equitySeries:  number[],
  maxDrawdown:   number = MAX_7D_DRAWDOWN,
  minSnapshots:  number = MIN_DRAWDOWN_SNAPSHOTS,
): boolean {
  if (equitySeries.length < minSnapshots) return false;
  let peak = -Infinity;
  let maxDD = 0;
  for (const v of equitySeries) {
    if (v > peak) peak = v;
    if (peak > 0) {
      const dd = 1 - v / peak;
      if (dd > maxDD) maxDD = dd;
    }
  }
  return maxDD > maxDrawdown;
}

/** Computes next grace counter value.
 *  Stale snapshot: hold current. Fresh + failing: increment. Fresh + passing: reset to 0. */
export function nextGraceCycles(
  current:   number,
  failing:   boolean,
  isFresh:   boolean,
  threshold: number,
): { next: number; deactivate: boolean } {
  if (!isFresh) return { next: current, deactivate: false };
  if (!failing) return { next: 0, deactivate: false };
  const next = current + 1;
  return { next, deactivate: next >= threshold };
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export async function applyHygieneGates(
  activeWalletIds: string[],
): Promise<HygieneResult> {
  const cohortSizePre = activeWalletIds.length;
  if (cohortSizePre === 0) {
    return {
      deactivated: [],
      breakdown: {
        low_equity: 0, liq_imminent: 0, drawdown_7d: 0, idle: 0,
        total_deactivated_this_cycle: 0,
        cohort_size_pre: 0, cohort_size_post: 0,
      },
    };
  }

  const nowMs = Date.now();
  const sevenDaysAgo = new Date(nowMs - 7 * 24 * 60 * 60_000).toISOString();

  // 1. Latest snapshot per active wallet (dedupe to newest per wallet_id)
  const { data: latestSnaps, error: snapErr } = await supabase
    .from("cohort_snapshots")
    .select("wallet_id, account_value, liq_buffer_pct, position_count, snapshot_time")
    .in("wallet_id", activeWalletIds)
    .order("wallet_id")
    .order("snapshot_time", { ascending: false });

  if (snapErr) throw new Error(`[hygiene] latest-snaps query failed: ${snapErr.message}`);

  const latestByWallet = new Map<string, {
    account_value:  number;
    liq_buffer_pct: number | null;
    position_count: number;
    snapshot_time:  string;
  }>();
  for (const row of latestSnaps ?? []) {
    if (!latestByWallet.has(row.wallet_id)) {
      latestByWallet.set(row.wallet_id, row);
    }
  }

  // 2. 7d equity series per wallet for drawdown gate (oldest-first)
  const { data: seriesRows, error: seriesErr } = await supabase
    .from("cohort_snapshots")
    .select("wallet_id, account_value, snapshot_time")
    .in("wallet_id", activeWalletIds)
    .gte("snapshot_time", sevenDaysAgo)
    .order("wallet_id")
    .order("snapshot_time", { ascending: true });

  if (seriesErr) throw new Error(`[hygiene] 7d-series query failed: ${seriesErr.message}`);

  const seriesByWallet = new Map<string, number[]>();
  for (const row of seriesRows ?? []) {
    if (!seriesByWallet.has(row.wallet_id)) seriesByWallet.set(row.wallet_id, []);
    seriesByWallet.get(row.wallet_id)!.push(row.account_value);
  }

  // 3. Current grace counters
  const { data: graceRows, error: graceErr } = await supabase
    .from("wallets")
    .select("id, low_equity_cycles, low_buffer_cycles")
    .in("id", activeWalletIds);

  if (graceErr) throw new Error(`[hygiene] grace-counters query failed: ${graceErr.message}`);

  const graceByWallet = new Map<string, { low_equity_cycles: number; low_buffer_cycles: number }>();
  for (const row of graceRows ?? []) {
    graceByWallet.set(row.id, {
      low_equity_cycles: row.low_equity_cycles ?? 0,
      low_buffer_cycles: row.low_buffer_cycles ?? 0,
    });
  }

  // 4. Evaluate gates
  const toDeactivate: Array<{ wallet_id: string; reason: DeactivationReason }> = [];
  const graceUpdates: Array<{ id: string; low_equity_cycles: number; low_buffer_cycles: number }> = [];
  const graceResets:  string[] = [];

  for (const walletId of activeWalletIds) {
    const snap  = latestByWallet.get(walletId);
    const grace = graceByWallet.get(walletId) ?? { low_equity_cycles: 0, low_buffer_cycles: 0 };

    // 1. Idle gate: missing snapshot OR latest snapshot older than IDLE_THRESHOLD_MS.
    // Runs first so every downstream gate can trust snap is present and recent.
    if (failsIdleGate(snap?.snapshot_time, nowMs)) {
      toDeactivate.push({ wallet_id: walletId, reason: "idle" });
      continue;
    }

    if (!snap) continue; // defensive; idle gate above already covered this

    const fresh  = isSnapshotFresh(snap.snapshot_time, nowMs);
    const series = seriesByWallet.get(walletId) ?? [];

    // Drawdown gate: history-based, no grace, deactivate immediately
    if (failsDrawdownGate(series)) {
      toDeactivate.push({ wallet_id: walletId, reason: "drawdown_7d" });
      continue;
    }

    // Equity gate
    const equityFailing = failsEquityGate(snap.account_value);
    const equityResult  = nextGraceCycles(grace.low_equity_cycles, equityFailing, fresh, EQUITY_GRACE_CYCLES);

    if (equityResult.deactivate) {
      toDeactivate.push({ wallet_id: walletId, reason: "low_equity" });
      continue;
    }

    // Liq-buffer gate
    const bufferFailing = failsLiqBufferGate(snap.liq_buffer_pct, snap.position_count);
    const bufferResult  = nextGraceCycles(grace.low_buffer_cycles, bufferFailing, fresh, LIQ_BUFFER_GRACE_CYCLES);

    if (bufferResult.deactivate) {
      toDeactivate.push({ wallet_id: walletId, reason: "liq_imminent" });
      continue;
    }

    // Passed all gates, update counters if changed
    const newEquity = equityResult.next;
    const newBuffer = bufferResult.next;
    const countersChanged = newEquity !== grace.low_equity_cycles || newBuffer !== grace.low_buffer_cycles;
    if (countersChanged) {
      if (newEquity === 0 && newBuffer === 0) {
        graceResets.push(walletId);
      } else {
        graceUpdates.push({ id: walletId, low_equity_cycles: newEquity, low_buffer_cycles: newBuffer });
      }
    }
  }

  // 5. Sanity check
  const deactivationPct = toDeactivate.length / cohortSizePre;
  if (deactivationPct > MAX_CYCLE_DEACTIVATION_PCT) {
    console.warn(
      `[hygiene] WARNING: deactivating ${toDeactivate.length}/${cohortSizePre}` +
      ` (${(deactivationPct * 100).toFixed(1)}%), exceeds ${MAX_CYCLE_DEACTIVATION_PCT * 100}% sanity threshold. Investigate gate logic.`
    );
  }

  // 6. Batch DB writes
  const byReason = new Map<DeactivationReason, string[]>();
  for (const { wallet_id, reason } of toDeactivate) {
    if (!byReason.has(reason)) byReason.set(reason, []);
    byReason.get(reason)!.push(wallet_id);
  }

  const now = new Date().toISOString();
  const writePromises: PromiseLike<unknown>[] = [];

  for (const [reason, ids] of byReason) {
    writePromises.push(
      supabase
        .from("wallets")
        .update({ is_active: false, deactivation_reason: reason, deactivated_at: now, low_equity_cycles: 0, low_buffer_cycles: 0 })
        .in("id", ids)
        .then(({ error }) => {
          if (error) console.error(`[hygiene] deactivate (${reason}) error:`, error.message);
        })
    );
  }

  if (graceResets.length > 0) {
    writePromises.push(
      supabase
        .from("wallets")
        .update({ low_equity_cycles: 0, low_buffer_cycles: 0 })
        .in("id", graceResets)
        .then(({ error }) => {
          if (error) console.error("[hygiene] grace-reset error:", error.message);
        })
    );
  }

  // Group grace updates by counter values to batch where possible
  const graceUpdateGroups = new Map<string, string[]>();
  for (const u of graceUpdates) {
    const key = `${u.low_equity_cycles}:${u.low_buffer_cycles}`;
    if (!graceUpdateGroups.has(key)) graceUpdateGroups.set(key, []);
    graceUpdateGroups.get(key)!.push(u.id);
  }
  for (const [key, ids] of graceUpdateGroups) {
    const [eq, buf] = key.split(":").map(Number);
    writePromises.push(
      supabase
        .from("wallets")
        .update({ low_equity_cycles: eq, low_buffer_cycles: buf })
        .in("id", ids)
        .then(({ error }) => {
          if (error) console.error("[hygiene] grace-update error:", error.message);
        })
    );
  }

  await Promise.allSettled(writePromises);

  // 7. Return result
  const breakdown: HygieneBreakdown = {
    low_equity:                   byReason.get("low_equity")?.length   ?? 0,
    liq_imminent:                 byReason.get("liq_imminent")?.length  ?? 0,
    drawdown_7d:                  byReason.get("drawdown_7d")?.length   ?? 0,
    idle:                         byReason.get("idle")?.length          ?? 0,
    total_deactivated_this_cycle: toDeactivate.length,
    cohort_size_pre:              cohortSizePre,
    cohort_size_post:             cohortSizePre - toDeactivate.length,
  };

  return { deactivated: toDeactivate, breakdown };
}
