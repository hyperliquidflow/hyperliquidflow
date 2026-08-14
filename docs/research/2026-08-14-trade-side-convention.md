# The tape's `side` is the aggressor's, measured with no exceptions

Settles the item that has been on the "do not do until verified" list since the
WebSocket coverage work: whether signed per-address flow can be derived from the
trades feed. It cannot, and the same measurement establishes that signed
per-coin flow is sound.

Descriptive, so no pre-registration and no bar.

## Provenance

- Command: `npx tsx --env-file=.env.local scripts/verify-trade-side-convention.ts --seconds=45 --addresses=8`
- Code at commit `6a10cc8`, run 2026-08-14.
- 201 live trades on BTC, ETH and SOL, every one carrying two addresses, a hash
  and a `tid`.
- 8 most frequently seen addresses queried for their own fills via
  `userFillsByTime`, joined to the tape on `tid`.
- **131 joined fills.** Nothing was written.

## The method

A trade on the WS feed carries one `side` and a two-element `users` array, so the
side cannot belong to both. `userFillsByTime` returns an address's own fills,
each carrying that address's own `side` and a `crossed` flag that is true when
the address crossed the spread. Joining the two on `tid` compares what the tape
said against what the participant's own record says.

An earlier version joined on `(hash, coin, size)` and produced a noisy 2 of 17.
One hash covers several fills when an order crosses several resting orders, so
that key collided and the last write won. `tid` is unique per trade and the noise
disappeared entirely, which is itself the tell that the first join was broken
rather than the relationship being probabilistic.

## Result

| | side matches the tape | side is opposite |
|---|---|---|
| address crossed the spread | **21** | 0 |
| address rested | 0 | **110** |

Perfect separation on 131 fills. **`side` is the side of whoever crossed the
spread.**

Position in the `users` array explains nothing: users[0] matched 21 of 53 and
users[1] matched 0 of 78, and one address read 0 of 1 at index 0 and 0 of 10 at
index 1 in the same run.

Per address, the pattern is near-deterministic rather than statistical: 0/31,
0/27, 0/18, 0/12, 0/11, 0/10 for the resting addresses and 21/21 for the one
aggressor in the sample. Sampling the busiest addresses selects market makers,
which is why seven of eight are always passive.

## What follows

**Signed per-address flow stays blocked.** The trade object names both
counterparties and does not say which one crossed. No amount of tape resolves
this; it is missing information, not noise.

**Signed per-coin flow is sound and always was.** `flow_coin_minute` splits
notional by the trade's side, which is now known to be exactly aggressive buy
notional against aggressive sell notional. That is a standard order-flow
imbalance, it is measured exchange-wide, and it needs no address attribution.

**`flow_address_minute.side_b_notional` does not mean what its name suggests.**
It is notional this address participated in *while the aggressor was buying*, not
notional this address bought. As a column name it is a trap: any future reader
who takes it at face value derives a wrong direction for every maker in the
table. Recommended rename, deferred because the collector is running and the
readers would have to change with it:
`aggressor_b_notional` / `aggressor_a_notional`.

**A per-address direction is obtainable for a bounded set.** An address's own
fills carry its own side and its `crossed` flag, so a watchlist of known
addresses can have true signed flow. It is a per-user query, so it does not scale
to the exchange, the same shape as the liquidation limitation.

**One inference, recorded as a hypothesis and not used.** In a trade between a
classified market maker and an unclassified address, the maker is almost always
the resting side, so the other address is probably the aggressor. That would
recover direction for a large share of flow. It is a guess with a measurable
error rate and it has not been measured, so nothing here rests on it.
