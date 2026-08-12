// lib/watchdog.ts
// Pure health-check evaluation and alert-state transition logic.
// Deliberately imports nothing and performs no I/O: every input is passed in,
// which is what makes the whole alerting state machine unit testable.

export type CheckId =
  | "snapshot_stale"
  | "heartbeat_dead"
  | "scan_dead"
  | "cohort_floor"
  | "cohort_unfunded"
  | "learning_stalled";

export const CHECK_IDS: CheckId[] = [
  "snapshot_stale",
  "heartbeat_dead",
  "scan_dead",
  "cohort_floor",
  "cohort_unfunded",
  "learning_stalled",
];

/** Every threshold in one place so the numbers are greppable. */
export const THRESHOLDS = {
  snapshot_max_age_ms:  20 * 60 * 1000,
  heartbeat_max_age_ms: 45 * 60 * 1000,
  scan_max_age_ms:      48 * 60 * 60 * 1000,
  cohort_floor:         40,
  cohort_max_drop_pct:  0.30,
  /**
   * Share of active wallets that must hold actual equity. On 2026-08-11 the
   * cohort read 76 active with 49 holding exactly $0, and nothing alerted
   * because the headline count looked fine. A wallet with no money cannot
   * contribute to a signal, so the funded share is the honest measure of
   * cohort health. 0.80 leaves room for accounts emptied between a scan and
   * the next hygiene pass without tolerating a structural failure.
   */
  min_funded_share:     0.80,
  /**
   * How long an outcome may sit ungraded before the grader is at fault.
   * measure-outcomes runs daily at 02:00 UTC (vercel.json) against a 24h
   * horizon, so a signal firing just after a run waits ~24h to mature and
   * ~24h more for the next run. 50h allows both plus cron drift.
   */
  outcome_overdue_ms:   50 * 60 * 60 * 1000,
} as const;

/** Raw values the checks run against. Null means the source was unreachable. */
export interface CheckInputs {
  now_ms:                  number;
  snapshot_updated_at:     string | null;
  heartbeat_snapshot_time: string | null;
  score_history_date:      string | null;
  /** Live count, from wallets.is_active. Drives the absolute floor. */
  active_wallets:          number | null;
  /**
   * Wallets scored today and yesterday, both from wallet_score_history.
   * The drop rule compares these two and never touches active_wallets:
   * a wallet can be scored in the morning and deactivated by hygiene the
   * same afternoon, so scored-today and active-now are different
   * populations and comparing them invents a collapse that never happened.
   */
  scored_today:            number | null;
  scored_yesterday:        number | null;
  /**
   * Outcomes past outcome_overdue_ms with no resolved_at. This, not the
   * recent-resolution count, is what says the grader failed: a restarted
   * pipeline legitimately resolves nothing for a day or more while its
   * first signals mature.
   */
  outcomes_overdue:        number | null;
  /** Informational only, used for the healthy-state message. */
  outcomes_resolved_48h:   number | null;
  /**
   * Active wallets whose latest snapshot shows equity above zero. The count of
   * active wallets says how many passed the gates; this says how many can
   * actually take a position, which is the only state that produces a signal.
   */
  active_funded:           number | null;
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
    i.scored_today !== null &&
    i.scored_yesterday !== null &&
    i.scored_yesterday > 0 &&
    (i.scored_yesterday - i.scored_today) / i.scored_yesterday > THRESHOLDS.cohort_max_drop_pct
  ) {
    const pct = Math.round(((i.scored_yesterday - i.scored_today) / i.scored_yesterday) * 100);
    results.push({
      id: "cohort_floor",
      ok: false,
      detail: `${i.scored_today} scored, down ${pct}% vs yesterday`,
    });
  } else {
    results.push({ id: "cohort_floor", ok: true, detail: `${i.active_wallets} active` });
  }

  // Funded share. Deliberately silent when the cohort is empty: 0 of 0 is not
  // an unfunded problem, it is the cohort_floor check's incident, and firing
  // both would alert twice for one failure.
  if (i.active_funded === null || i.active_wallets === null) {
    results.push({ id: "cohort_unfunded", ok: false, detail: "funded count unavailable" });
  } else if (i.active_wallets === 0) {
    results.push({ id: "cohort_unfunded", ok: true, detail: "no active wallets to fund" });
  } else {
    const share = i.active_funded / i.active_wallets;
    const pct = Math.round(share * 100);
    results.push(
      share < THRESHOLDS.min_funded_share
        ? {
            id: "cohort_unfunded",
            ok: false,
            detail: `only ${i.active_funded} of ${i.active_wallets} active wallets funded, ${pct}%, floor ${Math.round(THRESHOLDS.min_funded_share * 100)}%`,
          }
        : { id: "cohort_unfunded", ok: true, detail: `${pct}% of active wallets funded` },
    );
  }

  results.push(
    i.outcomes_overdue === null
      ? { id: "learning_stalled", ok: false, detail: "outcome count unavailable" }
      : i.outcomes_overdue > 0
        ? {
            id: "learning_stalled",
            ok: false,
            detail: `${i.outcomes_overdue} outcomes ungraded past 50h`,
          }
        : {
            id: "learning_stalled",
            ok: true,
            detail: i.outcomes_resolved_48h
              ? `${i.outcomes_resolved_48h} graded in 48h`
              : "nothing overdue",
          },
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
