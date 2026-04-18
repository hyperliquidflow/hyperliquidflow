# Signal Pipeline Optimization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix broken signal persistence, eliminate position_aging noise, unblock 7 silent recipes, scale notional thresholds per coin tier, and make all display descriptions exactly match the code.

**Architecture:** Changes flow bottom-up: utility layer (`lib/token-tiers.ts`) → signal generation (`lib/signal-lab.ts`, 6 targeted edits) → database migration (`008_recipe_calibration.sql`) → display layer (`recipe-meta.ts`, `FeedClient.tsx`, `OverviewClient.tsx`). Each task is independently committable.

**Tech Stack:** TypeScript, Next.js 15 App Router, Vercel KV, Supabase JS client, Vitest

**Spec:** `docs/superpowers/specs/2026-04-16-signal-pipeline-optimization.md`

---

## File Map

| File | Action | What changes |
|------|--------|-------------|
| `lib/token-tiers.ts` | CREATE | Coin tier classification + tieredNotional() |
| `lib/__tests__/token-tiers.test.ts` | CREATE | Full coverage of getCoinTier + tieredNotional |
| `supabase/migrations/008_recipe_calibration.sql` | CREATE | agent_config: streak→3, anti_whale→0.20, tier mults, wallet_churn base params, liq_rebound MIN_BEFORE |
| `lib/signal-lab.ts` | MODIFY (6 places) | signal_outcomes await fix; R10 cooldown; R4 bootstrap; R12 async+tiers; R1 tiers; R2 tiers; R5 tiers; import tieredNotional |
| `app/api/refresh-cohort/route.ts` | MODIFY (1 line) | Add wallet_churn to recipeIds snapshot list |
| `lib/recipe-meta.ts` | MODIFY | Update 9 descriptions to match actual thresholds |
| `app/signals/feed/FeedClient.tsx` | MODIFY (2 places) | Remove bridge_inflow/twap_accumulation from RECIPE_GROUPS; harden fallback |
| `app/OverviewClient.tsx` | MODIFY (1 line) | Harden recipe_id fallback |

---

## Task 1: Create `lib/token-tiers.ts` with tests

**Files:**
- Create: `lib/token-tiers.ts`
- Create: `lib/__tests__/token-tiers.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/__tests__/token-tiers.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { getCoinTier, tieredNotional } from "../token-tiers";

describe("getCoinTier", () => {
  it("returns MAJOR for BTC", () => expect(getCoinTier("BTC")).toBe("MAJOR"));
  it("returns MAJOR for ETH", () => expect(getCoinTier("ETH")).toBe("MAJOR"));
  it("returns LARGE for SOL", () => expect(getCoinTier("SOL")).toBe("LARGE"));
  it("returns LARGE for HYPE", () => expect(getCoinTier("HYPE")).toBe("LARGE"));
  it("returns LARGE for ARB", () => expect(getCoinTier("ARB")).toBe("LARGE"));
  it("returns LARGE for AVAX", () => expect(getCoinTier("AVAX")).toBe("LARGE"));
  it("returns LARGE for DOGE", () => expect(getCoinTier("DOGE")).toBe("LARGE"));
  it("returns LARGE for SUI", () => expect(getCoinTier("SUI")).toBe("LARGE"));
  it("returns SMALL for unknown coin", () => expect(getCoinTier("PEPE")).toBe("SMALL"));
  it("returns SMALL for WIF", () => expect(getCoinTier("WIF")).toBe("SMALL"));
});

describe("tieredNotional", () => {
  it("returns base for MAJOR coins", () => {
    expect(tieredNotional(500_000, "BTC")).toBe(500_000);
    expect(tieredNotional(500_000, "ETH")).toBe(500_000);
  });
  it("returns 50% of base for LARGE coins", () => {
    expect(tieredNotional(500_000, "SOL")).toBe(250_000);
    expect(tieredNotional(500_000, "HYPE")).toBe(250_000);
  });
  it("returns 20% of base for SMALL coins", () => {
    expect(tieredNotional(500_000, "PEPE")).toBe(100_000);
    expect(tieredNotional(500_000, "WIF")).toBe(100_000);
  });
  it("respects custom largeMult", () => {
    expect(tieredNotional(500_000, "SOL", 0.4, 0.1)).toBe(200_000);
  });
  it("respects custom smallMult", () => {
    expect(tieredNotional(500_000, "WIF", 0.4, 0.1)).toBe(50_000);
  });
  it("MAJOR coins ignore multiplier overrides", () => {
    expect(tieredNotional(1_000_000, "BTC", 0.1, 0.1)).toBe(1_000_000);
  });
});
```

- [ ] **Step 2: Run — confirm FAIL**

```bash
npm run test -- token-tiers
```

Expected: FAIL — `Cannot find module '../token-tiers'`

- [ ] **Step 3: Create `lib/token-tiers.ts`**

```ts
// lib/token-tiers.ts
// Coin tier classification for threshold scaling.
// MAJOR: BTC, ETH — full thresholds apply.
// LARGE: liquid alts (SOL, HYPE, ARB, AVAX, DOGE, SUI) — 50% by default.
// SMALL: everything else — 20% by default.

export type CoinTier = "MAJOR" | "LARGE" | "SMALL";

export const MAJOR_COINS = new Set(["BTC", "ETH"]);
export const LARGE_COINS = new Set(["SOL", "HYPE", "ARB", "AVAX", "DOGE", "SUI"]);

export function getCoinTier(coin: string): CoinTier {
  if (MAJOR_COINS.has(coin)) return "MAJOR";
  if (LARGE_COINS.has(coin)) return "LARGE";
  return "SMALL";
}

/**
 * Scale a notional threshold by coin tier.
 * Pass largeMult / smallMult from agent_config so the learning agent can tune them.
 */
export function tieredNotional(
  base: number,
  coin: string,
  largeMult = 0.5,
  smallMult = 0.2,
): number {
  const tier = getCoinTier(coin);
  if (tier === "MAJOR") return base;
  if (tier === "LARGE") return base * largeMult;
  return base * smallMult;
}
```

- [ ] **Step 4: Run — confirm PASS**

```bash
npm run test -- token-tiers
```

Expected: all 12 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/token-tiers.ts lib/__tests__/token-tiers.test.ts
git commit -m "feat(tiers): add coin tier utility with tieredNotional — MAJOR/LARGE/SMALL"
```

---

## Task 2: Create Supabase migration `008_recipe_calibration.sql`

**Files:**
- Create: `supabase/migrations/008_recipe_calibration.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/008_recipe_calibration.sql
-- Recipe calibration: threshold updates + token tier multiplier params.
-- Run AFTER 007_signal_outcomes.sql.

-- ── Threshold updates ─────────────────────────────────────────────────────────
-- momentum_stack MIN_WALLETS stays at 3 (no change)
UPDATE agent_config SET param_value = 3    WHERE recipe_id = 'streak_continuation' AND param_name = 'MIN_STREAK';
UPDATE agent_config SET param_value = 0.20 WHERE recipe_id = 'anti_whale_trap'    AND param_name = 'REDUCTION_PCT';

-- ── Token tier multipliers ────────────────────────────────────────────────────
-- LARGE tier = 50% of base, SMALL tier = 20% of base.
-- Applied in: momentum_stack, divergence_squeeze, liq_rebound, wallet_churn.
INSERT INTO agent_config (recipe_id, param_name, param_value) VALUES
  ('momentum_stack',     'NOTIONAL_LARGE_MULT',  0.5),
  ('momentum_stack',     'NOTIONAL_SMALL_MULT',  0.2),
  ('divergence_squeeze', 'NOTIONAL_LARGE_MULT',  0.5),
  ('divergence_squeeze', 'NOTIONAL_SMALL_MULT',  0.2),
  ('liq_rebound',        'MIN_BEFORE_NOTIONAL',  1000000),
  ('liq_rebound',        'NOTIONAL_LARGE_MULT',  0.5),
  ('liq_rebound',        'NOTIONAL_SMALL_MULT',  0.2),
  ('wallet_churn',       'WALLET_THRESHOLD',      3),
  ('wallet_churn',       'COMBINED_NOTIONAL',     500000),
  ('wallet_churn',       'WINDOW_MS',             300000),
  ('wallet_churn',       'NOTIONAL_LARGE_MULT',  0.5),
  ('wallet_churn',       'NOTIONAL_SMALL_MULT',  0.2)
ON CONFLICT DO NOTHING;
```

- [ ] **Step 2: Apply the migration via Supabase MCP**

Run this SQL in the Supabase SQL editor or via `supabase db push`.

- [ ] **Step 3: Verify the rows landed**

```sql
SELECT recipe_id, param_name, param_value
FROM agent_config
WHERE recipe_id IN ('streak_continuation','anti_whale_trap','momentum_stack',
                    'divergence_squeeze','liq_rebound','wallet_churn')
ORDER BY recipe_id, param_name;
```

Expected: `streak_continuation.MIN_STREAK = 3`, `anti_whale_trap.REDUCTION_PCT = 0.2`, and all 12 new tier/wallet_churn rows present.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/008_recipe_calibration.sql
git commit -m "chore(db): migration 008 — recipe calibration + token tier multipliers"
```

---

## Task 3: Fix `signal_outcomes` — diagnostic logging + await

**Files:**
- Modify: `lib/signal-lab.ts` (around line 1128)

- [ ] **Step 1: Find the current fire-and-forget block**

In `lib/signal-lab.ts`, locate this block (around line 1128):

```ts
if (rows.length > 0) {
  const { data: inserted, error } = await supabase
    .from("signals_history")
    .insert(rows)
    .select("id, recipe_id, coin, direction");
  if (error) {
    console.error("[signal-lab] insert error:", error.message);
  } else {
    console.log(`[signal-lab] inserted ${inserted?.length ?? 0} signal events`);
    // Capture price at signal fire time for outcome tracking
    if (inserted && inserted.length > 0) {
      const outcomeRows = buildOutcomeRows(inserted, allMids);
      if (outcomeRows.length > 0) {
        void supabase.from("signal_outcomes").insert(outcomeRows).then(({ error: oErr }) => {
          if (oErr) console.error("[signal-lab] signal_outcomes insert error:", oErr.message);
        });
      }
    }
  }
}
```

- [ ] **Step 2: Replace the block with awaited + diagnostic logging**

```ts
if (rows.length > 0) {
  const { data: inserted, error } = await supabase
    .from("signals_history")
    .insert(rows)
    .select("id, recipe_id, coin, direction");
  if (error) {
    console.error("[signal-lab] insert error:", error.message);
  } else {
    console.log(`[signal-lab] inserted ${inserted?.length ?? 0} signal events`);
    if (inserted && inserted.length > 0) {
      const outcomeRows = buildOutcomeRows(inserted, allMids);
      // Diagnostic: surface why outcome rows may be empty
      if (outcomeRows.length === 0) {
        const missingCoins = [...new Set(inserted.map((s) => s.coin))].filter((c) => !allMids[c]);
        console.warn(
          `[signal-lab] 0 outcome rows built from ${inserted.length} signals — allMids keys: ${Object.keys(allMids).length}, coins missing from allMids:`,
          missingCoins,
        );
      }
      if (outcomeRows.length > 0) {
        const { error: oErr } = await supabase.from("signal_outcomes").insert(outcomeRows);
        if (oErr) {
          console.error("[signal-lab] signal_outcomes insert FAILED:", oErr.message, {
            sampleCoin: outcomeRows[0]?.coin,
          });
        } else {
          console.log(`[signal-lab] inserted ${outcomeRows.length} outcome seed rows`);
        }
      }
    }
  }
}
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/signal-lab.ts
git commit -m "fix(signal-lab): await signal_outcomes insert, add diagnostic logging for empty allMids"
```

---

## Task 4: `position_aging` — 4-hour per-pair cooldown

**Files:**
- Modify: `lib/signal-lab.ts` — `recipe10` function (around line 739)

- [ ] **Step 1: Replace the entire `recipe10` function**

Find `async function recipe10(pairs: SnapshotPair[]): Promise<SignalEvent[]> {` and replace the whole function body with:

```ts
async function recipe10(pairs: SnapshotPair[]): Promise<SignalEvent[]> {
  const HIGH_SCORE           = 0.65;
  const LOSS_RATIO_THRESHOLD = -0.05;
  const COOLDOWN_MS          = 4 * 3600 * 1000; // 4 hours
  const events: SignalEvent[] = [];

  const [underwaterCounts, alertHistory] = await Promise.all([
    kv.get<Record<string, number>>("cohort:underwater_counts").then((v) => v ?? {}),
    kv.get<Record<string, number>>("cohort:aging_last_alert").then((v) => v ?? {}),
  ]);
  const now = Date.now();

  for (const { walletId, overallScore, curr, prev } of pairs) {
    if (overallScore < HIGH_SCORE) continue;
    if (!prev) continue;

    const currPos = posMap(curr);
    const prevPos = posMap(prev);

    for (const [coin, pos] of currPos) {
      const key = `${walletId}:${coin}`;
      const posValue = Math.abs(parseFloat(pos.positionValue));
      const ratio = parseFloat(pos.unrealizedPnl) / (posValue + 1e-8);

      const prevPosEntry = prevPos.get(coin);
      const currSzi = Math.abs(parseFloat(pos.szi));
      const prevSzi = prevPosEntry ? Math.abs(parseFloat(prevPosEntry.szi)) : 0;

      const isUnderwater = ratio <= LOSS_RATIO_THRESHOLD;
      const notReducing  = currSzi >= prevSzi * 0.95;

      if (isUnderwater && notReducing) {
        underwaterCounts[key] = (underwaterCounts[key] ?? 0) + 1;
        const count = underwaterCounts[key];
        if (count >= 2) {
          // Cooldown: only re-alert once per 4-hour window per wallet+coin pair
          if (now - (alertHistory[key] ?? 0) < COOLDOWN_MS) continue;
          alertHistory[key] = now;

          const dir = sign(pos.szi);
          events.push({
            wallet_id:   walletId,
            recipe_id:   "position_aging",
            coin,
            signal_type: "ALERT",
            direction:   dir === "FLAT" ? null : dir,
            ev_score:    null,
            metadata: {
              unrealized_pnl_ratio: ratio,
              consecutive_cycles:   count,
              wallet_score:         overallScore,
              description: `Wallet holding losing ${coin} position for ${count}+ cycles (unreal PnL ${(ratio * 100).toFixed(1)}%)`,
            },
          });
        }
      } else {
        underwaterCounts[key] = 0;
      }
    }

    // Reset counts for coins no longer held
    for (const key of Object.keys(underwaterCounts)) {
      if (key.startsWith(`${walletId}:`) && !currPos.has(key.slice(walletId.length + 1))) {
        underwaterCounts[key] = 0;
      }
    }
  }

  kv.set("cohort:underwater_counts", underwaterCounts, { ex: 25 * 3600 }).catch(() => {});
  kv.set("cohort:aging_last_alert",  alertHistory,     { ex: 25 * 3600 }).catch(() => {});

  return events;
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/signal-lab.ts
git commit -m "fix(signal-lab): position_aging 4h per-pair cooldown — reduce from 600+/day to ~50/day"
```

---

## Task 5: `rotation_carry` — bootstrap deadlock fix

**Files:**
- Modify: `lib/signal-lab.ts` — `recipe4` function (around line 388)

- [ ] **Step 1: Find the bootstrap guard in recipe4**

Locate this block inside the `for (const [coin, cPos] of currPos)` loop:

```ts
// Check historical follow-through for this recipe.
// recipeWinRates keys are recipe IDs only (e.g. "rotation_carry"), not "recipe:coin".
// Disable during bootstrap: wait for at least 10 historical signals before
// applying the win-rate filter; prevents free-firing for weeks on the 0.65 default.
const histWinRate = recipeWinRates.get("rotation_carry");
const histCount   = recipeSignalCounts.get("rotation_carry") ?? 0;
if (histCount < 10) continue;
if ((histWinRate ?? 0) < MIN_HISTORICAL_WINRATE) continue;
```

- [ ] **Step 2: Replace with inverted guard**

```ts
// Bootstrap: fire freely until we have 10 historical signals.
// After bootstrap, apply the win-rate filter — prevents tuning on zero data.
const histWinRate  = recipeWinRates.get("rotation_carry");
const histCount    = recipeSignalCounts.get("rotation_carry") ?? 0;
const bootstrapped = histCount >= 10;
if (bootstrapped && (histWinRate ?? 1) < MIN_HISTORICAL_WINRATE) continue;
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/signal-lab.ts
git commit -m "fix(signal-lab): rotation_carry bootstrap deadlock — fire freely until 10 signals collected"
```

---

## Task 6: Wire `wallet_churn` (R12) to `getRecipeConfig` + tier scaling

**Files:**
- Modify: `lib/signal-lab.ts` — `recipe12` function (line 874), top-level import

- [ ] **Step 1: Add `tieredNotional` import**

At the top of `lib/signal-lab.ts`, after the existing imports (line ~14), add:

```ts
import { tieredNotional } from "@/lib/token-tiers";
```

- [ ] **Step 2: Replace the entire `recipe12` function**

Find `function recipe12(pairs: SnapshotPair[]): SignalEvent[] {` and replace with:

```ts
async function recipe12(pairs: SnapshotPair[]): Promise<SignalEvent[]> {
  const cfg            = await getRecipeConfig("wallet_churn");
  const WALLET_THRESHOLD  = cfg["WALLET_THRESHOLD"]   ?? 3;
  const COMBINED_NOTIONAL = cfg["COMBINED_NOTIONAL"]   ?? 500_000;
  const WINDOW_MS         = cfg["WINDOW_MS"]            ?? 300_000;
  const LARGE_MULT        = cfg["NOTIONAL_LARGE_MULT"]  ?? 0.5;
  const SMALL_MULT        = cfg["NOTIONAL_SMALL_MULT"]  ?? 0.2;

  // Coin → { walletIds, totalReduction, direction }
  const buckets = new Map<string, { ids: string[]; delta: number; direction: "LONG" | "SHORT" | null }>();

  for (const { walletId, curr, prev } of pairs) {
    if (!prev) continue;
    const timeDiff = new Date(curr.snapshot_time).getTime() - new Date(prev.snapshot_time).getTime();
    if (timeDiff > WINDOW_MS) continue;

    const currPos = posMap(curr);
    const prevPos = posMap(prev);
    const allCoins = new Set([...currPos.keys(), ...prevPos.keys()]);

    for (const coin of allCoins) {
      const cPos = currPos.get(coin);
      const pPos = prevPos.get(coin);
      const currVal = cPos ? Math.abs(parseFloat(cPos.positionValue)) : 0;
      const prevVal = pPos ? Math.abs(parseFloat(pPos.positionValue)) : 0;
      const delta = currVal - prevVal;
      if (delta >= 0) continue; // only count reductions

      const dir = pPos ? sign(pPos.szi) : null;
      if (!dir || dir === "FLAT") continue;

      if (!buckets.has(coin)) buckets.set(coin, { ids: [], delta: 0, direction: dir });
      const bucket = buckets.get(coin)!;
      bucket.ids.push(walletId);
      bucket.delta += delta; // accumulates as negative
    }
  }

  const events: SignalEvent[] = [];
  for (const [coin, { ids, delta, direction }] of buckets) {
    const threshold = tieredNotional(COMBINED_NOTIONAL, coin, LARGE_MULT, SMALL_MULT);
    if (ids.length >= WALLET_THRESHOLD && Math.abs(delta) >= threshold) {
      events.push({
        wallet_id:   ids[0],
        recipe_id:   "wallet_churn",
        coin,
        signal_type: "EXIT",
        direction,
        ev_score:    null,
        metadata: {
          wallet_count:       ids.length,
          wallet_ids:         ids,
          combined_reduction: Math.abs(delta),
          description: `${ids.length} wallets reducing ${coin} ${direction} combined $${(Math.abs(delta) / 1e3).toFixed(0)}K`,
        },
      });
    }
  }
  return events;
}
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: no errors. Note: `recipe12` is already consumed inside `Promise.all` in `runSignalLab` — making it `async` doesn't require changes to the call site.

- [ ] **Step 4: Commit**

```bash
git add lib/signal-lab.ts
git commit -m "feat(signal-lab): wallet_churn R12 — wire to getRecipeConfig, apply coin tier scaling"
```

---

## Task 7: `momentum_stack` (R1) — tier scaling

**Files:**
- Modify: `lib/signal-lab.ts` — `recipe1` function (around line 96)

- [ ] **Step 1: Add tier multipliers to the config reads in recipe1**

Find the config block at the top of `recipe1` (around line 97):

```ts
const cfg = await getRecipeConfig("momentum_stack");
const MIN_WALLETS         = cfg["MIN_WALLETS"] ?? 3;
const WALLET_THRESHOLD    = MIN_WALLETS;
const COMBINED_NOTIONAL   = cfg["COMBINED_NOTIONAL"] ?? 500_000;
const WINDOW_MS           = cfg["WINDOW_MS"] ?? 300_000;
```

Replace with:

```ts
const cfg = await getRecipeConfig("momentum_stack");
const MIN_WALLETS         = cfg["MIN_WALLETS"]         ?? 3;
const WALLET_THRESHOLD    = MIN_WALLETS;
const COMBINED_NOTIONAL   = cfg["COMBINED_NOTIONAL"]   ?? 500_000;
const WINDOW_MS           = cfg["WINDOW_MS"]            ?? 300_000;
const LARGE_MULT          = cfg["NOTIONAL_LARGE_MULT"]  ?? 0.5;
const SMALL_MULT          = cfg["NOTIONAL_SMALL_MULT"]  ?? 0.2;
```

- [ ] **Step 2: Apply tier scaling to the emit check**

Find this line (around line 137):

```ts
if (ids.length >= WALLET_THRESHOLD && delta >= COMBINED_NOTIONAL) {
```

Replace with:

```ts
if (ids.length >= WALLET_THRESHOLD && delta >= tieredNotional(COMBINED_NOTIONAL, coin, LARGE_MULT, SMALL_MULT)) {
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/signal-lab.ts
git commit -m "feat(signal-lab): momentum_stack R1 — coin tier scaling ($500K MAJOR | $250K LARGE | $100K SMALL)"
```

---

## Task 8: `divergence_squeeze` (R2) — tier scaling

**Files:**
- Modify: `lib/signal-lab.ts` — `recipe2` function (around line 169)

- [ ] **Step 1: Add tier multipliers to the config reads in recipe2**

Find the config block at the top of `recipe2` (around line 169):

```ts
const cfg = await getRecipeConfig("divergence_squeeze");
const LIQ_BUFFER_THRESHOLD = cfg["LIQ_BUFFER_THRESHOLD"] ?? 0.08;
const PRICE_FLAT_PCT       = cfg["PRICE_FLAT_PCT"] ?? 0.005;
const MIN_NOTIONAL_DELTA   = cfg["MIN_NOTIONAL_DELTA"] ?? 75_000;
const MIN_WALLET_SCORE     = cfg["MIN_WALLET_SCORE"] ?? 0.65;
const PRICE_FLAT_CANDLES   = 6;
const MIN_WALLETS          = cfg["MIN_WALLETS"] ?? 3;
```

Replace with:

```ts
const cfg = await getRecipeConfig("divergence_squeeze");
const LIQ_BUFFER_THRESHOLD = cfg["LIQ_BUFFER_THRESHOLD"]  ?? 0.08;
const PRICE_FLAT_PCT       = cfg["PRICE_FLAT_PCT"]          ?? 0.005;
const MIN_NOTIONAL_DELTA   = cfg["MIN_NOTIONAL_DELTA"]      ?? 75_000;
const MIN_WALLET_SCORE     = cfg["MIN_WALLET_SCORE"]        ?? 0.65;
const PRICE_FLAT_CANDLES   = 6;
const MIN_WALLETS          = cfg["MIN_WALLETS"]             ?? 3;
const LARGE_MULT           = cfg["NOTIONAL_LARGE_MULT"]     ?? 0.5;
const SMALL_MULT           = cfg["NOTIONAL_SMALL_MULT"]     ?? 0.2;
```

- [ ] **Step 2: Apply tier scaling to the MIN_NOTIONAL_DELTA guard**

Find this line (around line 203):

```ts
if (!targetCoin || maxCoinDelta < MIN_NOTIONAL_DELTA) continue;
```

Replace with:

```ts
if (!targetCoin || maxCoinDelta < tieredNotional(MIN_NOTIONAL_DELTA, targetCoin, LARGE_MULT, SMALL_MULT)) continue;
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/signal-lab.ts
git commit -m "feat(signal-lab): divergence_squeeze R2 — coin tier scaling ($75K MAJOR | $38K LARGE | $15K SMALL)"
```

---

## Task 9: `liq_rebound` (R5) — tier scaling

**Files:**
- Modify: `lib/signal-lab.ts` — `recipe5` function (around line 422)

- [ ] **Step 1: Add tier multipliers to the config reads in recipe5**

Find the config block at the top of `recipe5` (around line 428):

```ts
const cfg = await getRecipeConfig("liq_rebound");
const POSITION_SHRINK_PCT      = cfg["POSITION_SHRINK_PCT"] ?? 0.05;
const PRICE_SPIKE_PCT_MAJOR    = cfg["PRICE_SPIKE_PCT_MAJOR"] ?? 0.015;
const PRICE_SPIKE_PCT_ALT      = cfg["PRICE_SPIKE_PCT_ALT"] ?? 0.035;
const MAJOR_COINS              = new Set(["BTC", "ETH"]);
```

Replace with:

```ts
const cfg = await getRecipeConfig("liq_rebound");
const POSITION_SHRINK_PCT      = cfg["POSITION_SHRINK_PCT"]   ?? 0.05;
const PRICE_SPIKE_PCT_MAJOR    = cfg["PRICE_SPIKE_PCT_MAJOR"] ?? 0.015;
const PRICE_SPIKE_PCT_ALT      = cfg["PRICE_SPIKE_PCT_ALT"]   ?? 0.035;
const MIN_BEFORE_NOTIONAL      = cfg["MIN_BEFORE_NOTIONAL"]   ?? 1_000_000;
const LARGE_MULT               = cfg["NOTIONAL_LARGE_MULT"]   ?? 0.5;
const SMALL_MULT               = cfg["NOTIONAL_SMALL_MULT"]   ?? 0.2;
const MAJOR_COINS_R5           = new Set(["BTC", "ETH"]);
```

Note: renaming `MAJOR_COINS` to `MAJOR_COINS_R5` to avoid shadowing the import from `token-tiers.ts`.

- [ ] **Step 2: Update all references to `MAJOR_COINS` in recipe5**

Find every use of `MAJOR_COINS` inside recipe5 and rename to `MAJOR_COINS_R5`. There are two:

Line ~466: `const PRICE_SPIKE_PCT = MAJOR_COINS.has(coin) ? PRICE_SPIKE_PCT_MAJOR : PRICE_SPIKE_PCT_ALT;`
→ `const PRICE_SPIKE_PCT = MAJOR_COINS_R5.has(coin) ? PRICE_SPIKE_PCT_MAJOR : PRICE_SPIKE_PCT_ALT;`

- [ ] **Step 3: Apply tier scaling to the min_before guard**

Find this line (around line 453):

```ts
if (before < 1_000_000) continue; // too small to matter
```

Replace with:

```ts
if (before < tieredNotional(MIN_BEFORE_NOTIONAL, coin, LARGE_MULT, SMALL_MULT)) continue;
```

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/signal-lab.ts
git commit -m "feat(signal-lab): liq_rebound R5 — coin tier scaling ($1M MAJOR | $500K LARGE | $200K SMALL)"
```

---

## Task 10: `refresh-cohort` — add `wallet_churn` to recipeIds snapshot

**Files:**
- Modify: `app/api/refresh-cohort/route.ts` (around line 259)

- [ ] **Step 1: Add `wallet_churn` to the recipeIds list**

Find this block (around line 258):

```ts
const recipeIds = [
  "momentum_stack", "divergence_squeeze", "accumulation_reentry",
  "rotation_carry", "liq_rebound", "streak_continuation",
  "funding_divergence", "whale_validated", "anti_whale_trap", "global",
];
```

Replace with:

```ts
const recipeIds = [
  "momentum_stack", "divergence_squeeze", "accumulation_reentry",
  "rotation_carry", "liq_rebound", "streak_continuation",
  "funding_divergence", "whale_validated", "anti_whale_trap", "global",
  "wallet_churn",
];
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/refresh-cohort/route.ts
git commit -m "fix(refresh-cohort): add wallet_churn to recipeIds config snapshot list"
```

---

## Task 11: Update `recipe-meta.ts` descriptions

**Files:**
- Modify: `lib/recipe-meta.ts`

- [ ] **Step 1: Replace the full file content**

```ts
// lib/recipe-meta.ts
// Single source of truth for signal recipe labels and descriptions.
// Rule: descriptions must exactly match agent_config thresholds. Update atomically.
// Used by: app/page.tsx, app/signals/feed/FeedClient.tsx, app/OverviewClient.tsx,
//          app/signals/performance/PerformanceClient.tsx

export const RECIPE_META: Record<string, { label: string; desc: string }> = {
  momentum_stack: {
    label: "Whale Convergence",
    desc:  "3+ wallets add $500K+ (BTC/ETH) | $250K+ (SOL/HYPE) | $100K+ (alts) same direction in under 5 min",
  },
  divergence_squeeze: {
    label: "Silent Loading",
    desc:  "3+ smart money wallets loading same coin while price flat <0.5% and margin thin",
  },
  accumulation_reentry: {
    label: "Dip Conviction",
    desc:  "High-score wallet re-enters after coin drops past its volatility-scaled drawdown threshold from the 4h high",
  },
  rotation_carry: {
    label: "Funded Edge",
    desc:  "New position in positive-funding perp with >0.03%/hr funding. Win-rate filter activates after 10 signals.",
  },
  liq_rebound: {
    label: "Liquidation Flush",
    desc:  "Smart Money exposure drops sharply with price move — possible cascade (approx.)",
  },
  streak_continuation: {
    label: "Hot Streak",
    desc:  "3+ trade win streak with Sharpe proxy above 0.6",
  },
  funding_divergence: {
    label: "Smart Money vs. Retail",
    desc:  "Smart Money bias opposite to funding-implied retail bias, funding >0.05%/hr",
  },
  whale_validated: {
    label: "Alpha Confirmation",
    desc:  "Signal confirmed by 3+ high-score wallets (score ≥0.75) with fresh position activity",
  },
  anti_whale_trap: {
    label: "Smart Exit Signal",
    desc:  "High-score wallet cutting 20%+ exposure with low regime fit",
  },
  position_aging: {
    label: "Patience Trap",
    desc:  "High-score wallet holding losing position 2+ cycles without reducing (re-alerts after 4h)",
  },
  concentration_risk: {
    label: "Crowded Coin",
    desc:  "60%+ of cohort notional concentrated in one coin (70%+ for ETH)",
  },
  wallet_churn: {
    label: "Coordinated Exit",
    desc:  "3+ wallets reducing same position — $500K+ (BTC/ETH) | $250K+ (SOL/HYPE) | $100K+ (alts) combined",
  },
  funding_trend: {
    label: "Funding Surge",
    desc:  "Funding rate rising 3+ consecutive cycles above 0.03%/hr — longs overextended",
  },
  bridge_inflow: {
    label: "Capital Inflow",
    desc:  "Tracked whale bridged $100K+ into Hyperliquid",
  },
  twap_accumulation: {
    label: "Whale TWAP Active",
    desc:  "Tracked whale running an active TWAP order",
  },
};
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/recipe-meta.ts
git commit -m "fix(recipe-meta): sync all descriptions with actual code thresholds — no more 8+ wallets ghost"
```

---

## Task 12: `FeedClient.tsx` — trim RECIPE_GROUPS + harden fallback

**Files:**
- Modify: `app/signals/feed/FeedClient.tsx`

- [ ] **Step 1: Remove unimplemented recipes from RECIPE_GROUPS**

Find `RECIPE_GROUPS` (around line 232):

```ts
const RECIPE_GROUPS: Array<{ label: string; ids: string[] }> = [
  { label: "Momentum",       ids: ["momentum_stack", "accumulation_reentry", "streak_continuation", "whale_validated"] },
  { label: "Smart Money",    ids: ["divergence_squeeze", "anti_whale_trap", "wallet_churn", "bridge_inflow", "twap_accumulation"] },
  { label: "Risk",           ids: ["liq_rebound", "position_aging", "concentration_risk"] },
  { label: "Carry & Funding",ids: ["rotation_carry", "funding_divergence", "funding_trend"] },
];
```

Replace with:

```ts
const RECIPE_GROUPS: Array<{ label: string; ids: string[] }> = [
  { label: "Momentum",        ids: ["momentum_stack", "accumulation_reentry", "streak_continuation", "whale_validated"] },
  { label: "Smart Money",     ids: ["divergence_squeeze", "anti_whale_trap", "wallet_churn"] },
  { label: "Risk",            ids: ["liq_rebound", "position_aging", "concentration_risk"] },
  { label: "Carry & Funding", ids: ["rotation_carry", "funding_divergence", "funding_trend"] },
];
```

- [ ] **Step 2: Harden the recipe_id fallback in SignalRow**

Find (around line 315):

```ts
<span style={S.sigName}>{meta?.label ?? sig.recipe_id}</span>
```

Replace with:

```ts
<span style={S.sigName}>{meta?.label ?? "Signal"}</span>
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/signals/feed/FeedClient.tsx
git commit -m "fix(feed): remove unimplemented bridge_inflow/twap from sidebar, harden recipe_id fallback"
```

---

## Task 13: `OverviewClient.tsx` — harden recipe_id fallback

**Files:**
- Modify: `app/OverviewClient.tsx` (line 333)

- [ ] **Step 1: Find and update the fallback**

Find (around line 333):

```ts
<span style={{ fontSize: "13px", fontWeight: 600, color: color.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{RECIPE_META[sig.recipe_id]?.label ?? sig.recipe_id}</span>
```

Replace `sig.recipe_id` fallback with `"Signal"`:

```ts
<span style={{ fontSize: "13px", fontWeight: 600, color: color.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{RECIPE_META[sig.recipe_id]?.label ?? "Signal"}</span>
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/OverviewClient.tsx
git commit -m "fix(overview): harden recipe_id display fallback — never leak snake_case to users"
```

---

## Task 14: Final verification

- [ ] **Step 1: Run full test suite**

```bash
npm run test
```

Expected: all tests pass, including the new `token-tiers` tests.

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Run lint**

```bash
npm run lint
```

Expected: 0 errors.

- [ ] **Step 4: Smoke-test the dev server**

```bash
npm run dev
```

Open `http://localhost:3000/signals/feed`. Verify:
- Recipe sidebar shows 13 recipes across 4 groups (no bridge_inflow or twap_accumulation)
- All recipe labels show human names (no snake_case)
- No TypeScript errors in browser console

Open `http://localhost:3000/signals/performance`. Verify:
- All recipes listed with updated descriptions

- [ ] **Step 5: Invalidate KV recipe config cache**

After the migration has run and code is deployed, the `recipe:config:*` KV keys have a 5-min TTL and self-expire. Wait 5 minutes before verifying recipes pick up new thresholds in the next cron cycle.

To force immediate invalidation, run this one-off in a `tsx` script or Supabase SQL console:

```ts
// One-time: run via `npx tsx scripts/invalidate-recipe-configs.ts` if needed
import { kv } from "@vercel/kv";
const recipes = ["momentum_stack","divergence_squeeze","liq_rebound","wallet_churn","streak_continuation","anti_whale_trap"];
await Promise.all(recipes.map(id => kv.del(`recipe:config:${id}`)));
console.log("KV cache invalidated for", recipes);
```

- [ ] **Step 6: Final commit if any lint fixes made**

```bash
git add -A
git commit -m "chore: signal pipeline optimization complete — all 14 tasks"
```

---

## Self-Review

### Spec coverage

| Spec requirement | Task |
|---|---|
| signal_outcomes await + diagnostic logging | Task 3 |
| position_aging 4h cooldown | Task 4 |
| rotation_carry bootstrap fix | Task 5 |
| Token tier utility getCoinTier + tieredNotional | Task 1 |
| Tier params in agent_config (migration) | Task 2 |
| momentum_stack R1 tier scaling | Task 7 |
| divergence_squeeze R2 tier scaling | Task 8 |
| liq_rebound R5 tier scaling | Task 9 |
| wallet_churn R12 wire to getRecipeConfig + tier scaling | Task 6 |
| wallet_churn added to recipeIds snapshot | Task 10 |
| recipe-meta.ts descriptions match thresholds | Task 11 |
| bridge_inflow/twap removed from Feed sidebar | Task 12 |
| recipe_id fallback hardened (FeedClient) | Task 12 |
| recipe_id fallback hardened (OverviewClient) | Task 13 |
| streak_continuation MIN_STREAK 5→3 (migration) | Task 2 |
| anti_whale_trap REDUCTION_PCT 0.30→0.20 (migration) | Task 2 |

All 16 spec requirements covered.

### Type consistency check

- `tieredNotional(base, coin, largeMult, smallMult)` — defined Task 1, called in Tasks 6/7/8/9 with identical signature. ✓
- `getCoinTier` exported in Task 1 but not imported in signal-lab (only `tieredNotional` is needed there). ✓
- `recipe12` return type changes from `SignalEvent[]` to `Promise<SignalEvent[]>` — already consumed inside `Promise.all` in `runSignalLab`, no call site changes needed. ✓
- `MAJOR_COINS` renamed to `MAJOR_COINS_R5` inside recipe5 to avoid shadowing the `MAJOR_COINS` export from `token-tiers.ts`. ✓

### No placeholders found. All steps contain complete code.
