import { describe as suite, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * An unset GitHub Actions secret is not absent, it is the empty string, so
 * `process.env.X ?? default` hands the caller "" and the default never applies.
 * That turns a missing secret into an empty API URL rather than a working
 * default, which fails at the first request with a confusing error.
 */
suite("optional env vars", () => {
  const saved = process.env.HYPERLIQUID_API_URL;

  beforeEach(() => vi.resetModules());
  afterEach(() => {
    if (saved === undefined) delete process.env.HYPERLIQUID_API_URL;
    else process.env.HYPERLIQUID_API_URL = saved;
  });

  it("falls back when the variable is absent", async () => {
    delete process.env.HYPERLIQUID_API_URL;
    const { HYPERLIQUID_API_URL } = await import("@/lib/env");
    expect(HYPERLIQUID_API_URL).toBe("https://api.hyperliquid.xyz/info");
  });

  it("falls back when the variable is set but empty, as an unset CI secret is", async () => {
    process.env.HYPERLIQUID_API_URL = "";
    const { HYPERLIQUID_API_URL } = await import("@/lib/env");
    expect(HYPERLIQUID_API_URL).toBe("https://api.hyperliquid.xyz/info");
  });

  it("falls back when the variable is only whitespace", async () => {
    process.env.HYPERLIQUID_API_URL = "   ";
    const { HYPERLIQUID_API_URL } = await import("@/lib/env");
    expect(HYPERLIQUID_API_URL).toBe("https://api.hyperliquid.xyz/info");
  });

  it("uses a real value when one is provided", async () => {
    process.env.HYPERLIQUID_API_URL = "https://example.test/info";
    const { HYPERLIQUID_API_URL } = await import("@/lib/env");
    expect(HYPERLIQUID_API_URL).toBe("https://example.test/info");
  });
});
