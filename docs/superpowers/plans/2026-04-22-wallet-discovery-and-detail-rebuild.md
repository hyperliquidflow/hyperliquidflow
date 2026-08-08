# Wallet Discovery + Detail Rebuild: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **UI gate:** Every task that writes JSX, TSX, HTML, or styles MUST invoke `ui-design-enforcer` first. No exceptions. Read `lib/design-tokens.ts` live before any style value is written.

**Goal:** Replace the scanner-diagnostics-plus-inline-profile mashup at `/wallets/discovery` with two focused pages: a clean public discovery dashboard and a dedicated `/wallets/[address]` detail route. Clean all user-facing copy of internal jargon. Land two HTML visual drafts first for user sign-off before writing a single line of production TSX.

**Architecture:**
- Two routes replace one. `/wallets/discovery` becomes scanner-ops + entry point. `/wallets/[address]` is a new shareable detail route that server-fetches wallet data for first paint.
- Visual drafts come first as standalone HTML in `docs/mockups/2026-04-22-wallet-pages/` using inlined design tokens per the `ui-design-enforcer` HTML mockup rules. User reviews in browser, approves, then implementation starts.
- All 7 code callsites that currently link `/wallets/discovery?address=...` migrate to `/wallets/[address]`.
- `recharts` (already a dependency) powers the equity curve and score history charts.
- Copy is scrubbed of `GitHub Actions`, `cron`, `KV`, `Supabase`, `pipeline step`, `Stream A/C/D`, exact filter thresholds, and every other internal detail.

**Tech Stack:** Next.js 15 App Router, React, TypeScript, `@tanstack/react-query`, `recharts`, Supabase, Vercel KV, `lib/design-tokens.ts`.

---

## File Structure

**New files**
- `docs/mockups/2026-04-22-wallet-pages/discovery.html`, visual draft, standalone
- `docs/mockups/2026-04-22-wallet-pages/wallet-detail.html`, visual draft, standalone
- `app/wallets/[address]/page.tsx`, server component, prefetches profile, renders client
- `app/wallets/[address]/WalletDetailClient.tsx`, header + tabs shell
- `app/wallets/[address]/loading.tsx`, skeleton
- `app/wallets/[address]/tabs/OverviewTab.tsx`
- `app/wallets/[address]/tabs/PositionsTab.tsx`
- `app/wallets/[address]/tabs/TradesTab.tsx`
- `app/wallets/[address]/tabs/SignalsTab.tsx`
- `app/wallets/[address]/tabs/AlertsTab.tsx`
- `app/wallets/[address]/tabs/PaperTab.tsx`
- `app/wallets/[address]/components/EquityCurve.tsx`, recharts area chart of 30d cumulative realized PnL
- `app/wallets/[address]/components/ScoreHistoryChart.tsx`, recharts line chart from `wallet_score_history`
- `app/api/wallet-score-history/route.ts`, returns `{ date, overall_score }[]` for one wallet
- `app/api/wallet-signals/route.ts`, returns live signals connected to this wallet (scope decided in Task 1.8 spike)
- `lib/equity-curve.ts`, pure helper `computeEquityCurve(fills) -> { t, cum }[]`
- `lib/__tests__/equity-curve.test.ts`

**Modified files**
- `app/wallets/discovery/page.tsx`, server component unchanged signature, renders new client
- `app/wallets/discovery/DiscoveryClient.tsx`, full rewrite: drop inline profile, drop pipeline detail list, clean copy
- `app/wallets/discovery/loading.tsx`, update skeleton to match new layout
- `app/api/scanner-stats/route.ts`, add `tracked_now`, `new_this_week`, `cohort_aum_usd`, `updated_at` to response; keep old fields for backwards compat during migration
- `app/OverviewClient.tsx`, swap `/wallets/discovery?address=${addr}` links to `/wallets/${addr}`
- `app/wallets/leaderboard/LeaderboardClient.tsx`, same link swap
- `app/wallets/inposition/InPositionClient.tsx`, same link swap
- `app/wallets/following/FollowingClient.tsx`, same link swap
- `app/signals/feed/FeedClient.tsx`, same link swap
- `app/wallets/page.tsx`, same link swap
- `app/stalker/page.tsx`, same link swap (old route, likely a redirect shell, double-check before editing)

**Unchanged**
- `lib/design-tokens.ts`. No new tokens; every style uses existing tokens.
- `lib/cohort-engine.ts`, `lib/wallet-profile.ts`, `lib/hyperliquid-api-client.ts`. Data fetching stays as-is.

---

## Phase 0: Visual Drafts (user sign-off gate)

No production code is written until the user approves both mockups. The two HTML files are standalone previews opened in a browser. They use the same fonts, tokens, and shimmer behavior as the live app, mirrored directly into `<style>` blocks per `ui-design-enforcer`.

### Task 0.1: Set up the mockup directory and shared head

**Files:**
- Create: `docs/mockups/2026-04-22-wallet-pages/_shared.css`, design-token mirror
- Create: `docs/mockups/2026-04-22-wallet-pages/README.md`, how to preview

- [ ] **Step 1: Invoke ui-design-enforcer and read `lib/design-tokens.ts` in full.** Do not proceed until every token section is loaded into context.

- [ ] **Step 2: Create `_shared.css` mirroring the tokens.** Every color, font size, spacing, radius, shadow, effect used in the mockups is written here as a CSS variable and referenced from the mockup files. No hex values outside this file. Required variables, each value copied verbatim from `lib/design-tokens.ts`:

```css
:root {
  /* Colors */
  --bg: #060606;
  --text: #f0f0f0;
  --text-muted: rgba(255,255,255,0.38);
  --text-dim: rgba(255,255,255,0.28);
  --text-faint: rgba(255,255,255,0.22);
  --green: #6aaa7a;
  --red: #c92435;
  --amber: #c4925a;
  --accent: #50d2c1;
  --card: rgba(12,12,12,0.7);
  --card-hover: rgba(18,18,18,0.7);
  --strip: rgba(255,255,255,0.03);
  --border: rgba(255,255,255,0.07);
  --border-faint: rgba(255,255,255,0.05);
  --border-hover: rgba(255,255,255,0.12);
  --nav-active: rgba(80,210,193,0.7);
  --long-bg: rgba(106,170,122,0.1);
  --long-border: rgba(106,170,122,0.2);
  --short-bg: rgba(201,36,53,0.1);
  --short-border: rgba(201,36,53,0.2);
  --regime-bg: rgba(106,170,122,0.08);
  --regime-border: rgba(106,170,122,0.2);
  --neutral: #9ca3af;
  --neutral-bg: rgba(156,163,175,0.08);
  --neutral-border: rgba(156,163,175,0.19);
  --row-hover: rgba(180,180,180,0.03);
  --tag-bg: rgba(255,255,255,0.06);
  --tag-text: rgba(255,255,255,0.7);
  --bar-bg: rgba(255,255,255,0.06);
  --divider: rgba(255,255,255,0.04);
  --input-bg: rgba(255,255,255,0.06);
  --input-border: rgba(255,255,255,0.1);

  /* Radius */
  --r-card: 12px;
  --r-tag: 5px;
  --r-pill: 4px;
  --r-input: 6px;
  --r-bar: 2px;

  /* Spacing */
  --page-pad-x: 32px;
  --page-pad-top: 28px;
  --card-header-pad: 14px 20px;
  --card-body-pad: 20px;
  --card-gap: 16px;
}

@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600;700&display=swap');

* { box-sizing: border-box; user-select: none; }
[style*="Geist Mono"], [style*="tabular-nums"] { user-select: text; cursor: text; }
html, body { margin: 0; padding: 0; background: var(--bg); color: var(--text); font-family: 'DM Sans', system-ui, sans-serif; }
body::after {
  content: ""; position: fixed; inset: 0; pointer-events: none; z-index: 0; opacity: 0.22;
  background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.15'/%3E%3C/svg%3E");
}
.card { background: var(--card); border: 1px solid var(--border); border-radius: var(--r-card); overflow: hidden; backdrop-filter: blur(16px); box-shadow: 0 2px 20px rgba(0,0,0,0.4); }
.card-header { padding: var(--card-header-pad); border-bottom: 1px solid var(--border-faint); display: flex; align-items: center; }
.card-title { font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(255,255,255,0.4); }
.tabular { font-variant-numeric: tabular-nums; }
.glow-btn { position: relative; overflow: hidden; }
.glow-btn::before { content: ""; position: absolute; inset: 0; opacity: 0; transition: opacity 0.9s ease-out; background: radial-gradient(circle at var(--gx,50%) var(--gy,50%), rgba(235,235,235,0.13) 0%, rgba(200,200,200,0.06) 35%, transparent 65%); }
.glow-btn:hover::before { opacity: 1; transition: opacity 0.12s ease-in; }
```

- [ ] **Step 3: Write `README.md`** with open instructions:

```markdown
# Wallet pages mockups, 2026-04-22

Standalone visual drafts for the discovery and wallet-detail rebuild. Open in a browser to review.

    open docs/mockups/2026-04-22-wallet-pages/discovery.html
    open docs/mockups/2026-04-22-wallet-pages/wallet-detail.html

These files mirror `lib/design-tokens.ts`. If a token changes, `_shared.css` must change to match.

Sign-off: both files approved by user before any production TSX is written.
```

- [ ] **Step 4: Commit**

```bash
git add docs/mockups/2026-04-22-wallet-pages/
git commit -m "docs(mockups): scaffold wallet-pages visual draft directory"
```

### Task 0.2: Discovery mockup

**Files:**
- Create: `docs/mockups/2026-04-22-wallet-pages/discovery.html`

- [ ] **Step 1: Invoke ui-design-enforcer.** Re-read `lib/design-tokens.ts` and `components/nav.tsx` before writing.

- [ ] **Step 2: Build the HTML.** Structure:
  1. Page header (title "Discovery", subtitle "Smart money trading Hyperliquid right now")
  2. 4-card hero row using `.card` + `tabular`: `Tracked now` (realistic count, e.g. 487), `New this week` (e.g. 31), `Avg win rate` (58.2%), `Cohort AUM` ($12.4M)
  3. Search card with monospace input, placeholder `0x... wallet address`, Search button with `.glow-btn`
  4. Top performers table: 10 rows, columns `#`, `Wallet` (truncated address in Geist Mono), `Win rate`, `30d PnL`, `Size` (tier badge). Row hover uses `--row-hover`. Entire row is a clickable link shape (cursor: pointer). Include a follow button placeholder on the right.
  5. By size card: 7 tier tiles (Elite, Major, Large, Mid, Small, Micro, Dust) with counts, uniform styling (no color differentiation per memory)
  6. Freshness chip at bottom: `• Updated 2 hours ago` using `--green` dot
  7. Collapsed "How it works" details element: one short paragraph, no step list. Exact copy:

     > "Every day we scan Hyperliquid and keep the wallets with real edge over the past 30 days. The rest get dropped. The list refreshes daily."

- [ ] **Step 3: Verify copy.** Zero mentions of: GitHub Actions, cron, Vercel, Supabase, KV, pipeline, Stream A/C/D, sybil, hygiene, outcome, backtest. No em or en dashes (hook blocks them anyway).

- [ ] **Step 4: Self-audit against ui-design-enforcer table.** Run every check: wordmark monochrome (N/A, no wordmark on this page), no decorative lines, color.accent scope, no `#xxxxxx` outside `_shared.css`, fonts DM Sans / Geist Mono only, tabular-nums on every number, page padding 32px sides.

- [ ] **Step 5: Open in browser for self-preview.**

```bash
open docs/mockups/2026-04-22-wallet-pages/discovery.html
```

- [ ] **Step 6: Commit**

```bash
git add docs/mockups/2026-04-22-wallet-pages/discovery.html
git commit -m "docs(mockups): add discovery page visual draft"
```

### Task 0.3: Wallet detail mockup

**Files:**
- Create: `docs/mockups/2026-04-22-wallet-pages/wallet-detail.html`

- [ ] **Step 1: Invoke ui-design-enforcer.** Re-read tokens.

- [ ] **Step 2: Build the HTML.** Structure:
  1. Page header: no title, just a small back link `← Discovery` in `--text-muted`
  2. Hero header card (full width, tinted by verdict color using `--green` for the demo):
     - Left: verdict label in verdict color, 16px bold; below it the address in Geist Mono (13px, selectable) + tier badge + style badge + a "Follow" button
     - Right: inline 4-stat grid: AUM, 30d PnL, Win rate, Trades
  3. 4-card secondary stat row: Avg win, Avg loss, Profit factor, Current streak
  4. Tab bar: Overview · Positions · Trades · Signals · Alerts · Paper. Active tab uses `--text`, inactive uses `rgba(255,255,255,0.44)`. Bottom border 2px `--neutral` under active tab.
  5. Overview tab content (shown by default in the mockup):
     - Equity curve card: SVG placeholder showing a rising line over 30 days with x-axis day labels and tabular y-axis dollar ticks. Label: `30-day realized PnL`.
     - Score history card: SVG placeholder line. If less than 30 days of history, show empty-state message: `Building score history, check back soon`.
     - Regime performance mini-grid: 3 tiles Bull / Bear / Ranging with avg daily PnL each.
     - Open coins chips: horizontal list of coin tags with `--tag-bg`.
  6. Footer line: `Data from Hyperliquid, updates live`.

- [ ] **Step 3: Verify copy.** No internal jargon. Verdict labels stay plain: "Strong edge", "Consistent", "Risky but profitable", "Underperformer", "Not enough data". No "Elite Trader, Strong Edge Detected" verbosity.

- [ ] **Step 4: Self-audit.** Same checks as Task 0.2. Plus: wallet address has `user-select: text`, stats have `tabular-nums`.

- [ ] **Step 5: Open in browser for self-preview.**

```bash
open docs/mockups/2026-04-22-wallet-pages/wallet-detail.html
```

- [ ] **Step 6: Commit**

```bash
git add docs/mockups/2026-04-22-wallet-pages/wallet-detail.html
git commit -m "docs(mockups): add wallet-detail page visual draft"
```

### Task 0.4: User review gate

- [ ] **Step 1: Share both mockup URLs with the user.** Ask explicitly: "Both mockups are at `docs/mockups/2026-04-22-wallet-pages/`. Open them and tell me what to change before I build the real pages."

- [ ] **Step 2: Iterate on the HTML until user approves.** Every change round: re-read tokens, re-audit, re-open in browser. Do not move to Phase 1 until the user types approval.

- [ ] **Step 3: Record approval in the plan.** Edit this file and mark Task 0.4 checked with the approval timestamp.

---

## Phase 1: Wallet detail route (`/wallets/[address]`)

Build the new route. Feature is live at a new URL; the 7 callsites and the discovery page are untouched until Phase 2.

### Task 1.1: Extract the equity curve helper (pure, tested)

**Files:**
- Create: `lib/equity-curve.ts`
- Create: `lib/__tests__/equity-curve.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/__tests__/equity-curve.test.ts
import { describe, it, expect } from "vitest";
import { computeEquityCurve, type EquityFill } from "@/lib/equity-curve";

describe("computeEquityCurve", () => {
  it("returns empty array for no fills", () => {
    expect(computeEquityCurve([])).toEqual([]);
  });

  it("produces cumulative realized PnL over time", () => {
    const fills: EquityFill[] = [
      { time: 1_000, closedPnl: "100" },
      { time: 2_000, closedPnl: "-40" },
      { time: 3_000, closedPnl: "25" },
    ];
    expect(computeEquityCurve(fills)).toEqual([
      { t: 1_000, cum: 100 },
      { t: 2_000, cum:  60 },
      { t: 3_000, cum:  85 },
    ]);
  });

  it("sorts unsorted fills ascending by time before accumulating", () => {
    const fills: EquityFill[] = [
      { time: 3_000, closedPnl: "25"  },
      { time: 1_000, closedPnl: "100" },
      { time: 2_000, closedPnl: "-40" },
    ];
    expect(computeEquityCurve(fills)).toEqual([
      { t: 1_000, cum: 100 },
      { t: 2_000, cum:  60 },
      { t: 3_000, cum:  85 },
    ]);
  });

  it("skips fills with non-numeric closedPnl", () => {
    const fills: EquityFill[] = [
      { time: 1_000, closedPnl: "10"  },
      { time: 2_000, closedPnl: ""    },
      { time: 3_000, closedPnl: "5"   },
    ];
    expect(computeEquityCurve(fills)).toEqual([
      { t: 1_000, cum: 10 },
      { t: 3_000, cum: 15 },
    ]);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

```bash
npx vitest run lib/__tests__/equity-curve.test.ts
```

Expected: FAIL, cannot find module `@/lib/equity-curve`.

- [ ] **Step 3: Write implementation**

```ts
// lib/equity-curve.ts
export interface EquityFill {
  time:      number;
  closedPnl: string;
}

export interface EquityPoint {
  t:   number;
  cum: number;
}

export function computeEquityCurve(fills: EquityFill[]): EquityPoint[] {
  const sorted = [...fills].sort((a, b) => a.time - b.time);
  const out: EquityPoint[] = [];
  let cum = 0;
  for (const f of sorted) {
    const pnl = parseFloat(f.closedPnl);
    if (!Number.isFinite(pnl)) continue;
    cum += pnl;
    out.push({ t: f.time, cum });
  }
  return out;
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
npx vitest run lib/__tests__/equity-curve.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/equity-curve.ts lib/__tests__/equity-curve.test.ts
git commit -m "feat(wallet-detail): add pure equity-curve helper + tests"
```

### Task 1.2: Add `/api/wallet-score-history` endpoint

**Files:**
- Create: `app/api/wallet-score-history/route.ts`

- [ ] **Step 1: Write the route**

```ts
// app/api/wallet-score-history/route.ts
// Returns per-day overall_score rows for a single wallet, oldest first.
// Honest empty-state: fewer than 7 rows returns [] and the UI shows "Building history".

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isValidAddress } from "@/lib/utils";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "@/lib/env";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

export interface ScoreHistoryPoint {
  date:          string;   // ISO date, YYYY-MM-DD
  overall_score: number;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const address = req.nextUrl.searchParams.get("address") ?? "";
  if (!isValidAddress(address)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }

  const { data: walletRow } = await supabase
    .from("wallets")
    .select("id")
    .eq("address", address.toLowerCase())
    .maybeSingle();

  if (!walletRow?.id) return NextResponse.json({ points: [] });

  const { data: rows } = await supabase
    .from("wallet_score_history")
    .select("date, overall_score")
    .eq("wallet_id", walletRow.id)
    .order("date", { ascending: true });

  const points: ScoreHistoryPoint[] = (rows ?? [])
    .filter((r) => r.overall_score != null)
    .map((r) => ({ date: r.date as string, overall_score: Number(r.overall_score) }));

  return NextResponse.json({ points });
}
```

- [ ] **Step 2: Smoke-test against a known wallet**

```bash
curl -s "http://localhost:3000/api/wallet-score-history?address=0x<known-cohort-wallet>" | jq
```

Expected: `{ points: [ { date: "2026-04-15", overall_score: 0.62 }, ... ] }` or `{ points: [] }` if no history yet.

- [ ] **Step 3: Commit**

```bash
git add app/api/wallet-score-history/route.ts
git commit -m "feat(wallet-detail): add /api/wallet-score-history endpoint"
```

### Task 1.3: Build the server shell, client shell, and loading skeleton

**Files:**
- Create: `app/wallets/[address]/page.tsx`
- Create: `app/wallets/[address]/WalletDetailClient.tsx`
- Create: `app/wallets/[address]/loading.tsx`

- [ ] **Step 1: Invoke ui-design-enforcer.** Re-read `lib/design-tokens.ts` in full.

- [ ] **Step 2: Write the server component**

```tsx
// app/wallets/[address]/page.tsx
import { notFound } from "next/navigation";
import { isValidAddress } from "@/lib/utils";
import { WalletDetailClient } from "./WalletDetailClient";

async function fetchInitialProfile(address: string) {
  try {
    const base = process.env.NEXT_PUBLIC_SITE_URL ?? "";
    const res = await fetch(`${base}/api/wallet-profile?address=${address}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

interface Params { params: Promise<{ address: string }> }

export default async function WalletPage({ params }: Params) {
  const { address } = await params;
  if (!isValidAddress(address)) notFound();
  const initial = await fetchInitialProfile(address);
  return <WalletDetailClient address={address} initialProfile={initial} />;
}
```

- [ ] **Step 3: Write the client shell** with the six tabs and the header card. Mirror the mockup. Copy structure from the current `WalletProfileCard` in `app/wallets/discovery/DiscoveryClient.tsx:133-255` with the following changes:
  - Wrap in a `<PageHeader />`-style back link (plain `<a href="/wallets/discovery">` with `← Discovery` label)
  - Drop the long verdict strings; map them to the short form:

    ```ts
    const VERDICT_SHORT: Record<string, string> = {
      "Elite Trader, Strong Edge Detected":   "Strong edge",
      "Smart Money, Consistent Performer":    "Consistent",
      "Risky but Profitable, High Avg Win":   "Risky but profitable",
      "Underperformer, Exercise Caution":     "Underperformer",
      "Insufficient Data (fewer than 10 trades)": "Not enough data",
      "Inconclusive":                         "Not enough data",
    };
    ```

  - Use `color`, `type`, `space`, `radius`, `card`, `row` from `@/lib/design-tokens`. No arbitrary hex, no arbitrary font sizes.
  - All numbers use `fontVariantNumeric: "tabular-nums"`
  - Address rendering uses `type.walletAddr` (selectable)
  - Tabs render their own component from `./tabs/*`

- [ ] **Step 4: Write the loading skeleton** using `skeleton.animated` from design tokens. Match the header-plus-stats layout so the user never sees layout shift.

- [ ] **Step 5: Self-audit.** Run every row of the ui-design-enforcer table against both files. Fix every violation inline.

- [ ] **Step 6: Start the dev server and visit the route with a real address from the leaderboard**

```bash
npm run dev
# then open http://localhost:3000/wallets/0x<cohort-wallet>
```

Verify: page renders, header card looks like the mockup, tabs are present, no layout shift on load, no console errors, typecheck + lint clean:

```bash
npm run typecheck
npm run lint
```

- [ ] **Step 7: Commit**

```bash
git add app/wallets/\[address\]/
git commit -m "feat(wallet-detail): server route shell with header + tab bar"
```

### Task 1.4: Overview tab with equity curve + score history + regime panel

**Files:**
- Create: `app/wallets/[address]/tabs/OverviewTab.tsx`
- Create: `app/wallets/[address]/components/EquityCurve.tsx`
- Create: `app/wallets/[address]/components/ScoreHistoryChart.tsx`

- [ ] **Step 1: Invoke ui-design-enforcer.** Re-read tokens.

- [ ] **Step 2: `EquityCurve.tsx`** uses `recharts` `<AreaChart>`, a single area series, `stroke={color.green}` when last cum >= 0 else `color.red`, `fill` with matching translucent color. X ticks are day labels `MMM D`, Y ticks are `$X.XK`. Tooltip card styled with `card.base` + `space.cardBodyPadding`. Takes `fills: WalletProfile["fills30d"]` as prop, memoizes `computeEquityCurve`.

- [ ] **Step 3: `ScoreHistoryChart.tsx`** fetches from `/api/wallet-score-history`. If `points.length < 7`, returns an empty state card with the exact copy:

  > "Building score history. We store one snapshot per day, check back in a few days."

  Otherwise: `recharts` `<LineChart>`, stroke `color.accent`, Y domain `[0, 1]`, X tick every 5 days.

- [ ] **Step 4: `OverviewTab.tsx`** lays out the three elements plus the existing regime-performance mini-cards and open-coins chips. Port the existing regime + open-coins JSX out of `DiscoveryClient.tsx:76-131` (`BehaviorProfileSection`) but style each block as its own `card.base` panel with `card.header`, not the two-column cram-in.

- [ ] **Step 5: Self-audit.** Hex values? Fonts? Padding? All token-driven.

- [ ] **Step 6: Manual visual check** in dev server on a wallet with open positions and some history. Verify charts render, empty state shows correctly for a brand-new wallet.

- [ ] **Step 7: Commit**

```bash
git add app/wallets/\[address\]/tabs/OverviewTab.tsx app/wallets/\[address\]/components/
git commit -m "feat(wallet-detail): overview tab with equity curve + score history"
```

### Task 1.5: Positions + Trades tabs

**Files:**
- Create: `app/wallets/[address]/tabs/PositionsTab.tsx`
- Create: `app/wallets/[address]/tabs/TradesTab.tsx`

- [ ] **Step 1: Invoke ui-design-enforcer.** Re-read tokens.

- [ ] **Step 2: Port the existing positions table** from `DiscoveryClient.tsx:210-231` into `PositionsTab.tsx`. Retokenize every style: `color.green`/`color.red` for LONG/SHORT, `space.cardHeaderPadding` via `card.header` for the wrapper card, no inline hex. Empty state copy: "No open positions right now."

- [ ] **Step 3: Port the existing trades table** from `DiscoveryClient.tsx:233-251` into `TradesTab.tsx`. Same retokenize. Empty state copy: "No trades in the last 30 days."

- [ ] **Step 4: Self-audit.** Verify tabular-nums on every number column.

- [ ] **Step 5: Manual check in dev server.** Click Positions and Trades on a wallet with real data, verify layout matches mockup.

- [ ] **Step 6: Commit**

```bash
git add app/wallets/\[address\]/tabs/
git commit -m "feat(wallet-detail): positions + trades tabs"
```

### Task 1.6: Alerts tab (inline follow + alert toggle)

**Files:**
- Create: `app/wallets/[address]/tabs/AlertsTab.tsx`

- [ ] **Step 1: Invoke ui-design-enforcer.** Re-read tokens.

- [ ] **Step 2: Read existing follow/alert hook shapes** before writing the tab. Open `lib/hooks/use-followed-wallets.ts`, `lib/alert-engine.ts`, and `components/follow-button.tsx` to confirm field names.

- [ ] **Step 3: Write the tab.** Layout:
  - Top card: follow state (follow button, clearly labeled as "Follow this wallet to get alerts in your feed")
  - Second card: per-alert checkboxes for the events `FollowedWallet` supports (new position opened, position closed, size change > N%, flip). Use the design-token `checkbox` composite from `lib/design-tokens.ts:492-528`.
  - Copy must be user-facing: no "AlertEvent", no "PositionSnapshot".

- [ ] **Step 4: Self-audit.** No internal type names in rendered strings.

- [ ] **Step 5: Manual check in dev server.** Follow a wallet from the detail page, confirm it shows up on `/wallets/following`.

- [ ] **Step 6: Commit**

```bash
git add app/wallets/\[address\]/tabs/AlertsTab.tsx
git commit -m "feat(wallet-detail): alerts tab with inline follow + event toggles"
```

### Task 1.7: Paper tab (copy-to-paper-book)

**Files:**
- Create: `app/wallets/[address]/tabs/PaperTab.tsx`

- [ ] **Step 1: Invoke ui-design-enforcer.** Re-read tokens.

- [ ] **Step 2: Write the tab.** If the wallet is already followed, show a single card: "This wallet is already being paper-traded. View on Paper book." with a link to `/wallets/paper`. Otherwise one `glow-btn` that calls the follow hook and then routes to `/wallets/paper`. No exposed "auto-copy from followed wallets" internal language; user sees "Start paper trading this wallet".

- [ ] **Step 3: Self-audit and manual check.**

- [ ] **Step 4: Commit**

```bash
git add app/wallets/\[address\]/tabs/PaperTab.tsx
git commit -m "feat(wallet-detail): paper tab with one-click copy to paper book"
```

### Task 1.8: Signals tab, feasibility spike + decision

**Files:**
- Investigate: `lib/signal-lab.ts`, `lib/radar-utils.ts`, `app/api/signals-feed/route.ts`, `cohort_snapshots` schema

- [ ] **Step 1: Investigate whether signals are attributable to a specific wallet.** Read `lib/signal-lab.ts` top to bottom. Signals derive from `SnapshotPair` (two consecutive cohort-wide snapshots); individual wallet attribution means asking "does this wallet appear in the sample used to generate this signal, and if so, on which side?".

- [ ] **Step 2: Write a one-paragraph feasibility summary in a scratch note** (not committed). Three possible outcomes:
  - **Attribution possible with existing `cohort_snapshots.positions` JSONB.** Proceed to Step 3.
  - **Attribution possible but requires a new query or join.** Add a task here before proceeding.
  - **Attribution not possible with current data.** Scope the tab down to: "Signals currently active on coins this wallet holds" (derivable today from open positions + live signals feed). Document that decision inline in the plan by editing this task, then proceed with scoped version.

- [ ] **Step 3: Create `app/api/wallet-signals/route.ts`.** Based on the feasibility outcome, either attribute signals to the wallet or fall back to coin-overlap.

- [ ] **Step 4: Create `app/wallets/[address]/tabs/SignalsTab.tsx`.** Render as a list of signal rows styled with `row.sig` from design tokens. Empty state: "No signals connected to this wallet right now."

- [ ] **Step 5: Self-audit and manual check on a wallet with active positions.**

- [ ] **Step 6: Commit**

```bash
git add app/api/wallet-signals/ app/wallets/\[address\]/tabs/SignalsTab.tsx
git commit -m "feat(wallet-detail): signals tab"
```

---

## Phase 2: Migrate inbound links

The new route is live. Swap the 7 callsites so every `Follow` / `Open wallet` / row click goes to `/wallets/[address]` instead of the legacy `?address=` pattern.

### Task 2.1: Swap all 7 links

**Files:**
- Modify: `app/OverviewClient.tsx`
- Modify: `app/wallets/leaderboard/LeaderboardClient.tsx`
- Modify: `app/wallets/inposition/InPositionClient.tsx`
- Modify: `app/wallets/following/FollowingClient.tsx`
- Modify: `app/signals/feed/FeedClient.tsx`
- Modify: `app/wallets/page.tsx`
- Modify: `app/stalker/page.tsx`

- [ ] **Step 1: Find every occurrence** of the old pattern in `app/` with Grep on the literal string `wallets/discovery?address`. Expected 7 files matching the code callsites (exclude docs and `.claude/worktrees/`).

- [ ] **Step 2: For each file, replace** `/wallets/discovery?address=${addr}` with `/wallets/${addr}` in the `router.push`, `href`, or `Link` props. Leave docs and worktrees alone. If a callsite uses `router.push`, it stays `router.push`. If a callsite uses `<a href>`, convert to `<Link href>` from `next/link` if it isn't already.

- [ ] **Step 3: Typecheck + lint**

```bash
npm run typecheck && npm run lint
```

Expected: both clean.

- [ ] **Step 4: Manual verification in dev server.** Click through leaderboard, overview, in-position, following, feed, wallets index. Every row that used to open the discovery page with a query param now routes to `/wallets/<address>`.

- [ ] **Step 5: Commit**

```bash
git add app/
git commit -m "refactor(wallets): route wallet links to dedicated /wallets/[address]"
```

### Task 2.2: Backward-compat redirect

**Files:**
- Modify: `app/wallets/discovery/DiscoveryClient.tsx` (temporary)

- [ ] **Step 1: Add a useEffect at the top of `DiscoveryClient`** that redirects old query-param URLs. This prevents shared/bookmarked links from breaking.

```tsx
import { useRouter } from "next/navigation";
// ...
useEffect(() => {
  const addr = new URLSearchParams(window.location.search).get("address");
  if (addr && isValidAddress(addr)) {
    router.replace(`/wallets/${addr}`);
  }
}, [router]);
```

(This replaces the existing `useEffect` that used to render the inline profile. The inline-profile code gets deleted in Phase 3.)

- [ ] **Step 2: Manual verification.** Visit `/wallets/discovery?address=0x<valid>` and confirm the URL rewrites to `/wallets/0x<valid>`.

- [ ] **Step 3: Commit**

```bash
git add app/wallets/discovery/DiscoveryClient.tsx
git commit -m "chore(discovery): redirect legacy ?address= URLs to /wallets/[address]"
```

---

## Phase 3: Discovery page rebuild

New layout, cleaned copy, search-that-routes, no inline profile.

### Task 3.1: Extend `/api/scanner-stats` with user-facing numbers

**Files:**
- Modify: `app/api/scanner-stats/route.ts`

- [ ] **Step 1: Read the current route** end-to-end so the response shape is clear.

- [ ] **Step 2: Add four fields** to the JSON response, computed server-side:
  - `tracked_now: number`, current active cohort count (reuse `total_active`)
  - `new_this_week: number`, wallets whose `first_activated_at` (or equivalent) is within the last 7 days; if no such column exists, use a best-effort `activated_at > now() - interval '7 days'`. If neither is available, return 0 for now and add a TODO linking to a schema task.
  - `cohort_aum_usd: number`, sum of current `account_value` across the active cohort
  - `updated_at: string | null`, already exists as `last_scan_at`; duplicate under `updated_at` in the response

  Keep the old fields untouched; the rebuilt client stops reading them but the backwards-compat redirect in Phase 2 might still hit.

- [ ] **Step 3: Smoke-test**

```bash
curl -s "http://localhost:3000/api/scanner-stats" | jq '{tracked_now, new_this_week, cohort_aum_usd, updated_at}'
```

- [ ] **Step 4: Commit**

```bash
git add app/api/scanner-stats/route.ts
git commit -m "feat(scanner-stats): expose tracked_now, new_this_week, cohort_aum_usd, updated_at"
```

### Task 3.2: Rewrite `DiscoveryClient.tsx`

**Files:**
- Modify (full rewrite): `app/wallets/discovery/DiscoveryClient.tsx`
- Modify: `app/wallets/discovery/loading.tsx`

- [ ] **Step 1: Invoke ui-design-enforcer.** Re-read `lib/design-tokens.ts` and the discovery mockup `docs/mockups/2026-04-22-wallet-pages/discovery.html`.

- [ ] **Step 2: Delete the inline `WalletProfileCard` + `BehaviorProfileSection`** components and all their state (`profile`, `lookupLoading`, `lookupError`, `doLookup`, `openLookup`). The detail page owns this now.

- [ ] **Step 3: Rebuild the component tree** to match the discovery mockup:
  1. `<PageHeader title="Discovery" subtitle="Smart money trading Hyperliquid right now" />`
  2. Hero stats row, 4 cards driven by `tracked_now`, `new_this_week`, `avg_win_rate`, `cohort_aum_usd`. Use `type.statLabel`, `type.statValue`, `type.statSub`.
  3. Search card: mono input + Search button. On submit, `router.push('/wallets/${addr}')`. Invalid address shows inline error message below the card in `color.red` + `type.pageSubtitle`.
  4. Top performers table: same data source (`top_win_rates`) but clickable rows linking to `/wallets/[address]`. Drop columns the user doesn't need; keep Wallet, Win rate, 30d PnL, and a Size (tier) badge. Include a `FollowButton` on the right.
  5. By size card: the 7-tier breakdown from `tier_breakdown`, rendered as uniform badges per project memory (no color differentiation). Title "By size", subtitle "Account equity bucket".
  6. Freshness chip at bottom: small `• Updated 2 hours ago` using `color.green` dot. Drop the "Last Scan" card entirely.
  7. Collapsed `<details>`-style card labeled "How we find these wallets". One short paragraph, no step list:

     > "Every day we scan Hyperliquid and keep the wallets with real edge over the past 30 days. The rest get dropped. The list refreshes daily."

- [ ] **Step 4: Update `loading.tsx`** to skeleton the new layout.

- [ ] **Step 5: Self-audit** against every row of the ui-design-enforcer table. No internal jargon anywhere. No `#xxxxxx`. No non-token font sizes.

- [ ] **Step 6: Manual verification in dev server.** Visit `/wallets/discovery`, confirm:
  - Layout matches approved mockup
  - Search routes to `/wallets/<address>`
  - Table rows route to detail
  - No inline profile ever appears
  - Legacy `?address=` URL still redirects (Task 2.2)

- [ ] **Step 7: Run typecheck, lint, tests**

```bash
npm run typecheck && npm run lint && npm run test
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add app/wallets/discovery/
git commit -m "refactor(discovery): rebuild page, clean copy, route to detail page"
```

---

## Phase 4: Cleanup + polish

### Task 4.1: Update the legacy `stalker` redirect (if applicable)

**Files:**
- Modify or delete: `app/stalker/page.tsx`

- [ ] **Step 1: Read `app/stalker/page.tsx`** to confirm it's a pure redirect. If so, update the redirect target from `/wallets/discovery?address=...` to either `/wallets/discovery` (if there's no address) or `/wallets/[address]` (if there is one). Pattern may already be a 301.

- [ ] **Step 2: Manual verification.** Visit the old `/stalker` URL; confirm it redirects to the right place.

- [ ] **Step 3: Commit**

```bash
git add app/stalker/page.tsx
git commit -m "chore(stalker): redirect to new wallet pages"
```

### Task 4.2: Rerun all UI checks on every touched page

- [ ] **Step 1: Dev server smoke test.** Visit, in this order: `/`, `/wallets/discovery`, `/wallets/leaderboard`, `/wallets/inposition`, `/wallets/following`, `/wallets/paper`, `/signals/feed`, and `/wallets/<any-cohort-address>`. On each page, watch for console errors, layout shift, broken token values.

- [ ] **Step 2: Full build**

```bash
npm run build
```

Expected: completes without type or lint errors.

- [ ] **Step 3: All tests**

```bash
npm run test
```

Expected: green.

- [ ] **Step 4: Final empty commit marker (optional)**

```bash
git commit -m "chore(wallet-rebuild): post-rebuild smoke-test sweep" --allow-empty
```

### Task 4.3: Update sprint tracker

**Files:**
- Modify: `docs/sprints/status.md`

- [ ] **Step 1: Add a line item** under the current sprint marking the wallet-discovery-and-detail-rebuild shipped, with a link to this plan file.

- [ ] **Step 2: Commit**

```bash
git add docs/sprints/status.md
git commit -m "docs(sprints): record wallet pages rebuild"
```

---

## Testing summary

- `lib/equity-curve.ts` has unit tests (Task 1.1).
- Every other change is UI. Verification is manual against the approved mockups and the dev server. Per `CLAUDE.md`, React components and API routes in this project are not unit-tested.
- Every task ends with a dev-server visual check. No task is complete until the rendered page matches the mockup.

## Risk and rollback

- Each phase commits independently. If Phase 3 (discovery rewrite) regresses something, `git revert` the discovery-only commit and Phase 1 (detail route) remains live.
- The Phase 2.2 redirect means old bookmarks never 404, even mid-migration.
- The only new data dependencies are `wallet_score_history` (already populated) and the extended `/api/scanner-stats` fields (graceful fallback to 0 / null).

## Open questions resolved before implementation starts

- Equity curve is cumulative **realized** PnL from fills (matches scoring). Unrealized is surfaced in the Positions tab instead.
- Desktop-first. Responsive mobile layout is out of scope for this plan.
- Signals tab feasibility is a Phase 1 spike. If attribution proves impossible, scope falls back to coin-overlap per Task 1.8.
