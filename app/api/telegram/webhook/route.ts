// app/api/telegram/webhook/route.ts
// Inbound Telegram commands. Read only: nothing here writes to Supabase or
// starts a workflow. /check is the sole write, and it only touches the alert
// state the watchdog would have written on its next run anyway.

import { NextResponse } from "next/server";
import { verifyTelegramWebhook, isAuthorizedChat } from "@/lib/auth/telegram";
import { runWatchdog } from "@/app/api/telegram/watchdog/route";
import {
  fetchStatusData,
  fetchCohortData,
  fetchSignalsData,
  fetchScanData,
} from "@/lib/server/telegram-io";
import {
  sendTelegram,
  formatStatus,
  formatCheck,
  formatCohort,
  formatSignals,
  formatScan,
  formatHelp,
} from "@/lib/telegram";

export const dynamic = "force-dynamic";

interface TelegramUpdate {
  message?: {
    text?: string;
    chat?: { id?: number };
  };
}

async function reply(command: string): Promise<string> {
  switch (command) {
    case "/status":  return formatStatus(await fetchStatusData());
    case "/check":   return formatCheck((await runWatchdog()).results);
    case "/cohort":  return formatCohort(await fetchCohortData());
    case "/signals": return formatSignals(await fetchSignalsData());
    case "/scan":    return formatScan(await fetchScanData());
    default:         return formatHelp();
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!verifyTelegramWebhook(req)) {
    return new NextResponse(null, { status: 401 });
  }

  let update: TelegramUpdate;
  try { update = (await req.json()) as TelegramUpdate; }
  catch { return NextResponse.json({ ok: true }); }

  // Unauthorized chats get a 200 and total silence. Replying, even with a
  // refusal, would confirm the bot exists to anyone who guesses its username.
  if (!isAuthorizedChat(update.message?.chat?.id)) {
    return NextResponse.json({ ok: true });
  }

  // Strip the @botname suffix Telegram appends in group contexts.
  const command = (update.message?.text ?? "").trim().split(/[\s@]/)[0].toLowerCase();

  await sendTelegram(await reply(command));

  // Always 200. A non-200 makes Telegram retry the same update, which would
  // deliver the reply twice.
  return NextResponse.json({ ok: true });
}
