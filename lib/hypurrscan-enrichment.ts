// lib/hypurrscan-enrichment.ts
// Background signal enrichment using the Hypurrscan L1 API.
// Both functions write directly to signals_history and return void.
// They are called via after() in refresh-cohort — never in the hot path.

import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "@/lib/env";
import {
  fetchRecentBridges,
  fetchRecentTransfers,
  fetchTwapByAddress,
} from "@/lib/hypurrscan-api-client";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Minimum account value to be considered a "top wallet" for TWAP scanning.
// Scanning all 1200 wallets every 60s would cost 1200 weight — too expensive.
const TWAP_SCAN_MIN_ACCOUNT_VALUE = 250_000; // $250K+
const TWAP_SCAN_MAX_WALLETS       = 20;

// Minimum USD bridge deposit to emit a signal. Filters out micro top-ups.
const BRIDGE_MIN_USD = 100_000; // $100K

/**
 * Detect recent bridge deposits from tracked top wallets and emit ALERT signals.
 * Reads /bridges and /transfers; cross-references with active wallet addresses.
 *
 * @param activeWallets  Array from fetchActiveWallets() — { id, address }
 */
export async function runBridgeInflowEnrichment(
  activeWallets: Array<{ id: string; address: string }>
): Promise<void> {
  if (activeWallets.length === 0) return;

  const addressToId = new Map(activeWallets.map((w) => [w.address.toLowerCase(), w.id]));

  let bridgeTxs: Awaited<ReturnType<typeof fetchRecentBridges>>;
  let transferTxs: Awaited<ReturnType<typeof fetchRecentTransfers>>;

  try {
    [bridgeTxs, transferTxs] = await Promise.all([
      fetchRecentBridges(),
      fetchRecentTransfers(),
    ]);
  } catch (err) {
    console.error("[hs-enrichment] bridge fetch failed:", err);
    return;
  }

  // Combine and filter: only deposit actions from tracked wallets
  const allTxs = [...bridgeTxs, ...transferTxs];
  const signals: Array<{
    wallet_id: string;
    recipe_id: string;
    coin: string;
    signal_type: string;
    direction: null;
    ev_score: null;
    metadata: Record<string, unknown>;
  }> = [];

  for (const tx of allTxs) {
    const walletId = addressToId.get(tx.user.toLowerCase());
    if (!walletId) continue;
    if (tx.error) continue;

    const actionType = tx.action.type;
    const isDeposit =
      actionType === "VoteEthDepositAction" ||
      (actionType === "subAccountTransfer" && tx.action.isDeposit === true);

    if (!isDeposit) continue;

    // Extract USD amount from action
    let usdAmount = 0;
    if (typeof tx.action.usd === "number") {
      usdAmount = tx.action.usd;
    } else if (typeof tx.action.amount === "string") {
      usdAmount = parseFloat(tx.action.amount);
    }

    if (usdAmount < BRIDGE_MIN_USD) continue;

    signals.push({
      wallet_id:   walletId,
      recipe_id:   "bridge_inflow",
      coin:        "USDC",
      signal_type: "ALERT",
      direction:   null,
      ev_score:    null,
      metadata: {
        action_type: actionType,
        usd_amount:  usdAmount,
        hash:        tx.hash,
        block:       tx.block,
        time:        tx.time,
        description: `Tracked wallet bridged $${(usdAmount / 1000).toFixed(0)}K into Hyperliquid`,
      },
    });
  }

  if (signals.length === 0) return;

  const { error } = await supabase.from("signals_history").insert(signals);
  if (error) {
    console.error("[hs-enrichment] bridge signal insert failed:", error.message);
  } else {
    console.log(`[hs-enrichment] bridge_inflow: inserted ${signals.length} signals.`);
  }
}

/**
 * Detect active TWAP orders from top-valued wallets and emit ALERT signals.
 * Scans the top-N wallets by account value (already sorted in the pairs passed in).
 *
 * @param topWallets  Slice of active wallets sorted by account_value DESC — { id, address }
 */
export async function runTwapEnrichment(
  topWallets: Array<{ id: string; address: string }>
): Promise<void> {
  if (topWallets.length === 0) return;

  const signals: Array<{
    wallet_id: string;
    recipe_id: string;
    coin: string;
    signal_type: string;
    direction: null;
    ev_score: null;
    metadata: Record<string, unknown>;
  }> = [];

  for (const wallet of topWallets.slice(0, TWAP_SCAN_MAX_WALLETS)) {
    let twaps: Awaited<ReturnType<typeof fetchTwapByAddress>>;
    try {
      twaps = await fetchTwapByAddress(wallet.address);
    } catch (err) {
      console.warn(`[hs-enrichment] twap fetch failed for ${wallet.address}:`, err);
      continue;
    }

    // Only active (non-ended) TWAPs
    const active = twaps.filter((t) => !t.ended && !t.error);
    for (const twap of active) {
      const coin = (twap.action as Record<string, unknown>).coin as string | undefined;
      if (!coin) continue;

      signals.push({
        wallet_id:   wallet.id,
        recipe_id:   "twap_accumulation",
        coin:        coin,
        signal_type: "ALERT",
        direction:   null,
        ev_score:    null,
        metadata: {
          hash:        twap.hash,
          block:       twap.block,
          time:        twap.time,
          action:      twap.action,
          description: `Tracked whale running active TWAP on ${coin}`,
        },
      });
    }
  }

  if (signals.length === 0) return;

  // Deduplicate: don't re-emit a TWAP alert for the same hash if one fired
  // in the last 30 minutes.
  const hashes = signals.map((s) => (s.metadata as Record<string, unknown>).hash as string);
  void hashes;
  const { data: existing } = await supabase
    .from("signals_history")
    .select("metadata")
    .eq("recipe_id", "twap_accumulation")
    .gte("detected_at", new Date(Date.now() - 30 * 60 * 1000).toISOString());

  const existingHashes = new Set(
    (existing ?? []).map((r) => (r.metadata as Record<string, unknown>).hash as string)
  );

  const fresh = signals.filter((s) => !existingHashes.has(s.metadata.hash as string));
  if (fresh.length === 0) return;

  const { error } = await supabase.from("signals_history").insert(fresh);
  if (error) {
    console.error("[hs-enrichment] twap signal insert failed:", error.message);
  } else {
    console.log(`[hs-enrichment] twap_accumulation: inserted ${fresh.length} signals.`);
  }
}

// TWAP_SCAN_MIN_ACCOUNT_VALUE is intentionally defined here for documentation
// purposes and used by callers to pre-filter the wallet list before passing in.
export { TWAP_SCAN_MIN_ACCOUNT_VALUE };
