# Signals / Feed Redesign

**Date:** 2026-04-16
**Status:** Approved
**Scope:** `app/signals/feed/` — full component rewrite + one new API endpoint

---

## Motivation

The existing feed had four structural problems:

1. Signal type pills had variable widths, making content after them misaligned across rows
2. Static recipe description shown on every row repeated information available on hover
3. Wallet IDs were Supabase UUIDs, making address links broken
4. Filters (coin, direction, recipe) were scattered across dropdowns and a separate filter bar

The redesign fixes all four and makes the feed scannable at a glance.

---

## Layout

The page is a two-panel layout: recipe sidebar on the left, feed panel on the right. The feed panel is NOT viewport-locked — it scrolls. The sidebar scrolls independently.

### Page header

Rendered via `<PageHeader />` with:
- Title: `Feed`
- Subtitle: `Live signals from tracked smart money wallets`
- No regime chip

### Recipe sidebar

- Fixed width, independent scroll
- Groups: Momentum / Smart Money / Risk / Carry & Funding
- Each item: colored dot + label
  - Orange dot (`color.amber`) = recipe fired today (signal in last 24h)
  - Dim dot (`color.borderHover`) = quiet
- Click to toggle selection (multi-select). None selected = show all.
- Selected state: `color.borderHover` border + slight background lift
- Hover: portal popup above the item showing recipe name, description, 7-day spark chart labeled "7D"
- Popup must be rendered via React `createPortal` to `document.body` to avoid backdrop-filter stacking context clipping. Use `layout.zIndex.popup` (1000).

### Feed card header

Single bar containing:
- Left: coin chip row (BTC / ETH / SOL / HYPE / ARB / AVAX / DOGE / SUI) + expandable search icon
- Right: segmented direction control (ALL / LONG / SHORT / FLAT)
- No "All Recipes" label — the sidebar selection state drives recipe filtering

**Coin chips:** toggle on click, multiple active allowed, none active = no coin filter. Style: `color.tagBg` background, `color.tagText` color, `radius.tag` (5px), 11px `type.sans`.

**Search icon:** 28x28px icon button. On click: expands to 72px wide inline input, icon fades out (`opacity: 0`), input fades in. Click outside or Escape collapses and clears. `radius.input` (6px). Transition: `width 0.2s cubic-bezier(0.4,0,0.2,1)`.

**Segmented control:** ALL / LONG / SHORT / FLAT. One active at a time. Background: `color.inputBg`, border: `color.inputBorder`, `radius.input` (6px). Active button: `color.borderHover` background. 11px 700 weight.

All interactive elements in the header get `className="glow-btn"` for shimmer.

### Signal rows

4-column CSS grid per row:

```
76px   |  1fr   |  90px  |  56px
pill   |  body  |  time  |  EV
```

`align-items: center` on the grid. Body uses `align-self: center`.

**Pill (col 1):**
- Fixed 76px, `text-align: center`, `box-sizing: border-box`
- Font: 11px 700, `letter-spacing: 0.06em`, `radius.dirPill` (4px)
- Colors from `signal.*` — backgrounds at 8% alpha, borders at 22% alpha
- Labels: ENTRY / EXIT / ALERT / SCALE IN / SCALE OUT / FLIP (no underscores, use `SIGNAL_TYPE_LABEL` map)
- `align-self: center` within the row

**Body (col 2):**
```
Row 1: sig-name (16px 600, color.text) + coin-tag (11px, color.tagBg/tagText, radius.tag) + dir-pill (11px 700, radius.dirPill)
         flex-wrap: nowrap — name truncates with ellipsis if needed
Row 2: trigger reason — metadata.description (13px, color.textMuted, line-height 1.45)
Row 3: wallet address (11px Geist Mono, color.neutral at 35% alpha, underline link to /wallets/discovery?address=...)
         Display as truncated: 0x{first4}...{last4}
         Omit row 3 entirely for cohort-level recipes (no wallet_id)
```

Direction pill colors: LONG uses `color.longBg` / `color.longBorder` / `color.green`. SHORT uses `color.shortBg` / `color.shortBorder` / `color.red`. FLAT uses `color.neutralBg` / `color.neutralBorder` / `color.neutral`.

**Time (col 3):**
- 13px, `color.textDim`, `text-align: right`, `padding-right: 20px`, `font-variant-numeric: tabular-nums`, `align-self: center`
- Format: if `Date.now() - detected_at < 2 * 60 * 60 * 1000` show relative ("2m ago", "1h ago"), else show `MMM D, HH:mm` (e.g. "Apr 16, 14:32")

**EV (col 4):**
- `border-left: 1px solid color.border`, `align-self: stretch`
- `display: flex; flex-direction: column; align-items: center; justify-content: center`
- `padding-left: 20px; padding-right: 8px`
- Value: 16px 700, `font-variant-numeric: tabular-nums`
  - `color.green` if ev_score > 0.6, `color.amber` if > 0.3, `color.neutral` otherwise
- Label: "EV", 11px, `color.textDim`
- If `ev_score` is null: render empty div (border-left: none)
- Hover: show portal popup above with label "Expected Value" and explanation text (16px `color.textMuted`)

**Row hover:** `color.rowHover` background. Row border-bottom: `color.divider`.

**Infinite scroll:** IntersectionObserver on sentinel div at bottom of list. On intersect, fetch next page from `/api/signals-feed`. Footer text: "scroll for more" while more available, "all signals loaded" when exhausted.

---

## New token added

`layout.zIndex.popup = 1000` — added to `lib/design-tokens.ts`. Use for all portal popups and tooltips rendered at `document.body`.

## Token usage notes

- Wallet address in sig-footer intentionally rendered at 11px (not the 13px `type.walletAddr` default) because it sits in a compact 3-line row below 13px trigger reason. This is a documented exception — if the row design changes, revert to 13px.
- Signal pill backgrounds are `signal.entry` at 8% opacity (`${signal.entry}14` hex), borders at 22% (`${signal.entry}38`). These are consistent with the direction pill pattern in existing code.

---

## New API endpoint: `/api/signals-feed`

**Purpose:** Paginated historical signal fetch for infinite scroll. The live KV snapshot only holds the most recent ~50 signals. Older ones come from Supabase.

**Query params:**
- `before` — ISO timestamp cursor (exclusive upper bound)
- `limit` — default 50, max 100

**Response:**
```ts
{
  signals: Signal[],
  hasMore: boolean
}
```

**Query:** `SELECT s.*, w.address as wallet_address FROM signals s LEFT JOIN wallets w ON s.wallet_id = w.id WHERE s.detected_at < $before ORDER BY s.detected_at DESC LIMIT $limit`

The JOIN is what provides the actual `0x...` address. The existing `wallet_id` column on signals is the Supabase UUID — never expose it directly.

**Auth:** No auth required (public read). Use `SUPABASE_ANON_KEY`.

---

## Wallet address bug fix

`wallet_id` on `CohortCachePayload["recent_signals"]` is currently the Supabase row UUID, not the on-chain address. Two fixes required:

1. In `/api/signals-feed`: JOIN `wallets` table and return `wallet_address` field
2. In `/api/refresh-cohort` / `cohort-state`: when building `recent_signals` for the KV snapshot, include the wallet's on-chain address (already available during scoring as `wallet.address`)

Display format: `0x{first4}...{last4}` — computed client-side from the full address.

Link target: `/wallets/discovery?address={full_address}`

---

## FeedClient.tsx structure

```
FeedClient
  state: selectedRecipes (Set<string>), filterDir, filterCoin, searchOpen
  state: extra (Signal[]), hasMore, isFetching
  data: useQuery("cohort-state") — live KV, 60s polling

  <PageHeader title="Feed" subtitle="..." />
  <div style={S.page}>
    <div style={S.body}>                          // two-panel flex row
      <RecipeSidebar                              // left
        selected={selectedRecipes}
        onToggle={...}
      />
      <div style={S.feedPanel}>                   // right
        <div style={{ ...card.base }}>
          <FeedHeader                             // coin chips + search + seg ctrl
            filterCoin={filterCoin}
            onCoinChange={...}
            filterDir={filterDir}
            onDirChange={...}
          />
          <div style={S.feedScroll} ref={scrollRef}>
            {rows.map(sig => <SignalRow key={...} sig={sig} />)}
            <div ref={sentinelRef} />             // IntersectionObserver target
            <ScrollFooter hasMore isFetching />
          </div>
        </div>
      </div>
    </div>
  </div>

  <RecipePopup />                                 // createPortal to body
  <EvPopup />                                     // createPortal to body
```

Sub-components stay in the same file unless they exceed ~80 lines, at which point extract to `app/signals/feed/` directory siblings.

---

## Filtering logic

```ts
const filtered = allSignals.filter(s => {
  if (selectedRecipes.size > 0 && !selectedRecipes.has(s.recipe_id)) return false;
  if (filterDir !== "all" && s.direction !== filterDir) return false;
  if (filterCoin && !s.coin.toLowerCase().includes(filterCoin.toLowerCase())) return false;
  return true;
});
```

When filters change, reset `extra` and `hasMore` (historical pagination restarts).

---

## Cohort-level recipes

These recipes have no meaningful single wallet — suppress the address row:

```ts
const COHORT_RECIPES = new Set([
  "divergence_squeeze", "liq_rebound", "concentration_risk",
  "funding_divergence", "funding_trend",
]);
```

---

## Files touched

| File | Change |
|------|--------|
| `app/signals/feed/FeedClient.tsx` | Full rewrite |
| `app/api/signals-feed/route.ts` | New — paginated history endpoint |
| `app/api/refresh-cohort/route.ts` | Include wallet on-chain address in KV snapshot |
| `lib/design-tokens.ts` | Added `layout.zIndex.popup` (done) |
| `lib/utils.ts` | Add `truncateAddress(addr)` and `formatSignalTime(ts)` helpers if not already present |

---

## Out of scope

- Divergence tab — separate page, not touched
- Edge tab — not touched
- Mobile layout — existing responsive behavior preserved, no new breakpoints
- Real-time WebSocket push — still polling at 60s intervals via React Query
