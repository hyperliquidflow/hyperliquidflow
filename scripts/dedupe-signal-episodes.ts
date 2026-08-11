// scripts/dedupe-signal-episodes.ts
//
// One-off cleanup for signals recorded before the 2026-08-11 emission fix.
//
// funding_divergence used to emit on the current state rather than on the change
// since the last snapshot, so a held position produced one row per poll. A single
// KAITO long became 83 rows in 13.5 hours, and those rows were then counted as
// independent samples.
//
// This collapses each run of repeats back to its first signal. Superseded rows
// are copied into signal_outcomes_superseded and signals_history_superseded
// before deletion, so the raw record survives and the collapse can be undone.
//
// Dry run by default. Pass --apply to write.
//
//   npx tsx scripts/dedupe-signal-episodes.ts            # report only
//   npx tsx scripts/dedupe-signal-episodes.ts --apply    # archive and delete

import { createClient } from "@supabase/supabase-js";
import { collapseToEpisodes, type EpisodeRow } from "../lib/episode-dedup";

const SUPABASE_URL              = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("FATAL: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const APPLY = process.argv.includes("--apply");

// Observed gaps are bimodal: 106 at 3 to 17 minutes (the poll cadence), then
// nothing at all between 132 and 355 minutes. Two hours sits inside that break
// and matches MAX_PAIR_WINDOW_MS in signal-lab.
const GAP_MS = 2 * 60 * 60 * 1000;

// Only funding_divergence ever emitted on state instead of on change, so only
// its rows are artifacts. The other five key off the delta between snapshots.
// momentum_stack repeats at 46, 56, 81 and 132 minute gaps are genuine
// re-accumulation events, and collapsing them would delete real observations
// from a recipe that has only ten of them.
const BUGGY_RECIPES = new Set(["funding_divergence"]);

// The emission fix landed 2026-08-11. Anything after it is already correct.
const FIX_TS = Date.parse("2026-08-11T00:00:00.000Z");

async function main(): Promise<void> {
  const { data, error } = await supabase
    .from("signal_outcomes")
    .select("id, signal_id, recipe_id, coin, direction, created_at")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[dedupe] fetch error:", error.message);
    process.exit(1);
  }

  const all = (data ?? []) as unknown as Array<EpisodeRow & { signal_id: string | null }>;
  const rows = all.filter(
    (r) => BUGGY_RECIPES.has(r.recipe_id) && Date.parse(r.created_at) < FIX_TS
  );
  console.log(
    `[dedupe] ${all.length} outcome rows, ${rows.length} in scope ` +
    `(${[...BUGGY_RECIPES].join(", ")} before the emission fix)`
  );

  const { keep, drop } = collapseToEpisodes(rows, { gapMs: GAP_MS });
  console.log(`[dedupe] ${keep.length} episode starts, ${drop.length} repeats to collapse`);

  if (drop.length === 0) {
    console.log("[dedupe] nothing to do");
    return;
  }

  // Report what goes, grouped, so the change is reviewable before it happens.
  const dropSet    = new Set(drop);
  const byGroup    = new Map<string, number>();
  const signalIds: string[] = [];
  for (const r of rows) {
    if (!dropSet.has(r.id)) continue;
    const key = `${r.recipe_id}/${r.coin}/${r.direction}`;
    byGroup.set(key, (byGroup.get(key) ?? 0) + 1);
    if (r.signal_id) signalIds.push(r.signal_id);
  }
  for (const [group, n] of [...byGroup.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`[dedupe]   ${group}: ${n} repeats`);
  }

  if (!APPLY) {
    console.log("\n[dedupe] DRY RUN. Re-run with --apply to archive and delete.");
    return;
  }

  // Archive first. Both tables are created by migration 024.
  const CHUNK = 200;
  for (let i = 0; i < drop.length; i += CHUNK) {
    const ids = drop.slice(i, i + CHUNK);
    const { error: archErr } = await supabase.rpc("archive_superseded_outcomes", { ids });
    if (archErr) {
      console.error("[dedupe] archive failed, stopping before any delete:", archErr.message);
      process.exit(1);
    }
  }
  console.log(`[dedupe] archived ${drop.length} outcome rows`);

  for (let i = 0; i < drop.length; i += CHUNK) {
    const ids = drop.slice(i, i + CHUNK);
    const { error: delErr } = await supabase.from("signal_outcomes").delete().in("id", ids);
    if (delErr) {
      console.error("[dedupe] outcome delete error:", delErr.message);
      process.exit(1);
    }
  }
  console.log(`[dedupe] deleted ${drop.length} outcome rows`);

  // The feed reads signals_history, so the duplicates have to leave there too.
  for (let i = 0; i < signalIds.length; i += CHUNK) {
    const ids = signalIds.slice(i, i + CHUNK);
    const { error: archErr } = await supabase.rpc("archive_superseded_signals", { ids });
    if (archErr) {
      console.error("[dedupe] signal archive failed:", archErr.message);
      process.exit(1);
    }
    const { error: delErr } = await supabase.from("signals_history").delete().in("id", ids);
    if (delErr) {
      console.error("[dedupe] signals_history delete error:", delErr.message);
      process.exit(1);
    }
  }
  console.log(`[dedupe] archived and deleted ${signalIds.length} signals_history rows`);
  console.log("[dedupe] done");
}

main().catch((err) => {
  console.error("[dedupe] fatal:", err);
  process.exit(1);
});
