# The class C decision, made before the run that depends on it

Item 7 of the audit list in [LESSONS.md](LESSONS.md), and the question
[2026-08-14-market-maker-separation.md](2026-08-14-market-maker-separation.md)
left open on purpose: should class C, 892 addresses averaging 221 trades and 23
active minutes, join classes A and B in the maker exclusion?

Written 2026-08-14 before the population fetch it governs. Nothing below was
chosen with a result in view, because no result exists yet.

The class figures it reasons from were re-verified on the full 1,232-minute tape
after defect eight was found
([2026-08-14-tape-discovery-row-cap.md](2026-08-14-tape-discovery-row-cap.md)).
Class counts grow with the window and per-address averages hold, so the reasoning
below rests on numbers that survived the correction.

## The decision

**No. Class C stays in the primary population.** The exclusion rule is unchanged:
an address is excluded when it appears in at least 20% of observed minutes AND
trades at least 3 distinct coins.

Two supporting slices are declared here, in advance, and **neither may satisfy
the bar**:

1. **Sporadic only.** The primary recomputed on addresses below the recurring
   line, expressed as a share of the observed span so it survives a longer
   collection window: presence under 5/692 of minutes, the same line the
   classification used.
2. **Including partial history**, defined in the next section.

## Why class C is not excluded

**The rule's purpose is to remove a business model, and class C does not match
it.** The reason to exclude a market maker is specific: continuous two-sided
quoting produces a smooth realised-PnL series that the wallet score reads as
Sharpe, consistency and low drawdown, so the score detects a business rather than
transferable skill. That mechanism needs persistence. Class C averages 23 minutes
of 692, which is 3.3% presence, across 2.2 coins. Nothing about that is
continuous quoting.

**The 555-trade figure that makes C look disqualifying is itself
notional-conditioned.** It comes from the class C members inside the top 300 by
notional, and selecting by notional is the maker filter in reverse. That is the
exact selection that produced the IC 0.30 artifact. Excluding a whole class on a
statistic computed from the contaminated subset would repeat the error rather
than correct it.

**Trade count is the unit that already burned this project once.** Defect six of
2026-08-12 was a wallet pool that admitted market makers because it banded on
trade count, and trades and fills are different units. A single large order
sweeping resting liquidity prints many tape trades, so 221 trades across 23
active minutes is equally consistent with a handful of sweeps and with
high-frequency trading. The tape cannot currently tell those apart, because both
counterparties inherit a trade's single `side` field.

**The cost is not small and points the same way as every other exclusion.** Class
C is 892 of 4,652 addresses and 57.1% of observed flow. The previous run cleared
205 primary pairs against a designated 250, and every exclusion so far trims the
same tail: makers, page-capped wallets and fetch dropouts all remove high-volume
accounts. Adding C would compound that, not balance it.

## The primary statistic, restated with one change

Designated in [the tape program](../sprints/2026-08-13-tape-program.md) as
forward PnL in the wallet's own risk units, restricted to wallets active in the
train half. **One clause is added here, in advance: wallets whose history is
partial are excluded.**

A wallet is partial when the fill fetch hit the page cap or a page failed, so its
daily series ends before the wallet did and its score is computed on history that
is missing its tail. That is a measurement error rather than a small sample, and
it is different in kind from the activity filter, which reads the train half
only.

The change trims high-volume accounts, in the same direction as the maker
exclusion, so it is reported both ways. The line "primary incl. partial history"
exists so a reader sees exactly what the clause did.

## What would change this decision

A measurement, not a result. If two-sidedness becomes computable, whether by
confirming the `side` convention against `userFillsByTime` for a known address or
by another route, then class C can be split into makers and sweepers on
behaviour, and the makers excluded on the same rationale as A and B. Until then
the honest position is that C is unresolved, kept, and reported.

Seeing the primary statistic and then revisiting this is forbidden. The
sensitivity slice above exists so the question can be inspected without that
choice being available.
