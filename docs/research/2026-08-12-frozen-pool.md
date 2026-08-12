# Frozen pool: what survives when only knowable wallets count

The survivorship control both external reviews demanded, run on the same
120-day cache as the executioner screen so the freeze is the only thing that
changed.

## What the freeze does

Discovery reads the Hyperliquid leaderboard, which ranks by realised PnL, so a
wallet enters this project's universe *because* it had already done well. Every
entry it made before that date is chosen with knowledge of how the period
turned out, and no real-time follower could have copied a wallet it had never
heard of. `--freeze-pool` drops those entries, keeping each wallet's own
post-discovery history only (`lib/discovery.ts`, 10 tests).

## The bound this exposes, which matters more than the result

**Discovery began 2026-04-11. Nothing in this project existed before it.** Of
the 4,791 wallets in the study band, 4,335 were discovered in April 2026 and
**zero** existed 200 days ago.

The consequence is structural and worth stating before any future run: a
backtest window reaching further back than 2026-04-11 cannot be frozen at all.
Fetching more history buys regime coverage for the contaminated version of a
study and buys nothing for the clean one. The clean window is capped at about
123 days today and grows one day per day.

This also reframes the survivorship criticism in the project's favour. The
120-day window opens 2026-04-14, three days *after* the bulk discovery, so it
was already 92% post-discovery before the freeze existed.

## Provenance

- Commands:
  `npx tsx --env-file=.env.local scripts/fill-study.ts --cache=<archived 120d> --freeze-pool`
  `npx tsx --env-file=.env.local scripts/positioning-factor.ts --cache=<archived 120d> --freeze-pool --legs=5`
- Cache: the archived 120-day cache, fetched_at 2026-08-12T13:32:42.114Z, 1h
  interval, identical to the executioner run
- Freeze effect: 58,307 fills to 53,844 (92% kept), 112 wallets to 112,
  earliest discovery 2026-04-11
- Costs, clustering and statistics: unchanged from the executioner run
- Legs: 5 a side, fixed ex ante by Amendment 1

## Lead 2: long holds, frozen

| hold | signal | n | days | mean bps | trim10 | t | boot95 |
|---|---|---|---|---|---|---|---|
| 60m | wallet | 10285 | 121 | -18.1 | -18.3 | -12.7 | [-21, -15] |
| 240m | wallet | 5471 | 121 | -16.6 | -16.1 | -5.3 | [-22, -10] |
| 720m | wallet | 2887 | 121 | -4.7 | -6.6 | -0.6 | [-21, 12] |
| 1440m | wallet | 1817 | 120 | +13.6 | +16.7 | 0.9 | [-16, 42] |
| 2880m | wallet | 1070 | 119 | **+48.7** | +33.7 | **1.6** | [-10, 107] |
| 4320m | wallet | 772 | 118 | **+64.2** | +44.2 | **1.8** | [-9, 134] |

Momentum baseline at the same entry times stays negative or flat at every long
hold (-5.2 at 24h, -9.3 at 48h, +22.1 at 72h, all |t| below 0.7).

Versus unfrozen: 48h falls from +58.6 (t 2.0) to +48.7 (t 1.6); 72h from +82.2
(t 2.1) to +64.2 (t 1.8). **Survivorship was real and modest: it accounted for
roughly a sixth of the effect, and removing it did not reverse the sign.** The
bootstrap intervals now straddle zero at every hold, so this window cannot
support a claim either way at the long horizons.

## Lead 1: positioning factor, frozen, 5 legs

| metric | value |
|---|---|
| daily IC | 0.0653 (se 0.0206, t 3.17), 55% of days positive |
| full-cost book | +39.0 bps/day, t 1.42, win 54% |
| trimmed10 | +38.4 bps (essentially the full mean, so not tail-carried) |
| boot95 | [-16.5, +90.7] bps |
| funding coverage | 100% |
| split-half | early +43.5 (t 0.91) / late +34.6 (t 1.26) |
| momentum IC | 0.0119 (t 0.42) |
| rank corr(lean, momentum) | 0.042 |

The freeze barely touches the factor, which is expected: it uses the same
mostly-post-discovery window. The IC is if anything slightly stronger frozen
(0.0653 against 0.0640). At 5 legs rather than 3 the book mean is lower and
steadier, and its trimmed mean now equals its mean, which is the cleanest
evidence yet that this one is not a tail artifact.

## Verdict against the pre-registered bars

Both leads remain **below the 2.5 confirmation bar** and above zero on every
robust statistic. Nothing here changes the plan; it removes the last named
bias from the 120-day reading and tells us what a longer window can and cannot
buy.

Standing after this run:

- Lead 1: IC t 3.17 frozen, book t 1.42. The diagnostic is robust to
  survivorship, momentum, funding and trimming. The traded expression needs
  either more days or a wider book, and days are the honest answer.
- Lead 2: positive at 48h and 72h, no longer significant frozen, momentum
  rejected as the explanation.
- The forward record (migration 026, `scripts/factor-shadow.ts`) began the same
  day and is the only instrument that can settle either lead cleanly, because
  the backward window is bounded by the project's own birth date.
