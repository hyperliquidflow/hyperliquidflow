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

// Built from escape sequences on purpose: writing the literal characters into
// this file would trip the repo's own copy-rule hook and block the write.
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
  it("says all green and reports directional tilt", () => {
    expect(formatStatus({ broken: [], wallet_count: 77, data_age_ms: 2 * 60 * 1000, long_pct: 68 }))
      .toBe("All green\nCohort 77, 68% long, data 2m old");
  });

  it("names the single broken check", () => {
    expect(formatStatus({ broken: ["heartbeat_dead"], wallet_count: 77, data_age_ms: 120000, long_pct: 68 }))
      .toBe("BROKEN: heartbeat dead\nCohort 77, 68% long, data 2m old");
  });

  it("counts multiple broken checks rather than listing them", () => {
    const out = formatStatus({
      broken: ["heartbeat_dead", "scan_dead"],
      wallet_count: 77,
      data_age_ms: 120000,
      long_pct: 68,
    });
    expect(out).toBe("BROKEN: 2 checks failing\nCohort 77, 68% long, data 2m old");
  });

  it("omits tilt when no wallet holds an open position", () => {
    expect(formatStatus({ broken: [], wallet_count: 77, data_age_ms: 120000, long_pct: null }))
      .toBe("All green\nCohort 77, data 2m old");
  });

  it("reports a fully short cohort without dropping the zero", () => {
    expect(formatStatus({ broken: [], wallet_count: 77, data_age_ms: 120000, long_pct: 0 }))
      .toBe("All green\nCohort 77, 0% long, data 2m old");
  });

  it("reports honestly when there is no cached data at all", () => {
    expect(formatStatus({ broken: [], wallet_count: null, data_age_ms: null, long_pct: null }))
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
    formatStatus({ broken: [], wallet_count: 77, data_age_ms: 120000, long_pct: 68 }),
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
