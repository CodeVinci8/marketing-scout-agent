# Vinci AI Pilot — Security Review (Stages 4–8)

Focused review of the controls required by the MVP brief. Each control lists its implementation, the offline
regression that exercises it, and residual risk. All checks are offline ($0, 0 external calls).

| # | Control | Implementation | Offline test | Residual risk |
|---|---------|----------------|--------------|---------------|
| 1 | **Secret management** | Tokens/keys only in env + n8n credential store; never in workflow JSON, argv, logs, fixtures, or Git. `configure_telegram_commands.sh` reads `MS_TELEGRAM_BOT_TOKEN` from env, masks it, passes the URL to curl via a stdin config (not argv). | `test_telegram_commands`, repo secret scan | Operator must keep credentials out of screenshots. |
| 2 | **Telegram authorization** | `agent_config.isAllowedUser` validates `from.id` (not just chat.id); comma list; trims; fail‑closed when empty. | `test_stage4_freepath`, `test_stage4_contracts` | Allowlist correctness is operator‑set. |
| 3 | **Callback ownership** | `approval_gate` validates callback owner + request state; stale/wrong‑owner/malformed callbacks fail safely. | `test_stage4_contracts`, `test_agent_e2e` | — |
| 4 | **Update idempotency** | `telegram_io` keys on `update_id`; replay fixtures prove one request/event/send per update. | `test_stage4_e2e`, `test_stage4_freepath` | — |
| 5 | **SSRF** | `url_safety` allows only http/https; blocks localhost, private/link‑local IPv4+IPv6, file URLs, metadata endpoints; re‑checks redirects. | `test_url_safety` | DNS‑rebind mitigated by re‑check; live resolver behaviour to confirm in Stage 5. |
| 6 | **Formula injection** | `report_export.neutralize` / `sheet_audit.isUnsafeCell`; user text always formula‑neutralized; QA proves USER_ENTERED writes stay `stringValue`. | `test_report_export`, `test_sheets_operations_qa` | — |
| 7 | **Prompt injection** | Collected web content treated as untrusted data; `agent_identity.systemPrompt` forbids following page instructions; raw content preserved separately. | `test_url_safety`, `test_agent_identity` | LLM‑side adherence verified live in Stage 6. |
| 8 | **Webhook exposure** | Only WF18 webhook is registered/activated; manifest activation plan = WF18 only (default). | `test_workflow_manifest` | Operator registers webhook in Stage 4 step 6. |
| 9 | **Rate limiting** | `agent_config` limits + `progress_tracker` edit throttle (min interval, max edits, no‑op suppression). | `test_progress_tracker`, `test_stage4_contracts` | — |
| 10 | **Data retention** | `retention_policy` + `refresh_policy`; cleanup dry‑run; no destructive verbs constructed in QA code. | `test_refresh_policy`, `test_sheets_operations_qa` | Live retention windows operator‑set. |
| 11 | **Raw‑response storage** | Adapters preserve raw response + content hash separately from normalized fields. | `test_website_pipeline`, `test_vk_collector` | — |
| 12 | **PII minimization** | Public‑data only; outreach/contact policy enforced (`docs/CONTACT_AND_OUTREACH_POLICY.md`). | `test_website_pipeline` | Operator scope discipline. |
| 13 | **Error leakage** | No node/wf ids, creds, env names, or stack traces in user‑facing text; identity prompt forbids exposure. | `test_agent_identity` | — |
| 14 | **Workflow activation** | All committed workflows `active=false`; only approved triggers activate; audit hard‑fails on public callable. | `test_workflow_manifest`, `test_release_audit`, `audit_workflows.js` | — |
| 15 | **Budget bypass** | Approval cannot bypass cost controls; `zero_paid_mode` forces `effective_max_external_calls=0`; `paidCallsAllowed` requires both flag + budget>0. | `test_stage4_freepath`, `test_wf07_cost` | — |
| 16 | **Cross‑user state isolation** | Owner‑scoped reads/writes in conversation, monitoring, digest; `weekly_digest` strict per‑owner; QA isolates by owner/request. | `test_weekly_digest`, `test_monitoring`, `test_sheets_operations_qa` | — |

## Module‑isolation hardening (this branch)

The `MS_TZ` collision was a code‑composition defect, not a runtime injection, but it is now structurally
prevented: `tools/embed_lib.js` `isolatedModule()` confines every embedded module's private constants to an
IIFE, and `tests/test_generated_code_compiles.js` parses every Code node body in every workflow + every
generator output. A leaked private identifier can no longer reach a node's top‑level scope, and any future
syntax‑level regression fails the offline gate before deploy.

## Honest residual / live‑only items

- LLM adherence to the system prompt (prompt‑injection resistance, no fabrication) is verifiable only with
  Claude enabled (Stage 6).
- Live SSRF resolver behaviour and provider rate‑limit handling are confirmed during Stage 5 bounded smokes.
- Secret hygiene in the live n8n instance (credential store contents, webhook URL) is an operator
  responsibility documented in the runbook.
