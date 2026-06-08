# STAGE_3_2_TEST_RESULTS.md — Touchpoint Analyzer Test Results (TEMPLATE)

**Workflow:** `n8n/workflows/08_touchpoint_analyzer.json` (`08 - Touchpoint Analyzer`, `active=false`)
**Stage:** 3.2 · **Status:** ⏳ AWAITING OPERATOR RUN — fill in after executing once on the 12 Workflow-07 records.
**Related:** `docs/STAGE_3_2_TOUCHPOINT_ANALYZER_PLAN.md`, `docs/N8N_WORKFLOW_08_TOUCHPOINT_ANALYZER_RU.md`.

> This is an **empty template**. No run has been recorded yet. Do not treat any value below as a result.

---

## 1. Run metadata

| Field | Value |
|-------|-------|
| Date / time |  |
| run_id (`touchpoint_…`) |  |
| test_mode | true |
| analyze_statuses | approved, new |
| Records selected (max 12) |  |
| Claude balance BEFORE |  |
| Claude balance AFTER |  |
| **Claude cost (this run)** |  |
| Repair calls used |  |
| technical_errors count |  |

## 2. Per-record outcomes (12 fixtures from Workflow 07)

| # | platform | record_type_hint (intake) | entity_type (analyzer) | route | recommended_action | lead_signal_score | content_idea_score | competitor_strength | parse_method | repair_used | PASS? | notes |
|---|----------|---------------------------|------------------------|-------|--------------------|:----:|:----:|:----:|------|:----:|:----:|------|
| 1 | avito | competitor_activity |  |  |  |  |  |  |  |  |  |  |
| 2 | avito | competitor_activity |  |  |  |  |  |  |  |  |  |  |
| 3 | dzen | competitor_activity |  |  |  |  |  |  |  |  |  |  |
| 4 | dzen | competitor_activity |  |  |  |  |  |  |  |  |  |  |
| 5 | vk | market_signal |  |  |  |  |  |  |  |  |  |  |
| 6 | yandex_maps | market_signal |  |  |  |  |  |  |  |  |  |  |
| 7 | telegram | market_signal |  |  |  |  |  |  |  |  |  |  |
| 8 | telegram | market_signal |  |  |  |  |  |  |  |  |  |  |
| 9 | web | irrelevant | irrelevant | skipped_log | ignore | 1 | 1 | 1 | deterministic_irrelevant_skip | false |  | no Claude call ($0) |
| 10 | dzen | irrelevant | irrelevant | skipped_log | ignore | 1 | 1 | 1 | deterministic_irrelevant_skip | false |  | no Claude call ($0) |
| 11 | banki_forum | question_objection |  |  |  |  |  |  |  |  |  | expect review_queue, NOT contact |
| 12 | zoon | market_signal |  |  |  |  |  |  |  |  |  |  |

## 3. Expected vs actual (key records)

| Record | Expected route | Actual route | Match? |
|--------|----------------|--------------|:------:|
| 1 (Avito competitor) | `monitor_queue` |  |  |
| 9 (irrelevant) | `skipped_log` ($0, no Claude) |  |  |
| 10 (irrelevant) | `skipped_log` ($0, no Claude) |  |  |
| 11 (forum hot-pattern, no contact) | `review_queue` (investigate) |  |  |

## 4. Route distribution (Final Summary Output)

| route | count |
|-------|:----:|
| results |  |
| review_queue |  |
| monitor_queue |  |
| content_queue |  |
| skipped_log |  |
| technical_errors |  |

## 5. Observations / issues

-

## 6. Verdict

- [ ] PASS — routing + resilient JSON/repair behave as designed; proceed to Stage 3.3 (analyzer/scoring hardening).
- [ ] NEEDS FIX — list issues above and the planned change.
