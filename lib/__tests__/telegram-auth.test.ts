import { describe, it, expect, vi, beforeEach } from "vitest";

describe("verifyTelegramWebhook", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.TELEGRAM_WEBHOOK_SECRET = "test-webhook-secret";
    process.env.TELEGRAM_CHAT_ID = "123456";
  });

  it("accepts a matching secret header", async () => {
    const { verifyTelegramWebhook } = await import("../auth/telegram");
    const req = new Request("http://x", {
      headers: { "x-telegram-bot-api-secret-token": "test-webhook-secret" },
    });
    expect(verifyTelegramWebhook(req)).toBe(true);
  });

  it("rejects a wrong secret", async () => {
    const { verifyTelegramWebhook } = await import("../auth/telegram");
    const req = new Request("http://x", {
      headers: { "x-telegram-bot-api-secret-token": "nope" },
    });
    expect(verifyTelegramWebhook(req)).toBe(false);
  });

  it("rejects a missing header", async () => {
    const { verifyTelegramWebhook } = await import("../auth/telegram");
    expect(verifyTelegramWebhook(new Request("http://x"))).toBe(false);
  });

  it("rejects everything when no secret is configured", async () => {
    vi.resetModules();
    process.env.TELEGRAM_WEBHOOK_SECRET = "";
    const { verifyTelegramWebhook } = await import("../auth/telegram");
    const req = new Request("http://x", {
      headers: { "x-telegram-bot-api-secret-token": "" },
    });
    expect(verifyTelegramWebhook(req)).toBe(false);
  });
});

describe("isAuthorizedChat", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.TELEGRAM_CHAT_ID = "123456";
  });

  it("accepts the configured chat id as a number", async () => {
    const { isAuthorizedChat } = await import("../auth/telegram");
    expect(isAuthorizedChat(123456)).toBe(true);
  });

  it("accepts the configured chat id as a string", async () => {
    const { isAuthorizedChat } = await import("../auth/telegram");
    expect(isAuthorizedChat("123456")).toBe(true);
  });

  it("rejects any other chat id", async () => {
    const { isAuthorizedChat } = await import("../auth/telegram");
    expect(isAuthorizedChat(999)).toBe(false);
  });

  it("rejects undefined", async () => {
    const { isAuthorizedChat } = await import("../auth/telegram");
    expect(isAuthorizedChat(undefined)).toBe(false);
  });
});
