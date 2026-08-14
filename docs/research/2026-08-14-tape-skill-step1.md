# Step 1: wallet skill survives an unbiased sample, IC 0.1733

The one hypothesis still standing, measured for the first time on a population
that was not pre-selected on winning. **It passes its pre-registered bar**, and
it is the first clean positive result this project has produced.

Read the attack section before citing the headline. The number survived four
controls, including the one that could have manufactured it outright.

## The bar, written before the run

From [the tape program](../sprints/2026-08-13-tape-program.md), Step 1: **IC above
0.08 with t above 2**, on a **primary statistic** of forward PnL in the wallet's
own risk units restricted to wallets active in the train half, with a **minimum
of 250 usable pairs**. One clause was added 2026-08-14 before the run
([class C decision](2026-08-14-class-c-decision.md)): wallets whose fill history
is partial are excluded from the primary.

The minimum lives in the code, not only here, after the previous run printed
statistics on 205 pairs with no indication the sample was short.

## Provenance

- Draw frozen 2026-08-14T17:46:37.925Z, seed 20260814: **900 of 2,469 eligible**
  addresses, maker-like excluded by the persistence and breadth rule, $50,000
  tape notional floor, over a 1,254-minute observed tape.
- `npx tsx --env-file=.env.local scripts/tape-population.ts --fetch --days=90 --max-wallets=900 --concurrency=3`
  then two re-passes at concurrency 2 to close dropouts.
- Cache `fetched_at` 2026-08-14T19:42:26.674Z, 90 days, max 30 fill pages:
  **900 wallets, 6,836,999 fills** condensed to daily realised PnL, **0 dropped**,
  13 page-capped.
- `npx tsx --env-file=.env.local scripts/tape-skill-test.ts --min-active=5`
- `npx tsx --env-file=.env.local scripts/tape-skill-robustness.ts --min-active=5`
- Code at commit `da0e591`. `lib/skill-test.ts` is reused unchanged, so the
  number is comparable to the published 0.0939.

## Result

```
900 wallets in population
usable 752, too short 147, no realised PnL 1
partial history 13 page-capped, 0 fetch error, excluded from the primary
0 of 900 addresses never fetched

forward PnL, dollars               IC 0.0632  n  752  t 1.74
forward PnL, own risk units        IC 0.1703  n  745  t 4.71
PRIMARY active, full history       IC 0.1733  n  655  t 4.50
--- supporting, cannot satisfy the bar ---
primary incl. partial history      IC 0.1659  n  667  t 4.34
sensitivity: sporadic only         IC 0.1550  n  539  t 3.64
```

| clause | bar | read | |
|---|---|---|---|
| IC above 0.08 | 0.08 | **0.1733** | pass |
| t above 2 | 2 | **4.50** | pass |
| at least 250 primary pairs | 250 | **655** | pass |

**Verdict: PASS.** Wallet skill persists in a population discovered from the tape
rather than the leaderboard.

The three headline lines use **different samples** (752, 745, 655) because each
is a further filter, not a different measurement of the same rows. The attack
below holds the sample fixed at the primary's 655 throughout, which is the
comparison that obeys the same-sample rule.

## The attack

The primary correlates a score containing a Sharpe proxy, mean(train)/sd(train),
against a forward variable of mean(test)/sd(train). **Both sides carry sd(train)
in the denominator.** A wallet with a quiet training half would score higher and
post a larger normalised forward number for any given dollar outcome, which
manufactures a positive rank correlation out of arithmetic. Four controls, all on
the same 655 wallets:

**1. Dollars, which share no denominator.** IC **0.1064**, t 2.73. Positive and
significant without the normaliser at all.

**2. Remove sd(train) from the left-hand side.** Scoring on consistency and
drawdown only, neither of which contains a standard deviation (verified in
`cohort-engine.ts`), gives IC **0.1697** against the primary's 0.1733. The shared
denominator is worth 0.004.

**3. Is the score just measuring quietness?** Rank correlation between score and
sd(train) is **-0.0017**. The score is orthogonal to training volatility, which
is what the artifact would have required it not to be. The forward variable is
correlated with sd(train) at -0.16, as arithmetic demands, but a term correlated
with only one side cannot induce correlation between them.

**4. Stratified by sd(train), holding the shared denominator near constant:**

| quintile of sd(train) | n | IC, risk units | IC, dollars |
|---|---|---|---|
| $0 to $231 | 131 | 0.2330 | 0.3054 |
| $231 to $753 | 131 | 0.2184 | 0.2128 |
| $754 to $2,254 | 131 | 0.1651 | 0.1557 |
| $2,290 to $7,927 | 131 | 0.1110 | 0.1136 |
| $7,951 to $313,632 | 131 | 0.0847 | 0.0852 |
| **within-stratum average** | | **0.1625** | **0.1745** |

Positive in every quintile, in both units, at essentially full strength.

**5. Split-half over wallets, seeded.** Half A reads 0.1708 (t 3.12), half B
reads 0.1861 (t 3.42). Both significant, signs agree, magnitudes agree.

The shared-denominator hypothesis is dead. It was the right thing to check and it
is not what is happening.

## Why it is higher than the published 0.0939

Offered as an interpretation, not a measurement. The leaderboard population is
selected on having won, so its skill range is compressed, and a restricted range
attenuates a correlation. The tape population contains competent and incompetent
traders alike, so the score has more to sort. That predicts exactly the direction
seen. It is not tested here and an alternative account, that the two populations
differ in ways unrelated to range, is not excluded.

The stratification adds a second, unexplained shape: the effect is roughly three
times stronger among the quietest quintile than the noisiest. Not investigated.

## Limitations, none of which the bar waives

1. **Survivorship of activity.** An address appears because it traded during a
   20.9-hour tape. A wallet that blew up and stopped never appears. Far weaker
   than survivorship of performance, and not zero.
2. **The split is inside each wallet's own history**, so forward halves cover
   different calendar windows and different regimes. This is inherited from the
   published statistic and is what makes the two comparable.
3. **Realised PnL is `closedPnl`, which does not deduct fees.** This matters most
   for the base rate below and little for a ranking.
4. **One venue, 90 days, one regime span.**
5. **13 page-capped wallets excluded**, and the exclusion trims the highest-volume
   accounts, in the same direction as the maker exclusion. Reported both ways:
   including them the primary reads 0.1659.

## The base rate, still not citable

58.6% of the 752 usable wallets are profitable in their forward half, against
58.3% and 58.8% on two earlier and very different populations. **A third
population returning the same number remains suspicious rather than
reassuring**, the split itself lets survivorship in, and the figure is gross of
fees. It is recorded, not claimed.

Forward PnL p10 / median / p90: -$22,824 / $497 / $35,475.

## What this does and does not license

**It does** establish that a wallet's own past risk-adjusted record predicts its
own future relative record, on a sample not selected on winning. The ranking is
real and stronger than this project believed.

**It does not** revive any copy hypothesis. Seven expressions of copying are
dead, most on pre-registered bars, and the 2026-08-13 skill-selection test found
specifically that wallet skill does **not** transfer to a follower copying
entries. A wallet ranking predicting a wallet's own returns and a follower
earning a return are different claims, and only the first is supported.
