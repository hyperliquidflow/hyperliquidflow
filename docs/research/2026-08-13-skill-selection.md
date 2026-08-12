# Skill selection does not transfer to a follower

Registered before the run (pre-registration, Hypothesis 4). The point-in-time
score decile slice had only ever been run at a 4-hour hold, where nothing works
for any signal, so whether wallet skill *selects* entries had never been tested
at the horizon where the return lives.

## Provenance

- Command: `npx tsx --env-file=.env.local scripts/fill-study.ts --cache=<archived 120d> --freeze-pool`
- 14,108 of 16,305 episodes carry enough history to score point-in-time
- Scores rebuilt from each wallet's own realised PnL strictly before each entry,
  minimum 5 non-zero PnL days in the trailing 60. No lookahead.
- 48-hour hold, entry +10 minutes, full cost model with path-wise funding,
  per-coin beta, frozen pool, day-clustered errors

## Result

| decile | score range | mean bps | t | days |
|---|---|---|---|---|
| 1 | 0.000-0.098 | +79.5 | 1.2 | 100 |
| 2 | 0.098-0.147 | -32.8 | -0.9 | 108 |
| 3 | 0.147-0.165 | +49.0 | 1.0 | 107 |
| 4 | 0.165-0.199 | -31.2 | -0.8 | 101 |
| 5 | 0.199-0.239 | +61.8 | 1.1 | 101 |
| 6 | 0.239-0.327 | +21.5 | 0.6 | 106 |
| 7 | 0.327-0.437 | +22.6 | 0.6 | 108 |
| 8 | 0.437-0.547 | +50.7 | 1.4 | 110 |
| 9 | 0.547-0.621 | +111.3 | 2.4 | 111 |
| 10 | 0.621-0.683 | -43.0 | -1.2 | 97 |

**Pre-registered contrast, top three deciles minus bottom three, paired by day:
-13.0 bps/day over 114 paired days, t -0.47, trimmed -6.8, bootstrap
[-71, +39]. Bar was t 2.5. FAIL.**

## Why the contrast was pre-registered as one number

Decile 9 reads +111.3 bps at t 2.4 and would have made an excellent headline.
Decile 10, built from the highest-scoring wallets of all, reads -43.0. There is
no monotone shape, the signs alternate through the middle, and the single
attractive cell sits next to its own contradiction.

Ten decile means are ten chances to find a winner, and this table would have
handed one over. Committing in advance to a single contrast is the only reason
that did not happen, and it is worth recording as the clearest example this
project has produced of the pre-registration doing real work.

## What it means

**Wallet skill predicts a wallet's own forward returns and does not sort the
entries a follower can copy.** Both statements are now measured: rank IC 0.0939
clean of lookahead for the first, and this for the second. They are compatible.
Skill can live in position sizing, in instrument choice, in when to add, in
holding through drawdowns, none of which a follower inherits by copying a
single entry at market.

This is the second instrument to say the same thing. The feature stack found
that weighting flow by score added nothing over raw cohort lean, and this finds
that scoring the entries themselves adds nothing at 48 hours. Two independent
routes, one conclusion.

## Consequences

The long-hold lead stays unfiltered; there is no score cut that improves it, and
per the pre-registration no further decile cuts are tried on this window. It
also sharpens what the positioning factor is: not a skill-weighted signal, but a
measure of where cohort capital sits, which the signal stack already implied
when nothing beat raw lean.

The wallet scoring engine keeps its job of choosing who is in the cohort, which
is what its rank IC supports. It does not get promoted to weighting trades.
