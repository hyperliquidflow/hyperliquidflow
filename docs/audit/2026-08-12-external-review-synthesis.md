# External review synthesis, 2026-08-12

The v1.1 audit dossier was reviewed by two independent frontier models (Grok and
a second Claude reviewing cold). Both returned the same overall verdict: the
measurement instrument is trustworthy and the verdicts are directionally right,
but the two surviving leads have not yet faced their most probable killers, and
those killers are also the cheapest tests available. This file deduplicates both
reviews into what is genuinely new, what was already known, and the revised order
of work. Full review texts are in the owner's conversation record.

## New attacks neither the dossier nor the project had run

1. **No baseline comparison (the alternative-explanation test).** Nobody asked
   whether the long-hold lead is just alt momentum wearing a wallet costume, or
   whether cohort lean just proxies open-interest change. The quiet evidence
   points that way: skill-weighting adds nothing over raw lean, and the skill IC
   is thin. If a dumb rule replicates the lead on the same universe and costs,
   the entire wallet layer contributes nothing to the money goal. This also
   supplies the missing mechanism story: momentum as the true driver would
   reconcile why entries fail short-hold, coordination is empty, and yet 48-72h
   follows pay. Baselines are now mandatory in the pre-registration.
2. **Day-level clustering.** Coin-day clustering fixes within-coin correlation
   but not cross-coin: alts are 60-80% correlated on a given day. Clustering by
   day will shrink the effective sample below 2,403 and could pull the long-hold
   t of 2.6-3.1 under 2 by itself. All future stats cluster by day.
3. **Tail-dependence of the means.** Win rates near 50% with strongly positive
   means: the return lives in a right tail, t assumes a well-behaved mean, and
   the practical edge depends on catching a handful of big winners. Bootstrap
   intervals, medians, and trimmed means are now required outputs; a lead whose
   trimmed mean is not positive fails.
4. **The 200-day plan is not out-of-sample.** Extending the same cache backward
   on the same venue with the same performance-conditioned pool is a bigger
   backtest. True OOS is forward data: a pre-registered daily shadow record of
   the positioning factor, started now, with thresholds written before the first
   row. Doubles as the seed of the 90-day published track record Path C needs.
5. **Success-case arithmetic is missing.** Even a surviving factor at ~20 bps/day
   net on a book capped by thin alt-perp depth is likely low-six-figures
   capacity, and the honest timeline to a first validated dollar runs through
   funding-charged confirmation, a 60-90 day forward record, server paper
   trading, and an execution build: Q1 2027, not this autumn. One afternoon of
   expected-value math against owner hours may reroute effort toward Path C or B
   and should happen this week, not after the confirmation runs.
6. **The cache has never been validated against the exchange.** The twice-run
   match was a determinism check. Spot-audit a random sample of cached fills and
   candles against fresh API pulls before the next round of conclusions.
7. **Verify the actual fee tier.** The 7 bps assumption is unverified; the whole
   edge lives inside that margin. Check the current Hyperliquid fee schedule.
8. **Standing cohort invariants.** Two cohort-selection defects surfaced in one
   48-hour window; the honest inference is more exist. Add invariant checks on
   cohort composition (funded fraction, deactivation-reason distribution, equity
   totals) that alert on drift, so the next defect is caught by a machine.
9. **Verify live poller latency.** Research assumes fills observed 10 minutes
   late; confirm the live poller achieves that for 59 wallets under real rate
   limits, or the latency kill-criterion measures nothing.

## Emphasis shifts on known items

- **Funding cost is the number one threat** to the long-hold lead (both
  reviewers, independently). Hourly settlement, 10-50 bps/day on the crowded
  side, and cohort lean IS the crowded side. Charging real historical funding
  into the existing 120-day cache has more kill-power per hour than any other
  work, including the 200-day fetch. It runs first.
- **CI moves from P1 to P0.** Everything now rests on lib/study-stats.ts; a
  silent regression there corrupts every future verdict. (Shipped 2026-08-12:
  .github/workflows/ci.yml runs typecheck, lint, and all 523 tests on push.)
- **Entry-copy recipes get zero attention.** Let the 30-outcome gates fill on
  their own; the 2,403-coin-day research verdict already outranks anything 30
  graded rows can say. Do not loosen gates to manufacture coordination events.
- **Exit re-cut waits for OOS.** Live 1 ATR exits and a 24-72h edge cannot
  coexist, but re-cutting before out-of-sample confirmation would be fitting
  the live system to an unproven number.
- **Positioning factor outranks the long-hold lead**: two computational paths
  agree, the daily IC series is already day-clustered by construction, and
  holdings amortize costs that timing bets pay repeatedly.

## What both reviewers endorsed unchanged

The five dossier verdicts, the kill-criteria governance, the security posture,
the defect ledger as the project's most valuable asset, Path A as the only path
currently worth owner attention, and stopping as a legitimate successful outcome.

## Revised order of work (supersedes the dossier's Section 14 ordering)

This week, in order:
1. Charge verified fees + slippage + path-wise historical funding into the
   existing 120-day cache; recompute both leads with day-clustered errors,
   bootstrap intervals, and trimmed means. (Pre-registration item 1.)
2. Run the momentum and OI-change baselines on the same cache. (Item 2.)
3. Start the forward shadow record for the positioning factor. (Item 3.)
4. Success-case arithmetic: one afternoon, written into docs/research/.
5. Spot-audit the cache against fresh API pulls; verify the fee tier; verify
   poller latency.
6. Done 2026-08-12: CI gate, .env.example completed, results register created,
   pre-registration drafted (needs owner commit to become binding).

Then, only for survivors: the 200-day fetch with frozen pools and four
sub-periods; then server-side paper trading with the identical cost model; then
the written execution decision. If both leads die: the written Path B vs Path D
decision, per the kill criteria.
