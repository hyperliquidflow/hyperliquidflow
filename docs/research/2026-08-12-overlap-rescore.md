# Non-overlapping window re-score of the long-hold lead

First entry in the results register; recorded retroactively by the 2026-08-12 audit
because the run itself predates the register.

## Provenance

- Command: `npx tsx --env-file=.env.local scripts/fill-study.ts` (no --fetch; pure
  re-slice, writes nothing)
- Cache: `fill-study-cache.json`, fetched_at 2026-08-12T13:32:42.114Z, 120 days,
  1h interval, compacted, 58,307 hourly rows, 30 coins, 112 wallets, pool banded
  to 60-1000 trades (the scan's own activity window)
- Code: `main @ ded6d9d` (research session run) and the identical re-run by the
  2026-08-12 audit; `d6cd5aa` later verified the study-stats refactor reproduces
  this table row for row
- The two runs used the same code on the same cache: this match is a determinism
  check, not independent confirmation

## Why this run exists

The banded 120-day fill study reported long holds positive past 12h with t 3.9 at
48h and t 4.5 at 72h. Those windows overlap: consecutive entries on the same coin
inside a 72h hold share most of their price path, so the t-statistics overcount.
This re-score spaces entries at least one full hold apart per coin, so no two
observations share a price path.

## Result

Net of per-coin beta benchmark and 7 bps (two taker fees, no funding, no
slippage), entry 10 minutes after the cohort fill:

| Hold | n | mean bps | t | win% |
|---|---|---|---|---|
| 60m | 11,014 | -6.5 | -4.9 | 39% |
| 240m | 5,820 | -4.5 | -1.5 | 43% |
| 720m | 3,026 | +12.2 | 1.7 | 46% |
| 1440m | 1,898 | +32.5 | 2.6 | 48% |
| 2880m | 1,107 | +74.3 | 3.1 | 50% |
| 4320m | 793 | +87.5 | 2.6 | 51% |

Diagnostics for the same run: 17,445 episodes, 61% long, BTC -15.3% over the
window, 2,204 distinct coin-days. Point-in-time score deciles at 4h hold: flat,
all |t| below 1.6 (no support for follow-top or fade-bottom at short holds).

## Standing caveats (carried into pre-registration)

- Costs exclude funding and slippage; on 48-72h crowded alt holds funding alone
  can be tens of bps and typically charges the side the cohort leans toward.
- Pool drawn from today's performance-conditioned discovery table (survivorship).
- Clustering is by coin-day, not by day; cross-coin same-day correlation is not
  yet absorbed, so these t values are still generous.
- Win rates near 50% with positive means: right-tail payoff, mean not robust to
  trimming until shown otherwise.
- One 120-day window, one regime; the table sits inside a large tested family.
- Post-correction split-half was not run in this pass.
