# Sprint 9 — Leaderboard Upgrade + API Documentation

**Date:** 2026-04-15  
**Status:** Ready when Sprint 7 complete  
**Depends on:** Sprint 7 (score_30d, score_90d columns must exist in user_pnl_backtest)

---

## Goal

Two deliverables: (1) add a 30d / 90d sort toggle to the wallet leaderboard so users can find wallets that are hot right now vs wallets with proven long-term edge — these are different lists. (2) Write a proper API architecture document covering all three data sources the project uses, so the codebase stays maintainable as complexity grows.

---

## Part A — Leaderboard Sort Toggle

### Current State

**Before writing any code, read:**
- `app/wallets/leaderboard/LeaderboardClient.tsx` — understand current sort logic and rendering
- `app/api/cohort-state/route.ts` — understand what the leaderboard data comes from
- `lib/design-tokens.ts` — all style values must come from here

The leaderboard currently sorts by `overall_score` only.

### New Sort Modes

Three mutually exclusive sort modes (toggle buttons, one active at a time):

| Mode | Label | Sort field | Description |
|------|-------|-----------|-------------|
| `overall` | "Best Overall" | `overall_score` | Default. Composite 4-factor score. |
| `30d` | "Hot Right Now" | `score_30d` | Sorted by 30-day score. Wallets without Allium data (`score_30d = null`) appear at the bottom. |
| `90d` | "Proven Edge" | `score_90d` | Sorted by 90-day score. Wallets without Allium data appear at the bottom. |

Toggle renders as a segmented control at the top-right of the leaderboard, consistent with existing toggle patterns in the codebase (read how other toggles are done before building a new one).

### Data Requirements

`score_30d` and `score_90d` must be included in the KV cohort cache payload so the leaderboard client can sort without an extra API call.

**Before modifying `app/api/refresh-cohort/route.ts` or `cohort-state/route.ts`, read both files in full.**

Changes needed:
- `CohortWalletSummary` interface: add `score_30d: number | null` and `score_90d: number | null`
- Read these values from `user_pnl_backtest` when building `cohortSummary` in `refresh-cohort/route.ts`
- Include them in the KV payload

### Sorting Logic (client-side)

```typescript
function sortWallets(
  wallets: CohortWalletSummary[],
  mode: 'overall' | '30d' | '90d'
): CohortWalletSummary[] {
  if (mode === 'overall') return [...wallets].sort((a, b) => b.overall_score - a.overall_score);
  const field = mode === '30d' ? 'score_30d' : 'score_90d';
  return [...wallets].sort((a, b) => {
    if (a[field] == null && b[field] == null) return 0;
    if (a[field] == null) return 1;   // nulls to bottom
    if (b[field] == null) return -1;
    return b[field] - a[field];
  });
}
```

### Null State

For wallets without Allium data (`score_30d = null` / `score_90d = null`), the score column shows `"N/A"` in muted text instead of a number (no em dashes — project rule). Tooltips differ by sort mode:
- In "Hot Right Now" (30d) mode: "Extended scoring data not yet available for this wallet."
- In "Proven Edge" (90d) mode: "90-day track record not yet available for this wallet."

---

## Part B — API Architecture Documentation

### File

`docs/architecture/api-sources.md`

Create the `docs/architecture/` directory if it does not exist.

### Purpose

A single reference for: what each API provides, why we use it, its constraints, and where in the codebase it lives. Prevents future developers (and AI agents) from duplicating calls, inventing endpoint paths, or misunderstanding data provenance.

### Document Structure

```markdown
# API Sources

Last updated: 2026-04-15

This document describes every external data source used by HyperliquidFLOW.
Before adding a new API call, check here to confirm the right source for your data.

---

## 1. Hyperliquid Native API

**Base URL:** `https://api.hyperliquid.xyz/info` (env: `HYPERLIQUID_API_URL`)  
**Auth:** None required  
**Rate limits:** ~600 req/min (weight-based, undocumented — treat as 2 weight per wallet state call)  
**Client:** `lib/hyperliquid-api-client.ts`  
**Used in:** `app/api/refresh-cohort/`, `scripts/daily-wallet-scan.ts`

**What it provides:**
- Live clearinghouse states (positions, margin, account value)
- Real-time order book (L2)
- Market data (mids, asset contexts, candles)
- Fill history for a wallet — last ~30 days only, no liquidation metadata
- TWAP detection (partial — active orders only)

**What it does NOT provide:**
- Fill history beyond ~30 days
- Liquidation metadata on fills
- Pre/post position snapshots per trade
- Bridge deposit/withdrawal history
- Wallet identity or entity labels

---

## 2. Hypurrscan API

**Base URL:** `https://api.hypurrscan.io` (env: `HYPURRSCAN_API_URL`, default set)  
**Auth:** None required for public endpoints  
**Rate limits:** 1,000 weight per minute per IP (rolling window)  
**Client:** `lib/hypurrscan-api-client.ts`  
**Used in:** `app/api/refresh-cohort/` (via `after()`), `scripts/daily-wallet-scan.ts` (Phase 6)  
**KV cache:** Global aliases cached 24h at key `hypurrscan:global_aliases`

**What it provides:**
- Wallet identity labels (CEX, deployer, protocol, fund, known, unknown)
- Recent bridge deposits and transfers (cross-referenced with tracked wallets)
- Active TWAP order detection per address
- L1 transaction history (recent blocks)

**What it does NOT provide:**
- Historical fill data
- PnL calculations
- Position snapshots
- Market data

**Prerequisites:** Wallets must be registered via `/addAddress/{address}` before `/tags` and `/addressDetails` return data. Run `scripts/bootstrap-hypurrscan-index.ts` once for initial registration.

---

## 3. Allium API

**Base URL (Explorer SQL):** `https://api.allium.so/api/v1/explorer/` (read docs before using)  
**Base URL (Developer API):** See `https://docs.allium.so/api/developer/hyperliquid/overview`  
**Auth:** `X-API-KEY` header — env: `ALLIUM_API_KEY` (required, no default)  
**Rate limits:** Developer API — no published per-second limit; Explorer SQL — credit-based (100 free Explorer Units)  
**Client:** `lib/allium-api-client.ts`  
**Used in:** `scripts/daily-wallet-scan.ts` (Phase 7, top 100 wallets), `scripts/allium-backfill.ts` (one-time)

**What it provides:**
- Full fill history from genesis (2023) for any wallet
- Liquidation metadata per fill (liquidatedUser, markPx, method)
- Pre/post position snapshots per trade
- TWAP IDs on fills
- Bridge flow history
- Funding payment history (via `raw.misc_events`)
- Regime-split performance analysis (derived from fill history)

**Free tier constraints:**
- 100 Explorer Units (SQL batch): use for one-time backfills only
- 20,000 Developer API Units/month: exact per-call cost unconfirmed — verify against actual API usage before projecting capacity. Do not hardcode throughput estimates. Contact Allium to clarify before scaling past prototype.
- Full 1,200-wallet daily coverage likely requires a paid plan

**What it does NOT provide:**
- Real-time positions (use Hyperliquid native API for live data)
- Wallet identity labels (use Hypurrscan)

**Explorer SQL query pattern:** Async — submit query → get queryId → poll until complete → fetch paginated results. See `lib/allium-api-client.ts` for the wrapper. Do not call Explorer SQL from the Vercel cron (10s budget) — batch scripts only.

---

## Decision Matrix

| Data need | Use |
|-----------|-----|
| Live positions and margin | Hyperliquid native |
| Real-time prices and order book | Hyperliquid native |
| Fill history — last 30 days | Hyperliquid native |
| Fill history — beyond 30 days | Allium |
| Liquidation detection | Allium |
| Wallet identity / entity type | Hypurrscan |
| Bridge deposits (recent) | Hypurrscan |
| Active TWAP orders (live) | Hypurrscan |
| Historical TWAP orders | Allium (`raw.twaps`) |
| Funding payment history | Allium (`raw.misc_events`) |
| 90-day regime-split performance | Allium (derived) |
```

---

## Acceptance Criteria

**Part A — Leaderboard:**
- [ ] Sort toggle renders with three modes: "Best Overall", "Hot Right Now", "Proven Edge"
- [ ] "Best Overall" is default, matches current behavior exactly
- [ ] "Hot Right Now" sorts by `score_30d`, nulls at bottom
- [ ] "Proven Edge" sorts by `score_90d`, nulls at bottom
- [ ] Null scores display as "—" with tooltip
- [ ] `score_30d` and `score_90d` included in KV payload and `CohortWalletSummary` interface
- [ ] Typecheck passes — no changes to existing sort behavior when `mode = 'overall'`
- [ ] Full test suite passes

**Part B — API Docs:**
- [ ] `docs/architecture/api-sources.md` created and committed
- [ ] All three API sources documented with base URLs, auth, rate limits, client file, use cases, and limitations
- [ ] Decision matrix included
- [ ] No invented information — every claim verifiable against actual code or external docs
