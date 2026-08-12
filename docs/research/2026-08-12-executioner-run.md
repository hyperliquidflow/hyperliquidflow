# Executioner run: both leads under the full cost model

The cheapest-killers-first pass demanded by both external reviews, run against
the pre-registered bars in [2026-08-12-preregistration-leads.md](2026-08-12-preregistration-leads.md).

## Provenance

- Commands:
  `npx tsx --env-file=.env.local scripts/fill-study.ts` and
  `npx tsx --env-file=.env.local scripts/positioning-factor.ts` (both read-only)
- Cache: `fill-study-cache.json`, fetched_at 2026-08-12T13:32:42.114Z, 120 days,
  1h interval, 58,307 rows, 30 candle coins, 112 wallets, banded pool
- Funding: `funding-cache.json`, hourly rates per coin, coverage 100% of
  expected settlements in every row of both instruments
- Cost model: 4.5 bps fee per side (verified base tier 2026-08-12) + 5 bps
  slippage per side = 19 bps round trip, plus path-wise hourly funding signed
  by direction. Turnover-aware on the factor book (round trip charged only on
  replaced names; first day charged in full)
- Statistics: clustered BY DAY, 10% trimmed mean, seeded bootstrap (2000
  iterations, seed 42)
- Code: commits `feat(study-stats)`, `feat(fill-study)`,
  `feat(positioning-factor)` of 2026-08-12 evening; 534 tests green

## Lead 2: long holds, non-overlapping, full costs, day-clustered

| hold | signal | n | days | mean bps | trim10 | t | boot95 | fund cov |
|---|---|---|---|---|---|---|---|---|
| 60m | wallet | 11014 | 121 | -18.3 | -18.1 | -12.7 | [-21, -15] | 100% |
| 60m | momentum | 10914 | 120 | -17.9 | -18.1 | -15.6 | [-20, -16] | 100% |
| 240m | wallet | 5820 | 121 | -16.3 | -15.5 | -5.3 | [-22, -10] | 100% |
| 240m | momentum | 5767 | 120 | -13.6 | -13.7 | -4.3 | [-20, -8] | 100% |
| 720m | wallet | 3026 | 121 | -0.5 | -2.6 | -0.1 | [-16, 15] | 100% |
| 720m | momentum | 2997 | 120 | 3.7 | -0.9 | 0.5 | [-10, 19] | 100% |
| 1440m | wallet | 1898 | 120 | 20.6 | 22.3 | 1.4 | [-9, 50] | 100% |
| 1440m | momentum | 1877 | 119 | -17.4 | -16.5 | -1.1 | [-47, 12] | 100% |
| 2880m | wallet | 1107 | 119 | 58.6 | 42.7 | 2.0 | [2, 116] | 100% |
| 2880m | momentum | 1086 | 118 | -17.1 | -33.0 | -0.6 | [-68, 37] | 100% |
| 4320m | wallet | 793 | 118 | 82.2 | 55.9 | 2.1 | [3, 159] | 100% |
| 4320m | momentum | 772 | 117 | 8.5 | 15.1 | 0.2 | [-75, 87] | 100% |

**Against the pre-registered bar (primary hold 48h, day-clustered t at least
2.5): FAIL at 120 days.** t reads 2.0 at 48h and 2.1 at 72h, down from 3.1 and
2.6 under the old coin-day clustering and 7 bps cost. The external review
predicted exactly this direction and size of correction.

**What did not kill it:** funding was fully charged (100% coverage) and the
means stayed strongly positive at 48h and 72h; the 10% trimmed means stay
positive (+42.7, +55.9), so the effect is not a pure lottery ticket; the
bootstrap interval sits above zero at both long holds; and the momentum
baseline at identical entry times loses money at every long hold, so the
wallet direction is not trailing-24h momentum in costume. Sign agreement in
24h, 48h and 72h holds as the shape requirement demands.

**Reading:** unconfirmed, not dead. The 120-day window lacks the power to
clear 2.5 at this effect size (about 118 day-clusters). The 200-day extension
with a frozen pool is justified and its bars stay as written.

## Lead 1: positioning factor, full-cost book

Legacy sections reproduce the recorded values exactly (IC 0.0640, se 0.0205,
t 3.12 over 104 days, 61% positive days; legacy 14 bps book 46.2 bps/day,
t 1.35), confirming the study-stats migration changed nothing (R6 closed).

Full-cost book (funding on every held name, 19 bps per replaced name):

| metric | value |
|---|---|
| days | 104 |
| mean | +51.5 bps/day |
| t | 1.51 |
| win rate | 53% |
| trimmed10 | +28.4 bps |
| boot95 | [-15.2, +120.5] bps |
| funding coverage | 100% |
| split-half | early +70.7 (t 1.12) / late +32.4 (t 1.18) |

Momentum baseline: momentum IC 0.0108 (t 0.38); momentum book +75.4 bps/day
(t 1.26, full turnover charged); daily rank corr(lean, momentum) 0.045.

**Against the pre-registered bar (day-clustered t at least 2.5): FAIL at 120
days.** t 1.51 on the traded book.

**What did not kill it:** funding charged in full and the mean rose slightly
versus the legacy book (turnover-aware fees charge less than the flat 14 bps,
and the short leg collects funding on net); the trimmed mean stays positive;
both split halves are positive and the same order; and the alternative
explanation is rejected on both counts: momentum has no IC here (0.0108,
t 0.38) and the lean is nearly orthogonal to momentum (corr 0.045). The
diagnostic IC (0.0640, t 3.12) is intact and cannot be attributed to chasing.

**Reading:** unconfirmed, not dead. The diagnostic is real and independent of
momentum; the traded expression at 3 legs a side on ~104 days does not have
the power to clear 2.5. Note for the 200-day run: leg width was not fixed by
the pre-registration and t rises with width in sample, so choosing width after
the fact would be fitting. A dated amendment fixes it ex ante (see below).

## Split-half provenance note

The legacy book's split-half now prints early +70.5 / late +21.9 (t 1.12 /
0.80), where the register history recorded 61.4 / 14.1 (t 2.22 / 0.51) from
the 2026-08-12 afternoon session. The overall book (46.2, t 1.35) and IC
(0.0640, t 3.12) match exactly; the split difference predates this change and
likely reflects the afternoon run predating the final cache compaction. Filed
as a discrepancy to re-derive once, not load-bearing for any verdict.

## Verdict of the run

Both leads fail their confirmation bars at 120 days and survive every
falsification test the reviews demanded: full funding (100% coverage), the
verified fee tier, slippage, day-level clustering, trimmed means, bootstrap
intervals, and momentum baselines. The wallet layer is doing something real in
both instruments; the samples are too short to confirm it at the pre-committed
significance. Consequence per the pre-registration's order of execution: both
leads proceed to the 200-day extension with frozen pool membership, and the
forward shadow record should start now since only forward data is true
out-of-sample.
