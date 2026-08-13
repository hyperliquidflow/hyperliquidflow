# The public trades feed carries counterparty addresses

A data-availability result, not a strategy result. It came out of an external
review suggesting private data or order flow as the next step, and it changes
what this project can see. Measured, not read from documentation, because the
documentation is wrong on the decisive point.

## Provenance

- Probes: `scratchpad/ws-probe.mjs` and `scratchpad/ws-scale.mjs`, plain Node 25
  against `wss://api.hyperliquid.xyz/ws`, native WebSocket, no dependencies.
- Subscription: `{"method":"subscribe","subscription":{"type":"trades","coin":X}}`
- Run 1: 3 coins, 20s, 146 trades. Run 2: 15 coins, 30s, 586 trades.
- Date 2026-08-13.

## The finding

**Every public trade carries both counterparty addresses.** The Hyperliquid docs
state that the trades subscription "omits user addresses". That is false. All 146
trades in run 1 and all 586 in run 2 carried a populated `users` array of two
addresses. Verbatim sample:

```json
{"coin":"BTC","side":"B","px":"63236.0","sz":"0.00161","time":1786645182391,
 "hash":"0xdfb2...bc41","tid":287058895348210,
 "users":["0x89906c7a77e5639efb3564fb5ac3df6a60d49075",
          "0xa62b923a112d50d03e1e096bbd53422490dac104"]}
```

Fields present on every trade: `coin`, `side`, `px`, `sz`, `time`, `hash`, `tid`,
`users`. No liquidation flag on any of them.

## Scale, measured

| | 15 coins, 30s |
|---|---|
| trades | 586, 19.5 per second |
| raw payload | 161 KB, 5.3 KB/s |
| projected raw | 0.47 GB/day for these 15 coins |
| distinct addresses | 252 |
| addresses seen more than once | 56% |

Concentration is heavy and identifiable. The single busiest address took 21.3% of
all trades in the window, the top three 40.4%. Market makers are separable from
flow empirically, which matters because one of the six defects found on
2026-08-12 was a wallet pool that admitted market makers because trades and fills
are different units.

## What this does and does not unlock

**Does.** Exchange-wide flow at the address level, in real time. The current
cohort is roughly 500 wallets sampled once a day by a rotating batch. This is
every address that trades, as it trades. Anchoring a position with one
`clearinghouseState` REST call and then updating it from the WS gives live
positions for any address without polling, which the current architecture cannot
do at any wallet count.

**Does not.** Exchange-wide liquidations. `userEvents` and
`userNonFundingLedgerUpdates` do report liquidations, but both are **per-user**
subscriptions, so they require knowing the address in advance and subscribing per
address. The conclusion recorded when the liquidation heatmap was retired stands:
a market-wide liquidation map is not buildable from public Hyperliquid data. What
was too broad in that note was the implication that the coverage problem itself
was unsolvable. For positioning and flow it is solvable. For liquidations it is
not.

## What this does not prove

Nothing about edge. This says the data is obtainable, not that anything in it
predicts returns. Every hypothesis this project killed stays killed; a wider
telescope does not revive a measurement that failed. Any strategy built on this
feed needs its own pre-registration before its first run, per the standing rule.

The honest framing is that this raises the ceiling on what can be *described*,
which is the direction the product moved on 2026-08-13 anyway.

## Cost, unestimated

A persistent connection is required. GitHub Actions cron cannot hold one and the
daily scan pattern does not fit. Vercel functions support WebSockets now, but a
long-lived collector wants a persistent process, and 0.47 GB/day raw for 15 coins
implies real storage decisions before any of this is worth starting. That
estimate has not been done and should precede any build.
