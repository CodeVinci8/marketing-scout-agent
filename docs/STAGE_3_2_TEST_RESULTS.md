# STAGE_3_2_TEST_RESULTS.md — Touchpoint Analyzer Test Results

**Workflow:** `n8n/workflows/08_touchpoint_analyzer.json` (`08 - Touchpoint Analyzer`, `active=false`)
**Stage:** 3.2 · **Related:** `docs/STAGE_3_2_TOUCHPOINT_ANALYZER_PLAN.md`, `docs/N8N_WORKFLOW_08_TOUCHPOINT_ANALYZER_RU.md`, DEC-080, DEC-081.

---

## TEST 1 — 2026-06-08 — ⚠️ PARTIAL FAIL (pre-patch v1)

First live run of Workflow 08 v1 on the 12 Workflow-07 records.

### What worked
- ✅ **Deterministic irrelevant skip** — record 9 (ZEN.COM) and record 10 (weak Dzen article) → `skipped_log`,
  `parse_method=deterministic_irrelevant_skip`, **no Claude call**.
- ✅ **Dynamic route append** — routing by `{{ $json.route }}` wrote to the correct tabs.
- ✅ **Record 1** (Avito competitor) → `monitor_queue`. Some primary/repaired outputs parsed correctly.

### What failed
- ❌ **Primary/repair JSON stability** — the gateway frequently returned **prose / extended-thinking / signature
  content instead of strict JSON**, so primary parse failed and repair failed too.
- ❌ **No deterministic fallback** — on LLM failure the record dropped straight to `technical_errors`, even when
  the intake hints fully determined the class.
- ❌ **Record 11 (Banki forum positive control)** — expected `review_queue`, **got `technical_errors`**.

### Observed technical_error examples (v1)
| # | record | parse_error / raw_response_preview |
|---|--------|-----------------------------------|
| 2 | Avito competitor | `Primary: Primary JSON parse failed \| Repair: Repair JSON parse failed`; preview = "Проверяю Avito-объявление кредитного брокера в Москве." |
| 3 | Dzen competitor channel | preview = "Проверяю канал конкурента на Дзен." |
| 4 | Dzen competitor post | `Primary parse failed: no text item`; content array held thinking/signature |
| 5 | VK source candidate | `Primary parse failed: no text item`; thinking/signature |
| 7 | Telegram @creditbrokers | preview = "I'll analyze this Telegram channel record..." |
| 11 | Banki forum | preview = "Анализирую запись с форума Banki.ru — типичный паттерн..." (→ technical_errors, WRONG) |
| 12 | Zoon reviews | technical_errors |

### Root cause
The analyzer **depended fully on Claude returning strict JSON**. The gateway emits thinking/prose/signature
blocks (often with **no `text` content item at all**), so both primary and repair produced no parseable JSON,
and every such record fell to `technical_errors` — including a clear, classifiable lead.

### Verdict
- [x] **PARTIAL FAIL** — irrelevant skip + dynamic routing PASS; primary/repair JSON stability FAIL;
  deterministic fallback MISSING; record 11 → `technical_errors` FAIL. **Patch required (DEC-081).**

---

## PATCH (2026-06-08, DEC-081) — deterministic fallback added

Workflow 08 v2 now computes a **deterministic classification (`det`) from `raw_market_records` hints for every
record** (in `Prepare Record`) and uses it as a **fallback after both primary and repair fail**
(`parse_method=deterministic_fallback_after_llm_fail`). `technical_errors` is now reserved for records that are
**unclassifiable even by hints** (no valid `det` route) or Sheets/API failures. Prompts hardened to demand
strict JSON ("Return exactly one JSON object. First char `{`, last `}`."); parser now concatenates all `text`
content items and ignores thinking/signature blocks.

### Dry-run of the deterministic fallback (logic simulation, worst case = Claude fails for all)
| # | platform | det entity_type | det route | det action | notes |
|---|----------|-----------------|-----------|-----------|-------|
| 1 | avito | competitor | monitor_queue | monitor | |
| 2 | avito | competitor | monitor_queue | monitor | was technical_errors in v1 |
| 3 | dzen | competitor | monitor_queue | monitor | was technical_errors in v1 |
| 4 | dzen | competitor | monitor_queue | monitor | was technical_errors in v1 |
| 5 | vk | content_idea | content_queue | create_content | was technical_errors in v1 |
| 6 | yandex_maps | competitor | monitor_queue | monitor | review_source + competitor_related |
| 7 | telegram | content_idea | content_queue | create_content | was technical_errors in v1 |
| 8 | telegram | content_idea | content_queue | create_content | |
| 9 | web | irrelevant | skipped_log | ignore | pre-Claude skip, $0 |
| 10 | dzen | irrelevant | skipped_log | ignore | pre-Claude skip, $0 |
| 11 | banki_forum | lead_signal | review_queue | investigate | **lead_signal_score 75**, was technical_errors in v1 |
| 12 | zoon | competitor | monitor_queue | monitor | review_source + competitor_related |

**technical_errors in the dry-run: 0.** (When Claude *does* return valid JSON, the richer LLM result is used
instead; the table above is the guaranteed floor if the gateway misbehaves.)

---

## TEST 2 — RETEST PLAN (after patch) — ⏳ AWAITING OPERATOR RUN

1. Re-import the patched `08_touchpoint_analyzer.json` (do NOT activate); re-bind Claude + Sheets credentials
   and the Spreadsheet ID.
2. Record Claude balance **BEFORE**, **Execute Workflow once**, record balance **AFTER**.
3. Fill the per-record table below from the 6 business tabs + `Final Summary Output`.
4. **PASS criteria:** `technical_errors` = 0 for the 12 records; records 1–4 & 6 & 12 → `monitor_queue`;
   5, 7, 8 → `content_queue`; 9–10 → `skipped_log` ($0); **11 → `review_queue`, `entity_type=lead_signal`,
   `recommended_action=investigate`, `lead_signal_score>=70`, `needs_manual_review=true`** (parse_method
   `primary_json`/`repaired_json` if Claude worked, else `deterministic_fallback_after_llm_fail`).

| # | platform | entity_type | route | recommended_action | lead_signal_score | parse_method | repair_status | PASS? |
|---|----------|-------------|-------|--------------------|:----:|------|------|:----:|
| 1 | avito |  |  |  |  |  |  |  |
| 2 | avito |  |  |  |  |  |  |  |
| 3 | dzen |  |  |  |  |  |  |  |
| 4 | dzen |  |  |  |  |  |  |  |
| 5 | vk |  |  |  |  |  |  |  |
| 6 | yandex_maps |  |  |  |  |  |  |  |
| 7 | telegram |  |  |  |  |  |  |  |
| 8 | telegram |  |  |  |  |  |  |  |
| 9 | web | irrelevant | skipped_log | ignore | 1 | deterministic_irrelevant_skip |  |  |
| 10 | dzen | irrelevant | skipped_log | ignore | 1 | deterministic_irrelevant_skip |  |  |
| 11 | banki_forum |  |  |  |  |  |  |  |
| 12 | zoon |  |  |  |  |  |  |  |

### Route distribution (Final Summary Output)
| route | count |
|-------|:----:|
| results |  |
| review_queue |  |
| monitor_queue |  |
| content_queue |  |
| skipped_log |  |
| technical_errors | (expect 0) |

### parse_method distribution
| parse_method | count |
|--------------|:----:|
| primary_json |  |
| repaired_json |  |
| deterministic_fallback_after_llm_fail |  |
| deterministic_irrelevant_skip |  |
| technical_error | (expect 0) |
