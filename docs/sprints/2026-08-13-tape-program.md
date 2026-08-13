# The tape program: what gets tested, in what order, and what kills what

Written 2026-08-13, after the WS trades feed turned out to carry both
counterparty addresses. This is the plan to work through. Each step is ordered by
how fast it can kill something, not by how interesting it is, per the standing
rule from the external reviews: cheapest killer first.

## Why this program exists

Every wallet this project has ever studied entered its universe through the
Hyperliquid leaderboard, which ranks by realised PnL. A wallet was known to us
**because it had already won**. That is a sample selected on the outcome we were
trying to measure, and it sits under every number in `docs/research/`. It is why
`--freeze-pool` exists and why no clean window can predate 2026-04-11.

Tape discovery removes that conditioning. An address appears because it traded.

**It is not bias free and no entry may claim otherwise.** A wallet that blew up
and stopped trading never appears on today's tape. That is survivorship of
*activity*, which is far weaker than survivorship of *performance*, but it is not
zero and it belongs in the limitations of every result below.

**This is a better telescope, not a new sky.** It raises confidence in what comes
next. It promises nothing about the answer, and it revives no dead hypothesis.
The six killed on the 200-day run stay killed unless re-measured here, and a
re-measurement is a new run needing its own pre-registration.

## Step 1: does wallet skill survive an unbiased sample?

**The one hypothesis still standing is rank IC 0.0939, and it has never been
measured on a population that was not pre-selected on winning.**

Method: split each tape-discovered wallet's history in half, score on the first
half, rank-correlate against realised performance in the second. This is
`scripts/cohort-skill-test.ts` pointed at a population it has never seen.

No pre-registration required: this re-measures an existing published statistic on
a cleaner sample. The bar is the one already on the books, **IC above 0.08 (MDIC)
with a day-clustered t above 2**.

- **Survives** and it is the first genuinely clean positive result this project
  has produced. Everything downstream inherits real footing.
- **Fails** and the last standing hypothesis is dead. The smart-money premise
  closes, and the owner decision between Path B and Path D resolves toward D.

Either outcome is worth more than another month of collection. Run it first.

## Step 2: the base rate nobody knows

What fraction of active Hyperliquid addresses are profitable over 30 days?

No study in `docs/research/` can answer this, because the sample was always
pre-selected on winning. The number decides whether "find the good ones" is even
a coherent problem. If 8% are profitable, selection is a real task. If 45% are,
the category is close to meaningless and Step 1's result needs re-reading in that
light.

Descriptive, so no bar and no pre-registration. Report the distribution, not a
headline.

## Step 3: separate the market makers

One address took 21.3% of the tape in a 30-second window and the top three took
40.4%. Defect six of 2026-08-12 was a wallet pool that admitted market makers
because trades and fills are different units, and that defect has never been
fixed at the source, only worked around.

Now they are identifiable by behaviour rather than by a guessed threshold:
two-sided flow in the same coin-minute, inventory that mean-reverts rather than
trends, and a trade count far above the population.

Output is a classification, checked into the register with its rule written out,
so every later study can exclude them the same way.

## Step 4: flow toxicity, and the first thing that is not a prediction problem

Only reachable after Step 3.

When address X trades, does the price move against its counterparty over the next
N minutes? That is a classification question, not a forecast, and it is how market
makers actually earn: pricing the flow they take, not predicting where price goes.

Everything this project has killed was a directional prediction hypothesis. This
is the first candidate that is structurally different, which is the only reason it
is worth attempting after that record.

**Requires a pre-registration written before the first run**, with the bar fixed
in advance, per the standing rule. Nothing about this step may be run on a bar
chosen after seeing output.

## What is needed before any of it

The flow collector must run continuously. It is a persistent process; the GitHub
Actions cron cannot hold a socket and the daily scan pattern does not fit. Until
it has a host, the discovered population is only as wide as the minutes it
happened to be up.

Roughly a day of tape makes Step 1 worth running. Steps 2 and 3 improve with more.

## Rules carried in from everything that went wrong before

1. Compare row counts against the previous run. A large unexplained drop is a bug,
   not a finding.
2. Every row of a table uses the same sample.
3. Collapse correlated observations before computing t. Fills cluster in a wallet,
   wallets cluster in a coin-day.
4. Subtract a benchmark. A long-biased population in a drifting market shows beta
   as alpha.
5. Split-half anything promising.
6. Never rank by a score computed from the window being measured.
7. A result not filed in `docs/research/` does not exist.
8. Combining instruments only helps when they fail differently. Seven features
   equal-weighted gave a combined IC of 0.0006, worse than the best component,
   because three of the seven were the same feature. Check the correlation matrix
   before stacking anything.
