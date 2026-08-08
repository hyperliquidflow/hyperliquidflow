import { describe, it, expect } from "vitest";
import { buildScoreHistoryRows } from "../score-history";

const DATE = "2026-08-08";

describe("buildScoreHistoryRows", () => {
  it("takes the newest snapshot score per wallet (input sorted newest-first)", () => {
    const rows = buildScoreHistoryRows(
      DATE,
      [{ id: "w1", overall_score_shadow: 0.7 }],
      [
        { wallet_id: "w1", overall_score: 0.61, snapshot_time: "2026-08-08T00:37:00Z" },
        { wallet_id: "w1", overall_score: 0.42, snapshot_time: "2026-08-07T00:37:00Z" },
      ],
      [{ wallet_id: "w1", daily_pnls: [10, 20, 30] }]
    );
    expect(rows).toEqual([
      { date: DATE, wallet_id: "w1", overall_score: 0.61, overall_score_shadow: 0.7, daily_pnl_usd: 30 },
    ]);
  });

  it("skips wallets that have no snapshot score", () => {
    const rows = buildScoreHistoryRows(
      DATE,
      [{ id: "w1" }, { id: "w2" }],
      [{ wallet_id: "w2", overall_score: 0.5, snapshot_time: "2026-08-08T00:37:00Z" }],
      []
    );
    expect(rows.map((r) => r.wallet_id)).toEqual(["w2"]);
  });

  it("defaults pnl to 0 and shadow to null when absent", () => {
    const rows = buildScoreHistoryRows(
      DATE,
      [{ id: "w1" }],
      [{ wallet_id: "w1", overall_score: 0.5, snapshot_time: "2026-08-08T00:37:00Z" }],
      [{ wallet_id: "w1", daily_pnls: null }]
    );
    expect(rows[0].daily_pnl_usd).toBe(0);
    expect(rows[0].overall_score_shadow).toBeNull();
  });

  it("ignores snapshots with null overall_score", () => {
    const rows = buildScoreHistoryRows(
      DATE,
      [{ id: "w1" }],
      [
        { wallet_id: "w1", overall_score: null, snapshot_time: "2026-08-08T00:37:00Z" },
        { wallet_id: "w1", overall_score: 0.33, snapshot_time: "2026-08-07T00:37:00Z" },
      ],
      []
    );
    expect(rows[0].overall_score).toBe(0.33);
  });
});
