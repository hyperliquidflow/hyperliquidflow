# Stream C — Wash / Sybil Detection

**Date:** 2026-04-18
**Status:** Draft
**Depends on:** Stream A (active cohort), Stream B (hygiene gate columns on wallets)
**Unlocks:** Stream D (behavior profiles are only meaningful on clean, non-sybil wallets)

---

## Goal

Identify and deactivate two classes of bad actors that survive Stream A's activation gate:

1. **Wash traders** — wallets generating artificial volume/PnL to appear on leaderboards. Signals from them are noise at best, adversarial at worst.
2. **Sybil clusters** — multiple wallet addresses controlled by one entity. Inflates cohort "diversity." One actor's signal appears N times, which can dominate recipe outputs and mislead position sizing.

---

## Problem (measured)

Stream A catches the most blatant cases:
- `MAX_TRADES_30D = 1000` blocks extreme high-frequency farmers
- `profit_factor >= 1.3` blocks barely-profitable grinders

What slips through:
- A wallet making 300 trades/month with 60% win rate, $8K gross PnL, and $7.2K in fees (90% fee-to-gross ratio) — positive net PnL barely, but almost all gains eaten by fees. Classic wash pattern.
- Two wallets with identical or near-identical daily PnL series (e.g., both owned by the same operator who mirrors positions across addresses to appear as independent smart-money signals).

Both are hard to detect per-wallet in isolation. Stream C introduces cross-wallet analysis.

---

## Detection approach

### Gate 1 — Fee efficiency (wash detection)

**Signal:** `total_fees_30d / |realized_pnl_30d_gross|`

A genuine alpha trader earns multiples of what they pay in fees. A wash trader's fee bill approaches or exceeds their gross PnL — they're buying volume, not alpha.

```
fee_ratio = total_fees_30d / max(|realized_pnl_30d_gross|, 1)
```

Threshold: `fee_ratio > 0.60` — paying more than 60 cents in fees per dollar of gross profit.

**Why 0.60 and not lower:**
- Hyperliquid taker fees run 0.035% per trade. At 300 trades/month on $10K avg notional = ~$1,050 fees. A wallet with $2K gross PnL has a 52% ratio — possibly a mid-frequency legitimate trader.
- 60% is the inflection where fee drag becomes the dominant story. Combined with the existing `profit_factor >= 1.3` gate (which catches weak risk-adjusted return), 60% catches the "technically profitable, actually not" case.

**Data needed:** `total_fees_30d` and `realized_pnl_30d_gross` — both already in `ScoringResult`. No new API calls. No new FillRecord fields.

**Where it runs:** In `scoreWallet`. `wash_score` is computed and stored in `ScoringResult` for every wallet that reaches this check (regardless of pass/fail) so the distribution is visible for threshold tuning. Rejection fires only if `wash_score > MAX_FEE_RATIO`.

---

### Gate 2 — Daily PnL series correlation (sybil detection)

**Signal:** Pearson correlation of `daily_pnls` arrays across all active wallets.

Two wallets with `r > 0.95` on their 60d daily PnL series are almost certainly the same operator. Genuine independent traders don't have near-identical daily P&L patterns across 60 data points.

**Algorithm (post-scan, offline):**

1. After scoring completes, `detectSybilClusters()` receives the set of wallet IDs that **qualified in this scan run** (not `is_active` from DB — that reflects yesterday's state, not this run's qualifiers). This prevents comparing a new qualifier against a wallet that failed an earlier gate but happens to share coincidentally correlated backtest rows.
2. Read `user_pnl_backtest` rows for those wallet IDs only.
3. Build a `Map<wallet_id, number[]>` of 60d daily PnL series.
4. For all pairs where both wallets have ≥ 30 non-zero days, compute Pearson r.
5. Flag pairs with `r > 0.95` as a sybil cluster. Assign each cluster a UUID generated deterministically (sort wallet IDs alphabetically, SHA-256 the joined string, take first 8 chars as cluster ID) so re-runs produce the same cluster ID.
6. Within each cluster, keep the wallet with the highest `profit_factor` from this scan run's `ScoringResult` (the "primary") — `overall_score` is a cron artifact unavailable to the daily scan. Deactivate the others with `deactivation_reason = "sybil_duplicate"`.

**Complexity:** O(N²) pairwise comparisons on ~500 active wallets = ~125,000 pairs. Pearson r on 60 floats is cheap. Total: well under 1 second. Scaling ceiling: if cohort grows past ~2,000 wallets (~2M pairs) this needs a bucketing step first (group by dominant coin or regime). Not a concern at current scale.

**Data needed:** `user_pnl_backtest.daily_pnls` already written by the scan. No new API calls.

**Where it runs:** New `detectSybilClusters()` function called at the end of `main()` in `daily-wallet-scan.ts`, after all scoring and DB writes complete.

---

### What Stream C does NOT do (explicit deferrals)

- **Trade timing correlation** (same coin traded at the same millisecond across wallets): requires adding `coin` + `time` to FillRecord and storing per-fill data. API cost is the same (the data is already returned by `userFillsByTime`), but storage and analysis complexity jumps significantly. Defer to Stream D or a later Stream C revision after we've seen the correlation results.
- **On-chain graph analysis** (shared funding addresses): requires an external blockchain data source. Out of scope for this codebase.
- **Real-time wash detection in cron**: fee ratio requires 30d of fills, not available from the cron's snapshot. Daily scan is the right home.

---

## Schema additions

One migration — `010_wash_sybil.sql`:

```sql
alter table wallets
  add column if not exists wash_score        numeric(5,3),   -- fee_ratio, 0–1+
  add column if not exists sybil_cluster_id  text;           -- null = clean; UUID = cluster

-- Stream B added deactivation_reason; "wash_detected" and "sybil_duplicate" are new values
-- No schema change needed for deactivation_reason (text column, open-ended).

create index if not exists idx_wallets_sybil_cluster
  on wallets(sybil_cluster_id)
  where sybil_cluster_id is not null;
```

`wash_score` is written for all scored wallets (not just flagged ones) so we can tune the threshold over time without re-scanning.

---

## Thresholds

| Constant | Value | Rationale |
|---|---|---|
| `MAX_FEE_RATIO` | `0.60` | >60% of gross PnL eaten by fees = economics of wash, not alpha |
| `SYBIL_CORRELATION_THRESHOLD` | `0.95` | Pearson r > 0.95 on 60d daily PnL — near-impossible for independent traders |
| `MIN_NONZERO_DAYS_FOR_SYBIL` | `30` | Below 30 active trading days, correlation is too noisy to trust |
| `SYBIL_CLUSTER_MIN_SIZE` | `2` | Only flag if at least two wallets correlated (no self-flagging) |

---

## Output

### scan-summary.json additions

`wash_detected` goes inside the existing `rejection_breakdown` object (same pattern as Stream A):

```json
{
  "rejection_breakdown": {
    "...existing keys...",
    "wash_detected": 12
  },
  "sybil_clusters_found": 3,
  "sybil_wallets_deactivated": 7
}
```

`sybil_*` counts stay top-level — they are post-scan deactivations, not per-wallet activation gate rejections.

### Deactivation reasons (new values for `wallets.deactivation_reason`)

- `wash_detected` — fee_ratio > MAX_FEE_RATIO at activation or re-scan
- `sybil_duplicate` — lower-scoring member of a sybil cluster

---

## Files changed

| Action | File | What |
|---|---|---|
| NEW | `supabase/migrations/010_wash_sybil.sql` | `wash_score` + `sybil_cluster_id` columns |
| MODIFY | `scripts/daily-wallet-scan.ts` | Add fee_ratio gate in `scoreWallet`; add `detectSybilClusters()` post-scan |
| NEW | `lib/__tests__/wash-sybil.test.ts` | Unit tests for fee ratio computation and Pearson r |
| MODIFY | `docs/sprints/status.md` | Mark Stream C complete when done |

No cron changes. No UI changes. No new API calls.

---

## Acceptance criteria

1. `npx tsc --noEmit` passes
2. `npm run test` passes including new `wash-sybil.test.ts`
3. Migration 010 applies cleanly
4. `wash_score` is non-null in the DB for all wallets that passed prior activation gates and reached the fee ratio check (verifiable by SQL: `select count(*) from wallets where is_active = true and wash_score is null` should be 0 after one full scan)
6. `sybil_clusters_found` appears in scan-summary.json (may be 0 on first run if cohort is clean — acceptable)
7. No wallet with `fee_ratio < 0.40` is flagged as wash (verify by SQL)

---

## Risks and open questions

1. **Fee ratio threshold is first-pass.** 0.60 is intuition-based. After first scan, plot the distribution of `wash_score` across all active wallets to tune. Expect a bimodal distribution — legitimate traders cluster near 0.1–0.3, wash traders near 0.5–0.9.
2. **Sybil false positives on correlated markets.** Two independent wallets who both happen to trade BTC long during a bull run will have correlated daily PnLs even without being the same operator. Pearson r > 0.95 over 60 days is tight enough to filter this — but a market-wide trend month could still produce spurious correlations. Mitigated by the `MIN_NONZERO_DAYS_FOR_SYBIL` floor.
3. **Sybil cluster "keep the best" rule.** Keeping the highest-score wallet from a cluster is a heuristic — the "primary" might itself be the fake, with the real signal in one of the deactivated wallets. Acceptable for now since any wallet in a sybil cluster is suspect regardless of which one we keep.
4. **wash_score for non-qualifying wallets.** The fee ratio gate fires inside `scoreWallet` before activation. Wallets that fail earlier gates (win_rate, trade_count) won't reach the fee ratio check. `wash_score` will be null for these. That's fine — we only care about scores for wallets that could otherwise activate.
5. **Fee ratio is always < 1.0 for qualifying wallets.** Net PnL ≥ $1K means gross > fees by definition (net = gross - fees). So `wash_score` will never exceed 1.0 for wallets that pass Stream A's net PnL gate. `numeric(5,3)` storage is sufficient.
