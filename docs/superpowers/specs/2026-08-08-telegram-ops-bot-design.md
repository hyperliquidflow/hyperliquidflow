# Telegram Ops Bot, Design

Date: 2026-08-08
Status: approved, ready for planning

## Problem

Nothing pushes to the owner. `freshness-check.yml` runs three checks every 15
minutes and its only output channel is GitHub's default failure email, which is
easy to miss and gives no detail. There is also no way to ask the system a
question. Checking whether the pipeline is alive currently means opening the
dashboard or reading Actions logs.

The 2026-06-22 incident (all four workflows silently disabled for 47 days) and
the ~Jul 16 heartbeat death both went unnoticed for weeks. Both would have been
caught on day one by a push alert.

## Scope

In scope:

- A private Telegram bot, single authorized user, read only.
- Five commands that read existing KV and Supabase data and reply.
- Push alerts on state transitions for five health checks.
- One nightly digest after the wallet scan.

Out of scope (explicitly not built):

- Any command that mutates state or triggers work. Nothing dispatches a
  workflow run, forces a cohort refresh, or writes to Supabase. The `/scan`
  command below only reports on the last scan, it does not start one.
- LLM or natural language handling. Commands are a fixed set.
- Multi user support, groups, inline queries.
- Trading actions of any kind.

## Architecture

```
GitHub Actions (freshness-check.yml, every 15 min)
  └─ curl -f POST /api/telegram/watchdog   (Bearer CRON_SECRET)
       ├─ runs 5 checks against KV + Supabase
       ├─ diffs each against alert:state:<id> in KV
       └─ sends Telegram message ONLY on transition
  (a non 200 fails the step, so GitHub's failure email
   remains the meta alert for "the watchdog itself is down")

Telegram
  └─ webhook POST /api/telegram/webhook
       ├─ verify X-Telegram-Bot-Api-Secret-Token (timing safe)
       ├─ drop silently if chat_id != TELEGRAM_CHAT_ID
       └─ dispatch command, reply

GitHub Actions (daily-wallet-scan.yml)
  └─ new final step, if: always()
       └─ npx tsx scripts/notify-scan-digest.ts
            reads scan-summary.json, sends digest
            (missing file means the scan died, digest says so)
```

Rationale for putting the watchdog in the app rather than in Actions: the
"alert once, then stay silent" requirement needs memory of the previous state.
KV is the only persistent store reachable cheaply, and only the app can reach
it. A stateless Actions step would re-alert on every 15 minute run, producing
36 messages overnight instead of 1.

## Health checks

Each check has a stable id, used as its KV state key.

| id | broken when | exact source |
|----|-------------|--------------|
| `snapshot_stale` | `updated_at` older than 20 min | `cohort:active` in KV |
| `heartbeat_dead` | newest row older than 45 min | `cohort_snapshots.snapshot_time` |
| `scan_dead` | newest date older than 48 h | `wallet_score_history.date` |
| `cohort_floor` | count below 40, or down more than 30% vs the previous day | current: `count(wallets where is_active = true)`. Previous day: `count(wallet_score_history where date = today - 1)` |
| `learning_stalled` | zero rows in the last 48 h | `count(signal_outcomes where resolved_at > now() - 48h)` |

The first three replace the bash equivalents currently inline in
`freshness-check.yml`, which are deleted so there is one definition of "broken".

Hyperliquid 429 rate is deliberately not a check. It is a per scan property, so
it rides in the nightly digest line instead.

## State machine

KV key `alert:state:<id>` holds `{ ok: boolean, since: string }`, no TTL.

| previous | current | action |
|----------|---------|--------|
| absent | ok | write state, send nothing |
| absent | broken | write state, send alert |
| ok | ok | no write, no send |
| ok | broken | write state, send alert |
| broken | broken | no write, no send |
| broken | ok | write state, send recovery with downtime computed from `since` |

`/check` runs the same code path and therefore also updates state. This is
intended: a manual check that confirms recovery should cancel the pending
alert.

## Commands

| command | reply | reads |
|---------|-------|-------|
| `/status` | headline plus one detail line. Fast, no Supabase round trip. | `cohort:active` in KV for cohort size and data age, plus the five `alert:state:<id>` keys for the healthy or broken headline |
| `/check` | force runs all five checks live, one line each, updates state | same sources as the watchdog |
| `/cohort` | active wallets, activated and deactivated in the last scan, attrition | `wallets`, `cohort_attrition` |
| `/signals` | signal count in the last 24 h, top recipe by directional accuracy | `recipe_performance` |
| `/scan` | last scan result and age, next scheduled run. Reports only, does not trigger a scan. | `wallet_score_history` newest date |

The split between `/status` and `/check` is deliberate. `/status` answers "is
anything wrong" from cached state in one KV read. `/check` answers "is it
wrong right now" by re-running everything, which costs several Supabase
queries. Without the split, the cheap question would pay the expensive price.

Anything else, including `/start`, replies with the command list.

## Message copy

Plain text, no emoji, no markdown. Every message must be short enough to read
in a phone notification preview without opening Telegram. Two lines is the
target, three is the ceiling. No em dashes or en dashes, per project copy rules.

```
/status
All green
Cohort 77, data 2m old

alert
BROKEN: heartbeat dead
No snapshot in 51m, limit 45m

recovery
RECOVERED: heartbeat
Was down 1h20m

nightly digest
Scan ok, 42m
3063 found, 248 activated, 77 active
G12 cut 134, 97 rate limited

scan failure digest
SCAN FAILED
No summary written, check Actions run
```

All copy lives in `lib/telegram.ts` as formatter functions, one per message
type, the same single source of truth pattern used by `lib/recipe-meta.ts`.
No message strings anywhere else in the codebase.

## Security

Three new environment variables, added to `lib/env.ts` following the existing
`requireInProd` pattern so local dev does not break:

- `TELEGRAM_BOT_TOKEN`, the BotFather token.
- `TELEGRAM_CHAT_ID`, the single authorized chat. All others are dropped.
- `TELEGRAM_WEBHOOK_SECRET`, registered with Telegram at webhook setup time.

Webhook route:

1. Timing safe compare of the `X-Telegram-Bot-Api-Secret-Token` header against
   `TELEGRAM_WEBHOOK_SECRET`. Mismatch returns 401 with no body.
2. If `message.chat.id` is not `TELEGRAM_CHAT_ID`, return 200 and send nothing.
   Returning 200 with silence keeps the bot invisible to strangers who guess
   the username, rather than confirming it exists.
3. Only then dispatch the command.

Watchdog route reuses `verifyCronAuth` from `lib/auth/cron.ts` unchanged.

The bot token grants send rights on the bot only. It cannot read the repo,
Supabase, or KV. Worst case on token leak is spam to the owner's chat.

## Files

New:

- `lib/telegram.ts`, send function plus all message formatters.
- `lib/watchdog.ts`, pure check evaluation and transition logic. Takes already
  fetched values, returns verdicts. No network calls, so it is fully unit
  testable.
- `lib/auth/telegram.ts`, webhook secret verification.
- `lib/server/telegram-io.ts`, every read the bot performs: check inputs, KV
  alert state, and the per command queries. Isolating I/O here is what lets
  `lib/watchdog.ts` stay pure and `lib/telegram.ts` stay copy-only.
- `app/api/telegram/webhook/route.ts`, inbound command handling.
- `app/api/telegram/watchdog/route.ts`, fetch, evaluate, diff, send.
- `scripts/notify-scan-digest.ts`, reads `scan-summary.json` for `discovered`,
  `activated`, `duration_ms`, `rate_limit_dropped` and the largest entry in
  `rejection_breakdown`, then queries `count(wallets where is_active = true)`
  for the resulting active count, which the summary file does not carry. A
  missing or unparseable summary file means the scan died before writing, and
  the digest says so instead of failing silently.
- `lib/__tests__/watchdog.test.ts`, transition table coverage.
- `lib/__tests__/telegram.test.ts`, formatter output and length assertions.

Modified:

- `lib/env.ts`, three new variables.
- `.github/workflows/freshness-check.yml`, three bash checks replaced by one
  authenticated curl to the watchdog route.
- `.github/workflows/daily-wallet-scan.yml`, one new final step with
  `if: always()` plus the three Telegram secrets in its env block.
- `CLAUDE.md`, new routes and env vars documented.

## Testing

`lib/watchdog.ts` is written as pure functions specifically so the state
machine can be tested without network or KV. Tests cover every row of the
transition table above, including the absent state cases, and assert that
`broken to broken` produces no send.

`lib/telegram.ts` formatters are tested for exact output and for a maximum
length assertion, which is what mechanically enforces the brevity requirement
rather than relying on discipline.

Routes are not unit tested, consistent with the existing project convention
that API routes and React components have no unit coverage.

Manual verification before calling this done: trigger `freshness-check.yml` via
`workflow_dispatch` and confirm no message arrives when healthy, then break one
check deliberately and confirm exactly one alert plus one recovery.

## Manual setup, owner tasks

1. Create the bot with BotFather, save the token.
2. Get the chat id by messaging the bot and reading `getUpdates`.
3. Generate a random webhook secret.
4. Add all three to Vercel project env and to GitHub repository secrets.
5. Register the webhook once, passing `secret_token`.

## Risks and accepted tradeoffs

- If Vercel itself is down the watchdog cannot report. Accepted, because the
  Actions curl fails in that case and GitHub's failure email covers it.
- "Alert once then silence" means a missed 3am notification is a missed
  incident until the owner checks manually. Accepted, chosen deliberately over
  repeat reminders. `/check` exists to make the manual path fast.
- Deleting the bash checks from `freshness-check.yml` means the app is now on
  the critical path for freshness alerting. Mitigated by the curl failure mode
  above.
