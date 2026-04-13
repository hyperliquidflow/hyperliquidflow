# Signals + Edge Unification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the Signals and Imbalance pages into a single tabbed Signals page, rename Recipes to Edge, consolidate RECIPE_META into one shared file, update all docs and copy to match.

**Architecture:** UI-only refactor. No API routes or business logic change. `lib/recipe-meta.ts` becomes the single source of truth for recipe labels/descriptions. The Signals page gains a tab switcher (Signal Feed | Divergence) to absorb Imbalance's content. `/recipes` and `/imbalance` become redirect routes.

**Tech Stack:** Next.js 15 App Router, React, TypeScript, inline style objects, Vercel KV

---

## File Map

| Action | File | Notes |
|--------|------|-------|
| Create | `lib/recipe-meta.ts` | Single source for recipe labels + descriptions |
| Create | `app/edge/page.tsx` | Renamed recipes page with updated title |
| Modify | `app/recipes/page.tsx` | Replace with redirect to `/edge` |
| Modify | `app/signals/page.tsx` | Add tab state; absorb Imbalance content as Tab 2 |
| Delete | `app/imbalance/page.tsx` | Content moves to Signals Tab 2 |
| Modify | `app/contrarian/page.tsx` | Update redirect target `/imbalance` → `/signals` |
| Modify | `components/nav.tsx` | Remove Imbalance, rename Recipes → Edge |
| Modify | `app/page.tsx` | Use `RECIPE_META` from lib/recipe-meta.ts |
| Modify | `docs/product-overview.md` | Remove Imbalance section, rename Recipes → Edge, update Signals |
| Modify | `SETUP.md` | Update Dashboard Pages table |
| Modify | `CLAUDE.md` | Update architecture table and notes |

---

## Task 1: Create `lib/recipe-meta.ts`

**Files:**
- Create: `lib/recipe-meta.ts`

- [ ] **Step 1: Create the file**

```typescript
// lib/recipe-meta.ts
// Single source of truth for signal recipe labels and descriptions.
// Used by: app/page.tsx, app/signals/page.tsx, app/edge/page.tsx

export const RECIPE_META: Record<string, { label: string; desc: string }> = {
  momentum_stack:       { label: "Whale Convergence",      desc: "8+ wallets add $500K+ same direction in under 5 min" },
  divergence_squeeze:   { label: "Silent Loading",          desc: "Exposure rising, price flat, liq buffer below 15%" },
  accumulation_reentry: { label: "Dip Conviction",          desc: "High-score wallets re-enter after 8%+ drawdown in 4h" },
  rotation_carry:       { label: "Funded Edge",             desc: "New position in positive-funding perp with 60%+ hist win rate" },
  liq_rebound:          { label: "Liquidation Flush",       desc: "Smart Money exposure drops sharply, possible cascade (approx.)" },
  streak_continuation:  { label: "Hot Streak",              desc: "5+ trade win streak with Sharpe proxy above 0.6" },
  funding_divergence:   { label: "Smart Money vs. Retail",  desc: "Smart Money and non-Smart Money OI diverge with extreme funding" },
  whale_validated:      { label: "Alpha Confirmation",      desc: "Signal confirmed by 3+ high-score wallets" },
  anti_whale_trap:      { label: "Smart Exit Signal",       desc: "High-score wallet rapidly cutting exposure in adverse Market Vibes" },
};
```

- [ ] **Step 2: Verify typecheck passes**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add lib/recipe-meta.ts
git commit -m "feat: add lib/recipe-meta.ts — single source for recipe labels"
```

---

## Task 2: Update `app/page.tsx` to use shared RECIPE_META

**Files:**
- Modify: `app/page.tsx` (lines 10–20)

- [ ] **Step 1: Replace inline RECIPE_LABELS with import**

Remove the `const RECIPE_LABELS` block (lines 10–20) and add an import at the top of the file, right below the existing imports:

```typescript
import { RECIPE_META } from "@/lib/recipe-meta";
```

- [ ] **Step 2: Update all uses of `RECIPE_LABELS[x]` to `RECIPE_META[x]?.label`**

Search `app/page.tsx` for `RECIPE_LABELS`. Each occurrence like:
```typescript
RECIPE_LABELS[sig.recipe_id]
```
becomes:
```typescript
RECIPE_META[sig.recipe_id]?.label
```

- [ ] **Step 3: Verify typecheck**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx
git commit -m "refactor: use shared RECIPE_META in Overview page"
```

---

## Task 3: Create `app/edge/page.tsx`

**Files:**
- Create: `app/edge/page.tsx`

This is the Recipes page with: title changed to "Edge", subtitle unchanged, RECIPE_META imported from shared lib, the `color` field removed (it was always `#6a6a6a` and unused), and the component/export names updated.

- [ ] **Step 1: Create `app/edge/page.tsx`**

```typescript
"use client";
// app/edge/page.tsx — Edge: signal recipe performance analytics.

import { useQuery } from "@tanstack/react-query";
import { formatPct, timeAgo } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { RECIPE_META } from "@/lib/recipe-meta";
import { color, card as C, type as T, space } from "@/lib/design-tokens";

const S = {
  page:  { padding: space.pagePaddingX },
  card:  { ...C.base },
  hdr:   { ...C.header },
  label: { ...T.cardTitle },
  muted: { color: color.textMuted, fontSize: "13px" },
};

interface RecipeStats {
  recipe_id: string;
  signal_count: number;
  true_positive: number;
  false_positive: number;
  avg_ev_score: number | null;
  win_rate: number | null;
  measured_at: string;
}

function EdgeInner() {
  const { data: stats, isLoading } = useQuery<RecipeStats[]>({
    queryKey: ["recipe-performance"],
    queryFn:  () => fetch("/api/recipe-performance").then((r) => r.json()),
    refetchInterval: 5 * 60_000,
  });

  if (isLoading || !stats) return <div style={{ padding: "28px", ...S.muted }}>Loading performance data…</div>;

  const allRecipes = Object.keys(RECIPE_META).map((id) => {
    const perf = stats.find((s) => s.recipe_id === id);
    return { id, ...RECIPE_META[id], perf };
  });

  return (
    <>
      <PageHeader
        title="Edge"
        subtitle="Signal recipe performance"
      />
      <div style={{ ...S.page, paddingTop: "20px" }}>
      {/* Performance grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px", marginBottom: "24px" }}>
        {allRecipes.map(({ id, label, desc, perf }) => {
          const winRate = perf?.win_rate ?? null;
          const signals = perf?.signal_count ?? 0;
          const ev      = perf?.avg_ev_score ?? null;
          const barColor = winRate != null ? (winRate >= 0.6 ? "#909090" : winRate >= 0.5 ? "#747474" : "#585858") : "#505050";

          return (
            <div key={id} className="card-hover glow-btn" style={{ ...S.card, borderLeft: "3px solid rgba(255,255,255,0.1)" }}>
              <div style={{ padding: "16px 16px 12px" }}>
                <div style={{ fontSize: "12px", fontWeight: 700, color: "#f0f0f0", marginBottom: "4px" }}>{label}</div>
                <div style={{ ...S.muted, fontSize: "10px", marginBottom: "14px" }}>{desc}</div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
                  {[
                    { label: "Win Rate", value: winRate != null ? formatPct(winRate) : "n/a", c: barColor },
                    { label: "Signals",  value: `${signals}`,                                  c: "#f0f0f0" },
                    { label: "Avg EV",   value: ev != null ? (ev * 100).toFixed(0) : "n/a",    c: "#f0f0f0" },
                  ].map(({ label: l, value, c }) => (
                    <div key={l}>
                      <div style={{ fontSize: "9px", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" as const, color: "rgba(255,255,255,0.32)", marginBottom: "3px" }}>{l}</div>
                      <div style={{ fontSize: "15px", fontWeight: 700, color: c }}>{value}</div>
                    </div>
                  ))}
                </div>

                {winRate != null && (
                  <div style={{ marginTop: "12px" }}>
                    <div style={{ width: "100%", height: "3px", background: "rgba(255,255,255,0.08)", borderRadius: "2px" }}>
                      <div style={{ width: `${winRate * 100}%`, height: "100%", background: barColor, borderRadius: "2px", transition: "width 0.4s" }} />
                    </div>
                  </div>
                )}

                {signals === 0 && (
                  <div style={{ marginTop: "8px", fontSize: "10px", color: "rgba(255,255,255,0.32)" }}>
                    No signals recorded yet, waiting for market conditions
                  </div>
                )}

                {perf && (
                  <div style={{ ...S.muted, marginTop: "8px" }}>
                    Last updated {timeAgo(perf.measured_at)}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* How recipes are scored */}
      <div style={S.card}>
        <div style={S.hdr}><span style={S.label}>How Performance Is Measured</span></div>
        <div style={{ padding: "20px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
          <div>
            <p style={{ ...S.muted, lineHeight: 1.7 }}>
              Each signal is logged to <code style={{ fontFamily: "var(--font-mono)", fontSize: "11px" }}>signals_history</code> at detection time.
              Win/loss is measured by checking if the price moved in the signal direction within the next 4 hours.
              A win is defined as a 0.5%+ favourable move. Performance is recalculated daily by the GitHub Actions scan.
            </p>
          </div>
          <div>
            <p style={{ ...S.muted, lineHeight: 1.7 }}>
              EV scores are computed per-signal using each wallet's historical win rate, average win/loss size,
              and estimated slippage from the L2 order book at signal time.
              Recipes with fewer than 10 historical signals show no EV score: insufficient data for a reliable estimate.
            </p>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}

export default function EdgePage() {
  return <EdgeInner />;
}
```

- [ ] **Step 2: Verify typecheck**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add app/edge/page.tsx
git commit -m "feat: add /edge page (renamed from Recipes)"
```

---

## Task 4: Redirect `/recipes` → `/edge`

**Files:**
- Modify: `app/recipes/page.tsx` (replace entire file)

- [ ] **Step 1: Replace recipes page with redirect**

Overwrite `app/recipes/page.tsx` with:

```typescript
// app/recipes/page.tsx — permanent redirect to /edge
import { redirect } from "next/navigation";

export default function RecipesRedirect() {
  redirect("/edge");
}
```

- [ ] **Step 2: Verify `/recipes` now redirects (dev server)**

```bash
npm run dev
```

Visit `http://localhost:3000/recipes` — should land on `/edge`.

- [ ] **Step 3: Commit**

```bash
git add app/recipes/page.tsx
git commit -m "feat: redirect /recipes → /edge"
```

---

## Task 5: Rewrite `app/signals/page.tsx` with tabs

**Files:**
- Modify: `app/signals/page.tsx` (full rewrite)

The new file has two tabs: `"feed"` (current content) and `"divergence"` (Imbalance content). Tab state is local `useState`. Each tab's data fetching is already separate — no changes to query logic.

- [ ] **Step 1: Rewrite `app/signals/page.tsx`**

```typescript
"use client";
// app/signals/page.tsx — Signals: live feed + divergence scanner.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { timeAgo, truncateAddress, formatPct } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { RECIPE_META } from "@/lib/recipe-meta";
import type { CohortCachePayload } from "@/app/api/refresh-cohort/route";
import { color, card as C, type as T, space } from "@/lib/design-tokens";

const S = {
  page:  { padding: space.pagePaddingX },
  card:  { ...C.base },
  hdr:   { ...C.header },
  label: { ...T.cardTitle },
  muted: { color: color.textMuted, fontSize: "13px" },
  mono:  { fontFamily: "'Geist Mono', monospace", fontSize: "13px" },
};

const SIGNAL_TYPE_COLORS: Record<string, string> = {
  ENTRY:    "#6aaa7a",
  EXIT:     "#b06868",
  SCALE_IN: "#60a5fa",
  SCALE_OUT:"#f59e0b",
  FLIP:     "#c084fc",
  ALERT:    "#9ca3af",
};

// ── Types ──────────────────────────────────────────────────────────────────────

interface ImbalanceData {
  ideas: Array<{
    coin: string;
    smart_direction: "LONG" | "SHORT";
    contrarian_direction: "LONG" | "SHORT";
    confidence: number;
    reason: string;
    trade_plan?: {
      entry_zone: string; stop_loss: string; take_profit: string;
      risk_reward: string; kelly_size: string; funding_rate: string;
    };
  }>;
  updated_at: string;
}

// ── Tab: Signal Feed ───────────────────────────────────────────────────────────

function SignalFeed({ data }: { data: CohortCachePayload }) {
  const [filterRecipe, setFilterRecipe] = useState<string>("all");
  const [filterDir,    setFilterDir]    = useState<string>("all");
  const [filterCoin,   setFilterCoin]   = useState<string>("");

  const signals = data.recent_signals.filter((s) => {
    if (filterRecipe !== "all" && s.recipe_id !== filterRecipe) return false;
    if (filterDir    !== "all" && s.direction  !== filterDir)   return false;
    if (filterCoin   && !s.coin.toLowerCase().includes(filterCoin.toLowerCase())) return false;
    return true;
  });

  const uniqueRecipes = [...new Set(data.recent_signals.map((s) => s.recipe_id))];

  return (
    <div style={{ ...S.page, paddingTop: "20px" }}>
      {/* Filters */}
      <div style={{ display: "flex", gap: "10px", marginBottom: "20px", flexWrap: "wrap" as const, alignItems: "center" }}>
        <select value={filterRecipe} onChange={(e) => setFilterRecipe(e.target.value)}
          style={{ background: "#141414", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "5px", color: "#f0f0f0", padding: "6px 10px", fontSize: "12px", outline: "none" }}>
          <option value="all">All Recipes</option>
          {uniqueRecipes.map((r) => <option key={r} value={r}>{RECIPE_META[r]?.label ?? r}</option>)}
        </select>

        <select value={filterDir} onChange={(e) => setFilterDir(e.target.value)}
          style={{ background: "#141414", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "5px", color: "#f0f0f0", padding: "6px 10px", fontSize: "12px", outline: "none" }}>
          <option value="all">All Directions</option>
          <option value="LONG">Long</option>
          <option value="SHORT">Short</option>
          <option value="FLAT">Flat</option>
        </select>

        <input value={filterCoin} onChange={(e) => setFilterCoin(e.target.value)}
          placeholder="Filter coin…"
          style={{ background: "#141414", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "5px", color: "#f0f0f0", padding: "6px 10px", fontSize: "12px", outline: "none", width: "120px" }} />

        <span style={S.muted}>{signals.length} results</span>
      </div>

      {/* Recipe legend */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px", marginBottom: "20px" }}>
        {Object.entries(RECIPE_META).map(([id, { label, desc }]) => (
          <button key={id} onClick={() => setFilterRecipe(filterRecipe === id ? "all" : id)}
            className="card-hover glow-btn"
            style={{ ...S.card, padding: "16px 18px", textAlign: "left" as const, cursor: "pointer",
              border: filterRecipe === id ? "1px solid rgba(255,255,255,0.26)" : "1px solid rgba(255,255,255,0.07)",
              background: filterRecipe === id ? "rgba(96,96,96,0.10)" : "#0f0f0f" }}>
            <div style={{ fontSize: "12px", fontWeight: 600, color: "#f0f0f0", marginBottom: "6px" }}>{label}</div>
            <div style={{ ...S.muted, lineHeight: 1.5 }}>{desc}</div>
          </button>
        ))}
      </div>

      {/* Signal list */}
      <div style={S.card}>
        {signals.length === 0 ? (
          <div style={{ padding: "48px", textAlign: "center", ...S.muted }}>
            No signals match your filters
          </div>
        ) : (
          signals.map((sig, i) => {
            const meta = RECIPE_META[sig.recipe_id];
            const typeColor = SIGNAL_TYPE_COLORS[sig.signal_type] ?? "#9ca3af";
            const dirColor = sig.direction === "LONG" ? "#6aaa7a" : sig.direction === "SHORT" ? "#b06868" : "#9ca3af";

            return (
              <div key={i} style={{
                padding: "14px 20px",
                borderBottom: "1px solid rgba(255,255,255,0.04)",
                display: "flex",
                alignItems: "flex-start",
                gap: "16px",
              }}>
                <div style={{
                  fontSize: "9px", fontWeight: 700, letterSpacing: "0.08em",
                  padding: "3px 7px", borderRadius: "4px", flexShrink: 0, marginTop: "2px",
                  background: `${typeColor}14`, color: typeColor, border: `1px solid ${typeColor}30`,
                }}>
                  {sig.signal_type}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" as const }}>
                    <span style={{ fontSize: "13px", fontWeight: 600, color: "#f0f0f0" }}>
                      {meta?.label ?? sig.recipe_id}
                    </span>
                    <span style={{ fontSize: "13px", fontWeight: 700, color: "#f0f0f0" }}>·</span>
                    <span style={{ fontSize: "13px", fontWeight: 700, color: dirColor }}>{sig.coin}</span>
                    {sig.direction && (
                      <span style={{ fontSize: "10px", fontWeight: 700, color: dirColor, letterSpacing: "0.08em" }}>
                        {sig.direction}
                      </span>
                    )}
                  </div>
                  <div style={{ ...S.muted, marginTop: "3px" }}>
                    {meta?.desc} · wallet {truncateAddress(sig.wallet_id ?? "")} · {timeAgo(sig.detected_at)}
                  </div>
                  {typeof sig.metadata?.description === "string" && (
                    <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.58)", marginTop: "4px" }}>
                      {sig.metadata.description}
                    </div>
                  )}
                </div>

                {sig.ev_score != null ? (
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontSize: "15px", fontWeight: 700, color: sig.ev_score > 0.6 ? "#6aaa7a" : sig.ev_score > 0.3 ? "#f59e0b" : "#9ca3af" }}>
                      {(sig.ev_score * 100).toFixed(0)}
                    </div>
                    <div style={S.muted}>EV</div>
                  </div>
                ) : (
                  <div style={{ ...S.muted, flexShrink: 0 }}>n/a</div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── Tab: Divergence ────────────────────────────────────────────────────────────

function DivergenceTab() {
  const { data, isLoading } = useQuery<ImbalanceData>({
    queryKey: ["contrarian"],
    queryFn:  () => fetch("/api/contrarian").then((r) => r.json()),
    refetchInterval: 60_000,
  });

  const [selected, setSelected] = useState<string | null>(null);

  if (isLoading || !data) return <div style={{ padding: "28px", ...S.muted }}>Computing divergences…</div>;

  const selectedIdea = data.ideas.find((i) => i.coin === selected);

  return (
    <div style={{ ...S.page, paddingTop: "20px" }}>
      <div style={{ display: "grid", gridTemplateColumns: selected ? "1fr 1fr" : "1fr", gap: "16px" }}>

        {/* Divergence list */}
        <div style={S.card}>
          <div style={S.hdr}>
            <span style={S.label}>Divergence Scanner</span>
            <span style={{ ...S.muted, marginLeft: "auto" }}>{data.ideas.length} divergences detected</span>
          </div>
          {data.ideas.length === 0 ? (
            <div style={{ padding: "48px", textAlign: "center", ...S.muted }}>
              No significant divergences at current threshold
            </div>
          ) : (
            data.ideas.map((idea) => {
              const isSelected = selected === idea.coin;
              const confColor = idea.confidence > 0.6 ? "#6aaa7a" : idea.confidence > 0.35 ? "#f59e0b" : "#9ca3af";
              return (
                <button key={idea.coin}
                  onClick={() => setSelected(isSelected ? null : idea.coin)}
                  style={{
                    width: "100%", textAlign: "left", padding: "16px 20px",
                    borderBottom: "1px solid rgba(255,255,255,0.04)",
                    background: isSelected ? "rgba(96,96,96,0.06)" : "transparent",
                    border: "none", cursor: "pointer", display: "block",
                  }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <span style={{ fontSize: "15px", fontWeight: 700, color: "#f0f0f0", minWidth: "60px" }}>{idea.coin}</span>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <span style={{ fontSize: "10px", fontWeight: 700, padding: "3px 7px", borderRadius: "4px",
                        background: idea.smart_direction === "LONG" ? "rgba(106,170,122,0.1)" : "rgba(176,104,104,0.1)",
                        color: idea.smart_direction === "LONG" ? "#6aaa7a" : "#b06868",
                        border: `1px solid ${idea.smart_direction === "LONG" ? "#6aaa7a30" : "#b0686830"}`,
                      }}>
                        SMART {idea.smart_direction}
                      </span>
                      <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.44)" }}>vs</span>
                      <span style={{ fontSize: "10px", fontWeight: 700, padding: "3px 7px", borderRadius: "4px",
                        background: "rgba(156,163,175,0.1)", color: "#9ca3af", border: "1px solid rgba(156,163,175,0.2)",
                      }}>
                        RETAIL {idea.smart_direction === "LONG" ? "SHORT" : "LONG"}
                      </span>
                    </div>
                    <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "8px" }}>
                      <div style={{ width: "40px", height: "3px", background: "rgba(255,255,255,0.08)", borderRadius: "2px" }}>
                        <div style={{ width: `${idea.confidence * 100}%`, height: "100%", background: confColor, borderRadius: "2px" }} />
                      </div>
                      <span style={{ fontSize: "11px", color: confColor, fontWeight: 600 }}>{formatPct(idea.confidence)}</span>
                    </div>
                  </div>
                  <div style={{ ...S.muted, marginTop: "6px" }}>{idea.reason}</div>
                </button>
              );
            })
          )}
        </div>

        {/* Trade Plan panel */}
        {selectedIdea && (
          <div style={S.card}>
            <div style={S.hdr}>
              <span style={S.label}>Smart Trade Plan: {selectedIdea.coin}</span>
              <span style={{ ...S.muted, marginLeft: "auto", fontSize: "9px" }}>Rule-based, not financial advice</span>
            </div>
            {selectedIdea.trade_plan ? (
              <div style={{ padding: "20px" }}>
                <div style={{ marginBottom: "20px", padding: "12px 16px", background: "rgba(96,96,96,0.06)", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.07)" }}>
                  <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.69)", lineHeight: 1.7 }}>
                    Following smart money <strong style={{ color: selectedIdea.smart_direction === "LONG" ? "#6aaa7a" : "#b06868" }}>{selectedIdea.smart_direction}</strong> on {selectedIdea.coin}.<br/>
                    {selectedIdea.reason}
                  </div>
                </div>

                {[
                  { label: "Entry Zone",    value: selectedIdea.trade_plan.entry_zone,   clr: "#f0f0f0" },
                  { label: "Stop Loss",     value: selectedIdea.trade_plan.stop_loss,    clr: "#b06868" },
                  { label: "Take Profit",   value: selectedIdea.trade_plan.take_profit,  clr: "#6aaa7a" },
                  { label: "Risk / Reward", value: selectedIdea.trade_plan.risk_reward,  clr: "#f0f0f0" },
                  { label: "Kelly Size",    value: selectedIdea.trade_plan.kelly_size,   clr: "#9ca3af" },
                  { label: "Funding Rate",  value: selectedIdea.trade_plan.funding_rate, clr: "#f59e0b" },
                ].map(({ label, value, clr }) => (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <span style={S.muted}>{label}</span>
                    <span style={{ fontSize: "13px", fontWeight: 600, color: clr }}>{value}</span>
                  </div>
                ))}

                <div style={{ marginTop: "16px", padding: "10px 12px", background: "rgba(176,104,104,0.06)", borderRadius: "5px", border: "1px solid rgba(176,104,104,0.15)" }}>
                  <p style={{ fontSize: "10px", color: "rgba(176,104,104,0.8)", lineHeight: 1.6 }}>
                    This plan is generated by a rule-based algorithm using ATR-derived levels, not by a human advisor or AI. Past performance does not predict future results. Always size positions according to your own risk tolerance.
                  </p>
                </div>
              </div>
            ) : (
              <div style={{ padding: "48px", textAlign: "center", ...S.muted }}>
                Trade plan loading…
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Page shell ─────────────────────────────────────────────────────────────────

function SignalsInner() {
  const [tab, setTab] = useState<"feed" | "divergence">("feed");

  const { data, isLoading } = useQuery<CohortCachePayload>({
    queryKey: ["cohort-state"],
    queryFn: () => fetch("/api/cohort-state").then((r) => r.json()),
    refetchInterval: 60_000,
  });

  const tabStyle = (active: boolean) => ({
    padding: "8px 18px",
    fontSize: "13px",
    fontWeight: 600,
    color: active ? "#f0f0f0" : "rgba(255,255,255,0.38)",
    background: active ? "rgba(255,255,255,0.06)" : "transparent",
    border: "none",
    borderRadius: "6px",
    cursor: "pointer",
    transition: "color 0.15s, background 0.15s",
  });

  return (
    <>
      <PageHeader
        title="Signals"
        subtitle="Smart Money activity and divergence scanner"
        regime={data?.regime}
      />
      {/* Tab bar */}
      <div style={{ padding: "16px 32px 0", display: "flex", gap: "4px" }}>
        <button style={tabStyle(tab === "feed")}       onClick={() => setTab("feed")}>Signal Feed</button>
        <button style={tabStyle(tab === "divergence")} onClick={() => setTab("divergence")}>Divergence</button>
      </div>

      {tab === "feed" ? (
        isLoading || !data
          ? <div style={{ padding: "28px", ...S.muted }}>Loading signals…</div>
          : <SignalFeed data={data} />
      ) : (
        <DivergenceTab />
      )}
    </>
  );
}

export default function SignalsPage() {
  return <SignalsInner />;
}
```

- [ ] **Step 2: Verify typecheck**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add app/signals/page.tsx
git commit -m "feat: add Divergence tab to Signals page (absorbs Imbalance)"
```

---

## Task 6: Delete `/imbalance`, update `/contrarian` redirect

**Files:**
- Delete: `app/imbalance/page.tsx`
- Modify: `app/contrarian/page.tsx`

- [ ] **Step 1: Convert `/imbalance` to a redirect (keep the file)**

Overwrite `app/imbalance/page.tsx` with a redirect instead of deleting (the product-overview promises legacy links work):

```typescript
// app/imbalance/page.tsx — permanent redirect to /signals
import { redirect } from "next/navigation";

export default function ImbalanceRedirect() {
  redirect("/signals");
}
```

- [ ] **Step 2: Update `/contrarian` redirect target**

Overwrite `app/contrarian/page.tsx`:

```typescript
// app/contrarian/page.tsx — permanent redirect to /signals
import { redirect } from "next/navigation";

export default function ContrarianRedirect() {
  redirect("/signals");
}
```

- [ ] **Step 3: Verify typecheck**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add app/contrarian/page.tsx app/imbalance/page.tsx
git commit -m "feat: redirect /imbalance and /contrarian → /signals"
```

---

## Task 7: Update navigation

**Files:**
- Modify: `components/nav.tsx` (lines 12–19)

- [ ] **Step 1: Update `NAV_ITEMS` array**

Replace the `NAV_ITEMS` constant:

```typescript
const NAV_ITEMS = [
  { href: "/",        label: "Overview"    },
  { href: "/morning", label: "Daily Brief" },
  { href: "/wallets", label: "Wallets"     },
  { href: "/signals", label: "Signals"     },
  { href: "/edge",    label: "Edge"        },
] as const;
```

- [ ] **Step 2: Verify dev server — check nav renders correctly**

```bash
npm run dev
```

Open `http://localhost:3000` and verify: nav shows Overview, Daily Brief, Wallets, Signals, Edge. No Imbalance. No Recipes.

- [ ] **Step 3: Commit**

```bash
git add components/nav.tsx
git commit -m "feat: update nav — remove Imbalance, rename Recipes to Edge"
```

---

## Task 8: Update `docs/product-overview.md`

**Files:**
- Modify: `docs/product-overview.md`

- [ ] **Step 1: Update the "What It Does" list (step 3 wording)**

Change step 3 from:
```
3. Runs nine signal recipes against each snapshot delta
```
to:
```
3. Runs nine signal detectors against each snapshot delta
```

- [ ] **Step 2: Update the Signals section**

Replace the current `### Signals` section with:

```markdown
### Signals

The central intelligence page. Two tabs.

**Signal Feed** — live feed of events from the last scan cycle. Each event was generated by one of nine signal detectors running against the latest position snapshot delta.

Columns: signal type, recipe name, coin, direction (LONG/SHORT), EV score, timestamp.

Signals can be filtered by recipe, direction, and coin.

**Divergence** — Smart Money vs. Retail positioning scanner. For each coin where a significant divergence is detected:

- Smart money direction vs. retail direction
- Confidence score (0–100%)
- Reason string explaining the divergence
- Click any row to expand the **Smart Trade Plan**

**Smart Trade Plan** uses ATR-derived levels to show:

- Entry zone
- Stop loss
- Take profit
- Risk/reward ratio
- Kelly-suggested position size
- Current funding rate

This plan is rule-based and not financial advice. It is a starting point, not a recommendation.

Legacy `/imbalance` and `/contrarian` links redirect here automatically.

**EV Score** is normalized to [0, 1] using:

```
EV = (WinRate × AvgWin) − (LossRate × AvgLoss) − TradeCost
```

Scores above 0.6 are considered actionable.
```

- [ ] **Step 3: Remove the standalone `### Imbalance` section entirely**

Delete the `### Imbalance` heading and all content beneath it (up to the next `---`).

- [ ] **Step 4: Update the `### Recipes` section — rename to `### Edge`**

Change heading from `### Recipes` to `### Edge` and update the first paragraph:

```markdown
### Edge

Reference page showing performance analytics for all nine signal detectors. Each entry shows:

- Signal name and description
- Historical win rate (from backtest)
- Average EV score
- Signal count

Backtest data is derived from closing fills only — unrealized PnL is never counted.
```

Remove the nine-recipe table from this section — it belongs in the architecture docs, not the UI overview. The product overview should describe what the user sees, not the underlying logic.

- [ ] **Step 5: Commit**

```bash
git add docs/product-overview.md
git commit -m "docs: update product-overview — rename Recipes→Edge, merge Imbalance into Signals"
```

---

## Task 9: Update `SETUP.md`

**Files:**
- Modify: `SETUP.md`

- [ ] **Step 1: Update the Dashboard Pages table**

Replace the existing table with:

```markdown
| URL           | Description                                          |
|---------------|------------------------------------------------------|
| `/`           | Overview: regime, cohort health, top signals         |
| `/morning`    | Daily Brief: morning alpha narrative, daily snapshot |
| `/wallets`    | Wallets: leaderboard, discovery, wallet lookup       |
| `/signals`    | Signals: live feed (Signal Feed tab) + divergence scanner (Divergence tab) |
| `/edge`       | Edge: signal recipe performance stats                |
| `/scanner`    | Scanner: discovery pipeline status, top candidates   |
| `/deep-dive`  | Deep Dive: single token candles, funding, OI         |
```

Remove `/contrarian`, `/stalker`, `/imbalance`, and `/recipes` from the table (they are either redirects or absorbed).

- [ ] **Step 2: Commit**

```bash
git add SETUP.md
git commit -m "docs: update SETUP.md dashboard pages table"
```

---

## Task 10: Update `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the API Routes table**

In the API Routes section, confirm `/api/contrarian` description reflects its purpose:

Change description if it says "contrarian page" to:
> `contrarian` — Powers the Divergence tab in `/signals`; reads KV, fires background refresh if stale

- [ ] **Step 2: Update any mention of "recipe" pages in UI Conventions or architecture sections**

Search for mentions of "Recipes" or "Imbalance" as page names and update to "Edge" and "Signals" respectively.

- [ ] **Step 3: Update the Pages listing in Architecture section (if present)**

If CLAUDE.md has a list of pages, update it to match the new nav: Overview, Daily Brief, Wallets, Signals (with Divergence tab), Edge, Scanner, Deep Dive.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md — reflect Signals/Edge rename"
```

---

## Task 11: Run `/init` and copy consistency audit

- [ ] **Step 1: Run Claude Code `/init`**

In the Claude Code session, run:
```
/init
```

This re-reads the project and rebuilds Claude's understanding of the codebase. It will pick up all the renamed files and updated docs.

- [ ] **Step 2: Copy consistency audit — page titles and subtitles**

Check every `PageHeader` call across all pages. Verify title/subtitle are consistent with the nav label and the product-overview description:

```bash
grep -r "PageHeader" app/ --include="*.tsx" -A 3
```

Expected consistent set:
| Page | title | subtitle |
|------|-------|----------|
| `/` | `Overview` | (none or regime) |
| `/morning` | `Daily Brief` | matches nav label |
| `/wallets` | `Wallets` | matches nav label |
| `/signals` | `Signals` | `"Smart Money activity and divergence scanner"` |
| `/edge` | `Edge` | `"Signal recipe performance"` |
| `/scanner` | `Scanner` | matches |

Fix any title/subtitle that doesn't align with the nav label or product-overview copy.

- [ ] **Step 3: Copy consistency audit — loading states**

Check all loading placeholder strings:

```bash
grep -r "Loading\|loading\|Computing" app/ --include="*.tsx"
```

Make sure loading strings match their section. In the new Signals page:
- Signal Feed loading: `"Loading signals…"`
- Divergence loading: `"Computing divergences…"`
- Edge loading: `"Loading performance data…"`

Fix anything that says "Loading recipe analytics…" or "Computing imbalances…" if it's visible in the new page context.

- [ ] **Step 4: Copy consistency audit — card headers**

In the Divergence tab, the card header was renamed from "Imbalance Scanner" to "Divergence Scanner" in Task 5's code. Verify this is present in the final file.

- [ ] **Step 5: Final typecheck and lint**

```bash
npm run typecheck && npm run lint
```

Expected: no errors or warnings

- [ ] **Step 6: Commit any copy fixes**

```bash
git add -p
git commit -m "fix: copy consistency audit — titles, subtitles, loading states"
```

---

## Task 12: Final smoke test

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

- [ ] **Step 2: Walk through all routes**

| Route | Expected |
|-------|---------|
| `/` | Overview loads, RECIPE_META labels display correctly in signal feed |
| `/signals` | Loads with two tabs; Signal Feed tab works, Divergence tab works |
| `/signals` Divergence tab | Click a coin → trade plan panel opens |
| `/edge` | Loads with title "Edge", all 9 recipes shown |
| `/recipes` | Redirects to `/edge` |
| `/imbalance` | Redirects to `/signals` |
| `/contrarian` | Redirects to `/signals` |
| Nav | Shows: Overview, Daily Brief, Wallets, Signals, Edge — no Imbalance, no Recipes |

- [ ] **Step 3: Final commit if clean**

If no issues found, create a summary commit:

```bash
git commit --allow-empty -m "chore: signals/edge unification complete — smoke test passed"
```
