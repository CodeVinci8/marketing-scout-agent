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

## TEST C2 — ATTEMPT #2 (after the v5 fix) — ⚠️ PARTIAL PASS / LLM ENRICHMENT NOT APPROVED

Re-ran the 4-fixture enrichment test against the v4 compact design **with the v5 pre-loop filter**. The run
processed the **intended 4 records** (batch_index 1, 7, 11, 12) and produced clean operational behaviour, but **missed
the `primary_json ≥ 3/4` target** and surfaced reason-quality issues, so enrichment is **not approved**.

### Result summary (C2 attempt #2 — actual)
- ✅ **`technical_errors = 0`.** Routes did **not** degrade. MSK `+03:00` timestamps OK.
- ⚠️ **Parse distribution `primary_json = 2/4`, `repaired_json = 1/4`, `deterministic_fallback_after_llm_fail = 1/4`** — target was `primary_json ≥ 3/4`.
- Per record:
  - **batch_index 1 — Avito competitor** → `monitor_queue`, `primary_json`, `repair_used=false`. ✅
  - **batch_index 11 — Banki forum hot pattern** → `review_queue`, `primary_json`, `repair_used=false`. ✅ route, ❌ reason said «обратиться напрямую» although `contact_public` is empty and `recommended_action=investigate`.
  - **batch_index 12 — Zoon reviews** → `monitor_queue`, `repaired_json`, `repair_used=true`. ❌ needed repair and was classified **too strongly as a competitor** (it is a generic category/review directory).
  - **batch_index 7 — Telegram @creditbrokers** → `content_queue`, `deterministic_fallback_after_llm_fail`, `repair_used=true`. ❌ still fails strict JSON and falls back.

### C2 attempt #2 table (actual)
| # | platform | entity_type | route | parse_method | repair_used | issue |
|---|----------|-------------|-------|------|:----:|------|
| 1 | avito | competitor | monitor_queue | primary_json | false | — |
| 7 | telegram | content_idea | content_queue | deterministic_fallback_after_llm_fail | true | JSON fails → fallback |
| 11 | banki_forum | lead_signal | review_queue | primary_json | false | reason: «обратиться напрямую» without a contact |
| 12 | zoon | competitor | monitor_queue | repaired_json | true | needed repair; too strongly competitor |

| metric | target | observed |
|--------|--------|----------|
| selected LLM records | exactly 4 | 4 |
| technical_errors | 0 | 0 |
| primary_json | ≥3/4 | **2/4** |
| repaired_json | ≤1/4 | 1/4 |
| deterministic_fallback_after_llm_fail | ≤1/4 | 1/4 |

### Verdict
- [x] **PARTIAL PASS — LLM enrichment NOT APPROVED.** Processed the 4 intended records; `technical_errors=0`; routes
  preserved; MSK timestamps OK. **Not approved** because the `primary_json ≥ 3/4` target was missed (2/4) and the
  reason-quality issues above remain. **Decision (DEC-087): patch enrichment quality and re-test as Test C3.**

---

## PATCH v6 (2026-06-09, DEC-087) — enrichment-quality patch after C2 PARTIAL PASS

Targets the four C2 issues without increasing `max_tokens` or cost.

- **Task A — source_candidate / Telegram prompt path.** `Build Primary Claude Request` now branches a **shorter,
  compact** system prompt for `record_type_hint=market_signal AND touchpoint_type=source_candidate`, and for
  `platform=telegram` content-idea records with no direct personal request. It forces `entity_type=content_idea`,
  `recommended_action=create_content|investigate`, frames the reason as «источник мониторинга тем, вопросов и
  рыночных сигналов» (**not** a direct lead, **not** outreach, **no** contact claim, **no** broad external facts).
- **Task B — `review_source` logic (`Prepare Record`).** Only a **named competitor** (`competitor_name` set) is a
  strong competitor → `monitor_queue` (competitor_strength 70). A **generic category / listing / review directory**
  (e.g. a Zoon "кредитные брокеры в Москве" category) → `entity_type=content_idea`, `route=content_queue`,
  `recommended_action=create_content`, **competitor_strength capped at 45**, content_idea_score 70, quality_score 68;
  `detected_need` seeded from `probable_need`.
- **Task C — no-contact lead reason safety (`Merge …`).** A deterministic sanitizer: when there is **no usable
  `contact_public`**, the reason may **not** contain «обратиться напрямую / написать / позвонить / связаться» — it is
  replaced with a manual-review-safe sentence. Route stays `review_queue`, `recommended_action` stays `investigate`.
- **Task D — no unsupported claims (prompt + `Merge …`).** «спрос растёт», «активно задают вопросы», «много лидов»,
  «высокая конверсия» are forbidden in the prompt and stripped in the merge unless the phrase is literally present in
  `ORIGINAL_RECORD`. Allowed framing: «есть рыночный паттерн», «подходит для мониторинга», «требует ручной проверки».
- **Task E — JSON reliability.** Compact enrichment schema kept; shorter prompt for source_candidate/review_source;
  deterministic **HINTS** (`expected_entity_type`, `expected_action`, `expected_route`, `no_contact_safety`,
  `forbidden_phrases`) injected into the primary **and** repair payloads. Primary prompt still: one JSON object only,
  first char `{` last `}`, no markdown/prose/thinking, no browse/fetch/analyze language. `max_tokens` unchanged
  (primary 700 / repair 600); thinking disabled; no cost increase.

---

## TEST C3 — ⚠️ PARTIAL PASS / LLM ENRICHMENT NOT APPROVED (v6 enrichment-quality patch)

Re-ran the **same 4 fixtures** (`llm_enrichment_test_mode=true`, `llm_test_batch_indexes=[1,7,11,12]`) against the v6
patch. Quality improved markedly (Banki + Zoon now clean), but **Telegram `source_candidate` still failed strict JSON
and fell back**, so `primary_json` stayed at 2/4 (target ≥3/4) and enrichment is **not approved**.

### Result summary (C3 — actual)
- ✅ **`technical_errors = 0`.** Routes did **not** degrade. MSK `+03:00` timestamps OK.
- ⚠️ **Parse distribution `primary_json = 2/4`, `repaired_json = 1/4`, `deterministic_fallback_after_llm_fail = 1/4`** — target was `primary_json ≥ 3/4`.
- Per record:
  - **batch_index 1 — Avito competitor** → `monitor_queue`, `primary_json`, `repair_used=false`. ✅ Good: competitor, good `offer_text`/`terms`/`reason`, scores 78/80.
  - **batch_index 11 — Banki forum hot pattern** → `review_queue`, `repaired_json`, `repair_used=true`. ✅ Semantically correct: `lead_signal`, `investigate`, **no direct-contact instruction**, `lead_signal_score=75`.
  - **batch_index 12 — Zoon reviews** → `content_queue`, `primary_json`, `repair_used=false`. ✅ Improved: `content_idea`, `competitor_strength=45`, `content_idea_score=70`, `quality_score=68`.
  - **batch_index 7 — Telegram @creditbrokers** → `content_queue`, `deterministic_fallback_after_llm_fail`, `repair_used=true`. ❌ Model understands the record semantically, but JSON still fails and the deterministic fallback is used. **Remaining weakness.**

### C3 table (actual)
| # | platform | entity_type | route | parse_method | repair_used | note |
|---|----------|-------------|-------|------|:----:|------|
| 1 | avito | competitor | monitor_queue | primary_json | false | good offer/terms/reason, 78/80 |
| 7 | telegram | content_idea | content_queue | deterministic_fallback_after_llm_fail | true | **still falls back (JSON fails)** |
| 11 | banki_forum | lead_signal | review_queue | repaired_json | true | correct, no direct-contact, lead 75 |
| 12 | zoon | content_idea | content_queue | primary_json | false | comp 45 / content 70 / qual 68 |

| metric | target | observed |
|--------|--------|----------|
| selected LLM records | exactly 4 | 4 |
| technical_errors | 0 | 0 |
| primary_json | ≥3/4 | **2/4** |
| repaired_json | ≤1/4 | 1/4 |
| deterministic_fallback_after_llm_fail | ≤1/4 | 1/4 |

### Verdict
- [x] **PARTIAL PASS — LLM enrichment NOT APPROVED.** Quality clearly improved (Avito/Banki/Zoon are good and safe;
  routes preserved; `technical_errors=0`), **but** the `primary_json ≥ 3/4` target was missed (2/4) because the
  Telegram `source_candidate` record still falls back. **Decision (DEC-088): give source_candidate / social channels a
  specialized ultra-short enrichment schema and re-test as Test C4.**

---

## PATCH v7 (2026-06-09, DEC-088) — specialized ultra-short enrichment schema for source_candidate / social channels

Targets the single remaining weakness (Telegram fallback) without touching the good Avito/Banki/Zoon behaviour or
raising cost.

- **Task A — specialized compact prompt (`Build Primary Claude Request`).** Records matching
  `record_type_hint=market_signal AND touchpoint_type=source_candidate`, **or** `source_type=social_channel`, **or**
  `platform=telegram` with no direct personal request now use a **separate ultra-short system prompt + minimal user
  payload** (`task=enrich_source_candidate`, platform, profile_name, profile_url, text_context, interest_topic,
  service_hint, deterministic_entity_type, deterministic_action) and a **7-key output schema** only:
  `profile_name, service_type, offer_text, detected_need, reason, content_idea_score, quality_score`. The model is told
  **not** to emit `company_name / route / entity_type / recommended_action / lead_signal_score / competitor_strength`,
  not to mention outreach, not to call it a direct lead, and not to claim users ask questions unless the text says so.
  `max_tokens=500` (smaller surface → higher strict-JSON reliability). General prompt unchanged for everything else.
- **Task B — Avito/Banki/Zoon preserved.** Those records keep the general (Avito/Banki) and review-source (Zoon)
  prompts and the v6 behaviour — no regression.
- **Task C — specialized repair (`Build Repair Request`).** For the same family, repair targets the **same 7-key
  schema** (never the 15-key general schema), `max_tokens=400`, RAW_RESPONSE = capped sanitized preview only.
- **Task D — post-merge safety assertion (`Merge …`).** For `source_type=social_channel` or
  `platform=telegram`+`source_candidate` (or `market_signal`+`source_candidate`): `route` stays `content_queue` (unless
  the deterministic route was `review_queue`), `entity_type=content_idea`, `recommended_action∈{create_content,
  investigate}`, `contact_public` empty unless literally present, `lead_signal_score=1` unless a direct personal
  request is present, `competitor_strength=1` unless the record is explicitly `competitor_activity`.
- **Merge of the 7-key output** overlays only `profile_name / service_type / offer_text / detected_need / reason /
  content_idea_score / quality_score`; `route / entity_type / recommended_action / lead_signal_score /
  competitor_strength / contact_public` stay deterministic. `parse_method=primary_json` when the specialized JSON
  parses. No `max_tokens`/cost increase (specialized path is *smaller*: 500/400 vs 700/600).

---

## TEST C4 — 2026-06-10 — ✅ PASS / LLM ENRICHMENT APPROVED WITH WATCH ITEM (v7 specialized-schema patch)

Re-ran the **same 4 fixtures** (`llm_enrichment_test_mode=true`, `llm_test_batch_indexes=[1,7,11,12]`) against the v7
specialized-schema patch. The run hit the acceptance targets: **`primary_json = 3/4`** (target ≥3/4),
`deterministic_fallback_after_llm_fail = 1/4` (≤1 acceptable), `technical_errors = 0`, routes preserved, MSK `+03:00`
timestamps OK. The Telegram `source_candidate` (the C2/C3 failure) is now **fixed** (`primary_json`, not fallback);
the one remaining fallback moved to the Banki/forum lead-pattern record, which is **safe** (the deterministic floor
routed it correctly to `review_queue`).

### Result summary (C4 — actual)
- ✅ **Exactly 4 records processed** (batch_index 1, 7, 11, 12); the other 8 not written.
- ✅ **`technical_errors = 0`.**
- ✅ **`primary_json = 3/4`**, `repaired_json = 0/4`, **`deterministic_fallback_after_llm_fail = 1/4`**.
- ✅ **`repair_used = false`** for the 3 `primary_json` rows; **`repair_used = true` only for the fallback row** (11).
- ✅ MSK timestamps correct with `+03:00`.
- ✅ Routes remained safe (unchanged from the deterministic baseline):
  - **Record 1 — Avito competitor** → `monitor_queue`, `competitor`, `monitor`, **`primary_json`**.
  - **Record 7 — Telegram @creditbrokers** → `content_queue`, `content_idea`, `create_content`, **`primary_json`** (no longer falls back). ✅
  - **Record 11 — Banki forum hot pattern** → `review_queue`, `lead_signal`, `investigate`, **`deterministic_fallback_after_llm_fail`**. Stayed `review_queue` (NOT `results`); no unsafe «обратиться напрямую» wording in the final row.
  - **Record 12 — Zoon reviews** → `content_queue`, `content_idea`, `create_content`, **`primary_json`**.
- ✅ No `results` / `contact` without `contact_public`. Record 11 stayed `review_queue`, not `results`.
- ✅ **LLM enrichment quality improved:** the compact overlay mode produced useful `offer_text` / `detected_need` /
  `reason` for the 3 `primary_json` rows.
- ⚠️ **Watch item:** the Banki/forum lead-pattern record still **fell back** (deterministic fallback). The fallback is
  **safe** (correct `review_queue` route, no unsafe contact wording), but a future enrichment prompt/model iteration
  can improve strict-JSON reliability for the forum lead-pattern family.

### C4 table (actual)
| # | platform | entity_type | route | parse_method | repair_used | Telegram not fallback? | PASS? |
|---|----------|-------------|-------|------|:----:|:----:|:----:|
| 1 | avito | competitor | monitor_queue | primary_json | false | n/a | ✅ |
| 7 | telegram | content_idea | content_queue | primary_json | false | ✅ yes | ✅ |
| 11 | banki_forum | lead_signal | review_queue | deterministic_fallback_after_llm_fail | true | n/a | ✅ (safe fallback — watch item) |
| 12 | zoon | content_idea | content_queue | primary_json | false | n/a | ✅ |

| metric | target | observed |
|--------|--------|----------|
| selected LLM records | exactly 4 | **4** |
| technical_errors | 0 | **0** |
| primary_json | ≥3/4 | **3/4** ✅ |
| repaired_json | ≤1/4 | **0/4** ✅ |
| deterministic_fallback_after_llm_fail | 0 ideally, ≤1 | **1/4** (Banki) ✅ |
| Claude cost delta | ≤ $0.04 | **C4 cost delta: TODO_OPERATOR_FILL** |

### Verdict
- [x] **PASS — LLM enrichment APPROVED WITH WATCH ITEM.** `primary_json=3/4`, `technical_errors=0`, fallback=1/4 (safe),
  routes preserved, MSK OK, Telegram fixed. **Decision (DEC-089): Stage 3.2 closed — deterministic_first baseline
  approved; compact LLM enrichment approved for optional / test use.** The **default stays `deterministic_first`**
  unless the operator explicitly enables `llm_enrichment`. **Watch item:** the Banki/forum lead-pattern still falls back
  (safe); improve in a future enrichment iteration. **Stage 3.3 (Avito/Classifieds Listing Connector) can proceed after
  commit.**

> **Final verdict — Stage 3.2 closed.** Next: **Stage 3.3 Avito/Classifieds Listing Connector** feasibility/build.

---

## TEST C2 — ATTEMPT #2 — ORIGINAL RUN INSTRUCTIONS (superseded by the actual result above)

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
