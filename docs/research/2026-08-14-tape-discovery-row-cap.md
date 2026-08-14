# Defect eight: the population that would not grow

Found 2026-08-14, before the run it would have corrupted. No result was published
from the capped population, and the one preliminary reading taken on it
([2026-08-14-tape-skill-preliminary.md](2026-08-14-tape-skill-preliminary.md))
recorded no verdict for a different reason.

## The tell

The flow collector had run 21.6 hours instead of the 6 behind the previous draw,
so the eligible population was expected to be several times larger.
`scripts/tape-population.ts` reported **378 eligible addresses**, the same number
as before.

A sample that does not move when its source grows sixfold is a bug, not a
finding. This is the first rule under Measurement discipline in CLAUDE.md,
applied in the direction it is usually not: the count was suspicious for staying
still.

## The cause

```ts
const { data, error } = await supabase
  .from("flow_address_minute")
  .select("address, coin, minute, side_b_notional, side_a_notional")
  .limit(200_000);
```

PostgREST caps a response at 5,000 rows. It returns them with **no error and no
truncation flag**, so `data.length === 5000` is indistinguishable from a table
holding exactly 5,000 rows.

Measured directly:

| | |
|---|---|
| rows in `flow_address_minute` | 65,911 |
| rows the discovery query returned | **5,000** |
| span of the table | 2026-08-13T19:37 to 2026-08-14T17:11, 21.6h |
| span the query saw | 2026-08-13T19:37 to 22:08, **2.5h** |
| distinct addresses the query saw | 984 |

So tape discovery was drawing from the oldest 2.5 hours of the tape, one slice of
one evening, and every additional hour of collection was invisible to it.

The cap is not news to this project: it is recorded in the session memory from
the cohort skill baseline work. The code was written as though a client-side
`limit` were an instruction to the server rather than a request.

## The fix

Page with `.range()`, order explicitly, and log the count. The order clause is
load-bearing: without one PostgREST gives no ordering guarantee, so paging can
repeat or skip rows.

## What changed, on the same tape

| | capped | paged |
|---|---|---|
| address-minute rows read | 5,000 | 66,133 |
| observed minutes | 150 | 1,232 |
| distinct addresses | 984 | 6,059 |
| eligible at the $50k floor, makers excluded | **378** | **2,451** |

The population is 6.5 times larger. The previous draw of 378 was not a random
sample of Hyperliquid addresses above the floor; it was every such address that
happened to trade in one 2.5-hour window.

## What this does and does not invalidate

**The market-maker classification is unaffected**
([2026-08-14-market-maker-separation.md](2026-08-14-market-maker-separation.md)).
It was computed by a different route and its shape reproduces on the full window:

| class | doc, 692 minutes | recomputed, 1,232 minutes |
|---|---|---|
| A, persistent and broad | 3 addrs, 13.7 coins | 3 addrs, 14.3 coins |
| B, persistent | 36 addrs, 6.4 coins | 54 addrs, 6.2 coins |
| C, recurring | 892 addrs, 221 trades, 2.2 coins | 1,313 addrs, 213 trades, 2.1 coins |
| D, sporadic | 3,721 addrs, 18 trades | 4,689 addrs, 17 trades |

Class counts grow with the window, per-address averages hold. The exclusion rule
and the reasoning in
[2026-08-14-class-c-decision.md](2026-08-14-class-c-decision.md) stand on numbers
that survived the correction.

**The preliminary skill reading is superseded, not retracted.** It recorded no
verdict because it had 205 primary pairs against a designated 250. It now also
had the wrong population. Both reasons point the same way and neither permits a
claim.

## The general form, for the next reader

A silent cap looks like a stable result. The candle cap of 2026-08-11 made table
rows use different trades; this one made a population look settled while the
source grew around it. Both were found by comparing a count against a previous
run rather than by reading the number itself.
