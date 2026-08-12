# The momentum family, and the split-half the correction never had

Two gaps the external reviews named, closed together because both live in the
same table. One result strengthens the long-hold lead slightly. The other
weakens it, and is the more important of the two.

## Provenance

- Command: `npx tsx --env-file=.env.local scripts/fill-study.ts --cache=<archived 120d> --freeze-pool`
- Pre-registered executioner table: non-overlapping windows, full cost model
  with path-wise funding, per-coin beta, frozen pool, day-clustered errors,
  trimmed mean, seeded bootstrap

## Finding 1: a 3-day momentum baseline nearly replicates the wallet signal

The reviews warned that one lookback is one point in a family. Run at three:

| hold | wallet | mom 1d | mom 3d | mom 7d |
|---|---|---|---|---|
| 60m | -18.1 (t -12.7) | -18.0 | -16.5 | -17.8 |
| 240m | -16.6 (t -5.3) | -13.5 | -10.1 | -16.6 |
| 720m | -4.7 (t -0.6) | +6.1 | -0.2 | -10.8 |
| 1440m | +13.6 (t 0.9) | -5.2 | +10.1 | -12.7 |
| 2880m | **+48.7 (t 1.6)** | -9.3 | **+31.7 (t 1.2)** | -8.4 |
| 4320m | **+64.2 (t 1.8)** | +22.1 | **+61.9 (t 1.5)** | +40.9 |

**At 72 hours a 3-day momentum rule returns +61.9 bps against the wallet
signal's +64.2. That is not separation, it is a tie.** At 48 hours the wallet
leads more clearly, +48.7 against +31.7, but not decisively at these sample
sizes.

This is a correction to something recorded yesterday. The claim that "momentum
is cleanly rejected" was true of the 1-day lookback, which loses at every long
hold, and it does not survive the wider family. The honest statement now is
that **the long-hold lead is not clearly distinguishable from 3-day price
momentum at 72 hours**, and only partially at 48 hours.

The 1-day and 7-day variants both lose, so this is not "momentum works at every
horizon". Something specific happens on a roughly 3-day scale, and the cohort's
entries may be a noisy proxy for it rather than an independent signal. Whether
that matters commercially is a separate question: a simpler rule that pays the
same is a better rule, because it needs no cohort, no discovery pipeline and no
scoring engine.

## Finding 2: the corrected table survives its split-half, with a front-loading warning

The split-half evidence cited for this lead came from the overlapping version.
The corrected, non-overlapping table had never had it applied. Split by
calendar day so the halves are equal stretches of time:

| hold | early | late | signs |
|---|---|---|---|
| 60m | -17.3 (t -9.9) | -18.9 (t -8.4) | agree |
| 240m | -18.4 (t -4.1) | -14.8 (t -3.4) | agree |
| 720m | -15.7 (t -1.4) | +6.1 (t 0.5) | disagree, both insignificant |
| 1440m | +10.6 (t 0.5) | +16.6 (t 0.8) | agree |
| 2880m | +66.5 (t 1.4) | +31.2 (t 0.8) | agree |
| 4320m | +108.4 (t 1.9) | +20.1 (t 0.5) | agree |

Sign agreement holds at every hold that matters, which is the pre-registered
secondary requirement and the lead passes it.

**But the decay is pronounced and worth naming.** At 72 hours the early half is
five times the late half. The positioning factor shows the same shape in the
same window (early +70.7, late +32.4). Two leads front-loaded in the same
120-day window admits two readings that this data cannot separate: the effects
are decaying as the market adapts, or the early stretch was a favourable
regime. Four sub-periods on a longer window is the test that separates them,
which is exactly what the 200-day run was pre-registered to provide.

## Net effect on the lead

Lead 2 is weaker than it looked yesterday. It still passes sign agreement and
still has positive trimmed means, but it now has a dumb rival that matches it
at the longest hold, and its strength is concentrated in the first half of the
only clean window available. It stays in the "failed but alive" state, and the
forward record remains the only thing that can promote it.

Lead 1 is untouched by this: the momentum rivals for the positioning factor
were tested separately and rejected on both IC (0.0119, t 0.42) and
orthogonality (rank correlation 0.042).
