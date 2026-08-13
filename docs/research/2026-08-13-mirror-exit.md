# Mirror-exit copying: positive on survivors, zero on everyone

The test that should have been run first. Pre-registered in
[2026-08-13-preregistration-mirror-exit.md](2026-08-13-preregistration-mirror-exit.md),
which was committed before this produced a number.

## Why it existed

Every prior copy test used a fixed horizon, because `signal-lab.ts` emits entry
events and the grading loop resolves them at fixed windows, so "does copying
work" was poured into the signal-shaped mould that already existed. Measured
2026-08-13 on 39 cohort wallets over 30 days, 300 completed round trips: median
hold 14.4 hours, 78.3% closed inside 48 hours. The 48-hour skill-selection test
that returned -30.6 bps held long after the wallet had left.

So the literal reading, hold what they hold until they drop it, was untested.
This is that test. Recorded as defect seven in CLAUDE.md, and it was found by the
owner asking why a copy test closes on a schedule the copied wallet never used.

## Provenance

- Command:
  `npx tsx --env-file=.env.local scripts/mirror-exit-test.ts --wallets=150 --days=90`
- Code at commit `d413d3a`.
- Episodes reconstructed from `startPosition` on raw `userFillsByTime` fills, so a
  partial close does not end an episode. Positions still open at the window end
  are excluded, never treated as closed. Pool frozen to each wallet's own
  post-discovery history.
- Costs 19 bps round trip plus path-wise funding. Per-coin beta to BTC subtracted.
  Day-clustered on entry date. Seeded bootstrap.
- 33 of 346 episodes dropped for a missing price or benchmark, roughly 10%,
  several coins having returned repeated 500s from `candleSnapshot`.

## Result

```
episodes     313 over 75 days
hold hours   median 20.8, p90 157.6
net alpha    71.3 bps per episode
day-clustered t   1.61
trimmed10    59.0 bps
boot95       [-13.0, 155.9] bps
split-half   early 115.7 (t 1.52) / late 75.1 (t 0.71)  signs agree
```

| clause | bar | read | |
|---|---|---|---|
| mean above 0, day-clustered t | t at least 2.5 | +71.3 bps, t 1.61 | **FAIL** |
| trimmed 10% mean above 0 | above 0 | +59.0 bps | pass |
| split halves agree in sign | agree | both positive | pass |

**Verdict: FAIL.** Per the written consequence, mirror-exit copying is dead.

## Two things are true and both belong here

**It failed its bar.** t 1.61 against 2.5. The bootstrap interval straddles zero.
That is the verdict and no reframing is permitted.

**It is the first copy variant with a positive point estimate.** Every
fixed-horizon test was negative: short holds, long holds, exits, and skill
selection at -30.6 bps. This one reads +71.3 bps with a trimmed mean of +59.0 and
halves that agree. That is new information about *where* the failure sits, and it
is consistent with the exit-copying finding that the cohort sells winners that
keep winning, which would make their own exits better for them than a fixed clock
is for a follower.

Recording the second point is not softening the first. The bar decides the
verdict; the shape of the miss decides what is worth measuring next.

## The limitation that matters most

**This ran on `is_active = true`, which is 41 wallets.** Those are the survivors
of the hygiene gates that are still trading today. Selecting on still being
active is survivorship, the exact defect the frozen-pool work removed, and it was
reintroduced here by reaching for the convenient filter.

Survivorship works **in favour** of the lead, so failing the bar on a favourable
sample is a stronger kill rather than a weaker one, by the same logic as
Amendment 2 on the 200-day run.

The correct sample is every wallet discovered before May, survivor or not, using
only post-discovery trades. That run was announced before this result was read
and is recorded separately. Announcing it in advance is what stops it being a
second bite at the same cherry.

## The unconditioned run, which settles it

Announced before the narrow result was read, run with no changes to code or bar.

- Command: `npx tsx --env-file=.env.local scripts/mirror-exit-test.ts --pool=discovered --wallets=250 --days=90`
- 250 wallets drawn at random with recorded seed 20260813 from the 5,000
  candidates discovered before 2026-05-01, survivor or not. 137 had fills.
- 3,828 completed episodes, 3,779 priced, 90 days. Well powered, unlike the first.

```
hold hours   median 1.0, p90 35.0
net alpha    -0.8 bps per episode
day-clustered t   -0.08
trimmed10    -9.3 bps
boot95       [-17.5, 19.2] bps
split-half   early -13.9 (t -0.94) / late -4.0 (t -0.30)  signs agree
```

| clause | bar | read | |
|---|---|---|---|
| mean above 0, t at least 2.5 | t 2.5 | -0.8 bps, t -0.08 | **FAIL** |
| trimmed 10% mean above 0 | above 0 | **-9.3 bps** | **FAIL** |
| split halves agree | agree | both negative | pass |

**The whole +71.3 bps was selection.** On the correct sample the effect is
indistinguishable from zero and its trimmed mean is negative.

| | narrow, 41 survivors | wide, unconditioned |
|---|---|---|
| episodes | 313 | 3,779 |
| net alpha | +71.3 bps | **-0.8 bps** |
| t | 1.61 | -0.08 |
| trimmed10 | +59.0 | **-9.3** |
| median hold | 20.8h | **1.0h** |

### The confound, named rather than buried

Two things changed at once and this run cannot separate them. The wide sample
adds back wallets that did not survive, **and** it is behaviourally different:
median hold falls from 20.8 hours to 1.0 hour. The unconditioned population
trades far faster, and fast trading is where every prior study also found losses.

So "it was all survivorship" is the convenient reading, not a demonstrated one.
What is demonstrated is that mirror-exit copying does not pay on a population
selected without reference to outcome. That is the claim the bar tested and the
claim that fails.

Separating survivorship from holding-speed composition would need a third run
matching the two populations on hold distribution. It is not worth doing: both
readings kill the lead, and the pre-registration forbids further copy variants on
this window.

## Not a promotion path

Even had it passed, the verdict states in the lead pre-registration allow only
"not killed by this window". No historical rerun can promote anything. Only a
powered forward record can.
