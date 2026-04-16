# Signals / Feed Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the Feed page with a new 4-column signal row layout, coin chip header, multi-select recipe sidebar, portal popups, and fix the broken wallet address field throughout.

**Architecture:** Three layers touched in order — utilities first, then API endpoints (wallet address JOIN + KV snapshot fix), then the full `FeedClient.tsx` rewrite. Each layer is independently testable before the next begins.

**Tech Stack:** Next.js 15 App Router, React, Supabase JS client (foreign-key joins), Vercel KV, React Query, Vitest, design tokens from `lib/design-tokens.ts`.

**Spec:** `docs/superpowers/specs/2026-04-16-signals-feed-redesign.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `lib/utils.ts` | Modify | Add `formatSignalTime` helper |
| `app/api/signals-feed/route.ts` | Modify | JOIN `wallets` table, return `wallet_address` |
| `app/api/refresh-cohort/route.ts` | Modify | Include `wallet_address` in KV snapshot |
| `app/signals/feed/FeedClient.tsx` | Full rewrite | New layout, all UI logic |

---

## Task 1: Add `formatSignalTime` to `lib/utils.ts`

**Files:**
- Modify: `lib/utils.ts`
- Test: `lib/__tests__/utils.test.ts` (or wherever existing utils tests live)

- [ ] **Step 1: Find the test file**

```bash
find . -path "*/utils.test*" -not -path "*/node_modules/*"
```

If no test file exists, create `lib/__tests__/utils.test.ts`.

- [ ] **Step 2: Write the failing test**

Add to the test file:

```ts
import { formatSignalTime } from "../utils";

describe("formatSignalTime", () => {
  it("returns relative time for signals under 2 hours old", () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    expect(formatSignalTime(oneHourAgo)).toBe("1h ago");
  });

  it("returns relative time for signals at exactly 1h 59m", () => {
    const almostTwo = new Date(Date.now() - (2 * 60 * 60 * 1000 - 60_000)).toISOString();
    expect(formatSignalTime(almostTwo)).toMatch(/ago$/);
  });

  it("returns absolute timestamp for signals 2+ hours old", () => {
    // Fixed date: Apr 16 2026, 14:32 UTC
    const old = "2026-04-16T14:32:00.000Z";
    const result = formatSignalTime(old);
    // Should not end with "ago"
    expect(result).not.toMatch(/ago$/);
    // Should contain the time portion
    expect(result).toMatch(/14:32/);
  });

  it("returns absolute timestamp for signals exactly 2 hours old", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    expect(formatSignalTime(twoHoursAgo)).not.toMatch(/ago$/);
  });
});
```

- [ ] **Step 3: Run test to confirm it fails**

```bash
npm run test -- utils
```

Expected: FAIL — `formatSignalTime` is not exported from utils.

- [ ] **Step 4: Implement `formatSignalTime` in `lib/utils.ts`**

Add after the existing `timeAgo` function:

```ts
/**
 * Format a signal timestamp for the feed.
 * Under 2 hours: relative ("2m ago", "1h ago").
 * 2 hours or older: absolute ("Apr 16, 14:32").
 */
export function formatSignalTime(isoOrMs: string | number): string {
  const ms = typeof isoOrMs === "string" ? new Date(isoOrMs).getTime() : isoOrMs;
  const ageMs = Date.now() - ms;
  if (ageMs < 2 * 60 * 60 * 1000) return timeAgo(ms);
  const d = new Date(ms);
  const month = d.toLocaleString("en-US", { month: "short" });
  const day   = d.getDate();
  const hh    = String(d.getHours()).padStart(2, "0");
  const mm    = String(d.getMinutes()).padStart(2, "0");
  return `${month} ${day}, ${hh}:${mm}`;
}
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
npm run test -- utils
```

Expected: all `formatSignalTime` tests PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/utils.ts lib/__tests__/utils.test.ts
git commit -m "feat(utils): add formatSignalTime — relative under 2h, absolute beyond"
```

---

## Task 2: Fix `wallet_address` in `/api/signals-feed`

The existing endpoint returns `wallet_id` (Supabase UUID). The client needs the on-chain `0x...` address. Fix via Supabase foreign-key join.

**Files:**
- Modify: `app/api/signals-feed/route.ts`

- [ ] **Step 1: Update the Supabase select to JOIN `wallets`**

Replace the entire file content:

```ts
// app/api/signals-feed/route.ts
// Cursor-paginated signals_history for the feed infinite scroll.
// GET /api/signals-feed?before=<ISO timestamp>&limit=50
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "@/lib/env";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

export async function GET(req: NextRequest) {
  const before = req.nextUrl.searchParams.get("before");
  const limit  = Math.min(
    Number(req.nextUrl.searchParams.get("limit") ?? DEFAULT_LIMIT),
    MAX_LIMIT,
  );

  let query = supabase
    .from("signals_history")
    .select(`
      recipe_id,
      coin,
      signal_type,
      direction,
      detected_at,
      ev_score,
      wallet_id,
      metadata,
      wallets!wallet_id ( address )
    `)
    .order("detected_at", { ascending: false })
    .limit(limit + 1); // one extra to detect hasMore

  if (before) {
    query = query.lt("detected_at", before);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = data ?? [];
  const hasMore = rows.length > limit;
  const signals = rows.slice(0, limit).map((row) => ({
    recipe_id:      row.recipe_id,
    coin:           row.coin,
    signal_type:    row.signal_type,
    direction:      row.direction,
    detected_at:    row.detected_at,
    ev_score:       row.ev_score,
    wallet_id:      row.wallet_id,
    wallet_address: (row.wallets as { address: string } | null)?.address ?? null,
    metadata:       row.metadata,
  }));

  return NextResponse.json({ signals, hasMore });
}
```

- [ ] **Step 2: Verify the endpoint builds with no type errors**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Smoke test against local DB**

```bash
curl "http://localhost:3000/api/signals-feed?limit=3" | jq '.[0] | {wallet_id, wallet_address}'
```

Expected: `wallet_address` is a `0x...` string (not null, not a UUID).

- [ ] **Step 4: Commit**

```bash
git add app/api/signals-feed/route.ts
git commit -m "fix(signals-feed): JOIN wallets table to return on-chain wallet_address"
```

---

## Task 3: Fix `wallet_address` in KV snapshot (`/api/refresh-cohort`)

The KV payload's `recent_signals` array currently carries `wallet_id` (UUID). The client needs `wallet_address`. The wallet addresses are already available in memory during the cron cycle — build a lookup map and apply it.

**Files:**
- Modify: `app/api/refresh-cohort/route.ts`

- [ ] **Step 1: Update the `CohortCachePayload` type**

At the bottom of `app/api/refresh-cohort/route.ts`, add `wallet_address` to the `recent_signals` array type:

```ts
export interface CohortCachePayload {
  updated_at:            string;
  wallet_count:          number;
  total_active_wallets:  number;
  regime:                "BULL" | "BEAR" | "RANGING";
  btc_return_24h:        number;
  top_wallets:           CohortWalletSummary[];
  recent_signals: Array<{
    recipe_id:      string;
    coin:           string;
    signal_type:    string;
    direction:      string | null;
    detected_at:    string;
    ev_score:       number | null;
    wallet_id:      string;
    wallet_address: string | null;   // on-chain 0x address; null for cohort-level signals
    metadata:       Record<string, unknown>;
  }>;
}
```

- [ ] **Step 2: Build a walletId-to-address lookup map before the KV write**

Find the `// ── Step 10: Fetch recent signals` comment around line 280. Just before it, add:

```ts
// Build a UUID → address map from the active wallets already in scope
const walletAddressMap = new Map<string, string>(
  wallets.map((w) => [w.id, w.address] as [string, string])
);
```

Note: `wallets` is the array fetched from Supabase at the top of `handleRefresh`. It contains `{ id, address, ... }` for all active wallets.

- [ ] **Step 3: Apply the map in the `recent_signals` mapping**

Find the `.map((s) => ({ ... }))` block around line 300 and add `wallet_address`:

```ts
recent_signals: (recentSignals ?? []).map((s) => ({
  recipe_id:      s.recipe_id,
  coin:           s.coin,
  signal_type:    s.signal_type,
  direction:      s.direction,
  detected_at:    s.detected_at,
  ev_score:       s.ev_score,
  wallet_id:      s.wallet_id,
  wallet_address: s.wallet_id ? (walletAddressMap.get(s.wallet_id) ?? null) : null,
  metadata:       s.metadata,
})),
```

- [ ] **Step 4: Type check**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/api/refresh-cohort/route.ts
git commit -m "fix(refresh-cohort): include wallet_address in KV snapshot recent_signals"
```

---

## Task 4: Rewrite `app/signals/feed/FeedClient.tsx`

Full rewrite. The existing file is ~270 lines — the new one will be larger due to the sidebar, portal popups, and expanded row structure. Keep everything in one file unless a sub-component exceeds ~80 lines of JSX, in which case extract to `app/signals/feed/`.

**Files:**
- Rewrite: `app/signals/feed/FeedClient.tsx`

Read the spec at `docs/superpowers/specs/2026-04-16-signals-feed-redesign.md` and the token file at `lib/design-tokens.ts` before writing any styles.

- [ ] **Step 1: Define types at the top of the file**

```ts
"use client";
// app/signals/feed/FeedClient.tsx

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { RECIPE_META } from "@/lib/recipe-meta";
import { truncateAddress, formatSignalTime } from "@/lib/utils";
import type { CohortCachePayload } from "@/app/api/refresh-cohort/route";
import {
  color, type as T, space, radius, shadow, effect,
  layout, anim, card, signal, selectable,
} from "@/lib/design-tokens";

type Signal = CohortCachePayload["recent_signals"][number];
```

- [ ] **Step 2: Define the style object `S` using only design tokens**

```ts
const S = {
  page:   { padding: `0 ${space.pagePaddingX} ${space.contentPaddingBot}` },
  body:   { display: "flex", gap: space.cardGap, alignItems: "flex-start" },

  // Sidebar
  sidebar: {
    width: "196px", flexShrink: 0,
    ...card.base,
    maxHeight: "calc(100vh - 140px)", overflow: "hidden",
    display: "flex", flexDirection: "column" as const,
  },
  sidebarScroll: { overflowY: "auto" as const, flex: 1 },
  sidebarHeader: {
    ...card.header,
    fontSize: "11px", fontWeight: 700,
    letterSpacing: "0.1em", textTransform: "uppercase" as const,
    color: "rgba(255,255,255,0.4)",
  },
  groupLabel: {
    fontSize: "11px", fontWeight: 700,
    letterSpacing: "0.1em", textTransform: "uppercase" as const,
    color: color.textFaint,
    padding: "12px 16px 4px",
  },
  recipeItem: {
    display: "flex", alignItems: "center", gap: "8px",
    padding: "7px 16px", cursor: "pointer",
    fontSize: "13px", color: color.textMuted,
    transition: anim.row,
    userSelect: "none" as const,
  },

  // Feed panel
  feedPanel:  { flex: 1, minWidth: 0, display: "flex", flexDirection: "column" as const, gap: space.cardGap },
  feedHeader: { ...card.header, flexWrap: "wrap" as const, gap: "8px", padding: "10px 20px" },
  feedScroll: { overflowY: "auto" as const, maxHeight: "calc(100vh - 200px)" },

  // Signal row — 4-column grid
  sigRow: {
    display: "grid",
    gridTemplateColumns: "76px 1fr 90px 56px",
    alignItems: "center",
    gap: "14px",
    padding: "14px 20px",
    borderBottom: `1px solid ${color.divider}`,
    transition: anim.row,
    cursor: "default",
  },

  // Pill
  pill: {
    fontSize: "11px", fontWeight: 700,
    letterSpacing: "0.06em",
    padding: "3px 6px", borderRadius: radius.dirPill,
    width: "76px", textAlign: "center" as const,
    display: "block", boxSizing: "border-box" as const,
    whiteSpace: "nowrap" as const,
  },

  // Body cells
  sigTopRow: {
    display: "flex", alignItems: "center", gap: "8px",
    flexWrap: "nowrap" as const, overflow: "hidden",
  },
  sigName: {
    ...T.sigName,
    whiteSpace: "nowrap" as const,
    overflow: "hidden", textOverflow: "ellipsis", flexShrink: 1,
  },
  sigReason: { ...T.sigSub, marginTop: "5px", lineHeight: 1.45 },
  sigFooter: { marginTop: "4px" },
  sigAddr: {
    fontFamily: T.mono, fontSize: "11px",
    color: `${color.neutral}88`,
    textDecoration: "underline",
    textDecorationColor: `${color.neutral}33`,
    textUnderlineOffset: "3px",
    ...selectable.on,
  },

  // Coin tag (same as existing sigCoinTag token)
  coinTag: { ...T.sigCoinTag },

  // Direction pill
  dirPill: { ...T.sigDir },

  // Time column
  sigTime: {
    fontSize: "13px", color: color.textDim,
    textAlign: "right" as const, whiteSpace: "nowrap" as const,
    paddingRight: "20px", fontVariantNumeric: "tabular-nums",
  },

  // EV column
  sigEv: {
    borderLeft: `1px solid ${color.border}`,
    alignSelf: "stretch" as const,
    display: "flex", flexDirection: "column" as const,
    alignItems: "center", justifyContent: "center",
    paddingLeft: "20px", paddingRight: "8px",
    textAlign: "center" as const, cursor: "default",
  },
  evValue: { fontSize: "16px", fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1 },
  evLabel: { fontSize: "11px", color: color.textDim, marginTop: "3px" },

  // Coin chips
  chipRow: { display: "flex", alignItems: "center", gap: "6px", flex: 1, flexWrap: "wrap" as const },
  chip: {
    fontSize: "11px", fontWeight: 700, letterSpacing: "0.06em",
    padding: "4px 10px", borderRadius: radius.tag,
    background: color.tagBg, border: `1px solid ${color.border}`,
    color: color.textMuted, cursor: "pointer",
  },
  chipActive: {
    background: color.inputBg,
    border: `1px solid ${color.borderHover}`,
    color: color.text,
  },

  // Segmented control
  segCtrl: {
    display: "flex", gap: "2px",
    background: color.inputBg,
    border: `1px solid ${color.inputBorder}`,
    borderRadius: radius.input, padding: "3px",
  },
  segBtn: {
    fontSize: "11px", fontWeight: 700, letterSpacing: "0.06em",
    padding: "3px 10px", borderRadius: radius.dirPill,
    background: "none", border: "none",
    color: color.textMuted, cursor: "pointer",
  },
  segBtnActive: {
    background: color.borderHover,
    color: color.text,
  },

  // Search wrap
  searchWrap: {
    position: "relative" as const, flexShrink: 0,
    borderRadius: radius.input,
    width: "28px", height: "28px",
    background: "rgba(255,255,255,0.05)",
    border: `1px solid ${color.border}`,
    display: "flex", alignItems: "center", justifyContent: "center",
    cursor: "pointer",
    transition: `width 0.2s cubic-bezier(0.4,0,0.2,1), border-color 0.15s`,
    overflow: "hidden",
  },
  searchWrapOpen: {
    width: "72px",
    borderColor: color.borderHover,
    cursor: "text",
  },

  // Muted / footer
  muted: { color: color.textMuted, fontSize: "13px" },
  scrollFooter: { padding: "16px 20px", textAlign: "center" as const, fontSize: "11px", color: color.textFaint },
} as const;
```

- [ ] **Step 3: Define constants**

```ts
const COHORT_RECIPES = new Set([
  "divergence_squeeze", "liq_rebound", "concentration_risk",
  "funding_divergence", "funding_trend",
]);

const SIGNAL_TYPE_LABEL: Record<string, string> = {
  SCALE_IN:  "SCALE IN",
  SCALE_OUT: "SCALE OUT",
};

const PILL_COLORS: Record<string, { bg: string; color: string; border: string }> = {
  ENTRY:     { bg: `${signal.entry}14`,   color: signal.entry,   border: `${signal.entry}38` },
  EXIT:      { bg: `${signal.exit}14`,    color: signal.exit,    border: `${signal.exit}38` },
  ALERT:     { bg: `${signal.alert}14`,   color: signal.alert,   border: `${signal.alert}38` },
  SCALE_IN:  { bg: `${signal.scaleIn}14`, color: signal.scaleIn, border: `${signal.scaleIn}30` },
  SCALE_OUT: { bg: `${signal.scaleOut}14`,color: signal.scaleOut,border: `${signal.scaleOut}30` },
  FLIP:      { bg: `${signal.flip}14`,    color: signal.flip,    border: `${signal.flip}30` },
};

const DIR_COLORS = {
  LONG:  { background: color.longBg,   color: color.green,   border: `1px solid ${color.longBorder}` },
  SHORT: { background: color.shortBg,  color: color.red,     border: `1px solid ${color.shortBorder}` },
  FLAT:  { background: color.neutralBg,color: color.neutral, border: `1px solid ${color.neutralBorder}` },
} as const;

const EV_COLOR = (score: number) =>
  score > 0.6 ? color.green : score > 0.3 ? color.amber : color.neutral;

const COINS = ["BTC", "ETH", "SOL", "HYPE", "ARB", "AVAX", "DOGE", "SUI"];

const RECIPE_GROUPS: Array<{ label: string; ids: string[] }> = [
  { label: "Momentum", ids: ["momentum_stack", "accumulation_reentry", "streak_continuation", "whale_validated"] },
  { label: "Smart Money", ids: ["divergence_squeeze", "anti_whale_trap", "wallet_churn", "bridge_inflow", "twap_accumulation"] },
  { label: "Risk", ids: ["liq_rebound", "position_aging", "concentration_risk"] },
  { label: "Carry & Funding", ids: ["rotation_carry", "funding_divergence", "funding_trend"] },
];
```

- [ ] **Step 4: Write `SignalRow` sub-component**

```tsx
function SignalRow({ sig }: { sig: Signal }) {
  const meta      = RECIPE_META[sig.recipe_id];
  const pillStyle = PILL_COLORS[sig.signal_type] ?? PILL_COLORS.FLIP;
  const dirStyle  = sig.direction ? DIR_COLORS[sig.direction as keyof typeof DIR_COLORS] : null;
  const typeLabel = SIGNAL_TYPE_LABEL[sig.signal_type] ?? sig.signal_type;
  const address   = (sig as Signal & { wallet_address?: string | null }).wallet_address ?? null;

  return (
    <div style={{ ...S.sigRow }} onMouseEnter={(e) => (e.currentTarget.style.background = color.rowHover)} onMouseLeave={(e) => (e.currentTarget.style.background = "")}>
      {/* Col 1: pill */}
      <span style={{ ...S.pill, background: pillStyle.bg, color: pillStyle.color, border: `1px solid ${pillStyle.border}` }}>
        {typeLabel}
      </span>

      {/* Col 2: body */}
      <div style={{ minWidth: 0 }}>
        <div style={S.sigTopRow}>
          <span style={S.sigName}>{meta?.label ?? sig.recipe_id}</span>
          <span style={S.coinTag}>{sig.coin}</span>
          {dirStyle && sig.direction && (
            <span style={{ ...S.dirPill, ...dirStyle }}>{sig.direction}</span>
          )}
        </div>
        {typeof sig.metadata?.description === "string" && (
          <div style={S.sigReason}>{sig.metadata.description}</div>
        )}
        {address && !COHORT_RECIPES.has(sig.recipe_id) && (
          <div style={S.sigFooter}>
            <a
              href={`/wallets/discovery?address=${address}`}
              style={S.sigAddr}
              draggable={false}
            >
              {truncateAddress(address)}
            </a>
          </div>
        )}
      </div>

      {/* Col 3: time */}
      <div style={S.sigTime}>{formatSignalTime(sig.detected_at)}</div>

      {/* Col 4: EV */}
      {sig.ev_score != null ? (
        <div style={S.sigEv}>
          <div style={{ ...S.evValue, color: EV_COLOR(sig.ev_score) }}>
            {(sig.ev_score * 100).toFixed(0)}
          </div>
          <div style={S.evLabel}>EV</div>
        </div>
      ) : (
        <div style={{ ...S.sigEv, borderLeft: "none" }} />
      )}
    </div>
  );
}
```

- [ ] **Step 5: Write `RecipeSidebar` sub-component**

```tsx
function RecipeSidebar({
  selected,
  onToggle,
}: {
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  const [popup, setPopup] = useState<{
    id: string; label: string; desc: string; rect: DOMRect;
  } | null>(null);

  const handleMouseEnter = useCallback((id: string, label: string, desc: string, e: React.MouseEvent) => {
    setPopup({ id, label, desc, rect: (e.currentTarget as HTMLElement).getBoundingClientRect() });
  }, []);

  const handleMouseLeave = useCallback(() => setPopup(null), []);

  return (
    <div style={S.sidebar}>
      <div style={S.sidebarHeader}>Recipes</div>
      <div style={S.sidebarScroll}>
        {RECIPE_GROUPS.map((group) => (
          <div key={group.label}>
            <div style={S.groupLabel}>{group.label}</div>
            {group.ids.map((id) => {
              const meta = RECIPE_META[id];
              if (!meta) return null;
              const isSelected = selected.has(id);
              return (
                <div
                  key={id}
                  className="glow-btn"
                  style={{
                    ...S.recipeItem,
                    background: isSelected ? color.navActivebg : "transparent",
                    border: isSelected ? `1px solid ${color.borderHover}` : "1px solid transparent",
                    borderRadius: radius.tag,
                    margin: "0 8px 2px",
                    padding: "7px 8px",
                  }}
                  onClick={() => onToggle(id)}
                  onMouseEnter={(e) => handleMouseEnter(id, meta.label, meta.desc, e)}
                  onMouseLeave={handleMouseLeave}
                >
                  <span style={{ fontSize: "11px", color: color.amber }}>●</span>
                  <span style={{ fontSize: "13px", color: isSelected ? color.text : color.textMuted }}>
                    {meta.label}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Portal popup */}
      {popup && typeof document !== "undefined" && createPortal(
        <RecipePopup label={popup.label} desc={popup.desc} rect={popup.rect} />,
        document.body,
      )}
    </div>
  );
}
```

- [ ] **Step 6: Write portal popup components**

```tsx
function RecipePopup({ label, desc, rect }: { label: string; desc: string; rect: DOMRect }) {
  const POPUP_W = 256;
  const bottom  = window.innerHeight - rect.top + 8;
  let   left    = rect.left + 12;
  if (left + POPUP_W > window.innerWidth - 12) left = window.innerWidth - POPUP_W - 12;

  return (
    <div style={{
      position: "fixed", bottom, left, width: POPUP_W,
      background: "rgba(14,14,14,0.97)",
      border: `1px solid ${color.borderHover}`,
      borderRadius: radius.card,
      padding: "14px 16px",
      zIndex: layout.zIndex.popup,
      boxShadow: "0 12px 40px rgba(0,0,0,0.8)",
      pointerEvents: "none",
      fontFamily: T.sans,
    }}>
      <div style={{ fontSize: "13px", fontWeight: 700, color: color.text, marginBottom: "6px" }}>{label}</div>
      <div style={{ fontSize: "16px", color: color.textMuted, lineHeight: 1.45 }}>{desc}</div>
    </div>
  );
}

function EvPopup({ rect }: { rect: DOMRect }) {
  const EV_W  = 220;
  const bottom = window.innerHeight - rect.top + 8;
  const left   = Math.max(12, rect.right - EV_W);

  return (
    <div style={{
      position: "fixed", bottom, left, width: EV_W,
      background: "rgba(14,14,14,0.97)",
      border: `1px solid ${color.borderHover}`,
      borderRadius: radius.card,
      padding: "14px 16px",
      zIndex: layout.zIndex.popup,
      boxShadow: "0 12px 40px rgba(0,0,0,0.8)",
      pointerEvents: "none",
      fontFamily: T.sans,
    }}>
      <div style={{ fontSize: "13px", fontWeight: 700, color: color.text, marginBottom: "6px" }}>Expected Value</div>
      <div style={{ fontSize: "16px", color: color.textMuted, lineHeight: 1.45 }}>
        Modeled signal edge based on historical accuracy and market context. Higher scores indicate stronger conviction.
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Write the main `FeedClient` component**

```tsx
export function FeedClient({ initialData }: { initialData: CohortCachePayload | null }) {
  const { data } = useQuery<CohortCachePayload>({
    queryKey:        ["cohort-state"],
    queryFn:         () => fetch("/api/cohort-state").then((r) => r.json()),
    initialData:     initialData ?? undefined,
    placeholderData: keepPreviousData,
    staleTime:       55_000,
    refetchInterval: 60_000,
  });

  // Filters
  const [selectedRecipes, setSelectedRecipes] = useState<Set<string>>(new Set());
  const [filterDir,  setFilterDir]  = useState<string>("all");
  const [filterCoin, setFilterCoin] = useState<string>("");
  const [activeCoin, setActiveCoin] = useState<string>("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchWrapRef  = useRef<HTMLDivElement>(null);

  // EV popup
  const [evPopupRect, setEvPopupRect] = useState<DOMRect | null>(null);

  // Infinite scroll
  const [extra,      setExtra]      = useState<Signal[]>([]);
  const [hasMore,    setHasMore]    = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const fetchingRef  = useRef(false);
  const sentinelRef  = useRef<HTMLDivElement>(null);

  const toggleRecipe = useCallback((id: string) => {
    setSelectedRecipes((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  // Reset pagination when filters change
  const prevFilters = useRef({ selectedRecipes, filterDir, activeCoin, filterCoin });
  useEffect(() => {
    const prev = prevFilters.current;
    if (
      prev.filterDir   !== filterDir   ||
      prev.activeCoin  !== activeCoin  ||
      prev.filterCoin  !== filterCoin  ||
      prev.selectedRecipes !== selectedRecipes
    ) {
      prevFilters.current = { selectedRecipes, filterDir, activeCoin, filterCoin };
      setExtra([]);
      setHasMore(true);
    }
  }, [selectedRecipes, filterDir, activeCoin, filterCoin]);

  const fetchMore = useCallback(async (cursor: string) => {
    if (fetchingRef.current || !hasMore) return;
    fetchingRef.current = true;
    setIsFetching(true);
    try {
      const res = await fetch(`/api/signals-feed?before=${encodeURIComponent(cursor)}&limit=50`);
      if (!res.ok) return;
      const { signals: newSigs, hasMore: more } = await res.json() as { signals: Signal[]; hasMore: boolean };
      setExtra((prev) => [...prev, ...newSigs]);
      setHasMore(more);
    } finally {
      fetchingRef.current = false;
      setIsFetching(false);
    }
  }, [hasMore]);

  // IntersectionObserver for infinite scroll
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting || fetchingRef.current) return;
      const allSigs = [...(data?.recent_signals ?? []), ...extra];
      if (allSigs.length === 0) return;
      const oldest = allSigs.reduce((min, s) => s.detected_at < min ? s.detected_at : min, allSigs[0].detected_at);
      fetchMore(oldest);
    }, { threshold: 0.1 });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [data, extra, hasMore, fetchMore]);

  // Search expand/collapse
  useEffect(() => {
    if (!searchOpen) return;
    searchInputRef.current?.focus();
    const onClickOutside = (e: MouseEvent) => {
      if (!searchWrapRef.current?.contains(e.target as Node)) {
        setSearchOpen(false);
        setFilterCoin("");
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setSearchOpen(false); setFilterCoin(""); }
    };
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [searchOpen]);

  const allSignals: Signal[] = [...(data?.recent_signals ?? []), ...extra];

  const filtered = allSignals.filter((s) => {
    if (selectedRecipes.size > 0 && !selectedRecipes.has(s.recipe_id)) return false;
    if (filterDir !== "all" && s.direction !== filterDir) return false;
    if (activeCoin && s.coin !== activeCoin) return false;
    if (filterCoin && !s.coin.toLowerCase().includes(filterCoin.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="page-enter">
      <PageHeader title="Feed" subtitle="Live signals from tracked smart money wallets" />
      <div style={S.page}>
        <div style={S.body}>

          {/* Sidebar */}
          <RecipeSidebar selected={selectedRecipes} onToggle={toggleRecipe} />

          {/* Feed panel */}
          <div style={S.feedPanel}>
            <div style={{ ...card.base }}>

              {/* Header: coin chips + search + seg control */}
              <div style={S.feedHeader}>
                <div style={S.chipRow}>
                  {COINS.map((coin) => (
                    <button
                      key={coin}
                      className="glow-btn"
                      style={{
                        ...S.chip,
                        ...(activeCoin === coin ? S.chipActive : {}),
                        border: "none", fontFamily: T.sans,
                      }}
                      onClick={() => setActiveCoin((prev) => prev === coin ? "" : coin)}
                    >
                      {coin}
                    </button>
                  ))}

                  {/* Expandable search */}
                  <div
                    ref={searchWrapRef}
                    className="glow-btn"
                    style={{ ...S.searchWrap, ...(searchOpen ? S.searchWrapOpen : {}) }}
                    onClick={() => !searchOpen && setSearchOpen(true)}
                  >
                    <svg
                      style={{ width: 13, height: 13, color: "rgba(255,255,255,0.35)", flexShrink: 0, opacity: searchOpen ? 0 : 1, transition: "opacity 0.15s" }}
                      viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}
                    >
                      <circle cx="6.5" cy="6.5" r="4" /><path d="M10 10l3 3" strokeLinecap="round" />
                    </svg>
                    <input
                      ref={searchInputRef}
                      value={filterCoin}
                      onChange={(e) => setFilterCoin(e.target.value)}
                      placeholder=""
                      style={{
                        position: "absolute", left: "10px", top: 0, bottom: 0,
                        width: "calc(100% - 16px)",
                        background: "none", border: "none", outline: "none",
                        fontFamily: T.sans, fontSize: "13px", color: color.text,
                        opacity: searchOpen ? 1 : 0, pointerEvents: searchOpen ? "all" : "none",
                        transition: "opacity 0.15s",
                      }}
                    />
                  </div>
                </div>

                {/* Segmented control */}
                <div style={{ flexShrink: 0 }}>
                  <div style={S.segCtrl}>
                    {(["all", "LONG", "SHORT", "FLAT"] as const).map((dir) => (
                      <button
                        key={dir}
                        className="glow-btn"
                        style={{
                          ...S.segBtn,
                          ...(filterDir === dir ? S.segBtnActive : {}),
                          fontFamily: T.sans,
                        }}
                        onClick={() => setFilterDir(dir)}
                      >
                        {dir === "all" ? "ALL" : dir}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Signal list */}
              <div style={S.feedScroll}>
                {!data ? (
                  // Loading skeletons
                  Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} style={{ ...S.sigRow, animation: "slide-up-ghost 2.4s ease-in-out infinite" }}>
                      <div style={{ height: 18, width: 76, borderRadius: radius.dirPill, background: "rgba(255,255,255,0.06)" }} />
                      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                        <div style={{ height: 10, width: "50%", borderRadius: radius.skeleton, background: "rgba(255,255,255,0.06)" }} />
                        <div style={{ height: 8,  width: "70%", borderRadius: radius.skeleton, background: "rgba(255,255,255,0.06)" }} />
                      </div>
                      <div style={{ height: 10, width: 48, borderRadius: radius.skeleton, background: "rgba(255,255,255,0.06)", marginLeft: "auto" }} />
                      <div style={{ height: 20, width: 28, borderRadius: radius.skeleton, background: "rgba(255,255,255,0.06)" }} />
                    </div>
                  ))
                ) : filtered.length === 0 ? (
                  <div style={{ padding: "48px", textAlign: "center", ...S.muted }}>No signals match your filters</div>
                ) : (
                  filtered.map((sig, i) => (
                    <SignalRow key={`${sig.detected_at}-${sig.recipe_id}-${sig.coin}-${i}`} sig={sig} />
                  ))
                )}

                {/* Infinite scroll sentinel */}
                {data && filtered.length > 0 && (
                  <div ref={sentinelRef} style={S.scrollFooter}>
                    {isFetching ? "loading more..." : hasMore ? " " : "all signals loaded"}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Type check and lint**

```bash
npm run typecheck && npm run lint
```

Fix any errors before proceeding.

- [ ] **Step 9: Smoke test in browser**

```bash
npm run dev
```

Open `http://localhost:3000/signals/feed`. Verify:
- Sidebar shows 4 groups with recipe items
- Header shows coin chips + search icon + ALL/LONG/SHORT/FLAT
- Signal rows render with 4-column layout
- Pill labels use SCALE IN / SCALE OUT (no underscores)
- Wallet addresses show as `0x1234...abcd`
- Timestamps show relative under 2h, absolute beyond
- EV column has left divider, blank for null EV
- Click recipe items to filter (multi-select)
- Click coin chip to filter
- Click search icon: expands, icon fades, type "BTC" to filter
- Click outside search to collapse
- Scroll to bottom triggers more signal loading

- [ ] **Step 10: Commit**

```bash
git add app/signals/feed/FeedClient.tsx
git commit -m "feat(feed): rewrite FeedClient with new layout, sidebar, portal popups, wallet address fix"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| 4-column grid (76px pill, 1fr body, 90px time, 56px EV) | Task 4 Step 2 `S.sigRow` |
| V1 pill fixed-width centered | Task 4 Steps 2-3 |
| Coin chips in header, expandable search | Task 4 Step 7 |
| Segmented control ALL/LONG/SHORT/FLAT in header | Task 4 Step 7 |
| Multi-select recipe sidebar, orange dot | Task 4 Steps 5, 7 |
| Portal popups (recipe + EV) at `layout.zIndex.popup` | Task 4 Steps 6, 7 |
| Trigger reason from `metadata.description` | Task 4 Step 4 |
| Truncated wallet address `0x1234...abcd` | Task 4 Step 4 |
| Wallet address links to `/wallets/discovery?address=` | Task 4 Step 4 |
| Cohort-level recipes suppress address row | Task 4 Step 4 `COHORT_RECIPES` |
| formatSignalTime: relative under 2h, absolute beyond | Task 1 |
| EV color: green >60, amber >30, neutral otherwise | Task 4 Step 3 `EV_COLOR` |
| Infinite scroll unchanged | Task 4 Step 7 |
| Skeleton loading state | Task 4 Step 7 |
| `wallet_address` in signals-feed API | Task 2 |
| `wallet_address` in KV snapshot | Task 3 |
| `layout.zIndex.popup` token | Already done before this plan |
| `formatSignalTime` utility | Task 1 |

All spec requirements covered. No gaps.

**Type consistency:** `Signal` type from `CohortCachePayload["recent_signals"]` is used throughout. `wallet_address` is cast with `(sig as Signal & { wallet_address?: string | null })` because the base type doesn't yet include it — this is safe but worth noting: after Task 3 lands, update `CohortCachePayload` in `refresh-cohort/route.ts` and the cast becomes unnecessary. The plan handles this ordering correctly (Tasks 2 and 3 before Task 4).

**No placeholders found.**
