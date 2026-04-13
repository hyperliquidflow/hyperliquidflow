# Signals + Edge Unification — Design Spec
**Date:** 2026-04-12  
**Status:** Approved

---

## Problem

Three pages — Signals, Recipes, and Imbalance — answer the same underlying question from different angles: *what does smart money know, and should I follow it?* The naming and separation creates unnecessary navigation overhead and user confusion:

- "Recipes" is internal/developer vocabulary, not trader vocabulary
- "Imbalance" is functionally one signal type (Recipe 7: `funding_divergence`) with a deeper view; it doesn't warrant its own nav item
- `RECIPE_META` is copy-pasted across three files
- Signals and Imbalance both show "what's happening now" — they belong together

---

## Goal

Reduce three pages to two. Make the naming feel like trader vocabulary. Keep the two remaining pages clearly separated by workflow: *live intelligence* vs *signal analytics*.

---

## Pages After This Change

### `/signals` — "Signals"

Two tabs, one route.

**Tab 1 — Signal Feed** (current `/signals` page, unchanged functionally)
- Live recipe event feed from the last scan cycle
- Filterable by recipe, direction, coin
- Shows: coin, recipe label, direction, EV score, confidence bar, timestamp
- Polls `/api/cohort-state` every 60s

**Tab 2 — Divergence** (current `/imbalance` page, moved here)
- Smart Money vs Retail OI scanner
- Lists coins with detected smart/retail directional divergence
- Confidence score and reason string
- Click a row → trade plan panel: entry zone, SL, TP, R/R, Kelly size, funding rate
- Polls `/api/contrarian` every 60s

Page header: `title="Signals"`, `subtitle="Smart Money activity and divergence scanner"`

### `/edge` — "Edge"

Renamed from `/recipes`. Route `/recipes` redirects to `/edge`.

- Performance analytics for all nine signal recipes
- Win rates, EV scores, signal counts, measured_at timestamp
- Data from `/api/recipe-performance`
- Page header: `title="Edge"`, `subtitle="Signal recipe performance"`

---

## Navigation Changes

**Remove:** `Imbalance` entry  
**Keep:** `Signals` entry (now with tabs)  
**Rename:** `Recipes` → `Edge` (pointing to `/edge`)

Nav order (from `components/nav.tsx`): Overview → Morning → Scanner → **Signals** → **Edge** → Wallets → Stalker

Note: `/contrarian` is already a redirect (not a nav item). Its redirect target changes from `/imbalance` → `/signals`.

---

## Code Changes

### New file: `lib/recipe-meta.ts`
Consolidate the `RECIPE_META` object (currently copy-pasted in `signals/page.tsx`, `recipes/page.tsx`, and `page.tsx`) into a single source of truth.

```ts
export const RECIPE_META: Record<string, { label: string; desc: string; color?: string }> = {
  momentum_stack:       { label: "Whale Convergence",       desc: "8+ wallets add $500K+ same direction in under 5 min" },
  divergence_squeeze:   { label: "Silent Loading",           desc: "Exposure rising, price flat, liq buffer below 15%" },
  accumulation_reentry: { label: "Dip Conviction",           desc: "High-score wallets re-enter after 8%+ drawdown in 4h" },
  rotation_carry:       { label: "Funded Edge",              desc: "New position in positive-funding perp with 60%+ hist win rate" },
  liq_rebound:          { label: "Liquidation Flush",        desc: "Smart Money exposure drops sharply, possible cascade (approx.)" },
  streak_continuation:  { label: "Hot Streak",               desc: "5+ trade win streak with Sharpe proxy above 0.6" },
  funding_divergence:   { label: "Smart Money vs. Retail",   desc: "Smart Money and non-Smart Money OI diverge with extreme funding" },
  whale_validated:      { label: "Alpha Confirmation",       desc: "Signal confirmed by 3+ high-score wallets" },
  anti_whale_trap:      { label: "Smart Exit Signal",        desc: "High-score wallet rapidly cutting exposure in adverse Market Vibes" },
};
```

### Files to modify
| File | Change |
|------|--------|
| `app/signals/page.tsx` | Add tab state; absorb Imbalance content into Tab 2 |
| `app/recipes/page.tsx` | Rename to `app/edge/page.tsx`; update title/subtitle; import from `lib/recipe-meta.ts` |
| `app/imbalance/page.tsx` | Delete |
| `app/imbalance/` | Remove directory |
| `app/contrarian/page.tsx` | Update redirect target from `/imbalance` → `/signals` |
| `app/page.tsx` | Import `RECIPE_LABELS` from `lib/recipe-meta.ts` instead of inline definition |
| Navigation component | Remove Imbalance, rename Recipes → Edge, point to `/edge` |
| `app/recipes/` | Add redirect: `redirect('/edge')` |

### Redirect
Add `app/recipes/page.tsx` (or `route.ts`) that issues a permanent redirect to `/edge` so bookmarked links don't 404.

---

## Documentation Changes

| File | Change |
|------|--------|
| `docs/product-overview.md` | Remove Imbalance section; rename Recipes → Edge; update Signals section to describe tabs; update "What It Does" step 3 |
| `SETUP.md` | Update Dashboard Pages table: remove `/imbalance`, `/contrarian`; rename `/recipes` → `/edge`; update Signals description |
| `CLAUDE.md` | Update API Routes table; update architecture notes mentioning "recipes" page |

---

## What Does Not Change

- All nine recipes and their logic in `lib/signal-lab.ts` — untouched
- All API routes — untouched (`/api/contrarian`, `/api/recipe-performance`, `/api/cohort-state`)
- Internal `recipe_id` values in Supabase — untouched
- Scoring model, data flow, cron schedule — untouched
- `signal-lab.ts` internal naming (functions still called `recipe1`–`recipe9`) — untouched

The word "recipe" continues to exist internally in code. The rename is purely UI/UX — what the user sees and navigates to.

---

## Success Criteria

- Navigation has one fewer item (Imbalance removed)
- `/signals` has two tabs: Signal Feed and Divergence
- `/edge` is live; `/recipes` redirects there permanently
- `RECIPE_META` exists in exactly one file
- All documentation reflects the new naming
- No broken links or 404s
