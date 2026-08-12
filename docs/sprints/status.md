# Sprint Status

Update this file whenever a sprint starts, progresses, or completes.
At the start of each session, read this file to know where to pick up.

## Active Sprint

**Recovery Phase 2: Prove or Kill (2026-08-08 audit)**  
Status: ACTIVE, started 2026-08-09. This phase is mostly waiting plus a weekly
review. No code work is required to progress it.

Phases 0 and 1 are COMPLETE and verified in production (2026-08-08/09):
- Phase 0 resurrected the pipelines: all 5 workflows active, keepalive prevents
  the 60-day auto-disable that killed everything in June, UptimeRobot drives a
  5-minute heartbeat, migrations 020 and 021 applied.
- Phase 1 made outcomes measurable: outcomes priced from candles at true
  horizons, per-outcome grading (the old quorum could never open), calibration
  wired nightly, recipes cut 15 to 6, 312 tests including first-ever signal-lab
  and V1 scoring coverage, UI states real data age everywhere.
- **Grading loop verified working 2026-08-09**: signal_outcomes carries real
  is_win, net_pnl_bps, exit_reason. That was 0 for the project's entire history.
- **momentum_stack fired for the first time ever** after the cadence-aware
  window fix. It had no record of firing in 4 months.

**Grading loop rebuilt 2026-08-10** (branch `fix/grading-loop-correctness`,
migration 022). The 2026-08-09 "grading loop verified working" note above was
premature: rows were being written, but every one recorded a 1h time exit
because the simulator broke out of its snapshot loop on the first non-null
price. Stops and targets could only ever trigger at the 1h mark. Regrading
moved measured expectancy from +2.5 bps to -97.4 bps at an unchanged 48.1% win
rate. Grading now walks the hourly candle path, uses point-in-time ATR, and
charges slippage and funding. Recipe headline stats are withheld below 30
graded outcomes, so the Performance page shows a sample count and nothing else
until the sample is real.

**Foundation measured 2026-08-11.** `scripts/cohort-skill-test.ts` answers the
question rank_ic_history never could: score each wallet on the first half of its
own daily PnL series, then rank-correlate against what it earned in the second
half. Across the full population of 6,624 wallets, **rank IC is 0.0500** against
a 0.08 minimum. Top decile forward PnL $19,964 vs bottom decile $12,185. With
n=6,624 the standard error is about 0.012, so the correlation is statistically
real and economically thin. Wallet selection carries signal. It does not carry
much. Rerun with `npx tsx scripts/cohort-skill-test.ts`.

**That 0.0500 was diluted, and the corrected reading clears the target
(2026-08-11, later the same day).** Two defects in how it was measured:

*The forward variable was raw dollars.* The score is built from scale-free
factors (Sharpe proxy, consistency, drawdown), so correlating it against dollar
PnL mixed a scale-free predictor with a scale-dependent outcome, and a large
account outranked a small one at identical skill. `normalizedForwardPerformance`
now expresses forward performance in units of each wallet's own train-half daily
risk. On its own this changed little: 0.0431 normalized against 0.0500 dollar.
The size effect was not the problem.

*The population was padded with dormant accounts.* A wallet that stopped trading
contributes a forward value of zero, which is not weak skill, it is no
measurement at all. The tell was the bottom decile's median sitting at exactly
0.0000. Restricting to wallets with at least 5 non-zero PnL days in the scoring
half, selected on the train half alone so no forward information enters the
filter, gives **rank IC 0.0939** (se 0.0191, n=2,740). That is above the 0.08
minimum, for the first time in the project's life.

The effect rises monotonically with how much a wallet actually trades, which is
what rules out a fitted threshold:

| Min active days in scoring half | Wallets | Rank IC | se |
|---|---|---|---|
| 1 (the old, diluted reading) | 5,302 | 0.0431 | 0.0137 |
| 3 | 3,706 | 0.0767 | 0.0164 |
| 5 | 2,740 | 0.0939 | 0.0191 |
| 10 | 1,290 | 0.1193 | 0.0279 |
| 20 | 172 | 0.2599 | 0.0765 |

Sweep it with `--min-active=N`. Two honest caveats. Part of that rise is
mechanical: more trading days means less estimation noise in both the score and
the forward measure, so precision alone lifts a correlation. And at n=2,740 the
95% interval around 0.0939 is roughly 0.056 to 0.131, so the point estimate
clears 0.08 while the interval still contains values below it. A variant that
conditions on activity in **both** halves reads 0.1469, but that filter uses the
forward period and no live system can apply it, so it is reported only as the
ceiling the clean number is reaching toward.

What this changes: the foundation is stronger than the project has believed, and
the lever is trading frequency, not more discovery. The current activation gate
asks for 60 trades in 60 days. The measurement says the score sharpens
considerably on wallets more active than that, so the gate is worth re-cutting
on non-zero PnL days rather than raw trade count. That is a cohort composition
change of the same family as the two shipped earlier today.

**Conviction gate and benchmark leg shipped 2026-08-11** (migration 023). Coins
need 1% of cohort gross notional and $1M absolute to emit signals, which keeps
12 coins covering ~90% of cohort capital and drops the tail. Every graded
outcome now carries `benchmark_bps` (BTC over the same hold, signed by
direction) and `alpha_bps`.

**Duplicates collapsed and benchmark beta-scaled 2026-08-11** (migration 024).
101 of 132 outcome rows were poll-cadence repeats of one KAITO long;
`scripts/dedupe-signal-episodes.ts` collapsed them to episode starts, archiving
into `signal_outcomes_superseded` first so it is reversible. Scoped to
funding_divergence rows predating the emission fix: momentum_stack repeats sit
at 46 to 132 minute gaps and are genuine re-accumulation, not artifacts.
`alpha_bps` now scales BTC's move by each coin's OLS beta, estimated only from
4h bars that closed before the signal.

Every graded outcome, deduplicated and beta-adjusted:

| Recipe | Coin | Beta | Net bps | Alpha bps |
|---|---|---|---|---|
| momentum_stack | ZEC SHORT | 1.52 | +336 | **+381** |
| momentum_stack | HYPE LONG | 0.95 | +114 | **+278** |
| momentum_stack | ZEC SHORT | 1.52 | +251 | **+265** |
| momentum_stack | ZEC LONG | 1.52 | -389 | -327 |
| funding_divergence | KAITO LONG | -0.68 | +468 | **+481** |
| funding_divergence | KAITO LONG | -0.69 | +420 | **+361** |
| funding_divergence | kBONK LONG | 1.43 | -636 | -419 |
| funding_divergence | CASHCAT SHORT | 4.23 | -3380 | -3485 |
| funding_trend | CASHCAT SHORT | 4.23 | -3380 | -3485 |

That is the entire honest record: nine outcomes. momentum_stack is 3 of 4
positive on alpha. funding_divergence is 2 of 4, and both its losses are on
coins the conviction gate now excludes, as is KAITO, so it has no track record
at all on coins it will actually trade going forward. Nothing here is a verdict.
Nine outcomes is a starting line.

**Exit structure retuned and five recipes revived 2026-08-11** (migration 025).
A path simulation over 2,808 random entries showed the 2/3 ATR exit timed out
74% of trades and hit its target 6.9% of the time; the shipped structure is now
1/1 ATR (84% resolve at the levels, outcome sd 195 vs 285 bps, which halves the
sample needed per unit of edge). Each graded row records its stop_atr/target_atr.
Separately, reachability checks found four silent recipes were dead code on the
conviction-gate universe: funding_divergence and rotation_carry required funding
levels never once observed in 6,000 coin-hours (thresholds recalibrated 0.05% to
0.004%/hr and 0.03% to 0.0025%/hr), whale_validated required score 0.75 against
a cohort maximum of 0.686 (now 0.60, the top decile), and accumulation_reentry's
6% floor overrode its own vol-adaptive threshold on majors (now 3%). agent_config
rows updated and KV invalidated. Rerun the reachability check with
`npx tsx scripts/funding-reachability.ts` after any universe change.

Sample-size arithmetic for the weekly review: at outcome sd ~195 bps, 30 graded
outcomes detect an edge of roughly +90 bps at 80% power; +50 bps needs ~95. The
30-outcome gate stays (it is the roadmap's prove-or-kill line) but a verdict on
an edge smaller than ~90 bps needs more than the minimum sample, and a positive
point estimate at n=30 is weak evidence on its own.

**Accumulation was measuring price, not trades (2026-08-11).** momentum_stack
and divergence_squeeze differenced `positionValue`, which is size x mark price,
so it rises when price rises with no trade at all. Of 6,440 notional increases
in 24h of live snapshots, 6,383 (99.1%) came with no size added. Both recipes
now use size added, priced at the current mark. Thresholds recalibrated against
genuine accumulation: momentum_stack MIN_WALLETS 3 to 2 and COMBINED_NOTIONAL
$500K to $100K, divergence_squeeze MIN_NOTIONAL_DELTA $75K to $25K.

**THE BINDING CONSTRAINT IS COHORT SIZE.** `scripts/recipe-dry-run.ts --replay`
replays stored snapshots through all six recipes and writes nothing. After every
fix above, the measured rate is **0.3 signals/day**, which is 100 days to a
single 30-outcome verdict. The cause is upstream of any recipe: 76 active
wallets produced only **64 genuine accumulation events** across every coin in
the whole retained window, and **not once did three wallets add the same coin
and direction** within 2 hours. The system had 493 active wallets in April.

Threshold tuning is exhausted. Lowering further fits noise instead of measuring
conviction. Nothing downstream can be validated until the cohort is rebuilt
toward its former size, which makes cohort recovery the single highest-leverage
work item, ahead of everything else on this list.

**The cohort was never 76 (2026-08-11).** The intraday shrink (75 wallets at
03:00 UTC, 59 by 17:00) was measured to hygiene rather than discovery, and the
measurement found two separate faults plus a headline number that was mostly
fiction.

*The active count is 65% empty accounts.* Of 76 active wallets, **49 held
exactly $0** and 26 were funded and holding a position, which is the only state
from which a wallet can contribute to a signal. `scoreWallet` reads live equity
from the leaderboard snapshot, so every candidate not on today's leaderboard
reaches the equity gate with `liveEquity === null` and skips it, deferring to
the cron dust check. The cron does remove them, six hours later, and the next
nightly scan activates them again. All 12 sampled addresses returned $0 from a
live clearinghouse query. Fixed by Phase 9b in `daily-wallet-scan.ts`, which
queries clearinghouseState for the **activated** set only (roughly 76 to 500
wallets, not the 4,500-candidate pool that blew the API budget when this was
tried at gate time) and deactivates the empty ones with reason `unfunded`.

*The liquidation gate measured the wrong quantity.* `liq_buffer_pct` is
`(accountValue - totalMarginUsed) / accountValue`, the fraction of equity not
committed as margin. That is a statement about leverage, not about how far price
must move before a position is liquidated. A wallet running its whole balance as
margin scores 0 and was removed as "liquidation imminent" while sitting 25% away
from its liquidation price. Of 36 wallets removed on that gate in 48 hours,
**30 were false positives**: median true distance to liquidation 25.6%, and only
2 were genuinely inside the 5% threshold. Between them they held $7.0M, median
wallet $41K. `liquidationDistance` in `lib/risk-engine.ts` now computes distance
from mark to the nearest `liquidationPx` carried in the same snapshot, and
hygiene gates on that. No migration was needed: `cohort_snapshots.positions`
already holds the data, so the correction applies to existing rows. A null
distance passes the gate, because unknown is not the same as unsafe.

Replaying the last 48 hours of hygiene decisions through the new gate retains 30
of 36 and takes the signal-producing cohort from **26 to 56**. That is a
counterfactual on stored snapshots, not a live measurement. The real numbers
arrive after the next nightly scan and a day of refresh cycles, at which point
`scripts/recipe-dry-run.ts --replay 24` gives the signal rate that decides
whether validation is possible. Rerunning it before then measures nothing, since
the stored snapshots it replays have not changed.

Note for the thresholds tuned on 2026-08-11: momentum_stack was cut to
MIN_WALLETS=2 / $100K because three wallets never once coordinated across what
was recorded as a 76-wallet cohort. It was a 26-wallet cohort, shrinking through
the day as the liquidation gate removed funded traders. Recalibrate against the
recovered cohort before reading anything into those numbers.

Still open from the same audit, in priority order:
1. **Cohort size, 26 signal-producing vs 493 active in April.** Two causes fixed
   2026-08-11 (see above); verify against the next nightly scan.
2. **Rank IC 0.05 is thin.** The cohort ranks better than chance but well under
   the 0.08 target. Either wallet selection improves, or recipes have to add
   most of the edge themselves. Worth testing whether a different factor mix
   raises it, since `cohort-skill-test.ts` now makes that a minutes-long
   experiment instead of a 60-day wait.
3. **Recipes remain unvalidated hypotheses.** Snapshot history is far too sparse
   to backtest them (May to June averages one snapshot every 5 to 8 hours, with
   a 6-week hole), so they can only be proven forward, one sample at a time.

**The backwards test exists now (`scripts/fill-study.ts`, 2026-08-11).** The
forward path needs 331 graded outcomes to detect a 30 bps edge, six months at the
current rate, and can only confirm an edge near +90 bps that whale-following has
no business having. Fills answer the same question retrospectively: the daily
scan already downloads every cohort fill and reduces it to a win rate. Each fill
carries coin, side, size, price and a timestamp, so joined to minute candles it
becomes one observation of "the cohort bought here, then what". Fetch once to a
local cache, then every hypothesis is a re-slice rather than a re-download.

First run said nothing, honestly. Three defects each produced a confident wrong
answer before the instrument was trustworthy:

- **candleSnapshot truncates silently.** It caps near 5,000 rows and returns the
  most recent rather than erroring, so a 7-day 1m request covered 3.6 days.
  Fills older than that resolved at long horizons and not short ones, so every
  row of the decay table used a different set of trades and the 24h row had more
  observations than the 4h row. Windows are now held under the cap, and
  `fullyCovered` requires entry and furthest horizon inside the span.
- **Fills are not independent.** One wallet opening a position emits dozens of
  fills seconds apart. Counted separately they inflate t by about the square root
  of the cluster size, which produced a score decile at t=51. `toEpisodes` merges
  same wallet, coin and direction within 30 minutes. **12,801 fills collapsed to
  269 episodes, roughly 47 fills each.** Any future study on this data that does
  not collapse first will report fiction.
- **Direction was unbenchmarked.** The cohort is mostly long and the market
  drifted, so signed raw returns collected beta: the 24h column read +137 bps at
  every latency, including latencies where a real signal would be long gone.

The score decile slice is disabled behind `--unsafe-score-slice`, not deleted.
`overall_score` is computed from recent PnL, so on a window inside that lookback
it already knows how those trades resolved. It needs point-in-time scores from
`wallet_score_history`.

After all three fixes: 269 independent episodes over 3 days and 98 wallets, t
between 0.0 and 2.0 across 28 cells. That is no evidence of an edge and none
against one. The instrument is sound and the sample is not.

Path to power, in order of leverage:
1. **More wallets.** The study pulled only the 98 currently active. There are
   6,624 discovered wallets with fill history, a 60x larger pool. Fill fetching
   is one API call per wallet.
2. **Longer window without breaking the candle cap.** 5m candles reach 17 days
   in one request against 3.4 days at 1m. Run the long window at 5m for the
   hold-length question, and keep a short 1m window for the sub-5-minute latency
   question, which is the one 5m candles cannot answer.
3. **Point-in-time scores** before the score slice means anything.

**First result that survived its own audit (2026-08-11, later).** With the fill
pagination, per-interval windows, per-coin beta from `lib/beta.ts` and coin-day
clustering all in place: 63,108 fills over 45 days, 1,382 entry episodes, and
**435 distinct coin-days, which is the real independent count**. Fifty wallets
buying the same coin on one afternoon resolve against one market move, so
coin-day is the unit, not the episode. Cohort is 62% long, BTC drifted +6.0%
across the window, and with 24% net long exposure that drift accounts for
roughly 3 bps, not the 45 below.

Net of a per-coin beta benchmark and 7 bps of round-trip cost, entering 10
minutes after a cohort entry:

| Hold | Net bps | t |
|---|---|---|
| 15 min | -4.0 | -1.7 |
| 1 hour | -5.1 | -1.2 |
| 4 hours | +2.0 | 0.2 |
| 8 hours | +14.6 | 1.3 |
| 12 hours | +23.0 | 1.6 |
| **24 hours** | **+45.7** | **2.3** |

A smooth monotonic build rather than one lucky cell, and both halves of the
window are positive at 24h (+29.6 early, +57.2 late) with the same shape. Gross
drift from the cohort's own fill price is positive at every horizon, +8 to +17
bps at t 2.2 to 3.2.

An earlier reading of this table claimed the flatness across entry latency
proved the 24h number was beta. That reasoning was wrong: shifting entry by an
hour inside a 24-hour hold moves 4% of the window, so flatness there is
arithmetic. Latency does bite where it should, on the short holds.

**What this changes about the live system.** The shipped exit is 1 ATR stop and
1 ATR target, tuned so 84% of trades resolve at the levels rather than timing
out. Resolution efficiency was the right thing to optimise for sample size and
the wrong thing for return: the measurement says the hours-long region is where
net return is zero to negative after costs, and the return accrues at 24h and
beyond. **The exits are timed to the wrong horizon.** Re-cutting them against
this curve is now ahead of any recipe threshold work.

What is not established. t=2.2 is marginal across a table with more than 28
cells, neither half clears significance alone, and this is one 45-day window in
one regime. It is a lead worth pursuing, not a proven edge. The next tests are a
longer window at 1h bars, which reaches 208 days, and holds past 24h to find
where the curve tops out.

The 10-minute polling architecture is not disqualified. The edge, such as it is,
does not live in the first minutes.

**The activity gate was measured and deliberately not shipped (2026-08-12).**
The skill test's monotonic IC-by-activity curve makes gating activation on
trading days look obvious. `scripts/activity-gate-tradeoff.ts` prices both sides
of it against the live cohort:

| Min active days (scoring half) | Rank IC | Live cohort kept | Lost |
|---|---|---|---|
| 0 | 0.0433 | 209 | 0 |
| 2 | 0.0670 | 163 | 46 |
| 3 | 0.0784 | 133 | 76 |
| 5 | 0.0940 | 87 | 122 |
| 7 | 0.1179 | 49 | 160 |
| 10 | 0.1208 | 27 | 182 |
| 20 | 0.2573 | 1 | 208 |

The live cohort's median wallet traded 8 days across the full backtest window
(p25 is 4, p10 is 2). The thresholds that produce the attractive IC numbers cut
the cohort to 27 wallets or fewer, which would undo the recovery this session
just did and cost roughly 98% of pair-coordination events, since those scale
with about the square of cohort size. Buying 2.8x on a wallet-selection metric
at that price is a bad trade, especially as the fill study points at holding
horizon rather than wallet selection as where the return actually sits.

The real reading is not "gate harder" but "the cohort is thin on activity".
Discovery should prefer wallets that trade on many distinct days, rather than
the existing 60-trades-in-60-days count which a wallet can satisfy in an
afternoon. Revisit the gate when cohort size is comfortable; at 209 it is not.

### Weekly review checklist (the whole job this phase)

1. Rank IC: needs 30 daily measurements, then compare median against MDIC 0.08.
   `select count(*), round(avg(rank_ic)::numeric,4) from rank_ic_history;`
2. Per recipe: at 30+ graded outcomes each, compute win_rate_net and expectancy.
   Positive expectancy survives, anything else is deleted, not tuned.
   `select recipe_id, count(*), round(avg(net_pnl_bps)::numeric,1) from signal_outcomes where is_win is not null group by 1;`
3. funding_divergence: suspended from the feed, still recording. Reinstate only
   at 30 graded outcomes with non-negative expectancy, otherwise cut it. It is
   currently producing most signal volume, so watch it closely.
4. R13 V2 canary: decide at 30 shadow measurements, cut over or delete V2.
   Counting starts 2026-08-11, not earlier. Phase 10b never wrote a single
   shadow score: its upsert omitted wallets.address (NOT NULL, no default), so
   Postgres rejected every chunk with 23502 and the error was swallowed by a
   console.error. Fixed 2026-08-10. Verify the next nightly scan leaves
   overall_score_shadow non-null, then expect the gate around 2026-09-10.
5. Cohort size: G10 was raised 15x to 25x on 2026-08-09, which should lift the
   cohort well above 77 on the next nightly scan. Verify it did.
6. Cohort recovery: after the next scan, check `unfunded_deactivated` in the
   scan summary (empty accounts should now be cut at scan time, not six hours
   later) and confirm `liq_imminent` removals have collapsed. Count wallets that
   are funded and holding, not wallets that are merely flagged active. Then
   rerun `npx tsx scripts/recipe-dry-run.ts --replay 24`.

Caveat for early data: outcomes created before 2026-08-09 were priced under the
old broken horizon logic (price_4h held a ~25h price). Treat their magnitudes as
indicative only.

Plan (Phase 0): `docs/superpowers/plans/2026-08-08-phase0-clean-house-and-resurrection.md`  
Plan (Phase 1): `docs/superpowers/plans/2026-08-08-phase1-measurable-outcomes.md`  
Roadmap: `docs/superpowers/specs/2026-08-08-rebuild-roadmap.md`  
Full audit: `docs/audit/2026-08-08-full-audit.md`

The 2026-08-08 audit found the entire measurement layer dead or never-connected:
all 4 GitHub workflows disabled since 2026-06-22 (60-day inactivity), rank IC at
0 rows ever (phantom column), the heartbeat (cron-job.org) dead since ~Jul 16,
cohort melted 493 to 58, learning loop structurally deadlocked. Sprint 6 (Auth)
and Sprint 7 (UI revision) are deferred until the roadmap's Phase 2 produces a
prove-or-kill verdict. Sprint 8's data gate was found never met (retention had
wiped the outcomes); it is superseded by the roadmap. Sprint 2 (Bias Trend) is
marked COMPLETE below but its feature branch was never merged; it survives on
`feature/sprint-2-bias-trend`.

---

## All Sprints

| # | Name | Status | Spec | Plan |
|---|---|---|---|---|
| 1 | Wallet Tier System | COMPLETE | [spec](../superpowers/specs/2026-04-13-sprint-1-wallet-tiers.md) | [plan](../superpowers/plans/2026-04-13-sprint-1-wallet-tiers.md) |
| 2 | Bias Trend Chart | COMPLETE | [spec](../superpowers/specs/2026-04-13-sprint-2-bias-trend.md) | [plan](../superpowers/plans/2026-04-14-sprint-2-bias-trend.md) |
| 3 | Global Position Heatmap | COMPLETE | [spec](../superpowers/specs/2026-04-13-sprint-3-heatmap.md) | pending |
| 4 | Market Radar | COMPLETE | [spec](../superpowers/specs/2026-04-13-sprint-4-market-radar.md) | [plan](../superpowers/plans/2026-04-17-sprint-4-market-radar.md) |
| 5 | Wallet Alerts + Paper Copy Trading | COMPLETE (2026-04-19) | [spec](../superpowers/specs/2026-04-13-sprint-5-alerts-paper-trading.md) | [plan](../superpowers/plans/2026-04-19-sprint-5-wallet-alerts-paper-trading.md) |
| 6 | Auth System | PLANNED (future) | [spec](../superpowers/specs/2026-04-13-sprint-6-auth.md) | not yet |
| 7 | UI Design + Integration Revision | PLANNED (after 4/5/6) | [spec](../superpowers/specs/2026-04-16-sprint-7-ui-revision.md) | not yet |
| 8 | Signal Intelligence Agent | BLOCKED (data gate: 100+ signal_outcomes, 30d history) | [spec](../superpowers/specs/2026-04-15-signal-intelligence-agent-design.md) | not yet |

---

## Signal Pipeline Streams (parallel to sprints)

Waterproof wallet selection system — 6 independent streams (A-F).

| Stream | Name | Status | Spec |
|---|---|---|---|
| A | Cohort Quality (activation gate) | COMPLETE (2026-04-18) | [spec](../superpowers/specs/2026-04-17-stream-a-cohort-quality.md) |
| B | Realtime Hygiene (live blow-up deactivation) | COMPLETE (2026-04-18) | [spec](../superpowers/specs/2026-04-18-stream-b-realtime-hygiene.md) | [plan](../superpowers/plans/2026-04-18-stream-b-realtime-hygiene.md) |
| C | Wash / Sybil Detection | COMPLETE (2026-04-18) | [spec](../superpowers/specs/2026-04-18-stream-c-wash-sybil.md) | [plan](../superpowers/plans/2026-04-18-stream-c-wash-sybil.md) |
| D | Per-Wallet Behavior Profile | COMPLETE (2026-04-18) | [spec](../superpowers/specs/2026-04-18-stream-d-behavior-profile.md) | [plan](../superpowers/plans/2026-04-18-stream-d-behavior-profile.md) |
| E | Signal Validation Feedback | COMPLETE (2026-04-18) | [spec](../superpowers/specs/2026-04-18-stream-e-signal-validation.md) |
| F | Dashboard Truth | COMPLETE (2026-04-18) | [spec](../superpowers/specs/2026-04-18-stream-f-dashboard-truth.md) |

**Stream A results (2026-04-18 scan):** 4496 discovered → 2263 scored → 493 activated (62% reduction from prior ~1285 baseline). Duration 40.3 min, under 50-min budget. Rejection breakdown firing all 9 gate categories.

---

## Remediation Plan Sprints (from .claude/plans/hyperliquidflow-remediation-and-kind-grove.md)

Separate sprint numbering from the product sprints above.

| # | Name | Status | Notes |
|---|---|---|---|
| R7 | Signal-to-entry latency capture | COMPLETE (2026-04-19) | migration 012, signal_timing table, SignalLabResult, freshness API + Overview stat card |
| R8 | Leverage capture + cohort attrition | COMPLETE (2026-04-19) | migration 013, computeLeverageStats, upsertAttritionStates, G10 gate, blow_up_distance |
| R9 | Rank IC measurement | COMPLETE (2026-04-19) | migration 014, wallet_score_history, rank_ic_history, rank-ic.ts, rank-ic.yml, /performance/ranking page, Overview IC badge |
| R10 | Outcome measurement overhaul | COMPLETE (2026-04-19) | migration 015, lib/atr.ts, simulateAtrExit, signal-learning rewrite, recipe_performance net PnL fields |
| R11 | Multi-window selection + OOCV | COMPLETE (2026-04-19) | migration 016, G11/G12/G13 gates, Phase 12/13 in daily-wallet-scan.ts, OOCV rank-ic comparison |
| R12 | EV decouple | COMPLETE (2026-04-19) | migration 017, recipe_calibration + wallet_signal_stats tables, wallet-signal-stats.ts nightly script, Bayesian blend (70/30) in enrichWithEv |
| R13 | Empirically-fit leverage-adjusted scoring | COMPLETE (2026-04-21) | migration 018, lib/leverage-risk.ts, computeCohortScoresV2, Phase 10b shadow scoring, rank_ic_shadow tracking |
| R14-R24 | Phases 2-4 (remainder) | PLANNED | |
| R25 | Audit remediation (Phases 1 to 4) | COMPLETE (2026-04-21) | migrations 019, 020, cron auth hardening, indexes, tokens, eslint CLI migration |
| R26+ | Phase 5: automated execution | GATED on Phase 3 | |
| R28 | Telegram ops bot | COMPLETE (2026-08-08) | 5 read-only commands, transition-based alerts (alert once, recover once), nightly scan digest. Spec: `2026-08-08-telegram-ops-bot-design.md`. Blocked on owner setup: `CRON_SECRET` must be added to GitHub repo secrets or the watchdog 401s every run |

### R13 Canary Cutover Gate

R13 runs V1 and V2 scores in parallel for 30 days via shadow columns. Cutover decision criteria:
- `rank_ic_shadow` median >= `rank_ic` median - 0.02 over 30 measurements
- Check daily in `rank-ic.ts` gate summary logs
- If criteria met: replace `computeCohortScores` calls with `computeCohortScoresV2` in `scripts/daily-wallet-scan.ts`, drop shadow columns from writes, update migration to rename or backfill
- If criteria fail: revert shadow scoring, investigate formula gaps before R14

Scripts / fit:
- `scripts/fit-leverage-penalty.ts` -- re-run after 90+ blow-up events to re-fit penalty params

### Known Gaps (deferred, non-blocking)

- **first_poll_ts backfill gap** (`app/api/cohort-state/route.ts`): backfill only fires on primary KV hit path. Fallback and KV-miss paths skip it. Latency stats are slightly undercounted on rare misses. Fix when Sprint R10 touches outcome measurement.
- **user_pnl_backtest partial upsert** (`scripts/daily-wallet-scan.ts` `computeLeverageStats`): upsert sends only `wallet_id + leverage columns`. Harmless while active wallets always have backtest rows. Would break if a wallet had no prior backtest row. Resolved in R13 -- no schema change was needed; note remains in case backtest schema changes later.
- **R13 shadow IC early cohort size** (`scripts/daily-wallet-scan.ts` Phase 10b, `scripts/rank-ic.ts`): Phase 10b only writes `overall_score_shadow` for wallets with `max_leverage_60d` populated. For the first few weeks of canary, shadow IC is measured on a smaller cohort than V1 IC. This self-corrects as leverage data fills in. Do not interpret early shadow IC volatility as formula weakness.
- **R13 shadow regime_fit approximation** (`scripts/daily-wallet-scan.ts` Phase 10b): shadow scores use `regime_fit = 0.5` (neutral) because the daily scan lacks live clearinghouse state. This is consistent across all shadow IC measurements. Production V2 scores (post-cutover) will use real regime_fit from the cron context.
- **measure-outcomes horizon mismatch (RESOLVED 2026-04-22)** (`app/api/measure-outcomes/route.ts`): prior 26h horizon filter combined with a daily cron dropped ~97% of outcomes (rows aged 26 to 48h between runs were permanently excluded). Only 45 of 1807 rows resolved. Fix: widened horizon to 72h and ran `scripts/backfill-signal-outcomes.ts` to sweep orphaned rows using `candleSnapshot` for historical prices. Post-backfill: 1719 resolved. Sprint 8 outcomes gate (100+) cleared; calendar gate (30 days of signal_outcomes history) remaining (~2026-05-17).

---

## How to Start a Sprint

1. Read this file to confirm which sprint is active
2. Read the spec doc for that sprint
3. Read the plan doc (once generated) for step-by-step tasks
4. Update "Last worked on" date above when you begin
5. Mark sprint COMPLETE here when all acceptance criteria pass
