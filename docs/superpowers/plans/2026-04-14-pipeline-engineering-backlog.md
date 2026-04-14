# Pipeline Engineering Backlog

**Created:** 2026-04-14  
**Scope:** Signal quality, data freshness, scoring model, discovery, and infrastructure improvements.  
**Separate from:** Product sprints 1-6 in `docs/superpowers/specs/2026-04-13-roadmap-master.md` (those cover UI features).

---

## Status

| Item | Status | Priority |
|---|---|---|
| R7: funding direction fix | DONE (2026-04-14) | P0 |
| R5: price confirmation | DONE (2026-04-14) | P0 |
| R8: freshness gate | DONE (2026-04-14) | P0 |
| 100-wallet window rotation | DONE (2026-04-14) | P0 |
| R4: cold-start gate | TODO | P1 |
| BTC regime hourly storage | TODO | P1 |
| R6: intraday streak refresh | TODO | P1 |
| KV secondary fallback (24h TTL) | TODO | P1 |
| Position aging signal (new recipe) | TODO | P2 |
| Cross-wallet concentration risk (new recipe) | TODO | P2 |
| Wallet churn signal (new recipe) | TODO | P2 |
| Funding rate trend signal (new recipe) | TODO | P2 |
| Intraday recipe_performance feedback | TODO | P2 |
| Scoring weight validation | TODO | P3 |
| pnl_consistency uses all 30 days | TODO | P3 |
| Supplementary discovery (fills-based) | TODO | P3 |
| WebSocket for Recipe 5 | TODO | Phase 3 |

---

## P1 — Do Next

### R4: Cold-start gate

**Problem:** With no prior `rotation_carry` entries in `recipe_performance`, the bootstrap default win rate of 0.65 exceeds the 0.60 gate. Recipe 4 fires freely for potentially weeks before real history accumulates.

**Fix:** In `lib/signal-lab.ts` `recipe4()`, require a minimum sample count before enabling the historical check:

```ts
// In recipe4, replace the win-rate gate with:
const histWinRate = recipeWinRates.get("rotation_carry");
const histCount   = recipeSignalCounts.get("rotation_carry") ?? 0;
// Disable during bootstrap (fewer than 10 historical signals)
if (histCount < 10) continue; // cold-start: don't fire until data accumulates
if ((histWinRate ?? 0) < MIN_HISTORICAL_WINRATE) continue;
```

**Requires:** Pass `recipeSignalCounts: Map<string, number>` to `runSignalLab` alongside `recipeWinRates`. Fetch `signal_count` from `recipe_performance` in `refresh-cohort` alongside the existing win_rate query.

**Files:** `lib/signal-lab.ts`, `app/api/refresh-cohort/route.ts`

---

### BTC regime hourly storage

**Problem:** `btc_mid_24h_ago` is updated at the first cron invocation after a 24h gap, causing the "24h window" to drift based on cron timing. The BTC return is approximate.

**Fix:** Store BTC mid keyed by hour: `btc_mid:{HH}` (0-padded, 00-23). Each cron cycle, write the current BTC mid under the current hour key. Compute `btc_return_24h` by reading `btc_mid:{24h_ago_hour}` instead of `btc_mid_24h_ago`.

```ts
// In refresh-cohort, replace btc mid rotation logic:
const nowHour = new Date().getUTCHours().toString().padStart(2, "0");
const agoHour = new Date(Date.now() - 24 * 3600 * 1000).getUTCHours().toString().padStart(2, "0");
const [_, priorBtcMid] = await Promise.all([
  kv.set(`btc_mid:${nowHour}`, currentBtcMid, { ex: 25 * 3600 }),
  kv.get<number>(`btc_mid:${agoHour}`),
]);
const prevBtcMid = priorBtcMid ?? currentBtcMid * 0.99;
```

**Files:** `app/api/refresh-cohort/route.ts`

---

### R6: Intraday streak refresh

**Problem:** Win streaks come from `user_pnl_backtest` written once per day. Between daily scans, a broken streak is not detected. A wallet mid-loss-run still shows the prior win streak.

**Fix:** In `refresh-cohort`, after fetching backtestRows, also query `signals_history` for any signals from today that indicate a loss (negative ev_score or direction flip). Use this to zero the win streak intraday if the wallet's most recent signal was a loss.

**Alternative (simpler):** Display streaks in the UI with a staleness indicator ("as of last scan") so users understand the limitation without requiring a code fix.

**Recommendation:** Ship the UI staleness label first (trivial), then implement the real fix in P2.

**Files:** `app/api/refresh-cohort/route.ts`, any UI component rendering streak

---

### KV secondary fallback

**Problem:** If the KV key `cohort:active` expires (TTL=120s) between a cron failure and the next successful run, the client falls back to a Supabase query that can return a much larger and slower response.

**Fix:** Write a secondary KV key `cohort:active:fallback` with a 24h TTL alongside every primary write. The `/api/cohort-state` fallback path reads this key before hitting Supabase.

```ts
// In refresh-cohort, alongside the primary KV write:
kv.set("cohort:active:fallback", JSON.stringify(payload), { ex: 24 * 3600 }).catch(() => {});

// In cohort-state fallback:
const fallback = await kv.get("cohort:active:fallback");
if (fallback) return NextResponse.json(parse(fallback));
// ... only then hit Supabase
```

**Files:** `app/api/refresh-cohort/route.ts`, `app/api/cohort-state/route.ts`

---

## P2 — New Signal Recipes

All four recipes go in `lib/signal-lab.ts` following the existing pattern. Each needs a label + description added to `lib/recipe-meta.ts`.

### Recipe 10: Position Aging (Patience / Trap Signal)

**Trigger:** A high-score wallet (score >= 0.65) has been holding a position that is down (unrealized PnL < -5% of position value) for more than 2 cron cycles without reducing size.

**Detection:** Compare `unrealizedPnl / positionValue` across consecutive snapshots for the same wallet+coin. If the ratio has been <= -0.05 for 2+ consecutive pairs, emit.

**Signal type:** `ALERT`, direction matches position direction (long trap or short trap).

**Requires:** Track "consecutive underwater cycles" per wallet+coin. Simplest implementation: store this count in the snapshot `metadata` or as a separate KV map `cohort:underwater_counts`.

---

### Recipe 11: Cross-wallet Concentration Risk

**Trigger:** More than 60% of the cohort's total notional is concentrated in a single coin.

**Detection:** Sum `|positionValue|` per coin across all pairs. If any coin's share of total cohort notional exceeds 0.60, emit a cohort-level ALERT.

**Signal type:** `ALERT`, no direction (concentration is a risk signal regardless of side).

**Metadata:** Include coin, concentration %, total cohort notional, top 3 wallets by exposure.

---

### Recipe 12: Wallet Churn (Coordinated Exit)

**Trigger:** Inverse of Recipe 1. 3+ wallets simultaneously reducing or closing positions on the same coin, with combined notional reduction >= $500K, within the snapshot window.

**Detection:** Reuse the delta logic from Recipe 1 but filter for `delta < 0` (reduction) instead of increases.

**Signal type:** `EXIT`, direction is the position being exited.

---

### Recipe 13: Funding Rate Trend

**Trigger:** Funding rate for a coin has been rising for 3+ consecutive cron cycles and crossed 0.03%/hr (longs increasingly paying shorts, crowd getting more crowded long).

**Detection:** Store the last 3 funding rate readings per coin in KV (`market:funding_history:{coin}`). On each cycle, append current funding and check trend.

**Signal type:** `ALERT`, direction SHORT (rising funding = overextended longs = fade opportunity).

**Requires:** Per-coin funding history in KV.

---

### Intraday recipe_performance feedback

**Problem:** `recipe_performance` is computed once daily. Recipe 4's win-rate gate only sees yesterday's data.

**Fix:** At the end of each `runSignalLab` call, compute a lightweight intraday aggregate: for the last 6 hours of `signals_history`, group by recipe_id and compute avg ev_score. Cache as `recipe:intraday_perf` in KV. Use this to supplement (not replace) the daily `recipe_performance` in the win-rate gate.

**Files:** `lib/signal-lab.ts`, `app/api/refresh-cohort/route.ts`

---

## P3 — Scoring Model

### Scoring weight validation

**Problem:** Weights (35/25/25/15) are assumed. No evidence they outperform equal weights.

**Approach:** 
1. Pull 30 days of `signals_history` + `cohort_snapshots`.
2. For each signal, look up the wallet's overall_score at signal time and the signal's ev_score.
3. Compute correlation between overall_score and ev_score for current weights vs. equal weights (25/25/25/25) vs. Sharpe-heavy (50/20/20/10).
4. The weight set with highest correlation between score and ev_score outcome is the better model.

**Files:** New script `scripts/validate-scoring-weights.ts`

---

### pnl_consistency covers all 30 days

**Problem:** 4 × 7-day windows cover days 0-27. Days 28-29 (the most recent 2 days) are never evaluated.

**Fix:** In `computePnlConsistency`, change the window count from 4 fixed windows to `Math.ceil(TOTAL / WINDOW)` windows, handling a partial final window. The partial window counts as positive if its sum is positive, regardless of length.

**Files:** `lib/cohort-engine.ts`

---

### Supplementary wallet discovery

**Problem:** Leaderboard ranks by all-time ROI. New fast-rising wallets don't appear until they accumulate history.

**Approach:** After the leaderboard scan in `daily-wallet-scan.ts`, run a secondary discovery pass: fetch fills for the top-10 most-traded coins in the last 7 days (from `metaAndAssetCtxs` volume data). Extract unique addresses from those fills. Pre-filter by the same ROI/PnL gate. Upsert new addresses.

**Estimated new addresses:** 100-500 per run. API cost: 10 additional `userFills` calls.

**Files:** `scripts/daily-wallet-scan.ts`

---

## Phase 3 — Infrastructure

### WebSocket for Recipe 5

**What it unlocks:** True liquidation event detection via the Hyperliquid WebSocket liquidation stream. Recipe 5 currently approximates cascade from cohort position shrinkage. The WS exposes actual liquidation transactions in real-time.

**Architecture change required:**
- A persistent WebSocket process (not a serverless function) listening to `l2Book` and `trades` channels.
- Liquidation events written to a Supabase table or KV queue.
- Recipe 5 reads from that queue instead of computing from position deltas.

**Blocker:** Vercel serverless functions cannot hold persistent WS connections. Requires a separate always-on process (Fly.io, Railway, or a Vercel Edge stream that reconnects).

**Estimated effort:** 2-3 days. Not worth building until the rest of the pipeline is proven.
