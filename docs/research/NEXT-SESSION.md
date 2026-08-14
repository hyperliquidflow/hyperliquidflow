# Pick up here

Updated 2026-08-14 evening, mid-session. **Two things are in flight**, both
started here, and one of them may still be running when you read this.

## In flight

**1. The flow collector**, restarted at 17:00 UTC after dying with the previous
session. It is a persistent process holding a WebSocket, so it cannot be a cron
job and it dies with the session that owns it.

```bash
npx tsx --env-file=.env.local scripts/flow-collector.ts --coins=30 --floor=5000
```

`ops/flow-collector.plist` is a launchd agent that survives logout and reboot,
checked in and **not installed**; the install command is in its header. It does
not survive a sleeping laptop. A real host is still the better answer and is
still the owner's call.

**2. The Step 1 population fetch**, 900 wallets over 90 days, roughly three
hours. Check it:

```bash
npx tsx --env-file=.env.local scripts/tape-population.ts   # summarise the cache
npx tsx --env-file=.env.local scripts/tape-skill-test.ts --min-active=5
```

If the fetch died partway, the checkpoint at `tape-population-checkpoint.json`
lets a rerun of the same command resume rather than restart. **Do not** run the
skill test against a checkpoint-salvaged cache without saying so in the entry.

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
