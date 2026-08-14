# Pick up here

Rewritten 2026-08-14 at session close. **Nothing is in flight.** One thing stopped
when the session ended and needs restarting.

## The thing that stopped

`scripts/flow-collector.ts` was running for 21.3 hours and died with the session.
It is a persistent process, so it cannot be a cron job.

**Nothing was lost.** Everything it captured is in Supabase:

| | |
|---|---|
| addresses discovered | 6,037 |
| address-minute rows | 65,516 |
| coin-minute rows | 35,759 |
| notional observed | $1.74B |
| hours of tape | 21.3 |

Restart with:

```bash
npx tsx --env-file=.env.local scripts/flow-collector.ts --coins=30 --floor=5000
```

Giving it a permanent host is the one decision gating everything below. Cost is
bounded: 0.50 GB/day raw for the full 177-coin universe, and the collector
aggregates to the minute before writing, so the stored footprint is far smaller.

## What happened this session

**The follow premise closed completely.** Mirror-exit copying, hold what they hold
until they drop it, was the last untested and most literal reading of "copy a
wallet". It fails: -0.8 bps at t -0.08 on 3,779 episodes across an unconditioned
population. On survivors only it read +71.3 bps, so **the entire effect was
selection**. See [2026-08-13-mirror-exit.md](2026-08-13-mirror-exit.md).

That question came from the owner asking why a copy test closes on a schedule the
copied wallet never used. It produced defect seven in CLAUDE.md: the apparatus
shaped the question. Every copy test used a fixed horizon because `signal-lab.ts`
emits entry events and the grading loop resolves them at fixed windows. Median
cohort hold is 14.4 hours and 78.3% close inside 48, so the 48-hour test held long
after the wallet had left.

**The WS trades feed carries both counterparty addresses**, which the docs deny
and 732 observed trades confirm. Exchange-wide flow at address level is
obtainable. Exchange-wide liquidations are not, because those subscriptions are
per-user, so the liquidation heatmap stays retired.
See [2026-08-14-market-maker-separation.md](2026-08-14-market-maker-separation.md)
and [2026-08-13-websocket-coverage.md](2026-08-13-websocket-coverage.md).

**Skill persistence on tape-discovered wallets read IC 0.30, then -0.037.** The
first number was market makers. Selection by notional is a maker filter in
reverse. See
[2026-08-14-tape-skill-preliminary.md](2026-08-14-tape-skill-preliminary.md).
No verdict was recorded: 205 primary pairs against a designated 250.

## First thing to run next session

The tape population is now far larger than the 378 that Step 1 drew from, because
the collector ran another 15 hours after that draw. Re-run Step 1 properly:

```bash
npx tsx --env-file=.env.local scripts/tape-population.ts --fetch --days=90 --max-wallets=900
npx tsx --env-file=.env.local scripts/tape-skill-test.ts --min-active=5
```

900 rather than 378 because attrition is brutal: 331 fetched became 226 usable
became 205 primary. Clearing 250 primary pairs needs roughly 450 fetched.

**Settle this before that run, not after:** whether class C, 892 addresses
averaging 555 trades in six hours, should also be excluded. It is not
discretionary trading either. Deciding it after seeing a result is choosing a
population by its answer.

## Two fixes worth making first, both small

1. **Faster failure on 5xx.** `tape-population.ts` retries four times with
   doubling backoff, roughly 15 seconds per dead address. 30 of 378 failed, and
   they are plausibly the largest histories, so the dropouts bias the sample.
   Drop after one retry.
2. **Page cap.** 31 of 331 wallets hit the 12-page fill cap, so their series is
   partial and their score is computed on incomplete history. Either raise the
   cap or exclude truncated wallets from the primary statistic.

## What not to do

1. **Do not revive any copy hypothesis.** Short holds, long holds, exits,
   skill-selected entries and mirror exits are all dead, the last three on
   pre-registered bars.
2. **Do not cite the 58.8% profitable base rate.** It barely moved between two
   very different populations, 58.3% to 58.8%, which is suspicious rather than
   reassuring. The likely cause is the split: the forward half is the later part
   of each wallet's own history, so a wallet still trading late was probably
   doing acceptably. Survivorship entering through the measurement.
3. **Do not derive signed per-address flow.** Both counterparties inherit a
   trade's single `side` field. Confirm the convention against `userFillsByTime`
   for a known address first.
4. **Do not chart the long-short split yet.** `positioning_history` has 2 days.
   It needs about three weeks.

## Product state

Shipped and live: coin pages at `/coin/[symbol]`, a markets index, clickable
coins everywhere, a research page at `/research` carrying the honest record
including the failures, nav reorganised around what a reader wants, and the
liquidation heatmap deleted. All six phases of
`docs/sprints/2026-08-13-product-plan.md` are done, plus the three follow-ups.

**Decided 2026-08-14: Path B.** The owner confirmed stopping was never on the
table. The product makes analytics claims, not alpha claims, per
`docs/preflight/kill-criteria.md`. Every trading hypothesis is dead and the
product does not depend on any of them being alive.
