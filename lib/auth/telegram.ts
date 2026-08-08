// lib/auth/telegram.ts
import { timingSafeEqual } from "node:crypto";
import { TELEGRAM_WEBHOOK_SECRET, TELEGRAM_CHAT_ID } from "@/lib/env";

/**
 * Verify the secret Telegram echoes back on every webhook delivery.
 * A mismatch means the request did not come from Telegram.
 * Unlike verifyCronAuth there is no dev bypass: an unset secret rejects
 * everything, so a misconfigured deploy fails closed rather than open.
 */
export function verifyTelegramWebhook(req: Request): boolean {
  if (!TELEGRAM_WEBHOOK_SECRET) return false;
  const header = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  const a = Buffer.from(header);
  const b = Buffer.from(TELEGRAM_WEBHOOK_SECRET);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** True only for the single authorized chat. */
export function isAuthorizedChat(chatId: number | string | undefined): boolean {
  if (chatId === undefined || chatId === null) return false;
  if (!TELEGRAM_CHAT_ID) return false;
  return String(chatId) === TELEGRAM_CHAT_ID;
}
