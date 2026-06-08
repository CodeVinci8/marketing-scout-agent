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

## TEST 4 (Test C) — 2026-06-08 — ⚠️ PARTIAL PASS / LLM ENRICHMENT NOT APPROVED (v3 full-row enrichment)

First live LLM-enrichment run, 4 fixtures (`llm_enrichment_test_mode=true`, batch_indexes [1,7,11,12]) against the
**v3 full-row** enrichment prompt (Claude asked to produce the full 25/35-field business object).

### Result summary
- Claude balance: **Before Today $0.3393 / Total $1.3054 → After Today $0.4360 / Total $1.4021** → **cost delta $0.0967** for 4 records.
- `technical_errors = 0`; routes did **not** degrade (safety floor held).
- **But too many records fell back:** several enrichment records returned non-JSON and routed via
  `deterministic_fallback_after_llm_fail` rather than `primary_json`:
  - Record 1 Avito competitor → `monitor_queue`, `deterministic_fallback_after_llm_fail`.
  - Record 7 Telegram @creditbrokers → `content_queue`, `deterministic_fallback_after_llm_fail`.
  - Record 12 Zoon reviews → `monitor_queue`, `deterministic_fallback_after_llm_fail`.
- LLM still often failed strict JSON on both primary and repair.

### Cause
The v3 prompt asked Claude to generate the **full business row from scratch** (25 fields + 3-sentence reason +
full scoring), so responses were long and the gateway frequently emitted prose / extended-thinking / signature
instead of one clean JSON object. The deterministic floor saved routing, but the LLM contributed little for
$0.0967.

### Verdict
- [x] **PARTIAL PASS** — routing safe, `technical_errors=0`; **LLM enrichment NOT APPROVED** (too many fallbacks,
  poor JSON stability, weak cost/value). **Decision (DEC-085): switch enrichment to compact enrichment-only JSON
  merged into the deterministic row.** Re-test as Test C2 below.

---

## PATCH v4 (2026-06-08, DEC-085) — enrichment-only JSON merged into the deterministic row

Claude no longer generates the full 35-field row. New design:
- **`Build Primary Claude Request`** sends a **compact enrichment-only** task: `ORIGINAL_RECORD` + `DETERMINISTIC_ROW`
  + a 15-key `OUTPUT_SCHEMA` (company_name, profile_name, region, service_type, offer_text, terms, contact_public,
  detected_need, reason, recommended_action, entity_type, 4 scores). `model=claude-sonnet-4-6`, `temperature=0`,
  `max_tokens=700`, **`thinking={type:'disabled'}`**.
- **`Build Repair Request`** is also enrichment-only (`max_tokens=600`, thinking disabled): repair to `OUTPUT_SCHEMA`
  or build it from `ORIGINAL_RECORD` + `DETERMINISTIC_ROW`.
- **Parsers** concatenate only `text` items (ignore thinking/signature/tool), strip fences, try direct parse →
  first balanced object → first `{`…`}`; cap preview at 500; thinking/prose-only →
  `non_json_non_text_or_thinking_response`.
- **`Merge LLM Enrichment With Deterministic Row`** (renamed from `Normalize + Route`) starts from the deterministic
  35-field row and overlays **only safe enrichment**: descriptive fields + scores (1–10 → ×10, floored at the
  deterministic value). **Route, recommended_action, entity_type, and contact stay deterministic** — Claude cannot
  change routing, downgrade a competitor to irrelevant, or set a contact that wasn't in the intake. `market_signal`
  → `content_idea`. parse_method = `primary_json` | `repaired_json` | `deterministic_fallback_after_llm_fail`.
- HTTP request bodies now send `thinking` (disabled). `Build Deterministic Row` writes nothing during
  `llm_enrichment_test_mode` so the test produces exactly the 4 fixture rows.

---

## TEST C2 — ATTEMPT #1 — 2026-06-08 — ⏳ INCOMPLETE (filter-placement bug; not failed, not valid for acceptance)

First run of the v4 compact enrichment design with `llm_enrichment_test_mode=true`.

### What happened
- ✅ **batch_index=1 (Avito competitor) succeeded** → `monitor_queue`, **`parse_method=primary_json`**,
  `repair_used=false`, `repair_status` empty, `technical_errors=0`, with **useful enriched `offer_text` / `terms` /
  `reason`**. The compact enrichment-only design + disabled thinking produced clean primary JSON on the first record.
- ❌ **Only batch_index=1 was written.** The run **stopped around `Build Deterministic Row` on the next
  non-target item** (record 2) and never reached the other target fixtures 7/11/12.

### Root cause (confirmed)
The C2 filtering was implemented **inside `Build Deterministic Row`** as `return []` for non-target `batch_index`.
In the Split-in-Batches loop, an item routed to `Build Deterministic Row` that returns **`[]`** produces no output,
so `Append to Dynamic Route Sheet` → `Loop Over Items` never fires for that iteration and **loop continuation
stalls** — the loop never advances to records 7/11/12.

### Verdict
- [ ] **INCOMPLETE** — the single enriched record is **promising** (primary_json, no repair, good enrichment),
  but the run is **invalid for C2 acceptance** because it did not process all 4 fixtures. **Fix the filter
  placement and re-run (Test C2 attempt #2 below).**

---

## PATCH v5 (2026-06-08, DEC-086) — C2 batch filtering moved BEFORE the processing loop

- **`Filter & Select Records`** now applies the C2 filter **pre-loop**: it assigns `batch_index` over the full
  selection (so 1,7,11,12 stay stable), then — when `llm_enrichment_test_mode=true` — returns **only** the records
  whose `batch_index` ∈ `llm_test_batch_indexes`. The processing loop therefore receives **exactly 4 items**, and
  every one of them is a Claude target. It also stamps `selected_count_before_test_filter`,
  `selected_count_after_test_filter`, `llm_enrichment_test_mode`, `llm_test_batch_indexes` on each selected record.
- **`Build Deterministic Row` no longer returns `[]`** for any record — non-target test records never enter that
  node now, so loop continuation can never be broken by an empty return.
- **`Final Summary Output`** now reports `selected_count` (= count from `Filter & Select Records`),
  `llm_enrichment_test_mode`, and `llm_test_batch_indexes` alongside `route_counts` / `parse_method_counts` /
  `repair_used_count` / `technical_error(s)_count`.
- **Default (`llm_enrichment_test_mode=false`) is unchanged** — all selected unique/approved/new records still flow
  (simulation: `test_mode=false → [1..12]`; `test_mode=true → [1,7,11,12]`).

---

## TEST C2 — ATTEMPT #2 (after the v5 fix) — ⏳ AWAITING OPERATOR RUN

Re-run the 4-fixture enrichment test against the v4 compact design **with the v5 pre-loop filter**.

### How to run
1. `Set Analyzer Config`: set **`llm_enrichment_test_mode = true`** (keep `analysis_mode='deterministic_first'`,
   `llm_enrichment=false`, `max_records=12`). `llm_test_batch_indexes` = **`[1,7,11,12]`**. `Filter & Select Records`
   now pre-filters to those four **before** the loop; **the other 8 records never enter the loop** and are not written.
2. Re-bind Claude + Sheets credentials and the Spreadsheet ID. Record Claude balance **BEFORE**,
   **Execute Workflow once**, record balance **AFTER**.
3. **Restore `llm_enrichment_test_mode = false` after the test.**

### Acceptance (target)
- **All 4 fixtures processed** (the attempt-#1 bug is fixed): `Final Summary Output` shows `selected_count=4`,
  `llm_enrichment_test_mode=true`, `llm_test_batch_indexes=[1,7,11,12]`, `total_processed=4`.
- **Selected LLM records = exactly 4** (batch_index 1, 7, 11, 12); the other 8 records not written.
- `technical_errors = 0`.
- `primary_json` **≥ 3 of 4** (target).
- `repaired_json` **≤ 1 of 4** acceptable.
- `deterministic_fallback_after_llm_fail` **≤ 1 of 4** acceptable (ideally 0).
- Routes unchanged from the deterministic baseline: **1 → monitor_queue, 7 → content_queue (or review_queue,
  never technical_errors), 11 → review_queue (never results/contact without contact_public), 12 → monitor_queue
  (or content_queue, never technical_errors)**.
- No `results`/`contact` without usable `contact_public`.
- `reason` / `detected_need` quality **improved** over the deterministic text.
- **Cost delta materially lower than $0.0967**, target **≤ $0.04** for 4 records (provider/model dependent).

| # | platform | entity_type | route | parse_method | repair_used | reason improved? | cost note | PASS? |
|---|----------|-------------|-------|------|:----:|:----:|------|:----:|
| 1 | avito |  |  |  |  |  |  |  |
| 7 | telegram |  |  |  |  |  |  |  |
| 11 | banki_forum |  |  |  |  |  |  |  |
| 12 | zoon |  |  |  |  |  |  |  |

| metric | target | observed |
|--------|--------|----------|
| selected LLM records | exactly 4 |  |
| technical_errors | 0 |  |
| primary_json | ≥3/4 |  |
| repaired_json | ≤1/4 |  |
| deterministic_fallback_after_llm_fail | ≤1/4 |  |
| Claude cost delta | ≤ $0.04 |  |

> If Test C2 passes, enrichment can be enabled per-run with `analysis_mode='llm_enriched'` + `llm_enrichment=true`
> (full batch). Until then the **deterministic_first baseline (TEST 3) is the approved default** and all LLM flags
> must be left `false`.

---

> **Timestamps (DEC-083):** from this patch on, workflow-generated timestamps (`created_at`, `parsed_at`,
> `generated_at`, `first_seen_at`, `last_seen_at`) and `run_id` stamps are written in **explicit Moscow time
> `+03:00`** (e.g. `2026-06-08T21:55:43.425+03:00`). Source-provided `published_at` is untouched, and existing
> historical UTC-`Z` rows are left as-is.
