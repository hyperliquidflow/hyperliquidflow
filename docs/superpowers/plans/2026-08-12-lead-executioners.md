# Lead Executioners Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the cheapest killers first against the two surviving leads: full verified costs (fees, slippage, path-wise funding), day-level clustering, trimmed means with bootstrap intervals, and a momentum baseline, per `docs/research/2026-08-12-preregistration-leads.md`.

**Architecture:** New tested primitives land in `lib/study-stats.ts` (the module that carries statistical validity). `scripts/fill-study.ts` gains one new pre-registered section for Lead 2 (long holds, full costs, non-overlapping, day-clustered, momentum-direction baseline). `scripts/positioning-factor.ts` is migrated onto study-stats (closing dossier finding R6) and gains the full cost model, funding on both legs, turnover-aware fees, robust statistics, and a momentum cross-section baseline. Both scripts stay read-only: they read the two caches and write nothing.

**Tech Stack:** TypeScript, tsx, vitest, simple-statistics (already a dependency). Caches: `fill-study-cache.json` (fills + close-only candles), `funding-cache.json` (per-coin arrays of `[ts_ms, hourly_rate]`).

## Global Constraints

- Verified fee: Hyperliquid base perp taker is 4.5 bps per side (checked 2026-08-12 against public fee documentation). Constant name `FEE_BPS_SIDE = 4.5`.
- Slippage haircut: 5 bps per side (`SLIP_BPS_SIDE = 5`) per the pre-registration, until a depth model exists.
- Funding sign convention: positive hourly rate means longs pay. A position with direction `d` is charged `d * sumOfHourlyRates` as a return deduction.
- Cluster standard errors BY DAY (UTC), not coin-day, for every new statistic.
- Bootstrap must be deterministic: seeded PRNG, never `Math.random()`.
- Do not change `ROUND_TRIP_BPS = 7` in existing sections; historical tables stay comparable. New sections use the new constants only.
- No em or en dashes in any output string or comment (PreToolUse hook blocks them).
- Results land in `docs/research/` (results register) after the run; pass/fail is read against the pre-registration bars verbatim.
- All scripts remain read-only research instruments (`Nothing was written.` stays true).

---

### Task 1: Statistics primitives in lib/study-stats.ts

**Files:**
- Modify: `lib/study-stats.ts` (append after `zscore`)
- Test: `lib/__tests__/study-stats.test.ts` (append new describe blocks)

**Interfaces:**
- Produces: `clusterByDay(rows: ReadonlyArray<{t: number; r: number}>, dayMs?: number): number[]`
- Produces: `trimmedMean(xs: readonly number[], frac?: number): number | null`
- Produces: `mulberry32(seed: number): () => number`
- Produces: `bootstrapMeanCI(xs: readonly number[], opts?: {iters?: number; alpha?: number; seed?: number}): {lo: number; hi: number} | null`
- Produces: `fundingOverHold(series: ReadonlyArray<readonly [number, number]>, t0: number, t1: number): {sum: number; points: number; expectedPoints: number}`

- [ ] **Step 1: Write the failing tests** (append to `lib/__tests__/study-stats.test.ts`)

```ts
import {
  clusterByDay, trimmedMean, mulberry32, bootstrapMeanCI, fundingOverHold,
} from "@/lib/study-stats";

describe("clusterByDay", () => {
  it("averages all observations on one UTC day into one value across coins", () => {
    const day = 86_400_000;
    const rows = [
      { t: day * 100 + 1, r: 0.01 },
      { t: day * 100 + 2, r: 0.03 },   // same day, different coin implied
      { t: day * 101 + 5, r: -0.02 },
    ];
    const out = clusterByDay(rows).sort((a, b) => a - b);
    expect(out).toHaveLength(2);
    expect(out[0]).toBeCloseTo(-0.02, 10);
    expect(out[1]).toBeCloseTo(0.02, 10);
  });
  it("thirty coins on one falling afternoon are one observation", () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ t: 86_400_000 * 7 + i, r: -0.05 }));
    expect(clusterByDay(rows)).toHaveLength(1);
  });
});

describe("trimmedMean", () => {
  it("is insensitive to a single extreme tail value at 10% trim", () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 1000];
    const tm = trimmedMean(xs, 0.1)!;
    expect(tm).toBeCloseTo((2 + 3 + 4 + 5 + 6 + 7 + 8 + 9) / 8, 10);
  });
  it("returns null when trimming would leave nothing", () => {
    expect(trimmedMean([1], 0.5)).toBeNull();
  });
});

describe("bootstrapMeanCI", () => {
  it("is deterministic for a fixed seed", () => {
    const xs = Array.from({ length: 50 }, (_, i) => (i % 2 === 0 ? 1 : -0.5));
    const a = bootstrapMeanCI(xs, { iters: 500, seed: 42 })!;
    const b = bootstrapMeanCI(xs, { iters: 500, seed: 42 })!;
    expect(a.lo).toBe(b.lo);
    expect(a.hi).toBe(b.hi);
  });
  it("brackets the sample mean of a well-behaved sample", () => {
    const xs = Array.from({ length: 200 }, (_, i) => 0.5 + Math.sin(i) * 0.1);
    const ci = bootstrapMeanCI(xs, { iters: 1000, seed: 7 })!;
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(ci.lo).toBeLessThan(mean);
    expect(ci.hi).toBeGreaterThan(mean);
  });
  it("returns null below two observations", () => {
    expect(bootstrapMeanCI([1])).toBeNull();
  });
});

describe("fundingOverHold", () => {
  const hour = 3_600_000;
  const series: [number, number][] = [
    [hour * 1, 0.0001], [hour * 2, 0.0002], [hour * 3, -0.0001], [hour * 4, 0.0003],
  ];
  it("sums rates settling inside (t0, t1]", () => {
    const { sum, points, expectedPoints } = fundingOverHold(series, hour * 1, hour * 3);
    expect(sum).toBeCloseTo(0.0001, 12);   // hours 2 and 3: 0.0002 - 0.0001
    expect(points).toBe(2);
    expect(expectedPoints).toBe(2);
  });
  it("reports missing settlements through expectedPoints", () => {
    const { points, expectedPoints } = fundingOverHold(series, 0, hour * 10);
    expect(points).toBe(4);
    expect(expectedPoints).toBe(10);
  });
  it("empty series contributes zero with full expected count", () => {
    const { sum, points, expectedPoints } = fundingOverHold([], 0, hour * 5);
    expect(sum).toBe(0);
    expect(points).toBe(0);
    expect(expectedPoints).toBe(5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/__tests__/study-stats.test.ts`
Expected: FAIL with missing exports.

- [ ] **Step 3: Implement** (append to `lib/study-stats.ts`)

```ts
/**
 * Average all observations on one UTC calendar day into one value, regardless
 * of coin. clusterByCoinDay absorbs many wallets on one coin; it does nothing
 * about many coins moving together on the same day, and alts are heavily
 * correlated cross-sectionally. Day-level clustering is the conservative unit
 * for any multi-coin table.
 */
export function clusterByDay(
  rows: ReadonlyArray<{ t: number; r: number }>,
  dayMs = 86_400_000,
): number[] {
  const groups = new Map<number, number[]>();
  for (const row of rows) {
    const k = Math.floor(row.t / dayMs);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(row.r);
  }
  return [...groups.values()].map((rs) => rs.reduce((a, b) => a + b, 0) / rs.length);
}

/**
 * Mean after dropping `frac` of the sample from each end. A mean that does not
 * survive trimming is carried by a handful of tail observations, which is a
 * lottery ticket rather than an edge. Null when trimming leaves nothing.
 */
export function trimmedMean(xs: readonly number[], frac = 0.1): number | null {
  const n = xs.length;
  const cut = Math.floor(n * frac);
  const kept = [...xs].sort((a, b) => a - b).slice(cut, n - cut);
  if (kept.length === 0) return null;
  return kept.reduce((a, b) => a + b, 0) / kept.length;
}

/** Deterministic PRNG so bootstrap results are reproducible run to run. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Percentile bootstrap CI for the mean. Feed it day-clustered values so the
 * resampling unit is the day, not the (correlated) observation.
 */
export function bootstrapMeanCI(
  xs: readonly number[],
  opts: { iters?: number; alpha?: number; seed?: number } = {},
): { lo: number; hi: number } | null {
  const { iters = 2000, alpha = 0.05, seed = 42 } = opts;
  const n = xs.length;
  if (n < 2) return null;
  const rng = mulberry32(seed);
  const means: number[] = new Array(iters);
  for (let i = 0; i < iters; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += xs[Math.floor(rng() * n)];
    means[i] = s / n;
  }
  means.sort((a, b) => a - b);
  const loIdx = Math.floor((alpha / 2) * iters);
  const hiIdx = Math.min(iters - 1, Math.ceil((1 - alpha / 2) * iters) - 1);
  return { lo: means[loIdx], hi: means[hiIdx] };
}

/**
 * Sum of hourly funding rates settling inside (t0, t1], plus coverage so a
 * sparse funding series cannot silently understate the charge. Convention:
 * positive rate means longs pay, so a position with direction d is charged
 * d * sum as a return deduction.
 */
export function fundingOverHold(
  series: ReadonlyArray<readonly [number, number]>,
  t0: number,
  t1: number,
): { sum: number; points: number; expectedPoints: number } {
  const expectedPoints = Math.max(0, Math.round((t1 - t0) / 3_600_000));
  let sum = 0, points = 0;
  for (const [ts, rate] of series) {
    if (ts > t0 && ts <= t1) { sum += rate; points++; }
    if (ts > t1) break;
  }
  return { sum, points, expectedPoints };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/__tests__/study-stats.test.ts`
Expected: PASS (29 existing + 10 new).

- [ ] **Step 5: Commit**

```bash
git add lib/study-stats.ts lib/__tests__/study-stats.test.ts
git commit -m "feat(study-stats): day clustering, trimmed mean, seeded bootstrap, funding charge"
```

---

### Task 2: Lead 2 executioner section in fill-study.ts

**Files:**
- Modify: `scripts/fill-study.ts` (new section after the existing non-overlapping block that ends at the `Coordination` header; new imports at top; funding cache loader near the cache loader)

**Interfaces:**
- Consumes: `clusterByDay`, `trimmedMean`, `bootstrapMeanCI`, `fundingOverHold` from `@/lib/study-stats` (Task 1 signatures), plus existing locals `fullyCovered`, `priceAt`, `betaBefore`, `stats`, `bps`, `HOLDS`, `MIN`, `btc`, `candles`, `onCoveredCoins`.
- Produces: console tables only; no exports.

- [ ] **Step 1: Add imports and constants**

Extend the existing study-stats import line with `clusterByDay, trimmedMean, bootstrapMeanCI, fundingOverHold`. Near `ROUND_TRIP_BPS` add:

```ts
// Pre-registered full cost model (docs/research/2026-08-12-preregistration-leads.md).
// Verified 2026-08-12: Hyperliquid base perp taker is 4.5 bps per side, so the
// legacy ROUND_TRIP_BPS = 7 above understates a base-tier account. Old sections
// keep 7 for comparability with the register history; the executioner section
// below charges the full model.
const FEE_BPS_SIDE = 4.5;
const SLIP_BPS_SIDE = 5;
const FULL_RT = (2 * (FEE_BPS_SIDE + SLIP_BPS_SIDE)) / 10_000; // 19 bps round trip
const FUNDING_CACHE_FILE = "funding-cache.json";
```

- [ ] **Step 2: Load the funding cache in main() setup**

After `onCoveredCoins` is computed, add:

```ts
  let funding: Record<string, [number, number][]> = {};
  try {
    funding = JSON.parse(require("fs").readFileSync(FUNDING_CACHE_FILE, "utf8"));
  } catch {
    console.log(`[fill-study] no ${FUNDING_CACHE_FILE}; executioner section will report 0% funding coverage`);
  }
```

(Use the file-level `fs` import style already present in the script rather than `require` if the script imports `fs/promises`; match the existing pattern.)

- [ ] **Step 3: Add the executioner section** (immediately after the existing `Non-overlapping windows` block)

```ts
  // ── Pre-registered executioner: full costs, day clustering, robust stats ──
  // docs/research/2026-08-12-preregistration-leads.md, Lead 2. Same
  // non-overlapping spacing as above, but charged the verified full cost model
  // (4.5 bps fee + 5 bps slippage per side, plus path-wise hourly funding
  // signed by direction), clustered BY DAY rather than coin-day, with a 10%
  // trimmed mean and a seeded day-bootstrap CI. The momentum row replaces the
  // wallet's direction with the sign of the coin's trailing 24h return at the
  // same entry times: if it matches or beats the wallet rows, the wallet layer
  // adds nothing at that hold.
  console.log(`\n=== EXECUTIONER (pre-registered): non-overlap, full costs, day-clustered ===`);
  console.log(`  costs: ${(FULL_RT * 10_000).toFixed(0)} bps round trip + path-wise funding`);
  console.log(`  hold | which    |    n | days | mean bps | trim10 |    t | boot95        | fund cov`);
  console.log(`  -----+----------+------+------+----------+--------+------+---------------+---------`);
  for (const H of HOLDS) {
    const pool = fullyCovered(onCoveredCoins, candles, 10 + H).slice().sort((a, b) => a.t - b.t);
    const lastByCoin = new Map<string, number>();
    const picked: Fill[] = [];
    for (const f of pool) {
      const last = lastByCoin.get(f.c) ?? -Infinity;
      if (f.t - last < H * MIN) continue;
      picked.push(f);
      lastByCoin.set(f.c, f.t);
    }
    for (const which of ["wallet", "momentum"] as const) {
      const rows: Array<{ t: number; r: number }> = [];
      let fundPoints = 0, fundExpected = 0;
      for (const f of picked) {
        const tIn = f.t + 10 * MIN, tOut = f.t + (10 + H) * MIN;
        const entry = priceAt(candles[f.c], tIn);
        const exit = priceAt(candles[f.c], tOut);
        const bEntry = priceAt(btc, tIn);
        const bExit = priceAt(btc, tOut);
        if (entry === null || exit === null || bEntry === null || bExit === null) continue;
        if (entry <= 0 || bEntry <= 0) continue;
        let d: 1 | -1 = f.d;
        if (which === "momentum") {
          const pPrev = priceAt(candles[f.c], f.t - 1440 * MIN);
          if (pPrev === null || pPrev <= 0) continue;
          d = entry >= pPrev ? 1 : -1;
        }
        const beta = betaBefore(candles[f.c], btc, f.t, `${f.c}|${f.t}`);
        const fund = fundingOverHold(funding[f.c] ?? [], tIn, tOut);
        fundPoints += fund.points; fundExpected += fund.expectedPoints;
        const r =
          ((exit - entry) / entry) * d -
          ((bExit - bEntry) / bEntry) * d * beta -
          d * fund.sum -
          FULL_RT;
        rows.push({ t: f.t, r });
      }
      const byDay = clusterByDay(rows);
      const st = stats(byDay);
      if (!st) { console.log(`  ${String(H).padStart(4)}m | ${which.padEnd(8)} | too few`); continue; }
      const tm = trimmedMean(byDay, 0.1);
      const ci = bootstrapMeanCI(byDay, { iters: 2000, seed: 42 });
      const cov = fundExpected > 0 ? ((fundPoints / fundExpected) * 100).toFixed(0) : "0";
      console.log(
        `  ${String(H).padStart(4)}m | ${which.padEnd(8)} | ${String(rows.length).padStart(4)} | ${String(st.n).padStart(4)} | ` +
        `${bps(st.mean).toFixed(1).padStart(8)} | ${tm === null ? "  n/a" : bps(tm).toFixed(1).padStart(6)} | ` +
        `${st.t.toFixed(1).padStart(4)} | [${ci ? `${bps(ci.lo).toFixed(0)},${bps(ci.hi).toFixed(0)}` : "n/a"}]`.padEnd(15) + ` | ${cov}%`
      );
    }
  }
```

- [ ] **Step 4: Typecheck and run**

Run: `npm run typecheck && npx tsx --env-file=.env.local scripts/fill-study.ts`
Expected: the new section prints twelve rows (six holds, wallet and momentum each), funding coverage above 90% for majors, and `Nothing was written.` still closes the run.

- [ ] **Step 5: Commit**

```bash
git add scripts/fill-study.ts
git commit -m "feat(fill-study): pre-registered executioner, full costs and day clustering"
```

---

### Task 3: Positioning factor on full costs (and R6 closed)

**Files:**
- Modify: `scripts/positioning-factor.ts`

**Interfaces:**
- Consumes: `priceAt`, `staleTolerance`, `describe`, `clusterByDay` (not needed: unit is already the day), `trimmedMean`, `bootstrapMeanCI`, `fundingOverHold` from `@/lib/study-stats`.
- Produces: console output; adds `=== FULL-COST book ===` and `=== Momentum baseline ===` sections; keeps the legacy 14 bps section for register comparability.

- [ ] **Step 1: Migrate to study-stats (R6)**

Delete the local `priceAt` and `stats` functions. Import from `@/lib/study-stats`:

```ts
import {
  priceAt, staleTolerance, describe, trimmedMean, bootstrapMeanCI, fundingOverHold,
} from "@/lib/study-stats";
```

Replace `stats(xs)` call sites with `describe(xs)` (same shape: n, mean, se, t, winRate). Replace `tolMs = 90 * 60_000` with `const tolMs = staleTolerance(90);` only if identical behavior is wanted; it is not (staleTolerance(90) is 135 minutes). Keep the exact prior behavior instead: `const tolMs = staleTolerance((cache.interval === "1h" ? 60 : 1)) ;` is also wrong. Use the bar-derived tolerance used by fill-study: `const barMin = cache.interval === "1h" ? 60 : cache.interval === "5m" ? 5 : cache.interval === "15m" ? 15 : 1; const tolMs = staleTolerance(barMin);` (90 minutes for 1h bars, which equals the old hardcoded value on the 1h cache, so recorded numbers do not shift).

- [ ] **Step 2: Add cost constants and funding loader**

```ts
const FEE_BPS_SIDE = 4.5;   // verified base-tier taker, 2026-08-12
const SLIP_BPS_SIDE = 5;    // pre-registration haircut
const RT = (2 * (FEE_BPS_SIDE + SLIP_BPS_SIDE)) / 10_000; // 19 bps per name replaced
let funding: Record<string, [number, number][]> = {};
try { funding = JSON.parse(await fs.readFile("funding-cache.json", "utf8")); }
catch { console.log("[factor] no funding cache; full-cost book will report 0% coverage"); }
```

- [ ] **Step 3: Extend the daily loop to build ranked rows once and reuse for three books**

Inside the existing day loop, after `rows` is built and demeaned, add momentum per coin and keep the rows array; then compute three spread series alongside the existing one:

```ts
    // trailing 1d return as the dumb baseline signal
    for (const r of rows) {
      const pPrev = priceAt(candles[r.coin] ?? [], entryT - DAY_MS, tolMs);
      (r as any).mom = pPrev && pPrev > 0 && pIn0.get(r.coin) ? (pIn0.get(r.coin)! - pPrev) / pPrev : null;
    }
```

(Where `pIn0` is a small `Map<string, number>` of the entry price already looked up per coin in the loop; store it when `pIn` is computed instead of re-fetching.)

Then, alongside the legacy spread computation, add a full-cost spread with turnover-aware fees and funding:

```ts
    // FULL-COST book: same legs, but each name replaced versus yesterday's leg
    // pays one full round trip, and each held name pays or receives funding.
    const longNames = byLean.slice(-k).map((r) => r.coin);
    const shortNames = byLean.slice(0, k).map((r) => r.coin);
    const fwdByCoin = new Map(rows.map((r) => [r.coin, r.fwd]));
    let fundLong = 0, fundShort = 0, fp = 0, fe = 0;
    for (const c of longNames) {
      const f = fundingOverHold(funding[c] ?? [], entryT, exitT);
      fundLong += f.sum / k; fp += f.points; fe += f.expectedPoints;
    }
    for (const c of shortNames) {
      const f = fundingOverHold(funding[c] ?? [], entryT, exitT);
      fundShort += f.sum / k; fp += f.points; fe += f.expectedPoints;
    }
    const replaced =
      longNames.filter((c) => !prevLong.has(c)).length +
      shortNames.filter((c) => !prevShort.has(c)).length;
    const turnoverCost = (replaced * RT) / k;
    const gross =
      longNames.reduce((s, c) => s + (fwdByCoin.get(c) ?? 0), 0) / k -
      shortNames.reduce((s, c) => s + (fwdByCoin.get(c) ?? 0), 0) / k;
    fullSpreads.push(gross - fundLong + fundShort - turnoverCost);
    fundCovPts += fp; fundCovExp += fe;
    prevLong = new Set(longNames); prevShort = new Set(shortNames);

    // Momentum baseline book: identical machinery, ranked by trailing return.
    const momRows = rows.filter((r) => (r as any).mom !== null);
    if (momRows.length >= 6) {
      const byMom = [...momRows].sort((a, b) => (a as any).mom - (b as any).mom);
      const km = Math.min(TOP_N, Math.floor(byMom.length / 2));
      if (km >= 1) {
        const ml = byMom.slice(-km).reduce((s, r) => s + r.fwd, 0) / km;
        const ms = byMom.slice(0, km).reduce((s, r) => s + r.fwd, 0) / km;
        momSpreads.push(ml - ms - 2 * RT); // full turnover assumed for the baseline
      }
      const rhoMom = sampleRankCorrelation(momRows.map((r) => (r as any).mom), momRows.map((r) => r.fwd));
      if (Number.isFinite(rhoMom)) momIcs.push(rhoMom);
      const rhoLeanMom = sampleRankCorrelation(momRows.map((r) => r.lean), momRows.map((r) => (r as any).mom));
      if (Number.isFinite(rhoLeanMom)) leanMomCorr.push(rhoLeanMom);
    }
```

Declare before the loop: `const fullSpreads: number[] = []; const momSpreads: number[] = []; const momIcs: number[] = []; const leanMomCorr: number[] = []; let prevLong = new Set<string>(); let prevShort = new Set<string>(); let fundCovPts = 0; let fundCovExp = 0;`

- [ ] **Step 4: Print the new sections after the legacy output**

```ts
  const fullStat = describe(fullSpreads);
  console.log(`\n=== FULL-COST book (pre-registered): funding + ${(RT * 10_000).toFixed(0)} bps per replaced name ===`);
  if (fullStat) {
    const tm = trimmedMean(fullSpreads, 0.1);
    const ci = bootstrapMeanCI(fullSpreads, { iters: 2000, seed: 42 });
    console.log(`  days ${fullStat.n}  mean ${(fullStat.mean * 10_000).toFixed(1)} bps/day  t ${fullStat.t.toFixed(2)}  win ${(fullStat.winRate * 100).toFixed(0)}%`);
    console.log(`  trimmed10 ${tm === null ? "n/a" : (tm * 10_000).toFixed(1)} bps  boot95 [${ci ? `${(ci.lo * 10_000).toFixed(1)}, ${(ci.hi * 10_000).toFixed(1)}` : "n/a"}] bps`);
    console.log(`  funding coverage ${fundCovExp > 0 ? ((fundCovPts / fundCovExp) * 100).toFixed(0) : 0}% of expected settlements`);
    const half = Math.floor(fullSpreads.length / 2);
    const e = describe(fullSpreads.slice(0, half)), l = describe(fullSpreads.slice(half));
    if (e && l) console.log(`  split-half early ${(e.mean * 10_000).toFixed(1)} bps (t ${e.t.toFixed(2)}) / late ${(l.mean * 10_000).toFixed(1)} bps (t ${l.t.toFixed(2)})`);
  } else console.log(`  not enough days`);

  const momIcStat = describe(momIcs);
  const momSpStat = describe(momSpreads);
  const lmStat = describe(leanMomCorr);
  console.log(`\n=== Momentum baseline (dumb alternative-explanation test) ===`);
  if (momIcStat) console.log(`  momentum IC ${momIcStat.mean.toFixed(4)} (t ${momIcStat.t.toFixed(2)})  vs lean IC above`);
  if (momSpStat) console.log(`  momentum book ${(momSpStat.mean * 10_000).toFixed(1)} bps/day (t ${momSpStat.t.toFixed(2)}) at full-turnover cost`);
  if (lmStat) console.log(`  daily rank corr(lean, momentum) ${lmStat.mean.toFixed(3)}: how much of lean is just chasing`);
```

- [ ] **Step 5: Typecheck, run, verify legacy sections unchanged**

Run: `npm run typecheck && npx tsx --env-file=.env.local scripts/positioning-factor.ts`
Expected: legacy IC and 14 bps book sections print the same numbers as the register history (IC 0.0640, t 3.12 family); new FULL-COST and Momentum sections print after them; `Nothing was written.` still closes.

- [ ] **Step 6: Commit**

```bash
git add scripts/positioning-factor.ts
git commit -m "feat(positioning-factor): full-cost book, funding, momentum baseline; use tested statistics (R6)"
```

---

### Task 4: Run the executioners, file the register entry, judge against the bars

**Files:**
- Create: `docs/research/2026-08-12-executioner-run.md`
- Modify: `docs/research/README.md` (index line)
- Modify: `docs/research/2026-08-12-preregistration-leads.md` (record the verified fee constant as a pre-run input note, dated; bars unchanged)

- [ ] **Step 1: Run both scripts, capture full output to files**

```bash
npx tsx --env-file=.env.local scripts/fill-study.ts > /tmp/exec-fill.txt 2>&1
npx tsx --env-file=.env.local scripts/positioning-factor.ts > /tmp/exec-factor.txt 2>&1
```

- [ ] **Step 2: Write the register entry** with: command, cache fingerprint (fetched_at, days, interval, rows, coins, wallets), git commit, verbatim executioner tables, funding coverage, and an explicit pass/fail line per pre-registration bar (day-clustered t at least 2.5 at the primary hold for Lead 2; baseline comparison; trimmed-mean positivity; Lead 1 full-cost book judged against its backtest gate with the note that the 200-day and forward gates remain).

- [ ] **Step 3: Commit**

```bash
git add docs/research/
git commit -m "docs(research): executioner run filed against pre-registered bars"
```
