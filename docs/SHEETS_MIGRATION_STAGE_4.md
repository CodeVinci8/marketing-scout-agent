# Google Sheets Migration — Stage 4 (Single-User Telegram Agent)

This is the **one consolidated migration** for the Stage 4 agent. It is **additive**: it creates six new tabs
and adds append-only columns to existing tabs. No existing column is renamed, reordered, or removed. n8n's
Google Sheets `append` matches by **header name**, so columns may be added to the right of existing ones
without breaking current workflows.

> Safety: apply this on a **copy/snapshot** of the working spreadsheet first. Rollback = delete the added
> tabs/columns (no existing data is touched). The Spreadsheet **ID** is provided once via `MS_SPREADSHEET_ID`
> (a non-secret id, resolved by `n8n/lib/agent_config.js`) — it is **not** hand-pasted into each node.

Header order below is **exact** and matches the record shapes emitted by the Stage 4 libraries. Create each
tab and paste the header row exactly (one row, left to right).

---

## A. NEW TABS (Stage 4)

### A1. `agent_requests` — one row per inbound request (WF18 writes; WF19/WF20 read)

| # | header | written by | source field |
|---|--------|-----------|--------------|
| 1 | `agent_request_id` | WF18 | generated `req_*` |
| 2 | `update_id` | WF18 | Telegram `update.update_id` |
| 3 | `chat_id` | WF18 | `telegram_io.parseUpdate` |
| 4 | `user_id` | WF18 | `telegram_io.parseUpdate` |
| 5 | `request_text` | WF18 | message text |
| 6 | `idempotency_key` | WF18 | `telegram_io.updateIdempotencyKey` |
| 7 | `state` | WF18/WF20 | `agent_state` current state |
| 8 | `plan_source` | WF19 | `deterministic` / `llm` |
| 9 | `created_ts` | WF18 | ISO timestamp |
| 10 | `updated_ts` | WF20 | ISO timestamp |

Duplicate-update protection: WF18 reads `agent_request_events` (or this tab) by `idempotency_key`; a repeated
`update_id` matches and yields **no** new request.

### A2. `agent_request_events` — durable transition log (WF18/WF20 append; never updated in place)

| # | header | source field (`agent_state.transition().event`) |
|---|--------|---------------------------------------------------|
| 1 | `agent_request_id` | `event.agent_request_id` |
| 2 | `from_state` | `event.from_state` |
| 3 | `to_state` | `event.to_state` |
| 4 | `accepted` | `event.accepted` (`true`/`false`) |
| 5 | `reason` | `event.reason` (e.g. `invalid_transition`) |
| 6 | `ts` | `event.ts` |

Illegal transitions are appended with `accepted=false` and `reason=invalid_transition` (audit trail), and the
state is **not** advanced.

### A3. `execution_plans` — bounded plan per request (WF19 writes; WF20 reads)

| # | header | source field (`request_planner` plan) |
|---|--------|----------------------------------------|
| 1 | `agent_request_id` | request record |
| 2 | `intent` | `plan.intent` |
| 3 | `niche` | `plan.niche` |
| 4 | `service` | `plan.service` |
| 5 | `region` | `plan.region` |
| 6 | `sources` | `plan.sources` (comma-joined) |
| 7 | `max_items` | `plan.max_items` |
| 8 | `max_external_calls` | `plan.max_external_calls` |
| 9 | `est_source_cost_usd` | `plan.est_source_cost_usd` |
| 10 | `est_llm_cost_usd` | `plan.est_llm_cost_usd` |
| 11 | `expected_output` | `plan.expected_output` |
| 12 | `requires_approval` | `plan.requires_approval` |
| 13 | `plan_source` | `plan.plan_source` |
| 14 | `created_ts` | ISO timestamp |

### A4. `approval_decisions` — operator approve/reject/cancel (WF18 writes; WF20 reads)

| # | header | source field (`telegram_io.parseCallback`) |
|---|--------|---------------------------------------------|
| 1 | `agent_request_id` | `callback.agent_request_id` |
| 2 | `decision` | `approve` / `reject` / `cancel` |
| 3 | `decided_by_user_id` | callback `from.id` |
| 4 | `callback_data` | raw `approve:<id>` etc. |
| 5 | `idempotency_key` | `tg::<update_id>::<chat_id>` |
| 6 | `decided_ts` | ISO timestamp |

A repeated approval callback resolves to the same request whose state is already past `approved`; WF20's
approval/budget gate sees the completed idempotency key and does **not** restart execution.

### A5. `telegram_outbox` — delivery records (WF20 writes; WF20 reads for dedupe)

| # | header | source field (`telegram_io.makeDelivery`) |
|---|--------|---------------------------------------------|
| 1 | `delivery_id` | `dlv_<req>_<report>_<payloadHash>` |
| 2 | `agent_request_id` | `delivery.agent_request_id` |
| 3 | `report_id` | `delivery.report_id` |
| 4 | `chat_id` | `delivery.chat_id` |
| 5 | `payload_hash` | `delivery.payload_hash` |
| 6 | `chunks` | `delivery.chunks` |
| 7 | `send_status` | `pending` / `sent` / `error` |
| 8 | `attempts` | `delivery.attempts` |
| 9 | `telegram_message_id` | set after a successful send |
| 10 | `last_error` | last transport error (if any) |

Retry safety: `telegram_io.shouldSend` skips when an existing row with the same `delivery_id` is already
`sent`, so a re-executed delivery branch cannot produce a duplicate user-visible message.

### A6. `execution_summaries` — one canonical summary per request (WF20 writes)

| # | header | source field (`execution_summary.buildExecutionSummary`) |
|---|--------|-----------------------------------------------------------|
| 1 | `agent_request_id` | `summary.agent_request_id` |
| 2 | `final_state` | `summary.final_state` |
| 3 | `sources_requested` | `summary.sources_requested` |
| 4 | `sources_completed` | `summary.sources_completed` |
| 5 | `sources_failed` | `summary.sources_failed` |
| 6 | `sources_quarantined` | `summary.sources_quarantined` |
| 7 | `records_received` | `summary.records_received` |
| 8 | `records_unique` | `summary.records_unique` |
| 9 | `records_eligible` | `summary.records_eligible` |
| 10 | `records_analyzed` | `summary.records_analyzed` |
| 11 | `records_reported` | `summary.records_reported` |
| 12 | `external_calls` | `summary.external_calls` |
| 13 | `llm_primary_calls` | `summary.llm_primary_calls` |
| 14 | `llm_repair_calls` | `summary.llm_repair_calls` |
| 15 | `source_cost_status` | `known` / `unknown` (never fabricated `$0`) |
| 16 | `llm_cost_status` | `known` / `unknown` |
| 17 | `report_id` | `summary.report_id` |
| 18 | `delivery_status` | `summary.delivery_status` |
| 19 | `blocking_errors` | `summary.blocking_errors` |
| 20 | `next_operator_action` | single recommended action |

### A7. `dead_letter_events` — terminal failures the operator should inspect (WF18/WF20 append)

| # | header | notes |
|---|--------|-------|
| 1 | `agent_request_id` | may be empty for pre-classification failures |
| 2 | `stage` | `intake` / `planning` / `collecting` / `delivering` / ... |
| 3 | `error` | short reason |
| 4 | `payload_ref` | pointer/hash, **not** raw secrets |
| 5 | `ts` | ISO timestamp |

---

## B. EXISTING TABS — append-only columns the Stage 4 path relies on

These were introduced in the Stage 3 closure migration (`SHEETS_MIGRATION_STAGE_C_HARDENING.md`); Stage 4
**reads** them and adds nothing new except where noted. Confirm they exist before going live:

| tab | columns Stage 4 depends on | role in Stage 4 |
|-----|----------------------------|------------------|
| `source_health` | `source_run_id`, `agent_request_id`, `quality_status`, `report_eligible`, `data_mode` | WF16 writes; **WF10/WF12 fail-closed join** (a row without a verified source-health match is excluded) |
| `raw_market_records` | `agent_request_id`, `source_run_id`, `source_record_id`, `quality_status`, `report_eligible`, `analysis_status`, `data_mode` | WF04 writes (website adapter); WF08 reads |
| `analysis_runs` | `source_run_id`, `source_record_id`, `analyzed_ts` | WF08 exactly-once ledger (key = `source_run_id::source_record_id`) |

Stage 4 adds `agent_request_id` as a first-class isolation key. If your existing `raw_market_records` /
`source_health` rows predate it, add the `agent_request_id` column (append-only) so WF10/WF12 request isolation
works; legacy rows with an empty `agent_request_id` are treated as un-scoped and pass the isolation filter.

---

## B2. NEW TABS — conversational agent (WF18 gateway + WF22 control)

The conversational layer adds the tabs below. They keep the agent's interpreted context and durable memory
out of the prompt-by-default: messages are NOT reloaded in full each turn — only a bounded window + a rolling
summary are. All header orders are exact.

### B2.1 `conversations` — one row per conversation thread (WF18)
`conversation_id` · `owner_user_id` · `chat_id` · `started_at` · `last_activity_at` · `status` · `archived`

### B2.2 `conversation_messages` — append-only message log (WF18); never reloaded in full
`conversation_id` · `message_id` · `role` · `text` · `intent` · `created_at` · `archived`

### B2.3 `conversation_state` — L1 active context, latest row per conversation (WF18/WF20 write; WF18 reads)
`conversation_id` · `owner_user_id` · `active_agent_request_id` · `current_intent` · `current_state` ·
`current_plan_id` · `last_report_id` · `last_source_run_ids` · `selected_competitors` · `selected_sources` ·
`pending_clarification` · `pending_approval` · `current_region` · `current_service` · `comparison_baseline_id` ·
`no_memory` · `updated_at`
(`last_source_run_ids`/`selected_competitors`/`selected_sources` are JSON strings.)

### B2.4 `conversation_summaries` — L3 rolling summary, versioned, previous retained (WF18)
`conversation_id` · `version` · `prev_version` · `text` · `preserved_ids` · `covers_message_ids` ·
`decisions` · `entities` · `unresolved` · `created_at`

### B2.5 `durable_memories` — L4 durable per-user memory (WF22)
`memory_id` · `owner_user_id` · `scope` · `conversation_id` · `memory_type` · `key` · `value_json` ·
`source_message_id` · `confidence` · `status` · `created_at` · `updated_at` · `last_used_at` · `expires_at`
(never stores secrets — `makeMemory` rejects token/key-like values.)

### B2.6 `memory_audit_events` — deletion audit; retains a value HASH, never the raw value (WF22)
`event` · `owner_user_id` · `memory_id` · `memory_type` · `key` · `value_hash` · `ts`

### B2.7 `context_usage` — token-budget accounting per Claude-bound turn (WF18/WF19/WF20)
`conversation_id` · `agent_request_id` · `est_input_tokens` · `max_context_tokens` · `sections_included` ·
`sections_omitted` · `summary_version` · `truncated` · `ts`

### B2.8 `tracked_sources` — monitored public sources (WF22)
`source_id` · `owner_user_id` · `platform` · `ref` · `key` · `label` · `status` · `added_at` · `updated_at` ·
`last_checked_at` · `agent_request_id`

### B2.9 `source_audit_events` — source add/status audit (WF22)
`event` · `owner_user_id` · `source_id` · `key` · `platform` · `from` · `to` · `ts`

---

## B3. NEW TABS — deep analysis + conversation-aware orchestration (WF20 + WF21)

### B3.1 `orchestration_decisions` — why a paid call did/didn't happen (WF20)
`agent_request_id` · `conversation_id` · `intent` · `action` · `reason` · `needs_external_call` ·
`target_sources` · `ts`
(`action` ∈ reuse | collect | extend — e.g. "generate ideas" reuses the last report with `needs_external_call=false`.)

### B3.2 `deep_analysis_findings` — evidence-backed FACTS only (WF21)
`finding_id` · `agent_request_id` · `competitor` · `dimension` · `value` · `source_url` · `source_record_id` ·
`source_run_id` · `excerpt` · `collected_at` · `quality_status` · `confidence`
(a finding without a source URL/record + source_run_id + excerpt is rejected — it can never present as a fact.)

### B3.3 `deep_analysis_recommendations` — recommendations, separated from facts (WF21)
`agent_request_id` · `competitor` · `text` · `derived_from` · `confidence` · `ts`
(`derived_from` lists the `finding_id`s a recommendation is based on; a recommendation with no supporting
finding is held back, never stored/shown as a fact.)

---

## C. Verification checklist (do this once, before `--apply`)

1. [ ] Spreadsheet snapshot/copy taken.
2. [ ] Tabs **A1–A7** created with the **exact** header rows above (left-to-right order matters).
3. [ ] Existing tabs `source_health`, `raw_market_records`, `analysis_runs` present with the Stage 3 columns.
4. [ ] `agent_request_id` column present on `raw_market_records` and `source_health`.
5. [ ] `MS_SPREADSHEET_ID` and `MS_TELEGRAM_ALLOWED_USER_IDS` set in the n8n environment
       (`scripts/deploy_n8n.sh --check-config` reports all `[ok]`).
6. [ ] `scripts/deploy_n8n.sh --dry-run` prints the 4-workflow plan with `active=false` for all.
7. [ ] Credentials (Google Sheets / Telegram / Claude / Apify) attached in the n8n UI — **not** in JSON.
8. [ ] LLM feature flags left **off** (`MS_ENABLE_LLM_PLANNER`, `MS_ENABLE_LLM_SUMMARY`) until you intend to
       pay for Claude calls.
