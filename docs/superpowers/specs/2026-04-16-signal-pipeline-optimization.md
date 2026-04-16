# Signal Pipeline Optimization

**Date:** 2026-04-16  
**Status:** Approved  
**Scope:** End-to-end signal quality — internal generation, persistence, calibration, display consistency

---

## Motivation

Live data audit (Apr 12–15, 1,750 signals):

| Problem | Evidence |
|---------|----------|
| `position_aging` floods feed | 881 signals (50%), no cooldown, growing +155%/day |
| `signal_outcomes` table empty | 0 rows — outcome tracking and learning agent have no data |
| `rotation_carry` bootstrap deadlock | checks own count before it has ever fired; can never start |
| 7 of 13 recipes never fired | all ENTRY/EXIT/SCALE_IN signals are zero |
| Naming drift: code ≠ display | `momentum_stack` MIN_WALLETS=3 in code, "8+ wallets" on website |
| Flat thresholds across all coins | BTC and a small alt have the same $500K notional bar |

---

## Scope

Six layers, implemented in this order:

1. **Foundation bugs** — fix signal_outcomes, position_aging cooldown, rotation_carry
2. **Token tier system** — MAJOR/LARGE/SMALL coin classification with scaled thresholds
3. **Recipe calibration** — honest threshold values that can actually fire
4. **Description consistency** — recipe-meta.ts matches code exactly, always
5. **agent_config migration** — Supabase rows updated atomically with code
6. **Naming surface audit** — R12 wired to agent_config, unimplemented recipes removed from sidebar, raw ID fallback hardened

---

## Layer 1: Foundation Bug Fixes

### 1a. `signal_outcomes` — Diagnose and fix

**Symptom:** 0 rows in `signal_outcomes` despite 1,750 signals in `signals_history`.

**Root cause investigation steps (in order):**
1. Add `console.log` to `runSignalLab` showing: `allMids` key count, `inserted` row count, `outcomeRows` length, and any Supabase insert error from the `signal_outcomes` write.
2. Check if `allMids` keys match coin names in signals (both should be uppercase symbols like `"BTC"`).
3. If `outcomeRows.length === 0`: the issue is `allMids[sig.coin]` returning undefined — surface which coins are missing.
4. If `outcomeRows.length > 0` but insert fails: log and surface the Supabase error.

**Fix:** Regardless of root cause, move the `signal_outcomes` insert out of the fire-and-forget `void` chain into a properly awaited block with error surfacing. Keep it after the `signals_history` insert but before `runSignalLab` returns.

```ts
// Replace: void supabase.from("signal_outcomes").insert(outcomeRows).then(...)
// With:
const { error: oErr } = await supabase.from("signal_outcomes").insert(outcomeRows);
if (oErr) console.error("[signal-lab] signal_outcomes insert FAILED:", oErr.message, { sampleCoin: outcomeRows[0]?.coin });
else console.log(`[signal-lab] inserted ${outcomeRows.length} outcome seed rows`);
```

---

### 1b. `position_aging` — Per-pair 4-hour cooldown

**Current behavior:** Once a wallet+coin pair hits the 2-cycle underwater threshold, it emits an ALERT on every single cron tick. With 1,200 wallets × multiple positions, this hits 600+/day.

**Fix:** Overlay a KV-based last-alert timestamp on top of the existing consecutive-cycles logic. The 2-cycle threshold still controls *when* to first fire; the cooldown controls *how often* to re-fire.

```ts
const alertHistory = await kv.get<Record<string, number>>("cohort:aging_last_alert") ?? {};
const COOLDOWN_MS = 4 * 3600 * 1000; // 4 hours
const now = Date.now();

// Inside the emit block (after `count >= 2` check):
const alertKey = `${walletId}:${coin}`;
if (now - (alertHistory[alertKey] ?? 0) < COOLDOWN_MS) continue; // still cooling down
alertHistory[alertKey] = now;
// ...emit event
```

Persist `cohort:aging_last_alert` back to KV with a 25h TTL after the loop.

**Expected impact:** From ~633/day → ~30–60/day (one alert per underwater position per 4-hour window).

---

### 1c. `rotation_carry` — Bootstrap deadlock fix

**Current code:**
```ts
const histCount = recipeSignalCounts.get("rotation_carry") ?? 0;
if (histCount < 10) continue;                         // ← deadlock: never reaches 10
if ((histWinRate ?? 0) < MIN_HISTORICAL_WINRATE) continue;
```

**Fix:** Invert the guard — apply the win-rate filter only *after* bootstrap is complete:
```ts
const histCount = recipeSignalCounts.get("rotation_carry") ?? 0;
const bootstrapped = histCount >= 10;
if (bootstrapped && (histWinRate ?? 1) < MIN_HISTORICAL_WINRATE) continue;
// During bootstrap: fire freely to build history
// After bootstrap: require win rate >= threshold
```

---

## Layer 2: Token Tier System

### New file: `lib/token-tiers.ts`

Coins are classified into three tiers. Thresholds for notional-based recipes scale by tier.

```ts
export type CoinTier = "MAJOR" | "LARGE" | "SMALL";

export const MAJOR_COINS = new Set(["BTC", "ETH"]);
export const LARGE_COINS = new Set(["SOL", "HYPE", "ARB", "AVAX", "DOGE", "SUI"]);

export function getCoinTier(coin: string): CoinTier {
  if (MAJOR_COINS.has(coin)) return "MAJOR";
  if (LARGE_COINS.has(coin)) return "LARGE";
  return "SMALL";
}

/**
 * Scale a base notional threshold by coin tier.
 * MAJOR = full, LARGE = 50%, SMALL = 20%
 */
export function tieredNotional(base: number, coin: string, largeMult = 0.5, smallMult = 0.2): number {
  const tier = getCoinTier(coin);
  if (tier === "MAJOR") return base;
  if (tier === "LARGE") return base * largeMult;
  return base * smallMult;
}
```

The `largeMult` and `smallMult` params are passed in from `agent_config` so the learning agent can tune them independently. New `agent_config` entries:

```sql
('momentum_stack',     'NOTIONAL_LARGE_MULT', 0.5),
('momentum_stack',     'NOTIONAL_SMALL_MULT', 0.2),
('divergence_squeeze', 'NOTIONAL_LARGE_MULT', 0.5),
('divergence_squeeze', 'NOTIONAL_SMALL_MULT', 0.2),
('liq_rebound',        'NOTIONAL_LARGE_MULT', 0.5),
('liq_rebound',        'NOTIONAL_SMALL_MULT', 0.2),
('wallet_churn',       'NOTIONAL_LARGE_MULT', 0.5),
('wallet_churn',       'NOTIONAL_SMALL_MULT', 0.2),
```

### Recipes affected

| Recipe | Base threshold | MAJOR | LARGE | SMALL |
|--------|---------------|-------|-------|-------|
| `momentum_stack` R1 | COMBINED_NOTIONAL $500K | $500K | $250K | $100K |
| `divergence_squeeze` R2 | MIN_NOTIONAL_DELTA $75K | $75K | $38K | $15K |
| `liq_rebound` R5 | min_before guard $1M | $1M | $500K | $200K |
| `wallet_churn` R12 | COMBINED_NOTIONAL $500K | $500K | $250K | $100K |

`accumulation_reentry` (R3) already scales drawdown threshold dynamically per coin volatility — no change needed here.

---

## Layer 3: Recipe Calibration

### Updated thresholds

| Recipe (display name) | Parameter | Old | New | Rationale |
|---|---|---|---|---|
| `momentum_stack` (Whale Convergence) | MIN_WALLETS | 3 | 3 | No change — keep at 3 until we see real signal volume. Description corrected to match. |
| `streak_continuation` (Hot Streak) | MIN_STREAK | 5 | 3 | With only 3.5 days of data, no wallet has been tracked long enough to build a 5-streak. Lower to 3 initially; raise after 30 days. |
| `anti_whale_trap` (Smart Exit Signal) | REDUCTION_PCT | 0.30 | 0.20 | 30% reduction is rare even among high-conviction exits. 20% catches real de-risking. |
| `position_aging` (Patience Trap) | (new) COOLDOWN_HOURS | — | 4 | See Layer 1b. |
| `rotation_carry` (Funded Edge) | bootstrap guard | skip if count<10 | free until count≥10 | See Layer 1c. |

All other recipe defaults are unchanged for now. The learning agent will tune them once `signal_outcomes` is populated.

---

## Layer 4: Description Consistency

**Rule:** `recipe-meta.ts` descriptions are the only place users see recipe specs. They must use the exact same numbers as `agent_config`. Any threshold change in code or DB must update `recipe-meta.ts` atomically.

### Updated `RECIPE_META` entries

```ts
momentum_stack: {
  label: "Whale Convergence",
  desc:  "3+ wallets add $500K+ (BTC/ETH) | $250K+ (SOL/HYPE) | $100K+ (alts) same direction in under 5 min"
},
divergence_squeeze: {
  label: "Silent Loading",
  desc:  "3+ smart money wallets loading same coin while price flat <0.5% and margin thin"
},
accumulation_reentry: {
  label: "Dip Conviction",
  desc:  "High-score wallet re-enters after coin drops past its volatility-scaled drawdown threshold from the 4h high"
},
rotation_carry: {
  label: "Funded Edge",
  desc:  "New position in positive-funding perp with >0.03%/hr funding. Win-rate filter activates after 10 signals."
},
streak_continuation: {
  label: "Hot Streak",
  desc:  "3+ trade win streak with Sharpe proxy above 0.6"
},
anti_whale_trap: {
  label: "Smart Exit Signal",
  desc:  "High-score wallet cutting 20%+ exposure with low regime fit"
},
position_aging: {
  label: "Patience Trap",
  desc:  "High-score wallet holding losing position 2+ cycles without reducing (re-alerts after 4h)"
},
wallet_churn: {
  label: "Coordinated Exit",
  desc:  "3+ wallets reducing same position — $500K+ (BTC/ETH) | $250K+ (SOL/HYPE) | $100K+ (alts) combined"
},
whale_validated: {
  label: "Alpha Confirmation",
  desc:  "Signal confirmed by 3+ high-score wallets (score ≥0.75) with fresh activity"
},
```

Entries not listed above are already accurate and unchanged.

---

## Layer 5: Supabase Migration — `008_recipe_calibration.sql`

One migration handles all agent_config updates atomically:

```sql
-- Update existing thresholds (momentum_stack MIN_WALLETS stays at 3 — no change)
UPDATE agent_config SET param_value = 3    WHERE recipe_id = 'streak_continuation' AND param_name = 'MIN_STREAK';
UPDATE agent_config SET param_value = 0.20 WHERE recipe_id = 'anti_whale_trap'    AND param_name = 'REDUCTION_PCT';

-- New tier multiplier params
INSERT INTO agent_config (recipe_id, param_name, param_value) VALUES
  ('momentum_stack',     'NOTIONAL_LARGE_MULT', 0.5),
  ('momentum_stack',     'NOTIONAL_SMALL_MULT', 0.2),
  ('divergence_squeeze', 'NOTIONAL_LARGE_MULT', 0.5),
  ('divergence_squeeze', 'NOTIONAL_SMALL_MULT', 0.2),
  ('liq_rebound',        'NOTIONAL_LARGE_MULT', 0.5),
  ('liq_rebound',        'NOTIONAL_SMALL_MULT', 0.2),
  ('wallet_churn',       'NOTIONAL_LARGE_MULT', 0.5),
  ('wallet_churn',       'NOTIONAL_SMALL_MULT', 0.2)
ON CONFLICT DO NOTHING;
```

KV cache invalidation: after running the migration, invalidate KV cache for all affected recipes so `getRecipeConfig` picks up new values on next cron cycle.

---

## Expected Signal Volume After Optimization

| Recipe | Before | After |
|--------|--------|-------|
| position_aging | ~600/day | ~30–60/day (4h cooldown) |
| divergence_squeeze | ~400/day | ~100–200/day (tier scaling opens alts) |
| momentum_stack | 0 | 5–20/day (alts tier opens $100K bar) |
| accumulation_reentry | 0 | 10–40/day (no change, just needs right market) |
| rotation_carry | 0 | 5–15/day (bootstrap fix) |
| streak_continuation | 0 | 5–20/day (MIN_STREAK 5→3) |
| anti_whale_trap | 0 | 5–15/day (REDUCTION_PCT 30→20%) |
| wallet_churn | 0 | 5–20/day (tier scaling opens alts) |
| funding signals (3) | ~150/day | ~150/day (unchanged) |
| **Total** | ~1,100/day | **~350–550/day** |

Target: a balanced, diverse feed where no single recipe dominates.

---

## Layer 6: Naming Surface Audit Fixes

Three display-layer fixes uncovered by the code audit.

### 6a. Wire `wallet_churn` (R12) to `getRecipeConfig`

R12 uses hardcoded `WALLET_THRESHOLD = 3` and `COMBINED_NOTIONAL = 500_000` — it never reads from `agent_config`. The tier scaling params added in migration 008 would be silently ignored without this wire-up.

Fix: replace hardcoded constants with `getRecipeConfig("wallet_churn")` at the top of recipe12, then read `COMBINED_NOTIONAL`, `NOTIONAL_LARGE_MULT`, `NOTIONAL_SMALL_MULT` from the config object. Add base params to migration 008:

```sql
INSERT INTO agent_config (recipe_id, param_name, param_value) VALUES
  ('wallet_churn', 'WALLET_THRESHOLD',   3),
  ('wallet_churn', 'COMBINED_NOTIONAL',  500000),
  ('wallet_churn', 'WINDOW_MS',          300000)
ON CONFLICT DO NOTHING;
```

Also add `"wallet_churn"` to the `recipeIds` snapshot list in `refresh-cohort/route.ts` (line 259–263) so its active config is snapshotted at signal fire time.

### 6b. Remove unimplemented recipes from Feed sidebar

`bridge_inflow` and `twap_accumulation` are in `RECIPE_GROUPS` in `FeedClient.tsx` but have no implementation in `signal-lab.ts`. They show permanent dim dots — users see two signals that never fire with no explanation.

Fix: remove them from `RECIPE_GROUPS`. They stay in `recipe-meta.ts` for when they're built; the sidebar should only show recipes that can actually fire.

### 6c. Harden the raw recipe_id fallback

`FeedClient.tsx:315` and `OverviewClient.tsx:333` both render `meta?.label ?? sig.recipe_id`. If a recipe fires with an unrecognised ID, the raw snake_case string shows to users.

Fix: replace the fallback with a stable placeholder string:

```ts
// FeedClient.tsx:315
<span style={S.sigName}>{meta?.label ?? "Signal"}</span>

// OverviewClient.tsx:333
{RECIPE_META[sig.recipe_id]?.label ?? "Signal"}
```

---

## Files Touched

| File | Action |
|------|--------|
| `lib/token-tiers.ts` | NEW — coin tier utility |
| `lib/signal-lab.ts` | R1 tier scaling, R2 tier scaling, R5 tier scaling, R12 getRecipeConfig wire + tier scaling, R4 bootstrap fix, R10 cooldown, signal_outcomes diagnostic + fix |
| `lib/recipe-meta.ts` | All descriptions updated to match thresholds |
| `app/signals/feed/FeedClient.tsx` | Remove bridge_inflow/twap_accumulation from RECIPE_GROUPS; harden recipe_id fallback |
| `app/OverviewClient.tsx` | Harden recipe_id fallback |
| `app/api/refresh-cohort/route.ts` | Add wallet_churn to recipeIds snapshot list |
| `supabase/migrations/008_recipe_calibration.sql` | NEW — threshold + tier param updates + wallet_churn base config |
| `lib/__tests__/token-tiers.test.ts` | NEW — tier classification + scaling tests |
| `lib/__tests__/outcome-helpers.test.ts` | Add logging assertion for empty-allMids case |

---

## Out of Scope

- `bridge_inflow` and `twap_accumulation` implementation — not in this sprint.
- WebSocket-based `liq_rebound` upgrade (tagged Phase 3) — approximation remains.
- `concentration_risk` (R11) agent_config wire-up — hardcoded thresholds are stable; no tuning needed yet.
- Learning agent tuning — will self-activate once `signal_outcomes` is populated.
