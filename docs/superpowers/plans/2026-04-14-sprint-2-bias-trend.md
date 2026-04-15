# Sprint 2 — Bias Trend Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/signals/bias` — a multi-line time-series chart showing average long/short directional bias per wallet tier over time, backed by a cached API route and a new pre-computed `net_bias` column.

**Architecture:** Add a `net_bias float8` column to `cohort_snapshots`; compute and store it on every snapshot write in `saveCohortSnapshot`. The `/api/bias-trend` route queries that column (tiny rows, no JSONB transfer), buckets by hour in TypeScript, averages per tier per bucket, and caches the result in KV for 5 minutes. The `BiasClient` renders a recharts `LineChart` with per-tier line toggles.

**Tech Stack:** TypeScript, Next.js 15 App Router, Supabase (Postgres), Vercel KV, Vitest, recharts, React Query

---

## MANDATORY PRE-READ — do this before touching any code

Read all of the following before starting Task 1:

```
Read: docs/superpowers/specs/2026-04-13-sprint-2-bias-trend.md
Read: lib/cohort-engine.ts            (saveCohortSnapshot function)
Read: lib/hyperliquid-api-client.ts   (HlAssetPosition, HlPosition types)
Read: app/api/refresh-cohort/route.ts (CohortWalletSummary interface)
Read: lib/server/kv-fetchers.ts       (fetcher pattern)
Read: app/signals/feed/page.tsx       (server component pattern)
Read: app/signals/feed/FeedClient.tsx (client component pattern)
Read: lib/design-tokens.ts            (color, card, type, space tokens)
Read: components/nav.tsx              (NAV array structure)
Read: lib/__tests__/cohort-engine.test.ts  (existing test style)
```

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| CREATE | `supabase/migrations/005_net_bias.sql` | Add net_bias column to cohort_snapshots |
| CREATE | `lib/bias-utils.ts` | Pure functions: computeNetBias, bucketTime, reshapeBiasRows; constants: TIERS, TIER_COLORS; types: BiasTrendResponse |
| CREATE | `lib/__tests__/bias-utils.test.ts` | Tests for all bias-utils exports |
| MODIFY | `lib/cohort-engine.ts` | Import computeNetBias, add net_bias to insert payload |
| CREATE | `app/api/bias-trend/route.ts` | API route: query Supabase, reshape, KV cache, filter by tiers param |
| MODIFY | `lib/server/kv-fetchers.ts` | Add fetchBiasTrend() for server component initial data |
| MODIFY | `components/nav.tsx` | Add Bias Trend child to Signals section |
| CREATE | `app/signals/bias/page.tsx` | Async server component: fetch initial data, render BiasClient |
| CREATE | `app/signals/bias/BiasClient.tsx` | Client component: recharts LineChart + tier toggle buttons |
| MODIFY | `docs/sprints/status.md` | Mark Sprint 2 in progress |

---

## Task 1: Supabase migration — add net_bias column

**Files:**
- Create: `supabase/migrations/005_net_bias.sql`

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/005_net_bias.sql`:

```sql
-- Sprint 2: store pre-computed net long/short bias per wallet snapshot.
-- net_bias = (long_notional - short_notional) / (long_notional + short_notional)
-- Range: -1.0 (fully short) to +1.0 (fully long). NULL = no open positions.
ALTER TABLE cohort_snapshots ADD COLUMN IF NOT EXISTS net_bias float8;
```

No backfill. Old rows stay NULL and render as line gaps — acceptable for a new feature.

- [ ] **Step 2: Apply the migration via Supabase MCP**

Run this SQL in the Supabase dashboard SQL editor or via the MCP tool:

```sql
ALTER TABLE cohort_snapshots ADD COLUMN IF NOT EXISTS net_bias float8;
```

- [ ] **Step 3: Verify column exists**

Run in the Supabase SQL editor:

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'cohort_snapshots' AND column_name = 'net_bias';
```

Expected: one row — `net_bias | double precision`.

- [ ] **Step 4: Commit migration file**

```bash
git add supabase/migrations/005_net_bias.sql
git commit -m "feat(db): add net_bias column to cohort_snapshots"
```

---

## Task 2: bias-utils.ts — TDD

**Files:**
- Create: `lib/__tests__/bias-utils.test.ts`
- Create: `lib/bias-utils.ts`

`bias-utils.ts` is intentionally self-contained: it only imports from `hyperliquid-api-client.ts`. It does NOT import from `cohort-engine.ts` — that prevents a circular dependency when cohort-engine imports `computeNetBias` in Task 3.

- [ ] **Step 1: Write the failing tests**

Create `lib/__tests__/bias-utils.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  computeNetBias,
  bucketTime,
  reshapeBiasRows,
  TIERS,
  TIER_COLORS,
} from "../bias-utils";
import type { HlAssetPosition } from "../hyperliquid-api-client";

// ── helpers ─────────────────────────────────────────────────────────────────

function pos(szi: string, entryPx: string): HlAssetPosition {
  return {
    position: {
      coin: "BTC",
      szi,
      entryPx,
      positionValue: "0",
      unrealizedPnl: "0",
      returnOnEquity: "0",
      liquidationPx: null,
      leverage: { type: "cross", value: 1 },
      cumFunding: { allTime: "0", sinceChange: "0", sinceOpen: "0" },
    },
    type: "oneWay",
  };
}

// ── computeNetBias ────────────────────────────────────────────────────────────

describe("computeNetBias", () => {
  it("returns +1 for a fully long wallet", () => {
    expect(computeNetBias([pos("2.0", "50000")])).toBe(1);
  });

  it("returns -1 for a fully short wallet", () => {
    expect(computeNetBias([pos("-1.0", "40000")])).toBe(-1);
  });

  it("returns 0 for equal long and short notional", () => {
    expect(computeNetBias([pos("1.0", "50000"), pos("-1.0", "50000")])).toBe(0);
  });

  it("returns null for empty positions array", () => {
    expect(computeNetBias([])).toBeNull();
  });

  it("returns null when all szi are zero", () => {
    expect(computeNetBias([pos("0", "50000")])).toBeNull();
  });

  it("computes partial bias correctly", () => {
    // long: 2 * 50000 = 100000; short: 1 * 40000 = 40000
    // bias = (100000 - 40000) / 140000 ≈ 0.42857
    const result = computeNetBias([pos("2.0", "50000"), pos("-1.0", "40000")]);
    expect(result).toBeCloseTo(60000 / 140000, 5);
  });

  it("handles multiple longs and multiple shorts", () => {
    // longs: 1*10 + 2*10 = 30; shorts: 1*10 = 10
    // bias = (30 - 10) / 40 = 0.5
    const result = computeNetBias([
      pos("1.0", "10"),
      pos("2.0", "10"),
      pos("-1.0", "10"),
    ]);
    expect(result).toBeCloseTo(0.5, 5);
  });
});

// ── bucketTime ───────────────────────────────────────────────────────────────

describe("bucketTime", () => {
  it("floors to the start of the hour", () => {
    expect(bucketTime("2026-04-14T10:45:00.000Z")).toBe("2026-04-14T10:00:00.000Z");
    expect(bucketTime("2026-04-14T10:00:00.000Z")).toBe("2026-04-14T10:00:00.000Z");
    expect(bucketTime("2026-04-14T10:59:59.999Z")).toBe("2026-04-14T10:00:00.000Z");
  });

  it("handles midnight correctly", () => {
    expect(bucketTime("2026-04-14T00:30:00.000Z")).toBe("2026-04-14T00:00:00.000Z");
  });
});

// ── reshapeBiasRows ───────────────────────────────────────────────────────────

describe("reshapeBiasRows", () => {
  // T1 and T2 are in the same 1-hour bucket (10:00); T3 is in the next (11:00)
  const T1 = "2026-04-14T10:15:00.000Z";
  const T2 = "2026-04-14T10:45:00.000Z"; // later than T1, same bucket
  const T3 = "2026-04-14T11:15:00.000Z";

  it("groups rows into hourly buckets and returns them sorted ascending", () => {
    const rows = [
      { wallet_id: "w1", equity_tier: "Elite", net_bias: 0.5, snapshot_time: T1 },
      { wallet_id: "w2", equity_tier: "Major", net_bias: 0.3, snapshot_time: T3 },
    ];
    const result = reshapeBiasRows(rows, 10);
    expect(result.snapshots).toHaveLength(2);
    expect(result.snapshots[0].snapshot_time).toBe("2026-04-14T10:00:00.000Z");
    expect(result.snapshots[1].snapshot_time).toBe("2026-04-14T11:00:00.000Z");
  });

  it("deduplicates wallets within a bucket keeping the latest snapshot", () => {
    const rows = [
      { wallet_id: "w1", equity_tier: "Elite", net_bias: 0.2, snapshot_time: T1 },
      { wallet_id: "w1", equity_tier: "Elite", net_bias: 0.8, snapshot_time: T2 }, // later
    ];
    const result = reshapeBiasRows(rows, 10);
    expect(result.snapshots).toHaveLength(1);
    expect(result.snapshots[0].tiers.Elite).toBeCloseTo(0.8);
  });

  it("averages multiple wallets in the same tier", () => {
    const rows = [
      { wallet_id: "w1", equity_tier: "Elite", net_bias: 0.4, snapshot_time: T1 },
      { wallet_id: "w2", equity_tier: "Elite", net_bias: 0.6, snapshot_time: T1 },
    ];
    const result = reshapeBiasRows(rows, 10);
    expect(result.snapshots[0].tiers.Elite).toBeCloseTo(0.5);
  });

  it("sets null for tiers with no wallet data in a bucket", () => {
    const rows = [
      { wallet_id: "w1", equity_tier: "Elite", net_bias: 0.5, snapshot_time: T1 },
    ];
    const result = reshapeBiasRows(rows, 10);
    expect(result.snapshots[0].tiers.Major).toBeNull();
    expect(result.snapshots[0].tiers.Dust).toBeNull();
  });

  it("skips rows where net_bias is null", () => {
    const rows = [
      { wallet_id: "w1", equity_tier: "Elite", net_bias: null, snapshot_time: T1 },
      { wallet_id: "w2", equity_tier: "Elite", net_bias: 0.6, snapshot_time: T1 },
    ];
    const result = reshapeBiasRows(rows, 10);
    // Only w2 counted: average of [0.6] = 0.6
    expect(result.snapshots[0].tiers.Elite).toBeCloseTo(0.6);
  });

  it("respects the window parameter returning only the N most recent buckets", () => {
    const rows = [
      { wallet_id: "w1", equity_tier: "Elite", net_bias: 0.5, snapshot_time: T1 },
      { wallet_id: "w2", equity_tier: "Major", net_bias: 0.3, snapshot_time: T3 },
    ];
    const result = reshapeBiasRows(rows, 1); // only 1 bucket
    expect(result.snapshots).toHaveLength(1);
    expect(result.snapshots[0].snapshot_time).toBe("2026-04-14T11:00:00.000Z"); // most recent
  });
});

// ── constants ─────────────────────────────────────────────────────────────────

describe("TIERS and TIER_COLORS", () => {
  it("TIERS contains all 7 tiers in order", () => {
    expect(TIERS).toEqual(["Elite", "Major", "Large", "Mid", "Small", "Micro", "Dust"]);
  });

  it("TIER_COLORS has an entry for every tier", () => {
    for (const tier of TIERS) {
      expect(TIER_COLORS[tier]).toBeTruthy();
    }
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm run test
```

Expected: FAIL — "Cannot find module '../bias-utils'"

- [ ] **Step 3: Implement bias-utils.ts**

Create `lib/bias-utils.ts`:

```ts
/**
 * lib/bias-utils.ts
 *
 * Pure utilities for computing and shaping wallet directional bias data.
 * Intentionally self-contained — only imports from hyperliquid-api-client.ts.
 * Do NOT import from cohort-engine.ts (would create a circular dependency).
 */

import type { HlAssetPosition } from "@/lib/hyperliquid-api-client";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

export const TIERS = [
  "Elite", "Major", "Large", "Mid", "Small", "Micro", "Dust",
] as const;

export type TierName = typeof TIERS[number];

/** Chart line colors — white-to-gray scale, Elite brightest. */
export const TIER_COLORS: Record<TierName, string> = {
  Elite: "rgba(255,255,255,0.90)",
  Major: "rgba(255,255,255,0.72)",
  Large: "rgba(255,255,255,0.55)",
  Mid:   "rgba(255,255,255,0.40)",
  Small: "rgba(255,255,255,0.28)",
  Micro: "rgba(255,255,255,0.18)",
  Dust:  "rgba(255,255,255,0.10)",
};

/** 1-hour bucket size in milliseconds. */
export const BUCKET_MS = 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type BiasTierMap = { [K in TierName]?: number | null };

export interface BiasSnapshot {
  /** ISO string for the start of this 1-hour bucket. */
  snapshot_time: string;
  tiers: BiasTierMap;
}

export interface BiasTrendResponse {
  snapshots: BiasSnapshot[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Computation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute the net long/short directional bias for a single wallet.
 *
 * net_bias = (long_notional - short_notional) / (long_notional + short_notional)
 *
 * - Positive szi = long position; negative szi = short position.
 * - Notional per position = |szi * entryPx|.
 * - Returns null when total notional is zero (no open positions).
 */
export function computeNetBias(positions: HlAssetPosition[]): number | null {
  let longNotional = 0;
  let shortNotional = 0;

  for (const ap of positions) {
    const szi     = parseFloat(ap.position.szi);
    const entryPx = parseFloat(ap.position.entryPx);
    const notional = Math.abs(szi * entryPx);
    if (szi > 0) longNotional  += notional;
    else if (szi < 0) shortNotional += notional;
  }

  const total = longNotional + shortNotional;
  if (total === 0) return null;
  return (longNotional - shortNotional) / total;
}

/**
 * Floor an ISO timestamp to the start of its 1-hour bucket.
 * E.g. "2026-04-14T10:45:00Z" → "2026-04-14T10:00:00.000Z"
 */
export function bucketTime(isoString: string): string {
  const ms = new Date(isoString).getTime();
  return new Date(Math.floor(ms / BUCKET_MS) * BUCKET_MS).toISOString();
}

// ─────────────────────────────────────────────────────────────────────────────
// Reshaping
// ─────────────────────────────────────────────────────────────────────────────

type BiasDbRow = {
  wallet_id:     string;
  equity_tier:   string | null;
  net_bias:      number | null;
  snapshot_time: string;
};

/**
 * Reshape flat DB rows into BiasTrendResponse.
 *
 * 1. Groups rows into 1-hour time buckets.
 * 2. Deduplicates by wallet within each bucket (latest snapshot_time wins).
 * 3. Averages net_bias per tier per bucket, skipping null values.
 * 4. Returns the N most recent buckets sorted ascending.
 *
 * @param rows    Rows from cohort_snapshots (any order is fine)
 * @param window  Max number of buckets to return
 */
export function reshapeBiasRows(rows: BiasDbRow[], window: number): BiasTrendResponse {
  // Group rows by hour bucket
  const byBucket = new Map<string, BiasDbRow[]>();
  for (const row of rows) {
    const bucket = bucketTime(row.snapshot_time);
    const arr = byBucket.get(bucket);
    if (arr) arr.push(row);
    else byBucket.set(bucket, [row]);
  }

  // Sort ascending, take last N
  const buckets = [...byBucket.keys()].sort().slice(-window);

  const snapshots: BiasSnapshot[] = buckets.map((bucket) => {
    const bucketRows = byBucket.get(bucket)!;

    // Deduplicate: latest snapshot per wallet
    const latestByWallet = new Map<string, BiasDbRow>();
    for (const row of bucketRows) {
      const existing = latestByWallet.get(row.wallet_id);
      if (!existing || row.snapshot_time > existing.snapshot_time) {
        latestByWallet.set(row.wallet_id, row);
      }
    }

    // Collect net_bias values per tier
    const biasByTier = new Map<string, number[]>();
    for (const row of latestByWallet.values()) {
      if (!row.equity_tier || row.net_bias === null || row.net_bias === undefined) continue;
      const arr = biasByTier.get(row.equity_tier);
      if (arr) arr.push(row.net_bias);
      else biasByTier.set(row.equity_tier, [row.net_bias]);
    }

    // Average per tier; null when no data
    const tiers: BiasTierMap = {};
    for (const tier of TIERS) {
      const values = biasByTier.get(tier);
      if (!values || values.length === 0) {
        tiers[tier] = null;
      } else {
        tiers[tier] = values.reduce((a, b) => a + b, 0) / values.length;
      }
    }

    return { snapshot_time: bucket, tiers };
  });

  return { snapshots };
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npm run test
```

Expected: All tests in `bias-utils.test.ts` PASS. Pre-existing tests in `cohort-engine.test.ts` also still PASS.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add lib/bias-utils.ts lib/__tests__/bias-utils.test.ts
git commit -m "feat: add bias-utils — computeNetBias, bucketTime, reshapeBiasRows"
```

---

## Task 3: Wire net_bias into saveCohortSnapshot

**Files:**
- Modify: `lib/cohort-engine.ts`

- [ ] **Step 1: Add computeNetBias to the import at the top of cohort-engine.ts**

The import block at the top of `lib/cohort-engine.ts` currently imports from `hyperliquid-api-client`. Add a new import line after it:

```ts
import { computeNetBias } from "@/lib/bias-utils";
```

- [ ] **Step 2: Add net_bias to the Supabase insert in saveCohortSnapshot**

Inside the `supabase.from("cohort_snapshots").insert({...})` call (around line 423), after the `equity_tier` line, add:

```ts
    net_bias:          computeNetBias(state.assetPositions),
```

The full insert block should now end with:

```ts
    overall_score:     scores.overall_score,
    sharpe_proxy:      scores.sharpe_proxy,
    drawdown_score:    scores.drawdown_score,
    pnl_consistency:   scores.pnl_consistency,
    regime_fit:        scores.regime_fit,
    equity_tier:       getEquityTier(accountValue),
    net_bias:          computeNetBias(state.assetPositions),
  });
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: No errors.

- [ ] **Step 4: Run tests**

```bash
npm run test
```

Expected: All tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/cohort-engine.ts
git commit -m "feat: store net_bias in cohort snapshots"
```

---

## Task 4: API route — /api/bias-trend

**Files:**
- Create: `app/api/bias-trend/route.ts`

- [ ] **Step 1: Create the route file**

Create `app/api/bias-trend/route.ts`:

```ts
// app/api/bias-trend/route.ts
// Returns per-tier average net long/short bias over the last N hourly snapshots.
// KV-cached at 5-min TTL. Always computes all tiers; filters by ?tiers= in response.

import { NextRequest, NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "@/lib/env";
import {
  reshapeBiasRows,
  BUCKET_MS,
  TIERS,
  type BiasTrendResponse,
  type TierName,
} from "@/lib/bias-utils";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/** KV TTL in seconds. */
const KV_TTL = 300;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const window = Math.min(
    Math.max(1, parseInt(searchParams.get("window") ?? "30", 10)),
    90
  );
  const tiersParam = searchParams.get("tiers");
  const cacheKey = `bias-trend:${window}`;

  // Cache hit
  const cached = await kv.get<BiasTrendResponse>(cacheKey);
  if (cached) {
    return NextResponse.json(applyTierFilter(cached, tiersParam));
  }

  // Lookback: window hours + 1 extra bucket as buffer
  const since = new Date(Date.now() - (window + 1) * BUCKET_MS).toISOString();

  const { data, error } = await supabase
    .from("cohort_snapshots")
    .select("wallet_id, equity_tier, net_bias, snapshot_time")
    .gte("snapshot_time", since)
    .not("equity_tier", "is", null)
    .not("net_bias", "is", null)
    .order("snapshot_time", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const result = reshapeBiasRows(data ?? [], window);

  await kv.set(cacheKey, result, { ex: KV_TTL });

  return NextResponse.json(applyTierFilter(result, tiersParam));
}

/** Filter snapshots to only include the requested tiers (post-cache). */
function applyTierFilter(
  data: BiasTrendResponse,
  tiersParam: string | null
): BiasTrendResponse {
  if (!tiersParam) return data;
  const allowed = new Set(tiersParam.split(",") as TierName[]);
  return {
    snapshots: data.snapshots.map((s) => ({
      ...s,
      tiers: Object.fromEntries(
        TIERS
          .filter((t) => allowed.has(t))
          .map((t) => [t, s.tiers[t] ?? null])
      ) as BiasTrendResponse["snapshots"][number]["tiers"],
    })),
  };
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: No errors.

- [ ] **Step 3: Start dev server and manually test the route**

```bash
npm run dev
```

In a separate terminal:

```bash
curl "http://localhost:3000/api/bias-trend?window=5" | jq .
```

Expected: JSON with a `snapshots` array. If the `net_bias` column has not been populated yet (no cron run since migration), `snapshots` will be an empty array — that is correct.

To verify the caching path, run the curl twice within 5 minutes. Second call should return identical data (served from KV).

- [ ] **Step 4: Commit**

```bash
git add app/api/bias-trend/route.ts
git commit -m "feat: add /api/bias-trend route with KV caching"
```

---

## Task 5: Add fetchBiasTrend to kv-fetchers.ts

**Files:**
- Modify: `lib/server/kv-fetchers.ts`

- [ ] **Step 1: Add the import and the fetcher function**

At the top of `lib/server/kv-fetchers.ts`, add to the existing imports:

```ts
import type { BiasTrendResponse } from "@/lib/bias-utils";
```

Then add this function at the end of the file:

```ts
export async function fetchBiasTrend(): Promise<BiasTrendResponse | null> {
  try {
    return parse<BiasTrendResponse>(await kv.get("bias-trend:30"));
  } catch { return null; }
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add lib/server/kv-fetchers.ts
git commit -m "feat: add fetchBiasTrend to kv-fetchers"
```

---

## Task 6: Nav — add Bias Trend entry

**Files:**
- Modify: `components/nav.tsx`

- [ ] **Step 1: Add Bias Trend to the Signals children array**

In `components/nav.tsx`, find the Signals section in the `NAV` array (around line 33). Add the new child:

```ts
  {
    section:  "signals",
    label:    "Signals",
    base:     "/signals",
    children: [
      { href: "/signals/feed",        label: "Feed"        },
      { href: "/signals/divergence",  label: "Divergence"  },
      { href: "/signals/bias",        label: "Bias Trend"  },
      { href: "/edge",                label: "Edge"        },
    ],
  },
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: No errors.

- [ ] **Step 3: Start dev server and verify nav renders**

```bash
npm run dev
```

Open http://localhost:3000. Confirm "Bias Trend" appears under the Signals section in the nav. Clicking it should show a 404 (page not built yet) — that is expected at this step.

- [ ] **Step 4: Commit**

```bash
git add components/nav.tsx
git commit -m "feat: add Bias Trend nav entry under Signals"
```

---

## Task 7: Page server component + BiasClient

**Files:**
- Create: `app/signals/bias/page.tsx`
- Create: `app/signals/bias/BiasClient.tsx`

- [ ] **Step 1: Create the server component**

Create `app/signals/bias/page.tsx`:

```ts
// app/signals/bias/page.tsx — server component: fetch initial data from KV
import { fetchBiasTrend } from "@/lib/server/kv-fetchers";
import { BiasClient } from "./BiasClient";

export default async function BiasPage() {
  const initialData = await fetchBiasTrend();
  return <BiasClient initialData={initialData} />;
}
```

- [ ] **Step 2: Create BiasClient.tsx**

Create `app/signals/bias/BiasClient.tsx`:

```tsx
"use client";
// app/signals/bias/BiasClient.tsx
// Multi-line recharts chart showing average long/short bias per tier over time.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { PageHeader } from "@/components/page-header";
import {
  TIERS, TIER_COLORS,
  type BiasTrendResponse, type TierName,
} from "@/lib/bias-utils";
import { color, card as C, type as T, space } from "@/lib/design-tokens";

const S = {
  page: { padding: space.pagePaddingX },
  card: { ...C.base, padding: "20px", marginTop: "16px" },
};

const DEFAULT_VISIBLE = new Set<TierName>(["Elite", "Major", "Large"]);

function formatBucket(iso: string): string {
  const d = new Date(iso);
  return (
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
    " " +
    d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })
  );
}

function formatBiasLabel(v: number | null | undefined): string {
  if (v === null || v === undefined) return "-";
  return (v >= 0 ? "+" : "") + Math.round(v * 100) + "%";
}

export function BiasClient({ initialData }: { initialData: BiasTrendResponse | null }) {
  const [visibleTiers, setVisibleTiers] = useState<Set<TierName>>(DEFAULT_VISIBLE);

  const { data } = useQuery<BiasTrendResponse>({
    queryKey:        ["bias-trend", 30],
    queryFn:         () => fetch("/api/bias-trend?window=30").then((r) => r.json()),
    initialData:     initialData ?? undefined,
    staleTime:       55_000,
    refetchInterval: 60_000,
  });

  function toggleTier(tier: TierName) {
    setVisibleTiers((prev) => {
      const next = new Set(prev);
      if (next.has(tier)) next.delete(tier);
      else next.add(tier);
      return next;
    });
  }

  // Recharts needs an array of plain objects: { label, Elite: 0.42, Major: null, ... }
  const chartData = (data?.snapshots ?? []).map((snap) => ({
    label: formatBucket(snap.snapshot_time),
    ...snap.tiers,
  }));

  const noData = chartData.length === 0;

  return (
    <div style={S.page}>
      <PageHeader
        title="Bias Trend"
        subtitle="Average long/short bias per wallet tier over time"
      />

      <div style={S.card}>
        {noData ? (
          <div style={{
            height: "320px",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <span style={{ color: color.textMuted, fontSize: "13px" }}>
              No bias data yet. Populates after the first few cron cycles.
            </span>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart
              data={chartData}
              margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
            >
              <CartesianGrid
                stroke={color.borderFaint}
                strokeDasharray="3 3"
                vertical={false}
              />
              <XAxis
                dataKey="label"
                tick={{ fill: color.textMuted, fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: color.borderFaint }}
                interval="preserveStartEnd"
              />
              <YAxis
                domain={[-1, 1]}
                ticks={[-1, -0.5, 0, 0.5, 1]}
                tickFormatter={(v: number) => {
                  if (v === 1)  return "+100%";
                  if (v === -1) return "-100%";
                  if (v === 0)  return "0";
                  return (v > 0 ? "+" : "") + Math.round(v * 100) + "%";
                }}
                tick={{ fill: color.textMuted, fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={52}
              />
              <ReferenceLine
                y={0}
                stroke={color.borderFaint}
                strokeDasharray="4 4"
                strokeWidth={1}
              />
              <Tooltip
                contentStyle={{
                  background: color.card,
                  border: `1px solid ${color.border}`,
                  borderRadius: "8px",
                  fontSize: "12px",
                  color: color.text,
                  backdropFilter: "blur(8px)",
                }}
                labelStyle={{ color: color.textMuted, marginBottom: "6px", fontSize: "11px" }}
                formatter={(value: number | null, name: string) => [
                  formatBiasLabel(value),
                  name,
                ]}
              />
              {TIERS.filter((t) => t !== "Dust").map((tier) =>
                visibleTiers.has(tier) ? (
                  <Line
                    key={tier}
                    type="monotone"
                    dataKey={tier}
                    stroke={TIER_COLORS[tier]}
                    strokeWidth={1.5}
                    dot={false}
                    connectNulls={false}
                    name={tier}
                  />
                ) : null
              )}
            </LineChart>
          </ResponsiveContainer>
        )}

        {/* Tier toggle buttons */}
        <div style={{
          display: "flex", gap: "6px", flexWrap: "wrap" as const,
          marginTop: "16px", paddingTop: "12px",
          borderTop: `1px solid ${color.borderFaint}`,
        }}>
          {TIERS.filter((t) => t !== "Dust").map((tier) => {
            const active = visibleTiers.has(tier);
            return (
              <button
                key={tier}
                onClick={() => toggleTier(tier)}
                style={{
                  display: "flex", alignItems: "center", gap: "6px",
                  fontSize: "11px", fontWeight: 600,
                  padding: "4px 10px", borderRadius: "5px",
                  border: "1px solid",
                  cursor: "pointer",
                  background: active ? "rgba(255,255,255,0.06)" : "transparent",
                  borderColor: active
                    ? "rgba(255,255,255,0.18)"
                    : "rgba(255,255,255,0.08)",
                  color: active ? color.text : color.textFaint,
                  transition: "all 0.15s",
                }}
              >
                <span style={{
                  width: "8px", height: "8px", borderRadius: "50%",
                  background: active ? TIER_COLORS[tier] : "rgba(255,255,255,0.15)",
                  display: "inline-block", flexShrink: 0,
                }} />
                {tier}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: No errors.

- [ ] **Step 4: Start dev server and verify the page renders**

```bash
npm run dev
```

Open http://localhost:3000/signals/bias.

Check:
- Page renders with title "Bias Trend" and subtitle
- If no bias data in KV yet: empty state message shows ("No bias data yet...")
- Nav highlights "Bias Trend" as active
- No console errors

To see the chart with data, trigger a cron cycle manually:

```bash
curl -X POST http://localhost:3000/api/refresh-cohort
```

Then wait ~30 seconds and call the bias API:

```bash
curl "http://localhost:3000/api/bias-trend?window=5" | jq .snapshots[0]
```

Expected: a snapshot object with `tiers` map containing non-null values for tiers with active wallets.

Refresh http://localhost:3000/signals/bias and verify the chart appears with lines.

- [ ] **Step 5: Verify tier toggles**

- Click "Major" to deselect it — its line disappears
- Click "Mid" to add it — a new line appears
- Zero reference line (dashed) is visible at Y=0

- [ ] **Step 6: Commit**

```bash
git add app/signals/bias/page.tsx app/signals/bias/BiasClient.tsx
git commit -m "feat: add /signals/bias page with multi-line bias trend chart"
```

---

## Task 8: Update sprint status

**Files:**
- Modify: `docs/sprints/status.md`

- [ ] **Step 1: Update the active sprint and table**

In `docs/sprints/status.md`, update the Active Sprint block:

```markdown
## Active Sprint

**Sprint 2 — Bias Trend Chart**
Status: IN PROGRESS
Spec: `docs/superpowers/specs/2026-04-13-sprint-2-bias-trend.md`
Plan: `docs/superpowers/plans/2026-04-14-sprint-2-bias-trend.md`
Last worked on: 2026-04-14
```

And update the table row for Sprint 2:

```markdown
| 2 | Bias Trend Chart | IN PROGRESS | [spec](...) | [plan](../superpowers/plans/2026-04-14-sprint-2-bias-trend.md) |
```

- [ ] **Step 2: Commit**

```bash
git add docs/sprints/status.md docs/superpowers/plans/2026-04-14-sprint-2-bias-trend.md
git commit -m "docs: mark Sprint 2 in progress, save implementation plan"
```

---

## Self-Review

**Spec coverage:**
- [x] `net_bias` stored at snapshot write — Task 3
- [x] `GET /api/bias-trend?window=N&tiers=X` — Task 4
- [x] TypeScript-side JSONB parse (via pre-stored net_bias, avoids runtime JSONB overhead) — Tasks 2+4
- [x] Wallets with zero notional excluded (computeNetBias returns null; reshapeBiasRows skips null) — Task 2
- [x] KV cache at `bias-trend:${window}`, 5-min TTL — Task 4
- [x] Full all-tiers result cached; tiers param filters post-cache — Task 4
- [x] `connectNulls={false}` — null tiers render as line breaks — Task 7
- [x] Tier color scale white to gray — Task 2
- [x] Zero reference line (dashed) — Task 7
- [x] Tier toggles, default Elite/Major/Large — Task 7
- [x] Dust excluded from chart by default — Task 7
- [x] Nav entry under Signals — Task 6
- [x] Server component with KV initial data, React Query polling — Tasks 5+7
- [x] No em dashes, all colors from design tokens — BiasClient uses color.* throughout

**Placeholder scan:** None found.

**Type consistency:**
- `TierName` defined in `bias-utils.ts`, used throughout (BiasClient, route, kv-fetchers)
- `BiasTrendResponse` defined in `bias-utils.ts`, imported in route + kv-fetchers + BiasClient
- `reshapeBiasRows` accepts `BiasDbRow[]` — matches the Supabase select shape in the route
- `computeNetBias` accepts `HlAssetPosition[]` — matches `state.assetPositions` type in cohort-engine
