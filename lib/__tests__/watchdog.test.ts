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
