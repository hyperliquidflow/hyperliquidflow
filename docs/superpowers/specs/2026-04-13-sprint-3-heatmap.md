# Sprint 3 — Global Position Heatmap

**Date:** 2026-04-13  
**Status:** Ready when Sprint 1 complete  
**Depends on:** Sprint 1 (equity_tier in cohort_snapshots)

---

## Goal

An asset x tier grid showing which tiers are net long or short in which assets right now. One glance reveals if Elite wallets are short ETH while Micro wallets are long it — that divergence is actionable.

---

## Data Model

For the latest cohort snapshot, parse all `positions` JSONB across all wallets.

Per wallet, per position:
- Extract: `coin` (asset name), `szi` (signed size), `entryPx`, `positionValue`
- Derive: long if `szi > 0`, short if `szi < 0`

Aggregate into matrix: for each `(asset, equity_tier)` cell:
- `wallet_count` — wallets in that tier with a position in that asset
- `total_wallets_in_tier` — total wallets in that tier
- `net_notional` — sum of (szi * entryPx), positive = net long, negative = net short
- `total_oi` — sum of abs(szi * entryPx)
- `bias_score` — net_notional / total_oi, range -1 to +1

---

## API Route: `GET /api/position-heatmap`

**Query params:**
- `age` — position age filter: `24h` (default), `7d`, `all`

**Response:**
```json
{
  "updated_at": "2026-04-13T14:00:00Z",
  "assets": ["BTC", "ETH", "SOL", "HYPE", ...],
  "tiers": ["Elite", "Major", "Large", "Mid", "Standard", "Small", "Micro", "Dust"],
  "matrix": {
    "BTC": {
      "Elite": { "bias_score": 0.62, "wallet_count": 5, "total_oi": 1240000 },
      "Major": { "bias_score": -0.18, "wallet_count": 12, "total_oi": 890000 },
      ...
    }
  },
  "asset_oi_totals": {
    "BTC": 8400000,
    "ETH": 3200000,
    ...
  }
}
```

**Asset selection:** Top 15 assets by total OI across all tiers. Dynamic — changes as positions change.

**Caching:** KV with 5-min TTL key `position-heatmap:24h`. Invalidated on each `refresh-cohort` run.

---

## Page: `/signals/heatmap`

**Title:** "Position Heatmap"

**Layout:**
- Position Age toggle at top right: "24h" / "7d" / "All"
- Grid table below
- Footer: "N positions from M active wallets"

**Grid spec:**
- Rows: assets (sorted by total OI descending)
- Columns: 7 tier names (Elite through Dust, left to right)
- Rightmost column: total OI for that asset row (formatted as $8.4M)
- Header row: tier name labels
- First column: asset name (e.g. "BTC", "ETH")

**Cell rendering:**
- Background color: green (`color.green`) for positive bias, red (`color.red`) for negative
- Opacity = abs(bias_score), e.g. 0.62 bias = 62% opacity of the base color
- Minimum opacity: 0.08 (so even weak positions show a tint)
- Empty cell (no wallets with position): grey background `rgba(255,255,255,0.04)`
- Hover tooltip: "5 of 8 Elite wallets long BTC. Bias: +0.62. OI: $1.24M"

**Nav:** Add "Heatmap" entry under Signals section in `components/nav.tsx`. Update `CHILD_HEIGHTS`.

---

## Acceptance Criteria

- [ ] `/api/position-heatmap` returns correct matrix from latest snapshot positions JSONB
- [ ] Long/short derived correctly from `szi` sign
- [ ] Top 15 assets by OI selected dynamically
- [ ] KV caching works
- [ ] Grid renders with correct green/red color intensity per bias score
- [ ] Empty cells handled (no crash, grey background)
- [ ] Hover tooltip shows correct data
- [ ] Position Age filter changes results (24h = only positions opened in last 24h)
- [ ] Total OI column renders per asset row
- [ ] Nav entry added, CHILD_HEIGHTS updated
- [ ] No em dashes, all colors from design tokens
