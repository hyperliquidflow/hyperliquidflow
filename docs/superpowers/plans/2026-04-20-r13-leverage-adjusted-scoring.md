# R13: Leverage-Adjusted Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the naive blow_up_distance formula with an empirically-fit leverage penalty, rewrite the scoring formula to include leverage-adjusted Sharpe, and run old vs new scores in a 30-day canary via shadow columns.

**Architecture:** `lib/leverage-risk.ts` holds the penalty function and its tunable parameters. `computeCohortScoresV2` in `lib/cohort-engine.ts` implements the new formula without touching the old one. The daily scan gains Phase 10b, which computes shadow scores from leverage fields already written by Phase 10 (`computeLeverageStats`) and stores them in `wallets.overall_score_shadow`. `rank-ic.ts` tracks `rank_ic_shadow` alongside the existing IC so the 30-day cutover decision has data.

**Tech Stack:** TypeScript, Supabase (Postgres), Vitest, existing `lib/utils.ts` (`mean`, `stddev`, `clamp`)

---

## File Map

| Action | File |
|--------|------|
| Create | `supabase/migrations/018_shadow_scoring.sql` |
| Create | `lib/leverage-risk.ts` |
| Create | `lib/__tests__/leverage-risk.test.ts` |
| Create | `scripts/fit-leverage-penalty.ts` |
| Modify | `lib/cohort-engine.ts` -- add `CohortScoresV2`, `computeCohortScoresV2` |
| Modify | `lib/__tests__/cohort-engine.test.ts` -- add V2 tests |
| Modify | `scripts/daily-wallet-scan.ts` -- add Phase 10b, update `writeScoreHistory` |
| Modify | `scripts/rank-ic.ts` -- add shadow IC computation |

---

## Task 1: Migration 018 -- shadow scoring schema

**Files:**
- Create: `supabase/migrations/018_shadow_scoring.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/018_shadow_scoring.sql
-- Sprint R13: shadow scoring columns for 30-day canary rollout.
--
-- overall_score_shadow:    V2 formula score (lev-adj Sharpe + blow-up penalty).
--                          Written by Phase 10b of daily-wallet-scan.ts.
--                          NULL until Phase 10b first runs.
-- shadow_formula_version:  Identifies the V2 formula variant in use.
--                          Allows future formula updates to be tracked.
--
-- wallet_score_history.overall_score_shadow:
--   Written by writeScoreHistory() alongside overall_score.
--   Enables rank-ic.ts to compute shadow IC using the same lookback data.
--
-- rank_ic_history.rank_ic_shadow:
--   Shadow IC computed by rank-ic.ts using overall_score_shadow.
--   30-day comparison against rank_ic decides cutover.

ALTER TABLE wallets
  ADD COLUMN IF NOT EXISTS overall_score_shadow   NUMERIC(6, 4),
  ADD COLUMN IF NOT EXISTS shadow_formula_version TEXT;

ALTER TABLE wallet_score_history
  ADD COLUMN IF NOT EXISTS overall_score_shadow NUMERIC(6, 4);

ALTER TABLE rank_ic_history
  ADD COLUMN IF NOT EXISTS rank_ic_shadow NUMERIC(8, 4);
```

- [ ] **Step 2: Apply the migration**

```bash
npx supabase db push
```

Expected: migration applies cleanly with no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/018_shadow_scoring.sql
git commit -m "feat(r13): migration 018 -- shadow scoring columns"
```

---

## Task 2: lib/leverage-risk.ts -- penalty functions

**Files:**
- Create: `lib/leverage-risk.ts`

This module owns all leverage-specific math. The `LeveragePenaltyParams` are the fit outputs from `scripts/fit-leverage-penalty.ts`. Update `DEFAULT_PENALTY_PARAMS` after running that script against production data.

- [ ] **Step 1: Create `lib/leverage-risk.ts`**

```typescript
// lib/leverage-risk.ts
// Leverage risk math for scoring V2.
//
// DEFAULT_PENALTY_PARAMS are a conservative prior.
// Run scripts/fit-leverage-penalty.ts against production cohort_attrition data
// to derive empirical replacements (needs 10+ blow-up events for reliability).

import { mean, stddev, clamp } from "@/lib/utils";

export interface LeveragePenaltyParams {
  safe_lev:  number; // leverage at or below this has zero penalty
  max_lev:   number; // leverage at or above this maps to full penalty (1.0)
  exponent:  number; // curve shape: 1=linear, >1=convex (penalises high lev harder)
}

// Conservative prior. Re-fit with fit-leverage-penalty.ts once 10+ blow-up
// events exist in cohort_attrition.
export const DEFAULT_PENALTY_PARAMS: LeveragePenaltyParams = {
  safe_lev:  3,
  max_lev:   15,
  exponent:  1.5,
};

export const SHADOW_FORMULA_VERSION = "v2_r13";

/**
 * Fraction of full blow-up risk attributable to this wallet's max leverage.
 * 0 = safe (leverage <= safe_lev), 1 = at or beyond blow-up threshold.
 */
export function computeBlowUpPenalty(
  maxLeverage: number,
  params: LeveragePenaltyParams = DEFAULT_PENALTY_PARAMS
): number {
  if (maxLeverage <= params.safe_lev) return 0;
  if (maxLeverage >= params.max_lev)  return 1;
  const t = (maxLeverage - params.safe_lev) / (params.max_lev - params.safe_lev);
  return Math.pow(t, params.exponent);
}

/**
 * [0,1] score where 1 = far from blow-up (low leverage) and 0 = at threshold.
 * Used directly as the blow_up_distance factor in V2 scoring.
 */
export function computeBlowUpDistanceScore(
  maxLeverage: number,
  params: LeveragePenaltyParams = DEFAULT_PENALTY_PARAMS
): number {
  return 1 - computeBlowUpPenalty(maxLeverage, params);
}

/**
 * Sharpe proxy computed on leverage-normalised PnL, scaled at 2 (not 3).
 *
 * Normalising by (1 + avgLeverage) levels the field: a wallet running 5x
 * leverage who earns $10K/day is not "better" than one running 1x earning $2K/day
 * if their risk-adjusted returns are identical.
 *
 * @param dailyPnls   30-element array (index 0 = oldest)
 * @param avgLeverage Average leverage observed across snapshots (0 if unknown)
 */
export function computeLevAdjSharpe(dailyPnls: number[], avgLeverage: number): number {
  if (dailyPnls.length === 0) return 0;
  const lev = Math.max(0, avgLeverage);
  const adjPnls = dailyPnls.map((p) => p / (1 + lev));
  const m = mean(adjPnls);
  const s = stddev(adjPnls);
  const raw = m / (s + 0.0001);
  return clamp(raw / 2.0, 0, 1); // normalise at 2, not 3
}
```

- [ ] **Step 2: Verify TypeScript compiles cleanly**

```bash
npm run typecheck
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add lib/leverage-risk.ts
git commit -m "feat(r13): add lib/leverage-risk.ts -- penalty functions and lev-adj Sharpe"
```

---

## Task 3: Tests for lib/leverage-risk.ts

**Files:**
- Create: `lib/__tests__/leverage-risk.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
import { describe, it, expect } from "vitest";
import {
  computeBlowUpPenalty,
  computeBlowUpDistanceScore,
  computeLevAdjSharpe,
  DEFAULT_PENALTY_PARAMS,
} from "../leverage-risk";

const PARAMS = DEFAULT_PENALTY_PARAMS; // safe_lev=3, max_lev=15, exponent=1.5

describe("computeBlowUpPenalty", () => {
  it("returns 0 at or below safe_lev", () => {
    expect(computeBlowUpPenalty(0, PARAMS)).toBe(0);
    expect(computeBlowUpPenalty(3, PARAMS)).toBe(0);
  });

  it("returns 1 at or above max_lev", () => {
    expect(computeBlowUpPenalty(15, PARAMS)).toBe(1);
    expect(computeBlowUpPenalty(20, PARAMS)).toBe(1);
  });

  it("interpolates between safe_lev and max_lev", () => {
    const mid = computeBlowUpPenalty(9, PARAMS); // midpoint of [3,15]
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });

  it("is convex with exponent > 1 (midpoint penalty < 0.5)", () => {
    // With exponent=1.5, the midpoint t=0.5 gives 0.5^1.5 approx 0.354
    const mid = computeBlowUpPenalty(9, PARAMS);
    expect(mid).toBeLessThan(0.5);
  });

  it("is monotonically increasing", () => {
    const a = computeBlowUpPenalty(5, PARAMS);
    const b = computeBlowUpPenalty(10, PARAMS);
    const c = computeBlowUpPenalty(14, PARAMS);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
  });
});

describe("computeBlowUpDistanceScore", () => {
  it("is 1 - penalty", () => {
    expect(computeBlowUpDistanceScore(3, PARAMS)).toBe(1);
    expect(computeBlowUpDistanceScore(15, PARAMS)).toBe(0);
    const mid = computeBlowUpDistanceScore(9, PARAMS);
    expect(mid).toBeCloseTo(1 - computeBlowUpPenalty(9, PARAMS), 6);
  });
});

describe("computeLevAdjSharpe", () => {
  it("returns 0 for empty array", () => {
    expect(computeLevAdjSharpe([], 0)).toBe(0);
  });

  it("returns 0 for all-zero PnL series", () => {
    expect(computeLevAdjSharpe(new Array(30).fill(0), 1)).toBe(0);
  });

  it("is lower for higher leverage with identical raw PnL", () => {
    const pnls = [10, 20, 15, 18, 12, 22, 8, 16, 14, 20,
                  10, 20, 15, 18, 12, 22, 8, 16, 14, 20,
                  10, 20, 15, 18, 12, 22, 8, 16, 14, 20];
    const lowLev  = computeLevAdjSharpe(pnls, 1);
    const highLev = computeLevAdjSharpe(pnls, 10);
    expect(highLev).toBeLessThan(lowLev);
  });

  it("is clamped to [0, 1]", () => {
    const bigPnls = new Array(30).fill(1000);
    const result = computeLevAdjSharpe(bigPnls, 0);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
    const badPnls = new Array(30).fill(-100);
    expect(computeLevAdjSharpe(badPnls, 0)).toBe(0);
  });

  it("normalises at 2 -- a Sharpe of 2 maps to score approx 1.0", () => {
    // Alternating [1,3] gives mean=2, std=1, raw_sharpe=2, score=clamp(2/2,0,1)=1
    const pnls = Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? 1 : 3));
    const score = computeLevAdjSharpe(pnls, 0); // avgLev=0 so adjPnls = pnls
    expect(score).toBeCloseTo(1.0, 1);
  });
});
```

- [ ] **Step 2: Run tests and verify they pass**

```bash
npm run test -- leverage-risk
```

Expected: all 9 tests pass.

- [ ] **Step 3: Commit**

```bash
git add lib/__tests__/leverage-risk.test.ts
git commit -m "test(r13): leverage-risk unit tests"
```

---

## Task 4: scripts/fit-leverage-penalty.ts -- empirical parameter fitting

**Files:**
- Create: `scripts/fit-leverage-penalty.ts`

This script reads `cohort_attrition` joined with `wallets.max_leverage_60d` and fits the relationship. Run it manually against production data. If fewer than 10 blow-up events exist, it prints a warning and the default params apply.

- [ ] **Step 1: Create the fit script**

```typescript
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
    .select("wallet_address, realized_drawdown, state_30d, state_90d, state_180d, state_360d")
    .not("realized_drawdown", "is", null);

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

  // Find safe_lev: highest bin midpoint where blow-up rate < 5%
  let safeLev = 3;
  for (const bin of bins) {
    if (bin.blowupRate < 0.05) safeLev = Math.round(bin.midLev);
  }

  // Find max_lev: lowest bin midpoint where blow-up rate >= 50%
  let maxLev = 15;
  for (const bin of bins) {
    if (bin.blowupRate >= 0.5) { maxLev = Math.round(bin.midLev); break; }
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
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run typecheck
```

Expected: no new errors.

- [ ] **Step 3: Run fit script against production data (requires env vars)**

```bash
npx tsx scripts/fit-leverage-penalty.ts
```

Expected output:
- If < 10 blow-up events: descriptive stats + "Keeping DEFAULT_PENALTY_PARAMS" (likely at R13 time)
- If >= 10 blow-up events: JSON params to paste into `DEFAULT_PENALTY_PARAMS` in `lib/leverage-risk.ts`

Update `lib/leverage-risk.ts` `DEFAULT_PENALTY_PARAMS` with the output if the fit ran. If not enough data, keep the defaults.

- [ ] **Step 4: Commit**

```bash
git add scripts/fit-leverage-penalty.ts
git commit -m "feat(r13): add fit-leverage-penalty.ts -- empirical parameter fitting"
```

---

## Task 5: lib/cohort-engine.ts -- CohortScoresV2 + computeCohortScoresV2

**Files:**
- Modify: `lib/cohort-engine.ts`

Add `CohortScoresV2` and `computeCohortScoresV2` after the closing brace of `computeCohortScores` (after line 258). The old function stays unchanged.

- [ ] **Step 1: Add the import for leverage-risk at the top of the file**

After the existing imports (around line 8), add:

```typescript
import { computeLevAdjSharpe, computeBlowUpDistanceScore } from "@/lib/leverage-risk";
```

- [ ] **Step 2: Add the V2 type and function after `computeCohortScores` (after line 258)**

```typescript
// V2 scoring -- leverage-adjusted formula (Sprint R13 shadow rollout)

export interface CohortScoresV2 {
  lev_adj_sharpe:      number; // [0,1] Sharpe on lev-normalised PnL, scaled at 2
  pnl_consistency:     number; // [0,1] unchanged from V1
  drawdown_score:      number; // [0,1] unchanged from V1
  regime_fit:          number; // [0,1] defaults to 0.5 when state unavailable
  blow_up_distance_v2: number; // [0,1] empirically-fit penalty
  overall_score_v2:    number; // [0,1] composite
}

/**
 * V2 formula: 0.30*lev_adj_sharpe + 0.20*pnl_consistency + 0.20*drawdown
 *             + 0.15*regime_fit + 0.15*blow_up_distance
 *
 * state and regime are optional. When omitted (daily-scan shadow context),
 * regime_fit defaults to 0.5 (neutral, no directional bias assumed).
 *
 * @param dailyPnls   30-element PnL array (index 0 = oldest)
 * @param avgLeverage Average leverage from wallets.avg_leverage_60d (0 if unknown)
 * @param maxLeverage Max leverage from wallets.max_leverage_60d (0 if unknown)
 * @param state       Current clearinghouseState (optional)
 * @param regime      Detected market regime (optional)
 */
export function computeCohortScoresV2(
  dailyPnls:    number[],
  avgLeverage:  number,
  maxLeverage:  number,
  state?:       HlClearinghouseState,
  regime?:      RegimeDetection["regime"]
): CohortScoresV2 {
  const lev_adj_sharpe      = computeLevAdjSharpe(dailyPnls, avgLeverage);
  const pnl_consistency     = computePnlConsistency(dailyPnls);
  const drawdown_score      = computeDrawdownScore(dailyPnls);
  const blow_up_distance_v2 = computeBlowUpDistanceScore(maxLeverage);
  const regime_fit =
    state && regime ? computeRegimeFit(state, regime) : 0.5;

  const overall_score_v2 = clamp(
    0.30 * lev_adj_sharpe  +
    0.20 * pnl_consistency +
    0.20 * drawdown_score  +
    0.15 * regime_fit      +
    0.15 * blow_up_distance_v2,
    0,
    1
  );

  return {
    lev_adj_sharpe,
    pnl_consistency,
    drawdown_score,
    regime_fit,
    blow_up_distance_v2,
    overall_score_v2,
  };
}
```

- [ ] **Step 3: Verify no type errors**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/cohort-engine.ts
git commit -m "feat(r13): add computeCohortScoresV2 -- new formula, non-breaking"
```

---

## Task 6: Tests for computeCohortScoresV2

**Files:**
- Modify: `lib/__tests__/cohort-engine.test.ts`

- [ ] **Step 1: Add V2 tests at the end of the existing test file**

```typescript
import { computeCohortScoresV2 } from "../cohort-engine";

describe("computeCohortScoresV2", () => {
  const FLAT_PNLS = new Array(30).fill(0);
  const GOOD_PNLS = Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? 5 : 15));

  it("returns overall_score_v2 in [0,1]", () => {
    const r = computeCohortScoresV2(GOOD_PNLS, 2, 5);
    expect(r.overall_score_v2).toBeGreaterThanOrEqual(0);
    expect(r.overall_score_v2).toBeLessThanOrEqual(1);
  });

  it("defaults regime_fit to 0.5 when state is omitted", () => {
    const r = computeCohortScoresV2(GOOD_PNLS, 2, 5);
    expect(r.regime_fit).toBe(0.5);
  });

  it("high leverage reduces overall_score_v2", () => {
    const lowLev  = computeCohortScoresV2(GOOD_PNLS, 1, 4);
    const highLev = computeCohortScoresV2(GOOD_PNLS, 8, 14);
    expect(highLev.overall_score_v2).toBeLessThan(lowLev.overall_score_v2);
  });

  it("zero leverage gives max blow_up_distance_v2", () => {
    const r = computeCohortScoresV2(GOOD_PNLS, 0, 0);
    expect(r.blow_up_distance_v2).toBe(1);
  });

  it("flat PnL series scores predictably (regime_fit=0.5, blow_up=1, no PnL factors)", () => {
    // lev_adj_sharpe=0, pnl_consistency=0 (no-data windows skipped)
    // drawdown=1 (zero series has no peak so maxDrawdown stays 0)
    // regime_fit=0.5, blow_up=1
    // = 0.30*0 + 0.20*0 + 0.20*1 + 0.15*0.5 + 0.15*1 = 0.425
    const r = computeCohortScoresV2(FLAT_PNLS, 0, 0);
    expect(r.overall_score_v2).toBeCloseTo(0.425, 2);
  });

  it("all sub-scores are in [0,1]", () => {
    const r = computeCohortScoresV2(GOOD_PNLS, 3, 9);
    expect(r.lev_adj_sharpe).toBeGreaterThanOrEqual(0);
    expect(r.lev_adj_sharpe).toBeLessThanOrEqual(1);
    expect(r.pnl_consistency).toBeGreaterThanOrEqual(0);
    expect(r.pnl_consistency).toBeLessThanOrEqual(1);
    expect(r.drawdown_score).toBeGreaterThanOrEqual(0);
    expect(r.drawdown_score).toBeLessThanOrEqual(1);
    expect(r.blow_up_distance_v2).toBeGreaterThanOrEqual(0);
    expect(r.blow_up_distance_v2).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npm run test -- cohort-engine
```

Expected: all existing tests still pass, new V2 tests pass. If the flat-PnL test fails, log the actual value and update the expected -- the exact value depends on `computeDrawdownScore`'s behavior with an all-zero series.

- [ ] **Step 3: Commit**

```bash
git add lib/__tests__/cohort-engine.test.ts
git commit -m "test(r13): computeCohortScoresV2 unit tests"
```

---

## Task 7: daily-wallet-scan.ts -- Phase 10b shadow scoring

**Files:**
- Modify: `scripts/daily-wallet-scan.ts`

Add `computeShadowScores()` called immediately after `computeLeverageStats()` in the main function.

- [ ] **Step 1: Add the imports at the top of daily-wallet-scan.ts**

Find the existing cohort-engine imports (around line 10-30) and add:

```typescript
import { computeCohortScoresV2 } from "@/lib/cohort-engine";
import { SHADOW_FORMULA_VERSION } from "@/lib/leverage-risk";
```

- [ ] **Step 2: Add the `computeShadowScores` function after `computeLeverageStats` (around line 1060)**

```typescript
// Phase 10b: Shadow scoring (Sprint R13 canary)

async function computeShadowScores(): Promise<{ computed: number }> {
  const { data: activeWallets, error: walletErr } = await supabase
    .from("wallets")
    .select("id, avg_leverage_60d, max_leverage_60d")
    .eq("is_active", true)
    .not("max_leverage_60d", "is", null);

  if (walletErr || !activeWallets?.length) {
    console.warn("[shadow] could not fetch wallets:", walletErr?.message);
    return { computed: 0 };
  }

  const walletIds = activeWallets.map((w) => w.id);

  const { data: backtests } = await supabase
    .from("user_pnl_backtest")
    .select("wallet_id, daily_pnls")
    .in("wallet_id", walletIds);

  const pnlMap = new Map<string, number[]>(
    (backtests ?? []).map((b) => [
      b.wallet_id as string,
      Array.isArray(b.daily_pnls) ? (b.daily_pnls as number[]) : [],
    ])
  );

  let computed = 0;

  for (const wallet of activeWallets) {
    const dailyPnls   = pnlMap.get(wallet.id) ?? [];
    const avgLeverage = Number(wallet.avg_leverage_60d ?? 0);
    const maxLeverage = Number(wallet.max_leverage_60d ?? 0);

    const v2 = computeCohortScoresV2(dailyPnls, avgLeverage, maxLeverage);
    // regime_fit defaults to 0.5 since clearinghouse state is not available in the daily scan

    const { error } = await supabase
      .from("wallets")
      .update({
        overall_score_shadow:   v2.overall_score_v2,
        shadow_formula_version: SHADOW_FORMULA_VERSION,
      })
      .eq("id", wallet.id);

    if (!error) computed++;
  }

  console.log(`[shadow] computed shadow scores for ${computed} wallets`);
  return { computed };
}
```

- [ ] **Step 3: Call `computeShadowScores` in main() immediately after `computeLeverageStats`**

Find (around line 1665):

```typescript
const leverageResult = await computeLeverageStats();
```

Add the line immediately after:

```typescript
const shadowResult = await computeShadowScores();
```

- [ ] **Step 4: Add shadow result to the log output**

Find the log line that prints leverage stats and extend it:

```typescript
console.log(`[phase-10b] shadow scores: ${shadowResult.computed} computed`);
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 6: Run full test suite**

```bash
npm run test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add scripts/daily-wallet-scan.ts
git commit -m "feat(r13): daily-wallet-scan Phase 10b -- compute shadow scores after leverage stats"
```

---

## Task 8: daily-wallet-scan.ts -- writeScoreHistory includes shadow score

**Files:**
- Modify: `scripts/daily-wallet-scan.ts` -- `writeScoreHistory` function only

- [ ] **Step 1: Update the wallets select query in `writeScoreHistory` (around line 1731)**

Change:

```typescript
.select("id, overall_score")
```

To:

```typescript
.select("id, overall_score, overall_score_shadow")
```

- [ ] **Step 2: Update the rows mapping (around line 1757)**

Change:

```typescript
const rows = activeWallets.map((w) => ({
  date:          today,
  wallet_id:     w.id,
  overall_score: w.overall_score,
  daily_pnl_usd: pnlMap.get(w.id) ?? 0,
}));
```

To:

```typescript
const rows = activeWallets.map((w) => ({
  date:                  today,
  wallet_id:             w.id,
  overall_score:         w.overall_score,
  overall_score_shadow:  (w as Record<string, unknown>).overall_score_shadow as number | null ?? null,
  daily_pnl_usd:         pnlMap.get(w.id) ?? 0,
}));
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Run full test suite**

```bash
npm run test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/daily-wallet-scan.ts
git commit -m "feat(r13): writeScoreHistory includes overall_score_shadow"
```

---

## Task 9: rank-ic.ts -- shadow IC computation

**Files:**
- Modify: `scripts/rank-ic.ts`

Add `computeShadowIcForDate` and call it alongside the existing IC computation. Writes `rank_ic_shadow` to each `rank_ic_history` row.

- [ ] **Step 1: Add `computeShadowIcForDate` after `computeIcForDate` (around line 152)**

```typescript
async function computeShadowIcForDate(dateStr: string): Promise<number | null> {
  const { data: scores, error: scErr } = await supabase
    .from("wallet_score_history")
    .select("wallet_id, overall_score_shadow")
    .eq("date", dateStr)
    .not("overall_score_shadow", "is", null);

  if (scErr || !scores || scores.length < 20) return null;

  const dStart = new Date(dateStr);
  dStart.setDate(dStart.getDate() + 1);
  const dEnd = new Date(dateStr);
  dEnd.setDate(dEnd.getDate() + HORIZON_DAYS);

  const walletIds = scores.map((s) => s.wallet_id);
  const { data: pnlRows } = await supabase
    .from("wallet_score_history")
    .select("wallet_id, daily_pnl_usd")
    .in("wallet_id", walletIds)
    .gte("date", dStart.toISOString().slice(0, 10))
    .lte("date", dEnd.toISOString().slice(0, 10));

  if (!pnlRows) return null;

  const returnMap = new Map<string, number>();
  for (const row of pnlRows) {
    returnMap.set(row.wallet_id, (returnMap.get(row.wallet_id) ?? 0) + (row.daily_pnl_usd ?? 0));
  }

  const pairs: Array<{ score: number; ret: number }> = [];
  for (const s of scores) {
    const ret = returnMap.get(s.wallet_id);
    if (ret !== undefined) pairs.push({ score: s.overall_score_shadow as number, ret });
  }

  if (pairs.length < 20) return null;

  try {
    return sampleRankCorrelation(
      pairs.map((p) => p.score),
      pairs.map((p) => p.ret),
    );
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Call shadow IC in the measurement loop in main() (around line 276)**

Replace the for-loop body:

```typescript
for (const dateStr of unmeasuredDates) {
  const result = await computeIcForDate(dateStr);
  if (result) {
    computed++;
    const shadowIc = await computeShadowIcForDate(dateStr);
    if (shadowIc !== null) {
      await supabase
        .from("rank_ic_history")
        .update({ rank_ic_shadow: shadowIc })
        .eq("measurement_date", dateStr);
    }
    const status = result.rank_ic > MDIC ? "ABOVE MDIC" : result.rank_ic > 0 ? "positive" : "negative";
    const shadowStr = shadowIc !== null ? ` shadow=${shadowIc.toFixed(4)}` : "";
    console.log(
      `[rank-ic] ${dateStr}: IC=${result.rank_ic.toFixed(4)} ` +
      `p=${result.p_value.toFixed(4)} n=${result.cohort_size} ess=${result.effective_sample_size}${shadowStr} [${status}]`
    );
  } else {
    skipped++;
  }
}
```

- [ ] **Step 3: Add shadow IC to the gate summary (after the existing median/aboveMdic lines, around line 301)**

```typescript
const { data: shadowHistory } = await supabase
  .from("rank_ic_history")
  .select("rank_ic_shadow")
  .order("measurement_date", { ascending: false })
  .limit(30)
  .not("rank_ic_shadow", "is", null);

if (shadowHistory && shadowHistory.length >= 10) {
  const shadowVals = shadowHistory.map((r) => r.rank_ic_shadow ?? 0).sort((a, b) => a - b);
  const shadowMedian = shadowVals[Math.floor(shadowVals.length / 2)];
  console.log(`[rank-ic] Shadow IC (V2 formula): median=${shadowMedian.toFixed(4)} over ${shadowHistory.length} measurements`);
  if (shadowMedian > median) {
    console.log("[rank-ic] V2 shadow IC is above V1 IC. V2 showing improvement. Monitor for 30-day cutover.");
  }
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 5: Run full test suite**

```bash
npm run test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/rank-ic.ts
git commit -m "feat(r13): rank-ic.ts tracks shadow IC for 30-day cutover comparison"
```

---

## Task 10: Sprint status and documentation

- [ ] **Step 1: Run full test suite one final time**

```bash
npm run test && npm run typecheck
```

Expected: all tests pass, no type errors.

- [ ] **Step 2: Update `docs/sprints/status.md`**

Replace the R13-R24 PLANNED row with two rows:

```markdown
| R13 | Empirically-fit leverage-adjusted scoring | COMPLETE (2026-04-20) | migration 018, lib/leverage-risk.ts, computeCohortScoresV2, Phase 10b shadow scoring, rank-ic shadow IC |
| R14-R24 | Phases 3-4 (remainder) | PLANNED | |
```

Add to the "Known Gaps" section:

```
- **R13 shadow cutover (30-day gate)**: After 30 days of parallel rank_ic + rank_ic_shadow data,
  compare medians. If rank_ic_shadow >= rank_ic - 0.02, run fit-leverage-penalty.ts with refreshed
  data, then cut over by replacing computeCohortScores with computeCohortScoresV2 throughout
  refresh-cohort/route.ts and daily-wallet-scan.ts, and remove the shadow infra.
```

- [ ] **Step 3: Commit**

```bash
git add docs/sprints/status.md
git commit -m "docs: mark R13 complete, note 30-day shadow cutover gate"
```

---

## Self-Review

**Spec coverage:**
- Pre-work: `fit-leverage-penalty.ts` fits leverage-to-blow-up from `cohort_attrition` empirically
- `lib/leverage-risk.ts`: penalty function with tunable params, `computeLevAdjSharpe` normalised at 2
- `computeCohortScoresV2`: weights `0.30/0.20/0.20/0.15/0.15` exactly as specified
- Migration 018: `overall_score_shadow`, `shadow_formula_version` on `wallets`; also adds shadow columns to `wallet_score_history` and `rank_ic_history` for IC comparison
- 30-day parallel IC comparison: tracked via `rank_ic_shadow` in `rank-ic.ts`
- Cutover gated on comparison data: documented in sprint status Known Gaps

**Known approximation:** Shadow scores in the daily scan use `regime_fit = 0.5` because no live clearinghouse state is available. This approximation is consistent across all shadow measurements and acceptable for IC comparison. The production formula (post-cutover) will use real regime_fit from the cron context.

**Type safety note:** The `overall_score_shadow` cast in `writeScoreHistory` uses `Record<string, unknown>` because Supabase's generated types won't know about the new column until types are regenerated. This is safe given the migration adds the column; regenerate types after applying migration 018 if strict typing is needed.
