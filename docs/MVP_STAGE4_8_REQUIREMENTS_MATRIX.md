# Vinci AI Pilot — Stage 4–8 Requirements Matrix

Each requirement maps to its implementation file(s), workflow(s), offline test(s), and an honest status.
Statuses: `IMPLEMENTED` · `OFFLINE_PASS` · `LIVE_PENDING` · `BLOCKED_BY_CREDENTIAL` · `EXPERIMENTAL` · `UNSUPPORTED`.
Machine‑readable form: `config/stage_acceptance_manifest.json`.

## 0. Release gate — generated Code compiles

| Requirement | Implementation | Workflow | Test | Status |
|---|---|---|---|---|
| Embedded modules isolated (no `MS_TZ`‑class collisions) | `tools/embed_lib.js` `isolatedModule()`; `gen_sheets_operations_qa_workflow.js` | `ops/.../qa_stage3_sheets_operations_acceptance.json` | `test_generated_code_compiles` | IMPLEMENTED · OFFLINE_PASS |
| Every Code node parses (all generators + committed JSON) | `tools/gen_stage4_workflows.js` (importable registry) | all 33 workflows / 215 nodes | `test_generated_code_compiles` | IMPLEMENTED · OFFLINE_PASS |

## 1. Identity & Russian UX (Sections 7–10)

| Requirement | Implementation | Workflow | Test | Status |
|---|---|---|---|---|
| Versioned canonical identity ("Я Vinci AI Pilot — …") | `n8n/lib/agent_identity.js` (`identity-v1`) | WF18 (charter embed) | `test_agent_identity` | IMPLEMENTED · OFFLINE_PASS |
| Canonical Claude system prompt (versioned) | `agent_identity.systemPrompt()` (`vinci-system-v1`) | WF08/WF20 (Claude flows) | `test_agent_identity` | IMPLEMENTED · LIVE_PENDING (Claude off) |
| Deterministic identity answers (no request/paid call/pipeline) | `agent_identity.identityAnswer()`, `intent_router` help route | WF18 | `test_agent_identity`, `test_agent_contracts` | IMPLEMENTED · OFFLINE_PASS |
| Charter carries Vinci identity | `agent_charter.js` (`charter-v2`) | WF18/19/20/21/22 | `test_agent_contracts` | IMPLEMENTED · OFFLINE_PASS |
| Russian visible states (start/help/new/status/cancel/errors/progress…) | `conversation_response`, `progress_tracker`, `agent_charter.capabilityCatalogText` | WF18/WF20 | `test_stage4_*`, `test_agent_workflows`, `test_progress_tracker` | IMPLEMENTED · OFFLINE_PASS |
| Public command menu (exact, Russian, no internal cmds) | `scripts/configure_telegram_commands.sh` | — | `test_telegram_commands` | IMPLEMENTED · OFFLINE_PASS · LIVE_PENDING |
| No internal leakage (node/wf ids, creds, env, traces) | `agent_identity.systemPrompt`, response builders | WF18/20 | `test_agent_identity`, `test_url_safety` | IMPLEMENTED · OFFLINE_PASS |

## 2. Conversation, clarification, approval (Sections 11–13)

| Requirement | Implementation | Workflow | Test | Status |
|---|---|---|---|---|
| Deterministic intent routing | `intent_router.js` | WF18 | `test_agent_contracts` | IMPLEMENTED · OFFLINE_PASS |
| Bounded clarification (reuse context, ≤2 questions) | `intent_router`, `conversation_memory`, `request_planner` | WF19 | `test_agent_contracts`, `test_intake_gates` | IMPLEMENTED · OFFLINE_PASS |
| Approval / callback (owner + state + idempotency) | `approval_gate.js` | WF20 | `test_stage4_contracts`, `test_agent_e2e` | IMPLEMENTED · OFFLINE_PASS |
| Conversation context (active/last report/selected/pending) | `conversation_memory.js`, `agent_state.js` | WF20/22 | `test_agent_contracts`, `test_release_e2e` | IMPLEMENTED · OFFLINE_PASS |

## 3. Progress & follow‑up (Sections 14–15)

| Requirement | Implementation | Workflow | Test | Status |
|---|---|---|---|---|
| Single editable, throttled progress message; milestone %, monotonic | `progress_tracker.js` | WF20 | `test_progress_tracker` | IMPLEMENTED · OFFLINE_PASS |
| Immediate ack; chat action; edit idempotency; failure card | `progress_tracker`, `telegram_io` | WF20 | `test_progress_tracker` | IMPLEMENTED · OFFLINE_PASS |
| Context‑aware follow‑up actions (available caps only) | `conversation_response.followupSuggestions/actionButtons` | WF20 | `test_agent_contracts`, `test_reporting_e2e` | IMPLEMENTED · OFFLINE_PASS |

## 4. Authorization, idempotency, delivery (Sections 16–18)

| Requirement | Implementation | Workflow | Test | Status |
|---|---|---|---|---|
| Allowlist (from.id; comma list; fail‑closed) | `agent_config.isAllowedUser`, `telegram_io.parseUpdate` | WF18 | `test_stage4_freepath`, `test_stage4_contracts` | IMPLEMENTED · OFFLINE_PASS |
| Update/callback idempotency (`update_id`) | `telegram_io`, replay fixtures | WF18/20 | `test_stage4_e2e`, `test_stage4_freepath` | IMPLEMENTED · OFFLINE_PASS |
| Outbox: escaping, 3900 chunking, retries, dead‑letter, no dup send | `telegram_io`, `telegram_channel`, `attachment_router` | WF20/24 | `test_attachment_routing`, `test_stage4_*` | IMPLEMENTED · OFFLINE_PASS |
| Rate limiting | `agent_config` limits + `progress_tracker` throttle | WF18/20 | `test_progress_tracker`, `test_stage4_contracts` | IMPLEMENTED · OFFLINE_PASS |

## 5. Adapters (Sections 21–23)

| Adapter | Implementation | Workflow | Test | Status |
|---|---|---|---|---|
| Canonical adapter contract + error taxonomy | `source_adapter.js` | WF20 | `test_stage4_contracts`, `test_website_pipeline` | IMPLEMENTED · OFFLINE_PASS |
| Website‑first collector + SSRF + prompt‑injection | `url_safety.js`, WF04/WF16/WF08 | WF04/16/08 | `test_url_safety`, `test_website_pipeline` | IMPLEMENTED · OFFLINE_PASS |
| Firecrawl / Apify (guarded, disabled by default) | WF03/04/05, `agent_config` flags | WF03/04/05 | `test_wf04_*`, `test_wf05_classify`, `test_wf09_*` | IMPLEMENTED · BLOCKED_BY_CREDENTIAL |
| Claude API (guarded) | WF02 family, `agent_identity.systemPrompt` | WF02/08/20 | `test_quality_gate`, `test_stage3_gates` | IMPLEMENTED · BLOCKED_BY_CREDENTIAL |
| VK public community (optional) | `vk_collector.js` | WF26 | `test_vk_collector` | IMPLEMENTED · BLOCKED_BY_CREDENTIAL |
| Avito classifieds | WF09, `source_adapter` (`experimental`) | WF09 | `test_wf09_*` | EXPERIMENTAL |

## 6. Research pipeline, evidence, calculations, reports (Sections 24–30)

| Requirement | Implementation | Workflow | Test | Status |
|---|---|---|---|---|
| Evidence/provenance model (claims↔evidence) | `evidence.js`, `lineage.js` | WF12/20 | `test_evidence`, `test_lineage_*` | IMPLEMENTED · OFFLINE_PASS |
| Normalization / dedup / entity resolution | `semantic_core.js`, `quality_gate.js`, `report_compare.js` | WF10/12/16 | `test_semantic_contract`, `test_report_compare` | IMPLEMENTED · OFFLINE_PASS |
| Calculations (price stats, %, CAGR, scores, confidence) | `report_export`, `xlsx_writer`, `deep_analysis`, `report_charts` | WF12/24 | `test_xlsx_writer`, `test_report_charts`, `test_deep_analysis_*` | IMPLEMENTED · OFFLINE_PASS |
| Report structure + Google Sheets + XLSX export | `report_package`, `report_export`, `xlsx_writer`, `config/sheets_contracts.json` | WF12/24 | `test_report_export`, `test_xlsx_writer`, `test_sheets_contracts` | IMPLEMENTED · OFFLINE_PASS |
| Telegram report delivery (summary + export + follow‑up) | `conversation_response.deliveryBody`, `attachment_router` | WF24 | `test_reporting_workflows`, `test_reporting_e2e` | IMPLEMENTED · OFFLINE_PASS |
| Full fixture E2E (request→…→follow‑up) | reporting/agent E2E harnesses | WF18→20→24 | `test_reporting_e2e`, `test_agent_e2e` | IMPLEMENTED · OFFLINE_PASS · LIVE_PENDING |

## 7. Monitoring, digest, reliability, cost (Sections 31–34)

| Requirement | Implementation | Workflow | Test | Status |
|---|---|---|---|---|
| Scheduled monitoring + change detection (suppress cosmetic) | `source_monitor.js` | WF23 | `test_monitoring` | IMPLEMENTED · OFFLINE_PASS · inactive default |
| Weekly digest (per owner/ISO week, suppress empty) | `weekly_digest.js` | WF25 | `test_weekly_digest` | IMPLEMENTED · OFFLINE_PASS · inactive default |
| Retries, dead‑letter, retention, refresh policy | `telegram_io`, `retention_policy.js`, `refresh_policy.js` | WF24/23 | `test_refresh_policy`, `test_attachment_routing` | IMPLEMENTED · OFFLINE_PASS |
| Cost ledger + budget guards + zero‑paid mode | `agent_config` (`zero_paid_mode`, `effective_max_external_calls`, `paidCallsAllowed`) | WF17/20 | `test_stage4_freepath`, `test_wf07_cost` | IMPLEMENTED · OFFLINE_PASS |

## 8. Release engineering (Sections 35–36, 42)

| Requirement | Implementation | Workflow | Test | Status |
|---|---|---|---|---|
| Env/credential/disk preflight | `tools/preflight_config.js`, `scripts/check_n8n_runtime.sh` | — | `test_deploy_preflight`, `test_smoke_hardening` | IMPLEMENTED · OFFLINE_PASS |
| Inactive deploy + manifest closure + binding verify + dup/placeholder | `scripts/deploy_n8n.sh`, `tools/audit_workflows.js`, `validate_workflow_manifest.js` | manifest (15 closure / 8 edges) | `test_workflow_manifest`, `test_release_audit`, `test_binding_tool` | IMPLEMENTED · OFFLINE_PASS |
| Disposable import smoke (fail‑closed) | `scripts/n8n_import_smoke.sh`, `scripts/lib/disposable_n8n.sh` | — | `test_smoke_hardening` | IMPLEMENTED · LIVE_PENDING |
| Backup / rollback / restore | `scripts/backup.sh.example`, `restore.sh.example`, `deploy_n8n.sh` rollback | — | `test_deploy_preflight` | IMPLEMENTED · LIVE_PENDING |
| n8n version pinning (`latest` → `2.23.3`) | `ops/n8n/docker-compose.pinned.example.yml`, `docs/N8N_VERSION_PINNING.md` | — | `test_workflow_manifest` (expected 2.23.3) | IMPLEMENTED · LIVE_PENDING |

## 9. Stage 3C final verifier (Section 20)

| Requirement | Implementation | Workflow | Test | Status |
|---|---|---|---|---|
| Identity match / non‑empty staging / decimal‑comma / rendered ts / run isolation / formula‑safety typed read | `n8n/lib/sheets_operations_qa.js`, `ms_time.js` | `qa_stage3_sheets_operations_acceptance.json` | `test_sheets_operations_qa`, `test_ms_time` | IMPLEMENTED · OFFLINE_PASS · **QA‑018/019 FIXED IN CODE — LIVE RETEST REQUIRED** |
