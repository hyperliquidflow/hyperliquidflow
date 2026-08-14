# The record of lessons

HyperliquidFLOW, 2026-04-11 to 2026-08-14. Written 2026-08-14, from the primary
records rather than from memory. Every claim here links to a dated file that
carries the command, the sample fingerprint and the verbatim tables. Where this
document and a primary record disagree, the primary record wins.

Purpose: one readable account of what we believed, what we built, what we
tested, what died, and what each death taught. It exists to be audited: the
final section lists what is recorded but unresolved, so a reader can check
whether we ran the right tests and what we may have missed.

## The short version

The idea was that skilled Hyperliquid wallets can be identified from public
data and copied for profit. Four months and 452 commits later, the measured
answer: the wallets can be identified (ranking works, thinly), and copying them
does not pay in any of the seven expressions we tested. Most died on numeric
bars written before the data existed. What survives is a wallet ranking with no
proven trading expression, a measurement layer that caught its own defects, and
one open question (skill persistence on tape-discovered wallets) that has a
reading but no verdict. The owner decision between Path B (data product) and
Path D (stop or hold) is due.

Stopping on evidence was defined as a successful outcome in
[docs/preflight/kill-criteria.md](../preflight/kill-criteria.md) on 2026-04-19,
before any sunk cost existed. That definition held.

## Where every hypothesis landed

| Hypothesis | Verdict | Decisive evidence |
|---|---|---|
| Wallet ranking (who is skilled) | supported, thin | rank IC 0.0939 clean of lookahead, se 0.0191 |
| Short-hold entry copying | dead | negative at every hold inside 4h, even at zero latency |
| Long holds on entries (24-72h) | dead | +9.2 bps at 48h (t 0.4), halves disagree in sign |
| Coordination (N wallets agree) | dead | no dose-response; N=3 and N=4 are the worst rows |
| Exit copying | dead | -60.5 bps at 24h, t -3.7 |
| Skill-selected entries | dead | pre-registered contrast -30.6 bps/day, t -1.98 |
| Mirror-exit copying (hold what they hold) | dead | -0.8 bps unconditioned, t -0.08; the +71.3 was selection |
| Positioning factor, traded book | dead | +29.6 bps/day, t 1.33 against a bar of 2.5 |
| Positioning factor, diagnostic IC | dead | 0.0185 (t 0.70) on 385 wallets, was 0.0653 (t 3.17) on 112 |
| Tape skill persistence | open, no verdict | -0.0369 on 205 pairs, below the designated 250 minimum |

## Chapter 1: The build (April 2026)

The project started 2026-04-11 as a dashboard: discover high-ROI wallets from
the leaderboard, score them on four factors, watch their positions, and emit
signals when they act. The first week went to visual identity and layout. The
next three built the machinery in earnest:

- Product sprints 1 to 5: wallet tiers, bias trend, position heatmap, Market
  Radar, alerts plus paper trading.
- Streams A to F: activation gates, live hygiene, wash and Sybil detection,
  behavior profiles, signal validation, dashboard truth. The 2026-04-18 scan
  took 4,496 discovered wallets to 493 activated.
- Remediation sprints R7 to R13: latency capture, leverage stats, rank IC
  measurement, outcome measurement, out-of-cohort validation, EV decoupling,
  a V2 scoring canary.

Two things from this period aged well: kill criteria written in daylight on
2026-04-19 with numeric thresholds (rank IC must clear MDIC 0.08), and the
habit of writing specs and plans before code. One thing aged very badly: we
built the measurement machinery and never verified it was measuring. The system
felt validated because validation infrastructure existed.

## Chapter 2: The silent death (May to July 2026)

On 2026-06-22 GitHub disabled all four scheduled workflows after 60 days
without a commit. Auto-disable produces no failed run, so no email. The
external heartbeat (cron-job.org, unversioned, invisible to the repo) died
around 2026-07-16. The cohort melted from 493 to 58 as hygiene kept pruning
with zero scan inflow. The UI showed a permanent green "Monitoring" dot
throughout, because it was hardcoded.

A 2026-07-22 audit reported the score-history tables as populated without
querying them. Both had zero rows, ever. The audit trusted the existence of
machinery as evidence the machinery worked, the same error the project itself
had been making since April.

## Chapter 3: The reckoning (2026-08-08)

A ground-state audit against live production
([docs/audit/2026-08-08-full-audit.md](../audit/2026-08-08-full-audit.md))
returned the verdict: **no measured edge exists, and none was ever measurable.**
Four months produced zero rank IC measurements, zero surviving graded outcomes,
zero recipe calibrations. Five root causes, all silent:

1. A phantom column: Phase 11 selected `wallets.overall_score`, which never
   existed. The error was swallowed and the job stayed green for 64 runs.
2. The workflow auto-disable, with the watchdog dying in the same event.
3. The real 24/7 heartbeat living outside the repo, where it could die unseen.
4. A learning deadlock: 30-day retention against a gate needing 100 outcomes
   and 30 days of history, which required a signal rate the system never had.
5. EV circularity: the calibration filler was never wired into any workflow,
   so EV fell back to the exact backtest win rate it was built to replace.

Nine of fifteen recipes were cut. The rebuild's organizing principle was
**minimum time to verdict**: rank IC needs about 30 daily measurements, recipes
need about 30 graded outcomes, and "no edge exists" is an acceptable answer.

## Chapter 4: Making measurement real (2026-08-09 to 2026-08-11)

Phase 0 resurrected the pipelines and added the keepalive that makes the
June failure structurally impossible. Phase 1 made outcomes measurable, and
promptly demonstrated why verification must go past "rows exist": the grading
loop was declared working on 2026-08-09, and on 2026-08-10 every row turned out
to record a 1h time exit, because the simulator broke out of its loop on the
first non-null price. Regrading moved measured expectancy from +2.5 bps to
-97.4 bps at an unchanged win rate.

2026-08-11 was the day the cohort became real and the first honest instrument
was built:

- The skill test read rank IC 0.0500 on 6,624 wallets, thin. Two defects were
  in the measurement, not the wallets: dollar PnL as the forward variable, and
  dormant wallets contributing zeros that are not measurements. Cleaned, the IC
  is **0.0939** (n=2,740), above the 0.08 bar for the first time, rising
  monotonically with activity.
- The liquidation gate was found to measure free margin, not distance to
  liquidation: 30 of its last 36 removals were solvent wallets, median 25.6%
  from liquidation. The equity gate was found to skip wallets absent from the
  leaderboard: 49 of 76 active wallets held exactly $0. Both fixed; funded and
  holding went from 26 to 56, and the next scan cut 147 unfunded wallets.
- Reachability checks found five recipes were dead code: thresholds requiring
  funding levels never once observed in 6,000 coin-hours, a score gate above
  the cohort maximum, and accumulation measured on `positionValue`, which moves
  with price when no one trades (99.1% of measured "accumulation" had no size
  added).
- `fill-study.ts` was built: fetch every cohort fill once, join to candles,
  and every hypothesis becomes a re-slice. Its first three defects each
  produced a confident wrong answer before being caught: silent candle
  truncation, uncollapsed fill clusters (12,801 fills are 269 episodes, and
  counting fills gave a decile t of 51), and unbenchmarked direction reporting
  market beta as edge.

The instrument, once fixed, produced the first lead: entries followed at 10
minutes and held 24h read +45.7 bps net (t 2.3) over 45 days, a smooth build
across horizons, positive in both halves.

## Chapter 5: The killing field and the method upgrade (2026-08-12)

The 120-day rerun (2,403 independent coin-days against 435) killed the lead:
+45.7 fell to +5.6 (t 1.0), and split-half showed opposite signs with
significance in both directions. That is regime, not edge. The 45-day window
had simply been the favourable half. A retraction was filed. Coordination was
tested the same day: no dose-response across N=1 to 5, and the one live-looking
cell appears identically at N=1, where there is no coordination.

Out of the wreckage came the reframe: stop testing trades, test holdings. The
**positioning factor** (copy the cohort's aggregate lean, rebalanced daily)
read IC 0.0653 (t 3.17) with a full-cost book at +39.0 bps/day (t 1.42). With
the surviving long-hold lead, these became the two leads.

The audit dossier was reviewed by two independent frontier models
([docs/audit/2026-08-12-external-review-synthesis.md](../audit/2026-08-12-external-review-synthesis.md)).
Their additions became binding method:

- Cluster by day, not just coin-day: alts are 60-80% correlated within a day.
- Charge real historical funding: cohort lean is the crowded side.
- Trimmed means and bootstrap: a right-tail mean is not an edge you can hold.
- Dumb rivals first: if momentum replicates the lead, the wallet layer adds
  nothing.
- A longer backtest is not out-of-sample. Only a forward record is. The
  shadow record started that night and runs daily at 03:00 UTC.
- Price the prize: honest capacity is about $100k of book, roughly $364/day
  if the edge is real. That number reframed everything after it.

Pre-registration ([2026-08-12-preregistration-leads.md](2026-08-12-preregistration-leads.md))
fixed numeric bars before the runs: confirmation at t 2.5, falsification tests
that kill, and written consequences for every outcome. The executioner run put
both leads under full costs, day clustering and trimmed means: both failed the
2.5 bar and survived every falsification, so both proceeded to the 200-day
extension under Amendment 1 (frozen pool, leg width pinned) and Amendment 2,
written before the data existed: **a failure on the extension is a kill,
because survivorship works in the leads' favour there.**

The frozen-pool study also established the hard bound: discovery began
2026-04-11, so no clean window can predate it. More history buys nothing for
the clean version of a study. This is why the forward record is the only
instrument that can settle a marginal lead.

## Chapter 6: The night of pre-registered tests, and the kill (2026-08-13)

Run in sequence, each against a written bar:

- **Exit copying**: dead at every hold (t -3.7 at 24h). Informative failure:
  the cohort sells winners that keep winning. They pick well, hold well, and
  give money back on the way out.
- **Skill-selected entries**: the pre-registered contrast (top skill tercile
  minus bottom) reads negative. Decile 9 alone looked excellent, which is
  exactly the headline the single pre-registered contrast existed to block.
  Wallet skill predicts a wallet's own returns and does not transfer to a
  follower, found twice by independent routes.
- **Factor rivals**: the lean is not volume, volume change or funding in
  disguise. A lookahead in the volume-change rival was caught reading a false
  IC of 0.1014 before publication.
- **Cache audit**: 8,405 cached bars against fresh exchange pulls, zero
  differences.
- **Path C note**: the diagnostic (t 3.13) is far stronger than the traded
  book (t 1.42), and a ranking has no capacity ceiling while a $100k book
  does. Selling the ranking beats trading it.

Then the run everything was built for. The 200-day frozen extension
([2026-08-13-200d-frozen-extension.md](2026-08-13-200d-frozen-extension.md)):
**both leads fail.** The factor's IC fell from 0.0653 (t 3.17) to 0.0185
(t 0.70); the book reads t 1.33; long holds read t 0.4 with halves disagreeing
in sign at every long hold. Amendment 2 made the reading automatic. Both dead,
no tuning permitted, none attempted.

One confound is recorded, not resolved: the freeze discarded all 80 extra days
(nothing predates discovery), so the fetch bought three measurable days and
tripled the wallet pool from 112 to 385. Every difference against the 120-day
run is a pool-composition difference, and the archived 120-day cache was
overwritten by the fetch, so the two cannot now be separated on this data. It
does not rescue either lead. It is a real hole and it is ours.

## Chapter 7: The last copy test, and the pivot to the tape (2026-08-13 to 14)

The owner asked why a copy test closes on a schedule the copied wallet never
used. That question exposed defect seven, different in kind from the first six:
**the apparatus shaped the question.** Every copy test used fixed horizons
because the existing grading loop resolves at fixed windows. Measured
afterwards: the median cohort position lasts 14.4 hours and 78.3% close inside
48, so the 48-hour tests held long after the wallet had left. The literal
reading of "copy a wallet", hold what they hold until they drop it, had gone
untested for months because the measurement that already existed was shaped
otherwise.

The mirror-exit test was pre-registered and run
([2026-08-13-mirror-exit.md](2026-08-13-mirror-exit.md)). On 41
survivor-selected wallets: +71.3 bps per episode, the first positive copy
number in the project's history. The unconditioned rerun on 137 wallets drawn
with a recorded seed: **-0.8 bps, t -0.08.** The entire effect was selection.
Dead on both clauses, and the follow premise closed completely.

The same day produced a data discovery worth keeping: the public WebSocket
trades feed carries **both counterparty addresses** on every trade, which the
docs deny and 732 observed trades confirm. Exchange-wide flow at address level
is obtainable; exchange-wide liquidations are not. A flow collector ran for
21.3 hours and captured 6,037 addresses and $1.74B of notional.

The first tape experiment promptly re-taught lesson B: skill persistence on
tape-discovered wallets read **IC 0.30**, and it was market makers, entirely.
Selecting the top 300 addresses by notional is a maker filter in reverse. On a
maker-excluded random draw the statistic reads -0.0369 on 205 pairs, which is
below the designated 250 minimum, so no verdict is recorded either way. The
run also surfaced a process defect: the sample minimum lived in a document
rather than in the code, which is now fixed.

The product was reshaped around what is true: coin pages, a markets index, a
public research page carrying the honest record including the failures, and
the liquidation heatmap deleted because its data cannot exist.

## The lessons, distilled

### A. Silent failure is the default state of unattended systems

A job that stays green while writing nothing is the normal failure mode, not
the exotic one: the phantom column ran green 64 times; the auto-disable sent no
email; the swallowed insert error (23502 behind a console.error) cost the V2
canary a month of data; the UI hardcoded its own health. The defenses that now
exist: verify the data, not the job (count rows, check distributions); CI on
every push; a watchdog that alerts on state change; a keepalive commit; no
critical dependency outside the repo.

### B. The first exciting number is usually the bug

Every major defect announced itself as a discovery: a decile at t 51, +137 bps
at every latency, a false IC of 0.1014, an IC of 0.30, +71.3 bps per episode.
The 45-day lead survived four attacks and died on the fifth. Excitement is a
trigger for audit, not for writing up. The full defect ledger is in CLAUDE.md
under Measurement discipline; every future session should treat it as the
prior.

### C. Selection enters through every door

Dormant wallets diluted the skill IC (0.0500 to 0.0939 cleaned). Survivor
conditioning inflated mirror-exit (+71.3 to -0.8 unconditioned). Notional
ranking selected market makers (0.30 to -0.037 excluded). A pool ordered by
scan recency drew dormant wallets. A filter using the forward half produced a
ceiling (0.1469) no live system can reach. The 58.8% profitable base rate is
suspicious for barely moving between very different populations, because the
train/forward split itself lets survivorship in. The question to ask before
reading any number: who is in this sample, and how did they get here?

### D. The statistics that turned out to bind

- Collapse to the true independent unit before computing t. Fills cluster in
  episodes, episodes in coin-days, coin-days in days. Each collapse cut t by
  more than the last.
- Subtract a benchmark, scaled by each coin's own beta. A long-biased cohort
  in a drifting market shows beta as alpha.
- Split-half everything. Opposite signs with significance in both halves means
  regime, and it killed two results that looked done.
- Trimmed means and bootstrap for tail-driven means. A lead whose trimmed mean
  is not positive fails.
- Dumb rivals before smart factors. Momentum tied the long-hold lead at 72h.
- Power a gate before scheduling it. The 60-day forward bar was a false kill
  waiting at 34% power until Amendment 3 re-powered it.
- Price capacity before spending months. $364/day reframed the entire
  cost-benefit of the trading path.

### E. Process is the only defense that scales

Pre-registration with numeric bars and written consequences is why the 200-day
failure was a clean kill instead of a tuning session. Kill criteria written
before sunk cost accumulated are why stopping is available as a success. The
results register exists because two headline results lived only in commit
messages; a result not in the register does not exist. Negative results are
filed with the same care as positive ones; they are the product. Thresholds
and minimums live in code, not documents. And archive a cache before
overwriting it: the one we failed to keep (the 120-day cache) is the one
confound we now cannot resolve.

### F. The apparatus shapes the question

The deepest lesson and the most expensive. The grading loop resolved at fixed
horizons, so every copy question got poured into a fixed-horizon mould, and
the literal reading of the premise went untested for months. Before reusing a
measurement that already exists, ask what the question actually is. The
related frame errors: testing weak signals as standalone systems (a feature
with IC 0.03 is useless alone and meaningful in combination), and blaming
latency when latency was never the obstacle (entering at the whale's own fill
price still lost).

## The audit list: recorded but unresolved

For the reader checking whether we ran the right tests. Each item is honest
exposure, not a to-do.

1. **The pool-depth confound on the 200-day run.** Every difference from the
   120-day run is a pool-composition difference, and the overwritten cache
   means it cannot be separated on this data. The kill stands on Amendment 2
   regardless, but the confound is real.
2. **The cache audit covered candles only.** The fills and funding thirds of
   the cache were never verified against the exchange.
3. **True open interest was never obtained.** The OI-change rival to the lean
   never ran for lack of a data source. The lean beat every rival we could
   build, not every rival we could name.
4. **The mechanism behind the lean was never named.** It died before the
   question was settled, but an unexplained factor that worked for 104 days
   deserves a post-mortem: what was it correlated with?
5. **The surviving hypothesis is thin.** Rank IC 0.0939 has a 95% interval of
   roughly 0.056 to 0.131, which contains values below the 0.08 bar. It also
   predates the tape program's maker lesson; whether leaderboard discovery has
   its own composition bias has not been re-examined under that lens.
6. **The forward shadow's day-60 checkpoint is mis-powered as written.** It
   was powered at 82% off t 3.17, a number that is now dead. Redo the
   arithmetic with lib/power.ts before reading day 60, or the checkpoint will
   assert more than it can.
7. **The class C decision is pending and order-sensitive.** Whether 892
   high-frequency addresses join the maker exclusion must be decided before
   the tape rerun. Deciding after seeing the result is choosing a population
   by its answer.
8. **Latency was assumed, never measured.** `whale_fill_ts` is null on every
   row. Acceptable only while no follow expression exists.
9. **One venue, one regime span.** The clean window is about 123 days and
   contains one drawdown and one drift. Nothing here has seen a full cycle,
   in either direction.
10. **Factor-mix experiments on the ranking never ran.** cohort-skill-test
    makes "does a different weighting rank better" a minutes-long question,
    and it has not been asked since the tool existed.
11. **The sign-flipped exit variant is quarantined, untested.** Fading cohort
    exits is a hypothesis someone may be tempted to promote; it has zero
    out-of-sample support.
12. **The activity gate is measured and deliberately unshipped.** Correct at a
    209-wallet cohort. If the cohort ever recovers toward 500, the trade
    changes and should be re-priced.

## Where this leaves us

The measurement layer did its job: it said no, cheaply, before another year
went in. Seven expressions of the copy premise are dead, most on bars written
in advance. Wallet ranking survives with real but thin predictive power and no
proven way to monetize it directly. The tape program is open, with an honest
non-verdict and a defined next run. The forward shadow record costs nothing
and keeps accruing. The decision that remains, Path B versus Path D, is an
owner decision about what to build on true things, and it should be made from
these documents rather than from hope.
