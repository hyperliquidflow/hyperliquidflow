# Does the factor survive if it only trades names that can absorb size?

The capacity study put the ceiling near $100k of book because the factor leans
into coins whose order books exhaust at $25k. This prices the other side of
that trade: restrict the universe to liquid names and see what the edge does.

## Provenance

- Command: `npx tsx --env-file=.env.local scripts/positioning-factor.ts --cache=<archived 120d> --freeze-pool --legs=5 --min-volume=N`
- Same frozen 120-day cache, same full cost model, same 5 legs a side
- Liquidity is today's daily notional volume from `metaAndAssetCtxs`, cached to
  `volume-cache.json` so a sweep costs one API call
- Recorded approximation: today's volume is applied to a historical window.
  Liquidity rank is persistent and a live system would filter on current
  liquidity anyway, so this matches what an implementation would do, but it is
  not a point-in-time measurement.

## Result

| Min daily volume | Coins | IC | IC t | Book bps/day | Book t | Trimmed |
|---|---|---|---|---|---|---|
| none | 316 | 0.0653 | 3.17 | +39.0 | 1.42 | +38.4 |
| $1M | 55 | 0.0596 | 2.17 | +25.6 | 0.90 | +32.9 |
| $2M | 38 | 0.0650 | 2.28 | +29.4 | 1.03 | +40.7 |
| $5M | 20 | 0.0597 | 1.90 | +30.3 | 1.00 | +40.4 |
| $10M | 13 | 0.0330 | 0.91 | -38.5 | -1.00 | -27.1 |

## Reading

**The signal per coin is not concentrated in illiquid names.** The IC holds
near 0.06 from the unfiltered universe all the way down to a 20-coin book at
$5M. What falls is the t, and most of that fall is mechanical: a cross-sectional
rank correlation computed over 20 coins is noisier than one over 316, whatever
the underlying effect.

**The traded book gives up roughly a quarter of its return**, +39 to about +30
bps a day, which is the honest cost of not holding the most extreme leans. Those
extremes sit in thin names by construction, so this is the capacity trade priced
directly: a quarter of the edge for names that can absorb several times the
size.

**The 13-coin book at $10M is negative and not significant** (t -1.00). Two
readings are consistent with it and this window cannot separate them: the
majors are efficient enough that crowded positioning carries no information
there, or 13 coins is simply too thin a cross section to measure. The first is
the more plausible story and matches where inefficiency usually lives, but it
is a hypothesis, not a result.

## What this changes

The capacity ceiling is not a hard $100k. A $2M to $5M volume filter keeps 20 to
38 coins, preserves the diagnostic, costs about a quarter of the traded return,
and trades names with far more depth than STBL or RENDER. That is a better
starting point for any live implementation than the unfiltered factor.

It is not confirmed and must not be tuned further on this window: five
thresholds were tried, and picking the best one here would be fitting. The
honest next step is to fix one threshold ex ante for the 200-day run. **$2M is
the pre-registered choice**, on the grounds that it keeps the most coins while
clearing the depth problem, chosen before the 200-day data exists.
