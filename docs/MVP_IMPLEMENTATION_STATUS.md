# Vinci AI Pilot — MVP Implementation Status (Stages 3C–8)

_Single resumable status file. Updated per coherent stage. **No stage is marked live‑PASS** — live
verification stays pending until the operator supplies credentials and runs the documented sequences
(`docs/MVP_LIVE_ROLLOUT_RUNBOOK.md`)._

Branch: `feat/vinci-mvp-stage4-8` (off `fix/stage3-verification-stage4-readiness` @ `f1a9d47`).
Offline regression: `make test` / `node tests/run_all.js` → **ALL SUITES PASS (external calls=0, live cost=$0)**.

Status vocabulary: `IMPLEMENTED` · `OFFLINE_PASS` · `LIVE_PENDING` · `BLOCKED_BY_CREDENTIAL` · `EXPERIMENTAL` · `UNSUPPORTED`.

---

## Release‑blocking defect (fixed)

| Item | Status | Evidence |
|------|--------|----------|
| `Identifier 'MS_TZ' has already been declared` in `Init, Guard & Embed Engine` | **FIXED (root cause)** | `tools/embed_lib.js` `isolatedModule()`; engine now embedded in an IIFE; `tests/test_generated_code_compiles.js` parses all 215 Code nodes across 33 workflows + every generator's in‑memory output |
| Generated Code‑node compilation coverage | **IMPLEMENTED / OFFLINE_PASS** | `tests/test_generated_code_compiles.js` (51 assertions); wired first in `run_all.js` |

---

## Stage status

| Stage | Scope | Status | Next operator action |
|-------|-------|--------|----------------------|
| **3C** | Google Sheets operations acceptance (empty + populated staging) | IMPLEMENTED · OFFLINE_PASS · **QA‑018/019 FIXED IN CODE — LIVE RETEST REQUIRED** | Re‑import corrected QA workflow, dry‑run, live write, repeat‑run, dry‑run |
| **4** | Russian Telegram conversational agent, zero‑paid free path | IMPLEMENTED · OFFLINE_PASS · LIVE_PENDING | Deploy inactive runtime, set token, register webhook, activate WF18, Russian smoke |
| **5** | Integration adapters (website/Claude/Firecrawl/Apify/VK/Avito) | IMPLEMENTED (website first‑class) · OFFLINE_PASS · LIVE_PENDING / BLOCKED_BY_CREDENTIAL · Avito=EXPERIMENTAL | One adapter at a time, credential preflight, bounded live smoke |
| **6** | Evidence‑backed research pipeline → report → export → delivery → follow‑up | IMPLEMENTED · OFFLINE_PASS (fixture E2E) · LIVE_PENDING | One approved real research request after Stage 5 |
| **7** | Monitoring, change detection, weekly digest, reliability | IMPLEMENTED · OFFLINE_PASS · LIVE_PENDING · inactive by default | Enable WF23/WF25 with `MS_MONITORING_ENABLED` / `MS_WEEKLY_DIGEST_ENABLED` |
| **8** | Release engineering: preflight, backup, deploy, rollback, E2E | IMPLEMENTED · OFFLINE_PASS (dry‑run) · LIVE_PENDING | Run preflight → backup → clean deploy validation → E2E → rollback drill |

---

## What is complete offline

- **Identity:** `n8n/lib/agent_identity.js` (`identity-v1` / `vinci-system-v1`) + `agent_charter.js` (`charter-v2`). Deterministic Russian identity answers; zero request, zero paid call. Canonical Claude system prompt versioned.
- **Telegram free path:** WF17–22 + `agent_config` (canonical `MS_ENABLE_*` / `MS_MAX_EXTERNAL_CALLS` zero‑paid flags), `telegram_io` (parse/auth/idempotency/outbox/escape/chunk), `progress_tracker` (single editable throttled progress message), `intent_router`, `conversation_memory`, `conversation_response`, `approval_gate`, `agent_state`, `request_planner`, `ms_time` (Europe/Moscow).
- **Command menu:** `scripts/configure_telegram_commands.sh` (dry‑run default, env‑only token, fail‑closed verify).
- **Adapters:** `source_adapter` canonical contract (website first‑class; Avito experimental; VK optional), `vk_collector`, `url_safety` (SSRF + prompt‑injection).
- **Pipeline / reporting:** `evidence`, `report_export`, `xlsx_writer`, `report_charts`, `report_compare`, `report_filter`, `report_gate`, `report_package`, `deep_analysis`, `scope_preview`, `semantic_core`, `quality_gate`.
- **Monitoring / reliability:** `source_monitor`, `weekly_digest`, WF23, WF25, `refresh_policy`, `retention_policy`, `tracked_sources`, `lineage`.
- **Release tooling:** `scripts/deploy_n8n.sh`, `tools/audit_workflows.js`, `tools/validate_workflow_manifest.js`, `tools/preflight_config.js`, disposable import smokes, `scripts/backup.sh.example` / `restore.sh.example`.

## Pending live (blockers)

- Telegram bot token + allowlisted user id (`MS_TELEGRAM_BOT_TOKEN`, `MS_TELEGRAM_ALLOWED_USER_IDS`) — not in Git.
- Google Service Account credential selected in n8n + staging/production spreadsheet id (`MS_SPREADSHEET_ID`).
- Claude / Firecrawl / Apify / VK credentials — each adapter `BLOCKED_BY_CREDENTIAL` until provisioned and enabled.
- Production n8n still runs `n8nio/n8n:latest`; pin to `2.23.3` per `docs/N8N_VERSION_PINNING.md` (preflight warns).

## Experimental / deferred (recorded, not hidden)

- **Avito** public‑data adapter: `EXPERIMENTAL` (search‑card discovery only; honest setup‑required path).
- **VK** collector: `optional` — its absence must not break the website E2E (proven offline).
- Per‑user timezones: abstraction present (`ms_time`), behaviour deferred (single product TZ `Europe/Moscow`).

## Invariants preserved

- 31 manifest workflows · 15‑workflow runtime closure · **8 executeWorkflow binding edges** · all workflows `active=false` · expected n8n `2.23.3`.
- 0 unexpected external calls · 0 live API calls · 0 secrets in Git · 0 hard‑coded production IDs · 0 generated Code‑node syntax errors.
