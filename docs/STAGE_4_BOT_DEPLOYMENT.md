# Stage 4 — Russian Telegram Bot: deployment, BotFather & free-path smoke

**Status:** `STAGE_4_IMPLEMENTATION = READY FOR LIVE DEPLOYMENT TEST`. Code is complete and offline-proven
(`make test` ALL SUITES PASS, `$0`, 0 external calls, every workflow `active=false` in Git). Nothing here has
been deployed, activated, or webhook-registered by the agent — these are the operator steps.

Product timezone: **Europe/Moscow** (`MS_TIMEZONE`, default `Europe/Moscow`). All system-generated timestamps are
stored as RFC3339 with the Moscow offset (`…+03:00`) and shown to users as `DD.MM.YYYY HH:mm МСК`
(`n8n/lib/ms_time.js`). See [DECISIONS DEC-157] and `docs/STAGE3_SHEETS_OPERATIONS_ACCEPTANCE.md`.

---

## 1. Supported commands (all implemented & tested)

The gateway hard-codes `/status` and `/cancel`; the intent router resolves `/start`, `/help`, `/new` (plus the
memory commands `/context`, `/memory`, `/forget`, `/forget_all`). Every command is **deterministic** (no LLM, no
paid call) and replies in Russian.

| Command | Behavior |
|---------|----------|
| `/start` | Russian welcome: what the agent does, several example business tasks, the safe command list. Creates no request, calls no API. (Routes to the welcome/help responder with a `start` marker.) |
| `/help` | Russian capabilities + the approval model + examples + commands; states that facts include sources. No paid call. |
| `/new` | Resets the active conversational draft and starts a fresh request context; keeps history/preferences; tells the user (RU) a new task can be sent. |
| `/status` | The authorized user's current/latest request with a Moscow-time timestamp; handles the no-request state; no internal enum leakage. |
| `/cancel` | Cancels only the authorized user's active request; appends a request event; updates conversation state; idempotent; confirms in Russian; safe on an already-terminal request. |

A normal Russian task message (e.g. *«Найди конкурентов по ПТС в Москве, посмотри сайт»*) runs the free intake →
deterministic plan → approval flow described in §4.

> Not advertised: `reset_all`, `admin`, `debug`, `approve`, `reject` (approve/reject are inline buttons /
> lifecycle callbacks, not typed commands).

---

## 2. BotFather command list (exact)

In **@BotFather → /setcommands**, select the bot, and paste exactly:

```
start - Запустить агента и показать примеры задач
help - Возможности, примеры и порядок согласования
new - Начать новую задачу
status - Статус текущей задачи
cancel - Отменить текущую задачу
```

Do **not** add `reset_all`, `admin`, `debug`, `approve`, or `reject`. Do not call any Telegram API from this
chat — this is a one-time manual BotFather step performed by the operator.

---

## 3. Authorization & update idempotency

- **Authorization:** numeric Telegram **`from.id`** is checked against `MS_TELEGRAM_ALLOWED_USER_IDS`
  (comma/space separated, whitespace trimmed, malformed entries ignored). `chat.id` never substitutes for
  `from.id`. An empty allowlist **fails closed** (nobody authorized). Unauthorized updates get a short Russian
  denial, create no request, and call no API. The allowlist is never echoed to users.
- **Update idempotency:** the gateway keys on Telegram `update_id` (with a `message_id`/`chat_id` fallback), so a
  re-delivered update creates exactly one request / event / conversation row / approval / outbox row / reply. The
  outbox additionally dedups by deterministic `delivery_id`. (Tested: a duplicate update yields zero new rows.)

---

## 4. Approval / rejection flow (free path)

1. Authorized task → conversation state upserted, an `agent_requests` row created, an intake event appended.
2. A **deterministic zero-cost plan** is produced (goal, likely target/competitor, requested output, proposed
   public-source categories, expected external-call budget, whether clarification is needed) — it never claims
   research was already done.
3. The user receives a **Russian plan summary** with inline buttons **✅ Запустить / ✖ Отклонить** (callback data
   carries only bounded identifiers and is validated; the callback owner must match the request owner; stale /
   malformed / duplicate callbacks are rejected; the callback query is answered to stop Telegram's spinner).
4. **Approve** (free-path settings): approval + event recorded, state updated; the user is told (RU) the plan is
   approved **and** that external collection is currently disabled in the safe Stage 4 test mode — Claude / Apify /
   Firecrawl / VK / collectors are **not** called.
5. **Reject:** rejection + event recorded, state updated; the user is told (RU) and offered `/new`.

Approval can **never** bypass the zero-paid guards (§5): the budget gate sees `effective_max_external_calls = 0`.

---

## 5. Zero-paid-call mode (free path)

Resolved in `n8n/lib/agent_config.js` (fail-closed defaults; canonical env names). The free path runs the full
conversation→plan→approval→persistence loop with **zero** paid calls:

```
MS_ENABLE_TELEGRAM=true
MS_ENABLE_EXTERNAL_ACTIONS=false      # master switch for any paid collection/analysis
MS_ENABLE_CLAUDE=false                # gates MS_ENABLE_LLM_PLANNER / MS_ENABLE_LLM_SUMMARY
MS_ENABLE_APIFY=false
MS_ENABLE_FIRECRAWL=false
MS_ENABLE_VK=false
MS_MONITORING_ENABLED=false
MS_WEEKLY_DIGEST_ENABLED=false
MS_MAX_EXTERNAL_CALLS=0               # master kill-switch: 0 => no paid call even after approval
```

`resolveConfig` derives `zero_paid_mode = (enable_external_actions !== true) || (max_external_calls <= 0)` and
`effective_max_external_calls = 0` in that mode; `enable_claude=false` forces the LLM planner/summary off. Helpers
`paidCallsAllowed(cfg)`, `collectorEnabled(cfg, source)`, `llmAllowed(cfg)`, `freePathStatus(cfg)` are the
fail-closed predicates the orchestrator/monitor consult. With the settings above:
`CLAUDE_CALLS = APIFY_CALLS = FIRECRAWL_CALLS = VK_CALLS = COLLECTOR_CALLS = 0`.

---

## 6. Required environment variables

| Variable | Purpose | Free-path value |
|----------|---------|-----------------|
| `MS_SPREADSHEET_ID` | Google Sheets persistence target (an id, not a secret) | the staging/prod spreadsheet id |
| `MS_TELEGRAM_ALLOWED_USER_IDS` | numeric `from.id` allowlist | your Telegram numeric id(s) |
| `MS_TELEGRAM_BOT_TOKEN` | bot token used in the Telegram API URL (**secret**) | set in n8n env only — never in JSON/git/logs |
| `MS_TIMEZONE` | product timezone | `Europe/Moscow` |
| `MS_ENABLE_TELEGRAM` | enable Telegram I/O | `true` |
| `MS_ENABLE_EXTERNAL_ACTIONS` | master paid-action switch | `false` |
| `MS_ENABLE_CLAUDE` / `MS_ENABLE_LLM_PLANNER` / `MS_ENABLE_LLM_SUMMARY` | Claude features | `false` |
| `MS_ENABLE_APIFY` / `MS_ENABLE_FIRECRAWL` / `MS_ENABLE_VK` | per-collector switches | `false` |
| `MS_MONITORING_ENABLED` / `MS_WEEKLY_DIGEST_ENABLED` | schedule activation | `false` |
| `MS_MAX_EXTERNAL_CALLS` | paid-call ceiling | `0` |
| `NODE_FUNCTION_ALLOW_BUILTIN` | `zlib` for XLSX export (only when reports are enabled) | `zlib` |
| `WEBHOOK_URL`, `N8N_HOST`, `N8N_PROTOCOL` | public webhook base (see §9) | your public HTTPS base |

The bot token must be entered **only** into the n8n environment / credential UI — never pasted into chat, git,
logs, or workflow JSON. Workflow JSON references it dynamically as `$env.MS_TELEGRAM_BOT_TOKEN` (verified by test).

---

## 7. Secure token entry

1. Create the bot with **@BotFather**, obtain the token (format `<digits>:<secret>`).
2. Put it in the n8n container environment as `MS_TELEGRAM_BOT_TOKEN` (e.g. in `/opt/n8n/n8n.env`, not in git),
   then recreate the container so it picks up the env. Do **not** echo the value.
3. Verify presence WITHOUT printing the value (masked): `docker exec n8n-n8n-1 sh -c '[ -n "$MS_TELEGRAM_BOT_TOKEN" ] && echo set || echo MISSING'`.

---

## 8. Deploy the 15 runtime workflows (inactive)

From the repo, using the existing tooling (validated, non-mutating dry-run first):

```bash
scripts/deploy_n8n.sh --check-config     # verify MS_SPREADSHEET_ID + MS_TELEGRAM_ALLOWED_USER_IDS (masked)
scripts/deploy_n8n.sh --dry-run          # validate JSON + print import + activation plan; no changes
scripts/deploy_n8n.sh --apply            # import the 15-workflow closure INACTIVE + auto-bind the 8 edges
```

Import order is enforced by the manifest (`config/workflow_manifest.json`): config/callables before callers,
trigger workflows last. Every workflow imports with `active=false`. In the n8n UI, attach credentials: **Google
Sheets** (Service Account) on the Sheets nodes; Claude/Apify/Firecrawl only if/when you enable paid features.
Telegram uses the env token (no Telegram credential needed for the HTTP send nodes).

---

## 9. Public HTTPS + webhook registration & verification

The gateway (WF18) is a webhook node at `POST /webhook/ms-telegram-agent`. Telegram delivers only to a public
**HTTPS** URL. Stand up a public HTTPS endpoint (reverse proxy / tunnel) in front of n8n, set `WEBHOOK_URL`
(and `N8N_PROTOCOL=https`, `N8N_HOST`) so n8n advertises the correct base, then **activate only WF18**:

```bash
scripts/deploy_n8n.sh --activate-triggers   # WF18 always; WF23 only if MS_MONITORING_ENABLED=true; WF25 if weekly digest
```

Register and verify the webhook (operator runs, real token, never pasted here):

```bash
curl -s "https://api.telegram.org/bot<token>/setWebhook?url=https://<public-host>/webhook/ms-telegram-agent"
curl -s "https://api.telegram.org/bot<token>/getWebhookInfo"     # expect url set, no last_error_message
```

---

## 10. Free-path smoke (zero paid calls)

Pre-set the guards in §5 (`MS_MAX_EXTERNAL_CALLS=0`). Then, from an **allowed** Telegram account:

1. `/start` → Russian welcome + examples + commands. No request created, 0 paid calls.
2. `/help` → Russian capabilities + approval model. 0 paid calls.
3. From an **unauthorized** account, send anything → short Russian denial; no request; 0 paid calls.
4. `/status` (no active request) → Russian "no active request".
5. Send a Russian task → Russian plan + ✅/✖ buttons; `agent_requests.state = awaiting_approval`; nothing
   collected; 0 paid calls.
6. Re-send the same Telegram update (same `update_id`) → no second plan, no duplicate row.
7. Tap **✅ Запустить** → Russian "approved; collection disabled in safe test mode"; `approval_decisions`
   recorded; **0** Apify/Firecrawl/Claude/VK calls (budget gate sees `effective_max_external_calls=0`).
8. `/cancel` → Russian cancellation; `agent_requests.state = cancelled`; event appended; idempotent on repeat.
9. `/new` → Russian "new task" confirmation; fresh draft; history preserved.

Pass: all replies in Russian, `external_calls = 0` throughout, no duplicate rows, approval blocked from spending,
cancel is a hard terminal stop.

---

## 11. Google Sheets persistence (free path)

Persisted with canonical headers/keys, Moscow timestamps on new rows, formulas neutralized before any free-text
write, no prior records deleted, no other user's state overwritten: `agent_requests`, `agent_request_events`,
`conversation_state`, `conversation_messages`, `telegram_outbox`.

---

## 12. Rollback

```bash
scripts/deploy_n8n.sh --deactivate-triggers   # unpublish WF18 (+WF23/WF25); callables already inactive
curl -s "https://api.telegram.org/bot<token>/deleteWebhook"     # stop Telegram delivery
# full rollback: deactivate, then delete the imported workflows in the n8n UI.
```

The data volume `n8n_n8n_data` is never removed and the container is never `down -v`'d.
