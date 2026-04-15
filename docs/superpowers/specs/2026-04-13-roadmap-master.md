# HyperliquidFLOW — Feature Roadmap Master Spec

**Date:** 2026-04-13  
**Status:** Approved for implementation  
**Scope:** 6 sprints spanning wallet intelligence, analytics visualizations, alerts, paper trading, and auth

---

## Overview

Six sequential sprints adding wallet tier intelligence, three analytics visualizations, a wallet alert system with paper copy trading, and a user auth layer. Each sprint is independently shippable and builds on the previous.

Inspired by: competitor research in `docs/competitor-research.md`.

---

## Tier System (applies across all sprints)

8 equity-based wallet tiers, computed from `account_value` in `cohort_snapshots`:

| Tier | Threshold | Count (current data) |
|---|---|---|
| Elite | $5M+ | ~8 |
| Major | $1M – $5M | ~14 |
| Large | $500k – $1M | ~7 |
| Mid | $100k – $500k | ~7 (merged from two thin bands) |
| Small | $50k – $100k | ~5 |
| Micro | $1k – $50k | ~11 |
| Dust | Under $1k | ~15 (noise floor, excluded from aggregations) |

7 tiers total. Mid absorbs the previously split $100k–$250k and $250k–$500k bands. Dust threshold lowered to $1k to isolate true inactive/test accounts.

Wallets without a current `cohort_snapshots` entry show no tier badge (graceful null handling).

---

## Sprint Sequence

| Sprint | Feature | Depends On | Status |
|---|---|---|---|
| 1 | Wallet Tier System | nothing | Not Started |
| 2 | Bias Trend Chart | Sprint 1 | Not Started |
| 3 | Global Position Heatmap | Sprint 1 | Not Started |
| 4 | Market Radar | Sprint 1 | Not Started |
| 5 | Wallet Alerts + Paper Copy Trading | Sprint 1 | Not Started |
| 6 | Auth System | Sprint 5 | Planned (future) |

---

## Sprint 1 — Wallet Tier System

**Goal:** Add equity-based tier classification to the data layer and surface it in existing UI.

### Data Layer
- Add `equity_tier` (text, nullable) column to `cohort_snapshots` via migration
- Tier assignment function in `cohort-engine.ts`: maps `account_value` to tier label
- Called during snapshot write in `refresh-cohort` API route
- Tier stored as the label string (e.g. `"Elite"`, `"Micro"`, `"Dust"`)

### UI
- Tier badge on `/wallets/leaderboard` rows (small pill beside wallet address)
- Tier filter dropdown on leaderboard (multi-select: show all tiers or filter to specific ones)
- Tier breakdown stat cards on `/wallets/discovery` (count per tier)
- Wallet profile API returns `equity_tier` in response

### Design Rules
- Badge styling follows existing pill pattern from design tokens
- Tier color scale: Elite = `color.blue`, Dust = `color.textMuted`, mid-tiers = graduated opacity whites
- No emoji. Label text only.

---

## Sprint 2 — Bias Trend Chart

**Goal:** Time-series chart showing directional bias per tier over time.

### Data
- New API route: `GET /api/bias-trend?window=30`
- Query: for each of the last N snapshots, group by `equity_tier`, compute average net bias
- Net bias = `(long_notional - short_notional) / total_notional` per wallet, averaged per tier
- Requires positions JSONB to have side data (verify: long vs short per position)
- KV-cached at 5-min TTL

### UI
- Multi-line chart: X = snapshot time, Y = bias score (-1 to +1), one line per tier
- Tier toggle checkboxes to show/hide individual tier lines
- Default: show Elite, Major, Large only (most signal-rich)
- Zero line reference at Y=0
- New route: `/signals/bias` with nav entry under Signals section
- Page title: "Bias Trend"

### Notes
- If positions JSONB doesn't distinguish long/short, derive from `total_notional` sign or `unrealized_pnl` direction. Confirm during implementation.

---

## Sprint 3 — Global Position Heatmap

**Goal:** Asset x Tier grid showing which tiers are long/short which assets right now.

### Data
- New API route: `GET /api/position-heatmap?age=24h`
- For latest snapshot: parse positions JSONB across all wallets, group by asset and tier
- Per cell: net bias score + wallet count with position + total OI in that asset for that tier
- Age filter: 24h (default), 7d, all-time
- KV-cached at 5-min TTL

### UI
- Grid table: assets as rows, tiers as columns (8 columns)
- Cell color: green = net long, red = net short, grey = neutral/no position
- Color intensity = conviction (% of tier wallets holding that asset)
- Rightmost column: total OI per asset across all tiers
- Position Age toggle: 24h / 7d / All
- Top 15 assets by total OI shown as rows (dynamic)
- New route: `/signals/heatmap` with nav entry under Signals section
- Page title: "Position Heatmap"

---

## Sprint 4 — Market Radar

**Goal:** Price-axis visualization showing where wallet positions cluster for a selected asset.

### Data
- New API route: `GET /api/market-radar?asset=BTC&tier=all`
- Parse all open positions for selected asset from latest cohort_snapshots
- Bucket avg_entry_price into N price buckets (e.g. 50 buckets across ±20% of current price)
- Per bucket: wallet count, total notional, estimated liquidation density (from liq_buffer_pct)
- Live price fetched from Hyperliquid API (already used in market-ticker route)
- Tier filter: "All" default, or filter to specific tier

### UI
- Horizontal bar chart: Y axis = price levels, X axis = position density (wallet count or OI)
- Long positions (above current price avg entries) = green bars, short positions = red bars
- Current price highlighted as a horizontal reference line
- Liquidation zone overlay: estimated price levels where forced selling clusters
- Asset selector: top 10 assets by total OI (from heatmap data)
- Tier filter dropdown
- New route: `/signals/radar` with nav entry under Signals section
- Page title: "Market Radar"

### Notes
- Most complex visualization. Requires careful price bucketing logic.
- Liquidation estimation: use `liq_buffer_pct` from snapshots to estimate liq price from entry.

---

## Sprint 5 — Wallet Alerts + Paper Copy Trading

**Goal:** Let users subscribe to wallets and simulate copy-trading them without real capital.

### Architecture — localStorage-first
All user data (subscriptions, paper portfolio) stored in browser localStorage in Sprint 5.
Data model designed for future migration to Supabase user tables in Sprint 6 (auth).

### Part A — Wallet Alerts

**Data model (localStorage):**
```
followed_wallets: [{ address, label?, followed_at, alert_on: ['open','close','resize'] }]
alert_events: [{ wallet_address, event_type, asset, side, size, price, detected_at, seen }]
```

**Detection:**
- On each `/api/cohort-state` poll response, compare current positions vs previous snapshot stored in localStorage
- Detect: new position opened, position closed, position size changed >10%
- Store event in localStorage alert_events

**UI:**
- Bell icon in nav with unread badge count
- Alert drawer/panel: list of recent events grouped by wallet
- Wallet profile page: "Follow" button, alert toggle options
- New `/wallets/following` page: manage followed wallets

### Part B — Paper Copy Trading

**Data model (localStorage):**
```
paper_portfolio: {
  positions: [{ wallet_address, asset, side, size, entry_price, opened_at, current_pnl }],
  closed_positions: [{ ...above, exit_price, closed_at, realized_pnl }],
  total_virtual_pnl: number
}
paper_settings: { auto_copy: boolean, followed_wallets: string[], size_mode: 'fixed'|'proportional' }
```

**Logic:**
- When a followed wallet opens a position (alert event detected), optionally auto-log a paper position at the same asset/side/detection price
- Paper P&L updated on each poll using live price from `/api/market-ticker`
- When wallet closes, paper position closes at detection price

**UI:**
- New `/wallets/paper` page: open paper positions, P&L tracker, trade history
- Toggle per followed wallet: "Paper copy this wallet"
- Paper position card shows: asset, side, entry price, current price, P&L, comparison to actual wallet P&L

### Sprint 6 Hook
When auth ships, `followed_wallets`, `alert_events`, and `paper_portfolio` migrate from localStorage to Supabase tables keyed by `user_id`. The UI components do not change.

---

## Sprint 6 — Auth System (Planned, Not In Scope Yet)

**Goal:** Add user accounts so alerts and paper portfolios persist across devices.

**Approach:** Supabase Auth (email/password + wallet-connect optional).

**What migrates from Sprint 5:**
- `followed_wallets` → `user_wallet_follows` table (user_id, wallet_address, settings)
- `alert_events` → `user_alert_events` table
- `paper_portfolio` → `user_paper_positions` table

**Spec:** Written when Sprint 5 is complete.

---

## Cross-Session Continuity

Sprint status is tracked in `docs/sprints/status.md`.

At the start of each new session: read `docs/sprints/status.md` to know which sprint is active, then read the corresponding spec and plan in `docs/superpowers/specs/` and `docs/superpowers/plans/`.

The implementation plan for the active sprint is the source of truth for what to work on.
