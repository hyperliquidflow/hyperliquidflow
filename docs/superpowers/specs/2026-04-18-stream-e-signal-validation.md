# Stream E — Signal Validation Feedback

**Date:** 2026-04-18
**Status:** Draft
**Depends on:** Stream D (wallet_profiles table populated), Stream F (trading_style in KV — reuses same query)
**Unlocks:** Signal Intelligence Agent Phase 2 (stratified outcome analysis)

---

## Goal

Close the regime-awareness gap in signal generation. Today signals fire without knowing whether the wallet triggering them performs well in the current market regime. A BEAR-specialist wallet loading BTC in a BULL market is fundamentally different evidence than a BULL-specialist doing the same. Stream E captures this distinction at fire time and feeds it back into the signal learning loop.

---

## Problem (concrete)

Current state:

- `signals_history.metadata` is a JSONB column — no regime fit is stored per signal
- `signal-learning.ts` stratifies outcomes by `regime_at_fire` (good) but not by wallet profile fit (missing)
- `agent_findings` can only answer "does R1 work in BULL markets?" but not "does R1 work when the triggering wallets are BULL specialists?"
- The `wallet_profiles` table (Stream D) has exactly the data needed but nothing reads it at signal fire time

This is the signal quality floor identified in the waterproofing roadmap. Even a high-quality signal recipe can fire noise if triggered by a wallet whose profile doesn't fit the current regime.

---

## What Stream E adds

### E1 — `lib/signal-validation.ts` (new pure functions)

```ts
/**
 * How well does one wallet perform in the current regime, relative to its
 * own regime spread?
 *
 * Returns [0, 1] where 1 = current regime is this wallet's best, 0 = worst.
 * Returns null when there isn't enough regime data (all three regimes are null).
 */
export function computeWalletRegimeFit(
  bullPnl:       number | null,
  bearPnl:       number | null,
  rangingPnl:    number | null,
  currentRegime: "BULL" | "BEAR" | "RANGING",
): number | null

/**
 * Aggregate fit score for a multi-wallet signal.
 * Returns the mean of all non-null per-wallet fits, or null if none are available.
 */
export function computeSignalRegimeFit(
  walletFits: (number | null)[],
): number | null

/**
 * Bucket a fit score into a human-readable tier.
 * Thresholds: LOW < 0.33, MID 0.33–0.67, HIGH > 0.67
 */
export function regimeFitLabel(fit: number | null): "HIGH" | "MID" | "LOW" | null
```

**`computeWalletRegimeFit` formula:**

Get the pnl value for `currentRegime`. Normalize to [0, 1] using the wallet's own best/worst range:

```
fit = (currentPnl - worst) / (best - worst)
```

- If all three regime pnl values are null: return null
- If best === worst (wallet doesn't differentiate regimes): return 0.5
- Clamp result to [0, 1] to handle edge rounding

### E2 — `refresh-cohort/route.ts` (move + extend profile fetch)

**Current:** Step 10b fetches `wallet_id, trading_style` from `wallet_profiles` after `runSignalLab()`.

**Change:** Move the `wallet_profiles` query before Step 9. Extend the select to include `bull_daily_pnl`, `bear_daily_pnl`, `ranging_daily_pnl`. Build a `profileMap: Map<wallet_id, ProfileRow>`. Pass to `runSignalLab()` as a new optional field `walletProfileMap`.

Step 10b then just reads from the already-built map to annotate `cohortSummary` trading styles (no second query).

**Cron budget impact:** Zero. The same query runs once, just earlier and with 3 extra columns. The `wallet_profiles` table has ≤500 rows (one per active wallet). Each extra column is a narrow numeric — negligible payload increase.

### E3 — `lib/signal-lab.ts` (annotate signal metadata)

Add `walletProfileMap?: Map<string, { bull_daily_pnl: number | null; bear_daily_pnl: number | null; ranging_daily_pnl: number | null }>` to `SignalLabInputs`.

In `runSignalLab`, after building `enriched`, annotate each signal's metadata:

```ts
if (inputs.walletProfileMap) {
  for (const event of enriched) {
    const profile = inputs.walletProfileMap.get(event.wallet_id);
    const fit = profile
      ? computeWalletRegimeFit(
          profile.bull_daily_pnl, profile.bear_daily_pnl,
          profile.ranging_daily_pnl, inputs.regime,
        )
      : null;
    event.metadata = { ...event.metadata, wallet_regime_fit: fit };
  }
}
```

This runs before the `signals_history` insert, so `wallet_regime_fit` lands in the persisted JSONB. No schema change — `metadata` is already JSONB.

Cohort-level signals (empty `wallet_id`) get `wallet_regime_fit: null` and are skipped by the profile lookup naturally.

### E4 — `lib/signal-learning-utils.ts` (regime fit stratification)

Add:

```ts
export interface RegimeFitBuckets {
  high: { win_rate: number | null; sample: number };
  mid:  { win_rate: number | null; sample: number };
  low:  { win_rate: number | null; sample: number };
}

/**
 * Stratify a set of outcomes by wallet_regime_fit stored in signal metadata.
 * Returns win rate per HIGH/MID/LOW bucket.
 */
export function computeWinRateByRegimeFit(
  outcomes: Array<{ is_win: boolean | null; regime_fit: number | null }>,
): RegimeFitBuckets
```

Thresholds: LOW < 0.33, MID 0.33–0.67, HIGH >= 0.67.
Win rate is null for any bucket with zero resolved outcomes.

### E5 — `scripts/signal-learning.ts` (include regime fit in findings)

`signal_outcomes.signal_id` is a FK to `signals_history(id)` (migration 007). `signals_history` has the `metadata` JSONB with `wallet_regime_fit`. The existing `runStatsEngine` query joins `signal_outcomes` to `signal_events!inner` for `recipe_id` and `fired_at` — but `signal_events` is the deduped unique-signal table and does not carry per-fire metadata.

**Fix:** After the main outcome query, issue a second query to get regime fit per signal:

```ts
const signalIds = rows.map((r) => r.signal_id);
const { data: metaRows } = await supabase
  .from("signals_history")
  .select("id, metadata")
  .in("id", signalIds);
const regimeFitById = new Map(
  (metaRows ?? []).map((m) => [
    m.id,
    (m.metadata as Record<string, unknown>)?.wallet_regime_fit as number | null ?? null,
  ])
);
```

Join back to outcomes by `signal_id`. Pass to `computeWinRateByRegimeFit()` per recipe. Include in `agent_findings`:
- If HIGH-fit signals have meaningfully better win rate (>0.05 delta vs LOW), log a `REGIME_FIT_SIGNAL` finding
- The learning agent can use this to recommend routing only HIGH-fit signals for new strategies

**Cold start guard:** if `signalIds` is empty or all regime fit values are null, skip the bucket analysis gracefully (same pattern as existing `meetsMinSample` guard).

---

## What this does NOT change

- Signal recipe logic — recipes fire exactly as before
- Signal feed UI — no new UI in this stream (surface if needed in Sprint 7)
- Schema — no new migrations; `metadata` column is already JSONB
- Cold start behavior — if `wallet_profiles` is empty (before first daily scan), `wallet_regime_fit` is null for all signals; system degrades gracefully

---

## Files touched

| File | Action |
|------|--------|
| `lib/signal-validation.ts` | NEW — pure regime fit functions |
| `lib/__tests__/signal-validation.test.ts` | NEW — unit tests |
| `lib/signal-learning-utils.ts` | ADD `computeWinRateByRegimeFit` + `RegimeFitBuckets` type |
| `lib/__tests__/signal-learning-utils.test.ts` | ADD regime fit stratification tests (if file exists) |
| `lib/signal-lab.ts` | ADD `walletProfileMap` to `SignalLabInputs`; annotate metadata before insert |
| `app/api/refresh-cohort/route.ts` | Move profile fetch before Step 9; extend select; pass profileMap to runSignalLab; Step 10b reads from map |
| `scripts/signal-learning.ts` | Extract regime fit from metadata; compute stratified win rates; include in agent findings |

---

## Acceptance criteria

- [ ] `computeWalletRegimeFit` returns 1.0 for a wallet's best regime, 0.0 for worst, 0.5 for equal regimes
- [ ] `computeWalletRegimeFit` returns null when all three pnl values are null
- [ ] `computeSignalRegimeFit` returns null when passed all-null list
- [ ] `wallet_regime_fit` field appears in `signals_history.metadata` JSONB after a cron cycle (or can be verified in unit test)
- [ ] `computeWinRateByRegimeFit` correctly buckets outcomes by threshold
- [ ] Signal learning includes HIGH/MID/LOW win rate breakdown in `agent_findings` content
- [ ] All existing tests pass (no regressions)
- [ ] `runSignalLab` without `walletProfileMap` continues to work (backward-compatible optional param)
