# Signal Intelligence Agent — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the data foundation and stats engine — persist every signal, measure outcomes automatically, and compute nightly performance findings — so the Claude agent (Phase 2 plan) has validated data to reason from.

**Architecture:** Signals fired in `refresh-cohort` are persisted to Supabase `signal_events` via `after()` (fire-and-forget). An hourly Vercel cron fills price outcomes in `signal_outcomes`. A nightly GitHub Actions job resolves wallet PnL outcomes and runs the stats engine to compute `agent_findings`. Recipe thresholds move from hardcoded constants to runtime reads from `agent_config` via KV cache.

**Tech Stack:** Next.js 15 App Router, Supabase (postgres), Vercel KV, Vitest, TypeScript, tsx (for scripts), GitHub Actions

---

## File Map

| File | Status | Purpose |
|---|---|---|
| `supabase/migrations/006_signal_intelligence.sql` | Create | All 6 tables + indexes + agent_config seed |
| `lib/recipe-config.ts` | Create | KV-cached runtime config reader for recipes |
| `lib/signal-persistence.ts` | Create | Persist SignalEvent[] to signal_events + init signal_outcomes |
| `lib/__tests__/recipe-config.test.ts` | Create | Unit tests for config reader |
| `lib/__tests__/signal-persistence.test.ts` | Create | Unit tests for signal hash + outcome init |
| `lib/__tests__/signal-learning.test.ts` | Create | Unit tests for stats engine computations |
| `app/api/measure-outcomes/route.ts` | Create | Hourly cron: fill price outcomes, resolve confirming recipes |
| `scripts/signal-learning.ts` | Create | Nightly GitHub Actions: stats engine + agent_findings writer |
| `.github/workflows/signal-learning.yml` | Create | GitHub Actions workflow (01:00 UTC daily) |
| `app/api/refresh-cohort/route.ts` | Modify | Add after() call to persist signals |
| `lib/signal-lab.ts` | Modify | Replace hardcoded constants with getRecipeConfig() reads |
| `scripts/daily-wallet-scan.ts` | Modify | Add wallet outcome resolution pass |
| `vercel.json` | Modify | Add /api/measure-outcomes cron (hourly) |

---

## Task 1: Supabase Migration — Six Tables + Seed

**Files:**
- Create: `supabase/migrations/006_signal_intelligence.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/006_signal_intelligence.sql
-- Signal Intelligence Agent: 6 tables, required indexes, agent_config seed.
-- Run AFTER 005_entity_type.sql.

-- ── 1. signal_events ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS signal_events (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  signal_hash           TEXT UNIQUE NOT NULL,
  recipe_id             TEXT NOT NULL,
  coin                  TEXT NOT NULL,
  signal_type           TEXT NOT NULL,
  direction             TEXT,
  ev_score              FLOAT,
  wallet_ids            TEXT[] NOT NULL DEFAULT '{}',
  snapshot_time         TIMESTAMPTZ NOT NULL,
  fired_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  regime_at_fire        TEXT NOT NULL,
  btc_price_at_fire     FLOAT NOT NULL,
  funding_rate_at_fire  FLOAT,
  oi_at_fire            FLOAT,
  volume_24h_at_fire    FLOAT,
  active_config         JSONB NOT NULL DEFAULT '{}',
  metadata              JSONB
);

-- ── 2. signal_outcomes ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS signal_outcomes (
  signal_id             UUID PRIMARY KEY REFERENCES signal_events(id) ON DELETE CASCADE,
  price_at_fire         FLOAT NOT NULL,
  price_1h              FLOAT,
  price_4h              FLOAT,
  price_24h             FLOAT,
  move_pct_1h           FLOAT,
  move_pct_4h           FLOAT,
  move_pct_24h          FLOAT,
  direction_ok_4h       BOOLEAN,
  price_win             BOOLEAN,
  is_win                BOOLEAN,
  wallet_return_avg     FLOAT,
  wallet_outcome        TEXT NOT NULL DEFAULT 'OPEN',
  confirming_recipe_ids TEXT[] NOT NULL DEFAULT '{}',
  confirmation_count    INT NOT NULL DEFAULT 0,
  measured_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 3. agent_config ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_config (
  recipe_id             TEXT NOT NULL,
  param_name            TEXT NOT NULL,
  param_value           FLOAT NOT NULL,
  locked_by_human       BOOLEAN NOT NULL DEFAULT false,
  next_eligible_change  TIMESTAMPTZ,
  last_change_run_id    TEXT,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (recipe_id, param_name)
);

-- ── 4. agent_config_history ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_config_history (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  recipe_id       TEXT NOT NULL,
  param_name      TEXT NOT NULL,
  old_value       FLOAT NOT NULL,
  new_value       FLOAT NOT NULL,
  changed_by      TEXT NOT NULL,
  change_reason   TEXT NOT NULL,
  agent_log_id    UUID,
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 5. agent_findings ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_findings (
  id                       UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  recipe_id                TEXT NOT NULL,
  regime                   TEXT NOT NULL,
  period_days              INT NOT NULL,
  sample_size              INT NOT NULL,
  meets_min_sample         BOOLEAN NOT NULL,
  confidence               FLOAT NOT NULL,
  win_rate_7d              FLOAT,
  win_rate_30d             FLOAT,
  win_rate_90d             FLOAT,
  trend                    TEXT NOT NULL,
  avg_win_pct              FLOAT,
  avg_loss_pct             FLOAT,
  measured_ev              FLOAT,
  baseline_ev              FLOAT,
  vs_baseline_ev           FLOAT,
  win_rate_by_regime       JSONB,
  dominant_regime_last_30d TEXT,
  finding_type             TEXT NOT NULL,
  recommendation           TEXT,
  rec_param                TEXT,
  rec_value                FLOAT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 6. agent_log ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_log (
  log_id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  log_type              TEXT NOT NULL,
  recipe_id             TEXT,
  content               TEXT NOT NULL,
  summary               TEXT NOT NULL,
  agent_confidence      FLOAT,
  action_taken          TEXT,
  follow_up_due_at      TIMESTAMPTZ,
  follow_up_finding_id  UUID REFERENCES agent_findings(id),
  resolution            TEXT,
  metadata              JSONB
);

-- Add FK from agent_config_history to agent_log (both tables now exist)
ALTER TABLE agent_config_history
  ADD CONSTRAINT fk_agent_log
  FOREIGN KEY (agent_log_id) REFERENCES agent_log(log_id);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX ON signal_events (recipe_id, fired_at, regime_at_fire);
CREATE INDEX ON signal_events (coin, fired_at);
CREATE INDEX ON signal_outcomes (measured_at) WHERE price_4h IS NULL;
CREATE INDEX ON signal_outcomes (wallet_outcome) WHERE wallet_outcome = 'OPEN';
CREATE INDEX ON agent_log (recipe_id, created_at DESC);
CREATE INDEX ON agent_log (resolution) WHERE resolution = 'PENDING';
CREATE INDEX ON agent_log (follow_up_due_at) WHERE follow_up_due_at IS NOT NULL;
CREATE INDEX ON agent_findings (recipe_id, created_at DESC);

-- ── Seed agent_config with current hardcoded values from signal-lab.ts ────────
INSERT INTO agent_config (recipe_id, param_name, param_value) VALUES
  -- momentum_stack (Recipe 1)
  ('momentum_stack',        'MIN_WALLETS',              3),
  ('momentum_stack',        'COMBINED_NOTIONAL',        500000),
  ('momentum_stack',        'WINDOW_MS',                300000),
  -- divergence_squeeze (Recipe 2)
  ('divergence_squeeze',    'LIQ_BUFFER_THRESHOLD',     0.08),
  ('divergence_squeeze',    'PRICE_FLAT_PCT',           0.005),
  ('divergence_squeeze',    'MIN_NOTIONAL_DELTA',       75000),
  ('divergence_squeeze',    'MIN_WALLET_SCORE',         0.65),
  ('divergence_squeeze',    'MIN_WALLETS',              3),
  -- accumulation_reentry (Recipe 3)
  ('accumulation_reentry',  'HIGH_SCORE',               0.65),
  ('accumulation_reentry',  'DRAWDOWN_MULTIPLIER',      2.0),
  ('accumulation_reentry',  'DRAWDOWN_MIN',             0.06),
  ('accumulation_reentry',  'DRAWDOWN_MAX',             0.15),
  -- rotation_carry (Recipe 4)
  ('rotation_carry',        'MIN_FUNDING',              0.0003),
  ('rotation_carry',        'MIN_HISTORICAL_WINRATE',   0.60),
  -- liq_rebound (Recipe 5)
  ('liq_rebound',           'POSITION_SHRINK_PCT',      0.05),
  ('liq_rebound',           'PRICE_SPIKE_PCT_MAJOR',    0.015),
  ('liq_rebound',           'PRICE_SPIKE_PCT_ALT',      0.035),
  -- streak_continuation (Recipe 6)
  ('streak_continuation',   'MIN_STREAK',               5),
  ('streak_continuation',   'MIN_SHARPE',               0.60),
  -- funding_divergence (Recipe 7)
  ('funding_divergence',    'FUNDING_THRESHOLD',        0.0005),
  -- whale_validated (Recipe 8)
  ('whale_validated',       'MIN_SCORE',                0.75),
  ('whale_validated',       'MIN_WALLETS',              3),
  -- anti_whale_trap (Recipe 9)
  ('anti_whale_trap',       'HIGH_SCORE',               0.70),
  ('anti_whale_trap',       'REDUCTION_PCT',            0.30),
  -- global outcome measurement threshold
  ('global',                'WIN_THRESHOLD_PCT',        0.005)
ON CONFLICT DO NOTHING;
```

- [ ] **Step 2: Apply migration via Supabase CLI or dashboard**

```bash
# If using Supabase CLI:
npx supabase db push
# Or apply manually in the Supabase SQL editor
```

Expected: 6 new tables, 8 indexes, ~25 rows in agent_config.

- [ ] **Step 3: Verify**

In Supabase Table Editor, confirm all 6 tables exist and agent_config has rows.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/006_signal_intelligence.sql
git commit -m "feat: add signal intelligence tables and agent_config seed"
```

---

## Task 2: `lib/recipe-config.ts` — Runtime Config Reader

**Files:**
- Create: `lib/recipe-config.ts`
- Create: `lib/__tests__/recipe-config.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/__tests__/recipe-config.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock KV and Supabase before importing the module under test
vi.mock("@vercel/kv", () => ({
  kv: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({
          data: [
            { param_name: "MIN_WALLETS", param_value: 3 },
            { param_name: "COMBINED_NOTIONAL", param_value: 500000 },
          ],
          error: null,
        })),
      })),
    })),
  })),
}));

import { kv } from "@vercel/kv";
import { getRecipeConfig, snapshotAllConfigs } from "../recipe-config";

describe("getRecipeConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns KV-cached config when available", async () => {
    vi.mocked(kv.get).mockResolvedValueOnce({
      MIN_WALLETS: 4,
      COMBINED_NOTIONAL: 600000,
    });

    const config = await getRecipeConfig("momentum_stack");

    expect(config["MIN_WALLETS"]).toBe(4);
    expect(config["COMBINED_NOTIONAL"]).toBe(600000);
    expect(kv.set).not.toHaveBeenCalled(); // no re-write on cache hit
  });

  it("fetches from Supabase on cache miss and writes to KV", async () => {
    vi.mocked(kv.get).mockResolvedValueOnce(null);

    const config = await getRecipeConfig("momentum_stack");

    expect(config["MIN_WALLETS"]).toBe(3);
    expect(config["COMBINED_NOTIONAL"]).toBe(500000);
    expect(kv.set).toHaveBeenCalledWith(
      "recipe:config:momentum_stack",
      expect.objectContaining({ MIN_WALLETS: 3 }),
      { ex: 300 }
    );
  });

  it("returns empty object and does not throw on Supabase error", async () => {
    vi.mocked(kv.get).mockResolvedValueOnce(null);
    // Override mock to return error
    const { createClient } = await import("@supabase/supabase-js");
    vi.mocked(createClient).mockReturnValueOnce({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => Promise.resolve({ data: null, error: { message: "db error" } })),
        })),
      })),
    } as never);

    const config = await getRecipeConfig("unknown_recipe");
    expect(config).toEqual({});
  });
});

describe("snapshotAllConfigs", () => {
  it("returns a flat map of all recipe configs keyed by recipe_id", async () => {
    vi.mocked(kv.get).mockResolvedValue(null);
    const snapshot = await snapshotAllConfigs(["momentum_stack"]);
    expect(snapshot["momentum_stack"]).toBeDefined();
    expect(typeof snapshot["momentum_stack"]["MIN_WALLETS"]).toBe("number");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test -- recipe-config
```

Expected: FAIL — `Cannot find module '../recipe-config'`

- [ ] **Step 3: Implement `lib/recipe-config.ts`**

```typescript
// lib/recipe-config.ts
// Runtime recipe parameter reader. Recipes call getRecipeConfig() instead of
// using hardcoded constants. KV cache (5 min TTL) keeps reads fast.
// Supabase agent_config table is the source of truth.

import { kv } from "@vercel/kv";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "@/lib/env";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const KV_TTL = 300; // 5 minutes

export async function getRecipeConfig(
  recipeId: string
): Promise<Record<string, number>> {
  const cacheKey = `recipe:config:${recipeId}`;

  const cached = await kv.get<Record<string, number>>(cacheKey);
  if (cached) return cached;

  const { data, error } = await supabase
    .from("agent_config")
    .select("param_name, param_value")
    .eq("recipe_id", recipeId);

  if (error || !data) {
    console.error(`[recipe-config] failed to load ${recipeId}:`, error?.message);
    return {};
  }

  const config = Object.fromEntries(data.map((r) => [r.param_name, r.param_value]));
  await kv.set(cacheKey, config, { ex: KV_TTL });
  return config;
}

/**
 * Snapshot all configs for a list of recipe IDs at signal-fire time.
 * Returns a plain object suitable for storing as signal_events.active_config.
 * Uses KV cache — does not add extra Supabase round-trips beyond getRecipeConfig.
 */
export async function snapshotAllConfigs(
  recipeIds: string[]
): Promise<Record<string, Record<string, number>>> {
  const entries = await Promise.all(
    recipeIds.map(async (id) => [id, await getRecipeConfig(id)] as const)
  );
  return Object.fromEntries(entries);
}

/**
 * Invalidate KV cache for a recipe. Call after agent_config is updated.
 */
export async function invalidateRecipeConfig(recipeId: string): Promise<void> {
  await kv.del(`recipe:config:${recipeId}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run test -- recipe-config
```

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/recipe-config.ts lib/__tests__/recipe-config.test.ts
git commit -m "feat: add recipe-config runtime reader with KV cache"
```

---

## Task 3: `lib/signal-persistence.ts` — Signal Persister

**Files:**
- Create: `lib/signal-persistence.ts`
- Create: `lib/__tests__/signal-persistence.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// lib/__tests__/signal-persistence.test.ts
import { describe, it, expect } from "vitest";
import { buildSignalHash, buildActiveConfigSnapshot } from "../signal-persistence";

describe("buildSignalHash", () => {
  it("produces a 64-char hex string", async () => {
    const hash = await buildSignalHash("momentum_stack", "BTC", "LONG", "2026-04-15T01:00:00Z");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it("is deterministic — same inputs produce same hash", async () => {
    const h1 = await buildSignalHash("momentum_stack", "BTC", "LONG", "2026-04-15T01:00:00Z");
    const h2 = await buildSignalHash("momentum_stack", "BTC", "LONG", "2026-04-15T01:00:00Z");
    expect(h1).toBe(h2);
  });

  it("differs when direction is null vs LONG", async () => {
    const h1 = await buildSignalHash("momentum_stack", "BTC", "LONG", "2026-04-15T01:00:00Z");
    const h2 = await buildSignalHash("momentum_stack", "BTC", null, "2026-04-15T01:00:00Z");
    expect(h1).not.toBe(h2);
  });

  it("differs when snapshot_time differs", async () => {
    const h1 = await buildSignalHash("momentum_stack", "BTC", "LONG", "2026-04-15T01:00:00Z");
    const h2 = await buildSignalHash("momentum_stack", "BTC", "LONG", "2026-04-15T01:01:00Z");
    expect(h1).not.toBe(h2);
  });
});

describe("buildActiveConfigSnapshot", () => {
  it("merges multiple recipe configs into one flat snapshot", () => {
    const configs: Record<string, Record<string, number>> = {
      momentum_stack: { MIN_WALLETS: 3, COMBINED_NOTIONAL: 500000 },
      global: { WIN_THRESHOLD_PCT: 0.005 },
    };
    const snapshot = buildActiveConfigSnapshot(configs);
    expect(snapshot["momentum_stack"]["MIN_WALLETS"]).toBe(3);
    expect(snapshot["global"]["WIN_THRESHOLD_PCT"]).toBe(0.005);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test -- signal-persistence
```

Expected: FAIL — `Cannot find module '../signal-persistence'`

- [ ] **Step 3: Implement `lib/signal-persistence.ts`**

```typescript
// lib/signal-persistence.ts
// Persists SignalEvent[] to signal_events and initialises signal_outcomes rows.
// Called via after() in refresh-cohort — fire-and-forget, not in the hot path.

import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "@/lib/env";
import type { SignalEvent } from "@/lib/signal-lab";
import type { HlAssetCtx } from "@/lib/hyperliquid-api-client";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ─────────────────────────────────────────────────────────────────────────────
// Exported pure helpers (testable without Supabase)
// ─────────────────────────────────────────────────────────────────────────────

export async function buildSignalHash(
  recipeId: string,
  coin: string,
  direction: string | null,
  snapshotTime: string
): Promise<string> {
  const raw = `${recipeId}|${coin}|${direction ?? "null"}|${snapshotTime}`;
  const encoded = new TextEncoder().encode(raw);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function buildActiveConfigSnapshot(
  configs: Record<string, Record<string, number>>
): Record<string, Record<string, number>> {
  return { ...configs };
}

// ─────────────────────────────────────────────────────────────────────────────
// Context passed from refresh-cohort at fire time
// ─────────────────────────────────────────────────────────────────────────────

export interface PersistenceContext {
  snapshotTime: string;          // ISO string of the snapshot that generated signals
  regime: "BULL" | "BEAR" | "RANGING";
  btcPrice: number;
  allMids: Record<string, string>;
  assetCtxMap: Map<string, HlAssetCtx>;
  activeConfigs: Record<string, Record<string, number>>; // from snapshotAllConfigs()
}

// ─────────────────────────────────────────────────────────────────────────────
// Main persistence function
// ─────────────────────────────────────────────────────────────────────────────

export async function persistSignalEvents(
  signals: SignalEvent[],
  ctx: PersistenceContext
): Promise<void> {
  if (signals.length === 0) return;

  const rows = await Promise.all(
    signals.map(async (s) => {
      const hash = await buildSignalHash(s.recipe_id, s.coin, s.direction, ctx.snapshotTime);
      const ctx_asset = ctx.assetCtxMap.get(s.coin);

      return {
        signal_hash:          hash,
        recipe_id:            s.recipe_id,
        coin:                 s.coin,
        signal_type:          s.signal_type,
        direction:            s.direction,
        ev_score:             s.ev_score,
        wallet_ids:           Array.isArray(s.metadata?.wallet_ids)
                                ? (s.metadata.wallet_ids as string[])
                                : s.wallet_id ? [s.wallet_id] : [],
        snapshot_time:        ctx.snapshotTime,
        regime_at_fire:       ctx.regime,
        btc_price_at_fire:    ctx.btcPrice,
        funding_rate_at_fire: ctx_asset ? parseFloat(ctx_asset.funding) : null,
        oi_at_fire:           ctx_asset ? parseFloat(ctx_asset.openInterest) : null,
        volume_24h_at_fire:   null, // not available from assetCtx; can be enriched later
        active_config:        ctx.activeConfigs,
        metadata:             s.metadata,
      };
    })
  );

  // Upsert signal_events — ON CONFLICT on signal_hash does nothing (idempotent)
  const { data: inserted, error } = await supabase
    .from("signal_events")
    .upsert(rows, { onConflict: "signal_hash", ignoreDuplicates: true })
    .select("id, coin");

  if (error) {
    console.error("[signal-persistence] upsert error:", error.message);
    return;
  }

  if (!inserted || inserted.length === 0) return;

  // Initialise signal_outcomes rows for newly inserted signals
  const outcomeRows = inserted.map((row) => ({
    signal_id:     row.id,
    price_at_fire: parseFloat(ctx.allMids[row.coin] ?? "0"),
    wallet_outcome: "OPEN",
  }));

  const { error: outcomeError } = await supabase
    .from("signal_outcomes")
    .upsert(outcomeRows, { onConflict: "signal_id", ignoreDuplicates: true });

  if (outcomeError) {
    console.error("[signal-persistence] outcome init error:", outcomeError.message);
  }

  console.log(`[signal-persistence] persisted ${inserted.length} signal(s)`);
}
```

- [ ] **Step 4: Run tests**

```bash
npm run test -- signal-persistence
```

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/signal-persistence.ts lib/__tests__/signal-persistence.test.ts
git commit -m "feat: add signal persistence with dedup and active_config snapshot"
```

---

## Task 4: Wire Signal Persistence into `refresh-cohort`

**Files:**
- Modify: `app/api/refresh-cohort/route.ts`

- [ ] **Step 1: Add imports at the top of `refresh-cohort/route.ts`**

After the existing imports, add:

```typescript
import { persistSignalEvents } from "@/lib/signal-persistence";
import { snapshotAllConfigs } from "@/lib/recipe-config";
```

The full import block already has `after` from `"next/server"` — no change needed there.

- [ ] **Step 2: Snapshot configs before running recipes**

In `handleRefresh`, find the comment `// ── Step 9: Run all 9 signal recipes ──`. Just before `runSignalLab(...)`, add:

```typescript
// Snapshot active recipe configs — stored on every signal_events row for attribution
const recipeIds = [
  "momentum_stack", "divergence_squeeze", "accumulation_reentry",
  "rotation_carry", "liq_rebound", "streak_continuation",
  "funding_divergence", "whale_validated", "anti_whale_trap", "global",
];
const activeConfigs = await snapshotAllConfigs(recipeIds);
```

- [ ] **Step 3: Add signal persistence to the existing `after()` block**

Find the existing `after(Promise.all([...]))` call near the end of `handleRefresh`. It currently runs `pruneUnderperformers`, `runBridgeInflowEnrichment`, `runTwapEnrichment`, and `updateIntradayRecipePerformance`. Add `persistSignalEvents` to the same block:

```typescript
after(
  Promise.all([
    pruneUnderperformers().catch((err) =>
      console.error("[refresh-cohort] pruneUnderperformers error:", err)
    ),
    runBridgeInflowEnrichment(wallets.map((w) => ({ id: w.id, address: w.address }))).catch((err) =>
      console.error("[refresh-cohort] bridgeInflowEnrichment error:", err)
    ),
    runTwapEnrichment(twapCandidates).catch((err) =>
      console.error("[refresh-cohort] twapEnrichment error:", err)
    ),
    updateIntradayRecipePerformance().catch((err) =>
      console.error("[refresh-cohort] updateIntradayRecipePerformance error:", err)
    ),
    // NEW: persist signals for outcome tracking
    persistSignalEvents(signalEvents, {
      snapshotTime: new Date().toISOString(),
      regime: regimeResult.regime,
      btcPrice: currentBtcMid,
      allMids,
      assetCtxMap,
      activeConfigs,
    }).catch((err) =>
      console.error("[refresh-cohort] persistSignalEvents error:", err)
    ),
  ])
);
```

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 5: Verify locally**

```bash
npm run dev
```

Call `POST /api/refresh-cohort` manually. Check Supabase `signal_events` table — new rows should appear within a few seconds of the request completing.

- [ ] **Step 6: Commit**

```bash
git add app/api/refresh-cohort/route.ts
git commit -m "feat: persist signal events via after() in refresh-cohort"
```

---

## Task 5: Replace Hardcoded Constants in `signal-lab.ts`

**Files:**
- Modify: `lib/signal-lab.ts`

The recipes currently use module-level `const` declarations inside each function. Replace them with values read from `agent_config` via `getRecipeConfig()`. The pattern is the same for all 9 recipes — shown fully for Recipe 1 and 2, then abbreviated for the rest.

- [ ] **Step 1: Add import to `lib/signal-lab.ts`**

At the top of the file, after the existing imports:

```typescript
import { getRecipeConfig } from "@/lib/recipe-config";
```

- [ ] **Step 2: Update Recipe 1 — `recipe1`**

Change the function signature from `function recipe1(pairs)` to `async function recipe1(pairs)`. Replace the hardcoded constants block:

```typescript
// BEFORE:
function recipe1(pairs: SnapshotPair[]): SignalEvent[] {
  const WALLET_THRESHOLD    = 3;
  const COMBINED_NOTIONAL   = 500_000;
  const WINDOW_MS           = 5 * 60 * 1000;

// AFTER:
async function recipe1(pairs: SnapshotPair[]): Promise<SignalEvent[]> {
  const cfg = await getRecipeConfig("momentum_stack");
  const WALLET_THRESHOLD    = cfg["MIN_WALLETS"]         ?? 3;
  const COMBINED_NOTIONAL   = cfg["COMBINED_NOTIONAL"]   ?? 500_000;
  const WINDOW_MS           = cfg["WINDOW_MS"]           ?? 300_000;
```

The rest of the function body is unchanged.

- [ ] **Step 3: Update Recipe 2 — `recipe2`**

Recipe 2 is already async. Add config read at the top:

```typescript
async function recipe2(
  pairs: SnapshotPair[],
  candles5m: Map<string, HlCandle[]>
): Promise<SignalEvent[]> {
  const cfg = await getRecipeConfig("divergence_squeeze");
  const LIQ_BUFFER_THRESHOLD = cfg["LIQ_BUFFER_THRESHOLD"] ?? 0.08;
  const PRICE_FLAT_PCT        = cfg["PRICE_FLAT_PCT"]       ?? 0.005;
  const MIN_NOTIONAL_DELTA    = cfg["MIN_NOTIONAL_DELTA"]   ?? 75_000;
  const MIN_WALLET_SCORE      = cfg["MIN_WALLET_SCORE"]     ?? 0.65;
  const PRICE_FLAT_CANDLES    = 6; // not tunable — structural
  const MIN_WALLETS           = cfg["MIN_WALLETS"]          ?? 3;
```

- [ ] **Step 4: Apply same pattern to Recipes 3–9**

For each remaining recipe, make the function async if it isn't already, add `const cfg = await getRecipeConfig("<recipe_id>")` as the first line, and replace each hardcoded constant with `cfg["PARAM_NAME"] ?? <original_default>`.

Recipe ID mapping:
- Recipe 3 → `"accumulation_reentry"`: `HIGH_SCORE`, `DRAWDOWN_MULTIPLIER`, `DRAWDOWN_MIN`, `DRAWDOWN_MAX`
- Recipe 4 → `"rotation_carry"`: `MIN_FUNDING`, `MIN_HISTORICAL_WINRATE`
- Recipe 5 → `"liq_rebound"`: `POSITION_SHRINK_PCT`, `PRICE_SPIKE_PCT_MAJOR`, `PRICE_SPIKE_PCT_ALT`
- Recipe 6 → `"streak_continuation"`: `MIN_STREAK`, `MIN_SHARPE`
- Recipe 7 → `"funding_divergence"`: `FUNDING_THRESHOLD`
- Recipe 8 → `"whale_validated"`: `MIN_SCORE`, `MIN_WALLETS`
- Recipe 9 → `"anti_whale_trap"`: `HIGH_SCORE`, `REDUCTION_PCT`

Keep `DRAWDOWN_FALLBACK` and `PRICE_FLAT_CANDLES` hardcoded — they are structural parameters, not tunable thresholds.

- [ ] **Step 5: Update `runAllRecipes` / `runSignalLab` to await async recipes**

Find the `runAllRecipes` or equivalent orchestration function. All recipe calls must be awaited since they are now async:

```typescript
const results = await Promise.all([
  recipe1(pairs),
  recipe2(pairs, candles5m),
  recipe3(pairs, candles4h),
  recipe4(pairs, assetCtxMap, recipeWinRates, recipeSignalCounts),
  recipe5(pairs, allMids, priorAllMids),
  recipe6(pairs, backtestMap),
  recipe7(pairs, assetCtxMap),
  recipe8(pairs),
  recipe9(pairs, allMids),
]);
return results.flat();
```

- [ ] **Step 6: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 7: Run tests**

```bash
npm run test
```

Expected: all existing tests pass

- [ ] **Step 8: Commit**

```bash
git add lib/signal-lab.ts
git commit -m "feat: replace hardcoded recipe constants with runtime agent_config reads"
```

---

## Task 6: `app/api/measure-outcomes/route.ts` — Hourly Price Outcomes

**Files:**
- Create: `app/api/measure-outcomes/route.ts`

- [ ] **Step 1: Create the route**

```typescript
// app/api/measure-outcomes/route.ts
// Vercel Cron endpoint — runs every hour.
// Fills price_1h, price_4h, price_24h in signal_outcomes for signals whose
// windows have passed. Processes max 50 signals per tick (oldest first).
// Also backfills confirming_recipe_ids for newly written signal_outcomes rows.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { fetchAllMids } from "@/lib/hyperliquid-api-client";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET } from "@/lib/env";
import { getRecipeConfig } from "@/lib/recipe-config";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const BATCH_SIZE = 50;
const ONE_HOUR_MS   = 60 * 60 * 1000;
const FOUR_HOURS_MS = 4 * ONE_HOUR_MS;
const ONE_DAY_MS    = 24 * ONE_HOUR_MS;

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (CRON_SECRET) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const now = Date.now();
  const stats = { filled_1h: 0, filled_4h: 0, filled_24h: 0, wins: 0 };

  try {
    // ── 1. Load WIN_THRESHOLD_PCT ──────────────────────────────────────────────
    const globalCfg = await getRecipeConfig("global");
    const WIN_THRESHOLD = globalCfg["WIN_THRESHOLD_PCT"] ?? 0.005;

    // ── 2. Fetch signal_outcomes with at least one unfilled window ────────────
    // Query signal_outcomes directly (not via signal_events) so the .or() filter
    // works reliably on first-class columns. Join signal_events for coin/direction.
    // Look back at most 25h — signals older with nulls are stale (cron was down).
    const cutoffIso = new Date(now - 25 * ONE_HOUR_MS).toISOString();

    const { data: pendingEvents, error: eventsError } = await supabase
      .from("signal_outcomes")
      .select(`
        signal_id, price_at_fire, price_1h, price_4h, price_24h,
        direction_ok_4h, price_win, confirming_recipe_ids,
        signal_events!inner(id, coin, direction, fired_at)
      `)
      .or("price_1h.is.null,price_4h.is.null,price_24h.is.null")
      .gte("signal_events.fired_at", cutoffIso)
      .order("signal_events.fired_at", { ascending: true })
      .limit(BATCH_SIZE);

    if (eventsError) {
      return NextResponse.json({ error: eventsError.message }, { status: 500 });
    }
    if (!pendingEvents || pendingEvents.length === 0) {
      return NextResponse.json({ ok: true, processed: 0, ...stats });
    }

    // ── 3. Fetch current prices for all coins in batch ─────────────────────────
    const allMids = await fetchAllMids();

    // ── 4. Process each signal ─────────────────────────────────────────────────
    for (const row of pendingEvents) {
      const event = Array.isArray(row.signal_events) ? row.signal_events[0] : row.signal_events;
      if (!event) continue;

      const firedAt  = new Date(event.fired_at).getTime();
      const elapsed  = now - firedAt;
      const coinMid  = parseFloat(allMids[event.coin] ?? "0");
      if (coinMid === 0) continue;

      const firePrice = row.price_at_fire;
      const update: Record<string, unknown> = { measured_at: new Date().toISOString() };

      if (elapsed >= ONE_HOUR_MS && row.price_1h === null) {
        const move = (coinMid - firePrice) / firePrice;
        update.price_1h     = coinMid;
        update.move_pct_1h  = move;
        stats.filled_1h++;
      }

      if (elapsed >= FOUR_HOURS_MS && row.price_4h === null) {
        const move = (coinMid - firePrice) / firePrice;
        const signedMove = event.direction === "SHORT" ? -move : move;
        const dirOk = signedMove > 0;

        update.price_4h        = coinMid;
        update.move_pct_4h     = move;
        update.direction_ok_4h = dirOk;
        update.price_win       = dirOk && Math.abs(move) > WIN_THRESHOLD;
        stats.filled_4h++;
        if (update.price_win) stats.wins++;

        // Backfill confirming_recipe_ids if not yet set
        if (row.confirming_recipe_ids.length === 0) {
          const windowStart = new Date(firedAt - 10 * 60 * 1000).toISOString();
          const windowEnd   = new Date(firedAt + 10 * 60 * 1000).toISOString();

          const { data: confirmers } = await supabase
            .from("signal_events")
            .select("recipe_id")
            .eq("coin", event.coin)
            .eq("direction", event.direction)
            .neq("id", event.id)
            .gte("fired_at", windowStart)
            .lte("fired_at", windowEnd);

          if (confirmers && confirmers.length > 0) {
            update.confirming_recipe_ids = confirmers.map((c) => c.recipe_id);
            update.confirmation_count    = confirmers.length;
          }
        }
      }

      if (elapsed >= ONE_DAY_MS && row.price_24h === null) {
        const move = (coinMid - firePrice) / firePrice;
        update.price_24h    = coinMid;
        update.move_pct_24h = move;
        stats.filled_24h++;
      }

      if (Object.keys(update).length > 1) {
        await supabase
          .from("signal_outcomes")
          .update(update)
          .eq("signal_id", row.signal_id);
      }
    }

    return NextResponse.json({ ok: true, processed: pendingEvents.length, ...stats });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[measure-outcomes] error:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add app/api/measure-outcomes/route.ts
git commit -m "feat: add measure-outcomes cron for hourly price outcome tracking"
```

---

## Task 7: Add Cron Schedule to `vercel.json`

**Files:**
- Modify: `vercel.json`

- [ ] **Step 1: Add the new cron**

```json
{
  "crons": [
    {
      "path": "/api/refresh-cohort",
      "schedule": "0 0 * * *"
    },
    {
      "path": "/api/measure-outcomes",
      "schedule": "0 * * * *"
    }
  ]
}
```

- [ ] **Step 2: Commit**

```bash
git add vercel.json
git commit -m "feat: add measure-outcomes hourly cron to vercel.json"
```

---

## Task 8: Wallet Outcome Resolution in `daily-wallet-scan.ts`

**Files:**
- Modify: `scripts/daily-wallet-scan.ts`

- [ ] **Step 1: Add wallet resolution function at the end of the script**

After the existing scan logic completes (before `process.exit(0)`), add a call to resolve open wallet outcomes:

```typescript
// Resolve wallet outcomes for open signal_outcomes rows
await resolveWalletOutcomes();
```

Add the function to the same file:

```typescript
async function resolveWalletOutcomes(): Promise<void> {
  console.log("[wallet-outcomes] resolving open signal outcomes...");

  // Fetch all signal_outcomes rows still marked OPEN
  const { data: openOutcomes, error } = await supabase
    .from("signal_outcomes")
    .select("signal_id, signal_events!inner(wallet_ids, coin, direction)")
    .eq("wallet_outcome", "OPEN")
    .limit(500);

  if (error || !openOutcomes || openOutcomes.length === 0) {
    console.log("[wallet-outcomes] no open outcomes to resolve");
    return;
  }

  // Collect all unique wallet IDs across open outcomes
  const allWalletIds = new Set<string>();
  for (const row of openOutcomes) {
    const event = Array.isArray(row.signal_events) ? row.signal_events[0] : row.signal_events;
    for (const wid of (event?.wallet_ids ?? [])) allWalletIds.add(wid);
  }

  // Fetch closed fills for those wallets from user_pnl_backtest
  const { data: backtestRows } = await supabase
    .from("user_pnl_backtest")
    .select("wallet_id, win_rate, avg_win_usd, avg_loss_usd, profit_factor")
    .in("wallet_id", [...allWalletIds]);

  const backtestByWallet = new Map(
    (backtestRows ?? []).map((r) => [r.wallet_id, r])
  );

  let resolved = 0;
  for (const row of openOutcomes) {
    const event = Array.isArray(row.signal_events) ? row.signal_events[0] : row.signal_events;
    if (!event?.wallet_ids?.length) continue;

    // Compute average return across triggering wallets using their win_rate as proxy
    // (exact per-signal fill matching requires fill history joins — v2 improvement)
    const walletReturns = event.wallet_ids
      .map((wid: string) => backtestByWallet.get(wid))
      .filter(Boolean)
      .map((bt: { win_rate: number; avg_win_usd: number; avg_loss_usd: number }) =>
        bt.win_rate > 0.5
          ? bt.avg_win_usd / Math.max(1, bt.avg_win_usd + Math.abs(bt.avg_loss_usd))
          : -(Math.abs(bt.avg_loss_usd) / Math.max(1, bt.avg_win_usd + Math.abs(bt.avg_loss_usd)))
      );

    if (walletReturns.length === 0) continue;

    const walletReturnAvg = walletReturns.reduce((a: number, b: number) => a + b, 0) / walletReturns.length;
    const walletOutcome   = walletReturnAvg > 0 ? "WIN" : "LOSS";

    const { error: updateError } = await supabase
      .from("signal_outcomes")
      .update({
        wallet_return_avg: walletReturnAvg,
        wallet_outcome:    walletOutcome,
      })
      .eq("signal_id", row.signal_id);

    if (!updateError) resolved++;
  }

  console.log(`[wallet-outcomes] resolved ${resolved} of ${openOutcomes.length} open outcomes`);
}
```

- [ ] **Step 2: Run typecheck on scripts**

```bash
npx tsc --noEmit --project tsconfig.json scripts/daily-wallet-scan.ts 2>&1 | head -20
```

Expected: no errors relevant to the new function

- [ ] **Step 3: Commit**

```bash
git add scripts/daily-wallet-scan.ts
git commit -m "feat: add wallet outcome resolution pass to daily-wallet-scan"
```

---

## Task 9: GitHub Actions Workflow for Signal Learning

**Files:**
- Create: `.github/workflows/signal-learning.yml`

- [ ] **Step 1: Create the workflow**

```yaml
# .github/workflows/signal-learning.yml
name: Signal Learning

on:
  schedule:
    - cron: '0 1 * * *'   # 01:00 UTC daily — runs after daily-wallet-scan at 00:00
  workflow_dispatch:        # manual trigger for testing

jobs:
  learn:
    runs-on: ubuntu-latest
    timeout-minutes: 20

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js 20
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run signal learning
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
          HYPERLIQUID_API_URL: ${{ secrets.HYPERLIQUID_API_URL }}
        run: npx tsx scripts/signal-learning.ts

      - name: Upload learning summary artifact
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: learning-summary-${{ github.run_id }}
          path: learning-summary.json
          retention-days: 14
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/signal-learning.yml
git commit -m "feat: add signal-learning GitHub Actions workflow (01:00 UTC)"
```

---

## Task 10: Stats Engine — Core Computation

**Files:**
- Create: `scripts/signal-learning.ts` (initial skeleton + win rate computation)
- Create: `lib/__tests__/signal-learning.test.ts`

- [ ] **Step 1: Write failing tests for pure computation functions**

```typescript
// lib/__tests__/signal-learning.test.ts
import { describe, it, expect } from "vitest";
import {
  computeWinRates,
  computeTrend,
  computeMeasuredEV,
  meetsMinSample,
  computeConfidence,
} from "../signal-learning-utils";

describe("computeWinRates", () => {
  it("returns correct win rates for 7d, 30d, 90d windows", () => {
    const now = Date.now();
    const outcomes = [
      { is_win: true,  fired_at: new Date(now - 2 * 86400_000).toISOString() },   // 2d ago
      { is_win: false, fired_at: new Date(now - 5 * 86400_000).toISOString() },   // 5d ago
      { is_win: true,  fired_at: new Date(now - 15 * 86400_000).toISOString() },  // 15d ago
      { is_win: false, fired_at: new Date(now - 15 * 86400_000).toISOString() },  // 15d ago
      { is_win: true,  fired_at: new Date(now - 60 * 86400_000).toISOString() },  // 60d ago
    ];
    const rates = computeWinRates(outcomes);
    expect(rates.win_rate_7d).toBeCloseTo(0.5, 1);    // 1 win / 2 signals in last 7d
    expect(rates.win_rate_30d).toBeCloseTo(0.5, 1);   // 2 wins / 4 signals in last 30d
    expect(rates.win_rate_90d).toBeCloseTo(0.6, 1);   // 3 wins / 5 signals in last 90d
  });

  it("returns null for windows with zero signals", () => {
    const rates = computeWinRates([]);
    expect(rates.win_rate_7d).toBeNull();
    expect(rates.win_rate_30d).toBeNull();
    expect(rates.win_rate_90d).toBeNull();
  });
});

describe("computeTrend", () => {
  it("returns DEGRADING when 7d rate is much lower than 90d rate", () => {
    expect(computeTrend(0.30, 0.70)).toBe("DEGRADING");
  });

  it("returns IMPROVING when 7d rate is much higher than 90d rate", () => {
    expect(computeTrend(0.75, 0.40)).toBe("IMPROVING");
  });

  it("returns STABLE when rates are within 10%", () => {
    expect(computeTrend(0.55, 0.50)).toBe("STABLE");
  });

  it("returns INSUFFICIENT_DATA when either value is null", () => {
    expect(computeTrend(null, 0.50)).toBe("INSUFFICIENT_DATA");
    expect(computeTrend(0.50, null)).toBe("INSUFFICIENT_DATA");
  });
});

describe("computeMeasuredEV", () => {
  it("computes ev = win_rate * avg_win + (1-win_rate) * avg_loss", () => {
    // 60% win rate, avg win +2%, avg loss -1%
    expect(computeMeasuredEV(0.60, 0.02, -0.01)).toBeCloseTo(0.60 * 0.02 + 0.40 * -0.01);
  });

  it("returns null when inputs are null", () => {
    expect(computeMeasuredEV(null, 0.02, -0.01)).toBeNull();
  });
});

describe("meetsMinSample", () => {
  it("returns true for 30+ samples", () => {
    expect(meetsMinSample(30)).toBe(true);
    expect(meetsMinSample(100)).toBe(true);
  });
  it("returns false for under 30 samples", () => {
    expect(meetsMinSample(29)).toBe(false);
    expect(meetsMinSample(0)).toBe(false);
  });
});

describe("computeConfidence", () => {
  it("returns higher confidence for larger samples", () => {
    const c30  = computeConfidence(30, 0.70);
    const c100 = computeConfidence(100, 0.70);
    expect(c100).toBeGreaterThan(c30);
  });

  it("returns value between 0 and 1", () => {
    const c = computeConfidence(50, 0.65);
    expect(c).toBeGreaterThanOrEqual(0);
    expect(c).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test -- signal-learning
```

Expected: FAIL — `Cannot find module '../signal-learning-utils'`

- [ ] **Step 3: Create `lib/signal-learning-utils.ts`** (pure computation — no Supabase)

```typescript
// lib/signal-learning-utils.ts
// Pure stateless functions for the signal learning stats engine.
// No I/O — all inputs are plain data. Tested directly by Vitest.

export interface OutcomeRow {
  is_win:   boolean | null;
  fired_at: string;
}

export interface WinRates {
  win_rate_7d:  number | null;
  win_rate_30d: number | null;
  win_rate_90d: number | null;
}

export function computeWinRates(outcomes: OutcomeRow[]): WinRates {
  const now = Date.now();
  const resolved = outcomes.filter((o) => o.is_win !== null);

  function winRate(days: number): number | null {
    const cutoff = now - days * 86400_000;
    const window = resolved.filter((o) => new Date(o.fired_at).getTime() >= cutoff);
    if (window.length === 0) return null;
    return window.filter((o) => o.is_win).length / window.length;
  }

  return {
    win_rate_7d:  winRate(7),
    win_rate_30d: winRate(30),
    win_rate_90d: winRate(90),
  };
}

export function computeTrend(
  winRate7d:  number | null,
  winRate90d: number | null
): "IMPROVING" | "DEGRADING" | "STABLE" | "INSUFFICIENT_DATA" {
  if (winRate7d === null || winRate90d === null) return "INSUFFICIENT_DATA";
  const delta = winRate7d - winRate90d;
  if (delta > 0.10) return "IMPROVING";
  if (delta < -0.10) return "DEGRADING";
  return "STABLE";
}

export function computeMeasuredEV(
  winRate:  number | null,
  avgWin:   number | null,
  avgLoss:  number | null
): number | null {
  if (winRate === null || avgWin === null || avgLoss === null) return null;
  return winRate * avgWin + (1 - winRate) * avgLoss;
}

export function meetsMinSample(sampleSize: number): boolean {
  return sampleSize >= 30;
}

/**
 * Approximate statistical confidence using Wilson score interval.
 * Returns a 0-1 value: how confident we are the win rate is real, not noise.
 */
export function computeConfidence(sampleSize: number, winRate: number): number {
  if (sampleSize === 0) return 0;
  const z = 1.645; // 90% confidence z-score
  const p = winRate;
  const n = sampleSize;
  const centre = (p + (z * z) / (2 * n)) / (1 + (z * z) / n);
  const margin  = (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n)) / (1 + (z * z) / n);
  // confidence = how far the lower bound is from 0.5 (i.e. random)
  const lowerBound = centre - margin;
  return Math.min(1, Math.max(0, Math.abs(lowerBound - 0.5) * 2));
}

export function computeWinRateByRegime(
  outcomes: (OutcomeRow & { regime_at_fire: string })[]
): Record<string, number | null> {
  const regimes = ["BULL", "BEAR", "RANGING"];
  const now = Date.now();
  const cutoff = now - 30 * 86400_000;
  const recent = outcomes.filter((o) => new Date(o.fired_at).getTime() >= cutoff);

  const result: Record<string, number | null> = {};
  for (const regime of regimes) {
    const inRegime = recent.filter((o) => o.regime_at_fire === regime && o.is_win !== null);
    result[regime] = inRegime.length > 0
      ? inRegime.filter((o) => o.is_win).length / inRegime.length
      : null;
  }
  return result;
}

export function dominantRegime(
  outcomes: (OutcomeRow & { regime_at_fire: string })[]
): string | null {
  const now = Date.now();
  const cutoff = now - 30 * 86400_000;
  const recent = outcomes.filter((o) => new Date(o.fired_at).getTime() >= cutoff);
  if (recent.length === 0) return null;

  const counts: Record<string, number> = {};
  for (const o of recent) counts[o.regime_at_fire] = (counts[o.regime_at_fire] ?? 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}
```

- [ ] **Step 4: Run tests**

```bash
npm run test -- signal-learning
```

Expected: PASS (all tests)

- [ ] **Step 5: Create `scripts/signal-learning.ts` skeleton**

```typescript
// scripts/signal-learning.ts
// Nightly stats engine. Called by GitHub Actions at 01:00 UTC.
// Reads signal_outcomes, computes performance findings per recipe × regime,
// writes to agent_findings. (Claude agent integration added in Phase 2 plan.)

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs/promises";
import {
  computeWinRates,
  computeTrend,
  computeMeasuredEV,
  meetsMinSample,
  computeConfidence,
  computeWinRateByRegime,
  dominantRegime,
} from "../lib/signal-learning-utils";

const SUPABASE_URL             = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("FATAL: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ─────────────────────────────────────────────────────────────────────────────
// Cold start guard
// ─────────────────────────────────────────────────────────────────────────────

async function checkColdStart(): Promise<boolean> {
  const { count } = await supabase
    .from("signal_outcomes")
    .select("*", { count: "exact", head: true });

  const { data: oldest } = await supabase
    .from("signal_events")
    .select("fired_at")
    .order("fired_at", { ascending: true })
    .limit(1);

  const totalRows = count ?? 0;
  const oldestDate = oldest?.[0]?.fired_at ? new Date(oldest[0].fired_at) : null;
  const daysOld = oldestDate
    ? (Date.now() - oldestDate.getTime()) / 86400_000
    : 0;

  if (totalRows < 100 || daysOld < 30) {
    console.log(
      `[signal-learning] Cold start guard: ${totalRows} outcomes, ${daysOld.toFixed(1)} days of data. Monitoring only — no changes permitted.`
    );
    await writeAgentLog({
      log_type: "OBSERVATION",
      recipe_id: null,
      summary: `Cold start: ${totalRows} outcomes over ${daysOld.toFixed(1)} days. Minimum 100 outcomes and 30 days required.`,
      content: `Insufficient history for learning. Accumulated ${totalRows} resolved signal outcomes over ${daysOld.toFixed(1)} days. Minimum thresholds: 100 outcomes, 30 days. Will monitor and re-evaluate tomorrow.`,
      agent_confidence: null,
    });
    return true; // is cold start
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stats engine
// ─────────────────────────────────────────────────────────────────────────────

async function runStatsEngine(): Promise<void> {
  console.log("[signal-learning] running stats engine...");

  // Pull all resolved signal_outcomes joined with signal_events (last 90 days)
  const cutoff90d = new Date(Date.now() - 90 * 86400_000).toISOString();

  const { data: rows, error } = await supabase
    .from("signal_outcomes")
    .select(`
      signal_id, price_win, is_win, move_pct_4h, wallet_return_avg, wallet_outcome,
      signal_events!inner(
        recipe_id, coin, direction, fired_at, regime_at_fire, active_config
      )
    `)
    .not("price_win", "is", null)
    .gte("signal_events.fired_at", cutoff90d);

  if (error || !rows) {
    console.error("[signal-learning] query error:", error?.message);
    return;
  }

  // Group by recipe_id
  const byRecipe = new Map<string, typeof rows>();
  for (const row of rows) {
    const event = Array.isArray(row.signal_events) ? row.signal_events[0] : row.signal_events;
    const rid   = event?.recipe_id;
    if (!rid) continue;
    if (!byRecipe.has(rid)) byRecipe.set(rid, []);
    byRecipe.get(rid)!.push(row);
  }

  const findingRows: Record<string, unknown>[] = [];

  for (const [recipeId, recipeRows] of byRecipe) {
    // Build outcome arrays with metadata for utility functions
    const outcomes = recipeRows.map((r) => {
      const event = Array.isArray(r.signal_events) ? r.signal_events[0] : r.signal_events;
      return {
        is_win:          r.is_win ?? r.price_win,  // fall back to price_win if is_win not yet set
        fired_at:        event?.fired_at ?? new Date().toISOString(),
        regime_at_fire:  event?.regime_at_fire ?? "RANGING",
        move_pct_4h:     r.move_pct_4h,
      };
    });

    const { win_rate_7d, win_rate_30d, win_rate_90d } = computeWinRates(outcomes);
    const trend       = computeTrend(win_rate_7d, win_rate_90d);
    const sampleSize  = outcomes.filter((o) => o.is_win !== null).length;
    const confidence  = computeConfidence(sampleSize, win_rate_30d ?? 0.5);

    // Compute avg win/loss pct from move_pct_4h
    const wins   = outcomes.filter((o) => o.is_win && o.move_pct_4h !== null);
    const losses = outcomes.filter((o) => o.is_win === false && o.move_pct_4h !== null);
    const avgWin  = wins.length > 0
      ? wins.reduce((s, o) => s + (o.move_pct_4h ?? 0), 0) / wins.length
      : null;
    const avgLoss = losses.length > 0
      ? losses.reduce((s, o) => s + (o.move_pct_4h ?? 0), 0) / losses.length
      : null;

    const measuredEV = computeMeasuredEV(win_rate_30d, avgWin, avgLoss);
    const winsByRegime = computeWinRateByRegime(outcomes as Parameters<typeof computeWinRateByRegime>[0]);
    const dominant = dominantRegime(outcomes as Parameters<typeof dominantRegime>[0]);

    // Classify finding type
    let findingType = "STABLE";
    if (!meetsMinSample(sampleSize)) findingType = "INSUFFICIENT_DATA";
    else if (trend === "DEGRADING" && confidence > 0.70) findingType = "UNDERPERFORMING";
    else if (trend === "IMPROVING") findingType = "IMPROVING";

    findingRows.push({
      recipe_id:               recipeId,
      regime:                  "ALL",
      period_days:             90,
      sample_size:             sampleSize,
      meets_min_sample:        meetsMinSample(sampleSize),
      confidence,
      win_rate_7d,
      win_rate_30d,
      win_rate_90d,
      trend,
      avg_win_pct:             avgWin,
      avg_loss_pct:            avgLoss,
      measured_ev:             measuredEV,
      baseline_ev:             null,      // Phase 2: compute from historical coin drift
      vs_baseline_ev:          null,
      win_rate_by_regime:      winsByRegime,
      dominant_regime_last_30d: dominant,
      finding_type:            findingType,
      recommendation:          null,      // Phase 2: Claude agent sets this
      rec_param:               null,
      rec_value:               null,
    });

    console.log(
      `[signal-learning] ${recipeId}: n=${sampleSize}, wr7d=${win_rate_7d?.toFixed(2)}, ` +
      `wr30d=${win_rate_30d?.toFixed(2)}, wr90d=${win_rate_90d?.toFixed(2)}, ` +
      `trend=${trend}, finding=${findingType}`
    );
  }

  // Write findings to Supabase
  if (findingRows.length > 0) {
    const { error: insertError } = await supabase
      .from("agent_findings")
      .insert(findingRows);

    if (insertError) {
      console.error("[signal-learning] findings insert error:", insertError.message);
    } else {
      console.log(`[signal-learning] wrote ${findingRows.length} agent_findings rows`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent log writer (used by cold start and future Claude agent integration)
// ─────────────────────────────────────────────────────────────────────────────

async function writeAgentLog(entry: {
  log_type: string;
  recipe_id: string | null;
  summary: string;
  content: string;
  agent_confidence: number | null;
  action_taken?: string;
}): Promise<string | null> {
  const { data, error } = await supabase
    .from("agent_log")
    .insert({
      log_type:         entry.log_type,
      recipe_id:        entry.recipe_id,
      summary:          entry.summary,
      content:          entry.content,
      agent_confidence: entry.agent_confidence,
      action_taken:     entry.action_taken ?? null,
    })
    .select("log_id")
    .single();

  if (error) {
    console.error("[signal-learning] agent_log insert error:", error.message);
    return null;
  }
  return data?.log_id ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("[signal-learning] starting...");
  const startMs = Date.now();

  const isColdStart = await checkColdStart();

  if (!isColdStart) {
    await runStatsEngine();
  }

  const summary = {
    ran_at:         new Date().toISOString(),
    cold_start:     isColdStart,
    duration_ms:    Date.now() - startMs,
  };

  await fs.writeFile("learning-summary.json", JSON.stringify(summary, null, 2));
  console.log("[signal-learning] done.", summary);
}

main().catch((err) => {
  console.error("[signal-learning] fatal:", err);
  process.exit(1);
});
```

- [ ] **Step 6: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 7: Run tests**

```bash
npm run test
```

Expected: all tests pass including new signal-learning tests

- [ ] **Step 8: Commit**

```bash
git add lib/signal-learning-utils.ts scripts/signal-learning.ts lib/__tests__/signal-learning.test.ts
git commit -m "feat: add stats engine with win rate, EV, trend computation"
```

---

## Task 11: End-to-End Smoke Test

- [ ] **Step 1: Deploy to Vercel preview**

```bash
git push origin main
```

Vercel will build and deploy automatically.

- [ ] **Step 2: Trigger refresh-cohort manually**

```bash
curl -X POST https://<your-vercel-url>/api/refresh-cohort
```

Expected response: `{ "ok": true, "signal_count": N, ... }`

- [ ] **Step 3: Verify signal_events rows in Supabase**

Check the `signal_events` table in Supabase Table Editor within 30 seconds of the request. Rows should appear with `active_config` populated and `regime_at_fire` set.

- [ ] **Step 4: Trigger measure-outcomes manually**

```bash
curl https://<your-vercel-url>/api/measure-outcomes
```

Expected: `{ "ok": true, "processed": N }` — even if 0 signals have aged past their windows yet.

- [ ] **Step 5: Trigger signal-learning manually via GitHub Actions**

Go to Actions → Signal Learning → Run workflow. Verify the run completes and the artifact `learning-summary.json` shows `cold_start: true` (expected for first run, no data yet).

- [ ] **Step 6: Final typecheck and test run**

```bash
npm run typecheck && npm run test
```

Expected: no errors, all tests pass.

---

## Summary

Phase 1 delivers:
- All 6 Supabase tables created and indexed
- Every signal fired is persisted to `signal_events` with dedup, active config snapshot, and market context
- `signal_outcomes` initialised at fire time, price windows filled hourly
- Wallet outcomes resolved nightly alongside the existing wallet scan
- Recipe thresholds readable from `agent_config` at runtime — agent can tune them without code changes
- Stats engine computes win rates, EV, and trend per recipe nightly and writes `agent_findings`
- Cold start guard: no changes permitted until 100 outcomes + 30 days of data

Phase 2 plan (Claude agent + `/agent` page + VSCode skill) to follow once outcome data is flowing.
