import { describe, it, expect, beforeEach, vi } from "vitest";

function makeLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem:    (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem:    (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear:      () => { store.clear(); },
    key:        (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  };
}

describe("safe-local-storage", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("window", { localStorage: makeLocalStorage() });
  });

  it("returns fallback when key missing", async () => {
    const { safeReadJson } = await import("../hooks/safe-local-storage");
    expect(safeReadJson("missing", { a: 1 })).toEqual({ a: 1 });
  });

  it("roundtrips a value", async () => {
    const { safeReadJson, safeWriteJson } = await import("../hooks/safe-local-storage");
    safeWriteJson("k", { x: 2 });
    expect(safeReadJson("k", null)).toEqual({ x: 2 });
  });

  it("returns fallback and clears corrupt JSON", async () => {
    const { safeReadJson } = await import("../hooks/safe-local-storage");
    window.localStorage.setItem("k", "not-json");
    expect(safeReadJson("k", { safe: true })).toEqual({ safe: true });
    expect(window.localStorage.getItem("k")).toBeNull();
  });
});
