import { describe as suite, it, expect } from "vitest";
import { freezeToDiscovery, fetchDiscoveryDates, describeFreeze } from "@/lib/discovery";

const DAY = 86_400_000;
const fill = (w: string, t: number) => ({ w, t });

suite("freezeToDiscovery", () => {
  it("keeps entries at or after the wallet's discovery date", () => {
    const discovered = new Map([["a", 10 * DAY]]);
    const r = freezeToDiscovery([fill("a", 9 * DAY), fill("a", 10 * DAY), fill("a", 11 * DAY)], discovered);
    expect(r.kept.map((f) => f.t)).toEqual([10 * DAY, 11 * DAY]);
    expect(r.fillsBefore).toBe(3);
    expect(r.fillsAfter).toBe(2);
  });

  // A leaderboard-discovered wallet is selected because it already performed,
  // so its earlier trades are chosen knowing how they turned out.
  it("drops the pre-discovery history that no follower could have copied", () => {
    const discovered = new Map([["a", 100 * DAY]]);
    const r = freezeToDiscovery(Array.from({ length: 50 }, (_, i) => fill("a", i * DAY)), discovered);
    expect(r.kept).toHaveLength(0);
    expect(r.walletsAfter).toBe(0);
  });

  it("drops wallets with no discovery record rather than assuming they were knowable", () => {
    const r = freezeToDiscovery([fill("ghost", 5 * DAY)], new Map());
    expect(r.kept).toHaveLength(0);
  });

  it("freezes each wallet at its own date, not a shared one", () => {
    const discovered = new Map([["early", 1 * DAY], ["late", 20 * DAY]]);
    const r = freezeToDiscovery([fill("early", 5 * DAY), fill("late", 5 * DAY)], discovered);
    expect(r.kept.map((f) => f.w)).toEqual(["early"]);
  });

  it("reports the earliest discovery, which bounds any clean claim", () => {
    const discovered = new Map([["a", 30 * DAY], ["b", 12 * DAY]]);
    const r = freezeToDiscovery([fill("a", 40 * DAY), fill("b", 40 * DAY)], discovered);
    expect(r.earliestDiscovery).toBe(12 * DAY);
  });

  it("handles an empty input", () => {
    const r = freezeToDiscovery([], new Map());
    expect(r.kept).toEqual([]);
    expect(r.earliestDiscovery).toBeNull();
  });
});

suite("fetchDiscoveryDates", () => {
  const stub = (rows: Array<{ id: string; created_at: string }>, calls: string[][] = []) => ({
    from: () => ({
      select: () => ({
        in: async (_col: string, values: string[]) => {
          calls.push(values);
          return { data: rows.filter((r) => values.includes(r.id)), error: null };
        },
      }),
    }),
  });

  it("maps ids to millisecond timestamps", async () => {
    const db = stub([{ id: "a", created_at: "2026-04-11T00:00:00.000Z" }]);
    const out = await fetchDiscoveryDates(db, ["a"]);
    expect(out.get("a")).toBe(Date.parse("2026-04-11T00:00:00.000Z"));
  });

  // PostgREST puts `in` filters in the URL, so a few hundred UUIDs overflow it.
  it("chunks large id lists", async () => {
    const calls: string[][] = [];
    const db = stub([], calls);
    await fetchDiscoveryDates(db, Array.from({ length: 450 }, (_, i) => `w${i}`), 200);
    expect(calls.map((c) => c.length)).toEqual([200, 200, 50]);
  });

  it("surfaces a query error instead of returning a silently empty map", async () => {
    const db = {
      from: () => ({ select: () => ({ in: async () => ({ data: null, error: { message: "boom" } }) }) }),
    };
    await expect(fetchDiscoveryDates(db, ["a"])).rejects.toThrow(/boom/);
  });
});

suite("describeFreeze", () => {
  it("states the kept share and the bound on any clean claim", () => {
    const r = freezeToDiscovery([fill("a", 10 * DAY), fill("a", 1 * DAY)], new Map([["a", 5 * DAY]]));
    const lines = describeFreeze(r, "[test]").join("\n");
    expect(lines).toContain("50% kept");
    expect(lines).toContain("1970-01-06");
  });
});
