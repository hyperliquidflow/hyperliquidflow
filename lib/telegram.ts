// lib/telegram.ts
// Telegram transport plus every user-visible string the bot sends.
// Single source of truth for bot copy, same rule as lib/recipe-meta.ts.
// Copy rules: no emoji, no markdown, no long dash characters.

import { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } from "@/lib/env";

/** Longest message we will push. Asserted in tests, not enforced at runtime. */
export const MAX_MESSAGE_CHARS = 200;

/**
 * Send a plain-text message to the configured chat.
 * No parse_mode is set, so Telegram does no markdown parsing and no string
 * ever needs escaping. Returns false instead of throwing, because a failed
 * notification must never fail the caller (a cron route or a scan workflow).
 */
export async function sendTelegram(text: string): Promise<boolean> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return false;
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text }),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}
