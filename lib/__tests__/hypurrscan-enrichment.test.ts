// lib/__tests__/hypurrscan-enrichment.test.ts
// Tests for the pure classification/filtering logic in hypurrscan-enrichment.
// The Supabase-writing paths are not unit-tested here (integration concern).

import { describe, it, expect } from "vitest";

// Pure helpers extracted from enrichment module for testability

const BRIDGE_MIN_USD = 100_000;

function extractUsdAmount(action: Record<string, unknown>): number {
  if (typeof action.usd === "number") return action.usd;
  if (typeof action.amount === "string") return parseFloat(action.amount);
  return 0;
}

function isDepositAction(actionType: string, action: Record<string, unknown>): boolean {
  if (actionType === "VoteEthDepositAction") return true;
  if (actionType === "subAccountTransfer" && action.isDeposit === true) return true;
  return false;
}

describe("extractUsdAmount", () => {
  it("reads numeric usd field", () => {
    expect(extractUsdAmount({ usd: 980000 })).toBe(980000);
  });

  it("reads string amount field", () => {
    expect(extractUsdAmount({ amount: "150000.50" })).toBeCloseTo(150000.5);
  });

  it("returns 0 for missing fields", () => {
    expect(extractUsdAmount({})).toBe(0);
  });
});

describe("isDepositAction", () => {
  it("recognises VoteEthDepositAction as deposit", () => {
    expect(isDepositAction("VoteEthDepositAction", {})).toBe(true);
  });

  it("recognises subAccountTransfer with isDeposit=true", () => {
    expect(isDepositAction("subAccountTransfer", { isDeposit: true })).toBe(true);
  });

  it("rejects subAccountTransfer with isDeposit=false", () => {
    expect(isDepositAction("subAccountTransfer", { isDeposit: false })).toBe(false);
  });

  it("rejects withdrawal actions", () => {
    expect(isDepositAction("withdraw3", {})).toBe(false);
  });

  it("rejects spotSend", () => {
    expect(isDepositAction("spotSend", {})).toBe(false);
  });
});

describe("BRIDGE_MIN_USD threshold", () => {
  it("filters amounts below threshold", () => {
    expect(extractUsdAmount({ usd: 50_000 }) < BRIDGE_MIN_USD).toBe(true);
  });

  it("passes amounts at threshold", () => {
    expect(extractUsdAmount({ usd: 100_000 }) >= BRIDGE_MIN_USD).toBe(true);
  });
});
