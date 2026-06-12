# MARKET_INTELLIGENCE_REPORT_SCHEMA.md — `market_intelligence_reports` Tab Schema (v0.3)

**Status:** 📐 BUILD-READY SCHEMA — the tab is **not created yet** (operator creates it with these 20 headers
before the first WF12 run). **The Report Builder that writes it is built as a deterministic skeleton:**
`n8n/workflows/12_market_intelligence_report_builder.json` (WF12, `active=false`, DEC-118 — no Claude, no
Telegram send; `report_markdown_path` stays empty in v0.1, the Markdown is kept inline in `notes`).
**Date:** 2026-06-12 · **Decisions:** DEC-112 (Claude in report/control layer), DEC-113 (MVP framing),
DEC-118 (WF12 skeleton), **DEC-128 (v0.3: 25 columns — split llm fields, budget-gated Claude branch)**.
**v0.3 migration:** columns 1–15 unchanged; old `llm_summary`/`llm_recommendations` are replaced by the
8-field llm block below (operator updates the tab headers before the first WF12 v0.3 run).
**Related:** `docs/REPORTING_AND_TELEGRAM_SUMMARY_PLAN.md`, `docs/WF10_TABLE_SCHEMAS.md`,
`docs/N8N_WORKFLOW_12_MARKET_INTELLIGENCE_REPORT_BUILDER_RU.md`.

---

## 1. Purpose

One row per generated market intelligence report. Deterministic sections are always filled from WF10 tabs;
LLM sections are optional and empty unless the operator enabled the Claude summary for that report.
Telegram digests render from this row — the row is the single source of truth for "what was reported when".

## 2. Columns (25 — v0.3)

| # | Column | Type | Notes |
|---|--------|------|-------|
| 1 | `report_id` | string | `report_YYYYMMDD_HHmmss` (MSK) |
| 2 | `created_at` | string | ISO 8601 MSK `+03:00` |
| 3 | `report_type` | string | `weekly_digest` / `on_demand` / `no_data_notice` |
| 4 | `niche_id` | string | e.g. `credit_brokerage` |
| 5 | `region` | string | e.g. `Москва/МО` |
| 6 | `time_window_days` | integer | window of the underlying WF10 run |
| 7 | `wf10_run_id` | string | FK → WF10 `run_id` (latest snapshot used) |
| 8 | `prev_wf10_run_id` | string | run used for trend deltas; empty on first report |
| 9 | `source_mix` | string | copied from WF10 stats — e.g. `mixed: live + historical/manual + web pipeline`; **mandatory in every rendered report** |
| 10 | `rows_after_filters` | integer | evidence size; `0` → `report_type=no_data_notice` |
| 11 | `top_competitors` | string | deterministic: top-N from `competitor_profiles` by evidence_count/confidence, ` \| `-joined |
| 12 | `top_angles` | string | deterministic: top-N `market_angles` with frequency + trend arrow vs prev run |
| 13 | `audience_summary` | string | deterministic: per-platform aggregate counts (aggregate-only, no authors/contacts) |
| 14 | `content_plan_ref` | string | `plan_id` of the latest `content_positioning_plan` row |
| 15 | `report_markdown_path` | string | path/link to the full Markdown report (repo `docs/reports/` or Drive) |
| 16 | `llm_status` | string | `disabled` (default) / `ok` / `ok_with_flags` |
| 17 | `llm_model` | string | e.g. `claude-sonnet-4-6`; empty when disabled |
| 18 | `llm_input_tokens` | integer | from API usage; 0 when disabled |
| 19 | `llm_output_tokens` | integer | from API usage; 0 when disabled |
| 20 | `llm_cost_usd` | number | usage tokens × configured $/MTok; 0 when disabled |
| 21 | `llm_summary_ru` | string | Claude executive summary + key findings + risks + source limitations (RU); facts-only |
| 22 | `llm_recommendations_ru` | string | Claude next actions + content recommendations (RU); never outreach, never contacts |
| 23 | `llm_quality_flags` | string | comma list: `non_json_output` / `truncated_max_tokens` / `missing_executive_summary` / `missing_key_findings` / `unverified_numbers_check_manually` / `outreach_language_detected_review`; empty = clean |
| 24 | `delivered_to` | string | `none` / `telegram_operator` / `sheets_only` |
| 25 | `notes` | string | caveats, operator remarks + inline v0.3 report Markdown (executive digest, competitor/website/lead-signal/action blocks) |

## 3. Rules

- **Deterministic first:** columns 1–15 are always computed without LLM; a report with
  `llm_status=disabled` is a complete, valid report ($0).
- **Claude branch (v0.3):** requires `enable_llm_summary=true` + `llm_approval_token=I_APPROVE_CLAUDE_REPORT_SUMMARY`
  + an Anthropic credential bound in n8n + enabling the disabled HTTP node. A **budget guard** throws before
  the HTTP node when the estimated cost exceeds `llm_max_estimated_cost_usd` or input exceeds
  `llm_max_input_chars`. Claude receives only deterministic report fields + aggregate audience/lead-signal
  summaries — never raw personal dumps, never contacts — and must return JSON sections
  (`executive_summary_ru`, `key_findings`, `market_risks`, `recommended_next_actions`,
  `content_recommendations`, `source_limitations`). Cost and tokens are recorded on the row and in
  `agent_requests.result_summary`.
- **`no_data` runs:** if the underlying WF10 run was `no_data` (rows_after_filters=0), the report is a
  `no_data_notice` — top lists empty, recommendation text fixed: `no_data; broaden filters or source scope`.
  Never render template content as if it were market evidence.
- **`source_mix` is mandatory** in every rendered output (Markdown + Telegram digest) — reports must not
  imply all data was collected live in the latest run.
- **Contact policy:** reports contain no individual contacts; competitor org identification only.
  Audience sections are aggregate-only (CONTACT_AND_OUTREACH_POLICY §5).
- Append-only; one row per generated report; regeneration writes a new row referencing the same `wf10_run_id`.

## 4. Telegram digest rendering (from one row)

```
📊 Market intelligence (<niche_id>, <region>, <time_window_days>d, run <wf10_run_id>)
Источники: <source_mix>
Конкуренты: <top_competitors (3)>
Углы: <top_angles (3, с трендом)>
План: <content_plan_ref headline>
Полный отчёт: <report_markdown_path> · Таблица: <sheet link>
```
