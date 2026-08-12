# Pick up here

Written 2026-08-13 at session close, with one job still in flight.

## The one thing in flight

A 200-day, 400-wallet fetch was running when the session ended. It writes
`fill-study-cache.json` only on success, and it checkpoints every 25 wallets to
`fill-study-checkpoint.json`, so an interruption costs 25 wallets rather than
the whole run.

**First, work out which of these three states you are in.**

```bash
pgrep -f "fill-study.*--fetch"        # still running?
ls -l fill-study-cache.json           # 9.7M and dated 2026-08-12 means the OLD 120d cache
ls -l fill-study-checkpoint.json      # exists means a run was interrupted partway
```

1. **Still running.** Leave it. It was at 350/400 wallets at session close.
2. **Finished.** `fill-study-cache.json` will be large and freshly dated, and
   the checkpoint file will be gone (a completed run deletes its own). Run the
   two studies below.
3. **Died partway.** The checkpoint survives. Re-run the exact same command and
   it resumes, skipping completed wallets:

```bash
npx tsx --env-file=.env.local scripts/fill-study.ts --fetch --days=200 \
  --interval=1h --pool=traders --wallets=400
```

Note: the parameters must match exactly or the checkpoint is ignored by design,
because a checkpoint from a different window is a different study.

## Then run the two pre-registered studies

Parameters are fixed by Amendments 1 and 4 and must not be changed:

```bash
npx tsx --env-file=.env.local scripts/fill-study.ts --freeze-pool
npx tsx --env-file=.env.local scripts/positioning-factor.ts --freeze-pool --legs=5 --min-volume=2000000
```

## How to read the result, decided in advance

**Amendment 2 governs this run and it is one-sided.** No study-band wallet
existed 200 days ago, so the window cannot be frozen before 2026-04-11 and
survivorship works in the leads' favour.

- **A failure counts as a kill.** A lead that cannot clear its bar even with
  survivorship helping it is dead.
- **A pass confirms nothing** and may not be cited as confirmation anywhere.
  Record it as "not killed by the contaminated window".

File the output in `docs/research/` as a dated entry with the command, the cache
fingerprint, and an explicit pass or fail against the written bar. Do not
reframe the bar.

## Before proposing any new research

Read `docs/research/README.md` and the hypothesis map in
`docs/sprints/status.md`. Four hypotheses are dead and must not be retested on
historical windows. Two are "failed but alive", and **only the forward record
can promote them; no backtest ever can.**

## The clock that matters

`scripts/factor-shadow.ts` runs daily at 03:00 UTC and needs nothing. Day 60
(around 2026-10-11) is a powered checkpoint on the diagnostic at t 1.5. The
traded book confirms at day 283. Use `lib/power.ts` before setting any new bar:
the original 60-day traded bar had 34% power and would have killed a real edge.

Progress is visible at `/portfolio/journal`.
