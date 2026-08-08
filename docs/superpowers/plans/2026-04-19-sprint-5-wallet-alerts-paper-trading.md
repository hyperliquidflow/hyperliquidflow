# Sprint 5: Wallet Alerts + Paper Copy Trading

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users follow specific wallets, receive position change alerts, and simulate copy trading with a virtual paper portfolio, all stored in localStorage.

**Architecture:** A new `/api/wallet-positions` route fetches live Hyperliquid clearinghouse states for followed wallets. `useAlertDetection` polls it every 60s, diffs consecutive snapshots with `diffPositions()`, and writes events to localStorage. Custom window events keep multiple hook instances in sync. Sprint 6 migration: swap localStorage reads/writes inside each hook for Supabase calls without touching any components.

**Tech Stack:** Next.js 15 App Router, React Query, TypeScript, localStorage, custom window events, Hyperliquid clearinghouse API, design-tokens

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Create | `lib/alert-engine.ts` | Shared types + pure `diffPositions()` |
| Create | `lib/__tests__/alert-engine.test.ts` | Tests for diffPositions |
| Create | `lib/hooks/use-followed-wallets.ts` | localStorage R/W for FollowedWallet[] |
| Create | `lib/hooks/use-alert-events.ts` | localStorage R/W for AlertEvent[] |
| Create | `lib/hooks/use-paper-positions.ts` | localStorage R/W for PaperPosition[] |
| Create | `lib/hooks/use-alert-detection.ts` | Polls wallet-positions, diffs, fires events |
| Create | `app/api/wallet-positions/route.ts` | Fetches HL clearinghouse states per address |
| Create | `components/alert-bell.tsx` | Bell icon + unseen badge + drawer |
| Create | `components/follow-button.tsx` | Follow/unfollow button + settings modal |
| Create | `app/wallets/following/page.tsx` | Page shell |
| Create | `app/wallets/following/FollowingClient.tsx` | Followed wallets list |
| Create | `app/wallets/paper/page.tsx` | Page shell |
| Create | `app/wallets/paper/PaperClient.tsx` | Paper positions + settings |
| Modify | `components/nav.tsx` | Add 2 nav entries + AlertBell + useAlertDetection |
| Modify | `app/wallets/leaderboard/LeaderboardClient.tsx` | Add FollowButton per row |

---

### Task 1: Types + diffPositions with tests

**Files:**
- Create: `lib/alert-engine.ts`
- Create: `lib/__tests__/alert-engine.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// lib/__tests__/alert-engine.test.ts
import { describe, it, expect } from "vitest";
import { diffPositions } from "../alert-engine";
import type { PositionSnapshot } from "../alert-engine";

const BTC_LONG: PositionSnapshot  = { coin: "BTC", szi: 0.1,  entry_px: 90_000, side: "long" };
const ETH_LONG: PositionSnapshot  = { coin: "ETH", szi: 2.0,  entry_px: 3_000,  side: "long" };
const BTC_SHORT: PositionSnapshot = { coin: "BTC", szi: -0.1, entry_px: 90_000, side: "short" };

describe("diffPositions", () => {
  it("detects POSITION_OPENED when asset appears", () => {
    const events = diffPositions([], [BTC_LONG], "0xabc");
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe("POSITION_OPENED");
    expect(events[0].asset).toBe("BTC");
    expect(events[0].side).toBe("long");
    expect(events[0].wallet_address).toBe("0xabc");
    expect(events[0].price).toBe(90_000);
  });

  it("detects POSITION_CLOSED when asset disappears", () => {
    const events = diffPositions([BTC_LONG], [], "0xabc");
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe("POSITION_CLOSED");
    expect(events[0].asset).toBe("BTC");
  });

  it("detects POSITION_RESIZED when szi changes > 10%", () => {
    const bigger: PositionSnapshot = { ...BTC_LONG, szi: 0.12 };
    const events = diffPositions([BTC_LONG], [bigger], "0xabc");
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe("POSITION_RESIZED");
  });

  it("ignores szi changes <= 10%", () => {
    const slight: PositionSnapshot = { ...BTC_LONG, szi: 0.105 };
    expect(diffPositions([BTC_LONG], [slight], "0xabc")).toHaveLength(0);
  });

  it("returns no events when positions unchanged", () => {
    expect(diffPositions([BTC_LONG], [BTC_LONG], "0xabc")).toHaveLength(0);
  });

  it("handles multiple events in one diff", () => {
    const events = diffPositions([BTC_LONG], [ETH_LONG], "0xabc");
    expect(events).toHaveLength(2);
    expect(events.map(e => e.event_type).sort()).toEqual(["POSITION_CLOSED", "POSITION_OPENED"]);
  });

  it("computes size_usd as abs(szi) * entry_px", () => {
    const events = diffPositions([], [BTC_LONG], "0xabc");
    expect(events[0].size_usd).toBeCloseTo(9_000);
  });

  it("detects SHORT side correctly", () => {
    const events = diffPositions([], [BTC_SHORT], "0xabc");
    expect(events[0].side).toBe("short");
  });

  it("handles empty prev and empty current", () => {
    expect(diffPositions([], [], "0xabc")).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run -- expect fail**

```bash
npx vitest run lib/__tests__/alert-engine.test.ts
```
Expected: FAIL (module not found)

- [ ] **Step 3: Implement lib/alert-engine.ts**

```typescript
// lib/alert-engine.ts

export interface PositionSnapshot {
  coin:     string;
  szi:      number;   // signed: positive = long, negative = short
  entry_px: number;
  side:     "long" | "short";
}

export interface AlertEvent {
  id:             string;
  wallet_address: string;
  event_type:     "POSITION_OPENED" | "POSITION_CLOSED" | "POSITION_RESIZED";
  asset:          string;
  side:           "long" | "short";
  size_usd:       number;
  price:          number;
  detected_at:    string;
  seen:           boolean;
}

export interface FollowedWallet {
  address:     string;
  label?:      string;
  followed_at: string;
  alert_on:    ("open" | "close" | "resize")[];
  paper_copy:  boolean;
}

export interface PaperPosition {
  id:            string;
  source_wallet: string;
  asset:         string;
  side:          "long" | "short";
  size_usd:      number;
  entry_price:   number;
  opened_at:     string;
  status:        "open" | "closed";
  exit_price?:   number;
  closed_at?:    string;
  realized_pnl?: number;
}

export interface PaperSettings {
  default_size_usd: number;
  size_mode:        "fixed" | "proportional";
}

type NewAlertEvent = Omit<AlertEvent, "id" | "seen">;

const RESIZE_THRESHOLD = 0.10;

export function diffPositions(
  prev:          PositionSnapshot[],
  current:       PositionSnapshot[],
  walletAddress: string,
): NewAlertEvent[] {
  const prevMap = new Map(prev.map(p => [p.coin, p]));
  const currMap = new Map(current.map(p => [p.coin, p]));
  const now     = new Date().toISOString();
  const events: NewAlertEvent[] = [];

  for (const [coin, pos] of currMap) {
    if (!prevMap.has(coin)) {
      events.push({ wallet_address: walletAddress, event_type: "POSITION_OPENED",
        asset: coin, side: pos.side,
        size_usd: Math.abs(pos.szi) * pos.entry_px, price: pos.entry_px, detected_at: now });
    }
  }

  for (const [coin, pos] of prevMap) {
    if (!currMap.has(coin)) {
      events.push({ wallet_address: walletAddress, event_type: "POSITION_CLOSED",
        asset: coin, side: pos.side,
        size_usd: Math.abs(pos.szi) * pos.entry_px, price: pos.entry_px, detected_at: now });
    }
  }

  for (const [coin, curr] of currMap) {
    const p = prevMap.get(coin);
    if (!p) continue;
    if (Math.abs((curr.szi - p.szi) / p.szi) > RESIZE_THRESHOLD) {
      events.push({ wallet_address: walletAddress, event_type: "POSITION_RESIZED",
        asset: coin, side: curr.side,
        size_usd: Math.abs(curr.szi) * curr.entry_px, price: curr.entry_px, detected_at: now });
    }
  }

  return events;
}
```

- [ ] **Step 4: Run -- expect pass**

```bash
npx vitest run lib/__tests__/alert-engine.test.ts
```
Expected: 9 passed

- [ ] **Step 5: Commit**

```bash
git add lib/alert-engine.ts lib/__tests__/alert-engine.test.ts
git commit -m "feat(s5): alert-engine types + diffPositions"
```

---

### Task 2: useFollowedWallets hook

**Files:**
- Create: `lib/hooks/use-followed-wallets.ts`

- [ ] **Step 1: Create the hook**

```typescript
// lib/hooks/use-followed-wallets.ts
"use client";
import { useState, useCallback, useEffect } from "react";
import type { FollowedWallet } from "@/lib/alert-engine";

const KEY = "hl_followed_wallets";
const EVT = "hl:followed-wallets-changed";

function read(): FollowedWallet[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]"); }
  catch { return []; }
}

function write(wallets: FollowedWallet[]) {
  localStorage.setItem(KEY, JSON.stringify(wallets));
  window.dispatchEvent(new Event(EVT));
}

export function useFollowedWallets() {
  const [wallets, setWallets] = useState<FollowedWallet[]>([]);

  useEffect(() => {
    setWallets(read());
    const handler = () => setWallets(read());
    window.addEventListener(EVT, handler);
    return () => window.removeEventListener(EVT, handler);
  }, []);

  const follow = useCallback((w: FollowedWallet) => {
    const next = [...read().filter(x => x.address !== w.address), w];
    write(next); setWallets(next);
  }, []);

  const unfollow = useCallback((address: string) => {
    const next = read().filter(x => x.address !== address);
    write(next); setWallets(next);
  }, []);

  const update = useCallback((address: string, patch: Partial<FollowedWallet>) => {
    const next = read().map(x => x.address === address ? { ...x, ...patch } : x);
    write(next); setWallets(next);
  }, []);

  const isFollowing = useCallback(
    (address: string) => wallets.some(w => w.address === address),
    [wallets],
  );

  return { wallets, follow, unfollow, update, isFollowing };
}
```

- [ ] **Step 2: Run full suite -- expect no regressions**

```bash
npm run test
```
Expected: 203 passed

- [ ] **Step 3: Commit**

```bash
git add lib/hooks/use-followed-wallets.ts
git commit -m "feat(s5): useFollowedWallets hook"
```

---

### Task 3: useAlertEvents hook

**Files:**
- Create: `lib/hooks/use-alert-events.ts`

- [ ] **Step 1: Create the hook**

```typescript
// lib/hooks/use-alert-events.ts
"use client";
import { useState, useCallback, useEffect } from "react";
import type { AlertEvent } from "@/lib/alert-engine";

const KEY       = "hl_alert_events";
const EVT       = "hl:alert-events-changed";
const EXPIRE_MS = 7 * 86_400_000;

type NewAlertEvent = Omit<AlertEvent, "id" | "seen">;

function read(): AlertEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const all: AlertEvent[] = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return all.filter(e => Date.now() - new Date(e.detected_at).getTime() < EXPIRE_MS);
  } catch { return []; }
}

function write(events: AlertEvent[]) {
  localStorage.setItem(KEY, JSON.stringify(events));
  window.dispatchEvent(new Event(EVT));
}

export function useAlertEvents() {
  const [events, setEvents] = useState<AlertEvent[]>([]);

  useEffect(() => {
    const clean = read();
    setEvents(clean);
    write(clean); // prune expired on mount
    const handler = () => setEvents(read());
    window.addEventListener(EVT, handler);
    return () => window.removeEventListener(EVT, handler);
  }, []);

  const addEvents = useCallback((incoming: NewAlertEvent[]) => {
    if (incoming.length === 0) return;
    const stamped = incoming.map(e => ({ ...e, id: crypto.randomUUID(), seen: false }));
    const next = [...stamped, ...read()];
    write(next); setEvents(next);
  }, []);

  const markAllSeen = useCallback(() => {
    const next = read().map(e => ({ ...e, seen: true }));
    write(next); setEvents(next);
  }, []);

  const unseenCount = events.filter(e => !e.seen).length;

  return { events, addEvents, markAllSeen, unseenCount };
}
```

- [ ] **Step 2: Run test suite**

```bash
npm run test
```
Expected: 203 passed

- [ ] **Step 3: Commit**

```bash
git add lib/hooks/use-alert-events.ts
git commit -m "feat(s5): useAlertEvents hook with 7d expiry"
```

---

### Task 4: usePaperPositions hook

**Files:**
- Create: `lib/hooks/use-paper-positions.ts`

- [ ] **Step 1: Create the hook**

```typescript
// lib/hooks/use-paper-positions.ts
"use client";
import { useState, useCallback, useEffect } from "react";
import type { PaperPosition, PaperSettings, AlertEvent } from "@/lib/alert-engine";

const POS_KEY = "hl_paper_positions";
const SET_KEY = "hl_paper_settings";
const POS_EVT = "hl:paper-positions-changed";

const DEFAULT_SETTINGS: PaperSettings = { default_size_usd: 100, size_mode: "fixed" };

function readPositions(): PaperPosition[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(POS_KEY) ?? "[]"); }
  catch { return []; }
}

function readSettings(): PaperSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SET_KEY) ?? "{}") }; }
  catch { return DEFAULT_SETTINGS; }
}

function writePositions(positions: PaperPosition[]) {
  localStorage.setItem(POS_KEY, JSON.stringify(positions));
  window.dispatchEvent(new Event(POS_EVT));
}

export function usePaperPositions() {
  const [positions, setPositions] = useState<PaperPosition[]>([]);
  const [settings,  setSettings]  = useState<PaperSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    setPositions(readPositions());
    setSettings(readSettings());
    const handler = () => setPositions(readPositions());
    window.addEventListener(POS_EVT, handler);
    return () => window.removeEventListener(POS_EVT, handler);
  }, []);

  const openPosition = useCallback((event: AlertEvent) => {
    const s = readSettings();
    const pos: PaperPosition = {
      id: crypto.randomUUID(), source_wallet: event.wallet_address,
      asset: event.asset, side: event.side,
      size_usd:    s.size_mode === "fixed" ? s.default_size_usd : event.size_usd,
      entry_price: event.price, opened_at: event.detected_at, status: "open",
    };
    const next = [pos, ...readPositions()];
    writePositions(next); setPositions(next);
  }, []);

  const closePosition = useCallback((event: AlertEvent) => {
    const next = readPositions().map(p => {
      if (p.status !== "open" || p.source_wallet !== event.wallet_address || p.asset !== event.asset) return p;
      const pnl = (event.price - p.entry_price) / p.entry_price * p.size_usd * (p.side === "long" ? 1 : -1);
      return { ...p, status: "closed" as const, exit_price: event.price, closed_at: event.detected_at, realized_pnl: pnl };
    });
    writePositions(next); setPositions(next);
  }, []);

  const updateSettings = useCallback((patch: Partial<PaperSettings>) => {
    const next = { ...readSettings(), ...patch };
    localStorage.setItem(SET_KEY, JSON.stringify(next));
    setSettings(next);
  }, []);

  return { positions, settings, openPosition, closePosition, updateSettings };
}
```

- [ ] **Step 2: Run test suite**

```bash
npm run test
```
Expected: 203 passed

- [ ] **Step 3: Commit**

```bash
git add lib/hooks/use-paper-positions.ts
git commit -m "feat(s5): usePaperPositions hook"
```

---

### Task 5: /api/wallet-positions route

**Files:**
- Create: `app/api/wallet-positions/route.ts`

- [ ] **Step 1: Create the route**

```typescript
// app/api/wallet-positions/route.ts
import { NextRequest, NextResponse } from "next/server";
import { fetchClearinghouseState } from "@/lib/hyperliquid-api-client";
import type { PositionSnapshot } from "@/lib/alert-engine";

export const runtime = "nodejs";

export interface WalletPositionsResponse {
  wallets: { address: string; positions: PositionSnapshot[] }[];
}

export async function POST(req: NextRequest) {
  let addresses: string[];
  try {
    const body = await req.json() as { addresses?: unknown };
    if (!Array.isArray(body.addresses)) return NextResponse.json({ wallets: [] });
    addresses = (body.addresses as unknown[])
      .filter((a): a is string => typeof a === "string")
      .slice(0, 20);
  } catch {
    return NextResponse.json({ wallets: [] });
  }

  if (addresses.length === 0) return NextResponse.json({ wallets: [] });

  const results = await Promise.allSettled(
    addresses.map(async (address) => {
      const state = await fetchClearinghouseState(address);
      const positions: PositionSnapshot[] = state.assetPositions
        .map(({ position: p }) => ({
          coin:     p.coin,
          szi:      parseFloat(p.szi),
          entry_px: parseFloat(p.entryPx),
          side:     (parseFloat(p.szi) >= 0 ? "long" : "short") as "long" | "short",
        }))
        .filter(p => p.szi !== 0);
      return { address, positions };
    })
  );

  const wallets = results
    .filter((r): r is PromiseFulfilledResult<{ address: string; positions: PositionSnapshot[] }> =>
      r.status === "fulfilled")
    .map(r => r.value);

  return NextResponse.json({ wallets } satisfies WalletPositionsResponse);
}
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add app/api/wallet-positions/route.ts
git commit -m "feat(s5): /api/wallet-positions route"
```

---

### Task 6: useAlertDetection hook

**Files:**
- Create: `lib/hooks/use-alert-detection.ts`

- [ ] **Step 1: Create the hook**

```typescript
// lib/hooks/use-alert-detection.ts
"use client";
import { useEffect, useRef } from "react";
import { diffPositions } from "@/lib/alert-engine";
import type { AlertEvent, FollowedWallet, PositionSnapshot } from "@/lib/alert-engine";

const FOLLOWED_KEY  = "hl_followed_wallets";
const ALERT_KEY     = "hl_alert_events";
const PAPER_POS_KEY = "hl_paper_positions";
const PAPER_SET_KEY = "hl_paper_settings";
const ALERT_EVT     = "hl:alert-events-changed";
const PAPER_EVT     = "hl:paper-positions-changed";
const POLL_MS       = 60_000;
const EXPIRE_MS     = 7 * 86_400_000;

function readFollowed(): FollowedWallet[] {
  try { return JSON.parse(localStorage.getItem(FOLLOWED_KEY) ?? "[]"); }
  catch { return []; }
}

function appendAlerts(incoming: AlertEvent[]) {
  if (incoming.length === 0) return;
  try {
    const all: AlertEvent[] = JSON.parse(localStorage.getItem(ALERT_KEY) ?? "[]");
    const pruned = all.filter(e => Date.now() - new Date(e.detected_at).getTime() < EXPIRE_MS);
    localStorage.setItem(ALERT_KEY, JSON.stringify([...incoming, ...pruned]));
    window.dispatchEvent(new Event(ALERT_EVT));
  } catch { /* silent */ }
}

function handlePaperTrade(event: AlertEvent, type: "open" | "close") {
  try {
    const settings = { default_size_usd: 100, size_mode: "fixed",
      ...JSON.parse(localStorage.getItem(PAPER_SET_KEY) ?? "{}") };
    const all: object[] = JSON.parse(localStorage.getItem(PAPER_POS_KEY) ?? "[]");
    if (type === "open") {
      all.unshift({
        id: crypto.randomUUID(), source_wallet: event.wallet_address,
        asset: event.asset, side: event.side,
        size_usd: settings.size_mode === "fixed" ? settings.default_size_usd : event.size_usd,
        entry_price: event.price, opened_at: event.detected_at, status: "open",
      });
    } else {
      for (const p of all as Array<Record<string, unknown>>) {
        if (p.status === "open" && p.source_wallet === event.wallet_address && p.asset === event.asset) {
          const pnl = (event.price - (p.entry_price as number)) / (p.entry_price as number)
            * (p.size_usd as number) * (p.side === "long" ? 1 : -1);
          Object.assign(p, { status: "closed", exit_price: event.price, closed_at: event.detected_at, realized_pnl: pnl });
        }
      }
    }
    localStorage.setItem(PAPER_POS_KEY, JSON.stringify(all));
    window.dispatchEvent(new Event(PAPER_EVT));
  } catch { /* silent */ }
}

export function useAlertDetection() {
  const cache = useRef<Record<string, PositionSnapshot[]>>({});

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      if (cancelled) return;
      const followed = readFollowed();
      if (followed.length === 0) return;

      try {
        const res = await fetch("/api/wallet-positions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ addresses: followed.map(w => w.address) }),
        });
        if (!res.ok || cancelled) return;

        const { wallets } = await res.json() as { wallets: { address: string; positions: PositionSnapshot[] }[] };
        const wMap = new Map(followed.map(w => [w.address, w]));
        const newAlerts: AlertEvent[] = [];

        for (const { address, positions } of wallets) {
          const fw = wMap.get(address);
          if (!fw) continue;
          const prev = cache.current[address];
          cache.current[address] = positions;
          if (!prev) continue; // first poll: seed cache only

          for (const e of diffPositions(prev, positions, address)) {
            const allowed =
              (e.event_type === "POSITION_OPENED"  && fw.alert_on.includes("open"))   ||
              (e.event_type === "POSITION_CLOSED"   && fw.alert_on.includes("close"))  ||
              (e.event_type === "POSITION_RESIZED"  && fw.alert_on.includes("resize"));
            if (!allowed) continue;

            const full: AlertEvent = { ...e, id: crypto.randomUUID(), seen: false };
            newAlerts.push(full);

            if (fw.paper_copy) {
              if (e.event_type === "POSITION_OPENED") handlePaperTrade(full, "open");
              if (e.event_type === "POSITION_CLOSED") handlePaperTrade(full, "close");
            }
          }
        }

        appendAlerts(newAlerts);
      } catch { /* silent */ }
    }

    poll();
    const id = setInterval(poll, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);
}
```

- [ ] **Step 2: Run test suite**

```bash
npm run test
```
Expected: 203 passed

- [ ] **Step 3: Commit**

```bash
git add lib/hooks/use-alert-detection.ts
git commit -m "feat(s5): useAlertDetection hook"
```

---

### Task 7: AlertBell component

**Files:**
- Create: `components/alert-bell.tsx`

- [ ] **Step 1: Create the component**

```tsx
"use client";
// components/alert-bell.tsx
import type React from "react";
import { useState } from "react";
import { useAlertEvents } from "@/lib/hooks/use-alert-events";
import { timeAgo } from "@/lib/utils";
import { color, card as C, type as T, space, layout, radius } from "@/lib/design-tokens";

const S = {
  btn: {
    position:       "relative" as const,
    background:     "none",
    border:         "none",
    cursor:         "pointer",
    padding:        "6px",
    display:        "flex",
    alignItems:     "center",
    justifyContent: "center",
    color:          "rgba(255,255,255,0.44)",
    flexShrink:     0 as const,
  },
  badge: {
    position:    "absolute" as const,
    top:         "2px",
    right:       "2px",
    minWidth:    "16px",
    height:      "16px",
    borderRadius: "8px",
    background:  color.red,
    color:       "#fff",
    fontSize:    "10px",
    fontWeight:  700,
    display:     "flex",
    alignItems:  "center",
    justifyContent: "center",
    padding:     "0 4px",
    fontVariantNumeric: "tabular-nums",
    pointerEvents: "none" as const,
  },
  overlay: {
    position: "fixed" as const,
    inset:    0,
    zIndex:   layout.zIndex.navBackdrop,
  },
  drawer: {
    position:       "fixed" as const,
    top:            0,
    right:          0,
    bottom:         0,
    width:          "360px",
    zIndex:         layout.zIndex.popup,
    background:     color.nav,
    borderLeft:     `1px solid ${color.border}`,
    backdropFilter: "blur(16px)",
    WebkitBackdropFilter: "blur(16px)",
    display:        "flex",
    flexDirection:  "column" as const,
    overflowY:      "auto" as const,
  } as React.CSSProperties,
  drawerHdr: {
    ...C.header,
    padding:    space.cardHeaderPadding,
    flexShrink: 0 as const,
  },
  drawerTitle: { ...T.cardTitle, flexGrow: 1 },
  markBtn: {
    fontSize:   "11px",
    fontWeight: 600,
    color:      color.textDim,
    background: "none",
    border:     "none",
    cursor:     "pointer",
    padding:    "0 0 0 12px",
  },
  empty: {
    padding:   "40px 20px",
    textAlign: "center" as const,
    color:     color.textMuted,
    fontSize:  "13px",
  },
  row: {
    padding:      "12px 20px",
    borderBottom: `1px solid ${color.divider}`,
  },
  rowHdr: {
    display:        "flex",
    alignItems:     "center",
    gap:            "8px",
    justifyContent: "space-between",
  },
  pill: (type: string): React.CSSProperties => ({
    fontSize:      "10px",
    fontWeight:    700,
    letterSpacing: "0.05em",
    padding:       "2px 6px",
    borderRadius:  radius.dirPill,
    color:      type === "POSITION_OPENED" ? color.green : type === "POSITION_CLOSED" ? color.red : color.amber,
    background: type === "POSITION_OPENED" ? `${color.green}18` : type === "POSITION_CLOSED" ? `${color.red}18` : `${color.amber}18`,
    border:     `1px solid ${type === "POSITION_OPENED" ? `${color.green}30` : type === "POSITION_CLOSED" ? `${color.red}30` : `${color.amber}30`}`,
  }),
  asset:     { fontFamily: "'Geist Mono', monospace", fontSize: "13px", fontWeight: 600, color: color.text },
  meta:      { fontSize: "11px", color: color.textMuted, marginTop: "3px", fontVariantNumeric: "tabular-nums" },
  unseenDot: { width: "6px", height: "6px", borderRadius: "50%", background: color.accent, flexShrink: 0 as const },
};

const LABEL: Record<string, string> = {
  POSITION_OPENED:  "Opened",
  POSITION_CLOSED:  "Closed",
  POSITION_RESIZED: "Resized",
};

export function AlertBell() {
  const [open, setOpen] = useState(false);
  const { events, markAllSeen, unseenCount } = useAlertEvents();

  function handleOpen() {
    setOpen(true);
    if (unseenCount > 0) markAllSeen();
  }

  return (
    <>
      <button onClick={handleOpen} style={S.btn} aria-label="Alerts" draggable={false}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unseenCount > 0 && (
          <span style={S.badge}>{unseenCount > 99 ? "99+" : unseenCount}</span>
        )}
      </button>

      {open && (
        <>
          <div style={S.overlay} onClick={() => setOpen(false)} />
          <div style={S.drawer}>
            <div style={S.drawerHdr}>
              <span style={S.drawerTitle}>Alerts</span>
              {events.length > 0 && (
                <button style={S.markBtn} onClick={markAllSeen}>Mark all seen</button>
              )}
              <button style={{ ...S.markBtn, marginLeft: "8px" }} onClick={() => setOpen(false)}>Close</button>
            </div>

            {events.length === 0 ? (
              <div style={S.empty}>No alerts yet. Follow a wallet to get started.</div>
            ) : (
              events.map(evt => (
                <div key={evt.id} style={S.row}>
                  <div style={S.rowHdr}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      {!evt.seen && <span style={S.unseenDot} />}
                      <span style={S.asset}>{evt.asset}</span>
                      <span style={S.pill(evt.event_type)}>{LABEL[evt.event_type]}</span>
                    </div>
                    <span style={{ fontSize: "11px", color: color.textMuted, fontVariantNumeric: "tabular-nums" }}>
                      {timeAgo(evt.detected_at)}
                    </span>
                  </div>
                  <div style={S.meta}>
                    {evt.side.toUpperCase()} {evt.asset} at ${evt.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </>
  );
}
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add components/alert-bell.tsx
git commit -m "feat(s5): AlertBell component"
```

---

### Task 8: FollowButton component

**Files:**
- Create: `components/follow-button.tsx`

- [ ] **Step 1: Create the component**

```tsx
"use client";
// components/follow-button.tsx
import type React from "react";
import { useState } from "react";
import { useFollowedWallets } from "@/lib/hooks/use-followed-wallets";
import { color, radius, layout } from "@/lib/design-tokens";

const S = {
  btn: (following: boolean): React.CSSProperties => ({
    fontSize:      "11px",
    fontWeight:    600,
    letterSpacing: "0.04em",
    padding:       "3px 9px",
    borderRadius:  radius.tag,
    border:        `1px solid ${following ? color.borderHover : color.border}`,
    background:    following ? "rgba(255,255,255,0.06)" : "transparent",
    color:         following ? color.text : color.textMuted,
    cursor:        "pointer",
    flexShrink:    0 as const,
    transition:    "color 0.15s, border-color 0.15s",
  }),
  overlay: {
    position:       "fixed" as const,
    inset:          0,
    background:     "rgba(0,0,0,0.6)",
    backdropFilter: "blur(4px)",
    WebkitBackdropFilter: "blur(4px)",
    zIndex:         layout.zIndex.navBackdrop,
    display:        "flex",
    alignItems:     "center",
    justifyContent: "center",
  },
  modal: {
    background:          "rgba(12,12,12,0.95)",
    border:              `1px solid rgba(255,255,255,0.1)`,
    borderRadius:        radius.card,
    padding:             "24px",
    width:               "320px",
    backdropFilter:      "blur(16px)",
    WebkitBackdropFilter:"blur(16px)",
    boxShadow:           "0 8px 40px rgba(0,0,0,0.6)",
    zIndex:              layout.zIndex.popup,
  } as React.CSSProperties,
  label: {
    fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em",
    textTransform: "uppercase" as const, color: "rgba(255,255,255,0.4)",
    display: "block", marginBottom: "6px",
  },
  input: {
    width: "100%", background: color.inputBg, border: `1px solid ${color.inputBorder}`,
    borderRadius: radius.input, color: "rgba(255,255,255,0.85)",
    fontSize: "13px", padding: "8px 10px", boxSizing: "border-box" as const, marginBottom: "16px",
  },
  checkRow: {
    display: "flex", alignItems: "center", gap: "8px",
    marginBottom: "8px", cursor: "pointer", fontSize: "13px", color: "rgba(255,255,255,0.7)",
  },
  actions: {
    display: "flex", gap: "8px", marginTop: "20px", justifyContent: "flex-end",
  },
  cancel: {
    fontSize: "13px", padding: "7px 14px", borderRadius: radius.input,
    border: `1px solid ${color.border}`, background: "transparent",
    color: color.textMuted, cursor: "pointer",
  },
  save: {
    fontSize: "13px", fontWeight: 600, padding: "7px 14px",
    borderRadius: radius.input, border: "none",
    background: color.accent, color: "#000", cursor: "pointer",
  },
  unfollow: {
    fontSize: "13px", padding: "7px 14px", borderRadius: radius.input,
    border: `1px solid ${color.red}40`, background: `${color.red}10`,
    color: color.red, cursor: "pointer",
  },
};

export function FollowButton({ address }: { address: string }) {
  const { isFollowing, follow, unfollow, wallets } = useFollowedWallets();
  const [open, setOpen] = useState(false);
  const following = isFollowing(address);
  const existing  = wallets.find(w => w.address === address);

  const [label,   setLabel]   = useState(existing?.label ?? "");
  const [alertOn, setAlertOn] = useState<("open" | "close" | "resize")[]>(
    existing?.alert_on ?? ["open", "close", "resize"]
  );
  const [papCopy, setPapCopy] = useState(existing?.paper_copy ?? false);

  function openModal() {
    setLabel(existing?.label ?? "");
    setAlertOn(existing?.alert_on ?? ["open", "close", "resize"]);
    setPapCopy(existing?.paper_copy ?? false);
    setOpen(true);
  }

  function toggleAlert(t: "open" | "close" | "resize") {
    setAlertOn(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);
  }

  function save() {
    follow({
      address, label: label || undefined,
      followed_at: existing?.followed_at ?? new Date().toISOString(),
      alert_on: alertOn, paper_copy: papCopy,
    });
    setOpen(false);
  }

  return (
    <>
      <button onClick={openModal} style={S.btn(following)} draggable={false}>
        {following ? "Following" : "Follow"}
      </button>

      {open && (
        <div style={S.overlay} onClick={() => setOpen(false)}>
          <div style={S.modal} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: "16px", fontWeight: 600, color: color.text, marginBottom: "20px" }}>
              {following ? "Edit follow" : "Follow wallet"}
            </div>

            <label style={S.label}>Nickname (optional)</label>
            <input
              style={S.input}
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="e.g. Whale Alpha"
              maxLength={40}
            />

            <label style={S.label}>Alert on</label>
            {(["open", "close", "resize"] as const).map(t => (
              <label key={t} style={S.checkRow}>
                <input type="checkbox" checked={alertOn.includes(t)} onChange={() => toggleAlert(t)} />
                {t === "open" ? "Position opened" : t === "close" ? "Position closed" : "Position resized (>10%)"}
              </label>
            ))}

            <label style={{ ...S.checkRow, marginTop: "12px" }}>
              <input type="checkbox" checked={papCopy} onChange={e => setPapCopy(e.target.checked)} />
              Auto-create paper trades
            </label>

            <div style={S.actions}>
              {following && (
                <button style={S.unfollow} onClick={() => { unfollow(address); setOpen(false); }}>
                  Unfollow
                </button>
              )}
              <button style={S.cancel} onClick={() => setOpen(false)}>Cancel</button>
              <button style={S.save} onClick={save} disabled={alertOn.length === 0}>Save</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add components/follow-button.tsx
git commit -m "feat(s5): FollowButton component"
```

---

### Task 9: Wire into Nav + add nav entries

**Files:**
- Modify: `components/nav.tsx`

- [ ] **Step 1: Add two imports after existing imports**

```typescript
import { AlertBell } from "@/components/alert-bell";
import { useAlertDetection } from "@/lib/hooks/use-alert-detection";
```

- [ ] **Step 2: Add two entries to the Wallets section children array, after In Position**

```typescript
{ href: "/wallets/following",   label: "Following"     },
{ href: "/wallets/paper",       label: "Paper Trading" },
```

- [ ] **Step 3: Call useAlertDetection inside Nav() after the existing useQuery call**

```typescript
useAlertDetection();
```

- [ ] **Step 4: Add AlertBell to the logo row. Change the sidenav-logo-wrap div from**

```tsx
<div className="sidenav-logo-wrap" style={{ padding: "0 20px 24px", borderBottom: `1px solid ${color.borderFaint}`, marginBottom: "16px" }}>
```

to:

```tsx
<div className="sidenav-logo-wrap" style={{ padding: "0 20px 24px", borderBottom: `1px solid ${color.borderFaint}`, marginBottom: "16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
```

Then add `<AlertBell />` as the last child of that div, after the closing `</div>` of the wordmark spans div.

- [ ] **Step 5: Run typecheck**

```bash
npm run typecheck
```
Expected: no errors

- [ ] **Step 6: Run test suite**

```bash
npm run test
```
Expected: 203 passed

- [ ] **Step 7: Commit**

```bash
git add components/nav.tsx
git commit -m "feat(s5): Following/Paper nav entries + AlertBell + useAlertDetection in Nav"
```

---

### Task 10: Add FollowButton to Leaderboard rows

**Files:**
- Modify: `app/wallets/leaderboard/LeaderboardClient.tsx`

- [ ] **Step 1: Add import after existing imports**

```typescript
import { FollowButton } from "@/components/follow-button";
```

- [ ] **Step 2: Update the wallet address cell in displayed.map()**

Find the `<td>` that renders the address, TierBadge, and StyleBadge. Change the wrapper div to add `gap: "8px"` and append `<FollowButton address={w.address} />` as the last child:

```tsx
<td style={S.td}>
  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
    <button onClick={() => router.push(`/wallets/discovery?address=${w.address}`)}
      style={{ ...S.mono, color: color.neutral, background: "none", border: "none", cursor: "pointer", padding: 0, textAlign: "left" as const }}>
      {truncateAddress(w.address)}
    </button>
    <TierBadge tier={w.equity_tier} />
    <StyleBadge style={w.trading_style} />
    <FollowButton address={w.address} />
  </div>
</td>
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add app/wallets/leaderboard/LeaderboardClient.tsx
git commit -m "feat(s5): FollowButton in leaderboard rows"
```

---

### Task 11: /wallets/following page

**Files:**
- Create: `app/wallets/following/page.tsx`
- Create: `app/wallets/following/FollowingClient.tsx`

- [ ] **Step 1: Create page.tsx**

```tsx
// app/wallets/following/page.tsx
import { FollowingClient } from "./FollowingClient";
export const metadata = { title: "Following" };
export default function FollowingPage() { return <FollowingClient />; }
```

- [ ] **Step 2: Create FollowingClient.tsx**

```tsx
"use client";
// app/wallets/following/FollowingClient.tsx
import { useQuery } from "@tanstack/react-query";
import { useFollowedWallets } from "@/lib/hooks/use-followed-wallets";
import { useAlertEvents } from "@/lib/hooks/use-alert-events";
import { FollowButton } from "@/components/follow-button";
import { PageHeader } from "@/components/page-header";
import { formatUsd, truncateAddress } from "@/lib/utils";
import type { CohortCachePayload } from "@/app/api/refresh-cohort/route";
import { color, card as C, type as T, space } from "@/lib/design-tokens";

const S = {
  page:  { padding: space.pagePaddingX },
  card:  { ...C.base },
  empty: { padding: "48px 20px", textAlign: "center" as const, color: color.textMuted, fontSize: "13px" },
  row: {
    padding: "14px 20px", borderBottom: `1px solid ${color.divider}`,
    display: "flex", alignItems: "center", gap: "12px", transition: "background 0.12s",
  },
  addr: { ...T.walletAddr, flex: 1 },
  meta: { fontSize: "11px", color: color.textFaint, marginTop: "2px" },
  stat: { fontSize: "13px", fontVariantNumeric: "tabular-nums", color: color.textMuted, flexShrink: 0 as const },
};

export function FollowingClient() {
  const { wallets } = useFollowedWallets();
  const { unseenCount } = useAlertEvents();
  const { data } = useQuery<CohortCachePayload>({
    queryKey:        ["cohort-state"],
    queryFn:         () => fetch("/api/cohort-state").then(r => r.json()),
    staleTime:       55_000,
    refetchInterval: 60_000,
  });

  const walletMap = new Map(data?.top_wallets.map(w => [w.address, w]) ?? []);

  const subtitle = wallets.length === 0
    ? "Follow wallets to track their positions"
    : `${wallets.length} wallet${wallets.length === 1 ? "" : "s"} followed${unseenCount > 0 ? `, ${unseenCount} unseen alert${unseenCount === 1 ? "" : "s"}` : ""}`;

  return (
    <div className="page-enter">
      <PageHeader title="Following" subtitle={subtitle} />
      <div style={{ ...S.page, paddingTop: "20px" }}>
        <div style={S.card}>
          {wallets.length === 0 ? (
            <div style={S.empty}>
              No wallets followed. Use the Follow button on the Leaderboard to get started.
            </div>
          ) : (
            wallets.map(fw => {
              const w = walletMap.get(fw.address);
              return (
                <div key={fw.address} style={S.row}
                  onMouseEnter={e => (e.currentTarget.style.background = color.rowHover)}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={S.addr}>
                      {fw.label ? `${fw.label} (${truncateAddress(fw.address)})` : truncateAddress(fw.address)}
                    </div>
                    <div style={S.meta}>
                      Alerts: {fw.alert_on.join(", ")}{fw.paper_copy ? ", paper copy on" : ""}
                    </div>
                  </div>
                  {w && (
                    <>
                      <span style={{ ...S.stat, color: w.unrealized_pnl >= 0 ? color.green : color.red }}>
                        {formatUsd(w.unrealized_pnl)}
                      </span>
                      <span style={S.stat}>{w.position_count} pos</span>
                    </>
                  )}
                  <FollowButton address={fw.address} />
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add app/wallets/following/page.tsx app/wallets/following/FollowingClient.tsx
git commit -m "feat(s5): /wallets/following page"
```

---

### Task 12: /wallets/paper page

**Files:**
- Create: `app/wallets/paper/page.tsx`
- Create: `app/wallets/paper/PaperClient.tsx`

- [ ] **Step 1: Create page.tsx**

```tsx
// app/wallets/paper/page.tsx
import { PaperClient } from "./PaperClient";
export const metadata = { title: "Paper Trading" };
export default function PaperPage() { return <PaperClient />; }
```

- [ ] **Step 2: Create PaperClient.tsx**

```tsx
"use client";
// app/wallets/paper/PaperClient.tsx
import type React from "react";
import { useQuery } from "@tanstack/react-query";
import { usePaperPositions } from "@/lib/hooks/use-paper-positions";
import { PageHeader } from "@/components/page-header";
import { formatUsd, truncateAddress } from "@/lib/utils";
import type { MarketTickerEntry } from "@/app/api/market-ticker/route";
import { color, card as C, type as T, space, radius } from "@/lib/design-tokens";

const S = {
  page:  { padding: space.pagePaddingX },
  card:  { ...C.base, marginBottom: space.cardGap },
  hdr:   { ...C.header },
  title: { ...T.cardTitle },
  empty: { padding: "32px 20px", textAlign: "center" as const, color: color.textMuted, fontSize: "13px" },
  row: {
    padding: "12px 20px", borderBottom: `1px solid ${color.divider}`,
    display: "flex", alignItems: "center", gap: "10px", transition: "background 0.12s",
  },
  asset: { fontFamily: "'Geist Mono', monospace", fontSize: "13px", fontWeight: 600, color: color.text, minWidth: "48px" },
  pill:  (side: string): React.CSSProperties => ({
    fontSize: "10px", fontWeight: 700, letterSpacing: "0.04em", padding: "2px 6px", borderRadius: radius.dirPill,
    background: side === "long" ? color.longBg   : color.shortBg,
    border:     `1px solid ${side === "long" ? color.longBorder : color.shortBorder}`,
    color:      side === "long" ? color.green    : color.red,
  }),
  muted: { fontSize: "11px", color: color.textMuted, flexShrink: 0 as const, fontVariantNumeric: "tabular-nums" },
  pnl:   (v: number): React.CSSProperties => ({
    fontSize: "13px", fontVariantNumeric: "tabular-nums", flexShrink: 0,
    color: v >= 0 ? color.green : color.red,
  }),
  statGrid: { display: "flex", gap: space.cardGap, marginBottom: space.cardGap },
  statCard: { ...C.base, padding: "16px 20px", flex: 1 },
};

export function PaperClient() {
  const { positions, settings, updateSettings } = usePaperPositions();

  const { data: ticker } = useQuery<MarketTickerEntry[]>({
    queryKey:        ["market-ticker"],
    queryFn:         () => fetch("/api/market-ticker").then(r => r.json()),
    staleTime:       30_000,
    refetchInterval: 60_000,
  });

  const priceMap = new Map((ticker ?? []).map(t => [t.coin, t.price]));
  const open     = positions.filter(p => p.status === "open");
  const closed   = positions.filter(p => p.status === "closed");

  const unrealized = open.reduce((acc, p) => {
    const cur = priceMap.get(p.asset);
    return cur != null
      ? acc + (cur - p.entry_price) / p.entry_price * p.size_usd * (p.side === "long" ? 1 : -1)
      : acc;
  }, 0);

  const realized = closed.reduce((acc, p) => acc + (p.realized_pnl ?? 0), 0);

  const subtitle = `${open.length} open position${open.length === 1 ? "" : "s"}, ${closed.length} closed`;

  return (
    <div className="page-enter">
      <PageHeader title="Paper Trading" subtitle={subtitle} />
      <div style={{ ...S.page, paddingTop: "20px" }}>

        <div style={S.statGrid}>
          <div style={S.statCard}>
            <div style={T.statLabel}>Unrealized PnL</div>
            <div style={{ ...T.statValue, color: unrealized >= 0 ? color.green : color.red }}>
              {formatUsd(unrealized)}
            </div>
          </div>
          <div style={S.statCard}>
            <div style={T.statLabel}>Realized PnL</div>
            <div style={{ ...T.statValue, color: realized >= 0 ? color.green : color.red }}>
              {formatUsd(realized)}
            </div>
          </div>
          <div style={S.statCard}>
            <div style={T.statLabel}>Trade Size</div>
            <div style={{ ...T.statValue, fontSize: "26px", fontVariantNumeric: "tabular-nums" }}>
              ${settings.default_size_usd}
            </div>
            <div style={{ display: "flex", gap: "6px", marginTop: "8px" }}>
              {[50, 100, 250, 500].map(v => (
                <button key={v} onClick={() => updateSettings({ default_size_usd: v })} draggable={false}
                  style={{
                    fontSize: "11px", fontWeight: 600, padding: "3px 8px", borderRadius: "4px", cursor: "pointer",
                    border:     `1px solid ${settings.default_size_usd === v ? "rgba(255,255,255,0.25)" : color.border}`,
                    background: settings.default_size_usd === v ? "rgba(255,255,255,0.08)" : "transparent",
                    color:      settings.default_size_usd === v ? color.text : color.textMuted,
                  }}>
                  ${v}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div style={S.card}>
          <div style={S.hdr}><span style={S.title}>Open Positions</span></div>
          {open.length === 0 ? (
            <div style={S.empty}>No open positions. Follow a wallet with paper copy enabled.</div>
          ) : open.map(p => {
            const cur = priceMap.get(p.asset);
            const pnl = cur != null
              ? (cur - p.entry_price) / p.entry_price * p.size_usd * (p.side === "long" ? 1 : -1)
              : null;
            return (
              <div key={p.id} style={S.row}
                onMouseEnter={e => (e.currentTarget.style.background = color.rowHover)}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              >
                <span style={S.asset}>{p.asset}</span>
                <span style={S.pill(p.side)}>{p.side.toUpperCase()}</span>
                <span style={{ ...S.muted, flex: 1 }}>
                  Entry ${p.entry_price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  {cur != null && `, now $${cur.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
                </span>
                <span style={S.muted}>{truncateAddress(p.source_wallet)}</span>
                {pnl != null && (
                  <span style={S.pnl(pnl)}>{pnl >= 0 ? "+" : ""}{formatUsd(pnl)}</span>
                )}
              </div>
            );
          })}
        </div>

        {closed.length > 0 && (
          <div style={S.card}>
            <div style={S.hdr}><span style={S.title}>Closed Positions</span></div>
            {closed.map(p => (
              <div key={p.id} style={S.row}
                onMouseEnter={e => (e.currentTarget.style.background = color.rowHover)}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              >
                <span style={S.asset}>{p.asset}</span>
                <span style={S.pill(p.side)}>{p.side.toUpperCase()}</span>
                <span style={{ ...S.muted, flex: 1 }}>
                  Entry ${p.entry_price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  {p.exit_price != null && `, exit $${p.exit_price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
                </span>
                <span style={S.muted}>{truncateAddress(p.source_wallet)}</span>
                {p.realized_pnl != null && (
                  <span style={S.pnl(p.realized_pnl)}>
                    {p.realized_pnl >= 0 ? "+" : ""}{formatUsd(p.realized_pnl)}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```
Expected: no errors

- [ ] **Step 4: Run full test suite**

```bash
npm run test
```
Expected: 203 passed

- [ ] **Step 5: Commit**

```bash
git add app/wallets/paper/page.tsx app/wallets/paper/PaperClient.tsx
git commit -m "feat(s5): /wallets/paper page"
```

---

## Spec Coverage

| Requirement | Task |
|-------------|------|
| diffPositions detects OPENED/CLOSED/RESIZED | 1 |
| Alert events stored in localStorage on each poll | 3, 6 |
| Bell badge shows unseen count | 7 |
| Alert drawer, mark-seen | 7 |
| Follow button saves to localStorage | 8, 10 |
| /wallets/following page | 11 |
| Paper positions on POSITION_OPENED | 4, 6 |
| Paper PnL updates from market-ticker | 12 |
| Paper positions close on POSITION_CLOSED | 4, 6 |
| /wallets/paper page | 12 |
| Settings persist | 12 |
| Hooks use abstracted storage interface | 2, 3, 4 |
| No em dashes, token colors only | All tasks |
