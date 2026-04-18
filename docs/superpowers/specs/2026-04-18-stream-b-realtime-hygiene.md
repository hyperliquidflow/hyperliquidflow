# Stream B — Realtime Hygiene (Live Blow-Up Deactivation)

**Date:** 2026-04-18
**Status:** Draft (revised after audit)
**Depends on:** Stream A (cohort quality gate)
**Unlocks:** Stream E (cleaner active cohort means cleaner signal attribution)

---

## Goal

Keep the active cohort clean between daily scans. Stream A gates activation; Stream B re-applies the health bar on every 5-min cron so wallets that shrink below the equity floor, blow up, or go into a sustained drawdown exit the cohort within minutes instead of persisting for up to 24h.

---

## Problem (measured)

Current state of `/api/refresh-cohort`:

- Only `deactivateDustWallets` runs, and it fires at `account_value < $1,000`. Stream A's activation floor is `$10,000`. A wallet can drop from $50K to $1.5K and keep producing signals for nearly a day.
- No drawdown guard. A wallet that burns 50% equity in a week stays active as long as it's above the dust floor.
- No liquidation-buffer guard. A wallet at `margin_used / account_value ≈ 0.95` is one tick from liquidation but still in the cohort feeding signals.
- Deactivation reasons are not recorded. When the cohort count drops, we can't tell whether a wallet quit trading, got blown out, or fell below equity.

This is the "live blow-up" blind spot called out in the Stream A spec's Non-Goals.

---

## What "healthy active wallet" means here

A wallet keeps its active slot only if, at every cron cycle:

1. **Still capitalised** — `account_value >= $10,000` (match Stream A's floor, with grace to avoid flapping)
2. **Not blowing up right now** — `liq_buffer_pct >= 0.05` OR no open positions (grace-banded to avoid flash dips)
3. **Not drawing down catastrophically** — rolling 7d equity drawdown ≤ 50% (only evaluated when ≥3 snapshots exist)

Rule (1) is the hard gate; (2) and (3) are additive.

---

## Scope

### In scope

- **Raise deactivation equity floor** from `$1,000` → `$10,000`, with a 3-cycle grace band (three consecutive failing snapshots before flipping `is_active = false`)
- **Add liquidation-buffer guard** with 2-cycle grace at `liq_buffer_pct < 0.05` (open positions only — wallets in cash skip this gate)
- **Add rolling 7d drawdown guard**: deactivate if peak-to-current drawdown > 50%. Skip entirely for wallets with fewer than 3 snapshots in the last 7d (newly-activated wallets get a pass until they accrue history)
- **Persist deactivation reason** on `wallets` (new `deactivation_reason`, `deactivated_at` columns)
- **Persist grace counters** on `wallets` (`low_equity_cycles`, `low_buffer_cycles` — smallint, default 0)
- **Write `hygiene_breakdown` into the cohort KV snapshot** (per-reason counts) so Overview can surface health without waiting for Stream F
- **Log breakdown** at the end of every cron cycle (same pattern as Stream A's `rejection_breakdown`)
- **Sanity guard**: log a warning (but still apply) if a single cycle would deactivate >25% of the active cohort

### Out of scope / deferred

- **Re-checking Stream A's performance gates (win_rate, profit_factor, 30d drawdown) in the cron.** Re-computing these requires a `userFillsByTime` fetch per wallet, which is the exact budget cost Stream A squeezed out. We accept up to 24h of staleness on these gates — the daily scan owns them. Stream B only catches failures visible from free cron signals (equity, liq buffer, snapshot equity history).
- Dormancy detection (14d no fills) — handled by Stream A's daily scan via `last_fill_time`
- Wash / sybil detection (Stream C)
- Per-wallet behavior drift profiling (Stream D)
- UI surfacing of deactivation reasons (Stream F) — KV breakdown is a cheap bridge
- Reactivation logic — if a deactivated wallet shows up again on the leaderboard, Stream A handles it

---

## Thresholds

| Constant | Value | Rationale |
|---|---|---|
| `DEACTIVATION_EQUITY_FLOOR` | `$10,000` | Match Stream A's `MIN_EQUITY_FOR_ACTIVATION`. |
| `EQUITY_GRACE_CYCLES` | `3` | ~15 min buffer at 5-min cron. Outlasts funding-tick dips, catches real shrinkage. |
| `MIN_LIQ_BUFFER` | `0.05` | 5% buffer = one adverse move from liquidation. |
| `LIQ_BUFFER_GRACE_CYCLES` | `2` | ~10 min. Short enough to act before blow-up, long enough to survive a candle wick. |
| `MAX_7D_DRAWDOWN` | `0.50` | Looser than activation's 40% 30d gate — 7d is noisier. 50% over 7d is a crisis. |
| `MIN_DRAWDOWN_SNAPSHOTS` | `3` | Below this, skip the gate. Newly activated wallets get a pass until history accrues. |
| `MAX_CYCLE_DEACTIVATION_PCT` | `0.25` | Sanity warning — not a hard stop. >25% in one cycle = investigate gate logic. |

---

## Data additions

### Single migration — `009_wallet_hygiene.sql`

```sql
alter table wallets
  add column if not exists deactivation_reason text,
  add column if not exists deactivated_at       timestamptz,
  add column if not exists low_equity_cycles    smallint not null default 0,
  add column if not exists low_buffer_cycles    smallint not null default 0;

create index if not exists idx_wallets_deactivation_reason
  on wallets(deactivation_reason)
  where deactivation_reason is not null;
```

Deactivation reason values:
- `low_equity` — failed equity floor for 3 consecutive cycles
- `liq_imminent` — liq_buffer < 5% for 2 consecutive cycles
- `drawdown_7d` — 7d rolling drawdown > 50%

### 7d drawdown computation

Read `cohort_snapshots.account_value` for the wallet over the last 7d (existing `(wallet_id, snapshot_time)` index). If fewer than `MIN_DRAWDOWN_SNAPSHOTS` rows, skip the gate for this cycle. Otherwise compute `max(1 - current / rolling_peak)` and compare to `MAX_7D_DRAWDOWN`.

### KV snapshot addition

Current `cohort:active` KV payload carries cohort scores + signals. Append:

```ts
hygiene_breakdown: {
  low_equity:   N,
  liq_imminent: N,
  drawdown_7d:  N,
  total_deactivated_this_cycle: N,
  cohort_size_pre:  N,
  cohort_size_post: N,
}
```

~80 bytes. Consumable by Overview immediately without Stream F.

---

## Cron changes

In `app/api/refresh-cohort/route.ts`, after the cohort scoring loop, replace `deactivateDustWallets` with `applyHygieneGates(cohortSummary)`. The new function:

1. Reads grace counters for all active wallets from `wallets` in one query
2. Evaluates three gates per wallet from in-memory cohort summary
3. For equity + liq_buffer: increments/resets the relevant cycle counter; deactivates when it hits the grace threshold
4. For drawdown: queries last 7d snapshots, deactivates immediately on failure (no grace — we have history-based confirmation)
5. Batches `is_active = false, deactivation_reason = X, deactivated_at = now()` updates
6. Batches grace-counter updates for wallets that failed a gate but haven't exhausted grace yet, and resets counters for wallets that passed
7. Returns the breakdown for KV + logs

Wrapped in `after()` so it doesn't block the cron response (same pattern as current dust-deactivation).

---

## Files changed

| Action | File | What |
|---|---|---|
| MODIFY | `app/api/refresh-cohort/route.ts` | Replace `deactivateDustWallets` call with `applyHygieneGates`; thread breakdown into KV payload |
| NEW | `lib/cohort-hygiene.ts` | All hygiene-gate logic (pure gate predicates + one DB-writing orchestrator) |
| NEW | `supabase/migrations/009_wallet_hygiene.sql` | Four columns + one index |
| NEW | `lib/__tests__/cohort-hygiene.test.ts` | Unit tests per gate — pure predicates covered, DB orchestrator mocked |
| MODIFY | `lib/server/kv-fetchers.ts` | Surface `hygiene_breakdown` from KV payload if present |
| MODIFY | `docs/sprints/status.md` | Mark Stream B complete when done |

No API route additions. No UI changes. No client polling changes.

---

## Non-goals

- Re-checking Stream A performance gates (win_rate / profit_factor / 30d drawdown) — deferred to daily scan
- Dormancy detection — Stream A owns it via `last_fill_time`
- UI surfacing beyond a raw KV field — Stream F
- Reactivation logic beyond what the daily scan already provides
- Touching the daily scan script

---

## Acceptance criteria

1. `npx tsc --noEmit` passes
2. `npm run test` passes, including `cohort-hygiene.test.ts` covering all three gates
3. Migration 009 applies cleanly
4. After one cron cycle with a manually seeded unhealthy wallet (SQL insert of an active wallet with a $5K account_value snapshot), the wallet ends up with `is_active = false, deactivation_reason = 'low_equity'` after three cycles (and no earlier)
5. `hygiene_breakdown` appears in the KV `cohort:active` payload with non-zero counts after 24h of real running
6. No wallet with `account_value >= $10,000 AND liq_buffer_pct >= 0.10` is ever deactivated (verified by SQL 24h post-deploy)
7. `MAX_CYCLE_DEACTIVATION_PCT` warning does not fire under normal conditions after the first week

---

## Rollback

Revert the single cron-route change. Migration 009 is additive and can stay. `lib/cohort-hygiene.ts` becomes dead code but causes no harm. If the guardrail trips or the deactivation count looks wrong, one-line revert to `deactivateDustWallets` and investigate from the logged breakdown.

---

## Risk / open questions

1. **Grace-band flapping near thresholds.** Wallets oscillating around $10K or 5% buffer may cycle deactivate → re-activate (daily scan). Acceptable — losing 5 min of signal from a borderline wallet is cheaper than trusting a deteriorating one.
2. **Reactivation latency.** Transient dip that trips grace costs up to 24h offline until the daily scan. Grace bands mitigate; document the tradeoff.
3. **7d drawdown thin-history skip.** New wallets get a free pass on this gate for ~72h. Accepted — the other two gates still cover them.
4. **Performance-gate staleness.** Stream A's win_rate / profit_factor gates can go stale for up to 24h in-flight. Accepted as the per-wallet fills-fetch cost is prohibitive. Stream D (behavior profile) is the right place to revisit per-wallet in-flight quality.
5. **Cycle-counter contention.** The cron and a manual scan can't both write to the same row simultaneously, but worth confirming Supabase row-lock semantics on the counter update batch.
