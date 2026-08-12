// lib/discovery.ts
//
// When each wallet became knowable, and the filter that enforces it.
//
// Discovery reads the Hyperliquid leaderboard, which ranks by realised PnL, so
// a wallet enters this project's universe *because* it had already done well.
// Every entry it made before that date is therefore selected with knowledge of
// how the period turned out, and a real-time follower could not have copied a
// wallet it had never heard of. Entries after the discovery date carry no such
// knowledge: the selection used only information that predates them.
//
// This bounds every backtest the project can run. Discovery began 2026-04-11,
// so a window reaching further back cannot be frozen at all, and fetching more
// history buys regime coverage for the contaminated version of a study and
// nothing for the clean one.

export interface DiscoverableFill {
  /** wallet id */
  w: string;
  /** timestamp, ms */
  t: number;
}

export interface FreezeResult<T> {
  kept: T[];
  fillsBefore: number;
  fillsAfter: number;
  walletsBefore: number;
  walletsAfter: number;
  /** Earliest discovery date seen, ms. No clean claim can predate it. */
  earliestDiscovery: number | null;
}

/**
 * The slice of a Supabase client this needs. Structural rather than the real
 * type so a plain object can stand in under test. The result is PromiseLike,
 * not Promise, because the query builder is a thenable.
 */
export interface DiscoveryQuery {
  from(table: string): {
    select(cols: string): {
      in(col: string, values: string[]): PromiseLike<{
        data: Array<{ id: string; created_at: string }> | null;
        error: { message: string } | null;
      }>;
    };
  };
}

/**
 * Discovery timestamp per wallet id, in ms. Chunked because PostgREST sends
 * `in` filters in the URL and a few hundred UUIDs overflow it.
 */
export async function fetchDiscoveryDates(
  db: DiscoveryQuery,
  ids: readonly string[],
  chunkSize = 200,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0; i < ids.length; i += chunkSize) {
    const { data, error } = await db
      .from("wallets")
      .select("id, created_at")
      .in("id", ids.slice(i, i + chunkSize) as string[]);
    if (error) throw new Error(`discovery date lookup failed: ${error.message}`);
    for (const row of data ?? []) out.set(row.id, new Date(row.created_at).getTime());
  }
  return out;
}

/**
 * Keep only fills a real-time follower could have acted on: those made by a
 * wallet that had already been discovered. A wallet with no discovery record
 * cannot be shown to have been knowable, so its fills are dropped rather than
 * assumed available.
 */
export function freezeToDiscovery<T extends DiscoverableFill>(
  fills: readonly T[],
  discovered: ReadonlyMap<string, number>,
): FreezeResult<T> {
  const kept = fills.filter((f) => {
    const seen = discovered.get(f.w);
    return seen !== undefined && f.t >= seen;
  });
  const dates = [...discovered.values()].filter(Number.isFinite);
  return {
    kept,
    fillsBefore: fills.length,
    fillsAfter: kept.length,
    walletsBefore: new Set(fills.map((f) => f.w)).size,
    walletsAfter: new Set(kept.map((f) => f.w)).size,
    earliestDiscovery: dates.length ? Math.min(...dates) : null,
  };
}

/** The counts a freeze reports, independent of what the fills carry. */
export type FreezeSummary = Omit<FreezeResult<never>, "kept">;

/** One block of provenance, printed identically by every study that freezes. */
export function describeFreeze(r: FreezeSummary, tag: string): string[] {
  const pct = r.fillsBefore > 0 ? ((r.fillsAfter / r.fillsBefore) * 100).toFixed(0) : "0";
  const earliest = r.earliestDiscovery
    ? new Date(r.earliestDiscovery).toISOString().slice(0, 10)
    : "unknown";
  return [
    `${tag} --freeze-pool: entries restricted to each wallet's own post-discovery history`,
    `${tag}   fills   ${r.fillsBefore} to ${r.fillsAfter} (${pct}% kept)`,
    `${tag}   wallets ${r.walletsBefore} to ${r.walletsAfter}`,
    `${tag}   earliest discovery ${earliest}, so no clean claim predates it`,
  ];
}
