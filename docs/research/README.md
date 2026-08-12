# Results register

Every research run that produces a number anyone might later cite lands here as a
dated file. This exists because two headline results lived only in commit messages
and one critical correction had no recorded output anywhere until the 2026-08-12
audit re-ran it (dossier finding R2, confirmed by both external reviews).

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
- [2026-08-12-frozen-pool.md](2026-08-12-frozen-pool.md): the survivorship
  control. Both leads stay positive and below the bar. Establishes the hard
  bound that no clean window can predate 2026-04-11, which is why the forward
  record is the only instrument that can settle either lead.
