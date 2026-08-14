# Sprint Status

Update this file whenever a sprint starts, progresses, or completes.
At the start of each session, read this file to know where to pick up.

## Owner decision, 2026-08-14: Path B

The owner confirmed stopping (Path D) was never on the table, which settles the
"if both leads fail" choice: **Path B, a data and intelligence product making
analytics claims, not alpha claims.** The boundary from
`docs/preflight/kill-criteria.md` binds: the product describes what profitable
wallets are doing, it never claims that following them earns a return, because
every measured version of that claim is dead. First steps are in
[docs/research/NEXT-SESSION.md](../research/NEXT-SESSION.md): permanent host for
the flow collector, the two tape fixes, the class-C decision before the next
skill run, three weeks of `positioning_history` before charting bias.

## Where this stands, 2026-08-13 late: the 200-day run landed and both leads are dead

The extension the whole pre-registration was built for completed and was read
against its written bars. Full entry with commands, fingerprint and tables:
[docs/research/2026-08-13-200d-frozen-extension.md](../research/2026-08-13-200d-frozen-extension.md).

**The map, revised.**

| Hypothesis | State | Evidence |
|---|---|---|
| Wallet ranking (who is in the cohort) | supported, untouched by this run | rank IC 0.0939 clean of lookahead |
| Positioning factor, diagnostic | **dead** | IC 0.0185, t 0.70 on 385 wallets, was 0.0653 (t 3.17) on 112 |
| Positioning factor, traded book | **dead** | +29.6 bps/day, t 1.33, bar was 2.5 |
| Long holds on entries | **dead** | +9.2 at 48h (t 0.4), trimmed negative, halves disagree in sign |
| Short-hold entry copying | dead | negative at every hold, even at zero latency |
| Coordination | dead | no dose-response |
| Exit copying | dead | -48.8 bps at 48h, t -2.5 |
| Skill-selected entries | dead | pre-registered contrast -30.6 bps/day, t -1.98 |

**Amendment 2 governs the reading and it was written before the data existed:** a
failure on this window is a kill, because survivorship works in the leads' favour
there. Both leads failed. Neither may be tuned, re-weighted, re-sliced or given a
new lookback on this cache.

**The one thing to understand before citing any of this.** The freeze cuts every
entry to its wallet's own post-discovery history and discovery began 2026-04-11,
so the 80 extra days of history were discarded in full. The fetch bought three
measurable days (104 to 107) and tripled the wallet pool (112 to 385). Every
difference against the 120-day run is a pool-composition difference. Pool depth
was the one parameter Amendment 1 did not pin, and the archived 120-day cache
was overwritten by this fetch, so the confound cannot now be separated on this
data. It is recorded, not resolved, and it does not rescue either lead.

**Owner decision now due**, per the pre-registration section "If both leads
fail": Path B (mechanical flows, a larger build) or Path D (stop or hold),
written from these documents rather than from memory. Stopping on evidence is a
successful outcome. This is the owner's call and no code should be written
toward either path before it is made.

**Still running, needing nothing.** `scripts/factor-shadow.ts` at 03:00 UTC. Its
day-60 checkpoint was powered at 82% off an assumed t 3.17 over 104 days. **Redone
2026-08-14 on the surviving t 0.70: 16% power at a bar of 1.5, and the bar a
60-day window can carry at 80% power is negative.** Day 60 is retired as a
decision point and is a verdict in neither direction; the recording continues
because it is free. See
[docs/research/2026-08-14-day-60-power.md](../research/2026-08-14-day-60-power.md).

## Where this stands, 2026-08-13: two external reviews answered in full

**Superseded by the section above.** Kept because the reasoning that led into the
200-day run is the record of how these leads were killed.

Read `docs/research/README.md` first. Every result now lives there with its
command, cache fingerprint and pass/fail against a bar written before the run.

**The map, after a night of pre-registered tests.**

| Hypothesis | State | Evidence |
|---|---|---|
| Wallet ranking (who is in the cohort) | supported | rank IC 0.0939 clean of lookahead |
| Positioning factor, diagnostic | **strongest thing here** | IC 0.0641, t 3.13 frozen; beat 4 dumb rivals |
| Positioning factor, traded book | failed but alive | +39.0 bps/day, t 1.42, capacity ~$100k |
| Long holds on entries | failed but alive, weakened | +48.7 at 48h (t 1.6); 3d momentum ties it at 72h |
| Short-hold entry copying | dead | negative at every hold, even at zero latency |
| Coordination | dead | no dose-response |
| **Exit copying** | **dead (new)** | -60.5 bps at 24h, t -3.7 |
| **Skill-selected entries** | **dead (new)** | pre-registered contrast -13.0 bps/day, t -0.47 |

**Three findings worth carrying forward.** The cohort sells winners that keep
winning, which with the entry and holding results makes one story: they pick
well, hold well, and give money back on the way out. Wallet skill predicts a
wallet's own returns and does not transfer to a follower copying single entries,
found twice by independent routes. And the diagnostic is far stronger than the
traded book, which favours selling the ranking over trading it
(`docs/research/2026-08-13-path-c-note.md`).

**Gates, powered (Amendment 3).** The 60-day forward bar was scheduling a false
kill at 34% power. Day 60 is now a powered checkpoint on the diagnostic
(t 1.5, 82% power); the traded book confirms at day 283. `lib/power.ts` does
the arithmetic. Forward record started 2026-08-12, runs itself at 03:00 UTC,
visible at `/portfolio/journal`.

**Six defects caught before publication this session**: a fetch heading for a
1GB crash, a conservation check that would have dropped every wallet ending
flat, a capacity table pricing only fillable book, the mis-powered gate, a
decile-9 headline the pre-registration blocked, and a volume lookahead showing
a false IC of 0.1014. Every one first appeared as an exciting result.

**Open, none blocking:** true open interest (no data source), fills and funding
halves of the cache audit (candles verified exactly, 8,405 bars), naming the
mechanism behind the lean, and the fill-timestamp fix (documented, deliberately
unbuilt). **Owner decision:** personal income or a business, which decides how
the day-60 number is read.

## Where this stands, 2026-08-12 evening: audited, externally reviewed, re-aimed

A full audit dossier was produced, adversarially hardened, and reviewed by two
independent frontier models. Read in this order before doing anything:

1. `docs/audit/2026-08-12-external-review-synthesis.md`, the deduplicated
   learnings and the revised order of work. Headline: the two surviving leads
   (positioning factor, long holds) have not yet faced their cheapest killers,
   which are real funding costs, day-level clustering, trimmed means, and dumb
   baselines (is it just momentum or OI change?). Run those executioners first,
   on the existing 120-day cache, before the 200-day fetch.
2. `docs/research/2026-08-12-preregistration-leads.md`, numeric pass/fail bars
   for both leads, DRAFT until the owner commits. No run against them may
   reframe the bar afterward.
3. `docs/research/README.md`, the results register. Every future research number
   lands there or it does not exist.
4. Dossier artifact (v1.1): https://claude.ai/code/artifact/59f120f5-cecf-4653-bad7-b792f3a5e11f
   and the local copy `docs/audit/2026-08-12-audit-dossier.html`.

Shipped 2026-08-12 evening: `.github/workflows/ci.yml` (typecheck + lint + 523
tests on every push; study-stats regressions can no longer ship silently) and
`.env.example` completed with the four production-required secrets.

Standing decisions from the reviews: entry-copy recipes get zero tuning
attention (gates fill on their own); the exit re-cut to multi-day holds waits
for out-of-sample confirmation; the forward shadow record of the positioning
factor should start as soon as a daily snapshot job exists, because its clock
is free and Path C needs the track record anyway.

**The forward out-of-sample clock started 2026-08-12** (migration 026,
`scripts/factor-shadow.ts`, `.github/workflows/factor-shadow.yml` daily at
03:00 UTC). Day 1 of 60 is recorded: 157 rankable coins across 50 wallets,
legs 5 a side. It resolves yesterday before recording today, never backfills,
and withholds any verdict below 60 days. This is the only instrument that can
settle either lead, because of the bound below.

**The hard bound on every backtest: discovery began 2026-04-11, so no clean
window can predate it.** Of the 4,791 band wallets, 4,335 were discovered in
April 2026 and zero existed 200 days ago. A window reaching further back
cannot be frozen; more history buys regime coverage for the contaminated
version of a study and nothing for the clean one. The clean window is capped
near 123 days today and grows a day per day. Frozen results
(`docs/research/2026-08-12-frozen-pool.md`, 92% of fills kept): Lead 2 at 48h
+48.7 bps (t 1.6, was 2.0) and at 72h +64.2 (t 1.8, was 2.1); Lead 1's IC is
unchanged at 0.0653 (t 3.17) with a full-cost book at 5 legs of +39.0 bps/day
(t 1.42) whose trimmed mean equals its mean. Survivorship was real, modest,
and did not carry either lead.

**The executioners ran the same evening
(`docs/research/2026-08-12-executioner-run.md`). Both leads FAIL their
pre-registered 2.5 confirmation bars at 120 days and survive every
falsification test.** Under the verified fee tier (4.5 bps a side, not 3.5),
5 bps slippage, path-wise funding at 100% coverage, and day-level clustering:
Lead 2 reads +58.6 bps at 48h (t 2.0, trimmed +42.7) and Lead 1's full-cost
book reads +51.5 bps/day (t 1.51, trimmed +28.4, both halves positive).
Momentum explains neither: the momentum baseline loses at every long hold and
rank corr(lean, momentum) is 0.045. Consequence, per the pre-registration:
both leads proceed to the 200-day extension with frozen pool membership and
leg width fixed at 5 (Amendment 1), and the forward shadow record starts as
soon as the daily snapshot exists. lib/study-stats.ts gained clusterByDay,
trimmedMean, bootstrapMeanCI (seeded) and fundingOverHold, all tested (534
tests green); R6 is closed, no local statistics copies remain in any script.

## Where this stands, 2026-08-12

Read the Edge Readiness gates before picking anything up. Six of seventeen are
verified, two candidates are eliminated, and everything downstream waits on one
question: whether any tradeable expression of wallet skill exists.

**Verified and shipped.** The cohort is real for the first time: 57 of 60 active
wallets are funded and holding, against 26 of 76 yesterday with 49 empty
accounts. Two root causes fixed and confirmed in production, a liquidation gate
that measured free margin rather than distance to liquidation, and a scan that
activated wallets it had never checked the balance of. Rank IC is 0.0939 clean
of lookahead, not the 0.0500 the project believed, because the old figure was
diluted by dormant wallets. Wallet scoring works.

**Eliminated, well powered.** Entry copying and coordination both fail as
standalone systems across 120 days and 2,403 independent coin-days.

**Reframed.** Testing each idea as its own trading system was the wrong frame
for weak signals: a feature with an IC of 0.03 is useless alone and useful in
combination. `scripts/signal-stack.ts` now measures seven features and their
correlation matrix, because features that agree do not stack and that matrix is
what decides whether accumulation is a real path. Six features come from the
cohort; funding is the one input the cohort cannot bias.

**A correction worth keeping.** Entry copying was described here as failing
because it demands immediacy. The data says otherwise: entering at the whale's
fill price returned -6.4 bps at an hour, entering a full 60 minutes late
returned -5.9. Lateness never cost anything. What failed was the
net-of-benchmark edge, and the 24h and 48h holds were underpowered rather than
dead, which is why entry flow survives as a feature.

**The methodological lesson, which cost most of the day.** Six defects were
found in the measurement code, and five had already produced a confident wrong
answer before being caught: silent candle truncation, clustered fills inflating
a decile to t=51, unbenchmarked direction reporting market beta as edge, a stale
price guard tuned for the wrong bar size, a wallet pool ordered by scan recency
that drew a dormant sample, and a pool banded on trade count that admitted
market makers because trades and fills are different units. Every one looked
publishable first. Any result from this codebase should be assumed wrong until
its sample has been checked against a previous run.

## Active Sprint

**Recovery Phase 2: Prove or Kill (2026-08-08 audit)**  
Status: **RESOLVED 2026-08-13, outcome KILL.** Started 2026-08-09. The phase
asked one question, whether any tradeable expression of wallet skill exists, and
the 200-day frozen run answered no on every candidate that reached a bar. See
the section at the top of this file and
[docs/research/2026-08-13-200d-frozen-extension.md](../research/2026-08-13-200d-frozen-extension.md).

Per `docs/preflight/kill-criteria.md`, a triggered kill is a successful outcome
of that document, not a failure of the project: the measurement layer worked and
said the premise is weaker than hoped before another year went into it. The two
fallback paths it names are a pivot to a data or intelligence product making
analytics claims rather than alpha claims, or shutting down. That choice is the
owner decision now due, and no new sprint should be opened before it is made.

Everything below this line is the history that led here, kept as the record.

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

**The 24h result did not survive a bigger sample (2026-08-12). Following the
average cohort entry has no tradeable edge.** Rerun at 1h bars over 120 days
across 350 wallets: 1,271,768 opening fills, 34,818 episodes, **2,403
independent coin-days** against 435 before.

| Hold | 45-day window | 120-day window | t |
|---|---|---|---|
| 1 hour | -5.1 | **-6.4** | **-7.5** |
| 4 hours | +2.0 | **-4.8** | **-2.7** |
| 12 hours | +23.0 | +1.2 | 0.4 |
| 24 hours | **+45.7** | **+5.6** | 1.0 |
| 48 hours | n/a | +13.9 | 1.5 |
| 72 hours | n/a | +6.3 | 0.6 |

The 24h figure fell from +45.7 to +5.6 and lost significance. Split-half shows
why, and it is worse than noise: the two halves carry **opposite signs with
significance in both directions**. Early half is -22.2 bps at 48h (t=-2.0) and
-41.6 at 72h (t=-2.8); late half is +61.2 (t=4.2) and +71.0 (t=4.2). That is
regime dependence, not edge. The 45-day window happened to be the favourable
half: 62% long into a +6.0% BTC move, where the 120-day window is 48% long into
a -14.2% move.

What is robust is the gross number and it does not help. Drift from the cohort's
own fill price is +14 bps at t=12.6 on 34,742 episodes, flat across every
horizon, 53% win rate. It is real. It is also market exposure: strip a per-coin
beta benchmark and charge 7 bps of round trip, and it is **negative at short
holds and zero everywhere else**.

The exit grid fitted to the cohort's own excursions loses at every setting, from
-5 to -58 bps, t between -3 and -53. MFE median 166 bps against MAE median -156
bps, near symmetric, so no stop and target pair extracts anything after costs.
No notional effect either: all five quintiles negative, none significant.

**Retraction.** The 45-day result was reported here as "the first lead that
survived being attacked". It did not survive the fifth attack. The suspicion
that the flat-across-latency 24h number was regime rather than alpha was correct
the first time, and talking myself out of it on arithmetic grounds was the
error: the arithmetic point about latency was right and irrelevant to whether
the effect was beta.

**What this does not test.** Every recipe rests on *coordination*, several
wallets entering the same coin and direction together, being different from the
average entry. This measured average entries. That hypothesis is still open and
is now the only version of the follow premise left standing. Testing it needs
the same harness restricted to episodes where N wallets cluster on a coin within
a window, which the cache already supports. Selection by score is also untested,
still blocked on point-in-time scores.

If coordinated entries look like average entries, the premise is dead and the
honest move is to stop tuning recipes and change the strategy.

**Coordination was tested. It carries no information (2026-08-12).** A signal
fires when the Nth distinct wallet enters the same coin and direction inside a
2-hour window, which is the earliest a follower could act:

| N | signals | 60m net | 240m net | 24h net | 24h early half | 24h late half |
|---|---|---|---|---|---|---|
| 1 | 15,320 | -7.7 (t-8.1) | -5.7 (t-3.4) | +3.2 (t0.7) | -9 (t-1.3) | +18 (t2.6) |
| 2 | 6,173 | -2.3 (t-1.2) | +1.9 (t0.6) | +19.5 (t2.5) | +1 (t0.1) | +41 (t3.7) |
| 3 | 2,893 | -9.9 (t-3.5) | -7.9 (t-1.6) | +2.1 (t0.2) | -19 (t-1.3) | +25 (t1.3) |
| 4 | 1,491 | -10.7 (t-2.7) | -16.6 (t-2.1) | +10.5 (t0.6) | -1 (t-0.0) | +21 (t0.8) |
| 5 | 840 | -5.5 (t-1.0) | -13.9 (t-1.3) | +20.1 (t0.9) | -3 (t-0.1) | +39 (t1.0) |

No dose-response. If coordination carried information the effect would
strengthen with N; instead N=3 and N=4 are the worst rows at short holds, which
is what crowding looks like rather than conviction. The single live-looking cell,
N=2 at 24h, splits into +1 early and +41 late, and **the identical split appears
at N=1 where there is no coordination at all**. It is the regime, not the signal.

**Verdict on the follow premise.** Tested three ways over 120 days and 34,818
episodes: average entries are negative after benchmark and costs at every hold
inside four hours and zero beyond; coordinated entries are no better and show no
dose-response; the long-horizon positives are a late-window regime artifact that
appears with or without coordination. Latency is not the obstacle either, since
entering at the whale's own fill price still nets -6.4 bps at an hour. Following
this cohort's positions does not produce a tradeable edge.

What survives is narrower than the system assumes. Wallet scoring does rank
wallets by forward risk-adjusted PnL (rank IC 0.0939, clean of lookahead), so
the wallets genuinely differ in skill. Their entries still carry no exploitable
follow-through, because whatever they know is in the price by the time the fill
prints, and the residual is beta.

This is a decision point for the owner, not a tuning problem. Options are to
change the premise (mechanical flow such as liquidation maps, funding and basis,
market making), to test a different expression of wallet skill than entry
copying, or to stop. Continuing to tune six recipes built on entry copying is
not supported by the measurement.

**Cohort recovery worked, separately and for real.** The 2026-08-12 01:00 UTC
scan ran Phase 9b for the first time and cut **147 unfunded wallets**, alongside
42 low_regime_coverage, 17 score_unstable and 8 high_leverage. Intraday removals
collapsed to 3 liq_imminent in 24 hours, against 36 in the 48 hours before the
gate was corrected.

| | 2026-08-11 | 2026-08-12 |
|---|---|---|
| Active (headline) | 76 | 60 |
| Funded and holding | 26 | **56** |
| Zero equity | 49 | **0** |

The headline count fell and the cohort that can actually emit a signal more than
doubled. 93% of active wallets are real, against 34% before.

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

**Point-in-time scores do not exist yet, and waiting is not the fix (2026-08-12).**
The fill study's score decile slice needs each wallet's score as of the fill
date. `wallet_score_history` holds 648 rows beginning 2026-08-08, four days,
because Phase 11 only started writing it then. Covering a 120-day study by
waiting means mid-December.

The alternative is to reconstruct it. `overall_score` is a function of trailing
daily PnL, and `scoreFromDailyPnls` in `lib/skill-test.ts` already computes it
from a series. Scoring each wallet from its own realized PnL up to each fill
date gives a point-in-time score with no lookahead and no waiting, over the full
history. That is the route to re-enabling the slice; the cache currently keeps
opening fills only, so it needs closing fills too for the PnL series.

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
