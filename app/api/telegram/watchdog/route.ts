// app/api/telegram/watchdog/route.ts
// Runs every health check, compares each against its stored state, and sends
// a Telegram message only when a check changes state. Triggered every 15 min
// by .github/workflows/freshness-check.yml.

import { NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/auth/cron";
import {
  collectCheckInputs,
  readAlertState,
  writeAlertState,
} from "@/lib/server/telegram-io";
import { evaluateChecks, diffTransitions, type CheckResult } from "@/lib/watchdog";
import { sendTelegram, formatAlert, formatRecovery } from "@/lib/telegram";

export const dynamic = "force-dynamic";

/**
 * Evaluate, diff, notify, persist. Exported so the /check command can run the
 * exact same path, which is what lets a manual check clear a pending alert.
 */
export async function runWatchdog(): Promise<{ results: CheckResult[]; sent: number }> {
  const [inputs, prev] = await Promise.all([collectCheckInputs(), readAlertState()]);
  const results = evaluateChecks(inputs);
  const { transitions, writes } = diffTransitions(results, prev, new Date().toISOString());

  let sent = 0;
  for (const t of transitions) {
    const ok = await sendTelegram(t.kind === "alert" ? formatAlert(t) : formatRecovery(t));
    if (ok) sent++;
  }

  // Persist only if every message got through. If a send failed the state is
  // left untouched, so the next run retries rather than losing the alert.
  if (sent === transitions.length && Object.keys(writes).length > 0) {
    await writeAlertState(writes);
  }

  return { results, sent };
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { results, sent } = await runWatchdog();

  return NextResponse.json({
    checked: results.length,
    failing: results.filter((r) => !r.ok).length,
    sent,
  });
}
