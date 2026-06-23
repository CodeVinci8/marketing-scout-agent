# Stage 4A — Telegram Live-Readiness Audit (read-only)

**Date:** 2026-06-23 · **Branch:** `fix/stage3-verification-stage4-readiness` · **Mode:** read-only.
**Result:** **BLOCKED** — the Stage 4 Telegram agent stack is not deployed to production and the runtime
prerequisites (env vars, Telegram token/credential, public HTTPS webhook) are not provisioned. No code defect
was found in the agent workflows; the blockers are deployment/provisioning steps that are the operator's to
perform. Nothing was imported, activated, restarted, or modified; no secret value was read or printed.

> Safety: only read-only commands were used — `docker ps`, `docker compose ps`, `docker exec … n8n --version`,
> `docker exec … n8n list:workflow`, a masked `printenv` loop (prints `set(len=N)` / `MISSING`, never values),
> and a read-only sqlite open selecting **only** `id,name,type` from `credentials_entity` (never the encrypted
> `data` column). No `docker rm` / `system prune` / `volume rm` / `compose down`; the production container was
> not stopped or restarted. `export:credentials` was deliberately **not** run (it would emit credential
> contents).

---

## 1. Production n8n health and version

| Property | Value |
|----------|-------|
| Container | `n8n-n8n-1` (service `n8n`) |
| Image | `n8nio/n8n:latest` — **not pinned by digest** (this is QA-010) |
| n8n version | **2.23.3** |
| Status | `Up` (running; ~4h at audit time, container created ~37h prior) |
| Port binding | `127.0.0.1:5678 -> 5678/tcp` — **localhost only, no public exposure** |
| Compose dir | `/opt/n8n` |
| Data volume | `n8n_n8n_data` (persistent; DB `/home/node/.n8n/database.sqlite`, ~20 MB) |
| DB | SQLite (default; no `DB_TYPE` override) |

Health: container is healthy and reachable on localhost. **Not** reachable from the public internet (required
for the Telegram webhook — see §8).

---

## 2. Workflows in production — names, ids, active state, duplicates

`docker exec n8n-n8n-1 n8n list:workflow` returned **7** workflows; `--active=true` returned **0**. All inactive.

| # | id | name | active |
|---|----|------|--------|
| 1 | `RRpdbsQNPo20eAj2` | 03 - Firecrawl Single URL to Resilient Analyzer | false |
| 2 | `Vk7riVk3Ew0Ccova` | 07 - Manual Touchpoint Intake | false |
| 3 | `LyXzme02gAMWK0GB` | 08 - Touchpoint Analyzer | false |
| 4 | `dJ4ZyMVJojWt9kBv` | 09 - Avito Classifieds Listing Connector | false |
| 5 | `bE2HHjma54jMeVca` | 11 - Social Source Connector Foundation (Telegram Public Channel Preview) | false |
| 6 | `6WSdL55Db2nlZws1` | QA - Stage 3 Google Sheets Staging Bootstrap | false |
| 7 | `dgLrLsi4bvH6FtR4` | QA - Stage 3 Google Sheets Operations Acceptance | false |

* **No duplicate names; no duplicate ids.**
* **0 active workflows** → no webhook or schedule trigger is currently registered.
* **None of the 15 runtime-closure workflows (WF17–WF26) are present.** In particular **WF18 (Telegram Agent
  Gateway) is not imported.** Production currently holds only the Stage 1–3 connectors/analyzers plus the two
  Stage 3 QA harnesses.

---

## 3. Runtime workflow manifest — count and import order

Authoritative source: `config/workflow_manifest.json` (single source of truth; n8n_version `2.23.3`).

* Declared workflows: **31**. Runtime closure: **15**. Excluded from runtime: **16** (dev/test/superseded).
* `expected_active_after_import`: **[]** (import leaves everything inactive; activation is a separate step).

**Import order (15, enforced by `scripts/deploy_n8n.sh`):**

```
17_agent_settings_config → 04_firecrawl_url_list_resilient → 08_touchpoint_analyzer →
10_competitor_audience_intelligence_aggregator → 12_market_intelligence_report_builder →
16_source_quality_gate_health_score → 26_vk_public_community_collector → 19_request_planner →
20_agent_orchestrator → 21_deep_competitor_analysis → 22_conversation_control →
24_report_export_delivery → 18_telegram_agent_gateway → 23_scheduled_source_monitor → 25_weekly_digest
```

(Callables and config are imported before the workflows that call them; trigger workflows last.)

---

## 4. Sub-workflow binding edges

`binding_edge_count = 8` (all `executeWorkflow` → `executeWorkflowTrigger`, all `required: true`):

| caller | caller node | → target |
|--------|-------------|----------|
| WF20 Orchestrator | Run WF08 Analyzer | → WF08 Touchpoint Analyzer |
| WF20 Orchestrator | Run WF10 Aggregator | → WF10 Audience Intelligence Aggregator |
| WF20 Orchestrator | Run WF12 Report | → WF12 Market Intelligence Report Builder |
| WF20 Orchestrator | Run WF16 Quality Gate | → WF16 Source Quality Gate |
| WF20 Orchestrator | Run Website Source (WF04) | → WF04 Firecrawl URL List |
| WF21 Deep Analysis | Collect Deep Evidence (WF04) | → WF04 Firecrawl URL List |
| WF23 Scheduled Monitor | Run VK Check (WF26) | → WF26 VK Public Community Collector |
| WF23 Scheduled Monitor | Run Website Check (WF04) | → WF04 Firecrawl URL List |

`callable_targets` (6, never auto-activated): **WF04, WF08, WF10, WF12, WF16, WF26.** Each must carry an Execute
Sub-workflow Trigger and stay inactive; the deploy auto-bind step rewrites caller node ids to the imported
target ids.

---

## 5. Trigger and activation policy

| Workflow | Trigger | Activation rule |
|----------|---------|-----------------|
| WF18 Telegram Agent Gateway | Webhook (`POST /webhook/ms-telegram-agent`) | **always** activated by `--activate-triggers` |
| WF23 Scheduled Source Monitor | Schedule | activated **only** when `MS_MONITORING_ENABLED=true` |
| WF25 Weekly Digest | Schedule | activated **only** when `MS_WEEKLY_DIGEST_ENABLED=true` |
| WF04/08/10/12/16/26 (callables) | Execute Sub-workflow Trigger | **never** activated (invoked by parents only) |
| WF17/19/20/21/22/24 | (called/manual) | not activated as triggers |

Import preserves `active=false`. Activation is a separate, explicit operator step (`--activate-triggers`) that
never activates a callable.

---

## 6. Runtime environment variables — masked presence status

Read with a masked `printenv` loop (`set(len=N)` / `MISSING`; **no values printed**).

| Variable | Status | Needed for |
|----------|--------|-----------|
| `N8N_ENCRYPTION_KEY` | `set(len=64)` | decrypting stored credentials (present ✓) |
| `N8N_HOST` | `set(len=9)` | base host |
| `N8N_PROTOCOL` | `set(len=4)` | scheme — length 4 ⇒ `http` (not `https`) |
| `N8N_PORT` | `set(len=4)` | listen port (⇒ `5678`) |
| `N8N_SECURE_COOKIE` | `set(len=5)` | cookie security |
| `GENERIC_TIMEZONE` / `TZ` | `set(len=13)` | schedule timing |
| `WEBHOOK_URL` | **MISSING** | **public webhook base for the Telegram trigger** |
| `N8N_EDITOR_BASE_URL` | MISSING | editor/webhook base (optional) |
| `MS_SPREADSHEET_ID` | **MISSING** | Sheets persistence target |
| `MS_TELEGRAM_ALLOWED_USER_IDS` | **MISSING** | authorized-user allowlist |
| `MS_TELEGRAM_BOT_TOKEN` | **MISSING** | bot token used in the Telegram API URL |
| `NODE_FUNCTION_ALLOW_BUILTIN` | **MISSING** | `zlib` for XLSX export (WF24/WF25) |
| `NODE_FUNCTION_ALLOW_EXTERNAL` | MISSING | (only if external modules are used) |
| `MS_MONITORING_ENABLED` | MISSING (⇒ default `false`) | WF23 activation |
| `MS_WEEKLY_DIGEST_ENABLED` | MISSING (⇒ default `false`) | WF25 activation |
| `MS_ENABLE_TELEGRAM_COLLECTOR` | MISSING | optional Telegram collector |

The encryption key is present (credentials are usable). **Every Stage 4 application variable is unset**, so the
agent cannot run live until they are provisioned.

---

## 7. Credentials — requirements and node counts

Read from the DB with `id,name,type` only (encrypted `data` never selected). **4** credentials exist:

| name | type | role |
|------|------|------|
| Google Service Account account | `googleApi` | Google Sheets read/write (present ✓) |
| Claude API - Marketing Scout | `httpHeaderAuth` | Claude (optional, off by default) |
| Firecrawl API - Marketing Scout | `httpHeaderAuth` | website scraping |
| Apify API - Marketing Scout | `httpHeaderAuth` | Avito search-card discovery |

* **No `telegramApi` credential exists.** By design the Telegram I/O nodes are **HTTP Request** nodes calling
  `https://api.telegram.org/bot{{ $env.MS_TELEGRAM_BOT_TOKEN }}/…` — the token comes from the **env var**, not a
  credential. So "enter the token in the Telegram credential UI" does **not** apply to the current design; the
  operator instead sets `MS_TELEGRAM_BOT_TOKEN` (currently MISSING). See §10 risk.
* **Nodes requiring manual credential selection in the runtime closure (15 workflows): 36** — **31 `googleApi`**
  + **5 `httpHeaderAuth`**. The Stage 3C QA acceptance workflow adds **7 `googleApi`** selections.
* The existing Google Service Account credential satisfies all `googleApi` nodes; Claude/Firecrawl/Apify
  credentials satisfy the 5 `httpHeaderAuth` nodes. No new credential is required for the website-first free
  path except attaching them on import.

---

## 8. Telegram gateway, public HTTPS & webhook prerequisites

* **Trigger:** generic **Webhook** node (`n8n-nodes-base.webhook`), path **`ms-telegram-agent`**, method
  **POST** → live URL `https://<public-host>/webhook/ms-telegram-agent` (test URL `/webhook-test/…`). It is **not**
  the n8n Telegram Trigger node.
* **Send:** HTTP POST to `https://api.telegram.org/bot{{ $env.MS_TELEGRAM_BOT_TOKEN }}/sendMessage` (and
  `sendDocument`/`answerCallbackQuery` across WF18/20/24/25).
* **Authorization:** sender `user.id` is checked against `MS_TELEGRAM_ALLOWED_USER_IDS` (allowlist); unauthorized
  updates are rejected before any work.
* **Duplicate-update protection:** the gateway builds a duplicate-proof idempotency key from Telegram
  `update_id`, so a re-delivered update creates exactly **one** request; the outbox dedups outbound sends by
  payload hash.
* **Approval:** `n8n/lib/approval_gate.js` in WF20 is the single fail-closed paid-call gate (`MS_REQUIRE_APPROVAL`
  default `true`); collection runs only after the operator taps approve.
* **Supported commands (verified in code):** the gateway parser hard-codes **`/status`** and **`/cancel`**; the
  intent router additionally recognizes **`/help`**, **`/new`**, **`/context`**, **`/memory`**, **`/forget`**,
  **`/forget_all`**. Any other slash input becomes `kind='command'` and is routed through NL classification.
  **`/start` is not a dedicated handler** — it falls through to NL and yields a help/clarification reply (minor
  gap vs. the conventional `/start` onboarding; consider adding an explicit `/start` → help mapping). **Source
  management has no `/source` slash command** — it is natural-language-routed (`add_source` / `manage_sources`
  intents, e.g. *"добавь источник …"* / *"покажи источники"*) handled by WF22. Inline-button callbacks use
  `intent:<id>`.

**Public HTTPS prerequisite (currently unmet):** Telegram only delivers webhooks to a **public HTTPS** URL with a
valid certificate. Today n8n is `http` on `127.0.0.1:5678` with `WEBHOOK_URL` unset. Live readiness requires:
1. a public HTTPS endpoint terminating TLS in front of n8n (reverse proxy or tunnel) — operator/infra step;
2. `WEBHOOK_URL=https://<public-host>/` (and typically `N8N_PROTOCOL`/`N8N_HOST`/`N8N_EDITOR_BASE_URL`) set so
   n8n advertises the correct webhook base;
3. registering the webhook with Telegram **once** (operator runs, with the real token, never pasted here):
   `setWebhook` →
   `https://api.telegram.org/bot<token>/setWebhook?url=https://<public-host>/webhook/ms-telegram-agent`;
4. verify with `getWebhookInfo` →
   `https://api.telegram.org/bot<token>/getWebhookInfo` (expect the URL set, `pending_update_count` draining,
   no `last_error_message`).

This `setWebhook`/`getWebhookInfo` step and the public-HTTPS requirement are **not** in `docs/STAGE_4_AGENT.md`
(it predates the switch from a Telegram Trigger to a generic webhook node) — this section is the canonical
procedure.

---

## 9. Free-path zero-paid-call smoke sequence (20 steps)

Goal: exercise the gateway, auth, dedup, commands, planning, approval gate and persistence **without any paid
external call**. Run only after §11 deployment + §8 webhook are in place. Set a hard ceiling first:
`MS_REQUIRE_APPROVAL=true`, `MS_ENABLE_LLM_PLANNER=false`, `MS_ENABLE_LLM_SUMMARY=false`, `MS_MAX_EXTERNAL_CALLS=0`,
`MS_SOURCE_BUDGET_USD=0`, `MS_LLM_BUDGET_USD=0`. With the call ceiling at 0, every approval is blocked by the
budget gate, so **no paid call can occur** even if approved.

| # | INPUT | EXPECTED TELEGRAM RESPONSE | EXPECTED WORKFLOW | EXPECTED SHEET CHANGES | EXPECTED EXTERNAL CALLS | STOP CONDITION |
|---|-------|---------------------------|-------------------|------------------------|-------------------------|----------------|
| 1 | (operator) confirm only WF18 active | n/a | `n8n list:workflow --active=true` ⇒ WF18 only | none | 0 | any callable active ⇒ STOP |
| 2 | `getWebhookInfo` (operator) | n/a | webhook URL = `…/webhook/ms-telegram-agent`, no error | none | 1 (Telegram, free) | error/empty URL ⇒ STOP |
| 3 | `/help` from an **unauthorized** account | no reply, or a polite refusal | WF18 rejects on allowlist | none | 0 | any work performed ⇒ STOP |
| 4 | `/help` from an **allowed** account | capability/command help | WF18 → intent router (`help`) | conversation row upserted | 1 (sendMessage) | no reply ⇒ STOP |
| 5 | plain greeting *"привет"* | NL fallback help/clarify (no `/start` handler) | WF18 → NL router | conversation turn persisted | 1 | crash/empty ⇒ STOP |
| 6 | `/status` (no active request) | "no active request" / idle status | WF18 (hard-coded `status`) | none | 1 | crash/blank ⇒ STOP |
| 7 | NL *"покажи источники"* (list) | tracked-sources list or "none yet" | WF18 → WF22 (`manage_sources`) | none (read) | 1 | unhandled error ⇒ STOP |
| 8 | free text: *"Найди конкурентов по ПТС в Москве, посмотри сайт"* | a **plan** + ✅/✖ buttons; nothing collected yet | WF18 → WF19 planner | `agent_requests` row `state=awaiting_approval`; plan persisted | 1 (sendMessage) | auto-collection before approval ⇒ STOP |
| 9 | re-send the **same** Telegram update (duplicate `update_id`) | no second plan | WF18 dedup | **no** new `agent_requests` row | 0 | duplicate row created ⇒ STOP |
| 10 | tap **✅ Запустить** | "budget/limit reached" or refusal — **no collection** | WF20 approval+budget gate | `approval_decisions` recorded; **no** `source_health`/raw rows | 0 (blocked by `MS_MAX_EXTERNAL_CALLS=0`) | any Apify/Firecrawl call ⇒ STOP |
| 11 | `/status` | shows the request blocked/awaiting, not "collecting" | WF18 | state reflects the block | 1 | state shows paid progress ⇒ STOP |
| 12 | tap the **same** approve button again | no double-spend, same idempotency key | WF20 gate | no new approval/collection | 0 | second collection attempt ⇒ STOP |
| 13 | `/cancel` | "cancelled" confirmation | WF18 → WF20 | `agent_requests.state=cancelled` | 1 | cannot cancel ⇒ STOP |
| 14 | tap approve on the **cancelled** request | refusal (terminal state) | WF20 state machine | no collection | 0 | runs after cancel ⇒ STOP |
| 15 | `/new` then a vague request *"что нового?"* | clarification question | WF18 → WF19 | new conversation turn persisted | 1 | external work from vague input ⇒ STOP |
| 16 | answer the clarification with a scoped query | refined plan + buttons | WF19 | new `agent_requests` `awaiting_approval` | 1 | no plan ⇒ STOP |
| 17 | NL *"добавь источник example.com"* | "added / will track" (RFC-2606 example) | WF18 → WF22 (`add_source`) | `tracked_sources` row added once | 1 | duplicate/no-add ⇒ STOP |
| 18 | NL *"добавь источник example.com"* again | "already tracked" (idempotent) | WF22 (`add_source`) | **no** duplicate `tracked_sources` row | 1 | duplicate created ⇒ STOP |
| 19 | unknown text *"asdfgh"* | graceful fallback / help, no crash | WF18 intent router | conversation turn persisted | 1 | unhandled exception ⇒ STOP |
| 20 | `/status` final | clean idle/terminal status | WF18 | consistent state | 1 | inconsistent state ⇒ STOP |

**Pass:** all replies as expected, `external_calls` (paid: Apify/Firecrawl/Claude/VK) **= 0** throughout,
`execution_summaries.llm_primary_calls = 0`, no duplicate rows, approval gate blocks every paid attempt, cancel
is a hard terminal stop. The only network calls are free Telegram Bot API sends/receives.

---

## 10. Deployment, activation, webhook-verify & rollback commands

All validated by reading `scripts/deploy_n8n.sh` (syntax-checked with `bash -n`, **not executed**) and the
offline `deploy-preflight` test (21 checks PASS). The script masks the spreadsheet id in its config check
(`set(len=…)`), never printing it.

**Preflight / dry-run (non-mutating):**
```bash
scripts/deploy_n8n.sh --check-config     # verify MS_SPREADSHEET_ID + MS_TELEGRAM_ALLOWED_USER_IDS present (masked)
scripts/deploy_n8n.sh --dry-run          # validate JSON + print import plan + activation plan; no changes
```

**Apply (import inactive + auto-bind, never activates):**
```bash
scripts/deploy_n8n.sh --apply [--yes]
# underlying per-file: n8n import:workflow --input=<file> --activeState=false
# then auto-binds the 8 Execute-Sub-workflow caller node ids to the imported target ids
```

**Activate triggers (explicit, operator-only):**
```bash
scripts/deploy_n8n.sh --activate-triggers
# WF18 always; WF23 only if MS_MONITORING_ENABLED=true; WF25 only if MS_WEEKLY_DIGEST_ENABLED=true
# underlying: n8n publish:workflow --id=<id>   (2.23.3; deprecated fallback: n8n update:workflow --id=<id> --active=true)
# never activates a callable
```

**Webhook registration + verify (operator, real token — never pasted into chat/git):**
```bash
# set once, after a public HTTPS endpoint + WEBHOOK_URL exist:
curl -s "https://api.telegram.org/bot<token>/setWebhook?url=https://<public-host>/webhook/ms-telegram-agent"
curl -s "https://api.telegram.org/bot<token>/getWebhookInfo"     # expect url set, no last_error_message
```

**Rollback:**
```bash
scripts/deploy_n8n.sh --deactivate-triggers
# underlying: n8n unpublish:workflow --id=<id>  (deprecated fallback: n8n update:workflow --id=<id> --active=false)
curl -s "https://api.telegram.org/bot<token>/deleteWebhook"      # stop Telegram delivery
# full rollback: deactivate, then delete the imported workflows in the n8n UI.
# the persistent volume n8n_n8n_data is never removed; the container is never `down -v`'d.
```

---

## 11. Blocking defects

These block a **live** Stage 4 run; none is a code defect in the workflows (no code change was made):

1. **Stage 4 stack not deployed** — none of the 15 runtime workflows (esp. WF18 gateway) are imported; 0 active.
2. **Application env vars unset** — `MS_SPREADSHEET_ID`, `MS_TELEGRAM_ALLOWED_USER_IDS`, `MS_TELEGRAM_BOT_TOKEN`
   all MISSING.
3. **No public HTTPS webhook** — n8n is `http` on `127.0.0.1:5678`, `WEBHOOK_URL` unset; Telegram cannot reach
   `…/webhook/ms-telegram-agent`, and `setWebhook` has not been done.
4. **`NODE_FUNCTION_ALLOW_BUILTIN` unset** — XLSX export (WF24/WF25 via `zlib`) will fail until set (only blocks
   the report-export/digest path, not the core conversation/collection path).

Each is an operator provisioning/deployment step, documented in §8/§10.

---

## 12. Non-blocking risks

1. **Image not pinned** (`n8nio/n8n:latest`) — QA-010; a pull could change the runtime version under the
   workflows. Pin by digest in `/opt/n8n/docker-compose.yml`.
2. **Bot token in the request URL via env var** — `…/bot{{ $env.MS_TELEGRAM_BOT_TOKEN }}/…`. The token is not in a
   credential, and a URL can be persisted in execution logs. Mitigations: keep execution logging minimal / do
   not save successful-execution data with full URLs, or migrate the Telegram send nodes to an
   `httpHeaderAuth`/`telegramApi` credential. (Pre-existing design; out of scope for this read-only audit — flagged
   for a decision, not changed here.)
3. **Stage 1–3 + QA workflows sit inactive in production** — harmless (no triggers) but they should be confirmed
   inactive before/after any Stage 4 activation so an unexpected trigger never fires.
4. **`docs/STAGE_4_AGENT.md` deploy section is stale** — it lists WF17–WF20 only and a Telegram-Trigger mental
   model; the current runtime is 15 workflows with a generic webhook node. §3/§8/§10 here are authoritative until
   that doc is refreshed.

---

## 13. Stage 4A final status

**BLOCKED on operator provisioning** (no code blocker). `STAGE_4_IMPLEMENTATION = READY FOR LIVE DEPLOYMENT
TEST`. The agent code is present and offline-proven, the Google Service Account credential exists, and the
deployment/rollback tooling is sound. Live readiness is blocked solely on operator provisioning: deploy the
15-workflow runtime closure (inactive) → attach credentials → set the Stage 4 env vars → stand up a public HTTPS
endpoint + `WEBHOOK_URL` → register the Telegram webhook → activate WF18 → run the free-path smoke (0 paid calls)
→ then the single controlled paid E2E. No production change was made by this audit.

### 13a. Updates since the original audit (DEC-157)
- **`/start` is now a dedicated deterministic command** (Russian welcome + examples + command list, no API) —
  the gap noted in §8 is closed. `/help /new /status /cancel` remain deterministic.
- **Explicit zero-paid free-path guards** in `agent_config` (`enable_telegram`, `enable_external_actions`,
  `enable_claude`, `enable_apify/firecrawl/vk`, `monitoring_enabled`, `weekly_digest_enabled`;
  `MS_MAX_EXTERNAL_CALLS=0` master kill-switch; `zero_paid_mode`/`effective_max_external_calls`). Approval cannot
  bypass them.
- **Europe/Moscow** product timezone for all system timestamps (`n8n/lib/ms_time.js`).
- The exact BotFather command list, secure-token entry, deploy/webhook/smoke/rollback steps now live in the
  canonical **`docs/STAGE_4_BOT_DEPLOYMENT.md`** (authoritative; this audit's §8–§10 remain valid).
