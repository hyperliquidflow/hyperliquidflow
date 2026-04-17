# Stream A — Cohort Quality Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. Each task is a self-contained, verifiable change.

---

## MANDATORY PRE-READ

Read these before touching any code:

```
Read: docs/superpowers/specs/2026-04-17-stream-a-cohort-quality.md
Read: scripts/daily-wallet-scan.ts                 (full file)
Read: lib/cohort-engine.ts                         (getEquityTier + tier thresholds only)
Read: supabase/migrations/001_initial_schema.sql   (user_pnl_backtest columns)
```

---

**Goal:** Replace the loose activation gate with quality-graded filters driven by leaderboard metadata + fee-adjusted fills, with per-reason rejection reporting.

**Architecture:** One file — `scripts/daily-wallet-scan.ts`. Leaderboard API response is parsed into a `Map<address, LeaderboardEntry>` populated at discovery time. The map is passed into `scoreWallet` alongside the address so equity/history/alltime data are available at the activation gate without extra API calls. Hypurrscan aliases fetched upfront to pre-filter non-trader entities before scoring. Fee-adjusted 30d PnL computed from the existing fills fetch. Every rejection is counted and written to `scan-summary.json`.

**Tech Stack:** TypeScript, Node.js, Supabase client (writes only).

---

## File Map

| Action | File | What changes |
|---|---|---|
| MODIFY | `scripts/daily-wallet-scan.ts` | All logic changes (tasks 1-9) |
| MODIFY | `docs/sprints/status.md` | Add Stream A row, mark complete when done (task 10) |

---

## Task 1: Add new quality threshold constants

**File:** `scripts/daily-wallet-scan.ts`

The constants already exist (added in a prior commit). Verify they match the spec exactly:

- [ ] **Step 1: Confirm constants are present and have the spec values**

Search for `MIN_EQUITY_FOR_ACTIVATION` in the file. Expect:

```ts
const MIN_EQUITY_FOR_ACTIVATION    = 10_000;
const MIN_PROFIT_FACTOR            = 1.3;
const MAX_DRAWDOWN_FOR_ACTIVATION  = 0.40;
const MAX_TRADES_30D               = 500;
```

If missing or different, add/update. No downstream wiring yet — that happens in later tasks.

- [ ] **Step 2: Confirm `PRE_QUALIFY_MIN_ALLTIME_PNL = 0` exists**

It was added in the same prior commit. `leaderboardPreQualifies` should already reference it.

- [ ] **Step 3: Add `MIN_HISTORY_VOLUME_RATIO = 0.95` constant**

Place near the other thresholds:

```ts
const MIN_HISTORY_VOLUME_RATIO = 0.95; // month_vlm/allTime_vlm <= this means >=5% pre-month volume (proxy for >30d history)
```

**Verify:** `npx tsc --noEmit` passes (warnings from pre-existing iteration flag errors are OK — they predate this work).

---

## Task 2: Extend `FillRecord` with fee field

**File:** `scripts/daily-wallet-scan.ts`

- [ ] **Step 1: Add `fee` field to the `FillRecord` interface**

Current (~line 396):
```ts
interface FillRecord {
  closedPnl: string;
  time: number;
}
```

New:
```ts
interface FillRecord {
  closedPnl: string;
  time:      number;
  fee:       string;
}
```

Hyperliquid's `userFillsByTime` always returns `fee` on every fill; no optional marker needed.

**Verify:** no compile errors.

---

## Task 3: Define `LeaderboardEntry` type + thread metadata out of discovery

**File:** `scripts/daily-wallet-scan.ts`

- [ ] **Step 1: Add type definition above `fetchLeaderboardAddresses`**

```ts
interface LeaderboardEntry {
  address:      string;
  accountValue: number;
  monthPnl:     number;
  allTimePnl:   number;
  monthVlm:     number;
  allTimeVlm:   number;
}
```

- [ ] **Step 2: Change `fetchLeaderboardAddresses` signature to return a Map**

New return type: `Promise<Map<string, LeaderboardEntry>>`.

The function still applies `leaderboardPreQualifies` — only change is the return shape. Build the map from pre-qualified rows using the detected `addressField`:

```ts
const map = new Map<string, LeaderboardEntry>();
for (const row of preQualified) {
  const address = row[addressField] as string;
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) continue;
  const perfs   = row.windowPerformances as Array<[string, Record<string, string>]>;
  const month   = perfs.find(([w]) => w === "month")?.[1] ?? {};
  const allTime = perfs.find(([w]) => w === "allTime")?.[1] ?? {};
  map.set(address.toLowerCase(), {
    address:      address.toLowerCase(),
    accountValue: parseFloat((row.accountValue as string) ?? "0"),
    monthPnl:     parseFloat(month.pnl ?? "0"),
    allTimePnl:   parseFloat(allTime.pnl ?? "0"),
    monthVlm:     parseFloat(month.vlm ?? "0"),
    allTimeVlm:   parseFloat(allTime.vlm ?? "0"),
  });
}
return map;
```

- [ ] **Step 3: Update the single call site in `main()` to handle the new type**

Preserve the existing try/catch — a leaderboard outage must still warn-and-continue, not crash the scan.

Current:
```ts
let addresses: string[] = [];
let source: "leaderboard_api" | "leaderboard_scrape" = "leaderboard_api";
try {
  addresses = await fetchLeaderboardAddresses();
  ...
} catch (err) {
  ...
}
```

New:
```ts
let leaderboardMap: Map<string, LeaderboardEntry> = new Map();
let addresses: string[] = [];
let source: "leaderboard_api" | "leaderboard_scrape" = "leaderboard_api";
try {
  leaderboardMap = await fetchLeaderboardAddresses();
  addresses      = Array.from(leaderboardMap.keys());
  source         = "leaderboard_api";
  console.log(`[discovery] primary path: ${addresses.length} addresses`);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  summary.errors.push(`primary_path: ${msg}`);
  console.warn("[discovery] primary path failed:", msg);
}
```

`leaderboardMap` stays in scope for the scoring loop; if the fetch failed it's just an empty Map and all equity/authenticity gates fall through to the `leaderboardEntry == null` branch.

**Verify:** `npx tsc --noEmit` passes. The script can still run (scoring behavior unchanged at this point).

---

## Task 3.5: Initialise `rejection_breakdown` on the summary object

**File:** `scripts/daily-wallet-scan.ts`

Done first so later tasks can safely write to it without a guard.

- [ ] **Step 1: Extend the `summary` object in `main()`**

Add the breakdown object to the existing summary init (~line 703):

```ts
const summary = {
  discovered:   0,
  new_wallets:  0,
  activated:    0,
  deactivated:  0,
  top_win_rate: 0,
  scan_errors:  0,
  duration_ms:  0,
  discovery_source: "" as string,
  errors:       [] as string[],
  rejection_breakdown: {
    low_win_rate:        0,
    low_trade_count:     0,
    too_many_trades:     0,
    low_net_pnl:         0,
    low_profit_factor:   0,
    high_drawdown:       0,
    low_equity:          0,
    negative_alltime:    0,
    suspiciously_fresh:  0,
    entity_excluded:     0,
  } as Record<string, number>,
};
```

**Verify:** `npx tsc --noEmit` passes.

---

## Task 4: Fetch Hypurrscan aliases early, pre-filter candidate list

**File:** `scripts/daily-wallet-scan.ts`

- [ ] **Step 1: Move `fetchHypurrscanAliases()` call to the top of `main()`**

Insert immediately after the summary init, before discovery:

```ts
console.log("[Phase 0] Pre-fetching Hypurrscan aliases...");
const aliases = await fetchHypurrscanAliases();
console.log(`[identity] loaded ${Object.keys(aliases).length} aliases`);
```

- [ ] **Step 2: Add a helper that returns true when an address is a non-trader entity**

Place near `resolveEntityType`:

```ts
const EXCLUDED_ENTITY_TYPES: readonly EntityType[] = ["cex", "deployer", "protocol", "gambling"];

function isExcludedEntity(address: string, aliasMap: Record<string, string>): boolean {
  const { entity_type } = resolveEntityType(address, aliasMap);
  return (EXCLUDED_ENTITY_TYPES as readonly string[]).includes(entity_type);
}
```

- [ ] **Step 3: Filter the `scoreAddresses` list before the scoring loop**

Current (~line 770):
```ts
const scoreAddresses = [
  ...Array.from(activeAddresses),
  ...(candidateRows ?? []).map((w) => w.address),
];
```

New:
```ts
const rawScoreAddresses = [
  ...Array.from(activeAddresses),
  ...(candidateRows ?? []).map((w) => w.address),
];
const excludedByEntity = rawScoreAddresses.filter((a) => isExcludedEntity(a, aliases));
const scoreAddresses   = rawScoreAddresses.filter((a) => !isExcludedEntity(a, aliases));
console.log(
  `[scan] entity pre-filter: excluded ${excludedByEntity.length} non-trader addresses ` +
  `(cex/deployer/protocol/gambling)`
);
```

Track the count in `rejection_breakdown` (added in Task 7).

- [ ] **Step 4: Remove the now-redundant Phase 6 re-fetch of aliases**

The identity enrichment block at the end of `main()` currently calls `fetchHypurrscanAliases()` again. Replace with a reference to the `aliases` already in scope. The enrichment block stays — it still labels and deactivates stale CEX/deployer entries that snuck in.

Find `const aliases = await fetchHypurrscanAliases();` near line 825 and remove that line only. The remaining `aliasCount` + enrichment code works with the outer `aliases` variable.

**Verify:** scan still compiles and `main()` still runs to completion in dry-mode testing.

---

## Task 5: Thread `leaderboardMap` into `scoreWallet`, compute fee-adjusted PnL

**File:** `scripts/daily-wallet-scan.ts`

- [ ] **Step 1: Change `scoreWallet` signature**

Current:
```ts
async function scoreWallet(address: string): Promise<ScoringResult> {
```

New:
```ts
async function scoreWallet(
  address:         string,
  leaderboardEntry: LeaderboardEntry | null
): Promise<ScoringResult> {
```

- [ ] **Step 2: Sum fees from fills and compute net PnL**

After the `closingFills` filter:

```ts
const total_fees_30d = fills.reduce((s, f) => s + parseFloat(f.fee ?? "0"), 0);
// Fee sign convention: Hyperliquid returns fees as positive USD amounts paid by trader.
// Subtract from gross PnL to get net-of-fees. First-scan verification log below.
if (fills.length > 0 && fills[0].fee !== undefined) {
  console.log(`[fee-check] first fill sample: closedPnl=${fills[0].closedPnl} fee=${fills[0].fee}`);
}
const realized_pnl_30d_gross = closingFills.reduce((s, f) => s + parseFloat(f.closedPnl), 0);
const realized_pnl_30d       = realized_pnl_30d_gross - total_fees_30d;
```

The verification log is a one-shot per wallet; after the first successful scan, confirm fee is positive numeric string and drop this log in a follow-up commit.

Replace the existing `realized_pnl_30d` computation. `avg_win_usd` / `avg_loss_usd` stay computed from raw `closedPnl` (they are per-trade, not aggregate).

- [ ] **Step 3: Update `ScoringResult` to include fee data for reporting**

Add:
```ts
total_fees_30d:         number;
realized_pnl_30d_gross: number;
rejection_reason:       string | null;
```

- [ ] **Step 4: Update the call site in `main()`'s scoring loop**

Current:
```ts
scoreAddresses.map(async (address) => {
  // ...
  const result = await scoreWallet(address);
```

New:
```ts
scoreAddresses.map(async (address) => {
  // ...
  const leaderboardEntry = leaderboardMap.get(address.toLowerCase()) ?? null;
  const result           = await scoreWallet(address, leaderboardEntry);
```

Use `leaderboardEntry` at the call site to match the `scoreWallet` parameter name — keeps grep consistent across the file.

**Verify:** script runs end-to-end without crash.

---

## Task 6: Apply the full quality gate in `scoreWallet`

**File:** `scripts/daily-wallet-scan.ts`

- [ ] **Step 1: Replace the `qualifies` computation with an explicit reason tracker**

Current:
```ts
const qualifies = win_rate >= WIN_RATE_THRESHOLD && trade_count_30d >= MIN_TRADES_30D && realized_pnl_30d >= MIN_CANDIDATE_PNL_30D;
```

New:
```ts
let rejection_reason: string | null = null;

if (win_rate < WIN_RATE_THRESHOLD)                                    rejection_reason = "low_win_rate";
else if (trade_count_30d < MIN_TRADES_30D)                            rejection_reason = "low_trade_count";
else if (trade_count_30d > MAX_TRADES_30D)                            rejection_reason = "too_many_trades";
else if (realized_pnl_30d < MIN_CANDIDATE_PNL_30D)                    rejection_reason = "low_net_pnl";
else if (profit_factor < MIN_PROFIT_FACTOR)                           rejection_reason = "low_profit_factor";
else if (max_drawdown_pct > MAX_DRAWDOWN_FOR_ACTIVATION)              rejection_reason = "high_drawdown";
else if (leaderboardEntry && leaderboardEntry.accountValue < MIN_EQUITY_FOR_ACTIVATION)
                                                                      rejection_reason = "low_equity";
else if (leaderboardEntry && leaderboardEntry.allTimePnl < PRE_QUALIFY_MIN_ALLTIME_PNL)
                                                                      rejection_reason = "negative_alltime";
else if (leaderboardEntry && leaderboardEntry.allTimeVlm > 0 &&
         (leaderboardEntry.monthVlm / leaderboardEntry.allTimeVlm) > MIN_HISTORY_VOLUME_RATIO)
                                                                      rejection_reason = "suspiciously_fresh";

const qualifies = rejection_reason === null;
```

**Note the ordering** — cheapest checks first, expensive/most-discriminating last. Checks depending on `leaderboardEntry` are skipped (undefined) when the wallet is a DB re-score with no leaderboard metadata; their equity gate is deferred to the cron dust-check.

- [ ] **Step 2: Include `rejection_reason`, `total_fees_30d`, `realized_pnl_30d_gross` in the `ScoringResult` return object**

**Verify:** `npx tsc --noEmit` clean for this file's new code paths. Script runs.

---

## Task 7: Aggregate and persist rejection breakdown

**File:** `scripts/daily-wallet-scan.ts`

Note: the `rejection_breakdown` object itself was added in Task 3.5. This task only writes to it.

- [ ] **Step 1: Increment `entity_excluded` where the entity pre-filter fires**

In Task 4, Step 3, after computing `excludedByEntity`:

```ts
summary.rejection_breakdown.entity_excluded = excludedByEntity.length;
```

(The field is safe to write because Task 3.5 initialized it to 0.)

- [ ] **Step 2: Tally per-reason counts from scoring results**

After the `Promise.allSettled` scoring loop:

```ts
for (const r of results) {
  if (r.status === "fulfilled" && r.value.rejection_reason) {
    const reason = r.value.rejection_reason;
    if (summary.rejection_breakdown[reason] !== undefined) {
      summary.rejection_breakdown[reason]++;
    }
  }
}
```

**Verify:** `scan-summary.json` written at end of run contains the breakdown object with at least three non-zero counts.

---

## Task 8: Log a cohort quality summary at end of scan

**File:** `scripts/daily-wallet-scan.ts`

- [ ] **Step 1: Add a cohort quality log block before writing `scan-summary.json`**

```ts
const total_rejected = Object.values(summary.rejection_breakdown).reduce((a, b) => a + b, 0);
console.log("\n[cohort-quality] Activation results:");
console.log(`  activated:   ${summary.activated}`);
console.log(`  rejected:    ${total_rejected}`);
console.log(`  scan errors: ${summary.scan_errors}`);
console.log("[cohort-quality] Rejection breakdown:");
for (const [reason, count] of Object.entries(summary.rejection_breakdown)) {
  if (count > 0) console.log(`    ${reason.padEnd(22)} ${count}`);
}
```

**Verify:** Log output shows a clean breakdown, no undefined/NaN values.

---

## Task 9: Full-file review pass

- [ ] **Step 1: Run `npx tsc --noEmit`**

No new errors introduced (pre-existing iteration flag warnings are unrelated).

- [ ] **Step 2: Run `npm run lint`**

Fix any new warnings in touched lines.

- [ ] **Step 3: Run `npm run test`**

Ensure no test regressions. If any scan-related tests fail because of signature changes (e.g. `scoreWallet`), update them to pass the new `LeaderboardEntry | null` argument.

- [ ] **Step 4: Manual dry-run check**

Read through the full flow in `main()` from top to bottom and confirm:
- `aliases` fetched early (Phase 0)
- `leaderboardMap` built during discovery
- Entity filter applied before scoring
- `scoreWallet` called with `entry`
- `rejection_reason` wired into summary
- Phase 6 alias enrichment no longer re-fetches aliases

---

## Task 10: Commit, push, manual verify, mark Stream A complete

- [ ] **Step 1: Commit**

Single commit touching only the files in the File Map. Message format:

```
feat(scan): gate activation on smart-money quality signals (Stream A)

- Thread leaderboard metadata (equity, PnL, volume) into scoreWallet
- Apply quality gates: profit_factor >= 1.3, max_drawdown <= 40%,
  trade_count <= 500, equity >= $10K, allTime_pnl >= 0, history proxy
- Pre-filter non-trader entities (cex/deployer/protocol/gambling)
  before spending API calls on scoring
- Fee-adjusted realized_pnl_30d (subtract sum of fee field)
- Per-reason rejection breakdown in scan-summary.json

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

- [ ] **Step 2: Push to origin/main**

- [ ] **Step 3: User runs manual scan via GitHub Actions**

Wait for completion. Open the `scan-summary.json` artifact.

- [ ] **Step 4: Verify acceptance criteria**

Against the spec:
1. Scan completes within 65 min
2. `rejection_breakdown` populated, at least 3 reasons non-zero
3. Activated count materially lower than 1285 (expect 400-900)
4. Zero CEX/deployer/protocol/gambling in active set — SQL check:

```sql
SELECT entity_type, COUNT(*) FROM wallets
WHERE is_active = true
GROUP BY entity_type;
```

Should show 0 for cex/deployer/protocol/gambling.

- [ ] **Step 5: Update `docs/sprints/status.md`**

Add row under "All Sprints":

```
| A | Cohort Quality (activation gate) | COMPLETE | spec | plan |
```

Link the spec/plan paths. Commit + push.

---

## Rollback

Single-commit revert restores prior behavior. All new constants can be individually loosened via a follow-up edit without schema touches. No DB changes to undo.

---

## Dependencies unlocked

- **Stream B** can now assume the active cohort is clean enough to reason about realtime deactivation without fighting pre-existing pollution
- **Stream C** can analyze activation survivors as its working set (smaller, cleaner)
- **Stream D** can profile wallets we're confident are real traders
