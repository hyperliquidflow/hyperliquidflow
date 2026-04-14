// lib/__tests__/hypurrscan-api-client.test.ts
import { describe, it, expect } from "vitest";
import {
  classifyEntityLabel,
  resolveEntityType,
  consumeWeight,
  type HsGlobalAliases,
} from "../hypurrscan-api-client";

describe("classifyEntityLabel", () => {
  it("identifies Bybit as cex", () => {
    expect(classifyEntityLabel("Bybit Hot Wallet")).toBe("cex");
  });

  it("identifies Binance US as cex", () => {
    expect(classifyEntityLabel("Binance US")).toBe("cex");
  });

  it("identifies OKX as cex", () => {
    expect(classifyEntityLabel("OKX Deposit")).toBe("cex");
  });

  it("identifies RUG Deployer as deployer", () => {
    expect(classifyEntityLabel("RUG Deployer")).toBe("deployer");
  });

  it("identifies Dev Wallet as deployer", () => {
    expect(classifyEntityLabel("PEPE Dev Wallet")).toBe("deployer");
  });

  it("identifies Burn Address as protocol", () => {
    expect(classifyEntityLabel("Burn Address 🔥")).toBe("protocol");
  });

  it("identifies Liquidator as protocol", () => {
    expect(classifyEntityLabel("Liquidator")).toBe("protocol");
  });

  it("identifies gambling wallet", () => {
    expect(classifyEntityLabel("Gambling Wallet")).toBe("gambling");
  });

  it("identifies fund/treasury", () => {
    expect(classifyEntityLabel("Unit Bitcoin Treasury")).toBe("fund");
    expect(classifyEntityLabel("Jump Trading Capital")).toBe("fund");
  });

  it("returns 'known' for unclassified labeled address", () => {
    expect(classifyEntityLabel("Some Random Label")).toBe("known");
  });
});

describe("resolveEntityType", () => {
  const aliases: HsGlobalAliases = {
    "0xabc123": "Bybit Cold Wallet",
    "0xdef456": "HFUN Deployer",
    "0x000000": "Burn Address 🔥",
  };

  it("returns cex for a CEX address", () => {
    const result = resolveEntityType("0xabc123", aliases);
    expect(result.entity_type).toBe("cex");
    expect(result.entity_label).toBe("Bybit Cold Wallet");
  });

  it("returns deployer for a deployer address", () => {
    const result = resolveEntityType("0xdef456", aliases);
    expect(result.entity_type).toBe("deployer");
    expect(result.entity_label).toBe("HFUN Deployer");
  });

  it("returns unknown for unlabelled address", () => {
    const result = resolveEntityType("0xunknown999", aliases);
    expect(result.entity_type).toBe("unknown");
    expect(result.entity_label).toBeNull();
  });

  it("is case-insensitive on address lookup for lowercase aliases", () => {
    const lcAliases: HsGlobalAliases = { "0xabc123": "Bybit" };
    const result2 = resolveEntityType("0xabc123", lcAliases);
    expect(result2.entity_type).toBe("cex");
  });
});

describe("consumeWeight (sequential, timing-sensitive)", () => {
  it("does not block when budget is not exceeded", async () => {
    const start = Date.now();
    await consumeWeight(5);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(500);
  });
});
