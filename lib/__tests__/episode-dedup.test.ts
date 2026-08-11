import { describe, it, expect } from "vitest";
import { collapseToEpisodes } from "../episode-dedup";

const MIN = 60_000;
const base = Date.parse("2026-08-10T00:00:00.000Z");

/** Signal at N minutes past the base time. */
const at = (id: string, minutes: number, over: Partial<{ recipe_id: string; coin: string; direction: string }> = {}) => ({
  id,
  recipe_id: over.recipe_id ?? "funding_divergence",
  coin:      over.coin      ?? "KAITO",
  direction: over.direction ?? "LONG",
  created_at: new Date(base + minutes * MIN).toISOString(),
});

describe("collapseToEpisodes", () => {
  it("keeps the first signal of a run and drops the poll-cadence repeats", () => {
    // One held position, re-emitted every 10 minutes by the pre-fix recipe.
    const rows = [at("a", 0), at("b", 10), at("c", 20), at("d", 30)];
    const { keep, drop } = collapseToEpisodes(rows, { gapMs: 2 * 60 * MIN });

    expect(keep).toEqual(["a"]);
    expect(drop).toEqual(["b", "c", "d"]);
  });

  it("starts a new episode after a gap longer than the threshold", () => {
    // Position closed and reopened hours later: two genuine ideas.
    const rows = [at("a", 0), at("b", 10), at("c", 400), at("d", 410)];
    const { keep, drop } = collapseToEpisodes(rows, { gapMs: 2 * 60 * MIN });

    expect(keep).toEqual(["a", "c"]);
    expect(drop).toEqual(["b", "d"]);
  });

  it("tracks each recipe, coin and direction as its own episode", () => {
    const rows = [
      at("a", 0),
      at("b", 5, { coin: "ETH" }),
      at("c", 5, { direction: "SHORT" }),
      at("d", 5, { recipe_id: "momentum_stack" }),
      at("e", 10),
    ];
    const { keep, drop } = collapseToEpisodes(rows, { gapMs: 2 * 60 * MIN });

    expect(keep.sort()).toEqual(["a", "b", "c", "d"]);
    expect(drop).toEqual(["e"]);
  });

  it("keeps signals that are already spaced out", () => {
    const rows = [at("a", 0), at("b", 200), at("c", 400)];
    const { keep, drop } = collapseToEpisodes(rows, { gapMs: 2 * 60 * MIN });

    expect(keep).toEqual(["a", "b", "c"]);
    expect(drop).toEqual([]);
  });

  it("measures the gap from the previous signal, not from the episode start", () => {
    // A continuous 10-minute drip is one episode however long it runs.
    const rows = Array.from({ length: 12 }, (_, i) => at(String(i), i * 10));
    const { keep, drop } = collapseToEpisodes(rows, { gapMs: 2 * 60 * MIN });

    expect(keep).toEqual(["0"]);
    expect(drop).toHaveLength(11);
  });

  it("handles rows arriving out of chronological order", () => {
    const rows = [at("c", 20), at("a", 0), at("b", 10)];
    const { keep } = collapseToEpisodes(rows, { gapMs: 2 * 60 * MIN });

    expect(keep).toEqual(["a"]);
  });

  it("returns nothing to drop for an empty input", () => {
    expect(collapseToEpisodes([], { gapMs: 1000 })).toEqual({ keep: [], drop: [] });
  });
});
