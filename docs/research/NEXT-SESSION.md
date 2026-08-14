# Pick up here

Updated 2026-08-14 late. **Step 1 is done and it passed.** One process is in
flight.

## The headline

**Wallet skill persists on a population that was never selected on winning.**
Primary **IC 0.1733, t 4.50, n 655**, against a pre-registered bar of 0.08 with
t 2 and a 250-pair minimum. 900 wallets, 6.8M fills, zero dropped. It is the
first clean positive result in the project's life. Full entry with the attack
that failed to break it:
[2026-08-14-tape-skill-step1.md](2026-08-14-tape-skill-step1.md).

**It revives nothing.** Skill predicting a wallet's own forward returns and a
follower earning a return are separate claims, and the second died on
2026-08-13 specifically. A stronger ranking is not a reason to reopen copying.

## In flight

**The flow collector**, restarted 17:00 UTC. Persistent WebSocket process, so it
dies with the session that owns it.

```bash
npx tsx --env-file=.env.local scripts/flow-collector.ts --coins=30 --floor=5000
```

`ops/flow-collector.plist` is a launchd agent that survives logout and reboot,
checked in and **not installed**; the install command is in its header. It does
not survive a sleeping laptop. A real host is still the better answer and is
still the owner's call.

## If you rerun Step 1

The draw is frozen in `tape-population-targets.json`, so rerunning the fetch
resumes the same 900 addresses rather than resampling. Passing `--redraw` gives a
**different** sample, because the eligible population grows with the tape: it was
378 addresses when capped, 2,451 when paged, and 2,469 forty minutes later.

```bash
npx tsx --env-file=.env.local scripts/tape-population.ts               # summarise
npx tsx --env-file=.env.local scripts/tape-skill-test.ts --min-active=5
npx tsx --env-file=.env.local scripts/tape-skill-robustness.ts --min-active=5
```

Prior caches are archived under `.cache-archive/`, which exists because the one
cache this project overwrote in place is the one confound the 200-day kill cannot
separate.

## Defect eight, found before it could publish anything

Tape discovery was drawing from the oldest 2.5 hours of a 21.6-hour tape.
`.limit(200_000)` on a Supabase read returns 5,000 rows with no error and no
truncation flag. The tell was a population that did not grow after 15 extra hours
of collection. Paged, the same tape yields **2,451 eligible addresses against
378**. See
[2026-08-14-tape-discovery-row-cap.md](2026-08-14-tape-discovery-row-cap.md).

The market-maker classification is unaffected and reproduces on the full window.

**The class C question is decided and written down**
([2026-08-14-class-c-decision.md](2026-08-14-class-c-decision.md)): C stays in the
population, with two declared supporting slices and one clause added to the
primary, that partial histories are excluded. Decided before the run, which is
the whole point of it.

## The prior session, for context

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

## What Step 1 opens, none of it decided

Step 2 (the base rate) is answered descriptively and **still not citable**: 58.6%
profitable across 752 wallets, a third population returning nearly the same
number as the first two, gross of fees, with the split itself letting
survivorship in. Step 4 (flow toxicity) is the next program step and needs a
pre-registration written before its first run.

The open question the result raises and does not answer: the effect is roughly
three times stronger among the quietest quintile of wallets than the noisiest,
and nobody knows why.

## Done 2026-08-14 evening, so do not redo it

The two small fixes from the previous handoff are shipped in commit `52d970e`,
along with the discovery paging above. 5xx now fails after one retry while 429
keeps its full backoff; a failed page keeps what it fetched and marks the wallet
rather than dropping the address; the fill page cap is 30 and whatever still
truncates is excluded from the primary statistic. The cache records the seed,
span, page cap, attempt count and dropped addresses.

Attrition to watch when the fetch lands: 331 fetched became 226 usable became 205
primary on the previous draw. 900 was chosen for that reason, but the corrected
population contains many more sporadic addresses, whose histories are thinner, so
attrition may be worse rather than better. **If the primary clears fewer than 250
pairs the script prints UNDERPOWERED and no verdict may be recorded.** Draw more
and rerun; do not reframe the bar.

## What not to do

1. **Do not revive any copy hypothesis.** Short holds, long holds, exits,
   skill-selected entries and mirror exits are all dead, the last three on
   pre-registered bars.
2. **Do not cite the 58.8% profitable base rate.** It barely moved between two
   very different populations, 58.3% to 58.8%, which is suspicious rather than
   reassuring. The likely cause is the split: the forward half is the later part
   of each wallet's own history, so a wallet still trading late was probably
   doing acceptably. Survivorship entering through the measurement.
3. **Do not derive signed per-address flow.** Now measured rather than suspected:
   the tape's `side` is the **aggressor's**, with zero exceptions on 131 fills
   joined by `tid`, and the trade never says which counterparty crossed. Signed
   **per-coin** flow is sound and is the honest version of this metric. See
   [2026-08-14-trade-side-convention.md](2026-08-14-trade-side-convention.md).
   `flow_address_minute.side_b_notional` is a trap: it means "notional this
   address was in while the aggressor was buying".
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
