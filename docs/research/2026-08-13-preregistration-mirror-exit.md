# Pre-registration: mirror-exit copying

Written 2026-08-13, **before the run**, per the amendment rule in
`2026-08-12-preregistration-leads.md`. No result against these thresholds may
reframe them afterwards.

## Why this test exists

Every copy test this project has run used a **fixed horizon**: enter 10 minutes
after a cohort wallet's entry, exit after 1, 4, 12, 24, 48 or 72 hours regardless
of what the wallet did. The pre-registered skill-selection test that returned
-30.6 bps/day at t -1.98 used a 48-hour hold.

Measured 2026-08-13 on 39 active cohort wallets over 30 days, 300 completed round
trips: **median hold 14.4 hours, and 78.3% of positions closed before 48 hours.**
Right-censoring from 110 still-open positions biases that median down, so the
true figure is probably nearer 25 to 30 hours, but the conclusion holds: a
48-hour exit keeps a position open long after most wallets have left.

So the existing results measure "enter on their signal, exit on my own schedule".
They do not measure following a wallet. **The literal version, hold from their
entry to their exit, has never been run.**

## Hypothesis

Entering when a cohort wallet opens a position and exiting when that same wallet
closes it has positive net expectancy, benchmarked, after full costs.

## Prior, stated honestly before the run

I expect this to fail. The exit-copying study found the cohort sells winners that
keep winning, which implies mirroring their exit captures less than holding. That
expectation is recorded here so it cannot be claimed as a prediction afterwards,
and it does not lower the bar: a pass is a pass on the numbers below.

## Specification

**Population.** Active cohort wallets, raw fills from `userFillsByTime`. Pool
frozen to each wallet's own post-discovery history, so no entry predates the date
the wallet became knowable.

**Episode construction.** Per wallet and coin, chronologically, using
`startPosition` from the raw fill to reconstruct position exactly. An episode
opens when position moves from flat and closes when it returns to flat. Positions
still open at the window end are **excluded**, not treated as closed, since their
outcome is unknown. Partial closes do not end an episode.

**Entry and exit.** Follower enters at the coin's price 10 minutes after the
opening fill, and exits at the price 10 minutes after the closing fill. The
10-minute lag is fixed here, matching every prior study, so the comparison is
like for like. A zero-latency variant is reported as a reference only and cannot
satisfy the bar.

**Sizing.** Equal weight per episode. Mirroring their notional would let a few
large accounts dominate and is a different hypothesis.

**Costs.** 19 bps round trip: taker 4.5 bps a side (verified schedule, Amendment
1) plus 5 bps slippage a side. Funding charged path-wise over the actual hold,
signed by direction.

**Benchmark.** Per-coin beta to BTC over the same window, subtracted, using
`lib/beta.ts` and `lib/benchmark.ts`. A long-biased population in a drifting
market shows beta as alpha, which was defect three of the six found on
2026-08-12.

**Statistics.** Day-clustered standard errors on entry date. 10% trimmed mean and
a seeded bootstrap 95% interval, resampling days. Split-half by calendar time.

## The bar, fixed now

All four must hold:

1. Net mean above 0 with **day-clustered t at least 2.5**.
2. **Trimmed 10% mean above 0.** A lead whose trimmed mean is not positive is a
   lottery ticket, not an edge, and fails regardless of its t.
3. **Split halves agree in sign.**
4. Beats a dumb baseline on the same episodes: a random-entry control holding for
   the same duration on the same coin. If matching the duration is all that
   matters, the wallet layer contributes nothing.

At least 200 completed episodes across at least 30 wallets, or the run reports
underpowered and no verdict is recorded.

## Consequences

**Fail.** Mirror-exit copying is dead. Combined with fixed-horizon entries, exits
and skill selection, the follow premise closes in its last untested form, and no
further copy variant is tried on this window.

**Pass.** Recorded as "not killed", nothing more. Per the verdict states in the
lead pre-registration, only a powered forward record can promote anything, and no
historical rerun ever can. A pass here starts a forward record; it does not
authorise paper trading or capital.
