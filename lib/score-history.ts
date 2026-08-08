// Pure row-building logic for daily wallet score history (rank IC input).
// Kept free of Supabase and env imports so it is unit-testable.

export interface ScoreHistoryRow {
  date: string;
  wallet_id: string;
  overall_score: number;
  overall_score_shadow: number | null;
  daily_pnl_usd: number;
}

export function buildScoreHistoryRows(
  date: string,
  activeWallets: Array<{ id: string; overall_score_shadow?: number | null }>,
  snapshots: Array<{ wallet_id: string; overall_score: number | null; snapshot_time: string }>,
  backtests: Array<{ wallet_id: string; daily_pnls: number[] | null }>
): ScoreHistoryRow[] {
  const latestScore = new Map<string, number>();
  for (const snap of snapshots) {
    if (!latestScore.has(snap.wallet_id) && snap.overall_score !== null) {
      latestScore.set(snap.wallet_id, snap.overall_score);
    }
  }

  const pnlMap = new Map<string, number>();
  for (const bt of backtests) {
    const arr = bt.daily_pnls;
    if (Array.isArray(arr) && arr.length > 0) {
      pnlMap.set(bt.wallet_id, arr[arr.length - 1] ?? 0);
    }
  }

  return activeWallets
    .filter((w) => latestScore.has(w.id))
    .map((w) => ({
      date,
      wallet_id: w.id,
      overall_score: latestScore.get(w.id) as number,
      overall_score_shadow: w.overall_score_shadow ?? null,
      daily_pnl_usd: pnlMap.get(w.id) ?? 0,
    }));
}
