# Sprint 2 — Bias Trend Chart

**Date:** 2026-04-13 (revised 2026-04-14)
**Status:** Approved for implementation
**Depends on:** Sprint 1 (equity_tier column in cohort_snapshots)

---

## Goal

Multi-line time-series chart showing the average net long/short bias for each wallet tier over the last N snapshots. Lets users see whether Elite wallets are getting more bearish while Dust wallets go long — the divergence is the signal.

---

## What "bias" means here

For each wallet snapshot: `net_bias = (long_notional - short_notional) / (long_notional + short_notional)`

Result is -1.0 (fully short) to +1.0 (fully long), 0 = neutral.

Long/short notional is derived from the `positions` JSONB column. The stored shape is `HlAssetPosition[]`:
```ts
{ position: { szi: string, entryPx: string, ... }, type: "oneWay" }
```

Per position: `notional = Math.abs(parseFloat(ap.position.szi) * parseFloat(ap.position.entryPx))`. Positive `szi` = long, negative = short.

Wallets with zero total notional (no open positions) are excluded from the average — do not count them as 0 bias.

Per-tier bias = simple average of all included wallet net_bias values in that tier for that snapshot.

---

## API Route: `GET /api/bias-trend`

**Query params:**
- `window` — number of snapshots to return (default: 30, max: 90)
- `tiers` — comma-separated tier names to filter response (default: all)

**Computation approach:** TypeScript-side JSONB parse.

1. Query Supabase: fetch the last N distinct `snapshot_time` values, then all rows for those timestamps (wallet_id, equity_tier, positions, snapshot_time).
2. For each row: iterate `positions` array, compute per-position notional from `ap.position.szi` and `ap.position.entryPx`, accumulate into `longNotional` (szi > 0) and `shortNotional` (szi < 0). Skip wallets with zero total notional.
3. Group by `[snapshot_time, equity_tier]`, compute simple average of per-wallet net_bias values.
4. Always compute all tiers, then filter to requested `tiers` before returning.

**Response:**
```json
{
  "snapshots": [
    {
      "snapshot_time": "2026-04-13T12:00:00Z",
      "tiers": {
        "Elite": 0.42,
        "Major": 0.18,
        "Large": -0.05,
        "Mid": 0.31,
        "Small": 0.12,
        "Micro": 0.55,
        "Dust": 0.71
      }
    }
  ]
}
```

Null = no wallets with positions in that tier at that snapshot time.

**Caching:** KV key `bias-trend:${window}`, 5-min TTL. Not actively invalidated — expires naturally. Always cache the full all-tiers result; filter by `tiers` param in the response after reading from cache.

**Query logic (TypeScript, not SQL):**
```ts
// 1. Get last N distinct snapshot times
const { data: times } = await supabase
  .from("cohort_snapshots")
  .select("snapshot_time")
  .order("snapshot_time", { ascending: false })
  .limit(window * 1200); // rough upper bound

const distinctTimes = [...new Set(times.map(r => r.snapshot_time))].slice(0, window);

// 2. Fetch all rows for those times
const { data: rows } = await supabase
  .from("cohort_snapshots")
  .select("wallet_id, equity_tier, positions, snapshot_time")
  .in("snapshot_time", distinctTimes);

// 3. Compute per-wallet bias, group by time + tier, average
```

---

## Tier Colors

Used exclusively for chart line colors. Not applied to badges elsewhere.

| Tier  | Color                      |
|-------|----------------------------|
| Elite | `rgba(255,255,255,0.90)`   |
| Major | `rgba(255,255,255,0.72)`   |
| Large | `rgba(255,255,255,0.55)`   |
| Mid   | `rgba(255,255,255,0.40)`   |
| Small | `rgba(255,255,255,0.28)`   |
| Micro | `rgba(255,255,255,0.18)`   |
| Dust  | hidden by default          |

Green (`color.green`) and red (`color.red`) are reserved for the Y-axis directional labels only.

---

## Page: `/signals/bias`

**Title:** "Bias Trend"

**Layout:**
- Full-width multi-line chart (top 70% of viewport)
- Tier toggle row below (7 checkboxes, one per tier)
- Default visible tiers: Elite, Major, Large (most signal-dense)
- Dust excluded from chart by default

**Chart spec:**
- Library: recharts (`LineChart` + `ResponsiveContainer`)
- X axis: snapshot timestamps, formatted as "Apr 13 14:00"
- Y axis: -1.0 to +1.0, tick labels: "-100%", "-50%", "0", "+50%", "+100%"
- Zero reference line at Y=0 (dashed, `color.borderFaint`)
- One `<Line>` per tier, color from tier color table above, `dot={false}`, `strokeWidth={1.5}`
- Tooltip on hover: shows all visible tier values at that timestamp (formatted as e.g. "+42%" / "-5%")
- `connectNulls={false}` — gaps in data render as breaks in the line, not interpolated
- Responsive width via `<ResponsiveContainer width="100%" />`

**Tier toggles:**
- Row of pill buttons below chart, one per tier (excluding Dust unless user enables it)
- Active = full opacity, inactive = `color.textFaint`
- Clicking toggles that tier's line on/off

**Nav:** Add `{ href: "/signals/bias", label: "Bias Trend" }` to the Signals section `children` array in `components/nav.tsx`. No other nav changes needed.

**Data fetching:** Server component (`page.tsx`) fetches initial data via `fetch("/api/bias-trend?window=30")`. Client component (`BiasClient.tsx`) handles chart rendering + tier toggle state, uses React Query for polling (60s interval, same pattern as FeedClient).

---

## Acceptance Criteria

- [ ] `/api/bias-trend` returns correct per-tier bias per snapshot
- [ ] JSONB parsing uses `ap.position.szi` and `ap.position.entryPx` (not top-level fields)
- [ ] Wallets with zero total notional excluded from tier average
- [ ] KV caching works, route responds in <500ms on cache hit
- [ ] Full all-tiers result cached; `tiers` param filters response post-cache
- [ ] Chart renders with multiple lines, one per tier
- [ ] Tier toggles show/hide individual lines
- [ ] Zero reference line visible (dashed)
- [ ] Null tiers render as line breaks, not interpolated gaps
- [ ] Tier colors follow white-to-gray scale from spec
- [ ] Nav entry added under Signals section
- [ ] No em dashes in copy, all colors from design tokens
