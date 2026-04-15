import { formatSignalTime } from "../utils";
import { describe, it, expect } from "vitest";

describe("formatSignalTime", () => {
  it("returns relative time for signals under 2 hours old", () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    expect(formatSignalTime(oneHourAgo)).toBe("1h ago");
  });

  it("returns relative time for signals at exactly 1h 59m", () => {
    const almostTwo = new Date(Date.now() - (2 * 60 * 60 * 1000 - 60_000)).toISOString();
    expect(formatSignalTime(almostTwo)).toMatch(/ago$/);
  });

  it("returns absolute timestamp for signals 2+ hours old", () => {
    // Fixed date: Apr 15 2026, 14:32 UTC (definitely 2+ hours old)
    // When displayed in local time, this becomes 16:32
    const old = "2026-04-15T14:32:00.000Z";
    const result = formatSignalTime(old);
    // Should not end with "ago"
    expect(result).not.toMatch(/ago$/);
    // Should contain the date and time portion (in local time)
    expect(result).toMatch(/Apr 15/);
    expect(result).toMatch(/16:32/);
  });

  it("returns absolute timestamp for signals exactly 2 hours old", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    expect(formatSignalTime(twoHoursAgo)).not.toMatch(/ago$/);
  });
});
