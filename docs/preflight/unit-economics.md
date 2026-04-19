# P0.4 Unit Economics Model

Written 2026-04-19. Pre-flight unit economics for the HyperliquidFLOW productization phase. Three scenarios: downside, midpoint, upside. The plan's Phase 5 is gated on midpoint holding up in reality.

## Why this document exists

V1 of the remediation plan had top-line revenue math (2,000 users x $49/mo = $1.2M ARR) with no unit economics. That is the kind of number that sounds good in a deck and dies in production when CAC climbs to $200 on a $49/mo product with 20% monthly churn. This document puts the unsoftened numbers on the table before we spend a dollar acquiring a paying user.

## Model inputs

All scenarios assume a tiered SaaS product:
- **Free**: directional dashboard, lagged signals, aggregate performance.
- **Pro** at $49/mo: real-time signals, push notifications, full cohort visibility.
- **Institutional** at $499/mo: B2B API, raw data access, SLA.

The Pro tier carries the model. Institutional is low-volume, gravy on top. Model ignores Institutional for the base case; treat any Institutional revenue as upside.

Crypto-SaaS baselines used below come from public churn/CAC reports for similar retail-facing crypto analytics products (Nansen, Arkham peers). These are rule-of-thumb, not precise benchmarks for Hyperliquid specifically. Revise with real data after month 3.

## Scenario table

| Metric | Downside | Midpoint | Upside |
|---|---|---|---|
| Blended CAC | $180 | $90 | $40 |
| Monthly churn rate | 25% | 18% | 10% |
| Average subscription life | 4.0 months | 5.6 months | 10.0 months |
| Gross margin (net of payments, infra) | 82% | 85% | 88% |
| Monthly revenue per user (Pro) | $49 | $49 | $49 |
| LTV gross | $196 | $274 | $490 |
| LTV net of gross margin | $161 | $233 | $431 |
| LTV / CAC ratio | 0.89 | 2.6 | 10.8 |
| CAC payback period (months) | 4.5 | 2.2 | 1.0 |
| Verdict | **Unviable** | Workable | Great |

### Why the downside kills you

At 25% monthly churn and $180 CAC, LTV/CAC is below 1. Every paying user acquired loses money over their lifetime. No volume of marketing spend makes this work; it just accelerates the cash-out. Monthly CAC payback at 4.5 months with average life of 4 months means you never break even on the cohort you acquired. This is the scenario the plan must avoid, not the one to optimize around.

### Why the midpoint works (barely)

LTV/CAC of 2.6 is below the SaaS rule-of-thumb of 3.0 but is survivable in a lean operation. CAC payback of 2.2 months keeps working capital requirements modest. At 18% monthly churn, a user base stays flat if ~18% of current base is replaced per month. At 2,000 users (the v1 target), that is ~360 new users/month needed just to stay flat, or 4,320/year of gross adds for a 2,000 net base. At $90 blended CAC that is $390K/year in acquisition cost, against $1.18M gross ARR or $1.00M net.

### Why the upside is upside, not base case

10% monthly churn is best-in-class retail SaaS. Hitting that on a crypto product targeting active traders is aspirational, not plannable. Plan for midpoint, celebrate if upside materializes.

## User counts required for target ARR

Steady-state math: to sustain N paying users at monthly churn rate c, you need `N * c` new acquisitions per month. Cumulative new acquisitions over T months to maintain N users for T months is roughly `N + N * c * T`.

| Target ARR | Users needed | Downside (25% churn) monthly gross adds | Midpoint (18% churn) monthly gross adds | Upside (10% churn) monthly gross adds |
|---|---|---|---|---|
| $250K | 425 | 106/mo | 77/mo | 43/mo |
| $500K | 850 | 213/mo | 153/mo | 85/mo |
| $1M | 1,700 | 425/mo | 306/mo | 170/mo |
| $1.5M | 2,550 | 638/mo | 459/mo | 255/mo |

### First 12 months cumulative acquisition required

To reach 1,000 Pro users by month 12 at midpoint (18% churn), cumulative gross acquisitions needed ~ `1,000 + sum over 12 months of intra-month churn on growing base` ~ **3,400 gross signups** over the year. At $90 CAC, that is **$306K in acquisition spend** in year 1. At 5% free-to-paid conversion (charitable for a crypto product), that requires **~68,000 free signups** over the year.

That is a distribution problem. Organic Twitter/Telegram alone will not deliver it. The model requires at minimum a content engine plus some paid channel (likely paid social + influencer) plus referral mechanics.

## Channel mix assumptions

Midpoint $90 blended CAC presumes:

| Channel | Share of acquisitions | CAC | Scalable? |
|---|---|---|---|
| Organic (content, SEO, Twitter) | 35% | $0 | No, saturates quickly |
| Referral (paid referrers at $20/signup) | 25% | $40 | Partially |
| Paid social (Twitter/X ads) | 25% | $150 | Yes, scales with spend |
| Influencer / KOL | 15% | $200 | Semi |

Blended: `0.35*0 + 0.25*40 + 0.25*150 + 0.15*200 = 77.5`. Round up to $90 for operational overhead and testing waste.

If organic share drops below 30% (saturation or algorithm shift) or paid-social CAC rises above $200 (increased competition), blended CAC moves toward downside. Monitor monthly.

## Payback and cash flow

At midpoint: CAC payback 2.2 months, average subscription life 5.6 months.

That means the typical paid user pays back CAC, generates roughly 3.4 months of contribution margin ($49 * 0.85 * 3.4 ~ $142), then churns. Each successful acquisition is a $142 net contribution, which accrues over ~4 months post-acquisition.

Cash flow implications for Phase 5 ramp:
- Month 1 of Phase 5: spend $28K acquisition ($90 * 306 gross adds) for no recoupable revenue (CAC payback is 2.2 months ahead).
- Months 1-3: cumulative spend ~$84K, cumulative recoup ~$15K. Net outflow ~$70K.
- Break-even to contribution-positive around month 6-7, assuming churn holds at 18%.
- Cash requirement to self-fund Phase 5 ramp: at least $150K of working capital to weather the ramp curve before contribution positive.

If that working capital does not exist, Phase 5 needs external funding or must start much smaller (target 300-500 users, not 1,000-2,000).

## Triggers that move you toward downside

Monitor monthly in Phase 5. Any of these moving the wrong way for two consecutive months = kill per P0.2 Phase 5 criterion.

- Blended CAC rising above $120 (20% above midpoint).
- Monthly churn exceeding 22% (4pp above midpoint).
- LTV/CAC falling below 1.8.
- CAC payback exceeding 3.5 months.

## Triggers that move you toward upside

Celebrate but do not over-extrapolate on a single good month.

- Organic channel share above 45% sustained.
- Referral program mechanics working (referrers bringing >1 paid user each on average).
- Month-over-month churn declining after month 6 (signals product-market fit with retained users).

## What this means for Phase 5

- Do not launch paid acquisition until product is demonstrably beating Phase 3 benchmarks and the published performance dashboard has 90+ days of live data. Paying users acquired on unvalidated claims will churn fast and refund-chargeback at elevated rates.
- Start with organic + referral only. Validate conversion rate and early churn for 60 days. Only then turn on paid channels.
- Plan acquisition spend against midpoint, not upside. Hold a reserve equal to 3 months of acquisition spend for unexpected CAC inflation.
- Monthly unit-economics review is non-negotiable. If CAC climbs or churn worsens, halt new-channel spend within the month, not the quarter.

## Open items

- Real CAC and real churn are unknown until Phase 5 month 3. All numbers above are prior estimates. Revise this document monthly during early Phase 5 with actuals.
- Institutional tier math not modeled. If even 5 institutional customers at $499/mo materialize, they add $30K ARR at near-zero incremental CAC. Treat as pure upside.
- Pricing sensitivity not tested. $29/mo tier might cut churn but also cuts LTV; $99/mo tier might improve LTV but shrink the qualified market. Sprint 5.3 (not currently scoped) should A/B test pricing after month 6 of Phase 5.
