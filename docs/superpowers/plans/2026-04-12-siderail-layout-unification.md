# Siderail Layout Unification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the horizontal topnav with the siderail design from the prototype and unify the page header across all 8 pages.

**Architecture:** Rewrite `components/nav.tsx` as a fixed 200px side rail (export name `Nav` unchanged). Create `components/page-header.tsx` as a shared header component. Update `app/layout.tsx` to use a flex wrapper, and add responsive CSS to `globals.css`. Each page replaces its bespoke header block with `<PageHeader>`.

**Tech Stack:** Next.js 15 App Router, React, React Query (`@tanstack/react-query`), Tailwind + inline style objects, `next/navigation`, TypeScript.

---

## File Map

| File | Action |
|---|---|
| `components/nav.tsx` | Full rewrite — becomes the SideRail, keeps `Nav` export |
| `components/page-header.tsx` | Create — shared `<PageHeader title subtitle? regime?>` |
| `app/layout.tsx` | Add flex wrapper div around `<Nav>` + `<main>` |
| `app/globals.css` | Add sidenav responsive CSS + logo-char hover rules |
| `app/page.tsx` | Replace regime banner card header with `<PageHeader>` |
| `app/wallets/page.tsx` | Replace h1/p header block with `<PageHeader>` |
| `app/signals/page.tsx` | Replace header block with `<PageHeader regime={...}>` |
| `app/scanner/page.tsx` | Replace h1/p header block with `<PageHeader>` |
| `app/recipes/page.tsx` | Replace header block with `<PageHeader>` |
| `app/morning/page.tsx` | Replace header block with `<PageHeader>`; rename label to "Daily Brief" |
| `app/stalker/page.tsx` | Replace header block with `<PageHeader>` |
| `app/contrarian/page.tsx` | Replace header block with `<PageHeader>` |

---

## Task 1: Create `<PageHeader>` component

**Files:**
- Create: `components/page-header.tsx`

- [ ] **Step 1: Create the file**

```tsx
// components/page-header.tsx
"use client";

const REGIME_STYLES = {
  BULL:    { color: "#6aaa7a", bg: "rgba(106,170,122,0.08)", border: "rgba(106,170,122,0.2)",  label: "BULLISH"  },
  BEAR:    { color: "#b06868", bg: "rgba(176,104,104,0.08)", border: "rgba(176,104,104,0.2)",  label: "BEARISH"  },
  RANGING: { color: "#9ca3af", bg: "rgba(156,163,175,0.08)", border: "rgba(156,163,175,0.2)",  label: "RANGING"  },
};

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  regime?: "BULL" | "BEAR" | "RANGING";
}

export function PageHeader({ title, subtitle, regime }: PageHeaderProps) {
  const rs = regime ? REGIME_STYLES[regime] : null;

  return (
    <div style={{
      padding: "28px 32px 0",
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "space-between",
    }}>
      <div>
        <h1 style={{ fontSize: "26px", fontWeight: 700, color: "#f0f0f0", margin: 0 }}>
          {title}
        </h1>
        {subtitle && (
          <p style={{ fontSize: "14px", color: "rgba(255,255,255,0.38)", marginTop: "4px", margin: 0 }}>
            {subtitle}
          </p>
        )}
      </div>

      {rs && (
        <div
          className="glow-btn"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "12px 28px",
            borderRadius: "10px",
            background: rs.bg,
            border: `1px solid ${rs.border}`,
            cursor: "default",
          }}
        >
          <span style={{
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            background: rs.color,
            boxShadow: `0 0 8px ${rs.color}`,
            display: "inline-block",
            animation: "glow-pulse 2s ease-in-out infinite",
            flexShrink: 0,
          }} />
          <div>
            <div style={{ fontSize: "16px", fontWeight: 700, color: rs.color }}>
              {rs.label}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npm run typecheck`
Expected: no errors related to `page-header.tsx`

- [ ] **Step 3: Commit**

```bash
git add components/page-header.tsx
git commit -m "feat: add PageHeader component"
```

---

## Task 2: Add responsive CSS to `globals.css`

**Files:**
- Modify: `app/globals.css`

This CSS powers the siderail's mobile behavior and the logo stagger-lift hover effect. It must be in place before Task 3 (the Nav rewrite) references its classes.

- [ ] **Step 1: Append to `app/globals.css` (inside the `@layer utilities` block, before the closing `}`)**

Find the line `}` that closes the `@layer utilities {` block (currently line 160) and insert above it:

```css
  /* ── SideRail responsive layout ── */
  .sidenav {
    transition: transform 0.25s ease;
  }
  .sidenav-hamburger {
    display: none !important;
  }
  .sidenav-backdrop {
    display: none !important;
  }
  @media (max-width: 768px) {
    .sidenav {
      transform: translateX(-200px);
    }
    .sidenav.sidenav-open {
      transform: translateX(0);
    }
    .sidenav-hamburger {
      display: block !important;
    }
    .sidenav-backdrop {
      display: block !important;
    }
  }

  /* ── SideRail logo stagger-lift ── */
  .sidenav-logo-wrap:hover .logo-char {
    transform: translateY(-3px);
    color: #f0f0f0;
  }

  /* ── glow-pulse keyframe (used by live dot + regime chip) ── */
  @keyframes glow-pulse {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.6; }
  }
```

- [ ] **Step 2: Verify typecheck + build pass**

Run: `npm run typecheck && npm run build`
Expected: both pass, no CSS errors

- [ ] **Step 3: Commit**

```bash
git add app/globals.css
git commit -m "feat: add sidenav responsive CSS and logo hover styles"
```

---

## Task 3: Rewrite `components/nav.tsx` as SideRail

**Files:**
- Modify: `components/nav.tsx` (full rewrite, `Nav` export preserved)

- [ ] **Step 1: Replace the entire file**

```tsx
"use client";
// components/nav.tsx — SideRail navigation
// Fixed 200px left rail. Export name kept as `Nav` so app/layout.tsx needs no change.

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { timeAgo } from "@/lib/utils";
import type { CohortCachePayload } from "@/app/api/refresh-cohort/route";

const NAV_SECTIONS = [
  {
    label: "DASHBOARD",
    items: [
      { href: "/",          label: "Overview"    },
      { href: "/signals",   label: "Signals"     },
      { href: "/wallets",   label: "Wallets"     },
      { href: "/scanner",   label: "Scanner"     },
    ],
  },
  {
    label: "STRATEGY",
    items: [
      { href: "/recipes",    label: "Recipes"     },
      { href: "/morning",    label: "Daily Brief" },
    ],
  },
  {
    label: "RESEARCH",
    items: [
      { href: "/stalker",    label: "Stalker"     },
      { href: "/contrarian", label: "Contrarian"  },
    ],
  },
] as const;

const LOGO = "HyperliquidFLOW";

export function Nav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close drawer when navigating
  useEffect(() => { setOpen(false); }, [pathname]);

  // Live timestamp — uses cached cohort-state, no extra network request
  const { data } = useQuery<CohortCachePayload>({
    queryKey: ["cohort-state"],
    queryFn: () => fetch("/api/cohort-state").then((r) => r.json()),
    refetchInterval: 60_000,
    staleTime: 55_000,
  });

  return (
    <>
      {/* Mobile hamburger — hidden on desktop via .sidenav-hamburger CSS */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Toggle navigation"
        className="sidenav-hamburger"
        style={{
          position: "fixed",
          top: "14px",
          left: "14px",
          zIndex: 200,
          background: "rgba(12,12,12,0.9)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: "7px",
          color: "#f0f0f0",
          fontSize: "18px",
          lineHeight: 1,
          padding: "7px 10px",
          cursor: "pointer",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
        }}
      >
        ☰
      </button>

      {/* Mobile backdrop — hidden on desktop via .sidenav-backdrop CSS */}
      <div
        onClick={() => setOpen(false)}
        className="sidenav-backdrop"
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.55)",
          zIndex: 99,
          backdropFilter: "blur(2px)",
          WebkitBackdropFilter: "blur(2px)",
          display: open ? undefined : "none",
        }}
      />

      {/* Rail */}
      <nav
        className={`sidenav${open ? " sidenav-open" : ""}`}
        style={{
          width: "200px",
          minHeight: "100vh",
          background: "rgba(8,8,8,0.85)",
          borderRight: "1px solid rgba(255,255,255,0.05)",
          display: "flex",
          flexDirection: "column",
          position: "fixed",
          left: 0,
          top: 0,
          bottom: 0,
          zIndex: 100,
          paddingTop: "24px",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
        }}
      >
        {/* Logo with stagger-lift hover */}
        <div
          className="sidenav-logo-wrap"
          style={{
            padding: "0 20px 24px",
            borderBottom: "1px solid rgba(255,255,255,0.05)",
            marginBottom: "16px",
          }}
        >
          <div
            style={{
              fontSize: "17px",
              fontWeight: 700,
              letterSpacing: "0.01em",
              display: "flex",
              cursor: "default",
            }}
          >
            {LOGO.split("").map((ch, i) => (
              <span
                key={i}
                className="logo-char"
                style={{
                  display: "inline-block",
                  color: "rgba(255,255,255,0.85)",
                  transition: `transform 0.25s cubic-bezier(0.34,1.56,0.64,1) ${i * 18}ms, color 0.25s ${i * 18}ms`,
                }}
              >
                {ch}
              </span>
            ))}
          </div>
        </div>

        {/* Nav sections */}
        {NAV_SECTIONS.map(({ label, items }) => (
          <div key={label}>
            <div
              style={{
                fontSize: "11px",
                fontWeight: 700,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "rgba(255,255,255,0.22)",
                padding: "16px 20px 6px",
                userSelect: "none",
              }}
            >
              {label}
            </div>
            {items.map(({ href, label: itemLabel }) => {
              const active =
                pathname === href ||
                (href !== "/" && pathname.startsWith(href));
              return (
                <Link
                  key={href}
                  href={href}
                  className="glow-btn"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    padding: "10px 20px",
                    fontSize: "14px",
                    fontWeight: 500,
                    color: active ? "#f0f0f0" : "rgba(255,255,255,0.44)",
                    textDecoration: "none",
                    borderLeft: active
                      ? "2px solid rgba(151,253,229,0.7)"
                      : "2px solid transparent",
                    background: active
                      ? "rgba(151,253,229,0.05)"
                      : "transparent",
                    transition: "color 0.15s, border-color 0.15s, background 0.15s",
                    userSelect: "none",
                  }}
                >
                  {itemLabel}
                </Link>
              );
            })}
          </div>
        ))}

        {/* Live footer */}
        <div
          style={{
            marginTop: "auto",
            padding: "18px 0",
            borderTop: "1px solid rgba(255,255,255,0.05)",
            textAlign: "center",
          }}
        >
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <span
              style={{
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                background: "#6aaa7a",
                boxShadow: "0 0 6px #6aaa7a",
                display: "inline-block",
                animation: "glow-pulse 2s ease-in-out infinite",
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontSize: "13px",
                color: "rgba(255,255,255,0.5)",
                userSelect: "none",
              }}
            >
              LIVE
            </span>
          </div>
          {data?.updated_at && (
            <div
              style={{
                fontSize: "11px",
                color: "rgba(255,255,255,0.28)",
                marginTop: "4px",
                userSelect: "none",
              }}
            >
              {timeAgo(data.updated_at)}
            </div>
          )}
        </div>
      </nav>
    </>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: no errors in `components/nav.tsx`

- [ ] **Step 3: Commit**

```bash
git add components/nav.tsx
git commit -m "feat: replace topnav with siderail component"
```

---

## Task 4: Update `app/layout.tsx` — flex wrapper + main margin

**Files:**
- Modify: `app/layout.tsx`

- [ ] **Step 1: Replace the `<body>` contents**

The current `<main>` tag (line 73) reads:
```tsx
<main className="min-h-[calc(100vh-52px)]" style={{ position: "relative", zIndex: 1 }}>{children}</main>
```

Replace it with a flex wrapper (keep aura, grain, and GlowInit unchanged above it):

```tsx
<div style={{ display: "flex", minHeight: "100vh" }}>
  <Nav />
  <main
    style={{
      flex: 1,
      minWidth: 0,
      position: "relative",
      zIndex: 1,
      marginLeft: "200px",
    }}
    className="sidenav-main"
  >
    {children}
  </main>
</div>
```

Also add this CSS to `app/globals.css` inside `@layer utilities` (after the sidenav rules added in Task 2):

```css
  @media (max-width: 768px) {
    .sidenav-main {
      margin-left: 0 !important;
    }
  }
```

- [ ] **Step 2: Run typecheck + dev server**

Run: `npm run typecheck`
Expected: no errors

Run: `npm run dev`
Open `http://localhost:3000` — verify the siderail appears on the left and content is offset correctly.

- [ ] **Step 3: Commit**

```bash
git add app/layout.tsx app/globals.css
git commit -m "feat: flex layout wrapper for siderail + mobile margin reset"
```

---

## Task 5: Migrate Overview page (`app/page.tsx`)

**Files:**
- Modify: `app/page.tsx`

The Overview page currently renders a regime banner card as its first element inside `<div style={S.page}>`. Replace it with `<PageHeader>` outside the `S.page` div.

- [ ] **Step 1: Add import**

At the top of `app/page.tsx`, add:
```tsx
import { PageHeader } from "@/components/page-header";
```

- [ ] **Step 2: Replace the regime banner block**

Find and remove this block (inside `OverviewInner`, the first JSX element inside `<div style={S.page}>`):
```tsx
      {/* ── Regime Banner ── */}
      <div style={{
        ...S.card,
        background: rs.bg,
        border: `1px solid ${rs.color}22`,
        padding: "20px 24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: "20px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: rs.color, boxShadow: `0 0 8px ${rs.color}` }} />
          <div>
            <div style={{ fontSize: "18px", fontWeight: 700, color: rs.color }}>{rs.label}</div>
            <div style={S.muted}>Market regime · BTC 24h: {data.btc_return_24h >= 0 ? "+" : ""}{formatPct(data.btc_return_24h)}</div>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={S.small}>Updated {timeAgo(data.updated_at)}</div>
          <div style={S.muted}>{data.wallet_count} wallets active</div>
        </div>
      </div>
```

Replace the entire `return (...)` in `OverviewInner` with `<PageHeader>` placed **before** the `<div style={S.page}>`:

```tsx
  return (
    <>
      <PageHeader
        title="Overview"
        subtitle={`${data.wallet_count} wallets · BTC 24h: ${data.btc_return_24h >= 0 ? "+" : ""}${formatPct(data.btc_return_24h)}`}
        regime={regime}
      />
      <div style={{ ...S.page, paddingTop: "20px" }}>
        {/* ── Stat Cards ── */}
        ...rest of existing JSX unchanged...
      </div>
    </>
  );
```

Note: wrap the existing `<div style={S.page}>` and its children in a React fragment `<>...</>`. The `S.page` div gets `paddingTop: "20px"` override (PageHeader already owns the top 28px).

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors in `app/page.tsx`

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx
git commit -m "feat: overview page migrated to PageHeader"
```

---

## Task 6: Migrate Signals page (`app/signals/page.tsx`)

**Files:**
- Modify: `app/signals/page.tsx`

- [ ] **Step 1: Add import**

```tsx
import { PageHeader } from "@/components/page-header";
```

- [ ] **Step 2: Replace header block in `SignalsInner`**

Find and remove:
```tsx
      <div style={{ marginBottom: "20px" }}>
        <h1 style={{ fontSize: "18px", fontWeight: 700, color: "#f0f0f0" }}>Signal Feed</h1>
        <p style={S.muted}>All 9 recipe detections · live updates every 60s · {data.recent_signals.length} recent signals</p>
      </div>
```

Wrap the return in a fragment and add `<PageHeader>` before `<div style={S.page}>`:

```tsx
  return (
    <>
      <PageHeader
        title="Signals"
        subtitle={`All 9 recipes · ${data.recent_signals.length} recent signals`}
        regime={data.regime}
      />
      <div style={{ ...S.page, paddingTop: "20px" }}>
        {/* Filters + recipe legend + signal rows — unchanged */}
      </div>
    </>
  );
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add app/signals/page.tsx
git commit -m "feat: signals page migrated to PageHeader"
```

---

## Task 7: Migrate Wallets page (`app/wallets/page.tsx`)

**Files:**
- Modify: `app/wallets/page.tsx`

- [ ] **Step 1: Add import**

```tsx
import { PageHeader } from "@/components/page-header";
```

- [ ] **Step 2: Replace header block**

Find and remove:
```tsx
      <div style={{ marginBottom: "20px" }}>
        <h1 style={{ fontSize: "18px", fontWeight: 700, color: "#f0f0f0" }}>Full Whale Report</h1>
        <p style={S.muted}>Top Hyperliquid wallets ranked by performance · {data.wallet_count} active</p>
      </div>
```

Wrap the return in a fragment and add `<PageHeader>` before `<div style={S.page}>`:

```tsx
  return (
    <>
      <PageHeader
        title="Whale Report"
        subtitle={`Top wallets by composite score · ${data.wallet_count} active`}
      />
      <div style={{ ...S.page, paddingTop: "20px" }}>
        {/* Tabs + table — unchanged */}
      </div>
    </>
  );
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add app/wallets/page.tsx
git commit -m "feat: wallets page migrated to PageHeader"
```

---

## Task 8: Migrate Scanner page (`app/scanner/page.tsx`)

**Files:**
- Modify: `app/scanner/page.tsx`

- [ ] **Step 1: Add import**

```tsx
import { PageHeader } from "@/components/page-header";
```

- [ ] **Step 2: Replace header block**

Find and remove:
```tsx
      <div style={{ marginBottom: "20px" }}>
        <h1 style={{ fontSize: "18px", fontWeight: 700, color: "#f0f0f0" }}>Wallet Scanner</h1>
        <p style={S.muted}>Daily discovery at 02:00 UTC · GitHub Actions · leaderboard → win rate filter → cohort</p>
      </div>
```

```tsx
  return (
    <>
      <PageHeader
        title="Scanner"
        subtitle="Daily discovery at 02:00 UTC · GitHub Actions"
      />
      <div style={{ ...S.page, paddingTop: "20px" }}>
        {/* Stats row + pipeline — unchanged */}
      </div>
    </>
  );
```

- [ ] **Step 3: Typecheck + Commit**

Run: `npm run typecheck`

```bash
git add app/scanner/page.tsx
git commit -m "feat: scanner page migrated to PageHeader"
```

---

## Task 9: Migrate Recipes page (`app/recipes/page.tsx`)

**Files:**
- Modify: `app/recipes/page.tsx`

- [ ] **Step 1: Add import**

```tsx
import { PageHeader } from "@/components/page-header";
```

- [ ] **Step 2: Locate and remove the existing header in `RecipeLabInner`**

Look for any `<div>` with an `<h1>` or title near the top of the return statement. Replace with the same fragment + PageHeader pattern:

```tsx
  return (
    <>
      <PageHeader
        title="Recipes"
        subtitle="Signal recipe performance"
      />
      <div style={{ ...S.page, paddingTop: "20px" }}>
        {/* Recipe grid — unchanged */}
      </div>
    </>
  );
```

- [ ] **Step 3: Typecheck + Commit**

Run: `npm run typecheck`

```bash
git add app/recipes/page.tsx
git commit -m "feat: recipes page migrated to PageHeader"
```

---

## Task 10: Migrate Morning/Daily Brief page (`app/morning/page.tsx`)

**Files:**
- Modify: `app/morning/page.tsx`

This page also needs the label renamed from "Morning Alpha Scan" to "Daily Brief" in the header text (the nav label was already updated in the `Nav` component in Task 3).

- [ ] **Step 1: Add import**

```tsx
import { PageHeader } from "@/components/page-header";
```

- [ ] **Step 2: Replace the existing header block**

Find and remove (inside `MorningScanInner`):
```tsx
      <div style={{ marginBottom: "24px", display: "flex", alignItems: "baseline", gap: "16px" }}>
        <div>
          <h1 style={{ fontSize: "18px", fontWeight: 700, color: "#f0f0f0" }}>Morning Alpha Scan</h1>
          <p style={S.muted}>Generated daily at 02:30 UTC · {timeAgo(data.generated_at)}</p>
        </div>
        <div className="glow-btn" style={{ marginLeft: "auto", ...regime pill styles... }}>
          ...
        </div>
      </div>
```

Replace with:
```tsx
  return (
    <>
      <PageHeader
        title="Daily Brief"
        subtitle={`Generated daily at 02:30 UTC · ${timeAgo(data.generated_at)}`}
      />
      <div style={{ ...S.page, paddingTop: "20px" }}>
        {/* Brief content — unchanged */}
      </div>
    </>
  );
```

Note: the standalone regime pill that was in the old header is dropped — the regime chip now lives in `<PageHeader regime={...}>` if desired. The morning page's `data` object has a `regime` field (`data.regime: string`). You can pass `regime={data.regime as "BULL" | "BEAR" | "RANGING"}` if you want the chip, otherwise omit it — the spec leaves this optional for this page.

- [ ] **Step 3: Typecheck + Commit**

Run: `npm run typecheck`

```bash
git add app/morning/page.tsx
git commit -m "feat: daily brief page migrated to PageHeader"
```

---

## Task 11: Migrate Stalker page (`app/stalker/page.tsx`)

**Files:**
- Modify: `app/stalker/page.tsx`

- [ ] **Step 1: Add import**

```tsx
import { PageHeader } from "@/components/page-header";
```

- [ ] **Step 2: Find the header block in `StalkerInner` (or the outer wrapper)**

The stalker page renders a search input at the top. Find the component's main return and add `<PageHeader>` before the content div:

```tsx
  return (
    <>
      <PageHeader
        title="Wallet Stalker"
        subtitle="Drop any address, get full history + verdict"
      />
      <div style={{ ...S.page, paddingTop: "20px" }}>
        {/* Search input + results — unchanged */}
      </div>
    </>
  );
```

- [ ] **Step 3: Typecheck + Commit**

Run: `npm run typecheck`

```bash
git add app/stalker/page.tsx
git commit -m "feat: stalker page migrated to PageHeader"
```

---

## Task 12: Migrate Contrarian page (`app/contrarian/page.tsx`)

**Files:**
- Modify: `app/contrarian/page.tsx`

- [ ] **Step 1: Add import**

```tsx
import { PageHeader } from "@/components/page-header";
```

- [ ] **Step 2: Replace header block**

Find and remove:
```tsx
      <div style={{ marginBottom: "20px" }}>
        <h1 style={{ fontSize: "18px", fontWeight: 700, color: "#f0f0f0" }}>Smart Money vs. Rekt Money</h1>
```
(and any subtitle `<p>` immediately following)

Replace with:
```tsx
  return (
    <>
      <PageHeader
        title="Contrarian"
        subtitle="Smart Money vs. Rekt Money — divergence scanner"
      />
      <div style={{ ...S.page, paddingTop: "20px" }}>
        {/* Idea cards — unchanged */}
      </div>
    </>
  );
```

- [ ] **Step 3: Typecheck + Commit**

Run: `npm run typecheck`

```bash
git add app/contrarian/page.tsx
git commit -m "feat: contrarian page migrated to PageHeader"
```

---

## Task 13: Full build verification + visual check

- [ ] **Step 1: Run full typecheck and build**

```bash
npm run typecheck && npm run build
```
Expected: both pass with 0 errors.

- [ ] **Step 2: Start dev server and spot-check all 8 pages**

Run: `npm run dev`

Check each route:
- `http://localhost:3000/` — siderail visible, Overview active, regime chip in header
- `http://localhost:3000/signals` — Signals active, regime chip in header
- `http://localhost:3000/wallets` — Wallets active, no regime chip
- `http://localhost:3000/scanner` — Scanner active
- `http://localhost:3000/recipes` — Recipes active
- `http://localhost:3000/morning` — "Daily Brief" in both nav and page header
- `http://localhost:3000/stalker` — Stalker active
- `http://localhost:3000/contrarian` — Contrarian active

For each: verify the siderail shows the correct active item (mint left border), the page title/subtitle renders correctly, and the live dot + timestamp show in the footer.

- [ ] **Step 3: Check mobile view**

In browser DevTools, set viewport to 375px wide. Verify:
- Siderail is hidden (off-screen)
- Hamburger `☰` button is visible top-left
- Tapping hamburger slides rail in
- Tapping backdrop closes it
- Navigation closes the drawer automatically

- [ ] **Step 4: Final commit**

```bash
git add .
git commit -m "feat: siderail layout unified across all 8 pages — ready to deploy"
```

---

## Task 14: Deploy to production

- [ ] **Step 1: Push to main**

```bash
git push origin main
```

Vercel auto-deploys on push to `main`. Monitor the deployment in the Vercel dashboard.

- [ ] **Step 2: Verify production**

Once deployed, open the production URL and repeat the spot-check from Task 13 Step 2.
