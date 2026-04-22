import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type MockQueryResult = { data: unknown; error: { message: string } | null };

let mockSnapshotResponses: MockQueryResult[] = [];
let mockWalletResponses: MockQueryResult[] = [];
let mockWalletUpdates: Array<{ payload: Record<string, unknown>; ids: unknown[] }> = [];

vi.mock("@/lib/env", () => ({
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-key",
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      const queue =
        table === "wallets" ? mockWalletResponses : mockSnapshotResponses;
      let pendingUpdate: Record<string, unknown> | null = null;
      const builder: {
        select: ReturnType<typeof vi.fn>;
        update: ReturnType<typeof vi.fn>;
        in: ReturnType<typeof vi.fn>;
        gte: ReturnType<typeof vi.fn>;
        order: ReturnType<typeof vi.fn>;
        then: (resolve: (v: MockQueryResult) => unknown, reject?: (e: unknown) => unknown) => Promise<unknown>;
      } = {
        select: vi.fn(() => builder),
        update: vi.fn((payload: Record<string, unknown>) => {
          pendingUpdate = payload;
          return builder;
        }),
        in: vi.fn((_col: string, ids: unknown[]) => {
          if (table === "wallets" && pendingUpdate) {
            mockWalletUpdates.push({ payload: pendingUpdate, ids });
            pendingUpdate = null;
          }
          return builder;
        }),
        gte: vi.fn(() => builder),
        order: vi.fn(() => builder),
        then: (resolve, reject) => {
          const result = queue.shift() ?? { data: [], error: null };
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return builder;
    }),
  })),
}));

import {
  isSnapshotFresh,
  failsEquityGate,
  failsLiqBufferGate,
  failsDrawdownGate,
  failsIdleGate,
  nextGraceCycles,
  applyHygieneGates,
} from "../cohort-hygiene";

const NOW = 1_000_000_000_000; // fixed reference ms
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;

describe("isSnapshotFresh", () => {
  it("returns true at exactly 30 min", () => {
    expect(isSnapshotFresh(ago(30 * MIN), NOW)).toBe(true);
  });
  it("returns false at 31 min", () => {
    expect(isSnapshotFresh(ago(31 * MIN), NOW)).toBe(false);
  });
  it("returns true at 0 ms", () => {
    expect(isSnapshotFresh(ago(0), NOW)).toBe(true);
  });
  it("respects custom maxAgeMs", () => {
    expect(isSnapshotFresh(ago(5 * MIN), NOW, 4 * MIN)).toBe(false);
    expect(isSnapshotFresh(ago(5 * MIN), NOW, 6 * MIN)).toBe(true);
  });
});

describe("failsEquityGate", () => {
  it("fails below floor", () => {
    expect(failsEquityGate(9_999)).toBe(true);
  });
  it("passes at exactly floor", () => {
    expect(failsEquityGate(10_000)).toBe(false);
  });
  it("passes above floor", () => {
    expect(failsEquityGate(10_001)).toBe(false);
  });
  it("respects custom floor", () => {
    expect(failsEquityGate(500, 1_000)).toBe(true);
    expect(failsEquityGate(1_000, 1_000)).toBe(false);
  });
  it("flags zero-equity wallet as failing", () => {
    expect(failsEquityGate(0)).toBe(true);
  });
});

describe("failsLiqBufferGate", () => {
  it("fails when buffer below min and positions open", () => {
    expect(failsLiqBufferGate(0.04, 2)).toBe(true);
  });
  it("passes when buffer at exactly min", () => {
    expect(failsLiqBufferGate(0.05, 2)).toBe(false);
  });
  it("passes when no positions even if buffer is low", () => {
    expect(failsLiqBufferGate(0.01, 0)).toBe(false);
  });
  it("passes when buffer is null (no margin info)", () => {
    expect(failsLiqBufferGate(null, 3)).toBe(false);
  });
  it("passes when buffer is fine", () => {
    expect(failsLiqBufferGate(0.5, 5)).toBe(false);
  });
});

describe("failsDrawdownGate", () => {
  it("returns false when fewer than minSnapshots", () => {
    expect(failsDrawdownGate([100, 50])).toBe(false);
  });
  it("returns false at exactly minSnapshots with no drawdown", () => {
    expect(failsDrawdownGate([100, 110, 120])).toBe(false);
  });
  it("returns false at 50% drawdown (boundary, not exceeded)", () => {
    expect(failsDrawdownGate([100, 100, 50])).toBe(false);
  });
  it("returns true above 50% drawdown", () => {
    expect(failsDrawdownGate([100, 100, 49])).toBe(true);
  });
  it("detects drawdown from intermediate peak", () => {
    // peak = 200, current = 80 => 60% drawdown
    expect(failsDrawdownGate([100, 200, 80])).toBe(true);
  });
  it("returns false for flat series", () => {
    expect(failsDrawdownGate([100, 100, 100, 100])).toBe(false);
  });
  it("respects custom threshold", () => {
    expect(failsDrawdownGate([100, 100, 70], 0.30, 3)).toBe(true);
    expect(failsDrawdownGate([100, 100, 70], 0.31, 3)).toBe(false);
  });
});

describe("failsIdleGate", () => {
  const DAY = 24 * 60 * 60_000;

  it("returns true for null snapshot time", () => {
    expect(failsIdleGate(null, NOW)).toBe(true);
  });
  it("returns true for undefined snapshot time", () => {
    expect(failsIdleGate(undefined, NOW)).toBe(true);
  });
  it("returns true for empty-string snapshot time", () => {
    expect(failsIdleGate("", NOW)).toBe(true);
  });
  it("returns false at 0 ms age", () => {
    expect(failsIdleGate(ago(0), NOW)).toBe(false);
  });
  it("returns false at exactly 3 days (boundary, not exceeded)", () => {
    expect(failsIdleGate(ago(3 * DAY), NOW)).toBe(false);
  });
  it("returns true at 3 days + 1 ms", () => {
    expect(failsIdleGate(ago(3 * DAY + 1), NOW)).toBe(true);
  });
  it("respects custom maxIdleMs", () => {
    expect(failsIdleGate(ago(2 * DAY), NOW, 1 * DAY)).toBe(true);
    expect(failsIdleGate(ago(2 * DAY), NOW, 3 * DAY)).toBe(false);
  });
});

describe("nextGraceCycles", () => {
  it("holds counter when snapshot is stale", () => {
    expect(nextGraceCycles(2, true, false, 3)).toEqual({ next: 2, deactivate: false });
  });
  it("holds counter when stale and passing", () => {
    expect(nextGraceCycles(1, false, false, 3)).toEqual({ next: 1, deactivate: false });
  });
  it("resets to 0 when fresh and passing", () => {
    expect(nextGraceCycles(2, false, true, 3)).toEqual({ next: 0, deactivate: false });
  });
  it("increments when fresh and failing", () => {
    expect(nextGraceCycles(1, true, true, 3)).toEqual({ next: 2, deactivate: false });
  });
  it("deactivates when increment reaches threshold", () => {
    expect(nextGraceCycles(2, true, true, 3)).toEqual({ next: 3, deactivate: true });
  });
  it("deactivates immediately if already at threshold", () => {
    expect(nextGraceCycles(3, true, true, 3)).toEqual({ next: 4, deactivate: true });
  });
  it("respects threshold of 1 (deactivate on first fresh failure)", () => {
    expect(nextGraceCycles(0, true, true, 1)).toEqual({ next: 1, deactivate: true });
  });
});

describe("applyHygieneGates", () => {
  beforeEach(() => {
    mockSnapshotResponses = [];
    mockWalletResponses = [];
    mockWalletUpdates = [];
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns empty breakdown and makes no DB calls for empty cohort", async () => {
    const result = await applyHygieneGates([]);
    expect(result.deactivated).toEqual([]);
    expect(result.breakdown).toEqual({
      low_equity: 0,
      liq_imminent: 0,
      drawdown_7d: 0,
      idle: 0,
      total_deactivated_this_cycle: 0,
      cohort_size_pre: 0,
      cohort_size_post: 0,
    });
    expect(mockWalletUpdates).toHaveLength(0);
  });

  it("deactivates zero-equity wallet once low_equity_cycles reaches threshold", async () => {
    // Wallet has equity 0 and is already at grace=2; next cycle (fresh + failing) hits threshold 3.
    // Add 3 more healthy wallets so deactivation is 1/4 = 25%, at the boundary.
    mockSnapshotResponses = [
      {
        data: [
          {
            wallet_id: "w1",
            account_value: 0,
            liq_buffer_pct: null,
            position_count: 0,
            snapshot_time: ago(5 * MIN),
          },
          { wallet_id: "w2", account_value: 100_000, liq_buffer_pct: 0.3, position_count: 0, snapshot_time: ago(5 * MIN) },
          { wallet_id: "w3", account_value: 100_000, liq_buffer_pct: 0.3, position_count: 0, snapshot_time: ago(5 * MIN) },
          { wallet_id: "w4", account_value: 100_000, liq_buffer_pct: 0.3, position_count: 0, snapshot_time: ago(5 * MIN) },
        ],
        error: null,
      },
      { data: [], error: null }, // no 7d series needed
    ];
    mockWalletResponses = [
      {
        data: [
          { id: "w1", low_equity_cycles: 2, low_buffer_cycles: 0 },
          { id: "w2", low_equity_cycles: 0, low_buffer_cycles: 0 },
          { id: "w3", low_equity_cycles: 0, low_buffer_cycles: 0 },
          { id: "w4", low_equity_cycles: 0, low_buffer_cycles: 0 },
        ],
        error: null,
      },
    ];

    const result = await applyHygieneGates(["w1", "w2", "w3", "w4"]);

    expect(result.deactivated).toEqual([{ wallet_id: "w1", reason: "low_equity" }]);
    expect(result.breakdown.low_equity).toBe(1);
    expect(result.breakdown.cohort_size_post).toBe(3);

    const deactivate = mockWalletUpdates.find(
      (u) => u.payload.is_active === false && u.payload.deactivation_reason === "low_equity",
    );
    expect(deactivate).toBeDefined();
    expect(deactivate?.ids).toEqual(["w1"]);
  });

  it("increments low_equity_cycles without deactivating when still within grace", async () => {
    // Wallet failing equity gate for the first time: grace 0 -> 1, still under threshold 3.
    // Add healthy wallets to avoid sanity check.
    mockSnapshotResponses = [
      {
        data: [
          {
            wallet_id: "w1",
            account_value: 5_000,
            liq_buffer_pct: null,
            position_count: 0,
            snapshot_time: ago(5 * MIN),
          },
          { wallet_id: "w2", account_value: 100_000, liq_buffer_pct: 0.3, position_count: 0, snapshot_time: ago(5 * MIN) },
          { wallet_id: "w3", account_value: 100_000, liq_buffer_pct: 0.3, position_count: 0, snapshot_time: ago(5 * MIN) },
          { wallet_id: "w4", account_value: 100_000, liq_buffer_pct: 0.3, position_count: 0, snapshot_time: ago(5 * MIN) },
        ],
        error: null,
      },
      { data: [], error: null },
    ];
    mockWalletResponses = [
      {
        data: [
          { id: "w1", low_equity_cycles: 0, low_buffer_cycles: 0 },
          { id: "w2", low_equity_cycles: 0, low_buffer_cycles: 0 },
          { id: "w3", low_equity_cycles: 0, low_buffer_cycles: 0 },
          { id: "w4", low_equity_cycles: 0, low_buffer_cycles: 0 },
        ],
        error: null,
      },
    ];

    const result = await applyHygieneGates(["w1", "w2", "w3", "w4"]);

    expect(result.deactivated).toEqual([]);
    expect(result.breakdown.total_deactivated_this_cycle).toBe(0);

    const counterUpdate = mockWalletUpdates.find(
      (u) => u.payload.low_equity_cycles === 1 && u.payload.is_active === undefined,
    );
    expect(counterUpdate).toBeDefined();
    expect(counterUpdate?.ids).toEqual(["w1"]);
  });

  it("deactivates wallet with no snapshot row as idle with no grace", async () => {
    // Add 3 healthy wallets so 1/4 = 25% deactivation.
    mockSnapshotResponses = [
      {
        data: [
          { wallet_id: "w2", account_value: 100_000, liq_buffer_pct: 0.3, position_count: 0, snapshot_time: ago(5 * MIN) },
          { wallet_id: "w3", account_value: 100_000, liq_buffer_pct: 0.3, position_count: 0, snapshot_time: ago(5 * MIN) },
          { wallet_id: "w4", account_value: 100_000, liq_buffer_pct: 0.3, position_count: 0, snapshot_time: ago(5 * MIN) },
        ],
        error: null,
      },
      { data: [], error: null },
    ];
    mockWalletResponses = [
      {
        data: [
          { id: "w-missing", low_equity_cycles: 2, low_buffer_cycles: 1 },
          { id: "w2", low_equity_cycles: 0, low_buffer_cycles: 0 },
          { id: "w3", low_equity_cycles: 0, low_buffer_cycles: 0 },
          { id: "w4", low_equity_cycles: 0, low_buffer_cycles: 0 },
        ],
        error: null,
      },
    ];

    const result = await applyHygieneGates(["w-missing", "w2", "w3", "w4"]);

    expect(result.deactivated).toEqual([{ wallet_id: "w-missing", reason: "idle" }]);
    expect(result.breakdown.idle).toBe(1);
    expect(result.breakdown.cohort_size_post).toBe(3);
    const deactivate = mockWalletUpdates.find(
      (u) => u.payload.is_active === false && u.payload.deactivation_reason === "idle",
    );
    expect(deactivate).toBeDefined();
    expect(deactivate?.ids).toEqual(["w-missing"]);
  });

  it("deactivates wallet whose latest snapshot is 4 days old as idle", async () => {
    const FOUR_DAYS = 4 * 24 * 60 * 60_000;
    // Add 3 healthy wallets so 1/4 = 25% deactivation.
    mockSnapshotResponses = [
      {
        data: [
          {
            wallet_id: "w-stale",
            account_value: 50_000,
            liq_buffer_pct: 0.4,
            position_count: 0,
            snapshot_time: ago(FOUR_DAYS),
          },
          { wallet_id: "w2", account_value: 100_000, liq_buffer_pct: 0.3, position_count: 0, snapshot_time: ago(5 * MIN) },
          { wallet_id: "w3", account_value: 100_000, liq_buffer_pct: 0.3, position_count: 0, snapshot_time: ago(5 * MIN) },
          { wallet_id: "w4", account_value: 100_000, liq_buffer_pct: 0.3, position_count: 0, snapshot_time: ago(5 * MIN) },
        ],
        error: null,
      },
      { data: [], error: null },
    ];
    mockWalletResponses = [
      {
        data: [
          { id: "w-stale", low_equity_cycles: 0, low_buffer_cycles: 0 },
          { id: "w2", low_equity_cycles: 0, low_buffer_cycles: 0 },
          { id: "w3", low_equity_cycles: 0, low_buffer_cycles: 0 },
          { id: "w4", low_equity_cycles: 0, low_buffer_cycles: 0 },
        ],
        error: null,
      },
    ];

    const result = await applyHygieneGates(["w-stale", "w2", "w3", "w4"]);

    expect(result.deactivated).toEqual([{ wallet_id: "w-stale", reason: "idle" }]);
    expect(result.breakdown.idle).toBe(1);
  });

  it("idle gate runs before equity: idle-and-low-equity wallet is tagged idle, not low_equity", async () => {
    const FOUR_DAYS = 4 * 24 * 60 * 60_000;
    // Add 3 healthy wallets so 1/4 = 25% deactivation.
    mockSnapshotResponses = [
      {
        data: [
          {
            wallet_id: "w-both",
            account_value: 0,
            liq_buffer_pct: null,
            position_count: 0,
            snapshot_time: ago(FOUR_DAYS),
          },
          { wallet_id: "w2", account_value: 100_000, liq_buffer_pct: 0.3, position_count: 0, snapshot_time: ago(5 * MIN) },
          { wallet_id: "w3", account_value: 100_000, liq_buffer_pct: 0.3, position_count: 0, snapshot_time: ago(5 * MIN) },
          { wallet_id: "w4", account_value: 100_000, liq_buffer_pct: 0.3, position_count: 0, snapshot_time: ago(5 * MIN) },
        ],
        error: null,
      },
      { data: [], error: null },
    ];
    mockWalletResponses = [
      {
        data: [
          { id: "w-both", low_equity_cycles: 2, low_buffer_cycles: 0 },
          { id: "w2", low_equity_cycles: 0, low_buffer_cycles: 0 },
          { id: "w3", low_equity_cycles: 0, low_buffer_cycles: 0 },
          { id: "w4", low_equity_cycles: 0, low_buffer_cycles: 0 },
        ],
        error: null,
      },
    ];

    const result = await applyHygieneGates(["w-both", "w2", "w3", "w4"]);

    expect(result.deactivated).toEqual([{ wallet_id: "w-both", reason: "idle" }]);
    expect(result.breakdown.idle).toBe(1);
    expect(result.breakdown.low_equity).toBe(0);
  });

  it("deactivates immediately on 7d drawdown breach (no grace)", async () => {
    // Add 3 healthy wallets so 1/4 = 25% deactivation.
    mockSnapshotResponses = [
      {
        data: [
          {
            wallet_id: "w1",
            account_value: 40_000,
            liq_buffer_pct: 0.4,
            position_count: 0,
            snapshot_time: ago(5 * MIN),
          },
          { wallet_id: "w2", account_value: 100_000, liq_buffer_pct: 0.3, position_count: 0, snapshot_time: ago(5 * MIN) },
          { wallet_id: "w3", account_value: 100_000, liq_buffer_pct: 0.3, position_count: 0, snapshot_time: ago(5 * MIN) },
          { wallet_id: "w4", account_value: 100_000, liq_buffer_pct: 0.3, position_count: 0, snapshot_time: ago(5 * MIN) },
        ],
        error: null,
      },
      {
        // peak 200_000, current 40_000 => 80% drawdown
        data: [
          { wallet_id: "w1", account_value: 100_000, snapshot_time: ago(6 * 86_400_000) },
          { wallet_id: "w1", account_value: 200_000, snapshot_time: ago(3 * 86_400_000) },
          { wallet_id: "w1", account_value: 40_000, snapshot_time: ago(5 * MIN) },
        ],
        error: null,
      },
    ];
    mockWalletResponses = [
      {
        data: [
          { id: "w1", low_equity_cycles: 0, low_buffer_cycles: 0 },
          { id: "w2", low_equity_cycles: 0, low_buffer_cycles: 0 },
          { id: "w3", low_equity_cycles: 0, low_buffer_cycles: 0 },
          { id: "w4", low_equity_cycles: 0, low_buffer_cycles: 0 },
        ],
        error: null,
      },
    ];

    const result = await applyHygieneGates(["w1", "w2", "w3", "w4"]);

    expect(result.deactivated).toEqual([{ wallet_id: "w1", reason: "drawdown_7d" }]);
    expect(result.breakdown.drawdown_7d).toBe(1);
  });

  it("deactivates for liq_imminent once low_buffer_cycles reaches threshold", async () => {
    // Threshold is 2. Wallet at grace=1, buffer below min, positions open -> next=2 -> deactivate.
    // Add 3 healthy wallets so 1/4 = 25% deactivation.
    mockSnapshotResponses = [
      {
        data: [
          {
            wallet_id: "w1",
            account_value: 100_000,
            liq_buffer_pct: 0.03,
            position_count: 3,
            snapshot_time: ago(5 * MIN),
          },
          { wallet_id: "w2", account_value: 100_000, liq_buffer_pct: 0.3, position_count: 0, snapshot_time: ago(5 * MIN) },
          { wallet_id: "w3", account_value: 100_000, liq_buffer_pct: 0.3, position_count: 0, snapshot_time: ago(5 * MIN) },
          { wallet_id: "w4", account_value: 100_000, liq_buffer_pct: 0.3, position_count: 0, snapshot_time: ago(5 * MIN) },
        ],
        error: null,
      },
      { data: [], error: null },
    ];
    mockWalletResponses = [
      {
        data: [
          { id: "w1", low_equity_cycles: 0, low_buffer_cycles: 1 },
          { id: "w2", low_equity_cycles: 0, low_buffer_cycles: 0 },
          { id: "w3", low_equity_cycles: 0, low_buffer_cycles: 0 },
          { id: "w4", low_equity_cycles: 0, low_buffer_cycles: 0 },
        ],
        error: null,
      },
    ];

    const result = await applyHygieneGates(["w1", "w2", "w3", "w4"]);

    expect(result.deactivated).toEqual([{ wallet_id: "w1", reason: "liq_imminent" }]);
    expect(result.breakdown.liq_imminent).toBe(1);
  });

  it("holds grace counter on stale snapshot even when equity is failing", async () => {
    // Stale snapshot (45 min old): counter must not advance, wallet must not deactivate.
    mockSnapshotResponses = [
      {
        data: [
          {
            wallet_id: "w1",
            account_value: 0,
            liq_buffer_pct: null,
            position_count: 0,
            snapshot_time: ago(45 * MIN),
          },
        ],
        error: null,
      },
      { data: [], error: null },
    ];
    mockWalletResponses = [
      {
        data: [{ id: "w1", low_equity_cycles: 2, low_buffer_cycles: 0 }],
        error: null,
      },
    ];

    const result = await applyHygieneGates(["w1"]);

    expect(result.deactivated).toEqual([]);
    // stale path leaves both counters equal to current -> no update written.
    expect(mockWalletUpdates).toHaveLength(0);
  });

  it("resets grace counter to 0 when fresh and passing after prior failure", async () => {
    mockSnapshotResponses = [
      {
        data: [
          {
            wallet_id: "w1",
            account_value: 100_000,
            liq_buffer_pct: 0.4,
            position_count: 2,
            snapshot_time: ago(5 * MIN),
          },
        ],
        error: null,
      },
      { data: [], error: null },
    ];
    mockWalletResponses = [
      {
        data: [{ id: "w1", low_equity_cycles: 2, low_buffer_cycles: 0 }],
        error: null,
      },
    ];

    const result = await applyHygieneGates(["w1"]);

    expect(result.deactivated).toEqual([]);
    const reset = mockWalletUpdates.find(
      (u) => u.payload.low_equity_cycles === 0 && u.payload.low_buffer_cycles === 0 && u.payload.is_active === undefined,
    );
    expect(reset).toBeDefined();
    expect(reset?.ids).toEqual(["w1"]);
  });

  it("aggregates breakdown across mixed deactivation reasons", async () => {
    // 12-wallet cohort: 3 deactivations = exactly 25% (boundary, no sanity throw)
    const healthySnaps = ["w1", "w2", "w3", "w4", "w5", "w6", "w7", "w8"].map((id) => ({
      wallet_id: id,
      account_value: 500_000,
      liq_buffer_pct: 0.5,
      position_count: 0,
      snapshot_time: ago(5 * MIN),
    }));
    const healthyGrace = ["w1", "w2", "w3", "w4", "w5", "w6", "w7", "w8"].map((id) => ({
      id,
      low_equity_cycles: 0,
      low_buffer_cycles: 0,
    }));

    mockSnapshotResponses = [
      {
        data: [
          // wA: equity failing at threshold -> low_equity
          { wallet_id: "wA", account_value: 0, liq_buffer_pct: null, position_count: 0, snapshot_time: ago(5 * MIN) },
          // wB: drawdown (peak 100k, current 20k = 80% drawdown)
          { wallet_id: "wB", account_value: 20_000, liq_buffer_pct: 0.3, position_count: 0, snapshot_time: ago(5 * MIN) },
          // wC: liq buffer failing at threshold -> liq_imminent
          { wallet_id: "wC", account_value: 100_000, liq_buffer_pct: 0.02, position_count: 2, snapshot_time: ago(5 * MIN) },
          // wD: healthy
          { wallet_id: "wD", account_value: 500_000, liq_buffer_pct: 0.5, position_count: 1, snapshot_time: ago(5 * MIN) },
          ...healthySnaps,
        ],
        error: null,
      },
      {
        // Only wB has series data that trips drawdown gate.
        data: [
          { wallet_id: "wB", account_value: 100_000, snapshot_time: ago(6 * 86_400_000) },
          { wallet_id: "wB", account_value: 100_000, snapshot_time: ago(3 * 86_400_000) },
          { wallet_id: "wB", account_value: 20_000, snapshot_time: ago(5 * MIN) },
        ],
        error: null,
      },
    ];
    mockWalletResponses = [
      {
        data: [
          { id: "wA", low_equity_cycles: 2, low_buffer_cycles: 0 },
          { id: "wB", low_equity_cycles: 0, low_buffer_cycles: 0 },
          { id: "wC", low_equity_cycles: 0, low_buffer_cycles: 1 },
          { id: "wD", low_equity_cycles: 0, low_buffer_cycles: 0 },
          ...healthyGrace,
        ],
        error: null,
      },
    ];

    const result = await applyHygieneGates(["wA", "wB", "wC", "wD", "w1", "w2", "w3", "w4", "w5", "w6", "w7", "w8"]);

    expect(result.breakdown).toMatchObject({
      low_equity: 1,
      drawdown_7d: 1,
      liq_imminent: 1,
      idle: 0,
      total_deactivated_this_cycle: 3,
      cohort_size_pre: 12,
      cohort_size_post: 9,
    });
    const ids = result.deactivated.map((d) => d.wallet_id).sort();
    expect(ids).toEqual(["wA", "wB", "wC"]);
  });

  it("sanity guard throws and issues no writes when >25% of cohort would deactivate", async () => {
    mockSnapshotResponses = [
      {
        data: [
          { wallet_id: "wC", account_value: 500_000, liq_buffer_pct: 0.5, position_count: 0, snapshot_time: ago(5 * MIN) },
          { wallet_id: "wD", account_value: 500_000, liq_buffer_pct: 0.5, position_count: 0, snapshot_time: ago(5 * MIN) },
        ],
        error: null,
      },
      { data: [], error: null },
    ];
    mockWalletResponses = [
      {
        data: [
          { id: "wA", low_equity_cycles: 0, low_buffer_cycles: 0 },
          { id: "wB", low_equity_cycles: 0, low_buffer_cycles: 0 },
          { id: "wC", low_equity_cycles: 0, low_buffer_cycles: 0 },
          { id: "wD", low_equity_cycles: 0, low_buffer_cycles: 0 },
        ],
        error: null,
      },
    ];

    await expect(applyHygieneGates(["wA", "wB", "wC", "wD"])).rejects.toThrow(/sanity abort/);
    expect(mockWalletUpdates).toHaveLength(0);
  });

  it("throws when the latest-snapshot query errors", async () => {
    mockSnapshotResponses = [{ data: null, error: { message: "snap down" } }];
    await expect(applyHygieneGates(["w1"])).rejects.toThrow(/latest-snaps query failed/);
  });

  it("throws when the 7d-series query errors", async () => {
    mockSnapshotResponses = [
      { data: [], error: null },
      { data: null, error: { message: "series down" } },
    ];
    await expect(applyHygieneGates(["w1"])).rejects.toThrow(/7d-series query failed/);
  });

  it("throws when the grace-counters query errors", async () => {
    mockSnapshotResponses = [
      { data: [], error: null },
      { data: [], error: null },
    ];
    mockWalletResponses = [{ data: null, error: { message: "wallets down" } }];
    await expect(applyHygieneGates(["w1"])).rejects.toThrow(/grace-counters query failed/);
  });
});
