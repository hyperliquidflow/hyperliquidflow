# Sprint 4 — Market Radar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/signals/radar` — a per-asset price-axis view of where cohort wallets hold long/short entries and where their positions are estimated to liquidate. Backed by `/api/market-radar` reading directly from the `cohort_snapshots` JSONB `positions` column, with a 2-minute KV cache per asset+tier.

**Architecture:** The route reads the latest `cohort_snapshots` row per active wallet (via `DISTINCT ON`), flattens the JSONB `positions` array, filters by asset and (optional) `equity_tier`, fetches the asset's current price from the existing Hyperliquid client, and aggregates into 40 price buckets spanning ±30% of current price. Longs and shorts are separated by `szi` sign. Liquidation density uses the exchange-reported `liquidationPx` on each position (not the spec's `liq_buffer_pct` proxy — see "Deviation from spec" below). Top-10 asset list comes from aggregate cohort notional (same logic as `getTopCoins` in refresh-cohort). Output is cached in KV under `market-radar:{asset}:{tier}` for 120s.

The page is a server component that prefetches the default view (top asset, all tiers) via a new `kv-fetchers` helper, then hands the initial payload to a `RadarClient` that renders a mirrored horizontal bar chart (longs left, shorts right) with a bold current-price line and a dashed liquidation-density overlay. Asset selector and tier filter re-query through React Query.

**Tech Stack:** TypeScript, Next.js 15 App Router, Supabase (Postgres, JSONB), Vercel KV, Vitest, React Query. Chart is hand-rolled SVG (no recharts for this sprint — bars are simple rects and the mirrored layout is easier without a library).

---

## Deviation from spec

The spec (lines 22–23) proposes `liq_px = avg_px * (1 ± liq_buffer_pct)`. This is inferior because `liq_buffer_pct` is a wallet-level metric `(accountValue − totalMarginUsed) / accountValue` — applying it to every position on that wallet produces the same buffer regardless of the position's individual leverage or collateral allocation.

Hyperliquid already returns `liquidationPx` per position in `assetPositions[i].position.liquidationPx`. The cron stores the full `assetPositions` array as JSONB in `cohort_snapshots.positions` ([`app/api/refresh-cohort/route.ts:510`](../../app/api/refresh-cohort/route.ts#L510)). We use that field directly and ignore the spec's derivation.

The spec's bucket count of 60 is reduced to **40** because, at ±30% range with 60 buckets (1% granularity), most buckets sit empty for smaller-cohort assets, making the chart read as sparse. 40 buckets gives 1.5% granularity and a visually denser result. Spec acceptance criteria still met.

---

## MANDATORY PRE-READ — do this before touching any code

```
Read: docs/superpowers/specs/2026-04-13-sprint-4-market-radar.md
Read: app/api/refresh-cohort/route.ts            (CohortCachePayload, getTopCoins, SnapshotRow)
Read: lib/hyperliquid-api-client.ts              (HlAssetPosition, HlPosition, fetchAllMids or equivalent for current price)
Read: supabase/migrations/001_initial_schema.sql (cohort_snapshots schema)
Read: supabase/migrations/003_equity_tier.sql    (equity_tier column)
Read: lib/server/kv-fetchers.ts                  (fetcher pattern)
Read: app/signals/feed/page.tsx                  (server component with initialData)
Read: app/signals/feed/FeedClient.tsx            (React Query client pattern)
Read: app/OverviewClient.tsx                     (buildHeatmap pattern — inline SVG/CSS bars)
Read: lib/design-tokens.ts                       (color, card, type, space, row, anim, radius, shadow)
Read: components/nav.tsx                         (NAV array — add Radar under Signals)
Read: lib/__tests__/cohort-engine.test.ts        (vi.mock pattern for supabase + kv)
```

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| CREATE | `lib/radar-utils.ts` | Pure functions: `bucketPositions`, `aggregateTopAssets`, `computeRadarStats`; types: `RadarBucket`, `RadarResponse`. No I/O. |
| CREATE | `lib/__tests__/radar-utils.test.ts` | Unit tests for bucket math, top-asset aggregation, long/short separation, liq-bucket assignment. |
| CREATE | `app/api/market-radar/route.ts` | GET handler: parse `asset` + `tier` params, read KV, fall back to Supabase + current-price fetch, compute buckets, write KV, return JSON. |
| MODIFY | `lib/server/kv-fetchers.ts` | Add `fetchMarketRadar(asset, tier)` helper that reads KV only (no compute). |
| CREATE | `app/signals/radar/page.tsx` | Server component: prefetch default asset+tier, hand to client. |
| CREATE | `app/signals/radar/RadarClient.tsx` | Client: asset dropdown, tier filter, SVG chart (mirrored bars + current-price line + dashed liq overlay), stats row. Uses React Query. |
| CREATE | `app/signals/radar/loading.tsx` | Loading skeleton matching `components/loading-state.tsx` style. |
| MODIFY | `components/nav.tsx` | Add `{ href: "/signals/radar", label: "Radar" }` to signals section children. |
| MODIFY | `app/signals/page.tsx` | If this route has a tab-selector index, add Radar entry (verify during implementation). |

**Note:** `CHILD_HEIGHTS` is referenced only in spec docs, not in code. Nothing to update there.

---

## Task Breakdown

### Task 1 — radar-utils (pure functions, TDD)

- [ ] Create `lib/__tests__/radar-utils.test.ts` with cases:
  - `bucketPositions` — given fabricated positions, returns 40 buckets covering `[price*0.7, price*1.3]`.
  - Long vs short separation by `szi` sign.
  - Out-of-range positions are clamped into first/last bucket (or excluded — decide and document).
  - `liquidationPx` is used when present; positions with `liquidationPx === null` are skipped for liq overlay but still count for entry.
  - `aggregateTopAssets` — returns assets ranked by summed `positionValue` across all wallets, cap 10.
  - `computeRadarStats` — totals, long/short notional, weighted-average long/short entry price.
- [ ] Run tests; they must fail (functions don't exist yet).
- [ ] Implement `lib/radar-utils.ts` to make tests pass.
- [ ] Export types: `RadarBucket`, `RadarResponse`, `RadarPosition` (flat row shape).
- [ ] Verify: `npm run test -- radar-utils`.

### Task 2 — API route

- [ ] Create `app/api/market-radar/route.ts`.
- [ ] Parse `asset` (required, 400 if missing) and `tier` (default `"all"`) from query string.
- [ ] Cache key: `market-radar:${asset}:${tier}`. Read first, return if hit.
- [ ] On miss:
  - Fetch current price via existing Hyperliquid client (reuse whatever `/api/market-ticker` already calls — do not invent a new fetcher).
  - Query Supabase: `SELECT DISTINCT ON (wallet_id) wallet_id, equity_tier, positions FROM cohort_snapshots ORDER BY wallet_id, snapshot_time DESC`. Add `WHERE equity_tier = $1` when tier is not `"all"`.
  - Flatten positions, filter by `coin === asset`, pass into `bucketPositions` + `computeRadarStats`.
  - Write KV with `ex: 120`.
- [ ] Return `RadarResponse` shaped exactly as the spec (lines 44-69).
- [ ] Edge case: zero positions → return empty `buckets: []` and zero stats; client renders "No cohort positions in this asset" state.
- [ ] Also expose top-assets list: either a second route `/api/market-radar/assets` or include it in the main response under `top_assets: string[]`. Pick the latter — one round trip is simpler. Cache separately under `market-radar:top-assets` for 120s so we don't recompute on every asset switch.

### Task 3 — Server component + loading state

- [ ] Create `app/signals/radar/page.tsx` as an async server component.
- [ ] Add `fetchMarketRadar` to `lib/server/kv-fetchers.ts` (KV read only, returns null on miss; page then hits the API route client-side as fallback).
- [ ] Prefetch the default view: first asset from `top_assets` with tier `"all"`. If KV is empty, server component renders the client with `initialData: null` and the client shows loading state.
- [ ] Create `app/signals/radar/loading.tsx` matching existing loading-state conventions.

### Task 4 — RadarClient (the chart)

- [ ] Create `app/signals/radar/RadarClient.tsx`.
- [ ] Layout per spec: asset dropdown top-left, tier filter top-right, chart main area, stats row below.
- [ ] Use `useQuery` with key `["market-radar", asset, tier]`, `refetchInterval: 60_000`, `staleTime: 55_000`, `keepPreviousData: true`, `initialData` from props.
- [ ] Chart — primary design (Option A, mirrored bars):
  - Single SVG element, fixed aspect ratio 3:4 (taller than wide to emphasize price axis).
  - Y axis: price ascending top to bottom (highest price at top per spec).
  - Horizontal center line for `current_price` — stroke `color.accent`, width 1.5px, with a label on the right.
  - Each bucket = one row. Long bar extends left from center with fill `color.green`, width ∝ `long_notional / max_notional`. Shorts mirror right with `color.red`.
  - Liquidation overlay: thin dashed strokes at the bar's end, offset to avoid overlapping the fill. Use `color.green` at 30% opacity for liq-long, `color.red` at 30% for liq-short. `strokeDasharray: "3 3"`.
  - Hover: on each bucket row, render an invisible full-width rect that triggers a tooltip (portal-free — a fixed-position div positioned via mouse coords) reading "3 wallets long $142k · 1 liq near $83.2k".
- [ ] Styling: all tokens from `lib/design-tokens.ts`. Use `C.base` for the wrapper card, `T.cardTitle` for the title, `T.cardLink` for the "View all assets" link (if any).
- [ ] Stats row: 5 metrics per spec, `fontVariantNumeric: "tabular-nums"`, separated by `color.borderFaint` dividers.
- [ ] Copy rules: no em/en dashes. "Avg long entry" not "Avg long entry — $81,400".

### Task 5 — Nav integration

- [ ] In `components/nav.tsx`, add `{ href: "/signals/radar", label: "Radar" }` as the last child of the signals section.
- [ ] Verify visually: nav renders four children under Signals (Feed, Divergence, Performance, Radar).
- [ ] `CHILD_HEIGHTS` is not in code — no change needed. Document this in the task completion note.

### Task 6 — Manual QA + acceptance

- [ ] `npm run typecheck` clean.
- [ ] `npm run lint` clean.
- [ ] `npm run test` clean.
- [ ] `npm run dev`, visit `/signals/radar`:
  - Asset dropdown lists top 10 by cohort notional.
  - Chart renders for BTC with longs left, shorts right, current price line visible.
  - Switching tier to `Elite` updates the chart within one render cycle.
  - Liq overlay shows dashed marks distinct from entry bars.
  - Hover tooltip reads as specified.
  - Switching asset re-queries and updates within 1s (cache warm) or 2–3s (cold).
- [ ] Grep the new files for em/en dashes: `grep -nE '[—–]' app/signals/radar/*.tsx app/api/market-radar/**/*.ts lib/radar-utils.ts` — zero hits.
- [ ] Grep for arbitrary hex colors: must all be via `color.*` imports.
- [ ] Verify acceptance criteria in spec lines 103–116.

### Task 7 — Status doc update

- [ ] Update `docs/sprints/status.md`: mark Sprint 4 COMPLETE, link this plan, set "Last worked on" date.
- [ ] Set Active Sprint to Sprint 5.

---

## Risks / Open Questions

1. **Query cost.** `SELECT DISTINCT ON (wallet_id) ... FROM cohort_snapshots` across ~1200 wallets with JSONB positions could be slow if there are millions of rows. Mitigations: (a) the 2-min KV cache absorbs most traffic; (b) if p95 > 1.5s, add a materialized latest-snapshot view or use a window function with a snapshot_time cutoff (e.g. last 24h). Defer optimization until measured.
2. **Positions with `liquidationPx === null`.** Hyperliquid returns null for positions below the maintenance-margin threshold cache or for spot-adjacent edge cases. We skip these from the liq overlay but keep them in entry-density. Document this in radar-utils.
3. **Current-price source race.** The asset price comes from the Hyperliquid client fresh per request; the positions were snapshotted up to 60s ago. Small drift acceptable for a radar view — this is not an execution tool.
4. **Top-assets drift across tier filters.** The top-assets list is tier-agnostic (computed across all active wallets). Filtering to `Elite` might produce a chart for an asset where Elite wallets hold zero positions. UI handles this via the empty state — acceptable.
