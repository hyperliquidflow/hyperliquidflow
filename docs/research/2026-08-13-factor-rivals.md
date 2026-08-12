# The lean is not activity in disguise

The sharpest criticism the external reviews made of the positioning factor:
cohort lean and open-interest change could be close to the same measurement
taken two ways, in which case the wallet layer contributes nothing and a far
simpler rule would do the job. Momentum was tested and rejected, but the review
correctly called momentum the wrong rival.

## What could be tested, and what could not

Historical open interest is not available from the Hyperliquid info API;
`metaAndAssetCtxs` reports it only as of now. Daily candle volume is available
and is the closest honest proxy, since OI change and traded volume both measure
activity crowding into a coin. Volume level, volume change and funding were
tested as rivals. True OI remains untested and is recorded as such.

## A lookahead caught before it was reported

The first run returned volume change at **IC 0.1014, t 3.33**, comfortably
stronger than the lean's 0.0640. It was wrong.

Day boundaries in this study are anchored to the first fill, 13:11 UTC on this
cache, while daily candles are stamped at 00:00 UTC. Selecting the candle whose
stamp falls inside a study day picks one that closes up to eleven hours after
the entry, so it overlaps the forward return window. High volume during a large
move then predicts that same move, which is circular rather than predictive.

Requiring each volume bar to have fully closed before entry collapses it:

| candidate | IC before fix | IC after fix | t after fix |
|---|---|---|---|
| volume change | 0.1014 | **0.0210** | 0.76 |

The lean is unaffected (0.0640 to 0.0641) because it is measured from positions
at the day boundary and was already aligned. That difference is the tell: a
correctly aligned feature does not move when alignment is enforced.

## Result, after the fix

| candidate | days | IC | se | t |
|---|---|---|---|---|
| **cohort lean** | 104 | **0.0641** | 0.0205 | **3.13** |
| volume level | 104 | -0.0399 | 0.0227 | -1.75 |
| volume change | 104 | 0.0210 | 0.0278 | 0.76 |
| funding | 104 | 0.0317 | 0.0288 | 1.10 |

Daily rank correlation with the lean: volume 0.034, volume change 0.029,
funding 0.039. All negligible.

## Reading

**The rival hypothesis is rejected.** Cohort lean is not a restatement of
activity: it is nearly orthogonal to volume, volume change and funding, and it
is the only one of the four that predicts next-day relative returns. A follower
could not replace it with a volume rule, because the volume rule does not work.

Together with the earlier momentum test (IC 0.0119, rank correlation 0.042),
four dumb rivals have now been offered the same job and none can do it. The
lean is measuring something the price and flow series do not contain, which is
what a claim about private positioning should look like if it is real.

This is the strongest support Lead 1 has received. It does not promote the
lead: the traded book still fails its bar, and only the forward record can
promote anything. What it removes is the most plausible way the diagnostic
could have been an illusion.

## Note on the mechanism question

The reviews asked what the lean is actually detecting, on the grounds that an
edge with no named mechanism cannot be monitored for decay. It is now known
what it is *not*: not momentum at one, three or seven days, not volume, not
volume change, not funding, and not the skill score. Naming what it *is*
remains open, and the honest candidate is the one the premise always claimed,
that concentrated informed positioning precedes price. That is a hypothesis
about a mechanism, not a measurement of one.
