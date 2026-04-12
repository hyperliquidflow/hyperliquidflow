# Siderail Layout Unification — Design Spec
**Date:** 2026-04-12  
**Status:** Approved

## Goal
Replace the current horizontal sticky topnav with the siderail layout from `public/layouts/layout-3-siderail.html` and unify it across all 8 pages. Ship to production.

---

## Approach
Option A — replace `<Nav>` in place. No route restructuring. Five files change.

---

## Component Architecture

| File | Action |
|---|---|
| `components/nav.tsx` | Replaced entirely → `<SideRail>` |
| `components/page-header.tsx` | New shared component |
| `app/layout.tsx` | Flex row wrapper; main offset on desktop |
| `app/globals.css` | Mobile breakpoint CSS variable |
| `app/morning/page.tsx` | Label rename: "Morning Scan" → "Daily Brief" |

Each of the 8 pages replaces its existing header block with `<PageHeader>`.

---

## `<SideRail>` Component

**File:** `components/nav.tsx` — export name stays `Nav` so `app/layout.tsx` import needs no change.

**Structure:**
1. **Logo block** — "HyperliquidFLOW" with stagger-lift hover animation (each letter lifts on hover with cascading `transition-delay` per character, matching prototype). `border-bottom` separator below.
2. **Nav sections** — three groups with uppercase section labels:
   - `DASHBOARD`: Overview (`/`), Signals (`/signals`), Wallets (`/wallets`), Scanner (`/scanner`)
   - `STRATEGY`: Recipes (`/recipes`), Daily Brief (`/morning`)
   - `RESEARCH`: Stalker (`/stalker`), Contrarian (`/contrarian`)
3. **Footer** — pulsing green live dot + "LIVE" text + last-updated timestamp from `/api/cohort-state` (uses existing React Query cache key `["cohort-state"]`, zero extra network requests).

**Active state:** `border-left: 2px solid rgba(151,253,229,0.7)` + `background: rgba(151,253,229,0.05)`.  
**Hover state:** radial cursor-tracked glow — a `mousemove` listener on each nav item sets `--mx`/`--my` CSS custom properties, driving a `radial-gradient` pseudo-element (matching prototype).

**Mobile (≤768px):**
- Rail hides off-screen via `transform: translateX(-200px)`, `transition: transform 0.25s`
- Fixed hamburger button (`≡`) top-left, z-index above rail
- Tap opens rail as drawer overlay; semi-transparent backdrop tap closes it
- `usePathname` change closes the drawer automatically (navigation closes it)

---

## `<PageHeader>` Component

**File:** `components/page-header.tsx`

```ts
interface PageHeaderProps {
  title: string
  subtitle?: string
  regime?: "BULL" | "BEAR" | "RANGING"  // omit = no chip rendered
}
```

**Layout:** `padding: "28px 32px 0"`, flex row, space-between alignment.  
**Left:** title (26px/700/`#f0f0f0`) + subtitle (14px/`rgba(255,255,255,0.38)`, margin-top 4px).  
**Right:** regime chip (omitted if prop absent).

**Regime chip** matches prototype:
- BULL: `#6aaa7a` green, `rgba(106,170,122,0.08)` bg, `rgba(106,170,122,0.2)` border
- BEAR: `#b06868` red, equivalent tints
- RANGING: `#9ca3af` grey, equivalent tints
- Pulsing dot animation (`glow-pulse` keyframe already in layout)
- Hover: border brightens + radial glow

**Per-page usage:**

| Page | title | subtitle | regime |
|---|---|---|---|
| Overview (`/`) | "Overview" | "Smart money dashboard" | `data?.regime` |
| Signals (`/signals`) | "Signals" | "Live signal feed — all 9 recipes" | `data?.regime` |
| Wallets (`/wallets`) | "Whale Report" | "Top wallets by composite score" | omit |
| Scanner (`/scanner`) | "Scanner" | "New wallet discovery" | omit |
| Recipes (`/recipes`) | "Recipes" | "Signal recipe performance" | omit |
| Daily Brief (`/morning`) | "Daily Brief" | "Morning scan summary" | omit |
| Stalker (`/stalker`) | "Wallet Stalker" | "Track individual wallets" | omit |
| Contrarian (`/contrarian`) | "Contrarian" | "Fading the crowd" | omit |

---

## `app/layout.tsx` Changes

```tsx
<body ...>
  {/* aura + grain overlays unchanged */}
  <GlowInit />
  <div style={{ display: "flex", minHeight: "100vh" }}>
    <SideRail />
    <main style={{ flex: 1, marginLeft: "var(--rail-width, 200px)", position: "relative", zIndex: 1 }}>
      {children}
    </main>
  </div>
</body>
```

The `<Nav>` import stays as-is — the export name is kept `Nav`, so layout.tsx needs no changes beyond adding the flex wrapper and `marginLeft`.

---

## Mobile CSS (`app/globals.css`)

```css
:root { --rail-width: 200px; }
@media (max-width: 768px) { :root { --rail-width: 0px; } }
```

The `main` margin collapses to 0 on mobile; the siderail becomes a drawer overlay.

---

## Market Ticker Strip

Stays on **Overview page only** (`app/page.tsx`). Not moved to layout. No change to where it renders.

---

## Out of Scope
- Changes to API routes
- Changes to data fetching logic in any page
- Adding new pages
- Responsive layout within page content grids (each page owns its own grid)
