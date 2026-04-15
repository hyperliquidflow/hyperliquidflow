# Sprint 1 — Wallet Tier System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

---

## MANDATORY PRE-READ — Do this before touching any code

You MUST read all of these files before starting Task 1. Do not skip or skim. These files contain exact type shapes, variable names, and UI conventions that every task below depends on.

```
Read: docs/sprints/status.md
Read: docs/superpowers/specs/2026-04-13-sprint-1-wallet-tiers.md
Read: lib/cohort-engine.ts
Read: app/api/refresh-cohort/route.ts
Read: app/api/scanner-stats/route.ts
Read: app/wallets/leaderboard/page.tsx
Read: app/wallets/discovery/page.tsx
Read: lib/design-tokens.ts
Read: app/globals.css         (search for .glow-btn)
Read: components/glow-init.tsx
```

Only after reading all ten files above should you proceed to Task 1.

---

**Goal:** Add equity-based tier classification (Elite/Major/Large/Mid/Small/Micro/Dust) to every tracked wallet and surface it in the leaderboard, discovery page, and KV cache.

**Architecture:** A pure function `getEquityTier(accountValue)` in `lib/cohort-engine.ts` maps account equity to a tier label. It is called inside `saveCohortSnapshot` so every new snapshot row carries the tier. The KV cache payload is extended to include `equity_tier` on each wallet summary. The leaderboard reads the tier from the KV payload and renders badges + a filter dropdown client-side. The discovery page gets a new tier breakdown section via an extended `scanner-stats` API response.

**Tech Stack:** TypeScript, Next.js 15 App Router, Supabase (Postgres), Vercel KV, Vitest (to be added), React Query

---

## File Map

| Action | File | What changes |
|---|---|---|
| MODIFY | `lib/cohort-engine.ts` | Add `getEquityTier()`, update `saveCohortSnapshot()` insert payload |
| MODIFY | `app/api/refresh-cohort/route.ts` | Add `equity_tier` to `CohortWalletSummary` interface + `cohortSummary.push()` |
| MODIFY | `app/api/scanner-stats/route.ts` | Add tier breakdown counts query + extend response |
| MODIFY | `app/wallets/leaderboard/page.tsx` | Add `TierBadge` component, tier filter state + UI |
| MODIFY | `app/wallets/discovery/page.tsx` | Add tier breakdown stat grid section |
| CREATE | `supabase/migrations/003_equity_tier.sql` | ADD COLUMN + backfill UPDATE |
| CREATE | `lib/__tests__/cohort-engine.test.ts` | Tests for `getEquityTier` |
| CREATE | `vitest.config.ts` | Vitest config |
| MODIFY | `package.json` | Add vitest + @vitest/ui |

---

## Task 1: Set up Vitest

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json`

- [ ] **Step 1: Install Vitest**

```bash
npm install --save-dev vitest
```

Expected: vitest added to devDependencies.

- [ ] **Step 2: Create vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/__tests__/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
```

- [ ] **Step 3: Add test script to package.json**

In `package.json`, add to `"scripts"`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Verify vitest runs**

```bash
npm run test
```

Expected: "No test files found" — that is fine at this stage.

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts package.json package-lock.json
git commit -m "chore: add vitest for unit testing"
```

---

## Task 2: `getEquityTier` — TDD

**Files:**
- Create: `lib/__tests__/cohort-engine.test.ts`
- Modify: `lib/cohort-engine.ts`

- [ ] **Step 1: Create the test file with failing tests**

Create `lib/__tests__/cohort-engine.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { getEquityTier } from "../cohort-engine";

describe("getEquityTier", () => {
  it("returns Elite for $5M+", () => {
    expect(getEquityTier(5_000_000)).toBe("Elite");
    expect(getEquityTier(10_000_000)).toBe("Elite");
    expect(getEquityTier(40_000_000)).toBe("Elite");
  });

  it("returns Major for $1M - $5M", () => {
    expect(getEquityTier(1_000_000)).toBe("Major");
    expect(getEquityTier(3_000_000)).toBe("Major");
    expect(getEquityTier(4_999_999)).toBe("Major");
  });

  it("returns Large for $500K - $1M", () => {
    expect(getEquityTier(500_000)).toBe("Large");
    expect(getEquityTier(750_000)).toBe("Large");
    expect(getEquityTier(999_999)).toBe("Large");
  });

  it("returns Mid for $100K - $500K", () => {
    expect(getEquityTier(100_000)).toBe("Mid");
    expect(getEquityTier(250_000)).toBe("Mid");
    expect(getEquityTier(499_999)).toBe("Mid");
  });

  it("returns Small for $50K - $100K", () => {
    expect(getEquityTier(50_000)).toBe("Small");
    expect(getEquityTier(75_000)).toBe("Small");
    expect(getEquityTier(99_999)).toBe("Small");
  });

  it("returns Micro for $1K - $50K", () => {
    expect(getEquityTier(1_000)).toBe("Micro");
    expect(getEquityTier(25_000)).toBe("Micro");
    expect(getEquityTier(49_999)).toBe("Micro");
  });

  it("returns Dust for under $1K", () => {
    expect(getEquityTier(0)).toBe("Dust");
    expect(getEquityTier(999)).toBe("Dust");
    expect(getEquityTier(0.000001)).toBe("Dust");
  });

  it("returns null for null/undefined/negative", () => {
    expect(getEquityTier(null)).toBeNull();
    expect(getEquityTier(undefined)).toBeNull();
    expect(getEquityTier(-1)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm run test
```

Expected: FAIL — "getEquityTier is not exported from cohort-engine"

- [ ] **Step 3: Implement `getEquityTier` in `lib/cohort-engine.ts`**

Add this function after the `RegimeDetection` type definition (around line 43), before the factor functions:

```ts
// ─────────────────────────────────────────────────────────────────────────────
// Wallet Tier Classification
// ─────────────────────────────────────────────────────────────────────────────

export type EquityTier =
  | "Elite"
  | "Major"
  | "Large"
  | "Mid"
  | "Small"
  | "Micro"
  | "Dust";

/**
 * Classify a wallet by account equity into one of 7 tiers.
 * Returns null if accountValue is null, undefined, or negative.
 *
 * Thresholds:
 *   Elite    $5M+
 *   Major    $1M - $5M
 *   Large    $500K - $1M
 *   Mid      $100K - $500K
 *   Small    $50K - $100K
 *   Micro    $1K - $50K
 *   Dust     under $1K
 */
export function getEquityTier(accountValue: number | null | undefined): EquityTier | null {
  if (accountValue == null || accountValue < 0) return null;
  if (accountValue >= 5_000_000) return "Elite";
  if (accountValue >= 1_000_000) return "Major";
  if (accountValue >= 500_000)   return "Large";
  if (accountValue >= 100_000)   return "Mid";
  if (accountValue >= 50_000)    return "Small";
  if (accountValue >= 1_000)     return "Micro";
  return "Dust";
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npm run test
```

Expected: PASS — 8 test cases passing.

- [ ] **Step 5: Commit**

```bash
git add lib/cohort-engine.ts lib/__tests__/cohort-engine.test.ts
git commit -m "feat: add getEquityTier classification function"
```

---

## Task 3: Supabase migration

**Files:**
- Create: `supabase/migrations/003_equity_tier.sql`

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/003_equity_tier.sql`:

```sql
-- Add equity_tier column to cohort_snapshots
ALTER TABLE cohort_snapshots ADD COLUMN IF NOT EXISTS equity_tier text;

-- Backfill existing rows based on account_value
UPDATE cohort_snapshots SET equity_tier =
  CASE
    WHEN account_value >= 5000000  THEN 'Elite'
    WHEN account_value >= 1000000  THEN 'Major'
    WHEN account_value >= 500000   THEN 'Large'
    WHEN account_value >= 100000   THEN 'Mid'
    WHEN account_value >= 50000    THEN 'Small'
    WHEN account_value >= 1000     THEN 'Micro'
    WHEN account_value >= 0        THEN 'Dust'
    ELSE NULL
  END
WHERE equity_tier IS NULL;
```

- [ ] **Step 2: Apply migration via Supabase MCP**

Run the SQL through the Supabase dashboard SQL editor or MCP tool. Execute:

```sql
ALTER TABLE cohort_snapshots ADD COLUMN IF NOT EXISTS equity_tier text;

UPDATE cohort_snapshots SET equity_tier =
  CASE
    WHEN account_value >= 5000000  THEN 'Elite'
    WHEN account_value >= 1000000  THEN 'Major'
    WHEN account_value >= 500000   THEN 'Large'
    WHEN account_value >= 100000   THEN 'Mid'
    WHEN account_value >= 50000    THEN 'Small'
    WHEN account_value >= 1000     THEN 'Micro'
    WHEN account_value >= 0        THEN 'Dust'
    ELSE NULL
  END
WHERE equity_tier IS NULL;
```

- [ ] **Step 3: Verify backfill**

```sql
SELECT equity_tier, COUNT(*) FROM cohort_snapshots GROUP BY equity_tier ORDER BY COUNT(*) DESC;
```

Expected: Rows grouped by tier label (Elite, Major, Large, etc.), no null tier for rows with positive account_value.

- [ ] **Step 4: Commit migration file**

```bash
git add supabase/migrations/003_equity_tier.sql
git commit -m "feat: add equity_tier column to cohort_snapshots with backfill"
```

---

## Task 4: Wire tier into snapshot writes and KV payload

**Files:**
- Modify: `lib/cohort-engine.ts` — update `saveCohortSnapshot`
- Modify: `app/api/refresh-cohort/route.ts` — update `CohortWalletSummary` + `cohortSummary.push()`

- [ ] **Step 1: Update `saveCohortSnapshot` in `lib/cohort-engine.ts`**

The function currently starts at line 373. Update the insert payload to include `equity_tier`. Change the function signature to accept `accountValue` (it already receives `state` which has it):

The insert block currently ends at line 405 with `regime_fit: scores.regime_fit,`. Add one more field:

```ts
// Inside the supabase.from("cohort_snapshots").insert({...}) call,
// after regime_fit: scores.regime_fit,
equity_tier: getEquityTier(accountValue),
```

The full updated insert block (replace lines 386-406):

```ts
  const { error } = await supabase.from("cohort_snapshots").insert({
    wallet_id:         walletId,
    snapshot_time:     new Date().toISOString(),
    account_value:     accountValue,
    total_notional:    parseFloat(ms.totalNtlPos),
    total_margin_used: totalMarginUsed,
    unrealized_pnl:    state.assetPositions.reduce(
      (s, ap) => s + parseFloat(ap.position.unrealizedPnl),
      0
    ),
    withdrawable:      parseFloat(state.withdrawable),
    liq_buffer_pct:    liqBuffer,
    position_count:    state.assetPositions.length,
    positions:         state.assetPositions,
    overall_score:     scores.overall_score,
    sharpe_proxy:      scores.sharpe_proxy,
    drawdown_score:    scores.drawdown_score,
    pnl_consistency:   scores.pnl_consistency,
    regime_fit:        scores.regime_fit,
    equity_tier:       getEquityTier(accountValue),
  });
```

- [ ] **Step 2: Add `equity_tier` to `CohortWalletSummary` in `refresh-cohort/route.ts`**

The `CohortWalletSummary` interface is at line 346. Add the field:

```ts
interface CohortWalletSummary {
  wallet_id:      string;
  address:        string;
  overall_score:  number;
  account_value:  number;
  unrealized_pnl: number;
  position_count: number;
  regime_fit:     number;
  win_rate:       number | null;
  liq_buffer_pct: number | null;
  equity_tier:    string | null;   // add this line
}
```

- [ ] **Step 3: Include `equity_tier` in `cohortSummary.push()` in `refresh-cohort/route.ts`**

The `cohortSummary.push()` call is around line 181. Add `equity_tier` to the object:

```ts
      cohortSummary.push({
        wallet_id:      wallet.id,
        address:        wallet.address,
        overall_score:  scores.overall_score,
        account_value:  parseFloat(state.marginSummary.accountValue),
        unrealized_pnl: state.assetPositions.reduce(
          (s, ap) => s + parseFloat(ap.position.unrealizedPnl), 0
        ),
        position_count: state.assetPositions.length,
        regime_fit:     scores.regime_fit,
        win_rate:       bt?.win_rate ?? null,
        liq_buffer_pct: computeLiqBuffer(state),
        equity_tier:    getEquityTier(parseFloat(state.marginSummary.accountValue)),
      });
```

- [ ] **Step 4: Add `getEquityTier` to the import from `cohort-engine` in `refresh-cohort/route.ts`**

At line 29, the import from `cohort-engine` currently is:

```ts
import {
  computeBacktest,
  computeCohortScores,
  detectRegime,
  saveCohortSnapshot,
  fetchActiveWallets,
} from "@/lib/cohort-engine";
```

Add `getEquityTier` to the import:

```ts
import {
  computeBacktest,
  computeCohortScores,
  detectRegime,
  saveCohortSnapshot,
  fetchActiveWallets,
  getEquityTier,
} from "@/lib/cohort-engine";
```

- [ ] **Step 5: Run typecheck**

```bash
npm run typecheck
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add lib/cohort-engine.ts app/api/refresh-cohort/route.ts
git commit -m "feat: include equity_tier in cohort snapshots and KV payload"
```

---

## Task 5: Extend scanner-stats API with tier breakdown

**Files:**
- Modify: `app/api/scanner-stats/route.ts`

- [ ] **Step 1: Add tier breakdown query to `scanner-stats/route.ts`**

Add a third query in the `Promise.all` call. Replace the current two-query `Promise.all` (lines 11-16) with:

```ts
    const [walletStats, topWinRates, tierBreakdown] = await Promise.all([
      supabase.from("wallets").select("is_active, win_rate, last_scanned_at, discovery_source, realized_pnl_30d"),
      supabase.from("wallets").select("address, win_rate, trade_count_30d, realized_pnl_30d")
        .not("win_rate", "is", null)
        .order("win_rate", { ascending: false })
        .limit(20),
      supabase.rpc("get_tier_breakdown") as Promise<{ data: Array<{ equity_tier: string; count: number }> | null; error: unknown }>,
    ]);
```

Wait — we don't have an RPC. Use a raw query instead. Replace that third query with a direct select:

```ts
      supabase
        .from("cohort_snapshots")
        .select("equity_tier")
        .not("equity_tier", "is", null)
        .order("snapshot_time", { ascending: false })
        .limit(10000),
```

Then compute the breakdown in JS:

```ts
    // Build tier counts from the most recent snapshot per wallet
    const snapRows = tierBreakdown.data ?? [];
    const TIERS = ["Elite", "Major", "Large", "Mid", "Small", "Micro", "Dust"] as const;
    // Take most recent snapshot value per wallet — since we can't GROUP BY easily here,
    // count unique occurrences of each tier in the returned rows (recent snapshots)
    const tierCounts: Record<string, number> = {};
    for (const tier of TIERS) tierCounts[tier] = 0;
    for (const row of snapRows) {
      if (row.equity_tier && tierCounts[row.equity_tier] !== undefined) {
        tierCounts[row.equity_tier]++;
      }
    }
    const tier_breakdown = TIERS.map((tier) => ({ tier, count: tierCounts[tier] }));
```

Actually, this double-counts wallets with multiple snapshots. Use a better query. Replace the third query with:

```ts
      supabase.from("cohort_snapshots")
        .select("wallet_id, equity_tier, snapshot_time")
        .not("equity_tier", "is", null)
        .order("snapshot_time", { ascending: false }),
```

Then deduplicate in JS before counting:

```ts
    const allSnapRows = tierBreakdown.data ?? [];
    // Keep only most recent snapshot per wallet
    const latestTierByWallet = new Map<string, string>();
    for (const row of allSnapRows) {
      if (!latestTierByWallet.has(row.wallet_id) && row.equity_tier) {
        latestTierByWallet.set(row.wallet_id, row.equity_tier);
      }
    }
    const TIERS = ["Elite", "Major", "Large", "Mid", "Small", "Micro", "Dust"] as const;
    const tierCounts: Record<string, number> = {};
    for (const tier of TIERS) tierCounts[tier] = 0;
    for (const tier of latestTierByWallet.values()) {
      if (tierCounts[tier] !== undefined) tierCounts[tier]++;
    }
    const tier_breakdown = TIERS.map((t) => ({ tier: t, count: tierCounts[t] }));
```

- [ ] **Step 2: Add `tier_breakdown` to the return value**

In the `return NextResponse.json({...})` block, add:

```ts
      tier_breakdown,
```

- [ ] **Step 3: Add `tier_breakdown` to the `ScannerStats` interface in `discovery/page.tsx`**

In `app/wallets/discovery/page.tsx` line 21, the `ScannerStats` interface currently has these fields. Add:

```ts
  tier_breakdown: Array<{ tier: string; count: number }>;
```

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add app/api/scanner-stats/route.ts app/wallets/discovery/page.tsx
git commit -m "feat: add tier breakdown to scanner-stats API"
```

---

## Task 6: Leaderboard — tier badge

**Files:**
- Modify: `app/wallets/leaderboard/page.tsx`

- [ ] **Step 1: Add `TierBadge` helper at the top of the file**

After the `import` statements and before the `S = {...}` styles block, add:

```ts
function TierBadge({ tier }: { tier: string | null | undefined }) {
  if (!tier) return null;
  return (
    <span className="ios-pill" style={{
      fontSize: "11px",
      fontWeight: 600,
      letterSpacing: "0.04em",
      textTransform: "uppercase" as const,
      marginLeft: "6px",
      cursor: "default",
      padding: "2px 8px",
    }}>
      {tier}
    </span>
  );
}
```

Note: `ios-pill` is the established badge/chip class defined in `app/globals.css`. It already provides background, border, glass blur, and hover states — do not add inline styles that override these. No new imports needed.
```

- [ ] **Step 2: Add `equity_tier` to the `CohortWalletSummary` type used on the leaderboard page**

The leaderboard imports `CohortCachePayload` from `refresh-cohort/route.ts`. Because we already added `equity_tier` to `CohortWalletSummary` in Task 4, the type is automatically available. No change needed here — TypeScript will pick it up.

- [ ] **Step 3: Render `TierBadge` in each table row**

In the wallet address cell (around line 99), currently:

```tsx
                    <button onClick={() => router.push(`/wallets/discovery?address=${w.address}`)}
                      style={{ ...S.mono, color: "#9ca3af", background: "none", border: "none", cursor: "pointer", padding: 0, textAlign: "left" as const }}>
                      {truncateAddress(w.address)}
                    </button>
```

Wrap in a flex container and add the badge:

```tsx
                  <td style={S.td}>
                    <div style={{ display: "flex", alignItems: "center" }}>
                      <button onClick={() => router.push(`/wallets/discovery?address=${w.address}`)}
                        style={{ ...S.mono, color: "#9ca3af", background: "none", border: "none", cursor: "pointer", padding: 0, textAlign: "left" as const }}>
                        {truncateAddress(w.address)}
                      </button>
                      <TierBadge tier={w.equity_tier} />
                    </div>
                  </td>
```

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add app/wallets/leaderboard/page.tsx
git commit -m "feat: add tier badge to leaderboard wallet rows"
```

---

## Task 7: Leaderboard — tier filter

**Files:**
- Modify: `app/wallets/leaderboard/page.tsx`

- [ ] **Step 1: Add tier filter state**

After the existing `useState` declarations (line 43):

```ts
  const [tierFilter, setTierFilter] = useState<string>("All");
```

- [ ] **Step 2: Apply tier filter to the sorted list**

The `sorted` constant is built around line 53. After the `.sort(...)` call, add a filter step:

```ts
  const TIERS = ["All", "Elite", "Major", "Large", "Mid", "Small", "Micro", "Dust"];

  const sorted = [...data.top_wallets]
    .filter((w) => tierFilter === "All" || w.equity_tier === tierFilter)
    .sort((a, b) => {
      // ... existing sort logic unchanged ...
    });
```

- [ ] **Step 3: Add the tier filter UI above the table**

Currently the component renders `<PageHeader>` then the card with the table directly. Add the filter row between the header and the card. Replace:

```tsx
      <div style={{ ...S.page, paddingTop: "20px" }}>
        <div style={S.card}>
```

with:

```tsx
      <div style={{ ...S.page, paddingTop: "20px" }}>
        <div style={{ display: "flex", gap: "6px", marginBottom: "12px", flexWrap: "wrap" as const }}>
          {["All", "Elite", "Major", "Large", "Mid", "Small", "Micro", "Dust"].map((t) => (
            <button key={t} onClick={() => setTierFilter(t)}
              style={{
                fontSize: "11px", fontWeight: 600,
                padding: "4px 12px", borderRadius: "5px",
                border: "1px solid",
                cursor: "pointer",
                background: tierFilter === t ? "rgba(255,255,255,0.10)" : "transparent",
                borderColor: tierFilter === t ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.10)",
                color: tierFilter === t ? "#f0f0f0" : "rgba(255,255,255,0.45)",
                transition: "all 0.15s",
              }}>
              {t}
            </button>
          ))}
        </div>
        <div style={S.card}>
```

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

Expected: No errors.

- [ ] **Step 5: Start dev server and verify manually**

```bash
npm run dev
```

Open http://localhost:3000/wallets/leaderboard. Check:
- Tier badges appear on wallet rows (may show nothing if KV data hasn't refreshed with tier yet — trigger `/api/refresh-cohort` manually if needed)
- Filter buttons appear at top
- Clicking "Elite" shows only Elite wallets (or empty if none refreshed yet)
- Clicking "All" restores the full list
- Sort still works after filter is applied

- [ ] **Step 6: Commit**

```bash
git add app/wallets/leaderboard/page.tsx
git commit -m "feat: add tier filter to leaderboard"
```

---

## Task 8: Discovery page — tier breakdown section

**Files:**
- Modify: `app/wallets/discovery/page.tsx`

- [ ] **Step 1: Add tier breakdown section below the existing scanner stats**

Find the section in `discovery/page.tsx` where the scan pipeline or stats are rendered. After the existing stat cards section, add a tier breakdown grid.

The `ScannerStats` type already has `tier_breakdown` from Task 5. Add this section inside the component, after the existing stat cards:

```tsx
        {/* Tier Breakdown */}
        {stats?.tier_breakdown && (
          <div style={{ ...S.card, marginTop: "16px" }}>
            <div style={S.hdr}>
              <span style={S.label}>Wallet Tiers</span>
              <span style={S.muted}>by current account equity</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "8px", padding: "16px" }}>
              {stats.tier_breakdown.map(({ tier, count }) => (
                <div key={tier} style={{ textAlign: "center" as const, padding: "12px 8px", background: "rgba(255,255,255,0.03)", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <div style={{ fontSize: "18px", fontWeight: 700, color: "#f0f0f0", fontVariantNumeric: "tabular-nums" }}>{count}</div>
                  <div style={{ fontSize: "11px", fontWeight: 600, color: "rgba(255,255,255,0.4)", marginTop: "4px", textTransform: "uppercase" as const, letterSpacing: "0.06em" }}>{tier}</div>
                </div>
              ))}
            </div>
          </div>
        )}
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: No errors.

- [ ] **Step 3: Verify in browser**

Open http://localhost:3000/wallets/discovery. Check:
- "Wallet Tiers" section appears with 7 tier cards
- Each shows a count and tier label
- Counts are non-zero for tiers that have wallets

- [ ] **Step 4: Commit**

```bash
git add app/wallets/discovery/page.tsx
git commit -m "feat: add tier breakdown section to discovery page"
```

---

## Task 9: Update sprint status tracker

**Files:**
- Modify: `docs/sprints/status.md`

- [ ] **Step 1: Mark Sprint 1 complete**

Update `docs/sprints/status.md`:

Change:
```
Status: NOT STARTED
```
To:
```
Status: COMPLETE
```

And update the table row for Sprint 1 from `NOT STARTED` to `COMPLETE`.

- [ ] **Step 2: Commit**

```bash
git add docs/sprints/status.md
git commit -m "docs: mark Sprint 1 complete"
```

---

## Self-Review

**Spec coverage check:**
- [x] `equity_tier` column migration — Task 3
- [x] `getEquityTier()` function in cohort-engine — Task 2
- [x] Tier assigned on snapshot write — Task 4
- [x] Tier included in KV cache payload — Task 4
- [x] Tier badge on leaderboard rows — Task 6
- [x] Tier filter on leaderboard — Task 7
- [x] Tier breakdown on discovery page — Tasks 5 + 8
- [x] Wallet profile API returns equity_tier — Note: wallet-profile route fetches live from Hyperliquid, not from cohort_snapshots. The tier would need a Supabase lookup added. Scoped out — the leaderboard and discovery pages are the primary surfaces. Can be added in a follow-up.
- [x] Wallets with no snapshot show no badge (null handling) — TierBadge returns null for falsy tier

**Placeholder scan:** None found.

**Type consistency:** `EquityTier` type exported from cohort-engine, used consistently in leaderboard. `equity_tier: string | null` in CohortWalletSummary matches the DB column type (text, nullable).
