// scripts/recipe-dry-run.ts
//
// Do the recipes actually fire?
//
// Four of six were silent because their gating constants could never be reached
// on the conviction-gate universe, and those constants were recalibrated on
// 2026-08-11. That fix is an assertion until something proves it. Waiting for
// the nightly cron to answer costs a day of data collection per attempt, which
// is the exact pattern that let a broken window sit unnoticed for four months.
//
// This replays the two most recent stored snapshots per wallet through every
// recipe and reports what each would emit, before and after the conviction
// gate. It writes nothing.
//
// With --replay <hours> it walks every consecutive snapshot round in the window
// and reports an actual signals-per-day rate, which is the number that sets how
// long a prove-or-kill verdict takes.
//
//   npx tsx scripts/recipe-dry-run.ts
//   npx tsx scripts/recipe-dry-run.ts --replay 24

import { createClient } from "@supabase/supabase-js";
import {
  medianPairGap,
  momentumStackRecipe,
  divergenceSqueezeRecipe,
  accumulationReentryRecipe,
  rotationCarryRecipe,
  fundingDivergenceRecipe,
  whaleValidatedRecipe,
  type SnapshotPair,
  type SnapshotRow,
  type SignalEvent,
} from "../lib/signal-lab";
import { grossNotionalByCoin, eligibleCoins } from "../lib/coin-eligibility";
import {
  fetchMetaAndAssetCtxs,
  buildAssetCtxMap,
  fetchCandleSnapshot,
  type HlCandle,
  type HlAssetCtx,
} from "../lib/hyperliquid-api-client";

const SUPABASE_URL              = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("FATAL: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const REPLAY_IDX   = process.argv.indexOf("--replay");
const REPLAY_HOURS = REPLAY_IDX >= 0 ? Number(process.argv[REPLAY_IDX + 1] ?? 24) : 0;

/** Run all six recipes over one set of pairs. Returns events per recipe. */
async function runAll(
  pairs: SnapshotPair[],
  gapMs: number,
  assetCtxMap: Map<string, HlAssetCtx>,
  candles5m: Map<string, HlCandle[]>,
  candles4h: Map<string, HlCandle[]>,
): Promise<Array<[string, SignalEvent[]]>> {
  const [r1, r2, r3, r4, r7] = await Promise.all([
    momentumStackRecipe(pairs, gapMs),
    divergenceSqueezeRecipe(pairs, candles5m),
    accumulationReentryRecipe(pairs, candles4h),
    rotationCarryRecipe(pairs, assetCtxMap, new Map(), new Map()),
    fundingDivergenceRecipe(pairs, assetCtxMap),
  ]);
  const r8 = await whaleValidatedRecipe(pairs, [...r1, ...r2, ...r3, ...r4, ...r7]);
  return [
    ["momentum_stack", r1], ["divergence_squeeze", r2], ["accumulation_reentry", r3],
    ["rotation_carry", r4], ["funding_divergence", r7], ["whale_validated", r8],
  ];
}

async function main(): Promise<void> {
  const { data: wallets } = await supabase
    .from("wallets").select("id").eq("is_active", true);
  const walletIds = (wallets ?? []).map((w) => w.id as string);
  console.log(`[dry-run] ${walletIds.length} active wallets`);

  const { data: snaps } = await supabase
    .from("cohort_snapshots")
    .select("*")
    .in("wallet_id", walletIds)
    .order("snapshot_time", { ascending: false })
    .limit(walletIds.length * 4);

  // Newest two snapshots per wallet become curr and prev.
  const byWallet = new Map<string, SnapshotRow[]>();
  for (const s of (snaps ?? []) as unknown as SnapshotRow[]) {
    const list = byWallet.get(s.wallet_id) ?? [];
    if (list.length < 2) list.push(s);
    byWallet.set(s.wallet_id, list);
  }

  const pairs: SnapshotPair[] = [];
  for (const [walletId, list] of byWallet) {
    if (list.length === 0) continue;
    pairs.push({
      walletId,
      walletAddress: list[0].wallet_address,
      overallScore:  list[0].overall_score,
      curr:          list[0],
      prev:          list[1] ?? null,
    });
  }
  const withPrev = pairs.filter((p) => p.prev !== null).length;
  console.log(`[dry-run] ${pairs.length} pairs, ${withPrev} with a previous snapshot`);
  if (pairs.length === 0) { console.log("[dry-run] no snapshots to replay"); return; }

  const gapMs = medianPairGap(pairs);
  console.log(`[dry-run] median pair gap ${(gapMs / 60000).toFixed(1)} min`);

  const assetCtxMap = buildAssetCtxMap(await fetchMetaAndAssetCtxs());

  // Candles for every coin the cohort currently holds.
  const coins = [...new Set(pairs.flatMap((p) => p.curr.positions.map((ap) => ap.position.coin)))];
  const candles5m = new Map<string, HlCandle[]>();
  const candles4h = new Map<string, HlCandle[]>();
  const now = Date.now();
  for (const coin of coins) {
    try {
      const [c5, c4] = await Promise.all([
        fetchCandleSnapshot(coin, "5m", now - 6 * 3600_000, now),
        fetchCandleSnapshot(coin, "5m", now - 4 * 3600_000, now),
      ]);
      if (c5?.length) candles5m.set(coin, c5);
      if (c4?.length) candles4h.set(coin, c4);
    } catch { /* delisted or unavailable, recipe just skips it */ }
    await new Promise((r) => setTimeout(r, 120));
  }
  console.log(`[dry-run] candles for ${candles5m.size}/${coins.length} coins`);

  if (REPLAY_HOURS > 0) {
    await replay(walletIds, gapMs, assetCtxMap, candles5m, candles4h);
    return;
  }

  const named0 = await runAll(pairs, gapMs, assetCtxMap, candles5m, candles4h);
  const [r1, r2, r3, r4, r7, r8] = named0.map(([, e]) => e);

  const gross    = grossNotionalByCoin(pairs.flatMap((p) =>
    p.curr.positions.map((ap) => ({
      coin: ap.position.coin,
      szi: parseFloat(ap.position.szi),
      positionValue: parseFloat(ap.position.positionValue),
    }))));
  const eligible = eligibleCoins(gross);

  const named: Array<[string, SignalEvent[]]> = [
    ["momentum_stack",       r1], ["divergence_squeeze",   r2],
    ["accumulation_reentry", r3], ["rotation_carry",       r4],
    ["funding_divergence",   r7], ["whale_validated",      r8],
  ];

  console.log("");
  console.log(`Eligible coins (${eligible.size}): ${[...eligible].join(", ")}`);
  console.log("");
  console.log("recipe                | emitted | after conviction gate");
  console.log("----------------------+---------+----------------------");
  for (const [name, events] of named) {
    const kept = events.filter((e) => eligible.has(e.coin));
    const coinsHit = [...new Set(kept.map((e) => `${e.coin}/${e.direction}`))].slice(0, 4).join(" ");
    console.log(
      `${name.padEnd(21)} | ${String(events.length).padStart(7)} | ` +
      `${String(kept.length).padStart(5)}  ${coinsHit}`
    );
  }
  const totalKept = named.reduce((s, [, e]) => s + e.filter((x) => eligible.has(x.coin)).length, 0);
  console.log("");
  console.log(`Total after gate: ${totalKept} signals from this single snapshot pair.`);
  console.log("Nothing was written.");
}

/**
 * Walk every consecutive snapshot round in the window and count what the
 * recipes would have emitted, to get a real signals-per-day rate.
 */
async function replay(
  walletIds: string[],
  gapMs: number,
  assetCtxMap: Map<string, HlAssetCtx>,
  candles5m: Map<string, HlCandle[]>,
  candles4h: Map<string, HlCandle[]>,
): Promise<void> {
  const since = new Date(Date.now() - REPLAY_HOURS * 3600_000).toISOString();
  const all: SnapshotRow[] = [];
  const PAGE = 1000;
  for (let off = 0; ; off += PAGE) {
    const { data } = await supabase
      .from("cohort_snapshots").select("*")
      .in("wallet_id", walletIds).gte("snapshot_time", since)
      .order("snapshot_time", { ascending: true })
      .range(off, off + PAGE - 1);
    const page = (data ?? []) as unknown as SnapshotRow[];
    all.push(...page);
    if (page.length < PAGE) break;
  }
  console.log(`[dry-run] replaying ${all.length} snapshots over ${REPLAY_HOURS}h`);

  // Group into rounds by minute, then pair each round against the wallet's
  // previous snapshot, mirroring how the live path builds pairs.
  const rounds = new Map<string, SnapshotRow[]>();
  for (const s of all) {
    const key = s.snapshot_time.slice(0, 16);
    const list = rounds.get(key) ?? [];
    list.push(s);
    rounds.set(key, list);
  }
  const keys = [...rounds.keys()].sort();
  console.log(`[dry-run] ${keys.length} snapshot rounds`);

  const prevByWallet = new Map<string, SnapshotRow>();
  const totals = new Map<string, number>();
  let rounds_run = 0;

  for (const key of keys) {
    const curr = rounds.get(key)!;
    const pairs: SnapshotPair[] = [];
    for (const s of curr) {
      pairs.push({
        walletId: s.wallet_id, walletAddress: s.wallet_address,
        overallScore: s.overall_score, curr: s, prev: prevByWallet.get(s.wallet_id) ?? null,
      });
    }
    for (const s of curr) prevByWallet.set(s.wallet_id, s);
    if (pairs.every((p) => p.prev === null)) continue;

    const named = await runAll(pairs, gapMs, assetCtxMap, candles5m, candles4h);
    const gross = grossNotionalByCoin(pairs.flatMap((p) =>
      p.curr.positions.map((ap) => ({
        coin: ap.position.coin, szi: parseFloat(ap.position.szi),
        positionValue: parseFloat(ap.position.positionValue),
      }))));
    const eligible = eligibleCoins(gross);
    for (const [name, events] of named) {
      const kept = events.filter((e) => eligible.has(e.coin)).length;
      totals.set(name, (totals.get(name) ?? 0) + kept);
    }
    rounds_run++;
  }

  const spanDays = REPLAY_HOURS / 24;
  console.log("");
  console.log(`Replayed ${rounds_run} rounds. Signals after the conviction gate:`);
  console.log("recipe                | signals | per day");
  console.log("----------------------+---------+--------");
  let sum = 0;
  for (const [name, n] of totals) {
    sum += n;
    console.log(`${name.padEnd(21)} | ${String(n).padStart(7)} | ${(n / spanDays).toFixed(1).padStart(6)}`);
  }
  console.log(`${"TOTAL".padEnd(21)} | ${String(sum).padStart(7)} | ${(sum / spanDays).toFixed(1).padStart(6)}`);
  console.log("");
  console.log("Nothing was written.");
}

main().catch((err) => {
  console.error("[dry-run] fatal:", err);
  process.exit(1);
});
