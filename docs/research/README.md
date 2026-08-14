# Results register

Every research run that produces a number anyone might later cite lands here as a
dated file. This exists because two headline results lived only in commit messages
and one critical correction had no recorded output anywhere until the 2026-08-12
audit re-ran it (dossier finding R2, confirmed by both external reviews).

Companion: [LESSONS.md](LESSONS.md) is the program retrospective, the full arc
from the April idea to the August kills, the distilled lessons, and the list of
what is recorded but unresolved. It is a synthesis, not a run record; the dated
files below stay the authority on every number.

## Rules

1. One file per run: `YYYY-MM-DD-<slug>.md`.
2. Every entry records: the exact command, the cache fingerprint (fetched_at, days,
   interval, row count, wallet count), the git commit of the code that ran, and the
   verbatim output tables that matter.
3. A result that is not in this register does not exist. Commit messages are
   pointers, not records.
4. Pre-registered experiments get their thresholds written here BEFORE the run
   (see `2026-08-12-preregistration-leads.md`). Runs against pre-registered
   thresholds must report pass or fail against the written bar, not a reframed one.
5. Negative results are filed with the same care as positive ones. They are the
   product.

## Index

- [2026-08-12-overlap-rescore.md](2026-08-12-overlap-rescore.md): non-overlapping
  window re-score of the long-hold lead, run twice (research session + audit),
  identical output. The lead holds at reduced significance.
- [2026-08-12-preregistration-leads.md](2026-08-12-preregistration-leads.md):
  binding pass/fail bars for the positioning factor and the long-hold lead,
  written before the funding-charged rerun and the forward shadow record.
- [2026-08-12-executioner-run.md](2026-08-12-executioner-run.md): both leads
  under the full cost model, day clustering, trimmed means, bootstrap, and
  momentum baselines. Both FAIL their 2.5 confirmation bars at 120 days and
  survive every falsification test; both proceed to the 200-day extension.
- [2026-08-13-exit-copying.md](2026-08-13-exit-copying.md): exit copying is
  dead (negative at every hold, t -3.7 at 24h). The failure is informative: the
  cohort sells winners that keep winning, which with the entry and holding
  results makes one coherent story. The sign-flipped variant is quarantined as
  a hypothesis, not claimed.
- [2026-08-13-skill-selection.md](2026-08-13-skill-selection.md): wallet skill
  does not sort the entries a follower can copy (pre-registered contrast
  -13.0 bps/day, t -0.47, FAIL). Decile 9 alone looked excellent, which is
  exactly what the single pre-registered contrast existed to prevent.
- [2026-08-13-momentum-family-and-splithalf.md](2026-08-13-momentum-family-and-splithalf.md):
  a 3-day momentum rule ties the long-hold lead at 72h (+61.9 vs +64.2), which
  downgrades yesterday's "momentum rejected" claim to "rejected at 1 day only".
  The corrected table does pass its split-half, with heavy front-loading.
- [2026-08-13-path-c-note.md](2026-08-13-path-c-note.md): strategy note. The
  diagnostic (t 3.13) is far stronger than the traded book (t 1.42), and a
  ranking has no capacity ceiling while a book does. Decide personal income
  versus business before the day-60 number exists.
- [2026-08-13-factor-rivals.md](2026-08-13-factor-rivals.md): the lean is not
  activity in disguise. Volume, volume change and funding are all near-orthogonal
  to it and none predicts. Includes a lookahead caught before publication that
  had volume change reading a false IC of 0.1014.
- [2026-08-13-cache-audit.md](2026-08-13-cache-audit.md): the cache matches the
  exchange exactly, 8,405 bars, zero differences. Determinism was already known;
  this is fidelity, which is the claim that matters.
- [2026-08-12-capacity.md](2026-08-12-capacity.md): what a surviving edge would
  be worth. Honest capacity is about $100k of book, roughly $364/day if the
  edge is real, bounded by the thin coins the factor prefers.
- [2026-08-12-frozen-pool.md](2026-08-12-frozen-pool.md): the survivorship
  control. Both leads stay positive and below the bar. Establishes the hard
  bound that no clean window can predate 2026-04-11, which is why the forward
  record is the only instrument that can settle either lead.
- [2026-08-14-tape-skill-preliminary.md](2026-08-14-tape-skill-preliminary.md):
  **IC 0.30 was the market makers, entirely.** On a maker-excluded random draw the
  primary statistic reads -0.0369 on 205 pairs. Not a verdict: 205 is under the
  designated 250, so the reading may be cited to reject an effect the size of
  0.30 and not to accept or reject the 0.08 bar. Names three unresolved selection
  effects, and records a process defect, the minimum sample lived in a document
  and not in the code.
- [2026-08-14-market-maker-separation.md](2026-08-14-market-maker-separation.md):
  Step 3, arrived at early because it was a confound on Step 1 rather than a
  separate task. Two-sidedness **cannot** be computed from the tape, since both
  counterparties inherit a trade's single `side` field. Persistence and breadth
  can: 3 addresses run 12,828 trades across 13.7 coins, and A+B are 26.8% of all
  flow. The Step 1 population, top 300 by notional, was 13% maker-like and 71%
  recurring high-frequency, which is the likely source of its IC 0.30 on 48 pairs.
  Records the exclusion rule for reuse.
- [2026-08-14-class-c-decision.md](2026-08-14-class-c-decision.md): the class C
  question decided **before** the run that depends on it, per item 7 of the audit
  list. C stays in the population: the maker rule targets a business model that
  needs persistence, and C is present 3.3% of minutes across 2.1 coins. The
  555-trade figure that made C look disqualifying comes from the
  notional-conditioned subset, which is the selection that produced IC 0.30.
  Declares two supporting slices and adds one clause to the primary, that partial
  histories are excluded.
- [2026-08-14-tape-skill-step1.md](2026-08-14-tape-skill-step1.md): **the first
  clean positive result this project has produced.** Wallet skill persists on a
  tape-discovered population that was never selected on winning: primary
  **IC 0.1733, t 4.50, n 655** against a pre-registered bar of 0.08 and t 2 with
  a 250-pair minimum. 900 wallets, 6.8M fills, zero dropped. The headline could
  have been an artifact, because the score and the forward variable share
  sd(train) in the denominator; it survived removing the Sharpe proxy entirely
  (0.1697), stratification by sd(train) (positive in all five quintiles), the
  dollar variant (0.1064, t 2.73), and a seeded split-half (0.1708 / 0.1861).
  Score against sd(train) is -0.0017, which is what kills the artifact. Revives
  no copy hypothesis: skill predicts a wallet's own returns, not a follower's.
- [2026-08-14-day-60-power.md](2026-08-14-day-60-power.md): the forward record's
  day-60 checkpoint **cannot decide anything**. Powered at 82% off a t 3.17 that
  the 200-day run killed; redone on the surviving t 0.70 it has **16% power** at
  a bar of 1.5, and the bar a 60-day window can carry at 80% power is negative.
  Clearing 1.5 honestly needs 3.3 years. Retires the decision, keeps the
  recording, and states the general form: a scheduled gate inherits the estimate
  it was powered from and expires when that estimate does.
- [2026-08-14-trade-side-convention.md](2026-08-14-trade-side-convention.md):
  the tape's `side` is the **aggressor's**, measured on 131 fills joined by `tid`
  with zero exceptions (crossed the spread: 21 match, 0 opposite; rested: 0 match,
  110 opposite). Position in `users` explains nothing. Signed **per-coin** flow is
  therefore sound and is exactly an order-flow imbalance; signed **per-address**
  flow is not derivable, because the trade never says which counterparty crossed.
  Names the trap in `flow_address_minute.side_b_notional` and a recommended
  rename. Also records how a broken join on `(hash, coin, size)` made a
  deterministic relationship look like noise at 2 of 17.
- [2026-08-14-tape-discovery-row-cap.md](2026-08-14-tape-discovery-row-cap.md):
  **defect eight, caught by a population that would not grow.** A `.limit(200_000)`
  on a Supabase read returned 5,000 rows with no error and no truncation flag, so
  tape discovery drew from the oldest 2.5 hours of a 21.6-hour tape. Paged, the
  same tape yields 2,451 eligible addresses against 378. The market-maker
  classification is unaffected and reproduces on the full window. No published
  result rested on the capped population.
- [2026-08-13-mirror-exit.md](2026-08-13-mirror-exit.md): the copy test that
  should have been run first, hold what they hold until they drop it. **FAILS**
  its pre-registered bar at t 1.61 against 2.5, so it is dead by the written
  consequence. But it is the first copy variant with a **positive** point
  estimate, +71.3 bps an episode with a positive trimmed mean and halves that
  agree, where every fixed-horizon test was negative. Ran on 41 survivor-selected
  wallets. The **unconditioned rerun settles it**: 3,779 episodes across 137
  wallets drawn with a recorded seed, net -0.8 bps at t -0.08 with a negative
  trimmed mean. The entire +71.3 was selection. Dead on both clauses.
- [2026-08-13-websocket-coverage.md](2026-08-13-websocket-coverage.md): a data
  availability result. The public WS trades feed carries **both counterparty
  addresses** on every trade, which the docs deny and 732 observed trades
  confirm. Exchange-wide flow at address level is obtainable; exchange-wide
  liquidations are not, because those subscriptions are per-user. Proves nothing
  about edge and revives no dead hypothesis.
- [2026-08-13-200d-frozen-extension.md](2026-08-13-200d-frozen-extension.md):
  **the run both leads were built to face, and both FAIL.** Lead 1's book reads
  t 1.33 and its diagnostic IC falls from 0.0653 (t 3.17) to 0.0185 (t 0.70);
  Lead 2 fails on three clauses at once and its split halves disagree in sign at
  every long hold. Amendment 2 makes a failure here a kill, so both are dead.
  Read the second section first: the freeze discards all 80 extra days, so the
  fetch bought three days and tripled the wallet pool, and every difference is a
  pool-composition difference. Owner decision now due between Path B and Path D.
