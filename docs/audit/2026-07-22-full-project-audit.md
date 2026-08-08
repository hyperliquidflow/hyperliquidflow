# HyperliquidFLOW, Full Project Audit

**Date:** 2026-07-22
**Audit head commit:** `81bd56c`
**Method:** 5 parallel domain audits (data pipeline + scoring, signals + learning, UI + product, backlog + drift, schema + tests + infra) with MCP-verified prod state on Supabase project `qcedbargzizmayvimstg`.
**Purpose:** Give the maintainer a full picture of what has been built, what has silently broken during 3 months of dormancy, and where the trading edge actually is (or is not). Written to be cross-auditable by other LLMs without reading the codebase.

---

## 0. TL;DR

**Product goal.** Track ~500 activated Hyperliquid perps wallets (curated from ~40k discovered), score them, extract signals from their behavior, surface actionable divergences and copy-trade positions. Every subsystem exists to generate one thing: a measurable trading edge from smart-money behavior.

**Current health: DEGRADED.**

- Prod schema is intact (all 19 migrations recorded, 20 tables live, ~39k wallets, ~11k snapshots).
- **P0 blackout:** `signals_history.last_signal = 2026-07-16`. Six days since the last signal fired. `signal_outcomes` has only 3 rows. The freshness watchdog checks `cohort-state.updated_at`, not signal cadence, so it did not catch this.
- **No measured per-recipe edge exists today.** The `learning-summary.json` artifact in the repo root is dated 2026-04-22 with `cold_start: true, simulated: 0`. Between April 22 and May 25 the pipeline generated ~248 outcomes and the cold-start guard lifted (per session memory), but retention (30d on signals_history, 30d on signal_outcomes) has since aged out the accumulated data, and Phase 3 Claude-agent learning was never built.
- **The learning loop is telemetry-only.** `agent_findings.recommendation` is written `null` in every insert. No auto-tuning of thresholds. The single live self-tuner (recipe 4 `rotation_carry`) reads the wrong win-rate metric (intraday `ev_score>0` proxy instead of `win_rate_net`).
- **The scoring V2 canary has never resolved.** `computeCohortScoresV2` writes `overall_score_shadow`, but the 30-day comparison against `rank_ic_shadow` was scheduled to mature around 2026-05-21 and was never revisited. Cutover decision is stuck.
- **Copy-trade closure is client-side only.** LocalStorage-based; if the tab is closed there are no alerts. `AlertBell` component is orphaned in the codebase, mounted nowhere. No push, email, or webhook.
- 3 commits in ~91 days. `learning-summary.json` and 8 plan files remain uncommitted. `CLAUDE.md` has an uncommitted diff.

**What still works.** Cohort discovery + scoring runs nightly (GHA). Cron ping keeps `cohort-state` fresh (freshness-check passes). Follow/leaderboard/inposition/discovery/radar UI renders. Wallet-detail rebuild has HTML mockups only.

**Where the edge should come from (structurally defensible).** `momentum_stack`, `divergence_squeeze`, `funding_divergence`, `accumulation_reentry`. All four fire but none have measured edge.

**Top three next actions.**
1. Diagnose the 6-day signal firing outage (see §11.1).
2. Wire the R13 canary cutover decision or kill V2 (see §5.4, §14.4).
3. Ship the Sprint 8 Claude agent so the learning loop actually closes (see §14.5).

---

## 1. Ground state (MCP-verified against prod on 2026-07-22)

### 1.1 Schema

All 19 migrations are recorded in `supabase_migrations.schema_migrations`. Prod has 20 application tables plus housekeeping. The 2026-04-22 schema drift crisis was resolved between April 22 and May 25 (drift-fix commits are absent from git, so it was applied via Supabase dashboard or MCP directly). Migration files 001-019 match prod.

### 1.2 Row counts (live prod)

| Table | Rows | Notes |
|-------|-----:|-------|
| `wallets` | 38,947 | Grows monotonically. 6,036 dead rows (~15%). |
| `cohort_snapshots` | 10,774 | pg_cron retains last 2 per wallet. |
| `user_pnl_backtest` | 18,112 | 1,965 dead rows. |
| `wallet_profiles` | ~2,000 | Stream D outputs. |
| `signals_history` | **3** | Last emit 2026-07-16. **6 days stale.** |
| `signal_events` | 20 | Legacy migration-006 table, no retention. All stale. |
| `signal_outcomes` | **3** | Only rows matching the 3 signals still within the 30-day window. |
| `agent_log` | 62 | All `OBSERVATION` cold-start entries. |
| `agent_findings` | 35 | Populated during May window, then flat. |
| `wallet_score_history` | populated | 90d retention active. |
| `rank_ic_history` | populated | Rank IC job runs. |
| `cohort_attrition` | 2,111 | Grows once per unique wallet. |
| `recipe_calibration`, `wallet_signal_stats` | present | R12 tables. |

DB size 83 MB.

### 1.3 Cron jobs (pg_cron)

Five retention jobs active (jobids 1, 2, 3, 7, 8) running 03:00-03:15 UTC daily. Verified via `SELECT * FROM cron.job`.

### 1.4 Freshness signal

`freshness-check.yml` polls `/api/cohort-state` every 15 min and fails if `updated_at` > 1200s stale. **It does not check signal firing cadence.** The 6-day signal blackout is invisible to it.

### 1.5 Auth surface

- No user auth (Sprint 6 not started).
- No middleware.
- 14 API routes are open GETs. Two (`refresh-cohort`, `measure-outcomes`) require `CRON_SECRET` via `Bearer` header with timing-safe compare (`lib/auth/cron.ts:11`).
- `verifyCronAuth` skips checks in `NODE_ENV !== "production"`.
- Anon key is exported from `lib/env.ts:36` but unused by any server code (dead import path).
- `rate_limit_tokens` table exists and is seeded with 8 categories at 10 tokens each; **zero code reads or writes it.** The table is dormant.

### 1.6 RLS

Migration 019 enabled RLS on all 20 tables. **Zero policies exist.** Advisor returns 20 `rls_enabled_no_policy` INFO findings plus 2 `function_search_path_mutable` WARN findings. Because service role bypasses RLS, server code is unaffected. If a browser ever queried Supabase directly with the anon key, it would see zero rows (default-deny).

### 1.7 npm audit

8 vulnerabilities (1 low, 1 moderate, 6 high), all transitive (esbuild, vite, ws, brace-expansion, js-yaml, launch-editor). None runtime-exposed on Vercel, dev/CI chains only. All fixable via `npm audit fix`.

---

## 2. Timeline reconstruction

- **2026-04-11 to 04-12:** Bootstrap (~40 commits in 2 days). Dashboard, design tokens, initial nav.
- **2026-04-13 to 04-14:** Recipes 10-13 added, Sprints 1 (Wallet Tiers) and 2 (Bias Trend) shipped.
- **2026-04-15:** Signal Intelligence Phase 1 spec + plan, Hypurrscan integration.
- **2026-04-16 to 04-18:** Streams A-F specs; Stream A (activation), B (hygiene), C (wash/sybil), D (behavior), E (validation), F (dashboard truth) all landed. Sprint 4 (Market Radar) shipped.
- **2026-04-19 to 04-21:** R7-R13 remediation blitz (7 remediations in 3 days). Migrations 012-018. Sprint 5 (Wallet Alerts + Paper) shipped.
- **2026-04-21 to 04-22 morning:** R25 audit remediation (`d232655` merge). Migration 019 RLS.
- **2026-04-22 afternoon:** Cohort hygiene idle-gate landed. Schema-drift crisis discovered. Postmortem plus R26 sync plan plus wallet-detail rebuild plan drafted (all left uncommitted).
- **2026-04-22 17:31:** Last commit `81bd56c`.
- **~2026-04-23 to ~2026-05-25:** No commits. Someone applied migrations 011-019 to prod (drift resolved). Pipeline ran, accumulating ~248 signal outcomes by 2026-05-25.
- **2026-05-18:** Phase 3 Claude agent plan drafted (`docs/superpowers/plans/2026-05-18-phase3-claude-agent-and-output-layer.md`, uncommitted).
- **~2026-05-19 to 2026-07-16:** Pipeline kept running. Signals fired periodically. Retention aged out old data. Cold-start guard lifted for at least one window.
- **2026-07-16:** Last signal fired. Signal firing has been silent since.
- **2026-07-22 (today):** Session resumed.

Total 2026 commits: **328**, all inside 11 calendar days (04-11 to 04-22).

---

## 3. Sprint status (verified against code)

| Sprint | Claim | Verified |
|-------|-------|----------|
| 1 Wallet Tiers | COMPLETE | Yes |
| 2 Bias Trend Chart | COMPLETE | Yes |
| 3 Global Position Heatmap | COMPLETE (plan missing) | Partial. Radar exists; no dedicated `/signals/heatmap` route. Sprint appears folded into Sprint 4. Clarify. |
| 4 Market Radar | COMPLETE | Yes |
| 5 Wallet Alerts + Paper | COMPLETE (2026-04-19) | Yes, all 12 files landed. Plan file uncommitted. |
| 6 Auth | PLANNED | Not started. |
| 7 UI Design Revision | PLANNED (after 4/5/6) | Not started. Blocked on Sprint 6. |
| 8 Signal Intelligence Agent | data gate met 2026-05-17 | **Phase 1+2 shipped. Phase 3 (Claude) not built.** No `@anthropic-ai/sdk` in package.json, no `app/agent/`, no Claude call layer in `signal-learning.ts`. |
| Streams A/B/C/D/E | COMPLETE (2026-04-18) | Yes |
| Stream F Dashboard Truth | COMPLETE | Partial, no dedicated module; only spec-side claim. |

Remediation R-series:

| ID | Claim | Verified |
|----|-------|----------|
| R7 latency | COMPLETE | Yes, migration 012, `signal_timing` table, `/api/signal-freshness` |
| R8 leverage + attrition | COMPLETE | Yes, migration 013 |
| R9 rank IC | COMPLETE | Yes, migration 014, `scripts/rank-ic.ts`, `rank-ic.yml` |
| R10 outcome overhaul | COMPLETE | Yes, migration 015, `lib/atr.ts`, `simulateAtrExit` |
| R11 multi-window + OOCV | COMPLETE | Yes, migration 016 |
| R12 EV decouple | COMPLETE | Yes, migration 017, `wallet-signal-stats.ts` |
| R13 leverage-adj scoring | COMPLETE (canary open) | Yes. Shadow scoring writes to `overall_score_shadow`. **Cutover decision never made.** 30-day gate matured ~2026-05-21 and was never revisited. |
| R14-R24 | PLANNED (Phases 2-4 remainder) | Not started. No specs, no plans, no code. |
| R25 audit remediation | COMPLETE (2026-04-21) | Yes, migration 019, `lib/auth/cron.ts` timing-safe compare, query caps, token migration, eslint CLI. |
| R26 schema sync + prevention | drafted 2026-04-22 | **Phase A (apply migrations to prod) executed manually.** **Phase B (CI/runtime prevention) unshipped.** No `.github/workflows/db-migrate.yml`, no `schema-health.yml`, no `lib/supabase-errors.ts`, no `assertNonFatal` in the scan. |

---

## 4. Data pipeline

### 4.1 Two-orchestrator architecture

**GitHub Actions daily scan (00:00 UTC).** `scripts/daily-wallet-scan.ts` runs for up to 50 min. Writes directly to Supabase, bypasses Vercel and KV. Phases:

- Phase 0: Pre-fetch Hypurrscan alias map.
- Discovery: GET Hyperliquid leaderboard, sort by 30-day ROI, pre-filter `monthPnl ≥ $10k && allTimePnl ≥ $0`, cap tier1 at `MAX_TIER1_LEADERBOARD = 2000`.
- Entity pre-filter excludes `cex/deployer/protocol/gambling` labels.
- Scoring loop: concurrency 2, 1s inter-slot delay, one 429 retry with 5s backoff. Per wallet: 60d fills, 60-slot `daily_pnls`, 9 activation gates.
- Phase 6: identity enrichment.
- Phase 7: sybil detection (Pearson r > 0.95 clusters).
- Phase 8: wallet profiles.
- Phase 9: leverage plus G10 gate.
- Phase 10: attrition upsert.
- Phase 10b: shadow scoring V2.
- Phase 11: score-history write.
- Phase 12: multi-window scores plus G11/G12 gates.
- Phase 13: OOCV sample.
- Writes `scan-summary.json` artifact.

**Vercel cron ping (00:00 UTC, 30s timeout).** `app/api/refresh-cohort/route.ts` verifies `CRON_SECRET`, rotates a 100-wallet slice via `cohort:cycle_offset`, batch-fetches `clearinghouseState` at concurrency 10, classifies regime, computes V1 scores, runs 13-recipe signal lab, writes `cohort:active` KV plus fallback. Fire-and-forget hygiene, TWAP, intraday recipe perf, signal-timing insert via `after()`.

### 4.2 Cron overlap issue

Both jobs fire at 00:00 UTC. Both write to `wallets`, `cohort_snapshots`, `user_pnl_backtest`. The GHA scan lasts 40-50 min; the cron finishes in <30s. Upserts prevent corruption but the Vercel cron can score stale wallet snapshots while GHA is still updating `is_active`. Shift Vercel cron to `0 1 * * *` or gate its wallet writes behind an "is-scan-running" KV flag.

Similarly, `signal-learning` (01:00 UTC GHA) can bleed into the daily-scan tail window.

---

## 5. Cohort scoring engine

### 5.1 V1 scoring (production, what users see)

```
overall_score = clamp(
  0.35 * sharpe_proxy      // clamp(mean/stddev / 3.0, 0, 1)
  + 0.25 * pnl_consistency // fraction of 7-day windows with sum>0
  + 0.25 * drawdown_score  // clamp(1 - max_dd_fraction, 0, 1)
  + 0.15 * regime_fit,     // long/short bias vs BTC 24h regime; 0.5 for flat
  0, 1)
```

`lib/cohort-engine.ts:239-259`. Flat wallets get a free 0.075 baseline from `regime_fit=0.5`. Sharpe of 1.0 only produces 0.33 (scaled at 3.0); ceiling compresses genuine 3+ Sharpe traders.

### 5.2 V2 shadow scoring (R13, `lib/cohort-engine.ts:285-317`, `lib/leverage-risk.ts`)

```
overall_score_v2 = clamp(
  0.30 * lev_adj_sharpe      // Sharpe on pnl/(1+lev), scaled at 2 not 3
  + 0.20 * pnl_consistency
  + 0.20 * drawdown_score
  + 0.15 * regime_fit
  + 0.15 * blow_up_distance, // convex (t^1.5) between safe_lev=3 and max_lev=15
  0, 1)
```

Formula version pinned to `"v2_r13"`. Params in `DEFAULT_PENALTY_PARAMS` are labeled a "conservative prior" pending 90+ blow-up events from `cohort_attrition`. `scripts/fit-leverage-penalty.ts` exists but has never produced a refit.

### 5.3 Activation gates (9 in-scan plus G10-G13 post-scan)

| # | Gate | Threshold |
|---|------|-----------|
| G1 | `low_win_rate` | < 0.50 |
| G2 | `low_trade_count` | < 60 |
| G3 | `too_many_trades` | > 1000 (scalp/wash ceiling) |
| G4 | `low_net_pnl` | < $1,000 net |
| G5 | `low_profit_factor` | < 1.3 |
| G6 | `high_drawdown` | > 0.40 |
| G7 | `low_equity` | < $10,000 (bypassed for tier2 non-leaderboard wallets, see §11.4) |
| G8 | `negative_alltime` | allTimePnl < 0 |
| G9 | `suspiciously_fresh` | monthVlm/allTimeVlm > 0.95 |
| G-wash | `wash_detected` | fee_ratio > 0.60 |
| G10 | `high_leverage` | max_leverage_60d > 15 (hardcoded prior; no refit) |
| G11 | `score_unstable` | max-min across 30/90/180d > 0.25 |
| G12 | `low_regime_coverage` | any regime with < 10 days in 180d |

### 5.4 R13 canary: STUCK

`overall_score_shadow` is written every night, but the cutover gate `median(rank_ic_shadow) >= median(rank_ic) - 0.02` over 30 measurements has never been evaluated by code. `scripts/rank-ic.ts` writes the shadow IC column, no code compares medians or fires a cutover recommendation. Decision has been open for ~62 days. Either wire the gate or kill V2.

---

## 6. Signal recipes (the actual product)

15 recipes surface via `RECIPE_META` (`lib/recipe-meta.ts:7-68`). 13 fire from the core snapshot pipeline (`lib/signal-lab.ts`); 2 fire from Hypurrscan enrichment (`lib/hypurrscan-enrichment.ts`).

### 6.1 Full inventory

| # | ID | Label | Pattern | Directional | Configurable |
|---|-----|-------|---------|-------------|--------------|
| 1 | momentum_stack | Whale Convergence | ≥3 wallets add same direction, combined notional ≥ $500K (tiered), 300s window | LONG/SHORT | Yes |
| 2 | divergence_squeeze | Silent Loading | ≥3 high-score wallets load same coin, price flat < 0.5%, thin margin | LONG/SHORT | Yes |
| 3 | accumulation_reentry | Dip Conviction | Score ≥0.65 wallet grows position ≥5% during 4h drawdown ≥ 2× coin vol | LONG/SHORT | Yes |
| 4 | rotation_carry | Funded Edge | New position plus funding ≥ 0.03%/hr, gated on ≥60% historical winrate after 10-signal bootstrap | LONG/SHORT | Yes |
| 5 | liq_rebound | Liquidation Flush | Cohort notional shrinks ≥5% while price moves ≥1.5%/3.5%. Tagged APPROXIMATION, needs WebSocket. | LONG/SHORT | Yes |
| 6 | streak_continuation | Hot Streak | win_streak ≥ 5, Sharpe ≥ 0.60 | Sign of largest position | Yes |
| 7 | funding_divergence | Smart Money vs Retail | Cohort net sign opposite funding sign, \|funding\| ≥ 0.05%/hr | LONG/SHORT | Yes |
| 8 | whale_validated | Alpha Confirmation | Meta-signal, ≥3 whales (score ≥0.75) fresh activity same direction | Inherits | Yes |
| 9 | anti_whale_trap | Smart Exit Signal | Score ≥0.70 wallet cuts notional ≥30%, `regime_fit < 0.35` | SHORT if bear else FLAT | Yes |
| 10 | position_aging | Patience Trap | Score ≥0.65 wallet holding losing coin (uPnL ≤ -5%), not reducing ≥2 cycles, 4h cooldown | LONG/SHORT | **No (hardcoded)** |
| 11 | concentration_risk | Crowded Coin | > 60% (or 70% ETH) of cohort net notional in one coin, excludes BTC | **null (no direction)** | **No (hardcoded)** |
| 12 | wallet_churn | Coordinated Exit | ≥3 wallets reducing same coin, combined reduction ≥ $500K, 300s window | Sign of previous position | Yes |
| 13 | funding_trend | Funding Surge | Funding rising ≥ 3 cycles, > 0.03%/hr | Always SHORT | **No (hardcoded)** |
| 14 | bridge_inflow | Capital Inflow | Bridge deposit ≥ $100K USD (Hypurrscan) | **null** | **No (hardcoded)** |
| 15 | twap_accumulation | Whale TWAP Active | Active TWAP on top-20 wallet by AUM (Hypurrscan) | **null** | **No (hardcoded)** |

### 6.2 Structural edge ranking (defensibility given the smart-money-following premise)

**Structurally defensible (edge should exist if cohort selection is sound):**
- `momentum_stack`, archetypal follow-the-smart-money. Latency-sensitive.
- `divergence_squeeze`, coordinated conviction plus skin in the game (thin margin).
- `accumulation_reentry`, specific "smart money buys the dip" pattern.
- `funding_divergence`, cohort-vs-crowd, known crypto edge pattern.
- `whale_validated`, meta-signal, only useful if base signals have edge.

**Weak / generic (no cohort structural advantage):**
- `streak_continuation`, outcome-chasing, reflexive.
- `funding_trend`, pure funding history, no cohort input. Available to anyone.
- `rotation_carry`, follower-side carry with self-referential winrate gate.
- `liq_rebound`, flagged in-code as APPROXIMATION.

**Descriptive alerts (not directional trades):**
- `anti_whale_trap`, `position_aging`, `concentration_risk`, `wallet_churn`.

**Off-cohort:**
- `bridge_inflow`, `twap_accumulation`, non-directional intent signals.

### 6.3 Non-directional recipes never get graded

`concentration_risk`, `bridge_inflow`, `twap_accumulation` have `direction=null`. `simulateAtrExit` skips them (`scripts/signal-learning.ts:131`). Their `is_win` stays null forever. Their edge is undefined by construction.

---

## 7. Learning loop (the critical hole)

### 7.1 Flow

1. `refresh-cohort` fires signals -> `signals_history` insert -> `signal_outcomes` seed row with `price_at_signal`.
2. `/api/measure-outcomes` (Vercel cron): reads pending rows within 72h horizon, hits Hyperliquid `allMids`, fills `price_1h/4h/24h`. `resolved_at` set only when `price_24h` lands.
3. `scripts/signal-learning.ts` (01:00 UTC GHA): cold-start gate (< 100 outcomes OR < 30 days -> abort). ATR backfill (14-period 4h). `simulateAtrExit`: 2×ATR stop, 3×ATR target, first-hit over 1h -> 4h -> 24h snapshots. Constant 10 bps round-trip fee. Fills `is_win`, `net_pnl_bps`, `realized_r_multiple`.
4. Stats engine: groups by recipe over 90d; computes `win_rate_7d/30d/90d`, `avg_win_pct`, `avg_loss_pct`, Wilson CI, `measuredEV`.
5. `scripts/wallet-signal-stats.ts`: upserts `recipe_calibration` (win rate per recipe, ≥30 samples) and `wallet_signal_stats` (per wallet/recipe, ≥5 samples).
6. `enrichWithEv` (`signal-lab.ts:1020-1054`) on next cycle blends 70% recipe calibration plus 30% wallet stats -> new `ev_score`.

### 7.2 Loop does not close on wallet weights

`overall_score` is computed from backtest daily_pnls, not from measured signal outcomes. There is no path from `is_win` back to wallet scoring. Learning and scoring are two separate feedback systems that don't cross-inform.

### 7.3 Loop weakly closes on recipe behavior, with a bug

Recipe 4 `rotation_carry` is the only recipe with a live self-gate. It reads `recipeWinRates` from `recipe_performance.win_rate` (an intraday `ev_score > 0` proxy, NOT the truthful `win_rate_net`). So its self-gate measures upstream EV assignment, not actual outcomes.

`agent_findings.recommendation` is written `null` on every insert (`scripts/signal-learning.ts:323-326`). Nothing reads `agent_findings` to auto-tune `agent_config`. **The Claude agent (Phase 3) was designed to close this loop and was never built.**

### 7.4 EV decouple (R12) has a circular fallback

When `wallet_signal_stats` lacks data (default while cold-start), `enrichWithEv` falls back to `bt.win_rate` (`signal-lab.ts:1050`), reintroducing the exact backtest circularity R12 was meant to remove. The 70/30 blend also uses `bt.avg_win_usd`/`bt.avg_loss_usd` for magnitudes. Even after R12, win/loss magnitude is still wallet backtest. `recipe_calibration.avg_win_bps` is populated but never consumed.

### 7.5 Rank IC

- Method: Spearman ρ between wallet `overall_score` on day D and wallet PnL sum on D+1 to D+30.
- Effective sample: n × 0.5 (correlation adjustment).
- MDIC threshold: 0.08.
- Phase 1 kill criterion: median IC over last 30 measurements must exceed MDIC with p<0.05 in ≥15/30 measurements.
- **The kill criterion is logged only, not enforced.**
- V2 shadow IC column exists in `rank_ic_history` but no code compares medians for cutover.

### 7.6 Current measured edge

**Zero.** `learning-summary.json` in repo root (2026-04-22): `cold_start: true, simulated: 0, duration_ms: 596`. The prod pipeline generated ~248 outcomes by 2026-05-25 (per session memory) so the cold-start guard did lift, but with `signal_outcomes` now down to 3 rows and signals not firing for 6 days, the guard is likely re-triggered.

---

## 8. Hygiene, Wash, Behavior profiles

### 8.1 Stream B hygiene (`lib/cohort-hygiene.ts`)

Runs via `after()` per cron cycle. Gates:

- **Idle** (added 2026-04-22): snapshot missing OR older than 3 days -> immediate deact.
- **7-day drawdown**: peak-to-current > 50% over ≥3 snapshots -> immediate deact.
- **Low equity**: < $10k for 3 consecutive fresh cycles -> deact.
- **Liq-imminent**: liq_buffer_pct < 5% for 2 consecutive fresh cycles -> deact.

Sanity guard: throws (not warns) if > 25% of cohort would deactivate in a single cycle.

**Gaps:**
- G10 leverage lives in daily scan, not cron. Mid-day ramp to 25× goes uncaught until next night.
- No per-position liq distance check (only cross-margin proxy).
- Idle gate is address-level, not position-level. Large-position idle wallets get deactivated despite material exposure.

### 8.2 Stream C wash plus sybil (`lib/wash-sybil.ts`)

- **Wash**: `fee_ratio = totalFees / max(|grossPnl|, 1) > 0.60`. Threshold is arbitrary, uncalibrated.
- **Sybil**: pairwise Pearson r > 0.95 on 60d daily_pnls, union-find into clusters. Wallet with highest profit_factor kept as primary, others deactivated as `sybil_duplicate`. Skip pairs with < 30 nonzero days.

False positive risk: two independent wallets running the same public strategy during a homogeneous regime can co-move at r > 0.95. No whitelist/override, no measured FPR.

### 8.3 Stream D behavior profiles (`lib/wallet-profile.ts`)

Per-active-wallet: `trading_style` (SCALPER/SWING/TREND by 60d trade count), `pnl_consistency`, `bull_daily_pnl`/`bear_daily_pnl`/`ranging_daily_pnl`, `regime_edge`, `current_coins`.

**Feeds V1 scoring?** No. `regime_fit` in V1 uses live position bias vs current regime, not historical regime edge.

**Feeds signals?** Yes. `walletProfileMap` is threaded into `runSignalLab`. Recipes can use `trading_style` and regime edges.

**Gap:** the primary customer-facing `overall_score` never sees historical regime edge, a fitted trader-skill signal is unused by the score users see.

---

## 9. UI plus product surface

### 9.1 Page inventory (all live unless noted)

| Route | Purpose |
|-------|---------|
| `/` | Overview: 6 KPI cards, 24h signal heatmap, recent signals, top movers, top wallets, market vibes 7-day regime, exposure by notional |
| `/wallets` | Redirect to `/wallets/discovery` |
| `/wallets/discovery` | Scanner stats plus address lookup plus inline wallet-detail card (double duty; wallet-detail rebuild queued but never shipped) |
| `/wallets/leaderboard` | Sortable ranked leaderboard, tier filter, follow button |
| `/wallets/inposition` | Top 3 profit / top 3 loss spotlight, cohort tilt bar, sortable table |
| `/wallets/following` | localStorage-followed wallets with alert badges |
| `/wallets/paper` | localStorage paper positions, live uPnL, trade size selector |
| `/signals` | Redirect to `/signals/feed` |
| `/signals/feed` | Sidebar recipe filter, coin chips, direction segment, infinite scroll |
| `/signals/divergence` | Contrarian signals plus rule-based trade plan (Entry/SL/TP/R:R/Kelly/funding) |
| `/signals/radar` | Cohort long/short density along price axis plus liq zones |
| `/signals/performance` | Signal recipe accuracy grid, 7d/30d toggle |
| `/performance` | **Duplicate of `/signals/performance`, older UX.** |
| `/performance/ranking` | Rank IC vs 30d forward returns, decile hit rates. Empty-state gated until 30 measurements. |
| `/edge` | **Redirect stub to `/signals/performance`. No real edge landing page.** |
| `/signals/radar/designs` | 830-line dev scratch, 5 alt radar designs. Should be gated. |
| `/design-system` | Token viewer, hidden from nav |
| `/scanner`, `/stalker`, `/contrarian`, `/imbalance`, `/recipes` | Legacy redirect stubs |

### 9.2 Overview page fake-data check

No faked numbers. Only cosmetic filler: `DirectionSparkline` (a hardcoded fake curve) used as fallback when live sparkline data is absent. First-time reviewers may read it as fake data.

### 9.3 Copy-trade closure

Follow-wallet flow: user clicks Follow on Leaderboard/InPosition/Discovery -> toggles `paper_copy` -> `useAlertDetection` polls `/api/wallet-positions` every 60s per followed wallet -> `diffPositions` emits `POSITION_OPENED`/`CLOSED`/`RESIZED` -> paper opens/closes via `handlePaperTrade` writes to `localStorage.hl_paper_positions`.

**Failures:**
- Loop is entirely client-side. Tab closed = no alerts, no paper writes.
- Two tabs open = duplicate polls, duplicate paper writes.
- `POSITION_RESIZED` is **ignored** for paper copy. Pyramid-up followed wallets -> divergent paper sizes.
- No stop-loss, no exposure cap, no per-wallet cap, no funding cost, no slippage/fees.
- No cumulative equity curve on `/wallets/paper`. Over time the page becomes useless for judging whether copying is worth it.

### 9.4 Alerts

`AlertBell` component exists at `components/alert-bell.tsx` (194 lines, full drawer UI). **Grep across `app/` finds no import.** It is orphaned dead code. Users only see the unseen count badge on the "Following" nav sublink. No push, email, webhook, or sound.

### 9.5 Wallet-detail rebuild (queued 2026-04-22, unshipped)

HTML mockups exist at `docs/mockups/2026-04-22-wallet-pages/` (`discovery.html`, `wallet-detail.html`, `_shared.css`, `README.md`, all untracked). Plan called for `app/wallets/[address]/` with 6 tabs (Overview/Positions/Trades/Alerts/Paper/Signals), equity curve, score history chart, and migration of 7 link callsites. **None of it landed.** Task 0.4 (user sign-off) never marked complete in plan.

### 9.6 Internal-language leaks

Overview `Recent Signals` empty state says `"No signals yet, waiting for next refresh cycle"` (`OverviewClient.tsx:406`).
Discovery panel exposes `"Schedule: 00:00 UTC daily (GitHub Actions)"` and `"Max Wallets: 2,000 discovered, top 500 active"` (`DiscoveryClient.tsx:362-373`).
Both violate the "no internal language in UI copy" rule.

### 9.7 Design token compliance

Every page consumes from `lib/design-tokens.ts`. Minor drift: many `rgba(255,255,255,0.0X)` inline styles across `OverviewClient.tsx` and `LeaderboardClient.tsx` duplicate `color.borderFaint`/`color.textMuted`/`color.divider` values instead of importing tokens. No hex leaks.

---

## 10. Schema, tests, infra

### 10.1 Test coverage

19 test files, 2,223 total LOC. Well-tested: `cohort-hygiene` (696 LOC), `wallet-profile`, `wash-sybil`, `radar-utils`, `leverage-risk`, `atr`, `cron-auth`, `signal-learning`, `hypurrscan-*`, `outcome-helpers`, `recipe-config`, `token-tiers`.

**Critical gaps (no tests):**
- `lib/signal-lab.ts` (1,261 LOC, all 13 recipes), **zero tests**. Recipes are the product. Threshold tuning ships blind.
- `lib/cohort-engine.ts:computeCohortScores` (V1 formula, what users see), V2 covered, V1 not.
- `lib/risk-engine.ts` (272 LOC, EV, liquidation, margin, fee schedule), zero.
- All 16 API routes, zero.
- All `lib/hooks/`, only `safe-local-storage` covered.
- React components, none.
- Cross-cutting: no test asserts KV payload shape matches consumer type.

### 10.2 Vercel plan

Two crons (`0 0` and `0 2`). `refresh-cohort` set to 30s timeout, `measure-outcomes` to 25s. **Requires Pro plan** or Hobby returns 504.

### 10.3 Observability

Freshness watchdog is the only outage signal. Would miss:
- Signal firing returning zero events (the current 6-day blackout).
- Recipe threshold drift.
- `measure-outcomes` insert errors.
- Learning loop failures (only artifact is `learning-summary.json`, nobody watches).
- pg_cron job failures.

No Slack webhook, no PagerDuty, no error-rate SLO, no log aggregation.

### 10.4 Data hygiene

Retention active on `cohort_snapshots`, `signals_history` (30d), `recipe_performance` (90d), `signal_outcomes` (30d), `wallet_score_history` (90d).

Unbounded: `signal_events` (legacy), `cohort_attrition`, `agent_log`, `agent_findings`, `agent_config_history`. All trivial in size today.

`wallets` grows monotonically. 6,036 dead rows (~15%). Last autovacuum 2026-06-20. Query plans will drift.

**`signal-learning.ts` writes `recipe_performance` via insert, not upsert.** Re-runs duplicate rows.

### 10.5 Untracked leftovers

- `learning-summary.json` (stale, 2026-04-22)
- `docs/mockups/2026-04-22-wallet-pages/` (never shipped)
- 8 uncommitted plan files (see §12)
- `CLAUDE.md` diff (documented in this session; RLS migration 019 plus agent-readiness route plus rank-ic.yml)
- `.claude/worktrees/audit-remediation`, `.claude/worktrees/naughty-turing`, `.worktrees/sprint-2-bias-trend` (all dormant)
- `anti-ai-writing style copy.md` (typo? Probably meant for global `~/.claude/CLAUDE.md`)

---

## 11. Concrete gaps (prioritized)

### 11.1 P0, signal firing silently broken (~6 days)

`signals_history.last_signal = 2026-07-16`. `signal_outcomes` at 3 rows. Freshness watchdog checks only `cohort-state.updated_at`, so this is invisible.

Root cause hypotheses (in likelihood order):
1. Vercel cron auth broke. A secret rotation on Vercel side without a corresponding GitHub Actions redeploy would silently 401 the cron. Verify `CRON_SECRET` still matches.
2. Hyperliquid API contract shifted. Response shape or endpoint change during the 3-month idle window. Check `hlPost<HlClearinghouseState>` in `lib/hyperliquid-api-client.ts` returns expected `assetPositions`.
3. `@vercel/kv` v3 binding shifted. KV writes may be failing silently.
4. Recipe thresholds shifted (unlikely, no code changes since April).

**Fix path:** run `curl -H "Authorization: Bearer <secret>" https://<prod>/api/refresh-cohort` manually, watch Vercel logs, check `signals_history` for new inserts. Add a "signal cadence" alert to freshness-check (`SELECT MAX(fired_at) FROM signals_history` must be < 90 min).

### 11.2 P0, no measured per-recipe edge exists

The learning loop is telemetry-only. The Claude agent (Phase 3, `2026-05-18-phase3-claude-agent-and-output-layer.md`) was designed to close this loop and was never built. Every recipe still fires with unmeasured edge. Trading decisions cannot be evidence-backed. This is the single biggest gap against the product's stated purpose.

### 11.3 P0, zero unit tests for `lib/signal-lab.ts`

1,261 LOC across 13 recipes, no tests. Any threshold tuning ships blind. Add per-recipe golden fixtures before touching thresholds.

### 11.4 P1, G7 equity gate bypassed for tier2 wallets

`scripts/daily-wallet-scan.ts:472-475` silently skips G7 for wallets not on today's leaderboard. Comment defers to cron dust-check, but the dust-check operates on `cohort_snapshots` which only exist for already-active wallets. Newly-scored tier2 wallets can bypass G7 entirely.

### 11.5 P1, R13 canary cutover decision stuck

Shadow scores wrote for ~62 days (post drift-fix). No code compares `median(rank_ic_shadow)` against `median(rank_ic) - 0.02`. Either wire the gate to auto-recommend or drop V2 shadow entirely.

### 11.6 P1, `rotation_carry` self-gate reads wrong metric

Reads intraday `ev_score > 0` proxy from `recipe_performance.win_rate`, not the truthful `win_rate_net`. Its shutoff behavior tracks upstream EV assignment, not actual outcomes.

### 11.7 P1, `AlertBell` orphaned

194 lines of drawer UI, mounted nowhere. Either wire it into the sidebar footer or delete.

### 11.8 P1, Wallet-detail rebuild in mockup-only state

Fastest path from "signal fires" to "trader acts on Hyperliquid" is currently entirely manual and undocumented in the UI. Trader has no share-safe permalink per wallet.

### 11.9 P1, Cron overlap at 00:00 UTC

`refresh-cohort` and `daily-wallet-scan` race on `wallets` writes. Shift Vercel cron to 01:00 UTC or gate with KV lock.

### 11.10 P1, Paper copy trading correctness

- Ignores `POSITION_RESIZED` (pyramided followed wallets diverge from paper).
- No cumulative equity curve.
- No risk controls (max positions, exposure cap, per-wallet cap).
- Two-tab duplicate-fire bug.
- No push/email, alerts only visible while tab open.

### 11.11 P1, `agent_findings.recommendation` is null on every insert

Learning loop cannot auto-tune. Phase 3 Claude agent was the closure plan.

### 11.12 P1, Non-directional recipes never get graded

`concentration_risk`, `bridge_inflow`, `twap_accumulation` have `direction=null`, skipped by `simulateAtrExit`. Undefined edge by construction.

### 11.13 P2, 8 `npm audit` vulnerabilities

Dev/CI transitive only, not runtime-exposed. Run `npm audit fix`.

### 11.14 P2, 14 open API routes act as unauthenticated Hyperliquid proxies

Anyone can hammer `deep-dive` / `wallet-positions` and burn our Hyperliquid rate limit. The seeded `rate_limit_tokens` table is unused. Wire IP-based rate limiting.

### 11.15 P2, Duplicate `/performance` and `/signals/performance`

Both render essentially the same data. `/performance` not in nav but reachable.

### 11.16 P2, `/edge` is a redirect stub

No dedicated edge landing surface. Should combine rank IC plus recipe accuracy plus fresh outcomes.

### 11.17 P2, `/signals/radar/designs` in production

830-line dev scratch, no nav link, but publicly reachable.

### 11.18 P2, RLS enabled but no policies on 20 tables

Anon-key path is dead code today. Either drop the anon key from `env.ts` and remove the false promise of defense-in-depth, or write policies.

### 11.19 P2, `search_path_mutable` on two functions

`get_recipe_outcome_stats`, `fn_update_updated_at`. One-line `ALTER FUNCTION` fix.

### 11.20 P2, `signal-learning.ts` insert-not-upsert on `recipe_performance`

Re-running duplicates rows.

### 11.21 P2, R26 Phase B prevention unshipped

No CI schema-health workflow, no hard-fail on 42P01/42703 during scan. The drift-fix wasn't followed by drift-prevention.

### 11.22 P2, Internal language in UI copy

`OverviewClient.tsx:406`, `DiscoveryClient.tsx:362-373`.

### 11.23 P3, Miscellaneous

- Wallets table dead rows (schedule weekly `VACUUM ANALYZE`).
- 15 unused indexes flagged by advisor.
- TypeScript target ES2017 (Node 20 supports ES2023).
- No `engines` field in package.json.
- Module-level mutable `lastHygieneBreakdown` in serverless (`app/api/refresh-cohort/route.ts:45`).
- Stale sparkline fallback in `DirectionSparkline`.

---

## 12. Backlog (untracked plans forensics)

| Plan | Executed? | Notes |
|------|-----------|-------|
| `2026-04-19-sprint-5-wallet-alerts-paper-trading.md` | **Fully executed** | All files present in prod. Plan file uncommitted. |
| `2026-04-20-r13-leverage-adjusted-scoring.md` | **Fully executed** | Shadow scoring wired, tests present. Cutover decision never made. |
| `2026-04-21-audit-remediation.md` | **Fully executed** | R25 landed via `d232655`. |
| `2026-04-22-schema-drift-postmortem-and-sync.md` | Diagnostic doc | No commits, but motivated R26. |
| `2026-04-22-r26-schema-sync-and-prevention.md` | **Phase A executed manually, Phase B zero** | Migrations 011-019 applied via Supabase dashboard/MCP. Prevention code (CI schema-health workflow, hard-fail on 42P01, `lib/supabase-errors.ts`) not shipped. |
| `2026-04-22-wallet-discovery-and-detail-rebuild.md` | **Phase 0 partial, Phase 1-2 zero** | Mockups exist. No `app/wallets/[address]/`. Task 0.4 sign-off never marked complete. |
| `2026-04-22-cohort-hygiene-correctness.md` | **Fully executed** | Idle gate plus sanity-throw landed. Plan file uncommitted. |
| `2026-05-18-phase3-claude-agent-and-output-layer.md` | **Zero execution** | No `@anthropic-ai/sdk` in package.json. No `app/agent/`. User walked away right after drafting. |

---

## 13. Edge analysis (the critical section)

Restated from the maintainer's directive: **everything exists to create a measurable trading edge from smart-money behavior.**

### 13.1 Where the edge SHOULD come from

Given the smart-money-following premise, the highest-leverage recipes are cohort-structural: multiple high-score wallets acting in concert, with skin in the game, opposite the crowd. These are `momentum_stack`, `divergence_squeeze`, `funding_divergence`, and `accumulation_reentry`.

The remaining recipes are either descriptive telemetry (`concentration_risk`, `wallet_churn`, `anti_whale_trap`, `position_aging`), generic momentum (`streak_continuation`, `funding_trend`), or off-cohort intent signals (`bridge_inflow`, `twap_accumulation`).

### 13.2 What the current system actually measures

**Nothing.** The learning loop produces:
- Signal outcomes: currently 3 rows (retention wiped historical data, no new signals firing for 6 days).
- Per-recipe expectancy: undefined for all recipes at present.
- Wallet-level rank IC: exists but was never verified against the MDIC=0.08 threshold in code (Phase 1 kill criterion logs only, never enforced).
- V2 vs V1 comparison: shadow rows exist for ~62 days but no median-comparison code has run.
- `agent_findings.recommendation`: null in every row.

### 13.3 The copy-trade loop

The only closed loop from signal to real-world position exists in paper trading, and it's client-side only. The path from a signal firing to a user placing a real trade on Hyperliquid requires:
1. User has `/signals/feed` tab open at the moment the signal fires.
2. User clicks the wallet address.
3. User reads the wallet-detail card.
4. User opens Hyperliquid separately.
5. User manually enters the trade.

There is no place-trade CTA, no Hyperliquid deep link, no clipboard-copy chip near signals. Between "signal exists" and "user acts" is entirely manual, undocumented, and untimed. Paper trading closes the loop but only on localStorage and only while the tab is open.

### 13.4 Structural risks to the premise

- **Circular EV.** When wallet_signal_stats lacks samples, `enrichWithEv` falls back to backtest, the exact circularity R12 was meant to remove. Cold-start conditions permanently reintroduce it.
- **Learning is telemetry, not learning.** No threshold auto-tunes. No recipe self-disables based on measured performance. The Phase 3 Claude agent was the closure plan and remains unbuilt.
- **Regime bias in cohort composition.** The tier1 leaderboard pre-filter anchors the cohort to today's 30-day ROI winners. In a regime change, the cohort composition flips wholesale (BULL winners drop off, replaced by BEAR winners) with corresponding whipsaws in aggregate signal.
- **Flat wallet baseline.** V1 `regime_fit=0.5` for flat wallets gives a free 0.075 score to any wallet with no positions. Undermines score meaningfulness.
- **Signal latency edge is unmeasured.** `whale_fill_ts` is null pending WebSocket ingestion (planned Sprint 21). The delta from whale-fill to signal-emit is currently unknown; the 60s cron cadence is likely too slow for the fastest patterns (`momentum_stack`).

### 13.5 Verdict

The plumbing is extensive and thoughtfully-designed. The measurement layer is complete on paper. **But the system has never produced a validated per-recipe edge**, and the learning loop was designed to close itself via a Claude agent that was never built. Every recipe still fires against thresholds set from priors, not evidence. If the user shipped signals to real capital today, they would be trading on backtest expectations, not measured outcomes.

---

## 14. Recommended next steps (edge-first ordering)

Prioritized against the trading-edge goal. Each item is scoped to be independently shippable.

### 14.1 (This week) Fix the signal blackout

Run `curl -H "Authorization: Bearer <secret>" https://<prod>/api/refresh-cohort` manually. Read Vercel logs. Check `signals_history` inserts. Root cause hypotheses in §11.1.

Add signal-cadence alert to `freshness-check.yml`: `SELECT MAX(fired_at) FROM signals_history` must be < 90 min. Emit failure otherwise.

### 14.2 (This week) Commit outstanding work

- Commit `CLAUDE.md` diff.
- Commit or delete the 8 untracked plan files.
- Commit or delete `docs/mockups/2026-04-22-wallet-pages/`.
- Delete stale `learning-summary.json` (or add to `.gitignore`).
- Decide on `.worktrees/*`, either prune or reactivate.

### 14.3 (Next 2 weeks) Add golden-fixture tests to `lib/signal-lab.ts`

Every recipe gets one green-path fixture and one negative-path fixture. Small, focused fixtures. Enables safe threshold-tuning work.

### 14.4 (Next 2 weeks) Resolve the R13 canary

Either:
- **Option A (data-first):** write a `scripts/check-r13-cutover.ts` that computes `median(shadow_ic) - median(v1_ic)` over the last 30 populated rows. If ≥ -0.02, replace V1 with V2 in the scan and drop shadow columns. If < -0.02, kill V2.
- **Option B (kill it):** if shadow rows are too thin to decide (which is likely given the recent blackout), drop the shadow columns, revert to V1, remove `computeCohortScoresV2` and `leverage-risk.ts` from the scoring path (keep the file for later re-fit work).

Either way, unblock the decision.

### 14.5 (Next month) Ship the Sprint 8 Claude agent

Per `docs/superpowers/plans/2026-05-18-phase3-claude-agent-and-output-layer.md`. Wire Haiku into `scripts/signal-learning.ts` in dry-run first. Consume `agent_findings` to auto-tune `agent_config` for the 10 tunable recipes. This is the single largest edge-generating item queued.

Concretely:
1. Install `@anthropic-ai/sdk`.
2. Add `simulateThresholdChange` to compute counterfactual per-recipe outcomes at proposed thresholds.
3. Add the Claude Haiku analysis pass at the end of `signal-learning.ts`.
4. Land the `/agent` page with findings feed plus apply-recommendation gate.

### 14.6 (Next month) Wallet-detail rebuild

Ship `app/wallets/[address]/page.tsx` per the April 22 plan. Six tabs, equity curve, score history. Migrate the 7 link callsites. This gives traders a shareable permalink and closes the "signal to wallet forensics" workflow.

### 14.7 (Next month) Fix `rotation_carry` self-gate

Change the win-rate source from `recipeWinRates` (intraday `ev_score > 0` proxy) to the truthful `win_rate_net` from the nightly `recipe_performance` row. Small change, high correctness gain.

### 14.8 (Next month) Alert push plus email

The copy-trade loop only closes while the tab is open. Ship server-side push via web push API or email digest of unseen alerts. Requires Sprint 6 auth to persist subscriptions.

### 14.9 (Deprioritize but track)

- Sprint 6 Auth: needed before push/email but blocks a lot of nice-to-haves; not directly edge-generating.
- Sprint 7 UI revision pass: after 6 lands.
- R26 Phase B prevention: post-mortem work; land after edge work is unblocked.
- `AlertBell`, either wire it in or delete.
- `/edge` real landing page combining rank IC plus recipe accuracy plus freshness.

---

## 15. Verification appendix (for a cross-audit LLM)

An independent auditor should be able to confirm this report by running these checks. Each check names the section it verifies.

### 15.1 Prod schema (verifies §1.1-§1.3, §12 R26 Phase A)

```sql
SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;
-- expect 20 application tables including wallet_profiles, signal_timing, cohort_attrition,
-- wallet_score_history, rank_ic_history, out_of_cohort_tracking, recipe_calibration,
-- wallet_signal_stats, plus wallets, cohort_snapshots, signals_history, signal_events,
-- signal_outcomes, agent_*, user_pnl_backtest, recipe_performance, rate_limit_tokens.

SELECT COUNT(*) FROM supabase_migrations.schema_migrations;
-- expect 19

SELECT * FROM cron.job;
-- expect 5 active retention jobs at 03:00-03:15 UTC
```

### 15.2 P0 signal blackout (verifies §0, §11.1)

```sql
SELECT MAX(fired_at)  FROM signal_events;
SELECT MAX(detected_at) FROM signals_history;
SELECT MAX(created_at) FROM signal_outcomes;
SELECT COUNT(*) FROM signal_outcomes WHERE is_win IS NOT NULL;
```

If `MAX(detected_at)` is > 24h stale, blackout confirmed.

### 15.3 Cohort scan health (verifies §5)

```sql
SELECT COUNT(*) FROM wallets WHERE is_active=true;
SELECT MAX(last_scanned_at) FROM wallets;
SELECT COUNT(*) FROM cohort_snapshots WHERE snapshot_time > NOW() - INTERVAL '25 hours';
```

Expect ~500 active, `last_scanned_at` fresh, snapshots active.

### 15.4 R13 canary state (verifies §5.4, §7.5)

```sql
SELECT COUNT(*) FROM rank_ic_history WHERE rank_ic_shadow IS NOT NULL;
SELECT AVG(rank_ic), AVG(rank_ic_shadow) FROM rank_ic_history WHERE rank_ic_shadow IS NOT NULL;
```

If shadow count is > 30, cutover gate should be evaluable. If not, V2 is unmeasurable.

### 15.5 EV blend state (verifies §7.4)

```sql
SELECT recipe_id, sample_size_30d, win_rate FROM recipe_calibration;
SELECT COUNT(*) FROM wallet_signal_stats WHERE sample_size >= 5;
```

If both are empty, `enrichWithEv` is running on the backtest fallback (circular).

### 15.6 Learning loop state (verifies §7.2, §7.3, §11.11)

```sql
SELECT COUNT(*) FILTER (WHERE recommendation IS NOT NULL) AS with_reco,
       COUNT(*) FILTER (WHERE recommendation IS NULL)     AS null_reco
FROM agent_findings;
```

If `with_reco = 0`, the loop is telemetry-only. Confirms §7.3.

### 15.7 Codebase existence checks (verifies §12)

```
test -f app/wallets/\[address\]/page.tsx        # expect ENOENT (wallet-detail rebuild unshipped)
test -f app/agent/page.tsx                      # expect ENOENT (Phase 3 unshipped)
test -f lib/supabase-errors.ts                  # expect ENOENT (R26 Phase B unshipped)
test -f .github/workflows/db-migrate.yml        # expect ENOENT
test -f .github/workflows/schema-health.yml     # expect ENOENT
grep -c anthropic package.json                  # expect 0
grep -c assertNonFatal scripts/daily-wallet-scan.ts  # expect 0
grep -rn "AlertBell" app/                       # expect no results (orphaned)
```

### 15.8 Live app state (verifies §11.1, §1.5)

```
curl -s https://<prod>/api/cohort-state | jq '.updated_at'          # < 20 min old
curl -s https://<prod>/api/refresh-cohort                           # expect 401 without auth
curl -s https://<prod>/api/rank-ic | jq '.total_measurements'       # should be > 30 by now
curl -s https://<prod>/api/signal-freshness | jq '.p50_latency_ms'  # not null
```

### 15.9 Recipe firing distribution (verifies §6.3, §13.2)

```sql
SELECT recipe_id, COUNT(*) FROM signal_outcomes
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY recipe_id ORDER BY 2 DESC;
```

Confirm non-directional recipes (`concentration_risk`, `bridge_inflow`, `twap_accumulation`) have `is_win = null` for every row.

### 15.10 Cross-checks any auditor should perform

- Verify the four "structurally defensible" recipes (`momentum_stack`, `divergence_squeeze`, `funding_divergence`, `accumulation_reentry`) actually contribute the majority of fired signals. If not, the cohort structural advantage isn't being exploited.
- Compare `is_win` (ATR simulator) against raw `move_pct_4h > 0` for the same rows. Divergence quantifies the optimism of the ATR simulator.
- Read `signal_timing.p95_latency_ms`. If p95 exceeds 3 min for momentum recipes, edge is unlikely regardless of correctness.
- Manually spot-check 20 rows deactivated with `wash_detected`. Confirm they are wash-trading vs high-frequency scalpers with legitimate strategies.
- Confirm no `overall_score` writer targets the `wallets` table. The score column may be stale (§5, verification need 13 from data-pipeline audit).

---

## 16. Confidence and limitations

- Prod state was verified via MCP against Supabase `qcedbargzizmayvimstg` on 2026-07-22. Row counts and migration state are ground truth as of that read.
- Every code claim cites file:line. A cross-auditor should be able to independently verify by opening the file at that line.
- The signal-firing blackout was inferred from `MAX(detected_at)` in `signals_history`. If retention on this table was recently altered, that inference is wrong. Verify with the queries in §15.2.
- The R13 canary state inference assumes shadow scoring wrote continuously post drift-fix. If scoring was paused during any window, the shadow sample size is lower than expected.
- Whether Vercel prod is still deployed and reachable is unverified. 3 months of dormancy could include a Vercel project pause. Run the §15.8 checks to confirm.
- This audit does not verify claims by running the code. Every runtime claim is inferred from the codebase.

**End of audit.**
