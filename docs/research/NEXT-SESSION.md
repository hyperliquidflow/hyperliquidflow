# Pick up here

Rewritten 2026-08-13 after the 200-day run completed. **Nothing is in flight.**

## What happened since the last handoff

The 200-day, 400-wallet fetch finished cleanly (`fetched_at`
2026-08-12T23:41:12Z, 335,378 fills, 398 wallets, checkpoint self-deleted). Both
pre-registered studies ran against it exactly as written.

**Both leads failed their bars, and Amendment 2 makes a failure here a kill.**

- Lead 1, positioning factor: book t 1.33 against a bar of 2.5. Its diagnostic
  IC, the number this project leaned on hardest, fell from 0.0653 (t 3.17) to
  0.0185 (t 0.70).
- Lead 2, long holds on entries: t 0.4 at the primary 48h hold, trimmed mean
  negative, split halves disagreeing in sign at every long hold. Three
  independent clauses failed.
- Hypothesis 4, skill selection: contrast -30.6 bps/day, t -1.98. Fails, and the
  sign is negative rather than absent.

Full entry, with commands, cache fingerprint and verbatim tables:
[2026-08-13-200d-frozen-extension.md](2026-08-13-200d-frozen-extension.md).

## The next move is not a research task

Per the pre-registration section "If both leads fail", the follow premise and the
positioning premise are both dead and what is due is **a written owner decision
between Path B (mechanical flows, a larger build) and Path D (stop or hold)**,
made from these documents rather than from memory.

That decision belongs to the owner. Do not open it by writing code toward either
path, and do not reopen it by running another backtest.

## What not to do, in order of how tempting it is

1. **Do not sweep wallet count on this cache.** The 200-day run tripled the pool
   (112 to 385) at the same time it extended the window, and the freeze made the
   window change a no-op, so pool depth is a live confound. Testing it is a
   threshold search on a dead lead, which the Lead 1 fail consequence forbids by
   name. If the "the factor lives in the top of the band" idea is worth pursuing,
   it is a materially different hypothesis and needs its own pre-registration
   written before any run.
2. **Do not retest the dead hypotheses on historical windows.** Six are dead:
   both leads, short-hold entry copying, coordination, exit copying, and
   skill-selected entries.
3. **Do not treat the surviving wallet ranking as a survivor of this run.** It is
   real (rank IC 0.0939 clean of lookahead) and it was never one of the leads.
   Everything measured here says the ranking does not transfer to a follower
   copying trades, which is a different claim from the ranking being real.
4. **Do not refetch to get more history.** No clean window can predate
   2026-04-11. More history buys regime coverage for the contaminated version of
   a study and nothing for the clean one.

## The clock still running, which needs nothing

`scripts/factor-shadow.ts` at 03:00 UTC, visible at `/portfolio/journal`. It
resolves yesterday, records today, never backfills.

One correction it needs before day 60 is read: Amendment 3 powered the day-60
diagnostic checkpoint at 82%, computed from an assumed effect of t 3.17 over 104
days. The 200-day run puts that diagnostic at t 0.70. Re-derive the checkpoint
with `lib/power.ts` before reading day 60 in either direction. Recording in the
meantime costs nothing and the arithmetic can be redone at any time.

## Before proposing any new research

Read [README.md](README.md) and the hypothesis map at the top of
`docs/sprints/status.md`. The register rule stands: a result that is not filed
there does not exist.
