# Pre-registration: the two surviving leads

Written 2026-08-12, BEFORE the funding-charged rerun, the 200-day extension, and
the forward shadow record. Both external reviews of the audit dossier flagged the
same gap: the recipes have a bar (30 outcomes, positive expectancy) and scoring
has a bar (IC 0.08), but the two actual candidates for money had no numeric bar
anywhere. This document is that bar.

Once committed, these thresholds follow the kill-criteria rule from
docs/preflight/kill-criteria.md: amendments require a new dated document written
BEFORE the run they apply to. "I changed my mind because results came in" is not
justification. A run reports pass or fail against the written bar, not against a
reframed one.

Status: DRAFT until the owner commits it. Numbers below are proposed defaults;
adjust them before the first run they govern, not after.

## Shared specification (applies to both leads)

**Cost model.** All returns net of:
1. Verified taker fee at the current Hyperliquid fee schedule (verify the actual
   tier before the run; do not assume 7 bps).
2. Slippage haircut of 5 bps per side on alt perps (10 bps round trip) until a
   depth-based model exists.
3. Actual historical funding, charged path-wise per coin-hour over the full hold,
   from the funding cache (already fetched by signal-stack; extend as needed).

**Statistics.**
1. Standard errors clustered BY DAY (not coin-day): alts are heavily correlated
   on the same day, and thirty coins on one falling afternoon are close to one
   observation.
2. Report mean, median, and 10% trimmed mean with bootstrap 95% intervals
   (resample days). A lead whose trimmed mean is not positive is a lottery
   ticket, not an edge, and fails regardless of its t.
3. Non-overlapping windows for any multi-day hold.
4. Pool membership frozen as of each evaluation window start (no wallet enters a
   window it was not discoverable before).

**Baselines (the alternative-explanation test).** Each lead must beat, or add to,
two dumb baselines on the same universe, window, and cost model:
- Momentum: sign of trailing 24h (and 72h) coin return, same holds.
- Positioning proxy: 24h open interest change (or volume impulse if OI history
  is unavailable), same holds.
"Add to" means: residual predictive power after regressing the lead's signal on
the baseline, residual IC at least 0.02 with day-clustered t at least 2.0. If a
dumb baseline replicates the lead, the wallet layer contributes nothing and the
lead fails in its wallet-following form (the baseline itself may become a new,
separately pre-registered candidate).

## Lead 1 (primary): positioning factor

Hypothesis: the cohort's net exposure level per coin, ranked cross-sectionally
each day, predicts next-day relative returns, and a long-short book built on it
has positive net expectancy.

**Backtest-extension gate (200-day cache, four sub-periods):**
- Full-window traded long-short mean, net of the full cost model including
  turnover on both legs: greater than 0 with day-clustered t at least 2.5.
- Same sign in at least 3 of 4 sub-periods.
- Survives both baselines per the shared spec.
- Trimmed-mean condition per the shared spec.

**Forward shadow gate (starts as soon as the daily snapshot job exists):**
- 60 calendar days of daily out-of-sample records, thresholds fixed now:
  net traded mean greater than 0, day-clustered t at least 1.5, sign consistent
  with the backtest, and no sub-period of 20 days worse than -30 bps/day mean.
- The shadow record is append-only and priced with the same cost model.

**Fail consequence:** the factor is dead in this form. No re-weighting, no new
lookbacks, no threshold search on the same cache. A materially different
hypothesis gets a new pre-registration.

## Lead 2 (secondary): long holds on activity-banded entry follows

Hypothesis: entering 10 minutes after a cohort wallet's entry on the banded pool
and holding 24 to 72 hours has positive net expectancy.

**Backtest-extension gate (200-day cache):**
- Non-overlapping windows, pool frozen per the shared spec, full cost model
  including path-wise funding over the hold.
- At the pre-chosen primary hold of 48h: net mean greater than 0 with
  day-clustered t at least 2.5, AND 24h and 72h agreeing in sign (the shape must
  survive, not one cell).
- Positive in at least 3 of 4 sub-periods at the primary hold.
- Survives both baselines per the shared spec (momentum is the expected killer
  here; if momentum explains it, this lead fails in its wallet form).
- Trimmed-mean condition per the shared spec.

**Fail consequence:** entry-following is dead at all holds (short holds are
already disproven), which closes the follow premise entirely.

## Funding-sign hypothesis (quarantined)

The sign-flipped funding feature (momentum reading, IC 0.0657 in-sample) was
chosen after seeing the data. It is recorded here as a hypothesis only. It may
be evaluated on the 200-day extension as a THIRD pre-registered candidate with
the same shared spec and the Lead 1 thresholds, but its in-sample number carries
zero evidential weight.

## Amendment 1 (2026-08-12 evening, before the 200-day run)

Written after the 120-day executioner screen and before the 200-day run it
governs, per the amendment rule above.

1. **Fee input verified:** base-tier taker is 4.5 bps per side (public fee
   schedule, checked 2026-08-12). The shared cost model's "verified taker fee"
   is 4.5 bps until an account with a better tier actually exists.
2. **Lead 1 leg width fixed ex ante at 5 per side** for the 200-day run. The
   120-day screen showed t rising with width in sample; choosing width after
   seeing 200-day results would be fitting. Five balances concentration
   against the 12-coin conviction universe.
3. **120-day screen outcome recorded:** both leads read below the 2.5
   confirmation bar (Lead 1 book t 1.51, Lead 2 t 2.0 at 48h) while surviving
   all falsification tests including 100%-coverage funding and momentum
   baselines. Bars unchanged. See
   [2026-08-12-executioner-run.md](2026-08-12-executioner-run.md).
4. **Liquidity filter fixed ex ante at $2M daily notional volume** for the
   200-day run, and for any live implementation. The capacity study put the
   unfiltered ceiling near $100k of book because the factor's thin names
   exhaust at $25k; the liquidity sweep
   ([2026-08-12-liquidity-tradeoff.md](2026-08-12-liquidity-tradeoff.md))
   showed the diagnostic survives filtering while the traded book gives up
   about a quarter of its return. Five thresholds were examined, so the choice
   is fixed now, before the 200-day data exists, rather than picked afterwards.
   Both the filtered and unfiltered books will be reported; the filtered one is
   the pre-registered candidate.

## Amendment 2 (2026-08-12 late, BEFORE the 200-day fetch completed)

The 200-day run is in flight and its role must be fixed before its results
exist, because the discovery bound makes it readable in only one direction.

Zero study-band wallets existed 200 days ago, so the window cannot be frozen
and survivorship contamination works **in the leads' favour**. Therefore:

- **A failure on the 200-day window counts as a kill.** If a lead cannot clear
  its bar even with survivorship helping it, the lead is dead.
- **A pass confirms nothing** and may not be cited as confirmation anywhere. It
  is recorded as "not killed by the contaminated window".

This asymmetry is the only reason the run is worth reading at all. It is
pre-committed here so that a pass cannot quietly be counted as evidence later.

## Amendment 3 (2026-08-12 late, BEFORE any forward data matures)

An external review found that the forward gate as written schedules a false
kill. The arithmetic is confirmed with `lib/power.ts` (15 tests), using the
standard one-sample model where an effect with daily Sharpe s reads t = s
times the square root of the number of days.

| Instrument | Observed | Expected t at 60d | Power vs t 1.5 at 60d | Days for 80% power at t 1.5 |
|---|---|---|---|---|
| Traded book | t 1.42 / 104d | 1.08 | **34%** | **283** |
| Diagnostic IC | t 3.17 / 104d | 2.41 | **82%** | 57 |

The traded book cannot be confirmed in 60 days. A bar of 1.5 rejects a real
edge about two times in three, and a bar of 2.5 rejects it nineteen times in
twenty. Only a bar of 0.24 would carry 80% power at day 60, which is not a
test. The reviewer assumed the forward bar was 2.5; it was 1.5, which is
better and still badly under-powered. The gate is therefore restaged, not
relaxed:

**Day 60 (the first checkpoint, powered):**
- Diagnostic IC must clear day-clustered **t 1.5** on the forward record. This
  carries 82% power and is a genuine test.
- The traded book is a **consistency check only** at this stage: same sign as
  the backtest and a positive 10% trimmed mean. It cannot pass or fail the
  lead by itself.
- Failing the IC bar at day 60 is a kill, because that instrument is powered.

**Day 283 (the traded confirmation, powered):**
- Traded book must clear day-clustered **t 1.5** net of the full cost model,
  which is 80% power against the current point estimate.
- Reaching day 283 requires the day-60 checkpoint to have passed.

Both horizons are fixed now. If the effect is larger than the point estimate
the bars clear sooner, and that is allowed; if it is smaller, no bar written
today would have found it, and that is the honest cost of a t 1.4 effect.

## Verdict states, and the expiry on "failed but alive"

The reviews correctly noted that a lead which fails its bar while surviving
falsification has no defined status, and an undefined status is how dead ideas
stay warm. The permitted states are:

- **Confirmed.** Cleared a powered forward bar. Only this state permits paper
  trading, and only paper trading permits an execution decision.
- **Failed but alive.** Below bar, above zero, no falsification test has killed
  it. **The only promotion path out of this state is the forward record. No
  historical rerun, no re-slice, and no new backtest window may promote a lead,
  ever.** Both current leads are in this state.
- **Dead.** Failed a powered bar, or a falsification test killed it, or a dumb
  baseline replicated it. Deleted, not tuned.

"Failed but alive" expires. If the forward record fails its powered bars at the
horizons above, the state resolves to dead with no further appeal.

## If both leads fail

The follow premise and the positioning premise are both dead. Per the dossier's
Section 13 and the kill criteria: a written decision between Path B (mechanical
flows, a larger build) and Path D (stop or hold), made from these documents, not
from memory. Stopping on evidence is a successful outcome.

## Order of execution (cheapest killer first)

1. Charge funding + slippage + verified fees into the EXISTING 120-day cache and
   recompute both leads with day-clustered errors and bootstrap intervals. Days
   of work, highest kill-power per hour. If a lead dies here, skip its 200-day run.
2. Run the two baselines on the same cache.
3. Start the forward shadow record for Lead 1 (the clock is free; every day not
   recording is a day added to every downstream gate).
4. Only for survivors: the 200-day fetch with frozen pools and four sub-periods.
5. Only after a full pass: server-side paper trading with the identical cost
   model, then the written execution decision.
