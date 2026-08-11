// Golden-fixture tests for the six surviving signal recipes.
//
// Each recipe gets one fixture that must fire and one near-miss fixture that
// must not. momentum_stack gets a third case proving it still fires when the
// snapshot pair gap is a realistic 8 minutes, which the old fixed 300s window
// silently failed (audit 2026-08-08).
//
// Recipes are driven directly rather than through runSignalLab so the Supabase
// and KV write path stays out of the way. getRecipeConfig is mocked to return
// an empty config, which makes every recipe fall back to its coded defaults.

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-key",
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(function (this: unknown) { return this; }),
      insert: vi.fn(() => Promise.resolve({ data: [], error: null })),
      eq:  vi.fn(function (this: unknown) { return this; }),
      gte: vi.fn(function (this: unknown) { return this; }),
      not: vi.fn(() => Promise.resolve({ data: [], error: null })),
    })),
  })),
}));

vi.mock("@vercel/kv", () => ({
  kv: {
    get: vi.fn(() => Promise.resolve(null)),
    set: vi.fn(() => Promise.resolve("OK")),
    del: vi.fn(() => Promise.resolve(1)),
  },
}));

// Empty config => every recipe uses its hardcoded defaults, so the fixtures
// stay deterministic regardless of what sits in agent_config.
vi.mock("@/lib/recipe-config", () => ({
  getRecipeConfig: vi.fn(() => Promise.resolve({} as Record<string, number>)),
}));

import {
  medianPairGap,
  momentumStackRecipe,
  divergenceSqueezeRecipe,
  accumulationReentryRecipe,
  rotationCarryRecipe,
  fundingDivergenceRecipe,
  whaleValidatedRecipe,
  type SnapshotPair,
  type SnapshotRow,
  type CohortPosition,
  type SignalEvent,
} from "../signal-lab";
import type { HlCandle, HlAssetCtx } from "../hyperliquid-api-client";

// ─────────────────────────────────────────────────────────────────────────────
// Fixture factory
// ─────────────────────────────────────────────────────────────────────────────

/** Fixed clock so every fixture is reproducible. */
const BASE_TIME_MS = Date.parse("2026-08-08T12:00:00.000Z");

interface PositionSpec {
  coin: string;
  /** Signed size. Positive = LONG, negative = SHORT. */
  szi: number;
  /** Absolute notional, matching Hyperliquid's unsigned positionValue. */
  notional: number;
  entryPx?: number;
  leverage?: number;
}

function makePosition(spec: PositionSpec): CohortPosition {
  return {
    position: {
      coin:          spec.coin,
      szi:           String(spec.szi),
      entryPx:       String(spec.entryPx ?? 100),
      positionValue: String(spec.notional),
      unrealizedPnl: "0",
      leverage:      { type: "cross", value: spec.leverage ?? 3 },
      liquidationPx: null,
    },
    type: "oneWay",
  };
}

interface SnapshotSpec {
  id: string;
  walletId: string;
  walletAddress: string;
  score: number;
  timeMs: number;
  positions: PositionSpec[];
  liqBuffer: number | null;
}

function makeSnapshot(spec: SnapshotSpec): SnapshotRow {
  const positions = spec.positions.map(makePosition);
  const totalNotional = spec.positions.reduce((s, p) => s + Math.abs(p.notional), 0);
  return {
    id:                spec.id,
    wallet_id:         spec.walletId,
    wallet_address:    spec.walletAddress,
    overall_score:     spec.score,
    snapshot_time:     new Date(spec.timeMs).toISOString(),
    account_value:     1_000_000,
    total_notional:    totalNotional,
    total_margin_used: totalNotional / 3,
    liq_buffer_pct:    spec.liqBuffer,
    position_count:    positions.length,
    positions,
    sharpe_proxy:      0.7,
    regime_fit:        0.5,
  };
}

interface PairSpec {
  /** Any stable string. Recipes treat it opaquely. */
  walletId?: string;
  score?: number;
  /** Current open positions. */
  curr: PositionSpec[];
  /** Previous open positions. Pass null to model a wallet with no prior snapshot. */
  prev?: PositionSpec[] | null;
  /** Milliseconds between prev and curr snapshot_time. Default 60s. */
  gapMs?: number;
  /** curr.liq_buffer_pct. Default 0.5, which is comfortably above every gate. */
  liqBuffer?: number | null;
}

function makePair(spec: PairSpec): SnapshotPair {
  const walletId = spec.walletId ?? "11111111-1111-1111-1111-111111111111";
  const address  = `0x${walletId.replace(/-/g, "").slice(0, 40)}`;
  const score    = spec.score ?? 0.8;
  const gapMs    = spec.gapMs ?? 60_000;
  const liqBuffer = spec.liqBuffer === undefined ? 0.5 : spec.liqBuffer;

  const curr = makeSnapshot({
    id:            `${walletId}-curr`,
    walletId,
    walletAddress: address,
    score,
    timeMs:        BASE_TIME_MS,
    positions:     spec.curr,
    liqBuffer,
  });

  const prev =
    spec.prev === null
      ? null
      : makeSnapshot({
          id:            `${walletId}-prev`,
          walletId,
          walletAddress: address,
          score,
          timeMs:        BASE_TIME_MS - gapMs,
          positions:     spec.prev ?? [],
          liqBuffer,
        });

  return { walletId, walletAddress: address, overallScore: score, curr, prev };
}

/** Build n pairs that differ only by wallet id, via a per-index spec. */
function makePairs(n: number, build: (i: number) => PairSpec): SnapshotPair[] {
  return Array.from({ length: n }, (_, i) => {
    const spec = build(i);
    const digit = String(i + 1);
    return makePair({
      ...spec,
      walletId: spec.walletId ?? `${digit.repeat(8)}-${digit.repeat(4)}-${digit.repeat(4)}-${digit.repeat(4)}-${digit.repeat(12)}`,
    });
  });
}

function makeCandle(o: { c: number; h?: number; l?: number; tMs?: number }): HlCandle {
  const t = o.tMs ?? BASE_TIME_MS;
  return {
    t,
    T: t + 300_000,
    s: "BTC",
    i: "5m",
    o: String(o.c),
    c: String(o.c),
    h: String(o.h ?? o.c),
    l: String(o.l ?? o.c),
    v: "1000",
    n: 10,
  };
}

function makeAssetCtx(funding: number, openInterest = 5_000_000): HlAssetCtx {
  return {
    dayNtlVlm:    "100000000",
    funding:      String(funding),
    impactPxs:    ["100", "100.1"],
    markPx:       "100",
    midPx:        "100",
    openInterest: String(openInterest),
    oraclePx:     "100",
    premium:      "0",
    prevDayPx:    "99",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// medianPairGap
// ─────────────────────────────────────────────────────────────────────────────

describe("medianPairGap", () => {
  it("returns the middle gap for an odd count", () => {
    const pairs = [
      makePair({ curr: [], gapMs: 120_000 }),
      makePair({ curr: [], gapMs: 300_000 }),
      makePair({ curr: [], gapMs: 900_000 }),
    ];
    expect(medianPairGap(pairs)).toBe(300_000);
  });

  it("averages the two middle gaps for an even count", () => {
    const pairs = [
      makePair({ curr: [], gapMs: 100_000 }),
      makePair({ curr: [], gapMs: 200_000 }),
      makePair({ curr: [], gapMs: 400_000 }),
      makePair({ curr: [], gapMs: 800_000 }),
    ];
    expect(medianPairGap(pairs)).toBe(300_000);
  });

  it("returns 0 when no pair has a prev snapshot", () => {
    const pairs = [
      makePair({ curr: [], prev: null }),
      makePair({ curr: [], prev: null }),
    ];
    expect(medianPairGap(pairs)).toBe(0);
  });

  it("ignores pairs without a prev when computing the median", () => {
    const pairs = [
      makePair({ curr: [], prev: null }),
      makePair({ curr: [], gapMs: 480_000 }),
    ];
    expect(medianPairGap(pairs)).toBe(480_000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Recipe 1: momentum_stack
// ─────────────────────────────────────────────────────────────────────────────

describe("momentum_stack", () => {
  /** 3 wallets each adding $200K of BTC long => $600K combined, over the $500K bar. */
  const stackingPairs = (gapMs: number) =>
    makePairs(3, () => ({
      curr:  [{ coin: "BTC", szi: 3, notional: 300_000 }],
      prev:  [{ coin: "BTC", szi: 1, notional: 100_000 }],
      gapMs,
    }));

  it("fires when 3 wallets add a combined $600K long on BTC", async () => {
    const events = await momentumStackRecipe(stackingPairs(60_000), 0);
    expect(events).toHaveLength(1);
    expect(events[0].recipe_id).toBe("momentum_stack");
    expect(events[0].coin).toBe("BTC");
    expect(events[0].direction).toBe("LONG");
    expect(events[0].signal_type).toBe("ENTRY");
    expect(events[0].metadata.wallet_count).toBe(3);
    expect(events[0].metadata.combined_delta).toBe(600_000);
  });

  it("does not fire with only 2 wallets, one short of the convergence threshold", async () => {
    const pairs = makePairs(2, () => ({
      curr:  [{ coin: "BTC", szi: 10, notional: 1_000_000 }],
      prev:  [{ coin: "BTC", szi: 1, notional: 100_000 }],
      gapMs: 60_000,
    }));
    const events = await momentumStackRecipe(pairs, 0);
    expect(events).toHaveLength(0);
  });

  it("does not fire when combined notional lands just under the tier threshold", async () => {
    // 3 wallets x $166K = $498K, $2K short of the $500K MAJOR-tier bar.
    const pairs = makePairs(3, () => ({
      curr:  [{ coin: "BTC", szi: 3, notional: 266_000 }],
      prev:  [{ coin: "BTC", szi: 1, notional: 100_000 }],
      gapMs: 60_000,
    }));
    const events = await momentumStackRecipe(pairs, 0);
    expect(events).toHaveLength(0);
  });

  it("fires at a realistic 8 minute pair gap once the window tracks the observed cadence", async () => {
    const EIGHT_MIN = 8 * 60_000;
    const pairs = stackingPairs(EIGHT_MIN);

    // Regression guard: with the old fixed 300s window, an 8 minute gap was
    // discarded outright, so the recipe never fired in production.
    const withFixedWindow = await momentumStackRecipe(pairs, 0);
    expect(withFixedWindow).toHaveLength(0);

    // With the measured cadence fed in, the window widens to 2x the median gap
    // and the same fixture fires.
    const medianGap = medianPairGap(pairs);
    expect(medianGap).toBe(EIGHT_MIN);

    const events = await momentumStackRecipe(pairs, medianGap);
    expect(events).toHaveLength(1);
    expect(events[0].recipe_id).toBe("momentum_stack");
    expect(events[0].coin).toBe("BTC");
    expect(events[0].direction).toBe("LONG");
  });

  it("caps the widened window at MAX_PAIR_WINDOW_MS", async () => {
    const THREE_HOURS = 3 * 60 * 60 * 1000;
    const pairs = stackingPairs(THREE_HOURS);
    const events = await momentumStackRecipe(pairs, medianPairGap(pairs));
    expect(events).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Recipe 2: divergence_squeeze
// ─────────────────────────────────────────────────────────────────────────────

describe("divergence_squeeze", () => {
  // 6 x 5m candles moving 0.1%, comfortably inside the 0.5% flat band.
  const flatCandles = new Map<string, HlCandle[]>([
    ["BTC", [
      makeCandle({ c: 100_000 }),
      makeCandle({ c: 100_020 }),
      makeCandle({ c: 100_010 }),
      makeCandle({ c: 100_040 }),
      makeCandle({ c: 100_030 }),
      makeCandle({ c: 100_050 }),
    ]],
  ]);

  const loadingPairs = (count: number) =>
    makePairs(count, () => ({
      score:     0.75,          // above the 0.65 conviction floor
      liqBuffer: 0.05,          // under the 0.08 thin-margin gate
      curr:      [{ coin: "BTC", szi: 1, notional: 120_000 }],
      prev:      [],            // no prior BTC position => full $120K delta
    }));

  it("fires when 3 thin-margin wallets load BTC while price is flat", async () => {
    const events = await divergenceSqueezeRecipe(loadingPairs(3), flatCandles);
    expect(events).toHaveLength(1);
    expect(events[0].recipe_id).toBe("divergence_squeeze");
    expect(events[0].coin).toBe("BTC");
    expect(events[0].direction).toBe("LONG");
    expect(events[0].signal_type).toBe("ALERT");
    expect(events[0].metadata.wallet_count).toBe(3);
  });

  it("does not fire with only 2 loading wallets", async () => {
    const events = await divergenceSqueezeRecipe(loadingPairs(2), flatCandles);
    expect(events).toHaveLength(0);
  });

  it("does not fire when each wallet's delta is just under the tier threshold", async () => {
    const pairs = makePairs(3, () => ({
      score:     0.75,
      liqBuffer: 0.05,
      curr:      [{ coin: "BTC", szi: 1, notional: 74_000 }], // $1K short of $75K
      prev:      [],
    }));
    const events = await divergenceSqueezeRecipe(pairs, flatCandles);
    expect(events).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Recipe 3: accumulation_reentry
// ─────────────────────────────────────────────────────────────────────────────

describe("accumulation_reentry", () => {
  // High 100, last close 80 => 20% drawdown, over the 15% ceiling threshold.
  const drawdownCandles = new Map<string, HlCandle[]>([
    ["BTC", [
      makeCandle({ c: 100, h: 100, l: 100 }),
      makeCandle({ c: 99,  h: 99,  l: 99 }),
      makeCandle({ c: 80,  h: 80,  l: 80 }),
    ]],
  ]);

  it("fires when a high-score wallet grows a BTC long into the drawdown", async () => {
    const pairs = [
      makePair({
        score: 0.8,
        curr:  [{ coin: "BTC", szi: 1.5, notional: 150_000 }],
        prev:  [{ coin: "BTC", szi: 1.0, notional: 100_000 }],
      }),
    ];
    const events = await accumulationReentryRecipe(pairs, drawdownCandles);
    expect(events).toHaveLength(1);
    expect(events[0].recipe_id).toBe("accumulation_reentry");
    expect(events[0].coin).toBe("BTC");
    expect(events[0].direction).toBe("LONG");
    expect(events[0].signal_type).toBe("SCALE_IN");
  });

  it("does not fire when the position grew by only 3%, under the 5% bar", async () => {
    const pairs = [
      makePair({
        score: 0.8,
        curr:  [{ coin: "BTC", szi: 1.03, notional: 103_000 }],
        prev:  [{ coin: "BTC", szi: 1.00, notional: 100_000 }],
      }),
    ];
    const events = await accumulationReentryRecipe(pairs, drawdownCandles);
    expect(events).toHaveLength(0);
  });

  it("does not fire when the wallet score is under the 0.65 floor", async () => {
    const pairs = [
      makePair({
        score: 0.6,
        curr:  [{ coin: "BTC", szi: 1.5, notional: 150_000 }],
        prev:  [{ coin: "BTC", szi: 1.0, notional: 100_000 }],
      }),
    ];
    const events = await accumulationReentryRecipe(pairs, drawdownCandles);
    expect(events).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Recipe 4: rotation_carry
// ─────────────────────────────────────────────────────────────────────────────

describe("rotation_carry", () => {
  const newEntryPairs = () => [
    makePair({
      curr: [{ coin: "BTC", szi: 2, notional: 200_000 }],
      prev: [],   // no prior BTC position => this is a fresh entry
    }),
  ];

  it("fires on a new position in a positive-funding perp", async () => {
    const ctx = new Map([["BTC", makeAssetCtx(0.0005)]]);
    const events = await rotationCarryRecipe(newEntryPairs(), ctx, new Map(), new Map());
    expect(events).toHaveLength(1);
    expect(events[0].recipe_id).toBe("rotation_carry");
    expect(events[0].coin).toBe("BTC");
    expect(events[0].direction).toBe("LONG");
    expect(events[0].signal_type).toBe("ENTRY");
  });

  it("does not fire when funding sits just under the 0.03% minimum", async () => {
    const ctx = new Map([["BTC", makeAssetCtx(0.00029)]]);
    const events = await rotationCarryRecipe(newEntryPairs(), ctx, new Map(), new Map());
    expect(events).toHaveLength(0);
  });

  it("does not fire once bootstrapped and the historical net win rate is under 60%", async () => {
    const ctx = new Map([["BTC", makeAssetCtx(0.0005)]]);
    const events = await rotationCarryRecipe(
      newEntryPairs(),
      ctx,
      new Map([["rotation_carry", 0.45]]),
      new Map([["rotation_carry", 25]]),
    );
    expect(events).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Recipe 7: funding_divergence
// ─────────────────────────────────────────────────────────────────────────────

describe("funding_divergence", () => {
  /** Cohort flips from long to short while funding keeps implying a long crowd. */
  const flipsShort = () =>
    makePairs(2, () => ({
      curr: [{ coin: "BTC", szi: -2, notional: 200_000 }],
      prev: [{ coin: "BTC", szi:  2, notional: 200_000 }],
    }));

  it("fires when the cohort flips onto the side opposite the funding-implied crowd", async () => {
    const ctx = new Map([["BTC", makeAssetCtx(0.0009)]]);
    const events = await fundingDivergenceRecipe(flipsShort(), ctx);
    expect(events).toHaveLength(1);
    expect(events[0].recipe_id).toBe("funding_divergence");
    expect(events[0].coin).toBe("BTC");
    expect(events[0].direction).toBe("SHORT");
    expect(events[0].signal_type).toBe("ALERT");
    expect(events[0].metadata.crowd_bias).toBe("LONG");
  });

  it("does not fire again while the cohort simply holds the divergent position", async () => {
    // One wallet held a divergent KAITO long for 13.5 hours and this recipe
    // re-emitted it on all 83 polls, one every 10 minutes. Those were not 83
    // signals, they were one position sampled 83 times, and they swamped every
    // downstream statistic.
    const heldShort = makePairs(2, () => ({
      curr: [{ coin: "BTC", szi: -2, notional: 200_000 }],
      prev: [{ coin: "BTC", szi: -2, notional: 200_000 }],
    }));
    const ctx = new Map([["BTC", makeAssetCtx(0.0009)]]);
    const events = await fundingDivergenceRecipe(heldShort, ctx);
    expect(events).toHaveLength(0);
  });

  it("fires when the cohort opens divergent exposure it did not hold before", async () => {
    const opensShort = makePairs(2, () => ({
      curr: [{ coin: "BTC", szi: -2, notional: 200_000 }],
      prev: [],
    }));
    const ctx = new Map([["BTC", makeAssetCtx(0.0009)]]);
    const events = await fundingDivergenceRecipe(opensShort, ctx);
    expect(events).toHaveLength(1);
    expect(events[0].direction).toBe("SHORT");
  });

  it("does not fire when funding sits just under the 0.05% threshold", async () => {
    const ctx = new Map([["BTC", makeAssetCtx(0.00049)]]);
    const events = await fundingDivergenceRecipe(flipsShort(), ctx);
    expect(events).toHaveLength(0);
  });

  it("does not fire when the cohort and the funding-implied crowd sit on the same side", async () => {
    const longCohort = makePairs(2, () => ({
      curr: [{ coin: "BTC", szi:  2, notional: 200_000 }],
      prev: [{ coin: "BTC", szi: -2, notional: 200_000 }],
    }));
    const ctx = new Map([["BTC", makeAssetCtx(0.0009)]]);
    const events = await fundingDivergenceRecipe(longCohort, ctx);
    expect(events).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Recipe 8: whale_validated
// ─────────────────────────────────────────────────────────────────────────────

describe("whale_validated", () => {
  const pending: SignalEvent[] = [{
    wallet_id:   "99999999-9999-9999-9999-999999999999",
    recipe_id:   "momentum_stack",
    coin:        "BTC",
    signal_type: "ENTRY",
    direction:   "LONG",
    ev_score:    null,
    metadata:    { wallet_count: 3 },
  }];

  /** Whales opening a fresh BTC long. */
  const freshWhales = (count: number, score: number) =>
    makePairs(count, () => ({
      score,
      curr: [{ coin: "BTC", szi: 5, notional: 500_000 }],
      prev: [],
    }));

  it("re-emits a pending signal confirmed by 3 fresh core whales", async () => {
    const events = await whaleValidatedRecipe(freshWhales(3, 0.8), pending);
    expect(events).toHaveLength(1);
    expect(events[0].recipe_id).toBe("whale_validated");
    expect(events[0].coin).toBe("BTC");
    expect(events[0].direction).toBe("LONG");
    expect(events[0].signal_type).toBe("ENTRY");
    expect(events[0].metadata.original_recipe).toBe("momentum_stack");
    expect(events[0].metadata.validating_whales).toBe(3);
  });

  it("does not fire with only 2 confirming whales", async () => {
    const events = await whaleValidatedRecipe(freshWhales(2, 0.8), pending);
    expect(events).toHaveLength(0);
  });

  it("does not count whales holding an unchanged position", async () => {
    const stale = makePairs(3, () => ({
      score: 0.8,
      curr:  [{ coin: "BTC", szi: 5, notional: 500_000 }],
      prev:  [{ coin: "BTC", szi: 5, notional: 500_000 }],
    }));
    const events = await whaleValidatedRecipe(stale, pending);
    expect(events).toHaveLength(0);
  });

  it("does not count wallets under the 0.75 core-whale score", async () => {
    const events = await whaleValidatedRecipe(freshWhales(3, 0.74), pending);
    expect(events).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cross-recipe invariant: an unchanged position is not a new signal
// ─────────────────────────────────────────────────────────────────────────────
// Every recipe polls the cohort on a ~10 minute cadence. A recipe that keys off
// the current state rather than the change since the last snapshot re-emits the
// same idea on every poll, which is how one held KAITO long became 83 rows and
// swamped the outcome statistics. These pin the invariant for all six.

describe("held positions do not re-emit", () => {
  /** Same position in prev and curr: nothing changed between polls. */
  const held = (spec: { coin: string; szi: number; notional: number }) =>
    makePairs(4, () => ({ curr: [spec], prev: [spec] }));

  const btcLong  = { coin: "BTC", szi:  4, notional: 900_000 };
  const btcShort = { coin: "BTC", szi: -4, notional: 900_000 };

  it("momentum_stack stays silent", async () => {
    expect(await momentumStackRecipe(held(btcLong), 60_000)).toHaveLength(0);
  });

  it("but the same fixture does fire when the position is newly opened", async () => {
    // Positive control: proves the silence above comes from the position being
    // unchanged, not from the fixture failing some unrelated threshold.
    const opened = makePairs(4, () => ({ curr: [btcLong], prev: [] }));
    expect((await momentumStackRecipe(opened, 60_000)).length).toBeGreaterThan(0);
    const ctx = new Map([["BTC", makeAssetCtx(0.0009)]]);
    expect((await rotationCarryRecipe(opened, ctx, new Map(), new Map())).length).toBeGreaterThan(0);
  });

  it("divergence_squeeze stays silent", async () => {
    const pairs = makePairs(4, () => ({
      curr: [btcLong], prev: [btcLong], liqBuffer: 0.02, score: 0.9,
    }));
    const candles = new Map([["BTC", [
      makeCandle({ c: 100 }), makeCandle({ c: 100 }), makeCandle({ c: 100 }),
      makeCandle({ c: 100 }), makeCandle({ c: 100 }), makeCandle({ c: 100 }),
    ]]]);
    expect(await divergenceSqueezeRecipe(pairs, candles)).toHaveLength(0);
  });

  it("accumulation_reentry stays silent", async () => {
    // Deep drawdown present, so only the unchanged position keeps it quiet.
    const candles = new Map([["BTC", [
      makeCandle({ c: 100, h: 100, l: 100 }),
      makeCandle({ c:  80, h: 100, l:  80 }),
    ]]]);
    expect(await accumulationReentryRecipe(held(btcLong), candles)).toHaveLength(0);
  });

  it("rotation_carry stays silent", async () => {
    const ctx = new Map([["BTC", makeAssetCtx(0.0009)]]);
    const events = await rotationCarryRecipe(held(btcLong), ctx, new Map(), new Map());
    expect(events).toHaveLength(0);
  });

  it("funding_divergence stays silent", async () => {
    const ctx = new Map([["BTC", makeAssetCtx(0.0009)]]);
    expect(await fundingDivergenceRecipe(held(btcShort), ctx)).toHaveLength(0);
  });

  it("whale_validated stays silent", async () => {
    const pending: SignalEvent[] = [{
      wallet_id: "99999999-9999-9999-9999-999999999999",
      recipe_id: "momentum_stack", coin: "BTC", signal_type: "ENTRY",
      direction: "LONG", ev_score: null, metadata: {},
    }];
    const pairs = makePairs(4, () => ({ curr: [btcLong], prev: [btcLong], score: 0.9 }));
    expect(await whaleValidatedRecipe(pairs, pending)).toHaveLength(0);
  });
});
