# Cache fidelity: the cache is what the exchange says

An external review noted that every number this project has published is
computed from one cache file, and that file had never been checked against the
API it came from. The twice-run reproduction of the overlap correction proved
determinism, which is a weaker claim than it sounds: two runs agreeing with each
other says nothing about either agreeing with reality, and a cache built from a
truncated or misaligned fetch would reproduce perfectly and be wrong the same
way both times.

## Method

`scripts/cache-audit.ts` re-fetches candles straight from the exchange for a
deterministic sample of coins and compares them bar by bar against the cache.
It audits the middle half of each coin's span, because the edges are where a
partial or truncated bar legitimately differs and would mask a real fault. A
cached bar the exchange no longer reports is the failure that matters: it means
a trade was priced against something that did not happen.

## Result, 2026-08-13, archived 120-day cache

| coin | bars in window | identical | different | absent live |
|---|---|---|---|---|
| AAVE | 1441 | 1441 | 0 | 0 |
| HYPE | 1441 | 1441 | 0 | 0 |
| TAO | 1441 | 1441 | 0 | 0 |
| ZEC | 1441 | 1441 | 0 | 0 |
| xyz:DRAM | 1200 | 1200 | 0 | 0 |
| xyz:SMSN | 1441 | 1441 | 0 | 0 |

**8,405 bars checked, 8,405 identical, worst relative price difference 0.**

The cache agrees with the exchange exactly, to the last digit, on every bar
sampled. The prices behind every result filed in this register are the prices
the exchange reports.

## Scope, stated honestly

Six of thirty coins, the middle half of each span, closes only. It does not
audit fills, which are compacted to hourly rows and would need aggregate
comparison rather than row matching, and it does not prove the pool selection
or the funding series. Those remain unaudited. What it does establish is that
the price series every return in this project is computed from is faithful.

## Related item closed in the same pass

The reviews asked for confirmation that the empty-secret bug was fixed
everywhere rather than in one place. It was a single defect in `optionalEnv` in
`lib/env.ts`, and `HYPERLIQUID_API_URL` has exactly one consumer,
`lib/hyperliquid-api-client.ts`, which imports it from there. Every script and
workflow reaches the API through that client, so the one fix covers all three
workflows that pass the secret. Four regression tests cover absent, empty,
whitespace and present.
