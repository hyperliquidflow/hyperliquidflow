# Stream A — Cohort Quality (Activation Gate)

**Date:** 2026-04-17
**Status:** Ready for review
**Depends on:** Nothing
**Unlocks:** Streams B (realtime hygiene), C (wash/sybil detection), D (behavior profile), E (validation), F (dashboard truth)

---

## Goal

Gate wallet activation on actual smart-money characteristics — capital, sustained profitability, risk discipline, authentic trading — rather than the current loose performance filter. The active cohort must become a high-signal pool of genuine successful traders we can learn from and eventually follow.

---

## Problem (measured)

From the last manual scan run (2026-04-17):

- Leaderboard returned 34,372 rows. Pre-filter collapsed to 3,045 candidates. 1,285 currently active.
- Top-1 leaderboard row — a $41M whale with 2.24% monthly ROI on $1.16M monthly PnL — was previously excluded by a 5% ROI floor. Large wallets run low ROI on big capital.
- Activation check on scored wallets: `win_rate >= 0.52 AND trade_count_30d >= 30 AND realized_pnl_30d > 0` — no filter on account size, risk metrics, trading authenticity, or lifetime profitability.
- DUST/MICRO wallets pollute the "Smart Money" cohort because a $500 account making 31 coin-flip trades with $3 net PnL passes.
- CEX/protocol/deployer wallets live in the cohort until the Hypurrscan post-filter runs at the end of the scan — after API budget is spent scoring them.

---

## What "smart money" means here

A wallet that is all of the following:
1. **Capitalised** — account equity at or above $10K (retail traders under this don't move markets or signal institutional behavior)
2. **Durably profitable** — positive lifetime PnL, not just a hot month
3. **Risk-disciplined** — profit factor ≥ 1.3, max 30d drawdown ≤ 40%
4. **Authentic** — not wash-trading, not airdrop-farming, not rebate-harvesting (catch via trade count ceiling and hold-time heuristics)
5. **Experienced** — at least 90 days of trading history (not a 5-day lucky streak)
6. **A real trader** — not a CEX, protocol treasury, deployer wallet, or gambling account

---

## Scope

### In scope
- Thread leaderboard metadata (accountValue, monthPnl, allTimePnl, oldestWindow PnL where available) through to the scoring step so equity and lifetime data are available at activation without extra API calls
- Pre-score entity filter using Hypurrscan aliases (already fetched at scan end — move earlier)
- Fee-adjusted `realized_pnl_30d` (sum `fee` field from each fill)
- Quality thresholds applied at the `qualifies` gate: equity, profit_factor, max_drawdown, trade_count ceiling, history length
- Restore `allTime_pnl >= 0` as a pre-filter to kill survivorship bias
- Summary reporting: for every rejection reason, log the count so we can tune

### Out of scope (later streams)
- Sybil / cross-wallet correlation (Stream C)
- Live blow-up deactivation in the cron (Stream B)
- Per-wallet behavioral profiling / regime skill (Stream D)
- Signal validation feedback (Stream E)
- UI changes (Stream F)

---

## Thresholds (user-confirmed)

| Constant | Value | Rationale |
|---|---|---|
| `MIN_EQUITY_FOR_ACTIVATION` | `$10,000` | Smart money has capital. Under this = retail, low signal. |
| `MIN_PROFIT_FACTOR` | `1.3` | Gross wins ≥ 30% more than gross losses. Excludes barely-profitable. |
| `MAX_DRAWDOWN_FOR_ACTIVATION` | `0.40` | Max 40% drawdown. Above this = weak risk management. |
| `MAX_TRADES_30D` | `500` | >500 trades/month = wash/farming. Real strategies don't need 17+/day. |
| `MIN_HISTORY_DAYS` | `90` | First fill > 90d ago. Kills lucky-streak newbies. |
| `PRE_QUALIFY_MIN_ALLTIME_PNL` | `0` | Net positive lifetime. Kills survivorship bias (one hot month). |

Existing retained thresholds:
- `WIN_RATE_THRESHOLD = 0.52`
- `MIN_TRADES_30D = 30`
- `MIN_CANDIDATE_PNL_30D = 1_000` (already aligned with activation)
- `PRE_QUALIFY_MIN_MONTH_PNL = 10_000` (absolute PnL gate at pre-filter)

---

## Data additions

### Leaderboard metadata passthrough

Current `fetchLeaderboardAddresses` returns `string[]`. Change to return a structure that carries per-wallet metadata needed downstream:

```ts
type LeaderboardEntry = {
  address:      string;
  accountValue: number;   // live equity at leaderboard snapshot time
  monthPnl:     number;
  allTimePnl:   number;
};
```

Upsert remains address-only. Scoring reads the metadata from an in-memory `Map<address, LeaderboardEntry>` populated during fetch. Wallets not on today's leaderboard (DB re-scores of previously-active wallets) get `null` metadata — their equity gate is deferred to Stream B's cron dust-check (already in place).

### Fee field in fills

`userFillsByTime` returns `fee` as a string on every fill. Extend `FillRecord`:

```ts
interface FillRecord {
  closedPnl: string;
  time:      number;
  fee:       string;   // NEW -- sum and subtract from realized_pnl_30d
}
```

Fee-adjusted PnL replaces the raw `closedPnl` sum:
```
realized_pnl_30d_net = sum(closedPnl) - sum(fee)
```

The stored column `total_pnl_usd` uses the net value. `avg_win_usd` / `avg_loss_usd` stay gross (they're per-trade, not aggregate).

### First-fill timestamp

Reuse the existing fills fetch — it already returns up to 30 days. For history-length check we need the earliest fill *ever*, not just in-window. Two options:

**Option 1 (chosen):** add a separate API call per wallet: `userFillsByTime` with `startTime = 0` and a small window at the oldest possible time, then read the first entry. Too expensive.

**Option 2 (chosen):** use the leaderboard `windowPerformances` — it includes `day`, `week`, `month`, `allTime` windows. If `allTime.vlm > 0 AND month.vlm / allTime.vlm < 1.0` we know they traded before this month. Proxy for "not brand new". Add a threshold: `month_vlm / allTime_vlm <= 0.95` (at least 5% of lifetime volume predates this month).

Chosen: Option 2. No extra API calls.

### Entity filter pre-fetch

`fetchHypurrscanAliases` is currently called at the end of scan. Move it to the start (Phase 0). Before scoring, skip any address whose alias classifies as `cex | deployer | protocol | gambling`. Keep `fund | known | unknown` as scorable.

---

## Activation gate — final formula

```ts
const qualifies =
  // Existing performance gates
  win_rate >= WIN_RATE_THRESHOLD &&
  trade_count_30d >= MIN_TRADES_30D &&
  realized_pnl_30d_net >= MIN_CANDIDATE_PNL_30D &&

  // New quality gates
  profit_factor >= MIN_PROFIT_FACTOR &&
  max_drawdown_pct <= MAX_DRAWDOWN_FOR_ACTIVATION &&
  trade_count_30d <= MAX_TRADES_30D &&

  // Equity gate (only when leaderboard metadata present; otherwise defer to cron)
  (leaderboardEntry == null || leaderboardEntry.accountValue >= MIN_EQUITY_FOR_ACTIVATION) &&

  // Authenticity gates (only when leaderboard metadata present)
  (leaderboardEntry == null || leaderboardEntry.allTimePnl >= PRE_QUALIFY_MIN_ALLTIME_PNL) &&
  (leaderboardEntry == null || notSuspiciouslyFresh(leaderboardEntry));
```

Where `notSuspiciouslyFresh` is the month-vlm / allTime-vlm ratio check from above.

---

## Reporting

Current scan-summary.json:
```json
{ "discovered": N, "new_wallets": N, "activated": N, "deactivated": N, ... }
```

Add a `rejection_breakdown` object tracking per-reason counts so we can tune:

```json
{
  "rejection_breakdown": {
    "low_win_rate":       123,
    "low_trade_count":    45,
    "low_net_pnl":        67,
    "low_profit_factor":  89,
    "high_drawdown":      34,
    "too_many_trades":    12,
    "low_equity":         56,
    "negative_alltime":   78,
    "suspiciously_fresh": 23,
    "entity_excluded":    9
  }
}
```

---

## Files changed

| Action | File | What changes |
|---|---|---|
| MODIFY | `scripts/daily-wallet-scan.ts` | All logic changes (below) |
| MODIFY | `docs/sprints/status.md` | Mark Stream A complete when done |

No migrations. No API routes. No UI. Purely pipeline.

---

## Non-goals

- Touching the cron (`refresh-cohort/route.ts`) — that is Stream B
- Schema changes — deferred to Stream D
- UI changes — deferred to Stream F
- Removing wallets already in the DB marked active — the cron dust-deactivation already handles this gradually. No destructive backfill here.

---

## Acceptance criteria

1. `npx tsc --noEmit` passes on the full project (no new type errors)
2. `npm run test` passes (no new test failures)
3. Manual scan run completes without crash, within 65-minute timeout
4. `scan-summary.json` contains a populated `rejection_breakdown` object
5. A minimum of three of these rejection counters are non-zero (proving the gates actually fire)
6. Activated wallet count is materially lower than before — expect 30-60% reduction from current ~1285 active
7. Zero CEX / deployer / protocol / gambling wallets in the activated set (verified by post-scan SQL check against `entity_type`)

---

## Rollback

Single-file change. Revert the commit if the activated count collapses to near-zero (indicates thresholds too tight) or if any crash appears. All new constants can be individually relaxed via a follow-up commit without schema changes.

---

## Risk / open questions

1. **Thresholds are first-pass.** They're based on intuition, not empirical backtests. After the first scan with rejection breakdown, tune.
2. **Equity gate deferred for DB re-scores.** Wallets not on today's leaderboard rely on the cron dust-check. Acceptable tradeoff to avoid 1285 extra clearinghouseState calls per scan.
3. **Fee-adjustment precision.** Hyperliquid reports `fee` in USD. Need to confirm sign convention (some venues report fees as negative). First scan log will show obvious errors if sign is wrong.
4. **90-day history proxy is imperfect.** `month_vlm / allTime_vlm <= 0.95` may let through a wallet that started in week 5 of month 1. Rare but possible. A more precise check requires an extra API call per candidate — deferred.
