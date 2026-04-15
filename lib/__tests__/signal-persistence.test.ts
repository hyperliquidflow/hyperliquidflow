import { describe, it, expect } from "vitest";
import { buildSignalHash, buildActiveConfigSnapshot } from "../signal-persistence";

describe("buildSignalHash", () => {
  it("produces a 64-char hex string", async () => {
    const hash = await buildSignalHash("momentum_stack", "BTC", "LONG", "2026-04-15T01:00:00Z");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it("is deterministic: same inputs produce same hash", async () => {
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
