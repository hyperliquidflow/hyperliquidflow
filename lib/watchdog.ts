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
