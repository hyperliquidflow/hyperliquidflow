// lib/episode-dedup.ts
// Collapses poll-cadence repeats back into the single idea they represent.
//
// Before 2026-08-11, funding_divergence emitted on the current state rather than
// on the change since the last snapshot, so a held position produced one signal
// per poll. A single KAITO long generated 83 rows in 13.5 hours. Those rows were
// then counted as independent samples, which inflated confidence by roughly the
// square root of the repeat count and let one position dominate every aggregate.
//
// An episode is a run of signals on the same recipe, coin and direction where
// each is within `gapMs` of the one before it. Only the first survives: it is
// the one that carries the entry price at the moment the idea appeared.

export interface EpisodeRow {
  id:         string;
  recipe_id:  string;
  coin:       string;
  direction:  string | null;
  created_at: string;
}

export interface EpisodeSplit {
  keep: string[];
  drop: string[];
}

/**
 * Split rows into the first signal of each episode and the repeats that follow.
 * The gap is measured from the previous signal rather than from the episode
 * start, so a continuous drip stays one episode however long it runs.
 */
export function collapseToEpisodes(
  rows: EpisodeRow[],
  opts: { gapMs: number },
): EpisodeSplit {
  const keep: string[] = [];
  const drop: string[] = [];

  const bySeries = new Map<string, EpisodeRow[]>();
  for (const row of rows) {
    const key = `${row.recipe_id}:${row.coin}:${row.direction ?? ""}`;
    const list = bySeries.get(key) ?? [];
    list.push(row);
    bySeries.set(key, list);
  }

  for (const series of bySeries.values()) {
    const ordered = [...series].sort(
      (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)
    );

    let prevMs: number | null = null;
    for (const row of ordered) {
      const ms = Date.parse(row.created_at);
      if (prevMs === null || ms - prevMs > opts.gapMs) keep.push(row.id);
      else drop.push(row.id);
      prevMs = ms;
    }
  }

  return { keep, drop };
}
