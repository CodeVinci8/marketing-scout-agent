# MARKET_INTELLIGENCE_REPORT_SCHEMA.md — `market_intelligence_reports` Tab Schema (PROPOSED)

**Status:** 📐 BUILD-READY SCHEMA — the tab is **not created yet** (operator creates it with these 20 headers
before the first WF12 run). **The Report Builder that writes it is built as a deterministic skeleton:**
`n8n/workflows/12_market_intelligence_report_builder.json` (WF12, `active=false`, DEC-118 — no Claude, no
Telegram send; `report_markdown_path` stays empty in v0.1, the Markdown is kept inline in `notes`).
**Date:** 2026-06-12 · **Decisions:** DEC-112 (Claude in report/control layer), DEC-113 (MVP framing),
DEC-118 (WF12 skeleton writes this schema).
**Related:** `docs/REPORTING_AND_TELEGRAM_SUMMARY_PLAN.md`, `docs/WF10_TABLE_SCHEMAS.md`,
`docs/N8N_WORKFLOW_12_MARKET_INTELLIGENCE_REPORT_BUILDER_RU.md`.

---

## 1. Purpose

One row per generated market intelligence report. Deterministic sections are always filled from WF10 tabs;
LLM sections are optional and empty unless the operator enabled the Claude summary for that report.
Telegram digests render from this row — the row is the single source of truth for "what was reported when".

## 2. Columns (20)

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
| 16 | `llm_summary` | string | optional Claude stakeholder summary; **empty unless enabled**; facts-only |
| 17 | `llm_recommendations` | string | optional Claude next-action suggestions; never outreach, never contacts |
| 18 | `llm_cost_usd` | number | 0 when LLM disabled |
| 19 | `delivered_to` | string | `none` / `telegram_operator` / `sheets_only` |
| 20 | `notes` | string | free text (caveats, operator remarks) |

## 3. Rules

- **Deterministic first:** columns 1–15 are always computed without LLM; a report with `llm_*` empty is a
  complete, valid report.
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
