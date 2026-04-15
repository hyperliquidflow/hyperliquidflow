# Sprint 4 — Market Radar

**Date:** 2026-04-13  
**Status:** Ready when Sprint 1 complete  
**Depends on:** Sprint 1 (equity_tier); live price data from existing market-ticker route

---

## Goal

For a selected asset, show where wallet positions are clustered along the price axis. Entry price density, liquidation zones, and position-heavy price levels — all visible at a glance. Reveals where forced selling or profit-taking is likely to emerge.

---

## Data Model

From the latest `cohort_snapshots`, for a selected asset:

Per open position in that asset:
- `avg_px` (average entry price)
- `szi` (position size, signed)
- `positionValue` (notional in USD)
- `liquidationPx` — estimated from `liq_buffer_pct`: `liq_px = avg_px * (1 - liq_buffer_pct)` for longs, `avg_px * (1 + liq_buffer_pct)` for shorts

Bucket positions into 60 price buckets spanning the range [current_price * 0.7, current_price * 1.3] (i.e. +/- 30% from current).

Per bucket:
- `long_count` — wallets with long entries in this price range
- `short_count` — wallets with short entries in this price range
- `long_notional` — total notional of longs in this range
- `short_notional` — total notional of shorts in this range
- `liq_long_count` — wallets whose estimated long liquidation price falls in this bucket
- `liq_short_count` — wallets whose estimated short liquidation price falls in this bucket

---

## API Route: `GET /api/market-radar`

**Query params:**
- `asset` — asset name, e.g. `BTC` (required)
- `tier` — tier filter, e.g. `Elite` or `all` (default: `all`)

**Response:**
```json
{
  "asset": "BTC",
  "current_price": 84200,
  "price_range": { "min": 58940, "max": 109460 },
  "buckets": [
    {
      "price_low": 58940,
      "price_high": 59900,
      "long_count": 0,
      "short_count": 3,
      "long_notional": 0,
      "short_notional": 142000,
      "liq_long_count": 0,
      "liq_short_count": 1
    }
  ],
  "stats": {
    "total_positions": 34,
    "total_long_notional": 2400000,
    "total_short_notional": 890000,
    "avg_long_entry": 81400,
    "avg_short_entry": 86200
  }
}
```

**Current price:** Fetched from existing Hyperliquid API client (same source as market-ticker).

**Caching:** KV with 2-min TTL key `market-radar:BTC:all`. Per-asset, per-tier.

---

## Page: `/signals/radar`

**Title:** "Market Radar"

**Layout:**
- Asset selector dropdown (top left) — top 10 assets by OI
- Tier filter (top right) — "All Tiers" default
- Horizontal bar chart (main area)
- Stats row below chart

**Chart spec:**
- Y axis: price levels (ascending top to bottom, current price in middle)
- Current price: bold horizontal reference line with label
- Long bars: extend left from center axis, green (`color.green`), opacity proportional to notional
- Short bars: extend right from center axis, red (`color.red`)
- Liquidation zone overlay: subtle dashed bars in a different shade showing liq density
- Bar width proportional to notional (not count)
- Hover tooltip: "3 wallets short $142k at this level"

**Stats row:**
- Total positions / Long OI / Short OI / Avg long entry / Avg short entry

**Nav:** Add "Radar" entry under Signals section in `components/nav.tsx`. Update `CHILD_HEIGHTS`.

---

## Acceptance Criteria

- [ ] `/api/market-radar` returns correct bucketed data for BTC and other assets
- [ ] Price bucket range covers +/- 30% of current price
- [ ] Long/short correctly separated by szi sign
- [ ] Liquidation estimates computed from liq_buffer_pct
- [ ] Chart renders with long bars left, short bars right, current price line
- [ ] Liquidation overlay renders (dashed, distinct)
- [ ] Asset selector populates from top 10 OI assets
- [ ] Tier filter updates the chart
- [ ] Stats row correct
- [ ] Hover tooltip works
- [ ] Nav entry added, CHILD_HEIGHTS updated
- [ ] No em dashes, all colors from design tokens
