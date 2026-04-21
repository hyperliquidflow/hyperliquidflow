import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("verifyCronAuth", () => {
  const origNodeEnv = process.env.NODE_ENV;
  beforeEach(() => {
    vi.resetModules();
    process.env.CRON_SECRET = "test-secret-value";
    (process.env as { NODE_ENV?: string }).NODE_ENV = "production";
  });
  afterEach(() => {
    (process.env as { NODE_ENV?: string }).NODE_ENV = origNodeEnv;
  });

  it("accepts the correct Bearer token", async () => {
    const { verifyCronAuth } = await import("../auth/cron");
    const req = new Request("http://x", { headers: { authorization: "Bearer test-secret-value" } });
    expect(verifyCronAuth(req)).toBe(true);
  });

  it("rejects a wrong token", async () => {
    const { verifyCronAuth } = await import("../auth/cron");
    const req = new Request("http://x", { headers: { authorization: "Bearer wrong" } });
    expect(verifyCronAuth(req)).toBe(false);
  });

  it("rejects a missing header", async () => {
    const { verifyCronAuth } = await import("../auth/cron");
    const req = new Request("http://x");
    expect(verifyCronAuth(req)).toBe(false);
  });

  it("rejects when lengths differ (no crash)", async () => {
    const { verifyCronAuth } = await import("../auth/cron");
    const req = new Request("http://x", { headers: { authorization: "Bearer tiny" } });
    expect(verifyCronAuth(req)).toBe(false);
  });

  it("returns true in non-production regardless of header", async () => {
    (process.env as { NODE_ENV?: string }).NODE_ENV = "development";
    const { verifyCronAuth } = await import("../auth/cron");
    const req = new Request("http://x"); // no auth header
    expect(verifyCronAuth(req)).toBe(true);
  });
});
