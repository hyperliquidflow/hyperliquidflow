# 200-day frozen extension: both leads fail their pre-registered bars

The run the whole pre-registration was built for. Under Amendment 2 a failure on
this window counts as a kill, so this entry resolves both surviving leads.

## Provenance

- Commands, exactly as pre-registered in `NEXT-SESSION.md`:

```bash
npx tsx --env-file=.env.local scripts/fill-study.ts --freeze-pool
npx tsx --env-file=.env.local scripts/positioning-factor.ts --freeze-pool --legs=5 --min-volume=2000000
```

- Code at commit `10487ad` (working tree clean apart from CLAUDE.md docs edits).
- Cache fingerprint: `fetched_at` 2026-08-12T23:41:12.783Z, days 200,
  interval 1h, compacted true, 335,378 fills, 398 wallets, 383 coins in fills,
  25 coins with candles. First fill 2026-01-24T21:50:41Z, last fill
  2026-08-12T21:34:43Z.
- Freeze effect: 335,378 fills to 237,536 (71% kept), 398 wallets to 385,
  earliest discovery 2026-04-11.
- Costs and statistics per the shared spec and Amendment 1: taker 4.5 bps a
  side, slippage 5 bps a side (19 bps round trip), path-wise funding at 82 to
  86% coverage, day-clustered standard errors, non-overlapping windows, legs 5
  a side, liquidity filter $2M (38 of 375 traded coins qualify).

## Read this before the tables: what the 200-day fetch actually bought

**Three days.** The freeze restricts every entry to its wallet's own
post-discovery history, and discovery began 2026-04-11, so both the 120-day and
the 200-day study are bounded by the same floor. The 120-day cache opened
2026-04-14; this one opens 2026-01-24 and has 80 extra days of history that the
freeze discards in full.

| | 120-day frozen run | 200-day frozen run |
|---|---|---|
| days measured (factor IC) | 104 | 107 |
| days (Lead 2 at 48h) | 119 | 122 |
| wallets after freeze | 112 | 385 |
| fills kept by freeze | 53,844 (92%) | 237,536 (71%) |

The window is materially the same. What changed is the wallet pool, which is
3.4x deeper into the same `--pool=traders` band. Every difference below is
therefore a pool-composition difference, not a longer-history difference. This
is stated first because reading these tables as "200 days killed it" would be
wrong.

## Lead 1: positioning factor

Bar (backtest-extension gate): full-window traded long-short mean above 0 with
day-clustered **t at least 2.5**, same sign in at least 3 of 4 sub-periods,
survives both dumb baselines, positive trimmed mean.

```
=== Daily cross-sectional IC: cohort lean vs next-day relative return ===
  days measured 107
  mean IC       0.0185   (se 0.0264, t 0.70)
  share of days positive 50%

=== FULL-COST book (pre-registered): funding + 19 bps per replaced name ===
  days 107  mean 29.6 bps/day  t 1.33  win 52%
  trimmed10 25.0 bps  boot95 [-13.3, 71.6] bps
  funding coverage 85% of expected settlements
  split-half    early 44.8 bps (t 1.20) / late 14.6 bps (t 0.60)

=== Momentum baseline: the dumb alternative the lean has to beat ===
  momentum IC   0.0647   (se 0.0338, t 1.92)
  momentum book -6.4 bps/day  (t -0.23, full turnover charged)
  daily rank corr(lean, momentum) 0.010
```

| metric | 120-day frozen | 200-day frozen |
|---|---|---|
| daily IC | 0.0653 (se 0.0206, **t 3.17**) | 0.0185 (se 0.0264, **t 0.70**) |
| days positive | 55% | 50% |
| full-cost book | +39.0 bps/day, t 1.42 | +29.6 bps/day, t 1.33 |
| trimmed10 | +38.4 (equals the mean) | +25.0 |
| boot95 | [-16.5, +90.7] | [-13.3, +71.6] |
| split-half | 43.5 (t 0.91) / 34.6 (t 1.26) | 44.8 (t 1.20) / 14.6 (t 0.60) |
| momentum IC | 0.0119 (t 0.42) | 0.0647 (t 1.92) |
| rank corr(lean, momentum) | 0.042 | 0.010 |

**Verdict: FAIL, therefore dead (Amendment 2).** The traded book reads t 1.33
against a bar of 2.5.

Two further observations, neither of which softens the verdict:

1. **The diagnostic did not survive the pool.** The IC that carried this project
   (0.0653, t 3.17, called "the strongest thing here" in the sprint status) reads
   0.0185, t 0.70 on the deeper pool over the same days. The book is nearly
   unchanged (39.0 to 29.6, t 1.42 to 1.33) while the diagnostic collapsed, which
   is the reverse of the expected pattern and is the single most informative
   number in this run.
2. **The momentum baseline now out-ICs the lean** (0.0647 vs 0.0185). It does not
   *explain* the lean, since the rank correlation is 0.010, so the shared spec's
   "a dumb baseline replicates the lead" clause is not triggered. Momentum's own
   book is -6.4 bps/day (t -0.23), so nothing here is tradeable. What it removes
   is the claim that the lean is a better diagnostic than the dumbest thing on
   the shelf.

The 3-of-4 sub-period clause was not evaluated: the script reports early and
late halves rather than quarters. This does not change the outcome, which is
already fixed by the t bar.

## Lead 2: long holds on entry follows

Bar: at the primary 48h hold, net mean above 0 with day-clustered **t at least
2.5**, 24h and 72h **agreeing in sign**, positive trimmed mean, positive in 3 of
4 sub-periods, survives momentum.

```
  hold | signal   |    n | days | mean bps | trim10 |    t | boot95 bps     | fund cov
  -----+----------+------+------+----------+--------+------+----------------+---------
  1440m | wallet   | 2525 |  123 |     -0.4 |   -6.8 | -0.0 | [-18, 17]      | 83%
       | split    | early    22.6 (t 1.5, n61)  late   -23.0 (t -2.2, n62)  SIGNS DISAGREE
  2880m | wallet   | 1352 |  122 |      9.2 |   -5.8 |  0.4 | [-30, 51]      | 82%
       | split    | early    44.3 (t 1.3, n61)  late   -25.9 (t -1.1, n61)  SIGNS DISAGREE
  4320m | wallet   |  921 |  120 |     -7.2 |   26.2 | -0.1 | [-112, 78]     | 82%
       | split    | early   -52.2 (t -0.6, n60)  late    37.9 (t 1.0, n60)  SIGNS DISAGREE
```

| hold | 120-day frozen | 200-day frozen |
|---|---|---|
| 24h | +13.6 (trim +16.7, t 0.9) | -0.4 (trim -6.8, t -0.0) |
| 48h (primary) | **+48.7** (trim +33.7, t 1.6) | **+9.2** (trim -5.8, t 0.4) |
| 72h | **+64.2** (trim +44.2, t 1.8) | **-7.2** (trim +26.2, t -0.1) |

**Verdict: FAIL on three independent clauses, therefore dead.**

1. t 0.4 at the primary hold against a bar of 2.5.
2. Signs do not agree: 24h negative, 48h positive, 72h negative.
3. Trimmed mean at the primary hold is -5.8, and the shared spec says a lead
   whose trimmed mean is not positive fails regardless of its t.

The split halves disagree in sign at every long hold, which the 120-day run did
not show. Per the pre-registered fail consequence: **entry-following is dead at
all holds, which closes the follow premise entirely.**

## Hypothesis 4: skill selection at 48h

Bar: top three deciles minus bottom three, day-clustered, **t at least 2.5**,
table broadly monotone.

```
  PRE-REGISTERED CONTRAST: top 3 deciles minus bottom 3, paired by day
    spread -30.6 bps/day over 117 paired days, t -1.98
    trimmed10 -24.3 bps, boot95 [-61, -1]
    bar is t 2.5: FAIL
```

**Verdict: FAIL**, and more strongly than the first run (-13.0 bps, t -0.47 on
the shallower pool). The spread is negative, not merely absent: the
higher-scored deciles do worse. Wallet skill predicts a wallet's own returns and
does not transfer to a follower copying its entries, now found by three
independent routes.

## Hypothesis 3: exit copying

Already dead from the 2026-08-13 first run, and the deeper pool makes it worse
rather than leaving it flat. Exit copying is negative at every hold and gets
monotonically more negative as the hold lengthens:

```
    60m | exit     | 22596 |  124 |    -18.8 |  -19.0 | -25.9
   240m | exit     |  9934 |  124 |    -21.6 |  -21.2 | -13.3
   720m | exit     |  4435 |  124 |    -30.8 |  -29.8 |  -5.4
  1440m | exit     |  2508 |  123 |    -39.2 |  -30.1 |  -3.6
  2880m | exit     |  1338 |  122 |    -48.8 |  -30.7 |  -2.5
  4320m | exit     |   921 |  120 |    -57.4 |  -38.1 |  -1.6
```

At the 48h bar that is -48.8 bps (trim -30.7, t -2.5) against a required +2.5.
The dumb momentum baseline loses less than the exit signal at every hold past an
hour (-9.8 vs -48.8 at 48h), so the cohort's exit timing is worse than no
information at all for a follower. The cohort sells winners that keep winning,
and the longer you hold that trade the more it costs.

## The confound this run cannot resolve

The 200-day fetch changed two things at once. The freeze nullified the window
change, leaving pool depth as the only operative difference, and pool depth was
never fixed ex ante. Amendment 1 fixed leg width and the liquidity filter
precisely to stop post-hoc choices; wallet count was the parameter nobody
thought to pin.

Two readings remain open and this window cannot separate them:

- The 112-wallet result was a small-pool artifact, and the wider pool is the
  honest estimate.
- The factor lives in the top of the band and is diluted by the additional 273
  wallets.

**Neither reading rescues the lead.** Under Amendment 2 a failure is a kill, a
pass would have confirmed nothing, and the second reading is a materially
different hypothesis that the pre-registration requires to be registered afresh
before it may be tested. It is recorded here as an observation, not as a
candidate.

The check that would separate them is not available: the archived 120-day cache
was overwritten by this fetch, and `positioning-factor.ts` has no wallet-slice
flag. Rebuilding it means new code and a new pre-registration. **Do not add a
wallet-count sweep to this cache.** That is a threshold search on a dead lead,
which the Lead 1 fail consequence forbids by name.

## Consequences, per the written documents

Per the pre-registration section "If both leads fail": the follow premise and
the positioning premise are both dead, and the next step is a written owner
decision between Path B (mechanical flows, a larger build) and Path D (stop or
hold), made from these documents rather than from memory. Stopping on evidence
is a successful outcome.

Two things are unaffected and should not be swept up in the kill:

- **Wallet ranking still stands** (rank IC 0.0939 clean of lookahead). It was
  never one of the two leads. Every result here says the ranking does not
  transfer to a follower copying trades, which is a different claim from the
  ranking being real.
- **The forward record keeps running.** `scripts/factor-shadow.ts` at 03:00 UTC
  needs no decision. Its day-60 checkpoint was powered at 82% off an assumed
  effect of t 3.17 over 104 days (Amendment 3); at t 0.70 that power calculation
  no longer describes the instrument, and the checkpoint should be re-derived
  with `lib/power.ts` before day 60 is read either way. Recording costs nothing
  and the arithmetic can be redone at any time.
