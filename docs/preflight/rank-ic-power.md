# P0.1 Rank IC Power Analysis

Written 2026-04-19. Output of pre-flight exercise P0.1 from the v2 remediation plan.

## Purpose

Determine the minimum detectable rank Information Coefficient (MDIC) for the HyperliquidFLOW cohort given realistic sample structure. This replaces the arbitrary 0.05 threshold that was borrowed from equity quant literature and applied without checking if our setup supports it.

Everything downstream of this document (the Phase 1 kill criterion, the ranking dashboard, the cutover decisions in Sprint 13) depends on the MDIC number landing here.

## Setup assumptions

- **Cohort size N**: ~500 active wallets per measurement period.
- **Measurement horizon**: score at time T, realized return from T to T+30 days.
- **Measurement cadence**: one cross-section per day, but daily cross-sections are heavily autocorrelated. Effective independent periods per year are closer to the number of non-overlapping 30-day windows, so ~12 per year.
- **Statistic**: Spearman rank correlation between `score_at_T` and `realized_return_T_to_T+30`.
- **Target**: two-sided test at alpha = 0.05, power = 0.80.

## Naive independent-observation result

For independent pairs, the approximate sampling standard error of Spearman rho is `SE ~= 1 / sqrt(N - 1)`.

At N = 500, SE = 1/sqrt(499) = 0.0448.

- Critical value for two-sided alpha=0.05: `1.96 * SE = 0.088`. Any observed IC whose absolute value is at least 0.088 is "significantly different from zero."
- Minimum detectable effect at power=0.80: `(1.96 + 0.84) * SE = 2.80 * SE = 0.125`.

So if the 500 wallets were statistically independent, a true IC of 0.125 would be detectable 80% of the time.

**This is the optimistic bound. Reality is worse.**

## Clustering adjustments

Two clustering effects shrink the effective sample size.

### Cross-sectional clustering (coin overlap)

Wallets trading the same coins in the same regime co-move. If a BULL month lifts everyone long ETH, those wallets' 30-day returns are not independent. A standard design-effect correction applies:

`N_eff = N / (1 + (m - 1) * rho_ic)`

where `m` is the average cluster size and `rho_ic` is the intra-cluster correlation. For Hyperliquid cohorts, empirically:
- Top 5 coins (BTC, ETH, SOL, HYPE, ARB-class) dominate 60-75% of cohort notional.
- Reasonable estimate: effective cluster count is 5 to 10, average cluster size 50 to 100, intra-cluster correlation in realized returns around 0.15 to 0.25.

Design effect in the 2x to 3x range. Effective N drops to 170-250.

### Temporal clustering (regime autocorrelation)

Monthly cross-sections are not iid either. A sustained BULL regime means three consecutive monthly measurements sample nearly the same conditional distribution. If we treat 12 monthly measurements per year as 4 to 6 effective "independent regime samples," meta-analysis across them tightens our composite estimate but the per-snapshot IC measurement remains noisy.

## Adjusted MDIC

Combining both effects with central-tendency assumptions:

| Scenario | Effective N per snapshot | SE | MDIC (power 0.80) |
|---|---|---|---|
| Independent (naive) | 500 | 0.0448 | 0.125 |
| Moderate clustering (design effect 2x) | 250 | 0.0633 | 0.177 |
| Heavy clustering (design effect 3x) | 167 | 0.0775 | 0.217 |

Per-snapshot MDIC is in the **0.18 to 0.22 range** under realistic clustering. At N=500 raw, we cannot reliably resolve a true IC below roughly 0.2 in any single monthly cross-section.

### Meta-analysis across 12 monthly snapshots

Treating 12 snapshots as 6 effectively-independent regime samples (conservative), and averaging IC estimates:

- SE of averaged IC = SE_per_snapshot / sqrt(6).
- At SE_per_snapshot = 0.075, averaged SE = 0.031.
- Critical value for alpha=0.05: `1.96 * 0.031 = 0.060`.
- MDIC at power=0.80: `2.80 * 0.031 = 0.086`.

After 12 months of measurement with 6 effective independent regime periods, a rolling average IC of around **0.09** is the realistic detection floor.

If we are less conservative (treat 12 snapshots as 8 effective periods), MDIC pulls down to ~0.075. If we are more conservative (4 effective periods), MDIC climbs to ~0.105.

## Decision rule

**Phase 1 kill threshold: rolling 12-month averaged rank IC below 0.08, with p > 0.05, after at least 30 snapshot measurements.**

Rationale:
- 0.08 sits in the middle of the realistic-conservative MDIC band.
- Requires both statistical significance and effect-size-above-noise, not one or the other.
- Horizon of 30+ snapshots ensures we have traversed at least one regime shift and have enough meta-analytic weight to distinguish signal from noise.

If after 30 snapshots the rolling IC lands somewhere in [0.05, 0.08], treat as inconclusive: extend measurement to 45 snapshots before deciding. Do not fight the evidence to keep the project alive.

## What this means for Phase 1

- The `simple-statistics` Spearman output alone is not enough. `scripts/rank-ic.ts` must also compute effective sample size via the clustering adjustment, store it in `rank_ic_history.effective_sample_size`, and compute p-values off the effective N, not raw N.
- The `/performance/ranking` page should overlay the MDIC line (0.08) on the rolling IC chart. An IC that sits visibly below MDIC for months is the honest signal to stop.
- If real-world observations suggest the design effect is larger than 3x (e.g., >80% of cohort runs the same 3 coins), recompute MDIC. The number is not sacred, the methodology is.

## Open items

- Actual design effect is an empirical quantity. After Phase 1 Sprint 8 (attrition + position data), compute the real cross-sectional correlation of 30-day returns within-cluster and update MDIC.
- If Hyperliquid adds new perps or the cohort diversifies into tokens beyond the current top-10, MDIC improves. Recompute annually or after any major exchange listing event.
