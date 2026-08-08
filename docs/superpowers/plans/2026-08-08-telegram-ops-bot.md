# Telegram Ops Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A private, read-only Telegram bot that answers five status commands on demand and pushes an alert exactly once when a health check breaks, once when it recovers, plus one nightly scan digest.

**Architecture:** Pure evaluation logic lives in `lib/watchdog.ts` with no network access, so the whole state machine is unit testable. All I/O is isolated in `lib/server/telegram-io.ts`. All user-visible strings live in `lib/telegram.ts`. Two thin API routes compose those three. Alert state persists in KV under `alert:state:<id>`, which is what makes "alert once, then stay silent" possible.

**Tech Stack:** Next.js 15 App Router, TypeScript, Vitest, `@vercel/kv`, `@supabase/supabase-js`, Telegram Bot HTTP API (no SDK dependency).

## Global Constraints

- **No long dash characters** (U+2013, U+2014) in any string literal, comment, or markdown produced by this plan. Project copy rule, enforced by a PreToolUse hook that rejects the write outright. Where code needs to match those characters, build the pattern from ASCII escape sequences, never from the literal glyphs. This plan is written entirely in ASCII for that reason.
- **No emoji** in any Telegram message. Decided during brainstorming.
- **Pushed messages are 3 lines maximum** and under `MAX_MESSAGE_CHARS` (200). Pulled replies to an explicit command may exceed the line ceiling but stay terse.
- **All message copy lives in `lib/telegram.ts`.** No message strings in routes, scripts, or the io layer. Same single source of truth rule as `lib/recipe-meta.ts`.
- **Never read `process.env` directly.** All env access goes through `lib/env.ts`.
- **Read only.** No task in this plan writes to Supabase or dispatches a workflow.
- Tests go in `lib/__tests__/*.test.ts`. API routes are not unit tested, per existing project convention.
- Run `npm run test` and `npm run typecheck` before every commit.

---

### Task 1: Env vars, send primitive, webhook auth

**Files:**
- Modify: `lib/env.ts` (append after line 80)
- Create: `lib/telegram.ts`
- Create: `lib/auth/telegram.ts`
- Test: `lib/__tests__/telegram-auth.test.ts`

**Interfaces:**
- Consumes: `requireInProd` from `lib/env.ts` (already exists, line 67).
- Produces: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_WEBHOOK_SECRET` (all `string`); `sendTelegram(text: string): Promise<boolean>`; `MAX_MESSAGE_CHARS: number`; `verifyTelegramWebhook(req: Request): boolean`; `isAuthorizedChat(chatId: number | string | undefined): boolean`.

- [ ] **Step 1: Add the three env vars**

Append to `lib/env.ts`:

```ts
/** Telegram bot token from BotFather. Required in production. */
export const TELEGRAM_BOT_TOKEN = requireInProd("TELEGRAM_BOT_TOKEN");

/** The single authorized Telegram chat id. Every other chat is ignored. */
export const TELEGRAM_CHAT_ID = requireInProd("TELEGRAM_CHAT_ID");

/** Secret registered at setWebhook time, echoed back by Telegram in a header. */
export const TELEGRAM_WEBHOOK_SECRET = requireInProd("TELEGRAM_WEBHOOK_SECRET");
```

`requireInProd` is used rather than `requireEnv` so local dev and CI keep working without the vars set.

- [ ] **Step 2: Write the failing auth test**

Create `lib/__tests__/telegram-auth.test.ts`. Note the `vi.resetModules()` plus dynamic `import` pattern, copied from `lib/__tests__/cron-auth.test.ts`. It is required because `lib/env.ts` reads env at module load time.

```ts
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
```

- [ ] **Step 3: Run the test and confirm it fails**

Run: `npx vitest run lib/__tests__/telegram-auth.test.ts`
Expected: FAIL, cannot resolve `../auth/telegram`.

- [ ] **Step 4: Implement the auth module**

Create `lib/auth/telegram.ts`:

```ts
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
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `npx vitest run lib/__tests__/telegram-auth.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Create the send primitive**

Create `lib/telegram.ts`. Formatters are added in Task 3, this step only creates the transport.

```ts
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
```

- [ ] **Step 7: Typecheck and commit**

```bash
npm run typecheck && npm run test
git add lib/env.ts lib/telegram.ts lib/auth/telegram.ts lib/__tests__/telegram-auth.test.ts
git commit -m "feat(telegram): env vars, send primitive, webhook auth"
```

---

### Task 2: Pure watchdog evaluation and transition logic

**Files:**
- Create: `lib/watchdog.ts`
- Test: `lib/__tests__/watchdog.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks. This file imports nothing and performs no I/O, which is the whole point.
- Produces: `CheckId`, `CHECK_IDS`, `THRESHOLDS`, `CheckInputs`, `CheckResult`, `AlertState`, `Transition`, `evaluateChecks(i: CheckInputs): CheckResult[]`, `diffTransitions(results, prev, nowIso): { transitions: Transition[]; writes: Record<string, AlertState> }`, `formatAge(ms: number): string`.

- [ ] **Step 1: Write the failing test**

Create `lib/__tests__/watchdog.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  evaluateChecks,
  diffTransitions,
  THRESHOLDS,
  type CheckInputs,
  type CheckResult,
  type AlertState,
} from "../watchdog";

const NOW = Date.parse("2026-08-08T12:00:00Z");
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

function healthyInputs(): CheckInputs {
  return {
    now_ms:                  NOW,
    snapshot_updated_at:     iso(2 * 60 * 1000),
    heartbeat_snapshot_time: iso(3 * 60 * 1000),
    score_history_date:      "2026-08-08",
    active_wallets:          77,
    prev_day_wallets:        80,
    outcomes_resolved_48h:   42,
  };
}

const byId = (rs: CheckResult[], id: string) => rs.find((r) => r.id === id)!;

describe("evaluateChecks", () => {
  it("reports all five checks green on healthy inputs", () => {
    const rs = evaluateChecks(healthyInputs());
    expect(rs).toHaveLength(5);
    expect(rs.every((r) => r.ok)).toBe(true);
  });

  it("flags a stale cohort snapshot past 20 minutes", () => {
    const rs = evaluateChecks({ ...healthyInputs(), snapshot_updated_at: iso(21 * 60 * 1000) });
    expect(byId(rs, "snapshot_stale").ok).toBe(false);
  });

  it("keeps the snapshot check green exactly at the threshold", () => {
    const rs = evaluateChecks({
      ...healthyInputs(),
      snapshot_updated_at: iso(THRESHOLDS.snapshot_max_age_ms),
    });
    expect(byId(rs, "snapshot_stale").ok).toBe(true);
  });

  it("flags a dead heartbeat past 45 minutes", () => {
    const rs = evaluateChecks({ ...healthyInputs(), heartbeat_snapshot_time: iso(46 * 60 * 1000) });
    expect(byId(rs, "heartbeat_dead").ok).toBe(false);
  });

  it("flags score history older than 48 hours", () => {
    const rs = evaluateChecks({ ...healthyInputs(), score_history_date: "2026-08-05" });
    expect(byId(rs, "scan_dead").ok).toBe(false);
  });

  it("accepts yesterday's score history date", () => {
    const rs = evaluateChecks({ ...healthyInputs(), score_history_date: "2026-08-07" });
    expect(byId(rs, "scan_dead").ok).toBe(true);
  });

  it("flags a cohort below the floor", () => {
    const rs = evaluateChecks({ ...healthyInputs(), active_wallets: 39, prev_day_wallets: 40 });
    expect(byId(rs, "cohort_floor").ok).toBe(false);
  });

  it("flags a cohort that dropped more than 30 percent in a day", () => {
    const rs = evaluateChecks({ ...healthyInputs(), active_wallets: 60, prev_day_wallets: 100 });
    const r = byId(rs, "cohort_floor");
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("40%");
  });

  it("allows a drop of exactly 30 percent", () => {
    const rs = evaluateChecks({ ...healthyInputs(), active_wallets: 70, prev_day_wallets: 100 });
    expect(byId(rs, "cohort_floor").ok).toBe(true);
  });

  it("ignores the day-over-day rule when there is no previous day", () => {
    const rs = evaluateChecks({ ...healthyInputs(), active_wallets: 77, prev_day_wallets: 0 });
    expect(byId(rs, "cohort_floor").ok).toBe(true);
  });

  it("flags a stalled learning loop", () => {
    const rs = evaluateChecks({ ...healthyInputs(), outcomes_resolved_48h: 0 });
    expect(byId(rs, "learning_stalled").ok).toBe(false);
  });

  it("treats missing data as broken, not as healthy", () => {
    const rs = evaluateChecks({
      now_ms:                  NOW,
      snapshot_updated_at:     null,
      heartbeat_snapshot_time: null,
      score_history_date:      null,
      active_wallets:          null,
      prev_day_wallets:        null,
      outcomes_resolved_48h:   null,
    });
    expect(rs.every((r) => !r.ok)).toBe(true);
  });

  it("treats an unparseable timestamp as broken", () => {
    const rs = evaluateChecks({ ...healthyInputs(), snapshot_updated_at: "not-a-date" });
    expect(byId(rs, "snapshot_stale").ok).toBe(false);
  });
});

describe("diffTransitions", () => {
  const nowIso = new Date(NOW).toISOString();
  const ok  = (id: string): CheckResult => ({ id: id as never, ok: true,  detail: "fine" });
  const bad = (id: string): CheckResult => ({ id: id as never, ok: false, detail: "broken" });

  it("sends nothing on a first run that is healthy, but records state", () => {
    const { transitions, writes } = diffTransitions([ok("scan_dead")], {}, nowIso);
    expect(transitions).toHaveLength(0);
    expect(writes.scan_dead).toEqual({ ok: true, since: nowIso });
  });

  it("alerts on a first run that is already broken", () => {
    const { transitions } = diffTransitions([bad("scan_dead")], {}, nowIso);
    expect(transitions).toEqual([{ id: "scan_dead", kind: "alert", detail: "broken" }]);
  });

  it("stays silent while a healthy check remains healthy", () => {
    const prev: Record<string, AlertState> = { scan_dead: { ok: true, since: nowIso } };
    const { transitions, writes } = diffTransitions([ok("scan_dead")], prev, nowIso);
    expect(transitions).toHaveLength(0);
    expect(writes).toEqual({});
  });

  it("stays silent while a broken check remains broken", () => {
    const prev: Record<string, AlertState> = { scan_dead: { ok: false, since: nowIso } };
    const { transitions, writes } = diffTransitions([bad("scan_dead")], prev, nowIso);
    expect(transitions).toHaveLength(0);
    expect(writes).toEqual({});
  });

  it("alerts once when a healthy check breaks", () => {
    const prev: Record<string, AlertState> = { scan_dead: { ok: true, since: nowIso } };
    const { transitions } = diffTransitions([bad("scan_dead")], prev, nowIso);
    expect(transitions).toHaveLength(1);
    expect(transitions[0].kind).toBe("alert");
  });

  it("sends a recovery with downtime when a broken check heals", () => {
    const prev: Record<string, AlertState> = {
      scan_dead: { ok: false, since: new Date(NOW - 80 * 60 * 1000).toISOString() },
    };
    const { transitions } = diffTransitions([ok("scan_dead")], prev, nowIso);
    expect(transitions).toHaveLength(1);
    expect(transitions[0].kind).toBe("recovery");
    expect(transitions[0].down_ms).toBe(80 * 60 * 1000);
  });

  it("handles several checks changing in the same run", () => {
    const prev: Record<string, AlertState> = {
      scan_dead:      { ok: true,  since: nowIso },
      heartbeat_dead: { ok: false, since: nowIso },
      cohort_floor:   { ok: true,  since: nowIso },
    };
    const { transitions } = diffTransitions(
      [bad("scan_dead"), ok("heartbeat_dead"), ok("cohort_floor")],
      prev,
      nowIso,
    );
    expect(transitions.map((t) => t.kind)).toEqual(["alert", "recovery"]);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run lib/__tests__/watchdog.test.ts`
Expected: FAIL, cannot resolve `../watchdog`.

- [ ] **Step 3: Implement `lib/watchdog.ts`**

```ts
// lib/watchdog.ts
// Pure health-check evaluation and alert-state transition logic.
// Deliberately imports nothing and performs no I/O: every input is passed in,
// which is what makes the whole alerting state machine unit testable.

export type CheckId =
  | "snapshot_stale"
  | "heartbeat_dead"
  | "scan_dead"
  | "cohort_floor"
  | "learning_stalled";

export const CHECK_IDS: CheckId[] = [
  "snapshot_stale",
  "heartbeat_dead",
  "scan_dead",
  "cohort_floor",
  "learning_stalled",
];

/** Every threshold in one place so the numbers are greppable. */
export const THRESHOLDS = {
  snapshot_max_age_ms:  20 * 60 * 1000,
  heartbeat_max_age_ms: 45 * 60 * 1000,
  scan_max_age_ms:      48 * 60 * 60 * 1000,
  cohort_floor:         40,
  cohort_max_drop_pct:  0.30,
  learning_window_ms:   48 * 60 * 60 * 1000,
} as const;

/** Raw values the checks run against. Null means the source was unreachable. */
export interface CheckInputs {
  now_ms:                  number;
  snapshot_updated_at:     string | null;
  heartbeat_snapshot_time: string | null;
  score_history_date:      string | null;
  active_wallets:          number | null;
  prev_day_wallets:        number | null;
  outcomes_resolved_48h:   number | null;
}

export interface CheckResult {
  id:     CheckId;
  ok:     boolean;
  detail: string;
}

export interface AlertState {
  ok:    boolean;
  since: string;
}

export interface Transition {
  id:     CheckId;
  kind:   "alert" | "recovery";
  detail: string;
  /** Recovery only: how long the check was broken. */
  down_ms?: number;
}

function ageMs(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : now - t;
}

/** Compact duration for message copy: 8m, 1h, 1h20m, 3d. */
export function formatAge(ms: number): string {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) {
    const rem = mins % 60;
    return rem ? `${hours}h${rem}m` : `${hours}h`;
  }
  return `${Math.floor(hours / 24)}d`;
}

export function evaluateChecks(i: CheckInputs): CheckResult[] {
  const results: CheckResult[] = [];

  const snapAge = ageMs(i.snapshot_updated_at, i.now_ms);
  results.push(
    snapAge === null
      ? { id: "snapshot_stale", ok: false, detail: "no cached cohort data" }
      : snapAge > THRESHOLDS.snapshot_max_age_ms
        ? { id: "snapshot_stale", ok: false, detail: `data ${formatAge(snapAge)} old, limit 20m` }
        : { id: "snapshot_stale", ok: true,  detail: `data ${formatAge(snapAge)} old` },
  );

  const beatAge = ageMs(i.heartbeat_snapshot_time, i.now_ms);
  results.push(
    beatAge === null
      ? { id: "heartbeat_dead", ok: false, detail: "no snapshot rows found" }
      : beatAge > THRESHOLDS.heartbeat_max_age_ms
        ? { id: "heartbeat_dead", ok: false, detail: `no snapshot in ${formatAge(beatAge)}, limit 45m` }
        : { id: "heartbeat_dead", ok: true,  detail: `heartbeat ${formatAge(beatAge)} ago` },
  );

  const scanAge = ageMs(i.score_history_date, i.now_ms);
  results.push(
    scanAge === null
      ? { id: "scan_dead", ok: false, detail: "no score history found" }
      : scanAge > THRESHOLDS.scan_max_age_ms
        ? { id: "scan_dead", ok: false, detail: `no scan in ${formatAge(scanAge)}, limit 48h` }
        : { id: "scan_dead", ok: true,  detail: `scan ${formatAge(scanAge)} ago` },
  );

  if (i.active_wallets === null) {
    results.push({ id: "cohort_floor", ok: false, detail: "wallet count unavailable" });
  } else if (i.active_wallets < THRESHOLDS.cohort_floor) {
    results.push({
      id: "cohort_floor",
      ok: false,
      detail: `${i.active_wallets} active, floor ${THRESHOLDS.cohort_floor}`,
    });
  } else if (
    i.prev_day_wallets !== null &&
    i.prev_day_wallets > 0 &&
    (i.prev_day_wallets - i.active_wallets) / i.prev_day_wallets > THRESHOLDS.cohort_max_drop_pct
  ) {
    const pct = Math.round(((i.prev_day_wallets - i.active_wallets) / i.prev_day_wallets) * 100);
    results.push({
      id: "cohort_floor",
      ok: false,
      detail: `${i.active_wallets} active, down ${pct}% in a day`,
    });
  } else {
    results.push({ id: "cohort_floor", ok: true, detail: `${i.active_wallets} active` });
  }

  results.push(
    i.outcomes_resolved_48h === null
      ? { id: "learning_stalled", ok: false, detail: "outcome count unavailable" }
      : i.outcomes_resolved_48h === 0
        ? { id: "learning_stalled", ok: false, detail: "no outcomes resolved in 48h" }
        : { id: "learning_stalled", ok: true, detail: `${i.outcomes_resolved_48h} outcomes in 48h` },
  );

  return results;
}

/**
 * Compare fresh results against stored state.
 * Only transitions produce a message and only transitions produce a write,
 * which is what makes an incident alert once rather than every 15 minutes.
 */
export function diffTransitions(
  results: CheckResult[],
  prev: Record<string, AlertState | null>,
  nowIso: string,
): { transitions: Transition[]; writes: Record<string, AlertState> } {
  const transitions: Transition[] = [];
  const writes: Record<string, AlertState> = {};

  for (const r of results) {
    const p = prev[r.id] ?? null;

    if (p === null) {
      writes[r.id] = { ok: r.ok, since: nowIso };
      if (!r.ok) transitions.push({ id: r.id, kind: "alert", detail: r.detail });
      continue;
    }

    if (p.ok === r.ok) continue;

    writes[r.id] = { ok: r.ok, since: nowIso };
    transitions.push(
      r.ok
        ? {
            id: r.id,
            kind: "recovery",
            detail: r.detail,
            down_ms: Math.max(0, Date.parse(nowIso) - Date.parse(p.since)),
          }
        : { id: r.id, kind: "alert", detail: r.detail },
    );
  }

  return { transitions, writes };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run lib/__tests__/watchdog.test.ts`
Expected: PASS, 20 tests.

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm run test
git add lib/watchdog.ts lib/__tests__/watchdog.test.ts
git commit -m "feat(watchdog): pure check evaluation and alert transition logic"
```

---

### Task 3: Message formatters

**Files:**
- Modify: `lib/telegram.ts` (append below `sendTelegram`)
- Test: `lib/__tests__/telegram.test.ts`

**Interfaces:**
- Consumes: `CheckId`, `CheckResult`, `Transition`, `formatAge` from `lib/watchdog.ts`.
- Produces: `CHECK_LABELS`, `formatAlert`, `formatRecovery`, `formatStatus`, `formatCheck`, `formatDigest`, `formatDigestFailure`, `formatCohort`, `formatSignals`, `formatScan`, `formatHelp`, and the input types `StatusData`, `DigestData`, `CohortData`, `SignalsData`, `ScanData`.

- [ ] **Step 1: Write the failing formatter test**

Create `lib/__tests__/telegram.test.ts`. The dash pattern is built with `new RegExp` from ASCII escape sequences on purpose: writing the literal characters into this file would trip the repo's own copy-rule hook and block the write.

```ts
import { describe, it, expect } from "vitest";
import {
  MAX_MESSAGE_CHARS,
  formatAlert,
  formatRecovery,
  formatStatus,
  formatCheck,
  formatDigest,
  formatDigestFailure,
  formatCohort,
  formatSignals,
  formatScan,
  formatHelp,
} from "../telegram";
import type { CheckResult, Transition } from "../watchdog";

const LONG_DASHES = new RegExp("[\\u2013\\u2014]");
const EMOJI = new RegExp("[\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}]", "u");

describe("formatAlert", () => {
  const t: Transition = { id: "heartbeat_dead", kind: "alert", detail: "no snapshot in 51m, limit 45m" };

  it("leads with BROKEN and the human label", () => {
    expect(formatAlert(t)).toBe("BROKEN: heartbeat dead\nno snapshot in 51m, limit 45m");
  });

  it("stays within two lines", () => {
    expect(formatAlert(t).split("\n")).toHaveLength(2);
  });
});

describe("formatRecovery", () => {
  const t: Transition = {
    id: "heartbeat_dead",
    kind: "recovery",
    detail: "heartbeat 2m ago",
    down_ms: 80 * 60 * 1000,
  };

  it("leads with RECOVERED and states the downtime", () => {
    expect(formatRecovery(t)).toBe("RECOVERED: heartbeat dead\nWas down 1h20m");
  });

  it("survives a missing down_ms", () => {
    expect(formatRecovery({ ...t, down_ms: undefined })).toContain("RECOVERED");
  });
});

describe("formatStatus", () => {
  it("says all green when nothing is broken", () => {
    expect(formatStatus({ broken: [], wallet_count: 77, data_age_ms: 2 * 60 * 1000 }))
      .toBe("All green\nCohort 77, data 2m old");
  });

  it("names the single broken check", () => {
    expect(formatStatus({ broken: ["heartbeat_dead"], wallet_count: 77, data_age_ms: 120000 }))
      .toBe("BROKEN: heartbeat dead\nCohort 77, data 2m old");
  });

  it("counts multiple broken checks rather than listing them", () => {
    const out = formatStatus({
      broken: ["heartbeat_dead", "scan_dead"],
      wallet_count: 77,
      data_age_ms: 120000,
    });
    expect(out).toBe("BROKEN: 2 checks failing\nCohort 77, data 2m old");
  });

  it("reports honestly when there is no cached data at all", () => {
    expect(formatStatus({ broken: [], wallet_count: null, data_age_ms: null }))
      .toBe("All green\nNo cached cohort data");
  });
});

describe("formatCheck", () => {
  const results: CheckResult[] = [
    { id: "snapshot_stale",   ok: true,  detail: "data 2m old" },
    { id: "heartbeat_dead",   ok: true,  detail: "heartbeat 3m ago" },
    { id: "scan_dead",        ok: true,  detail: "scan 6h ago" },
    { id: "cohort_floor",     ok: true,  detail: "77 active" },
    { id: "learning_stalled", ok: false, detail: "no outcomes resolved in 48h" },
  ];

  it("headlines the failure count and lists one line per check", () => {
    expect(formatCheck(results)).toBe(
      [
        "1 of 5 failing",
        "ok data 2m old",
        "ok heartbeat 3m ago",
        "ok scan 6h ago",
        "ok 77 active",
        "FAIL no outcomes resolved in 48h",
      ].join("\n"),
    );
  });

  it("headlines all green when everything passes", () => {
    const allOk = results.map((r) => ({ ...r, ok: true }));
    expect(formatCheck(allOk).split("\n")[0]).toBe("All green");
  });
});

describe("formatDigest", () => {
  it("renders counts, duration and the top rejection reason", () => {
    expect(
      formatDigest({
        discovered: 3063,
        activated: 248,
        active: 77,
        duration_ms: 42 * 60 * 1000,
        rate_limit_dropped: 97,
        top_rejection: { reason: "low_regime_coverage", count: 134 },
      }),
    ).toBe("Scan ok, 42m\n3063 found, 248 activated, 77 active\nlow_regime_coverage cut 134, 97 rate limited");
  });

  it("drops the third line when there is nothing notable", () => {
    const out = formatDigest({
      discovered: 3063,
      activated: 248,
      active: 77,
      duration_ms: 42 * 60 * 1000,
      rate_limit_dropped: 0,
      top_rejection: null,
    });
    expect(out.split("\n")).toHaveLength(2);
  });
});

describe("formatDigestFailure", () => {
  it("says the scan failed and where to look", () => {
    expect(formatDigestFailure("no summary written"))
      .toBe("SCAN FAILED\nno summary written, check the Actions run");
  });
});

describe("formatCohort", () => {
  it("renders active, deactivated and blown up counts", () => {
    expect(formatCohort({ active: 77, deactivated_24h: 12, blown_up_30d: 3 }))
      .toBe("Cohort 77 active\n12 deactivated in 24h, 3 blown up in 30d");
  });
});

describe("formatSignals", () => {
  it("renders the 24h count and the best recipe", () => {
    expect(formatSignals({ count_24h: 18, top_recipe: "Whale Convergence", top_expectancy_bps: 34.2 }))
      .toBe("18 signals in 24h\nBest: Whale Convergence, 34.2 bps expectancy");
  });

  it("says so plainly when no recipe has a measurement yet", () => {
    expect(formatSignals({ count_24h: 0, top_recipe: null, top_expectancy_bps: null }))
      .toBe("0 signals in 24h\nNo recipe measurements yet");
  });
});

describe("formatScan", () => {
  it("renders the last scan date and age", () => {
    expect(formatScan({ last_date: "2026-08-08", age_ms: 6 * 60 * 60 * 1000 }))
      .toBe("Last scan 2026-08-08, 6h ago\nNext run 00:00 UTC");
  });

  it("reports a missing scan rather than guessing", () => {
    expect(formatScan({ last_date: null, age_ms: null }))
      .toBe("No scan on record\nNext run 00:00 UTC");
  });
});

describe("copy rules", () => {
  const samples = [
    formatAlert({ id: "scan_dead", kind: "alert", detail: "no scan in 3d, limit 48h" }),
    formatRecovery({ id: "scan_dead", kind: "recovery", detail: "scan 1h ago", down_ms: 3600000 }),
    formatStatus({ broken: [], wallet_count: 77, data_age_ms: 120000 }),
    formatDigest({
      discovered: 3063, activated: 248, active: 77,
      duration_ms: 2520000, rate_limit_dropped: 97,
      top_rejection: { reason: "low_regime_coverage", count: 134 },
    }),
    formatDigestFailure("no summary written"),
    formatCohort({ active: 77, deactivated_24h: 12, blown_up_30d: 3 }),
    formatSignals({ count_24h: 18, top_recipe: "Whale Convergence", top_expectancy_bps: 34.2 }),
    formatScan({ last_date: "2026-08-08", age_ms: 21600000 }),
    formatHelp(),
  ];

  it("never uses a long dash character", () => {
    for (const s of samples) expect(LONG_DASHES.test(s)).toBe(false);
  });

  it("never uses emoji", () => {
    for (const s of samples) expect(EMOJI.test(s)).toBe(false);
  });

  it("keeps every pushed message under the character ceiling", () => {
    for (const s of samples) expect(s.length).toBeLessThanOrEqual(MAX_MESSAGE_CHARS);
  });

  it("keeps every pushed message to three lines at most", () => {
    for (const s of samples) expect(s.split("\n").length).toBeLessThanOrEqual(3);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run lib/__tests__/telegram.test.ts`
Expected: FAIL, the formatters are not exported yet.

- [ ] **Step 3: Append the formatters to `lib/telegram.ts`**

```ts
import { formatAge, type CheckId, type CheckResult, type Transition } from "@/lib/watchdog";

/** Human names for each check id. The only place these words are written. */
export const CHECK_LABELS: Record<CheckId, string> = {
  snapshot_stale:   "cohort data stale",
  heartbeat_dead:   "heartbeat dead",
  scan_dead:        "nightly scan dead",
  cohort_floor:     "cohort collapsed",
  learning_stalled: "learning loop stalled",
};

export interface StatusData {
  broken:       CheckId[];
  wallet_count: number | null;
  data_age_ms:  number | null;
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

  const detail =
    d.wallet_count === null || d.data_age_ms === null
      ? "No cached cohort data"
      : `Cohort ${d.wallet_count}, data ${formatAge(d.data_age_ms)} old`;

  return `${headline}\n${detail}`;
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
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run lib/__tests__/telegram.test.ts`
Expected: PASS, 22 tests.

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm run test
git add lib/telegram.ts lib/__tests__/telegram.test.ts
git commit -m "feat(telegram): message formatters with copy-rule assertions"
```

---

### Task 4: Data access layer

**Files:**
- Create: `lib/server/telegram-io.ts`

**Interfaces:**
- Consumes: `CHECK_IDS`, `AlertState`, `CheckId`, `CheckInputs` from `lib/watchdog.ts`; `CohortCachePayload` from `app/api/refresh-cohort/route.ts`; `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` from `lib/env.ts`; `RECIPE_META` from `lib/recipe-meta.ts`; `CohortData`, `SignalsData`, `ScanData`, `StatusData` from `lib/telegram.ts`.
- Produces: `collectCheckInputs(): Promise<CheckInputs>`, `readAlertState(): Promise<Record<string, AlertState | null>>`, `writeAlertState(writes: Record<string, AlertState>): Promise<void>`, `fetchStatusData(): Promise<StatusData>`, `fetchCohortData(): Promise<CohortData>`, `fetchSignalsData(): Promise<SignalsData>`, `fetchScanData(): Promise<ScanData>`.

There is no test for this task. It is pure I/O against live services, and the project convention is that data-access and route code is verified by manual run rather than by mocked unit tests. The logic it feeds is already covered by Tasks 2 and 3.

- [ ] **Step 1: Create the io module**

```ts
// lib/server/telegram-io.ts
// Every read the Telegram bot performs. Isolated here so lib/watchdog.ts can
// stay pure and lib/telegram.ts can stay copy-only.

import { kv } from "@vercel/kv";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "@/lib/env";
import type { CohortCachePayload } from "@/app/api/refresh-cohort/route";
import { CHECK_IDS, type AlertState, type CheckId, type CheckInputs } from "@/lib/watchdog";
import { RECIPE_META } from "@/lib/recipe-meta";
import type { CohortData, ScanData, SignalsData, StatusData } from "@/lib/telegram";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/** KV values arrive as objects or as JSON strings depending on how they were written. */
function parse<T>(raw: unknown): T | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try { return JSON.parse(raw) as T; } catch { return null; }
  }
  return raw as T;
}

const stateKey = (id: CheckId) => `alert:state:${id}`;

async function readCohortCache(): Promise<CohortCachePayload | null> {
  try { return parse<CohortCachePayload>(await kv.get("cohort:active")); }
  catch { return null; }
}

export async function readAlertState(): Promise<Record<string, AlertState | null>> {
  const out: Record<string, AlertState | null> = {};
  await Promise.all(
    CHECK_IDS.map(async (id) => {
      try { out[id] = parse<AlertState>(await kv.get(stateKey(id))); }
      catch { out[id] = null; }
    }),
  );
  return out;
}

export async function writeAlertState(writes: Record<string, AlertState>): Promise<void> {
  await Promise.all(
    Object.entries(writes).map(([id, s]) => kv.set(stateKey(id as CheckId), s)),
  );
}

export async function collectCheckInputs(): Promise<CheckInputs> {
  const now = Date.now();
  const yesterday = new Date(now - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const since48h  = new Date(now - 48 * 60 * 60 * 1000).toISOString();

  const [cache, beat, hist, active, prevDay, outcomes] = await Promise.all([
    readCohortCache(),
    supabase.from("cohort_snapshots").select("snapshot_time")
      .order("snapshot_time", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("wallet_score_history").select("date")
      .order("date", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("wallets").select("id", { count: "exact", head: true })
      .eq("is_active", true),
    supabase.from("wallet_score_history").select("wallet_id", { count: "exact", head: true })
      .eq("date", yesterday),
    supabase.from("signal_outcomes").select("id", { count: "exact", head: true })
      .gte("resolved_at", since48h),
  ]);

  return {
    now_ms:                  now,
    snapshot_updated_at:     cache?.updated_at ?? null,
    heartbeat_snapshot_time: beat.data?.snapshot_time ?? null,
    score_history_date:      hist.data?.date ?? null,
    active_wallets:          active.error   ? null : active.count   ?? null,
    prev_day_wallets:        prevDay.error  ? null : prevDay.count  ?? null,
    outcomes_resolved_48h:   outcomes.error ? null : outcomes.count ?? null,
  };
}

/** One KV read plus the five state keys. Deliberately never touches Supabase. */
export async function fetchStatusData(): Promise<StatusData> {
  const [cache, state] = await Promise.all([readCohortCache(), readAlertState()]);
  const broken = CHECK_IDS.filter((id) => state[id]?.ok === false);
  const updated = cache?.updated_at ? Date.parse(cache.updated_at) : NaN;

  return {
    broken,
    wallet_count: cache?.total_active_wallets ?? cache?.wallet_count ?? null,
    data_age_ms:  Number.isNaN(updated) ? null : Date.now() - updated,
  };
}

export async function fetchCohortData(): Promise<CohortData> {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [active, deactivated, blownUp] = await Promise.all([
    supabase.from("wallets").select("id", { count: "exact", head: true })
      .eq("is_active", true),
    supabase.from("wallets").select("id", { count: "exact", head: true })
      .gte("deactivated_at", since24h),
    supabase.from("cohort_attrition").select("wallet_address", { count: "exact", head: true })
      .eq("state_30d", "blown_up"),
  ]);

  return {
    active:          active.count      ?? 0,
    deactivated_24h: deactivated.count ?? 0,
    blown_up_30d:    blownUp.count     ?? 0,
  };
}

export async function fetchSignalsData(): Promise<SignalsData> {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [count, best] = await Promise.all([
    supabase.from("signal_outcomes").select("id", { count: "exact", head: true })
      .gte("created_at", since24h),
    supabase.from("recipe_performance")
      .select("recipe_id, expectancy_bps_net")
      .not("expectancy_bps_net", "is", null)
      .order("expectancy_bps_net", { ascending: false })
      .limit(1).maybeSingle(),
  ]);

  const recipeId = best.data?.recipe_id ?? null;
  const bps = best.data?.expectancy_bps_net;

  return {
    count_24h:  count.count ?? 0,
    top_recipe: recipeId ? (RECIPE_META[recipeId]?.label ?? recipeId) : null,
    top_expectancy_bps: bps === undefined || bps === null ? null : Number(bps),
  };
}

export async function fetchScanData(): Promise<ScanData> {
  const hist = await supabase.from("wallet_score_history").select("date")
    .order("date", { ascending: false }).limit(1).maybeSingle();

  const date = hist.data?.date ?? null;
  const parsed = date ? Date.parse(date) : NaN;

  return {
    last_date: date,
    age_ms:    Number.isNaN(parsed) ? null : Date.now() - parsed,
  };
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
npm run typecheck && npm run test
git add lib/server/telegram-io.ts
git commit -m "feat(telegram): data access layer for checks and commands"
```

---

### Task 5: Watchdog route and freshness-check rewiring

**Files:**
- Create: `app/api/telegram/watchdog/route.ts`
- Modify: `.github/workflows/freshness-check.yml` (replace the whole file)

**Interfaces:**
- Consumes: `verifyCronAuth` from `lib/auth/cron.ts`; `collectCheckInputs`, `readAlertState`, `writeAlertState` from `lib/server/telegram-io.ts`; `evaluateChecks`, `diffTransitions`, `CheckResult` from `lib/watchdog.ts`; `sendTelegram`, `formatAlert`, `formatRecovery` from `lib/telegram.ts`.
- Produces: `POST /api/telegram/watchdog` returning `{ checked: number; failing: number; sent: number }`, and an exported `runWatchdog(): Promise<{ results: CheckResult[]; sent: number }>` that Task 6 reuses for `/check`.

- [ ] **Step 1: Create the route**

```ts
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
```

- [ ] **Step 2: Replace the workflow**

Overwrite `.github/workflows/freshness-check.yml`:

```yaml
name: Cohort Freshness Check

# Triggers the app-side watchdog every 15 minutes. The watchdog owns the
# definition of every health check and decides whether to send a Telegram
# message, so this workflow holds no thresholds of its own.
#
# The curl is intentionally -f: if the route is unreachable the step fails and
# GitHub's default failure email fires. That email is the meta alert for
# "the watchdog itself is down", the one case Telegram cannot cover.

on:
  schedule:
    - cron: '*/15 * * * *'
  workflow_dispatch:

jobs:
  check:
    runs-on: ubuntu-latest
    timeout-minutes: 2
    steps:
      - name: Trigger watchdog
        env:
          TARGET_URL: https://hyperliquidflow.vercel.app/api/telegram/watchdog
          CRON_SECRET: ${{ secrets.CRON_SECRET }}
        run: |
          set -euo pipefail
          curl -sS -f -X POST "$TARGET_URL" \
            -H "Authorization: Bearer $CRON_SECRET"
```

- [ ] **Step 3: Confirm the cron secret exists**

Run: `gh secret list`
Expected: `CRON_SECRET` appears. If it does not, stop and tell the owner, because every scheduled run will 401.

- [ ] **Step 4: Typecheck and commit**

```bash
npm run typecheck && npm run test
git add app/api/telegram/watchdog/route.ts .github/workflows/freshness-check.yml
git commit -m "feat(telegram): watchdog route, freshness-check now triggers it"
```

---

### Task 6: Webhook route and commands

**Files:**
- Create: `app/api/telegram/webhook/route.ts`

**Interfaces:**
- Consumes: `verifyTelegramWebhook`, `isAuthorizedChat` from `lib/auth/telegram.ts`; `runWatchdog` from `app/api/telegram/watchdog/route.ts`; `fetchStatusData`, `fetchCohortData`, `fetchSignalsData`, `fetchScanData` from `lib/server/telegram-io.ts`; `sendTelegram`, `formatStatus`, `formatCheck`, `formatCohort`, `formatSignals`, `formatScan`, `formatHelp` from `lib/telegram.ts`.
- Produces: `POST /api/telegram/webhook`.

- [ ] **Step 1: Create the route**

```ts
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
```

- [ ] **Step 2: Verify the route builds**

Run: `npm run typecheck && npm run build`
Expected: both pass, and the build output lists `/api/telegram/webhook` and `/api/telegram/watchdog`.

- [ ] **Step 3: Commit**

```bash
npm run test
git add app/api/telegram/webhook/route.ts
git commit -m "feat(telegram): webhook route with five read-only commands"
```

---

### Task 7: Nightly digest, workflow wiring, docs

**Files:**
- Create: `scripts/notify-scan-digest.ts`
- Modify: `.github/workflows/daily-wallet-scan.yml`
- Modify: `CLAUDE.md`
- Modify: `docs/sprints/status.md`

**Interfaces:**
- Consumes: `sendTelegram`, `formatDigest`, `formatDigestFailure` from `lib/telegram.ts`; `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` from `lib/env.ts`.
- Produces: nothing importable. This is the last task.

- [ ] **Step 1: Create the digest script**

```ts
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
```

- [ ] **Step 2: Add the workflow step**

In `.github/workflows/daily-wallet-scan.yml`, add this step after the existing "Assert scan produced score history" step:

```yaml
      - name: Send scan digest to Telegram
        if: always()
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
          SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
          KV_REST_API_URL: ${{ secrets.KV_REST_API_URL }}
          KV_REST_API_TOKEN: ${{ secrets.KV_REST_API_TOKEN }}
          KV_REST_API_READ_ONLY_TOKEN: ${{ secrets.KV_REST_API_READ_ONLY_TOKEN }}
          TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          TELEGRAM_CHAT_ID: ${{ secrets.TELEGRAM_CHAT_ID }}
          TELEGRAM_WEBHOOK_SECRET: ${{ secrets.TELEGRAM_WEBHOOK_SECRET }}
        run: npx tsx scripts/notify-scan-digest.ts
```

The KV and Supabase vars are listed because `lib/env.ts` validates them all at module load and this script imports it. That eager validation is the known issue tracked as R27.

- [ ] **Step 3: Document the routes and env vars**

In `CLAUDE.md`, add to the API Routes list:

```markdown
- `telegram/webhook`: inbound Telegram commands (`/status`, `/check`, `/cohort`, `/signals`, `/scan`). Read only, single authorized chat.
- `telegram/watchdog`: runs the five health checks, sends a Telegram message only on a state change. Triggered every 15 min by `freshness-check.yml`.
```

Add to the Core Engines table:

```markdown
| `watchdog.ts` | Pure health-check evaluation and alert state transitions, no I/O |
| `telegram.ts` | Telegram transport plus every bot message string |
```

Replace the `freshness-check.yml` bullet in the GitHub Actions section:

```markdown
- **`freshness-check.yml`**: every 15 min. Calls `/api/telegram/watchdog`, which owns all five check definitions and alerts once per state change. A failed curl means the app is unreachable, and GitHub's failure email covers that case.
```

Add to the Environment Variables block:

```
TELEGRAM_BOT_TOKEN=             # BotFather token, required in production
TELEGRAM_CHAT_ID=               # the single authorized chat, all others ignored
TELEGRAM_WEBHOOK_SECRET=        # registered at setWebhook time
```

- [ ] **Step 4: Update the sprint log**

In `docs/sprints/status.md`, add a row to the Remediation Plan Sprints table:

```markdown
| R28 | Telegram ops bot | COMPLETE (2026-08-08) | 5 read-only commands, transition-based alerts, nightly digest. Spec: 2026-08-08-telegram-ops-bot-design.md |
```

- [ ] **Step 5: Full verification and commit**

```bash
npm run typecheck && npm run lint && npm run test
git add scripts/notify-scan-digest.ts .github/workflows/daily-wallet-scan.yml CLAUDE.md docs/sprints/status.md
git commit -m "feat(telegram): nightly scan digest, workflow wiring, docs"
```

---

## Owner setup, required before anything works

These cannot be automated. Do them after the branch merges and deploys.

0. **Add `CRON_SECRET` to GitHub repository secrets.** It currently exists only
   as a Vercel env var, and no workflow referenced it before this change. Use
   the exact same value as the Vercel one. Without it `freshness-check.yml`
   sends an empty Bearer token and gets a 401 on every scheduled run, so the
   watchdog never executes.
1. Message `@BotFather`, send `/newbot`, save the token.
2. Message the new bot once, then open
   `https://api.telegram.org/bot<TOKEN>/getUpdates` and read `message.chat.id`.
3. Generate a secret: `openssl rand -hex 32`.
4. Add `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_WEBHOOK_SECRET` to
   the Vercel project env (production) and to GitHub repository secrets.
5. Redeploy so Vercel picks up the new env vars.
6. Register the webhook once:

```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -H "content-type: application/json" \
  -d '{
    "url": "https://hyperliquidflow.vercel.app/api/telegram/webhook",
    "secret_token": "<WEBHOOK_SECRET>",
    "allowed_updates": ["message"]
  }'
```

7. Send `/status` to the bot. A reply confirms the whole path.

## Acceptance criteria

- `npm run test`, `npm run typecheck` and `npm run lint` all pass.
- `/status`, `/check`, `/cohort`, `/signals`, `/scan` each reply within a few
  seconds. Any other text replies with the command list.
- A message sent from a different Telegram account produces no reply at all.
- `freshness-check.yml` run via `workflow_dispatch` while healthy sends nothing.
- Breaking a check deliberately produces exactly one alert across repeated
  runs, and exactly one recovery once it is reverted.
- The nightly scan produces one digest message.
