import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@vercel/kv", () => ({
  kv: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
  },
}));

let mockSupabaseReturn: {
  data: { param_name: string; param_value: number }[] | null;
  error: { message: string } | null;
} = {
  data: [
    { param_name: "MIN_WALLETS", param_value: 3 },
    { param_name: "COMBINED_NOTIONAL", param_value: 500000 },
  ],
  error: null,
};

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve(mockSupabaseReturn)),
      })),
    })),
  })),
}));

vi.mock("@/lib/env", () => ({
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-key",
}));

import { kv } from "@vercel/kv";
import { getRecipeConfig, snapshotAllConfigs } from "../recipe-config";

describe("getRecipeConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabaseReturn = {
      data: [
        { param_name: "MIN_WALLETS", param_value: 3 },
        { param_name: "COMBINED_NOTIONAL", param_value: 500000 },
      ],
      error: null,
    };
  });

  it("returns KV-cached config when available", async () => {
    vi.mocked(kv.get).mockResolvedValueOnce({
      MIN_WALLETS: 4,
      COMBINED_NOTIONAL: 600000,
    });

    const config = await getRecipeConfig("momentum_stack");

    expect(config["MIN_WALLETS"]).toBe(4);
    expect(config["COMBINED_NOTIONAL"]).toBe(600000);
    expect(kv.set).not.toHaveBeenCalled();
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

  it("returns empty object on Supabase query error", async () => {
    vi.mocked(kv.get).mockResolvedValueOnce(null);
    mockSupabaseReturn = { data: null, error: { message: "db error" } };

    const config = await getRecipeConfig("unknown_recipe");
    expect(config).toEqual({});
  });
});

describe("snapshotAllConfigs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabaseReturn = {
      data: [
        { param_name: "MIN_WALLETS", param_value: 3 },
        { param_name: "COMBINED_NOTIONAL", param_value: 500000 },
      ],
      error: null,
    };
  });

  it("returns a flat map of all recipe configs keyed by recipe_id", async () => {
    vi.mocked(kv.get).mockResolvedValue(null);
    const snapshot = await snapshotAllConfigs(["momentum_stack"]);
    expect(snapshot["momentum_stack"]).toBeDefined();
    expect(typeof snapshot["momentum_stack"]["MIN_WALLETS"]).toBe("number");
  });
});
