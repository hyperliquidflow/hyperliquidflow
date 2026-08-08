// scripts/notify-scan-digest.ts
// Sends one Telegram message summarizing the nightly wallet scan.
// Runs as the final step of daily-wallet-scan.yml with if: always(), so it
// reports a failed or crashed scan as well as a successful one.

import * as fs from "fs/promises";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "../lib/env";
import { sendTelegram, formatDigest, formatDigestFailure } from "../lib/telegram";

interface ScanSummary {
  discovered:          number;
  activated:           number;
  duration_ms:         number;
  rate_limit_dropped:  number;
  rejection_breakdown: Record<string, number>;
}

async function activeWalletCount(): Promise<number> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { count, error } = await supabase
    .from("wallets")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true);
  return error ? 0 : count ?? 0;
}

function topRejection(b: Record<string, number>): { reason: string; count: number } | null {
  const entries = Object.entries(b ?? {}).filter(([, n]) => n > 0);
  if (entries.length === 0) return null;
  entries.sort((a, z) => z[1] - a[1]);
  return { reason: entries[0][0], count: entries[0][1] };
}

async function main(): Promise<void> {
  let summary: ScanSummary;
  try {
    summary = JSON.parse(await fs.readFile("scan-summary.json", "utf8")) as ScanSummary;
  } catch {
    await sendTelegram(formatDigestFailure("no summary written"));
    return;
  }

  await sendTelegram(
    formatDigest({
      discovered:         summary.discovered,
      activated:          summary.activated,
      active:             await activeWalletCount(),
      duration_ms:        summary.duration_ms,
      rate_limit_dropped: summary.rate_limit_dropped ?? 0,
      top_rejection:      topRejection(summary.rejection_breakdown),
    }),
  );
}

// Never fail the workflow over a notification. The scan result is what matters.
main().catch((err) => {
  console.error("[notify-scan-digest] failed:", err);
});
