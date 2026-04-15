# Sprint 1 — Wallet Tier System

**Date:** 2026-04-13  
**Status:** Ready to implement  
**Depends on:** Nothing  
**Unlocks:** Sprints 2, 3, 4, 5

---

## Goal

Add equity-based tier classification to every tracked wallet and surface it across existing UI. This is the foundational data layer that all analytics features (bias chart, heatmap, radar) group by.

---

## Tier Definitions

| Tier | Min Equity | Max Equity |
|---|---|---|
| Elite | $5M+ | -- |
| Major | $1M | $5M |
| Large | $500K | $1M |
| Mid | $100K | $500K |
| Small | $50K | $100K |
| Micro | $1K | $50K |
| Dust | $0 | $1K |

**Rationale for 7 tiers:**
- Mid absorbs the previously thin $100K-$250K and $250K-$500K bands (only 7 wallets combined in real data, not worth two tiers)
- Micro now covers $1K-$50K, capturing the bulk of active small traders
- Dust is the true noise floor: under $1K accounts are near-zero / inactive / test wallets, excluded from analytics aggregations but still assigned a tier label

Wallets with no snapshot record: `equity_tier = null` — show no badge, exclude from tier filters.

---

## Data Layer

### 1. Supabase Migration
Add `equity_tier` column to `cohort_snapshots`:
```sql
ALTER TABLE cohort_snapshots ADD COLUMN equity_tier text;
```
No constraint — nullable. Backfill existing rows with a one-time UPDATE after deploying the scoring logic.

### 2. Tier Assignment in `cohort-engine.ts`
New exported function `getEquityTier(accountValue: number): string | null`:
- Returns tier label string or null if accountValue is null/undefined
- Used during snapshot write in refresh-cohort

### 3. Snapshot Write (`app/api/refresh-cohort/route.ts`)
When writing each wallet's cohort snapshot, call `getEquityTier(snapshot.account_value)` and include `equity_tier` in the insert payload.

### 4. Wallet Profile API (`app/api/wallet-profile/route.ts`)
Include `equity_tier` in the response alongside existing fields.

---

## UI Changes

### `/wallets/leaderboard`
- Add tier badge pill to each wallet row, rendered after the wallet address
- Add tier filter: multi-select dropdown ("All tiers" default, individual tier options)
- Filter is client-side — no extra API call, filter the existing rows
- Badge style: small pill, 11px text, uppercase label

### `/wallets/discovery`
- Add tier breakdown section: 8 stat cards, one per tier, showing count of wallets
- Query: `SELECT equity_tier, COUNT(*) FROM cohort_snapshots WHERE snapshot_time = (latest) GROUP BY equity_tier`
- New API route or extend existing `scanner-stats` response

### Wallet Profile (wherever wallet profile is rendered)
- Show tier badge near wallet address header
- Pull from `wallet-profile` API response

---

## Design Tokens

Tier badges are **uniform** across all tiers. No color differentiation. No blue, red, or green. The label text is the signal.

Use the existing `ios-pill` CSS class defined in `app/globals.css`. This is the same badge used for coin tickers on /brief and /morning. Do not invent a new style.

| Property | Value |
|---|---|
| Class | `className="ios-pill"` |
| Additional inline style | `fontSize: "11px"`, `fontWeight: 600`, `letterSpacing: "0.04em"`, `textTransform: "uppercase"`, `padding: "2px 8px"` |
| Background, border, blur, hover | Provided by `ios-pill` — do not override |

---

## Acceptance Criteria

- [ ] `equity_tier` column exists in `cohort_snapshots`
- [ ] New snapshots written by `refresh-cohort` include the correct tier
- [ ] Backfill script updates existing rows
- [ ] Leaderboard shows tier badge on each row
- [ ] Leaderboard tier filter works (all tiers, single tier, multi-tier)
- [ ] Discovery page shows tier breakdown counts
- [ ] Wallet profile API returns `equity_tier`
- [ ] Wallets with no snapshot show no badge (no crash)
- [ ] No em dashes in copy, all colors from design tokens
