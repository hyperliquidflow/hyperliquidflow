# Mirror-exit copying: positive, and still below its bar

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

## Not a promotion path

Even had it passed, the verdict states in the lead pre-registration allow only
"not killed by this window". No historical rerun can promote anything. Only a
powered forward record can.
