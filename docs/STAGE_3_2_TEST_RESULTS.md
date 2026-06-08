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

## TEST 2 — 2026-06-08 — ✅ ROUTING PASS / ❌ LLM STABILITY FAIL / ❌ COST EFFICIENCY FAIL (patch v2)

Second live run of Workflow 08 v2 (deterministic-fallback patch) on the 12 Workflow-07 records.

### Result summary
- ✅ **ROUTING PASS** — `technical_errors = 0`; deterministic fallback prevented data loss; routing mostly correct:
  Avito competitor → `monitor_queue`; Dzen competitors → `monitor_queue`; VK search → `content_queue`;
  Telegram source candidates → `content_queue`; Banki forum hot pattern without contact → `review_queue`;
  irrelevant records → `skipped_log`.
- ❌ **LLM STABILITY FAIL** — `primary_json = 0`. `repaired_json = 2`.
  `deterministic_fallback_after_llm_fail = 8`. `deterministic_irrelevant_skip = 2`. The gateway returned
  prose/thinking/signature for almost every primary call, e.g.:
  *"Fetching the Dzen channel content…"*, *"I'll analyze this Telegram channel…"*,
  *"Проверяю Avito-объявление…"*, or content arrays with only thinking/signature blocks.
- ❌ **COST EFFICIENCY FAIL** — Claude **cost delta ≈ $0.159 for 12 records** while the LLM contributed
  almost nothing usable (0 primary JSON, 2 repaired). The deterministic floor did all the real classification.

### parse_method distribution (TEST 2 actual)
| parse_method | count |
|--------------|:----:|
| primary_json | 0 |
| repaired_json | 2 |
| deterministic_fallback_after_llm_fail | 8 |
| deterministic_irrelevant_skip | 2 |
| technical_error | 0 |

### Verdict
- [x] **ROUTING PASS** · **LLM STABILITY FAIL** · **COST EFFICIENCY FAIL**.
  The analyzer paid for Claude on every non-irrelevant record but the deterministic layer produced the routing.
  **Decision (DEC-082): make Workflow 08 deterministic-first; Claude becomes optional enrichment, OFF by default.**

---

## PATCH v3 (2026-06-08, DEC-082) — deterministic-first + optional LLM enrichment

`Set Analyzer Config` now sets `analysis_mode='deterministic_first'`, `llm_enrichment=false` (default),
`max_records=12`, `test_mode=true`. New flow:
- `Prepare Record` computes the deterministic classification (`det`) + `deterministic_needs_llm` for every record
  and a gate `call_claude = (NOT irrelevant) AND (llm_enrichment=true OR deterministic_needs_llm=true)`.
- **`IF Call Claude?`** routes: `false` → **`Build Deterministic Row`** (no Claude, $0) →
  `deterministic_irrelevant_skip` (irrelevant) or `deterministic_pre_route` (obvious records); `true` →
  Claude primary → repair → deterministic fallback (unchanged).
- Prompts hardened for the future `llm_enriched` mode (no browse/fetch, no "fetching/checking/analyzing",
  one JSON object, first char `{` last `}`); repair builds JSON from `original_record` + `deterministic_classification`.
- `Normalize + Route`: `market_signal`→`content_idea`; scores scaled to 1–100 (1–10 outputs ×10) with a
  deterministic floor; `raw_response_preview` capped at 500, thinking/signature-only →
  `non_json_non_text_or_thinking_response`.

---

## TEST 3 — 2026-06-08 — ✅ PASS (deterministic_first baseline — APPROVED)

Live run of Workflow 08 v3 in the default mode (`analysis_mode='deterministic_first'`, `llm_enrichment=false`)
on the 12 Workflow-07 records.

### Result summary
- ✅ **`technical_errors = 0`.**
- ✅ **Claude calls = 0** — `Claude Primary API Request` and `Claude Repair API Request` did not run.
  **Cost delta = $0.**
- ✅ **`repair_used = false` for all 12.**
- ✅ **Route distribution:** `monitor_queue = 6`, `content_queue = 3`, `review_queue = 1`, `skipped_log = 2`,
  `results = 0`, `technical_errors = 0`.
- ✅ **parse_method:** `deterministic_pre_route = 10`, `deterministic_irrelevant_skip = 2`.

| # | platform | entity_type | route | recommended_action | lead_signal_score | parse_method | repair_used | PASS? |
|---|----------|-------------|-------|--------------------|:----:|------|:----:|:----:|
| 1 | avito | competitor | monitor_queue | monitor | 1 | deterministic_pre_route | false | ✅ |
| 2 | avito | competitor | monitor_queue | monitor | 1 | deterministic_pre_route | false | ✅ |
| 3 | dzen | competitor | monitor_queue | monitor | 1 | deterministic_pre_route | false | ✅ |
| 4 | dzen | competitor | monitor_queue | monitor | 1 | deterministic_pre_route | false | ✅ |
| 5 | vk | content_idea | content_queue | create_content | 1 | deterministic_pre_route | false | ✅ |
| 6 | yandex_maps | competitor | monitor_queue | monitor | 1 | deterministic_pre_route | false | ✅ |
| 7 | telegram | content_idea | content_queue | create_content | 1 | deterministic_pre_route | false | ✅ |
| 8 | telegram | content_idea | content_queue | create_content | 1 | deterministic_pre_route | false | ✅ |
| 9 | web | irrelevant | skipped_log | ignore | 1 | deterministic_irrelevant_skip | false | ✅ |
| 10 | dzen | irrelevant | skipped_log | ignore | 1 | deterministic_irrelevant_skip | false | ✅ |
| 11 | banki_forum | lead_signal | review_queue | investigate | 75 | deterministic_pre_route | false | ✅ |
| 12 | zoon | competitor | monitor_queue | monitor | 1 | deterministic_pre_route | false | ✅ |

### Route distribution (Final Summary Output)
| route | count |
|-------|:----:|
| results | 0 |
| review_queue | 1 |
| monitor_queue | 6 |
| content_queue | 3 |
| skipped_log | 2 |
| technical_errors | 0 |

### parse_method distribution
| parse_method | count |
|--------------|:----:|
| deterministic_pre_route | 10 |
| deterministic_irrelevant_skip | 2 |
| primary_json | 0 |
| repaired_json | 0 |
| deterministic_fallback_after_llm_fail | 0 |
| technical_error | 0 |

### Verdict
- [x] **PASS — deterministic_first baseline APPROVED.** Routing correct, `technical_errors=0`, `repair_used=false`,
  Claude calls=0, cost $0. This is the **approved safe baseline** for Stage 3.2. LLM enrichment remains
  **optional / under test** (TEST 4) and must pass its small-batch test before being approved.

---

## TEST 4 — LLM ENRICHMENT SMALL RETEST (template) — ⏳ AWAITING OPERATOR RUN

Optional. Validates the `llm_enriched` path on **4 fixture records only** before approving enrichment.

### How to run (config-driven — Part C)
1. In `Set Analyzer Config` set **`llm_enrichment_test_mode = true`** (keep `analysis_mode='deterministic_first'`,
   `llm_enrichment=false`, `max_records=12`). `llm_test_batch_indexes` defaults to **`[1,7,11,12]`**.
   This sends **only** those four non-irrelevant fixtures through Claude; all other records still route
   deterministically ($0).
2. Re-bind Claude + Sheets credentials and the Spreadsheet ID. Record Claude balance **BEFORE**,
   **Execute Workflow once**, record balance **AFTER**.
3. (Alternative if not using the flag) set `max_records` and the source rows so only records 1,7,11,12 are
   eligible — but the **flag is preferred**.

### Fixture records
1. Avito competitor listing → expect `competitor` / `monitor_queue`.
7. Telegram `@creditbrokers` source candidate → expect `content_idea` / `content_queue`.
11. Banki forum hot pattern **without contact** → expect `lead_signal` / `review_queue` / `investigate`
    (NOT `results`/`contact`).
12. Zoon reviews / market signal → expect `competitor` / `monitor_queue` (review_source + competitor_related).

### Pass criteria
- `technical_errors = 0`.
- `primary_json` **target ≥ 2 of 4**.
- `repaired_json` allowed **≤ 2 of 4**.
- `deterministic_fallback_after_llm_fail` allowed but **should not exceed 2 of 4**.
- **Routes unchanged from the deterministic baseline** (1→monitor_queue, 7→content_queue, 11→review_queue,
  12→monitor_queue).
- `reason` / `next_action` quality **improved** vs deterministic text.
- **No `results`/`contact` without a usable `contact_public`** (record 11 must stay `review_queue`).
- **Record cost delta** (4 Claude primary calls + any repairs) in the table below.

| # | platform | entity_type | route | parse_method | repair_used | reason improved? | cost note | PASS? |
|---|----------|-------------|-------|------|:----:|:----:|------|:----:|
| 1 | avito |  |  |  |  |  |  |  |
| 7 | telegram |  |  |  |  |  |  |  |
| 11 | banki_forum |  |  |  |  |  |  |  |
| 12 | zoon |  |  |  |  |  |  |  |

| metric | target | observed |
|--------|--------|----------|
| technical_errors | 0 |  |
| primary_json | ≥2/4 |  |
| repaired_json | ≤2/4 |  |
| deterministic_fallback_after_llm_fail | ≤2/4 |  |
| Claude cost delta | record it |  |

> If TEST 4 passes, enrichment can be enabled per-run with `analysis_mode='llm_enriched'` + `llm_enrichment=true`
> (full batch). Until then the **deterministic_first baseline (TEST 3) is the approved default**.

---

> **Timestamps (DEC-083):** from this patch on, workflow-generated timestamps (`created_at`, `parsed_at`,
> `generated_at`, `first_seen_at`, `last_seen_at`) and `run_id` stamps are written in **explicit Moscow time
> `+03:00`** (e.g. `2026-06-08T21:55:43.425+03:00`). Source-provided `published_at` is untouched, and existing
> historical UTC-`Z` rows are left as-is.
