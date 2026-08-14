# Separating market makers from the tape

Step 3 of the tape program, arrived at early because it turned out to be a
confound on Step 1 rather than a separate task.

Defect six of 2026-08-12 was a wallet pool that admitted market makers because
trades and fills are different units. That defect was worked around, never fixed
at the source. This fixes it at the source, and records the rule so every later
study can exclude the same way.

## Provenance

- Source: `flow_address_minute`, written by `scripts/flow-collector.ts`.
- Window: 4,652 distinct addresses over 692 observed minutes, 30 coins,
  collected 2026-08-13 into 2026-08-14.
- Queried directly against Supabase. No cache, no intermediate file.

## The signal that does not work, and why it matters

**Two-sidedness cannot be computed from this data.** A market maker quotes both
sides, so the natural test is whether an address buys and sells inside the same
minute. It fails here: a trade carries **one** `side` field and a two-element
`users` array, and both counterparties inherit that single side. An address that
took one side of every trade it ever appeared in still reads as two-sided.

Run anyway, the metric produced a bucket of 104 "maker-like" addresses averaging
**two minutes** of activity across 1.1 coins. That is a one-off trader. The
classification was discarded, not published.

This is the unverified-aggressor caveat in migration 027 biting in practice.
Confirming the convention against `userFillsByTime` for a known address remains
open, and until it is done, no signed per-address flow may be derived.

## The classification that does work

Persistence and breadth survive the limitation, because neither depends on
knowing which counterparty was the aggressor.

| class | rule | addrs | avg mins | avg coins | avg trades | % of flow |
|---|---|---|---|---|---|---|
| A, persistent and broad | in ≥50% of minutes and ≥3 coins | **3** | 692 | 13.7 | **12,828** | 8.6% |
| B, persistent | in ≥20% of minutes | 36 | 304 | 6.4 | 2,611 | 18.2% |
| C, recurring | active ≥5 minutes | 892 | 23 | 2.2 | 221 | 57.1% |
| D, sporadic | 1 to 4 minutes | 3,721 | 2 | 1.2 | 18 | 16.2% |

Three addresses run roughly 18 trades a minute across 13.7 coins, continuously,
for the whole observed window. Classes A and B together are 39 addresses and
26.8% of all flow.

## The rule, for reuse

**Exclude an address when it appears in at least 20% of observed minutes AND
trades at least 3 distinct coins.** Implemented as the default in
`scripts/tape-population.ts` via `--max-minute-share` and `--max-coins`.

The threshold is a judgement, not a measurement. It is recorded here so a later
study can vary it deliberately rather than rediscover it.

## Why this was blocking Step 1

The Step 1 population was the **top 300 addresses by notional**, which is a
market-maker filter in reverse:

| class | in top 300 | avg trades |
|---|---|---|
| A | 3 | 12,828 |
| B | 36 | 2,611 |
| C | 213 | 555 |
| D | 48 | 181 |

13% maker-like, 71% recurring high-frequency averaging 555 trades in six hours.

The wallet score reads Sharpe, consistency and drawdown off daily realised PnL.
Given a market maker it sees a smooth, consistently profitable series and scores
it highly, correctly, but what it has detected is a business model rather than
transferable skill. A skill-persistence test on that population answers "do
market makers keep making money", which needs no test.

This is the most likely explanation for the preliminary Step 1 read of IC 0.30
against a published 0.0939 on 48 pairs. That run was not filed as a result and
this entry does not rehabilitate it.

## Consequence

Selection in `tape-population.ts` is now a seeded random draw among eligible
addresses rather than a notional ranking, with makers excluded by the rule above.
Step 1 reruns on that population against the primary statistic and 250-pair
minimum designated beforehand in the tape program.

## Open

Whether classes C and D are separable further, and whether the exclusion should
extend to C, whose 555 trades in six hours is not discretionary trading either.
Deliberately not decided here: changing it after seeing a Step 1 result would be
choosing a population by its answer.
