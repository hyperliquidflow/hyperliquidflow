import { describe, it, expect } from "vitest";
import { diffPositions } from "../alert-engine";
import type { PositionSnapshot } from "../alert-engine";

const BTC_LONG: PositionSnapshot  = { coin: "BTC", szi: 0.1,  entry_px: 90_000, side: "long" };
const ETH_LONG: PositionSnapshot  = { coin: "ETH", szi: 2.0,  entry_px: 3_000,  side: "long" };
const BTC_SHORT: PositionSnapshot = { coin: "BTC", szi: -0.1, entry_px: 90_000, side: "short" };

describe("diffPositions", () => {
  it("detects POSITION_OPENED when asset appears", () => {
    const events = diffPositions([], [BTC_LONG], "0xabc");
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe("POSITION_OPENED");
    expect(events[0].asset).toBe("BTC");
    expect(events[0].side).toBe("long");
    expect(events[0].wallet_address).toBe("0xabc");
    expect(events[0].price).toBe(90_000);
  });

  it("detects POSITION_CLOSED when asset disappears", () => {
    const events = diffPositions([BTC_LONG], [], "0xabc");
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe("POSITION_CLOSED");
    expect(events[0].asset).toBe("BTC");
  });

  it("detects POSITION_RESIZED when szi changes > 10%", () => {
    const bigger: PositionSnapshot = { ...BTC_LONG, szi: 0.12 };
    const events = diffPositions([BTC_LONG], [bigger], "0xabc");
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe("POSITION_RESIZED");
  });

  it("ignores szi changes <= 10%", () => {
    const slight: PositionSnapshot = { ...BTC_LONG, szi: 0.105 };
    expect(diffPositions([BTC_LONG], [slight], "0xabc")).toHaveLength(0);
  });

  it("returns no events when positions unchanged", () => {
    expect(diffPositions([BTC_LONG], [BTC_LONG], "0xabc")).toHaveLength(0);
  });

  it("handles multiple events in one diff", () => {
    const events = diffPositions([BTC_LONG], [ETH_LONG], "0xabc");
    expect(events).toHaveLength(2);
    expect(events.map(e => e.event_type).sort()).toEqual(["POSITION_CLOSED", "POSITION_OPENED"]);
  });

  it("computes size_usd as abs(szi) * entry_px", () => {
    const events = diffPositions([], [BTC_LONG], "0xabc");
    expect(events[0].size_usd).toBeCloseTo(9_000);
  });

  it("detects SHORT side correctly", () => {
    const events = diffPositions([], [BTC_SHORT], "0xabc");
    expect(events[0].side).toBe("short");
  });

  it("handles empty prev and empty current", () => {
    expect(diffPositions([], [], "0xabc")).toHaveLength(0);
  });
});
