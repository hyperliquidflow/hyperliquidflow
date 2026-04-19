# P0.2 Kill Criteria

Written 2026-04-19. Pre-committed abort conditions for each phase of the v2 remediation plan. These are immutable once work begins in Phase 1. If evidence triggers a kill condition, work stops. No negotiation, no "just one more sprint."

The purpose of writing these up front, in daylight, is to resist the sunk-cost pull that will inevitably build up as implementation progresses.

## Why this document exists

The v1 plan had 22 sprints of work and an open-ended productization phase, with no pre-committed stopping conditions. That is a recipe for pouring months of engineering effort into a validated-feeling system that never actually produces edge. V2 fixes that by naming, in advance, the measurements that would tell us to stop.

The binding principle: **the plan commits in advance to stopping if the evidence says to.** Disagreement with the evidence after the fact is not grounds for overriding a kill condition.

## Phase 1 kill: rank IC below MDIC

**Condition**: after 60 calendar days of production rank IC measurement, with at least 30 entries in `rank_ic_history`, the rolling 12-month-equivalent averaged rank IC is below **0.08** with p > 0.05.

**Action**: halt Phase 2. Revisit the core premise that whale-following on public Hyperliquid data produces exploitable alpha. Do not proceed to scoring rewrites, entity classifier training, or paper trader. These all assume a predictive signal exists; if rank IC cannot clear MDIC, there is nothing to predict.

**Fallback paths if triggered**:
1. Extend measurement to 45 snapshots (additional ~15 days) only if IC lands in [0.05, 0.08] inconclusive band. Not a loophole for negative results.
2. If still below threshold, consider the four directions from the audit appendix: a) intelligence product with no signal claims, b) B2B data API, c) sell to institutions raw, d) shut down.
3. Do not migrate to "just tweak the scoring formula and measure again." Tweaking the formula without a theoretical reason to expect improvement is tampering, not iteration.

**What does NOT trigger Phase 1 kill**:
- Rank IC above 0.08 but below 0.15. This is acceptable; 0.08 was chosen as the minimum-detectable threshold, not the target.
- Rank IC fluctuates below MDIC in individual snapshots but the rolling average is above. The rolling average is the decision variable.
- The MDIC changes after empirical recomputation of design effect (per P0.1 open items). Recompute and re-measure; do not retroactively kill or save.

## Phase 2 kill: rank IC regresses or OOCV diverges

Three conditions, ANY of which triggers kill:

**Condition 2a**: after Sprint 13 canary cutover, production rank IC declines by more than 25% relative to Phase 1 baseline over 30 days of measurement. (If Phase 1 baseline was 0.10, new IC below 0.075 triggers.)

**Condition 2b**: after Sprint 14 entity-filter deployment, cohort mortality curve gets worse (higher attrition at 90d/180d) AND rank IC does not improve. The filter was supposed to remove noise; if it does the opposite, the classifier is wrong, and redeploying it after more training data will not fix the underlying premise.

**Condition 2c**: out-of-cohort vs. in-cohort recipe stats diverge materially. "Materially" means: more than half of the 13 recipes show statistically different (95% CI non-overlapping) `expectancy_bps_net` between in-cohort and OOCV pools over 60 days. This means cohort selection is doing the work, not the recipes, and the recipe-base-rate EV decouple from Sprint 12 was theater.

**Action**: revert the offending change. Do not proceed to Phase 3. Phase 3 (paper trading) only makes sense if Phase 2 delivered a validated decoupled scoring layer.

**What does NOT trigger Phase 2 kill**:
- Pearson(ev_score, wallet.score) doesn't drop all the way to 0.2. If it lands in 0.4 to 0.6 range, the decouple is partial but not failing. Take it and move on.
- Individual recipes underperform OOCV. Some recipes may genuinely be weaker on OOCV and that's useful signal (either fix or kill that specific recipe). Half or more of recipes diverging is the trigger, not one or two.

## Phase 3 kill: paper trader underperforms benchmarks

Two conditions, EITHER triggers kill:

**Condition 3a**: `all_signals` paper trader config experiences peak-to-trough drawdown exceeding 30% at any point during the 90-day walk-forward window.

**Condition 3b**: at the 90-day mark, `all_signals` net-of-realistic-costs equity underperforms `random_cohort_risk_matched` benchmark, OR underperforms `btc_hold` benchmark, after burn-in of first 14 days (exclude initial position ramp volatility).

**Action**: halt Phase 4 (architecture and recipe upgrades). The premise that curated whale-following beats naive exposure has been empirically refuted at the scale and latency this system can actually operate at. Building WebSocket infrastructure and per-coin regime on top of a losing base is pouring money into a leaky bucket.

**Fallback paths if triggered**:
1. Pivot to pure B2B data / intelligence product. Analytics, not alpha claims. Different business model, different positioning, P0.4 unit economics need redo.
2. Shut down.

**What does NOT trigger Phase 3 kill**:
- Individual configs (`high_ev_only`, `top_wallets_only`) underperform. They are hypothesis-test configs, not the product. Only `all_signals` must clear the bar.
- Temporary underperformance during the 14-day burn-in window.
- `all_signals` beats `random_cohort_risk_matched` but loses to `btc_hold` in a strong BTC bull run. Acceptable if the Sharpe-adjusted comparison favors `all_signals` and the loss is regime-specific, not persistent.

## Phase 5 kill: unit economics fail at midpoint

**Condition**: at any point during Phase 5 productization, monthly unit economics review shows CAC above P0.4 midpoint OR monthly churn above P0.4 midpoint, sustained for 2 consecutive months.

**Action**: halt new-user acquisition spend. Stop the paid channel. Do not raise or reallocate marketing budget to fight the churn; this is what "burning cash on a leaky bucket" looks like. Return to ICP (ideal customer profile) research, re-underwrite the pricing and positioning, and only resume spend after the leak is identified and fixed.

**Condition 5b**: Phase 3 did not clear its gate. Do not launch a paid product regardless of how polished the UI is.

## Mechanics

- All measurements documented in checked-in `docs/phase-N-results.md` files. Kill conditions triggered from those numbers, not from memory or intuition.
- Kill criteria are reviewed at phase boundaries only, not mid-sprint. Mid-sprint panics do not trigger kills; neither does a single bad IC snapshot.
- If MDIC changes due to empirical recomputation (per P0.1), Phase 1 kill threshold updates to the new MDIC. The methodology is fixed; the number can move.
- Amendments to these criteria require writing a new document, versioned, dated, and justifying the change based on information unavailable at 2026-04-19. "I changed my mind because results came in" is not justification.

## The honest outcome

Most likely case given base rates for this kind of project: Phase 1 or Phase 3 kill triggers. That is a successful outcome of this document. It means the measurement layer worked and told us the premise is weaker than hoped before we sunk another year of development into it.

The successful-outcome state is not "every phase clears." The successful-outcome state is "we learned what is real within 6-9 months, spent at most that much effort on it, and either built something that passes honest scrutiny or stopped before it ate more time." Either is a win relative to v1 where the plan had no termination condition at all.
