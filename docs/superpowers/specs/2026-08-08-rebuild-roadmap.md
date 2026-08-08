# Rebuild Roadmap: From Zombie Dashboard to Answerable Edge

Date: 2026-08-08
Basis: docs/audit/2026-08-08-full-audit.md (full report in the published artifact)
Prerequisite: Phase 0 complete (docs/superpowers/plans/2026-08-08-phase0-clean-house-and-resurrection.md)

The single organizing principle: **minimum time to verdict.** Every phase exists to answer one question sooner: which smart-money-following patterns, if any, make money at our latency? "None of them" is an acceptable answer; it ends the guessing.

This is a spec, not a plan. Each phase gets its own detailed implementation plan (written when the phase starts, so it reflects the system state at that moment). Phase 1 must not be planned in detail until Phase 0's exit criteria hold.

---

## Phase 1: Make outcomes measurable and honest (~1 week of work)

Goal: every fired signal receives a trustworthy net-PnL grade within ~26 hours, and nothing on screen claims more freshness or health than the data has.

### 1a. Grading rewrite (the core)

- Replace the batch cold-start gate in `scripts/signal-learning.ts` (100 outcomes AND 30 days, structurally impossible under old retention) with per-outcome grading: any outcome older than 24h that is ungraded gets graded on that run. No minimum population.
- Grade from `candleSnapshot` at true horizons (1h/4h/24h from `created_at`), reusing the approach already proven in `scripts/backfill-signal-outcomes.ts`. This fixes the mislabeled-horizon bug where one daily `allMids` pass wrote a ~25.4h price into `price_4h`.
- Keep the ATR exit simulation (2x stop, 3x target) but compute ATR from candles at signal time, not backfill time.
- Fix `recipe_performance` writers: upsert keyed on (recipe_id, day) instead of insert-append, so net stats stop being buried under fresh null rows; fix the reader map in `refresh-cohort` that keeps the oldest of 50 rows instead of the newest.
- Wire `scripts/wallet-signal-stats.ts` into `signal-learning.yml` as a step after signal-learning (its header already claims this happens). This activates the R12 EV decoupling for real; add a log line when `enrichWithEv` is running on the backtest fallback so circularity is visible.

### 1b. Recipe surgery (15 recipes to 6)

Cut from the signal product (delete recipe code, `RECIPE_META` entries, and config rows): `position_aging`, `concentration_risk`, `funding_trend`, `streak_continuation`, `liq_rebound`, `wallet_churn`, `anti_whale_trap`, `bridge_inflow`, `twap_accumulation`.

Keep and repair:
- `momentum_stack`: make the pair window cadence-aware (window = max(300s, 2x observed refresh interval)) so the flagship recipe can actually fire at real cadence. Priority one.
- `divergence_squeeze`, `accumulation_reentry`, `whale_validated`: unchanged logic, now gradeable.
- `rotation_carry`: replace the self-referential gate (reads the intraday ev_score>0 proxy) with `win_rate_net` from graded outcomes.
- `funding_divergence`: suspended from the feed (its only measurement was -316 bps median) until 30 honestly graded outcomes exist; also fix the null-EV-counts-as-loss artifact for cohort-level signals.

Each surviving recipe gets a golden-fixture test (one firing case, one non-firing case) before any threshold is touched. `computeCohortScores` V1 gets its first unit test.

### 1c. UI honesty pass

- As-of timestamp on every data surface (Overview, Leaderboard, In Position, Feed, Radar, Divergence).
- Monitoring dot driven by actual data age, not a hardcoded pulsing green.
- Discovery pipeline card derives status from live state instead of hardcoded "ok" strings; internal-language leaks removed (per the no-internal-language rule).
- Feed: fix the pagination bootstrap dead-end so history is reachable when the 24h window is empty; empty-state copy stops blaming the user's filters.
- Divergence: distinguish "scanned and found nothing" from "no input data".
- Radar: filter to active wallets; add Radar to the nav or fold it into another page.
- Ranking page: replace the sliding "first measurement ~date" with a date derived from actual accumulated measurements.

Exit criteria: a signal fired on day N has `is_win` and `net_pnl_bps` by day N+2 at the latest; `recipe_calibration` and `wallet_signal_stats` are non-empty; every page states its data age.

---

## Phase 2: Prove or kill (30-60 calendar days, near-zero work)

Goal: written, data-backed verdicts. The work here is patience plus a weekly 10-minute review.

- Rank IC: at 30 daily measurements, evaluate median IC against MDIC 0.08. Enforce in code (the rank-ic script writes a verdict row / fails loudly), not in a log line. Below threshold: the scoring formula gets rebuilt or the leaderboard stops claiming predictive power.
- R13 canary: same 30-measurement window decides V1 vs V2 scoring (shadow data finally flows after the Phase 0 fix). Cutover or delete `computeCohortScoresV2`.
- Per recipe: at 30 graded outcomes, compute `win_rate_net` and expectancy with Wilson CIs. Positive expectancy survives; anything else is deleted, not tuned. Weekly check-in doc records the tallies.
- Latency: `signal_timing` now accumulates at real cadence; measure p50/p95 from snapshot-detect to KV-write. If p95 exceeds what the recipe's premise tolerates (momentum patterns decay in minutes), that recipe's verdict is "not at this latency", which is a kill.

Exit criteria: a one-page verdict doc: which recipes have measured positive expectancy, whether wallet scores predict forward PnL, and what latency the system actually operates at. This document decides whether Phase 3 happens.

---

## Phase 3: Close the action loop (only if Phase 2 finds edge)

Goal: from "signal fires" to "you know, you act, you see what it was worth" in minutes, with an auditable P&L.

- Server-side alert delivery: web push or email digest for the surviving recipes; fires whether or not a tab is open. (Requires minimal auth, a cut-down Sprint 6: single-user magic link is enough, no full auth system.)
- Server-side paper trading: positions in Supabase, opened by the signal pipeline itself, closed by ATR exits or the followed wallet's exit, with a cumulative equity curve. This replaces the localStorage engine (tab-bound, resize-blind, duplicate-prone).
- Wallet detail page (`app/wallets/[address]`) per the April mockups, and a one-tap path from a signal to the Hyperliquid order screen.
- The Phase 3 Claude agent (2026-05-18 plan) becomes worth building here, once `agent_findings` has real graded material to reason over.
- Automated execution stays gated behind a written decision after paper P&L exists.

---

## Workstream M: Market intelligence (parallel, starts after Phase 1)

Purpose: give the system, and Claude sessions working on it, real market context: what regime we are in, what the major tokens are doing, whether cohort behavior diverges from the broader market. Sequenced after Phase 1 because more data cannot create edge until the measurement loop can grade anything.

### M1. Deepen regime detection from data we already have (no new dependencies)

The Hyperliquid `candleSnapshot` endpoint already serves OHLCV for every listed asset (used by `lib/atr.ts`). Build on it:
- Multi-timeframe regime: BTC and ETH trend (20d vs 5d), realized volatility band, and funding-rate percentile, replacing the single BTC-24h threshold in `detectRegime`.
- Per-token behavior profiles for the majors (BTC, ETH, SOL, HYPE): volatility regime, funding trend, OI direction. Stored daily, exposed to `regime_fit` scoring and to the radar.
- This is the highest-value chunk and costs zero new infrastructure.

### M2. Free market-data MCP servers (for Claude sessions and future agent phases)

Candidates, all free tiers, to be evaluated when this workstream starts:
- CoinGecko MCP server (official, free tier): global market caps, dominance, category flows, token metadata. Good for "what is the broader market doing" context.
- CCXT-based MCP servers (open source): unified OHLCV and order-book reads across exchanges, useful for cross-exchange funding and basis comparisons against Hyperliquid.
- Fear and Greed index (alternative.me, free API, trivial to wrap): one daily sentiment scalar for regime annotation.
Selection criteria: free, keyless or free-key, and actually consumed by a concrete feature (a regime input, a radar overlay, or agent context), not connected for its own sake.

### M3. Chart understanding

Two practical routes, in order:
- Computed indicators from candles (EMA stacks, ATR bands, support/resistance from swing highs/lows) feeding signal context; deterministic, testable, cheap.
- Claude-read charts (render candles to an image, have a Claude session or the Phase 3 agent annotate structure) as an analysis tool in sessions, not in the hot signal path.

Exit criteria: regime detection uses multi-timeframe evidence; at least one market-context input measurably changes a graded recipe's expectancy (checked via Phase 2 style A/B on `regime_at_fire`); anything that does not move a measured number gets removed.

---

## Sequencing summary

```
Phase 0 (1 day)     resurrect pipelines, clean house          <- plan exists, execute now
Phase 1 (1 week)    honest grading, 6 recipes, honest UI      <- plan when Phase 0 verified
Phase 2 (30-60d)    prove or kill, weekly reviews             <- verdict doc decides Phase 3
Workstream M        market intelligence                        <- parallel, after Phase 1
Phase 3 (2-3 wks)   alerts, server paper trading, agent       <- only on a positive Phase 2 verdict
```

Deferred indefinitely: full Sprint 6 auth, Sprint 7 UI revision sprint, R14-R24 remediation backlog, R26 Phase B prevention work (partially superseded by Phase 0's assertions and keepalive), automated execution.
