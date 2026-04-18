# Stream F — Dashboard Truth

**Date:** 2026-04-18
**Status:** Draft
**Depends on:** Stream D (wallet profiles — the only unblocked source of new data)
**Deferred dependency:** Stream B (hygiene breakdown in KV), Stream C (wash/sybil labels)

---

## Goal

Surface what the waterproof wallet pipeline knows in the UI. Streams A-D generate richer data about each wallet; none of it currently reaches the user. Stream F closes the loop. Two things are ready to ship now (D output). Two more are designed here but implemented after B and C land.

---

## What's in scope

### F1. Trading style badge on leaderboard (unblocked)

`wallet_profiles.trading_style` is populated daily for all active wallets. The leaderboard is the highest-traffic surface — it's the right place to show SCALPER / SWING / TREND at a glance.

**Changes:**

1. Extend `CohortWalletSummary` in `refresh-cohort/route.ts`:
   ```ts
   interface CohortWalletSummary {
     // ...existing fields
     trading_style: string | null;
   }
   ```

2. In the `cohortSummary.push({...})` block at step 7 of the cron, add `trading_style: null` to the initial object — TypeScript requires all non-optional fields at construction time:
   ```ts
   cohortSummary.push({
     // ...existing fields
     trading_style: null,  // populated below after profile fetch
   });
   ```

3. After the wallet loop (before the KV payload build), fetch trading styles for the batch and fill them in:
   ```ts
   const batchIds = cohortSummary.map((w) => w.wallet_id);
   const { data: profiles } = await supabase
     .from("wallet_profiles")
     .select("wallet_id, trading_style")
     .in("wallet_id", batchIds);
   const styleMap = new Map((profiles ?? []).map((p) => [p.wallet_id, p.trading_style]));
   for (const w of cohortSummary) w.trading_style = styleMap.get(w.wallet_id) ?? null;
   ```
   One query of ≤100 rows. Budget: negligible.

3. Add `StyleBadge` component to `LeaderboardClient.tsx`. Rendered after `TierBadge` on each row. Three values: SCALPER (amber), SWING (muted white), TREND (accent). Null → no badge.

4. In `cohort-state/route.ts`: the first KV fallback reads a serialized payload and picks up `trading_style` automatically once the cron writes it. The Supabase fallback path (second fallback) builds each wallet object manually — add `trading_style: null` inside each per-wallet object in the `top_wallets` map, not at the payload level.

---

### F2. Behavior profile section in wallet lookup (unblocked)

`/api/wallet-profile` is the on-demand lookup used on `/wallets/discovery`. It currently only does live Hyperliquid calls and knows nothing about a wallet's stored profile. Adding one Supabase read enriches it with the full Stream D output.

**Changes to `/api/wallet-profile/route.ts`:**

After the existing live HL data fetches, add:
```ts
// Attempt to load stored behavior profile from DB
let storedProfile: StoredProfile | null = null;
try {
  const { data: walletRow } = await supabase
    .from("wallets")
    .select("id")
    .eq("address", address.toLowerCase())
    .maybeSingle();
  if (walletRow?.id) {
    const { data: wp } = await supabase
      .from("wallet_profiles")
      .select("trading_style, pnl_consistency, bull_daily_pnl, bear_daily_pnl, ranging_daily_pnl, regime_edge, current_coins, regime_day_counts, computed_at")
      .eq("wallet_id", walletRow.id)
      .maybeSingle();
    storedProfile = wp ?? null;
  }
} catch {
  // Non-fatal — profile is supplemental
}
```

Return `stored_profile: storedProfile` in the JSON response. Null for wallets not yet in the daily scan.

**New fields on `WalletProfile` type in `DiscoveryClient.tsx`:**
```ts
stored_profile: {
  trading_style:     string | null;
  pnl_consistency:   number | null;
  bull_daily_pnl:    number | null;
  bear_daily_pnl:    number | null;
  ranging_daily_pnl: number | null;
  regime_edge:       number | null;
  current_coins:     string[];
  regime_day_counts: { BULL: number; BEAR: number; RANGING: number } | null;
  computed_at:       string | null;
} | null;
```

**New "Behavior Profile" section in `WalletProfileCard`:**

Shown only when `stored_profile` is non-null. Two sub-sections:

**Trading behavior:**
- Trading style label (SCALPER / SWING / TREND) + definition note ("60d trade frequency")
- PnL consistency bar: `[0, 1]` rendered as a filled bar, label "Consistency" with the numeric value

**Regime performance:**
- Three stat cells: Bull avg daily / Bear avg daily / Ranging avg daily (null → "—")
- Regime edge: numeric + simple label ("Generalist" below 0.3, "Regime-sensitive" 0.3–0.6, "Specialist" above 0.6)

**Current coins:** (only when `current_coins.length > 0`)
- Row of coin pill badges (same style as tier badge)
- Footnote: "Open positions at last daily scan — snapshot only"

---

### F3. Hygiene and wash/sybil surface (deferred — blocked on B and C)

**Blocked on Stream B:** `hygiene_breakdown` is already in the KV payload as of Stream B's implementation. When B ships, add a "Cohort Health" row to the Overview stat cards: "In grace" count with breakdown tooltip (equity / buffer / drawdown).

**Blocked on Stream C:** Add `wash_score: number | null` and `is_sybil: boolean` to `CohortWalletSummary`. Show a small "flagged" indicator on leaderboard rows where `wash_score > 0.4` (below the deactivation floor — still active but elevated). Never show to anonymous users without auth (Sprint 6).

Both are designed here but not implemented until B and C are complete. No placeholder UI needed — add the fields and surface them then.

---

## Schema changes

None. `wallet_profiles` and `wallets` tables already exist.

---

## Constraints

- `stored_profile` is null for wallets never seen by the daily scan (direct address lookups of non-cohort wallets). UI must handle this gracefully — no error state, just no behavior section.
- `trading_style` may lag by up to 24h (last daily scan). The leaderboard badge reflects yesterday's classification. Acceptable and consistent with how all scoring data ages.
- Do not add a new page or nav item. F1 augments the leaderboard; F2 augments the wallet lookup card. No new surfaces.

---

## Files changed

| Action | File | What |
|---|---|---|
| MODIFY | `app/api/refresh-cohort/route.ts` | Extend `CohortWalletSummary`, fetch trading_style from wallet_profiles post-summary-build |
| MODIFY | `app/api/cohort-state/route.ts` | Add `trading_style: null` to fallback payload |
| MODIFY | `app/wallets/leaderboard/LeaderboardClient.tsx` | `StyleBadge` component + render after `TierBadge` |
| MODIFY | `app/api/wallet-profile/route.ts` | Add Supabase read for stored profile; import supabase client |
| MODIFY | `app/wallets/discovery/DiscoveryClient.tsx` | Handle `stored_profile` in type + "Behavior Profile" section in card |

No migration. No new routes. No cron-budget impact beyond one 100-row Supabase query.

---

## Acceptance criteria

1. `npx tsc --noEmit` passes
2. `npm run test` passes
3. Leaderboard rows show SCALPER / SWING / TREND badges for wallets with profiles
4. Wallets without profiles (null `trading_style`) render no badge — no broken layout
5. Address lookup on `/wallets/discovery` for a cohort wallet shows the "Behavior Profile" section with regime PnL data
6. Address lookup for a non-cohort address shows no "Behavior Profile" section (graceful null)
7. `trading_style` is present in the KV payload (`cohort:active`) after next cron cycle

---

## Risks

1. **Profile staleness.** The badge shows yesterday's scan result. If a wallet's trade frequency changes dramatically intraday, the label won't update until the next daily scan. Acceptable — this is stated clearly in the UI footnote.
2. **Wallet address case.** `wallets.address` is stored lowercase (scan script normalizes via `raw.toLowerCase()`). The lookup uses `.eq("address", address.toLowerCase())` which hits the index cleanly. No case-insensitive scan needed.
3. **Supabase round-trip in hot cron path.** The trading_style query runs in `refresh-cohort` which must complete in ≤10s. One query of ≤100 rows adds ~50-100ms. Acceptable.
