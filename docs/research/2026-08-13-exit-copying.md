# Exit copying: dead, and pointing somewhere

The half of the follow premise nobody had measured. Registered before the run
(pre-registration, Hypothesis 3) and run against the frozen 120-day cache with
the same machinery as everything else.

## Provenance

- Command: `npx tsx --env-file=.env.local scripts/fill-study.ts --cache=<archived 120d> --freeze-pool`
- 15,997 closing episodes on coins with candles, from 28,163 closing fills
- Full cost model (19 bps round trip plus path-wise funding at 100% coverage),
  per-coin beta benchmark, non-overlapping windows, day-clustered errors,
  10% trimmed mean, seeded bootstrap, frozen pool
- Follower direction is opposite the position closed: a closed long is a sell

## Result

| hold | signal | n | days | mean bps | trim10 | t | boot95 |
|---|---|---|---|---|---|---|---|
| 60m | exit | 9773 | 121 | -19.2 | -19.2 | -14.7 | [-22, -17] |
| 240m | exit | 5304 | 121 | -20.9 | -21.1 | -6.2 | [-27, -14] |
| 720m | exit | 2830 | 121 | -25.4 | -26.4 | -3.2 | [-41, -11] |
| 1440m | exit | 1781 | 120 | **-60.5** | -54.2 | **-3.7** | [-93, -28] |
| 2880m | exit | 1055 | 119 | -54.1 | -53.8 | -2.0 | [-109, 0] |
| 4320m | exit | 768 | 118 | **-101.1** | -83.8 | **-2.6** | [-174, -26] |

Momentum baseline at the same times reads between -25 and +12 with no |t| above
0.7, so this is not the market drifting. Following these wallets out of a trade
loses money at every horizon, and the loss deepens the longer it is held.

**Verdict: dead**, per the pre-registered gate. Not retried at other holds on
this window.

## What it says, which is more interesting than the verdict

The failure is not noise, it is a strong negative with the sign stable across
all six horizons. Read plainly: **when this cohort closes a position, the price
keeps going the way the position was pointing.** They sell winners that carry
on winning.

Put beside the entry results, a coherent picture appears for the first time:

- Their **entries** are negative inside four hours and positive at 24 to 72
  hours (+48.7 bps at 48h frozen, unconfirmed).
- Their **exits** are wrong at every horizon and worst at the longest.
- Their **holdings** carry the strongest signal measured here (IC 0.065, t 3.17).

That is one story rather than three: these wallets pick well and hold well, and
leave money on the table when they get out. It also explains why positioning
beats trade-following, since positioning ignores their exit decisions entirely.

## The obvious next thought, and why it is quarantined

If following the exit loses, taking the other side of it should win. The
arithmetic is not a simple sign flip, because costs stay costs: at 72h the
flipped return is roughly +63 bps rather than +101, and at 24h roughly +23.

**This is recorded as a hypothesis and is not claimed as a result.** The sign
was chosen after seeing the data, which is precisely the error the project
quarantined the funding feature for on 2026-08-12. It is registered for the
200-day window and the forward record to confirm or kill out of sample. Until
then it carries zero evidential weight, and no live behaviour changes because
of it.

## Consequence for the follow premise

Entry copying at short holds: dead. Coordination: dead. Exit copying: dead.
The follow premise is now closed in both directions at trade horizons. What
survives is the long-hold entry lead, still unproven, and positioning, which is
a claim about what the cohort owns rather than what it does.
