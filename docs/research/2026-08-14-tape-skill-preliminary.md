# Skill persistence on a tape-discovered population: IC 0.30 was the makers

Step 1 of the tape program, run twice. The first run is the reason the second
exists. **Neither is a verdict**, and the second one says so in code.

## Provenance

- Population: `scripts/tape-population.ts --fetch --days=90 --max-wallets=378 --min-notional=50000`,
  seeded random draw (seed 20260814) among tape-discovered addresses, maker-like
  excluded (present in ≥20% of observed minutes AND ≥3 coins).
- 331 wallets fetched, 3,488,538 fills condensed to daily realised PnL.
- Statistic: `scripts/tape-skill-test.ts --min-active=5`, reusing
  `lib/skill-test.ts` unchanged so the number is comparable to the published
  0.0939.
- Code at commit `cc1f09b`.

## The two runs

| | run 1, top 300 by notional | run 2, maker-excluded random draw |
|---|---|---|
| population | 13% maker-like, 71% recurring HFT | makers excluded, random |
| usable pairs | 48 | 226 |
| dollars | IC 0.2338, t 1.63 | IC -0.0263, t -0.39 |
| own risk units | IC 0.3009, t 2.12 | IC -0.0036, t -0.05 |
| **primary**, active in train half | IC 0.2762, t 1.84 | **IC -0.0369, t -0.53** |

**The IC 0.30 was the market-maker confound, entirely.** On a population selected
without reference to volume it is negative and indistinguishable from zero.

That is the finding worth keeping. It is a measurement of a measurement error,
not of skill.

## What may and may not be claimed

**205 primary pairs against a designated minimum of 250.** No verdict on the
0.08 bar is recorded, and the script now refuses to imply one.

The reading is powered enough to reject an effect the size of 0.30, and not
powered enough to accept or reject 0.08. Those are different claims and only the
first is made here.

## Three named selection effects, none of them resolved

1. **Page-cap truncation.** 31 of 331 wallets hit the 12-page fill cap, so their
   series is partial and their score is computed on incomplete history.
2. **Fetch dropouts.** 30 of 378 addresses returned 5xx through four backoff
   attempts and were skipped. Not random: the expensive queries are plausibly the
   largest histories, so this trims high-volume accounts. It cuts opposite to the
   maker exclusion, which is not the same as cancelling it.
3. **Too-short attrition.** 105 of 331 lacked the 14-day span the split needs.
   Excluding makers removes the addresses with the most history, so this
   worsened when the population was corrected. The addresses easiest to measure
   are the ones least worth measuring.

## The base rate, which did not move

58.3% profitable in the forward half on the maker-heavy population, **58.8% on
the maker-excluded one**. Two very different populations, the same base rate.

That stability is suspicious rather than reassuring. A plausible cause is the
split itself: the forward half is the later part of each wallet's own observed
history, so a wallet still trading late is more likely to be one that was doing
acceptably. Survivorship of activity, again, entering through the measurement
rather than the sample.

Not investigated here. Recorded so the number is not cited as "most Hyperliquid
traders are profitable", which it does not support.

## Process defect found and fixed

The 250-pair minimum was designated in the program document and **not implemented
in code**, so the first corrected run printed its statistics with no indication
the sample was short. A threshold that lives only in a document is not a
threshold. It is now enforced in `tape-skill-test.ts`, which prints UNDERPOWERED
and states what the reading may be cited for.

## Next

More tape, a faster failure path on 5xx so dropouts stop biasing the sample, and
a draw large enough to clear 250 primary pairs. The question of whether class C,
892 addresses averaging 555 trades in six hours, should also be excluded remains
open and must be settled before the run that depends on it, not after.
