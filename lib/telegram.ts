// lib/telegram.ts
// Telegram transport plus every user-visible string the bot sends.
// Single source of truth for bot copy, same rule as lib/recipe-meta.ts.
// Copy rules: no emoji, no markdown, no long dash characters.

import { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } from "@/lib/env";
import { formatAge, type CheckId, type CheckResult, type Transition } from "@/lib/watchdog";

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

// ── Message copy ─────────────────────────────────────────────────────────────

/** Human names for each check id. The only place these words are written. */
export const CHECK_LABELS: Record<CheckId, string> = {
  snapshot_stale:   "cohort data stale",
  heartbeat_dead:   "heartbeat dead",
  scan_dead:        "nightly scan dead",
  cohort_floor:     "cohort collapsed",
  cohort_unfunded:  "cohort mostly empty accounts",
  learning_stalled: "learning loop stalled",
};

export interface StatusData {
  broken:       CheckId[];
  wallet_count: number | null;
  data_age_ms:  number | null;
  /** Notional-weighted long share of open positions. Null when none are open. */
  long_pct:     number | null;
}

export interface DigestData {
  discovered:         number;
  activated:          number;
  active:             number;
  duration_ms:        number;
  rate_limit_dropped: number;
  top_rejection:      { reason: string; count: number } | null;
}

export interface CohortData {
  active:          number;
  deactivated_24h: number;
  blown_up_30d:    number;
}

export interface SignalsData {
  count_24h:          number;
  top_recipe:         string | null;
  top_expectancy_bps: number | null;
}

export interface ScanData {
  last_date: string | null;
  age_ms:    number | null;
}

export function formatAlert(t: Transition): string {
  return `BROKEN: ${CHECK_LABELS[t.id]}\n${t.detail}`;
}

export function formatRecovery(t: Transition): string {
  const down = t.down_ms === undefined ? "unknown" : formatAge(t.down_ms);
  return `RECOVERED: ${CHECK_LABELS[t.id]}\nWas down ${down}`;
}

export function formatStatus(d: StatusData): string {
  const headline =
    d.broken.length === 0
      ? "All green"
      : d.broken.length === 1
        ? `BROKEN: ${CHECK_LABELS[d.broken[0]]}`
        : `BROKEN: ${d.broken.length} checks failing`;

  if (d.wallet_count === null || d.data_age_ms === null) {
    return `${headline}\nNo cached cohort data`;
  }

  const tilt = d.long_pct === null ? "" : `${d.long_pct}% long, `;
  return `${headline}\nCohort ${d.wallet_count}, ${tilt}data ${formatAge(d.data_age_ms)} old`;
}

/**
 * Reply to an explicit /check. Exempt from the three-line push ceiling
 * because the owner asked for every line.
 */
export function formatCheck(results: CheckResult[]): string {
  const failing = results.filter((r) => !r.ok).length;
  const headline = failing === 0 ? "All green" : `${failing} of ${results.length} failing`;
  const lines = results.map((r) => `${r.ok ? "ok" : "FAIL"} ${r.detail}`);
  return [headline, ...lines].join("\n");
}

export function formatDigest(d: DigestData): string {
  const lines = [
    `Scan ok, ${formatAge(d.duration_ms)}`,
    `${d.discovered} found, ${d.activated} activated, ${d.active} active`,
  ];
  const notes: string[] = [];
  if (d.top_rejection) notes.push(`${d.top_rejection.reason} cut ${d.top_rejection.count}`);
  if (d.rate_limit_dropped > 0) notes.push(`${d.rate_limit_dropped} rate limited`);
  if (notes.length) lines.push(notes.join(", "));
  return lines.join("\n");
}

export function formatDigestFailure(reason: string): string {
  return `SCAN FAILED\n${reason}, check the Actions run`;
}

export function formatCohort(d: CohortData): string {
  return `Cohort ${d.active} active\n${d.deactivated_24h} deactivated in 24h, ${d.blown_up_30d} blown up in 30d`;
}

export function formatSignals(d: SignalsData): string {
  const second =
    d.top_recipe === null || d.top_expectancy_bps === null
      ? "No recipe measurements yet"
      : `Best: ${d.top_recipe}, ${d.top_expectancy_bps.toFixed(1)} bps expectancy`;
  return `${d.count_24h} signals in 24h\n${second}`;
}

export function formatScan(d: ScanData): string {
  const first =
    d.last_date === null || d.age_ms === null
      ? "No scan on record"
      : `Last scan ${d.last_date}, ${formatAge(d.age_ms)} ago`;
  return `${first}\nNext run 00:00 UTC`;
}

export function formatHelp(): string {
  return "/status /check /cohort /signals /scan";
}
