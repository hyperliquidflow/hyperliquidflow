// Persists SignalEvent[] to signal_events and initialises signal_outcomes rows.
// Called via after() in refresh-cohort — fire-and-forget, not in the hot path.

import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "@/lib/env";
import type { SignalEvent } from "@/lib/signal-lab";
import type { HlAssetCtx } from "@/lib/hyperliquid-api-client";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// -----------------------------------------------------------------------------
// Exported pure helpers (testable without Supabase)
// -----------------------------------------------------------------------------

export async function buildSignalHash(
  recipeId: string,
  coin: string,
  direction: string | null,
  snapshotTime: string
): Promise<string> {
  const raw = `${recipeId}|${coin}|${direction ?? "null"}|${snapshotTime}`;
  const encoded = new TextEncoder().encode(raw);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function buildActiveConfigSnapshot(
  configs: Record<string, Record<string, number>>
): Record<string, Record<string, number>> {
  return { ...configs };
}

// -----------------------------------------------------------------------------
// Context passed from refresh-cohort at fire time
// -----------------------------------------------------------------------------

export interface PersistenceContext {
  snapshotTime: string;
  regime: "BULL" | "BEAR" | "RANGING";
  btcPrice: number;
  allMids: Record<string, string>;
  assetCtxMap: Map<string, HlAssetCtx>;
  activeConfigs: Record<string, Record<string, number>>;
}

// -----------------------------------------------------------------------------
// Main persistence function
// -----------------------------------------------------------------------------

export async function persistSignalEvents(
  signals: SignalEvent[],
  ctx: PersistenceContext
): Promise<void> {
  if (signals.length === 0) return;

  const rows = await Promise.all(
    signals.map(async (s) => {
      const hash = await buildSignalHash(s.recipe_id, s.coin, s.direction, ctx.snapshotTime);
      const ctxAsset = ctx.assetCtxMap.get(s.coin);

      const walletIds: string[] = Array.isArray(s.metadata?.wallet_ids)
        ? (s.metadata.wallet_ids as string[])
        : [s.wallet_id];

      return {
        signal_hash:          hash,
        recipe_id:            s.recipe_id,
        coin:                 s.coin,
        signal_type:          s.signal_type,
        direction:            s.direction,
        ev_score:             s.ev_score,
        wallet_ids:           walletIds,
        snapshot_time:        ctx.snapshotTime,
        regime_at_fire:       ctx.regime,
        btc_price_at_fire:    ctx.btcPrice,
        funding_rate_at_fire: ctxAsset ? parseFloat(ctxAsset.funding) : null,
        oi_at_fire:           ctxAsset ? parseFloat(ctxAsset.openInterest) : null,
        volume_24h_at_fire:   null,
        active_config:        ctx.activeConfigs,
        metadata:             s.metadata,
      };
    })
  );

  const { data: inserted, error } = await supabase
    .from("signal_events")
    .upsert(rows, { onConflict: "signal_hash", ignoreDuplicates: true })
    .select("id, coin");

  if (error) {
    console.error("[signal-persistence] upsert error:", error.message);
    return;
  }

  if (!inserted || inserted.length === 0) return;

  const outcomeRows = inserted.map((row: { id: string; coin: string }) => ({
    signal_id:      row.id,
    price_at_fire:  parseFloat(ctx.allMids[row.coin] ?? "0"),
    wallet_outcome: "OPEN",
  }));

  const { error: outcomeError } = await supabase
    .from("signal_outcomes")
    .upsert(outcomeRows, { onConflict: "signal_id", ignoreDuplicates: true });

  if (outcomeError) {
    console.error("[signal-persistence] outcome init error:", outcomeError.message);
  }

  console.log(`[signal-persistence] persisted ${inserted.length} signal(s)`);
}
