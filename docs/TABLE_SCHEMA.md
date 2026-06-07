# TABLE_SCHEMA.md — Google Sheets Output Schema

One row per analyzed item. All columns populated by the pipeline.
Claude API fills the analysis columns; n8n fills the metadata columns.

**Last updated:** 2026-06-06 — production reality for the Resilient Router added: 6 tabs, 8 technical columns, test-only columns marked non-production (DEC-037).

---

## Production Reality — Resilient Router (DEC-037)

The production workflow `02_claude_api_single_record_v2_resilient_router_production.json` writes one row to **one of six tabs**, chosen dynamically by the `route` field (Sheet Name = `={{ $json.route }}`).

> **Workflow 03 (Firecrawl single URL, DEC-039–042)** writes to the **same six tabs**. It sets `source_type=scraped_web`, `platform=website`; a Firecrawl failure or empty/unusable page produces a `technical_errors` row (`parse_method=firecrawl_error`) without calling Claude.

> **Schema is now 35 columns (DEC-048).** All six tabs were extended with **`run_id`** and **`batch_index`** for batch traceability. **Workflow 04 (Firecrawl URL list mini-batch)** fills them (`run_id` per execution, `batch_index` = 1-based URL position); **Workflows 02 and 03 may leave them empty** (they auto-map and simply omit the two fields, which the append node writes as blank). A duplicate `source_url` detected by Workflow 04 produces a 35-field `skipped_log` row with `parse_method=dedup_source_url`, **no Firecrawl/Claude cost**.

### Six tabs (names must match `route` exactly)

| Tab | Receives |
|-----|----------|
| `results` | Hot leads — `lead_signal`, `lead_signal_score ≥ 70`, action `contact` |
| `review_queue` | Weak/potential leads — score 30–69, `investigate`, or social/classified product mention; fallback bucket |
| `monitor_queue` | Competitors — `competitor_strength ≥ 45` |
| `content_queue` | Pure content ideas — `content_idea`, `content_idea_score ≥ 50`, not a weak lead |
| `skipped_log` | Business skips — `status=skipped` or `entity_type=irrelevant` |
| `technical_errors` | Parse failures after repair, or invalid route — `needs_manual_review=true` |

### Production columns = 25 core + 8 technical + 2 batch = **35 columns**

Every tab uses the same header row. The **25 core columns** are the Column Reference table below. The **8 technical columns** are:

| Column | Type | Values |
|--------|------|--------|
| `processing_status` | string | `parsed_success` / `business_skip` / `technical_error` |
| `parse_method` | string | `primary_json` / `repaired_json` / `firecrawl_error` / `dedup_source_url` / `firecrawl_placeholder_prefilter` / `deterministic_competitor_fallback` / `technical_error` |
| `parse_error` | string | error text or empty (may include `invalid_route`) |
| `raw_response_preview` | string | first **500** chars of the raw model response (debugging) |
| `route` | string | one of the six tab names |
| `needs_manual_review` | boolean | `true` for repaired/technical_error rows |
| `repair_used` | boolean | `true` if the JSON Repair Formatter ran |
| `repair_status` | string | `success` / `failed` / empty |

The **2 batch columns** (DEC-048), filled by Workflow 04, optional/empty for Workflows 02–03:

| Column | Type | Values |
|--------|------|--------|
| `run_id` | string | one id per execution, e.g. `firecrawl_YYYYMMDD_HHmmss` |
| `batch_index` | integer | 1-based position of the URL within the run (0 if N/A) |

### Test-only columns — NOT production

These exist only in the **test harness** (`..._resilient_router_test_dynamic_sheet.json`) and must NOT appear in production tabs: `test_id`, `expected_route`, `expected_entity_type`, `expected_recommended_action`, `expected_quality_range`, `actual_entity_type`, `actual_recommended_action`, `actual_quality_score`, `actual_lead_signal_score`, `actual_content_idea_score`, `actual_competitor_strength`, `test_pass_basic`, `test_notes`, and `source_record_type`. The production workflow does not emit them.

### Header rule (DEC-038)

Each of the six Google Sheets tabs must use **exactly the same 35-column header row** — the 25 core columns (Column Reference below), then the 8 technical columns, then `run_id`, `batch_index`, in that order. No extra columns. The dynamic append node auto-maps by header name, so a missing or renamed header silently drops that field.

**Columns are internal English machine names.** Russian/human-friendly display names are a **future reporting/Telegram layer concern**, not part of the internal schema — do not rename the Sheets headers to Russian (DEC-038).

### Diagnostics on failure (DEC-038)

When a row lands in `technical_errors`, it preserves both failure stages so the operator can debug:
- `parse_error` = `Primary: <primary parse error> | Repair: <repair error>` (capped ~800 chars).
- `raw_response_preview` = the **primary** raw model response first (capped 500), with the repair error appended only if space remains. The primary raw response is never overwritten by the repair error alone.
- `parse_method` = `technical_error` on a failed repair; `primary_json` / `repaired_json` on success.

### Dedup (v0.1) — `url_registry` (DEC-051, supersedes the six-tab scan)

**`source_url` (normalized) is the dedup key, tracked in a dedicated `url_registry` tab.** **Workflow 04 (patched 2026-06-08):** before any Firecrawl/Claude spend, `Registry Lookup` reads `url_registry` and matches `normalized_source_url`; a match (with `force_reprocess=false`) → `skipped_log` with `parse_method=dedup_source_url`, **0 cost**. The earlier four-tab `Dedup Lookup` scan (`results/review_queue/monitor_queue/content_queue`) is **rejected as fragile and removed**. After every non-duplicate processing attempt (including `technical_errors`), Workflow 04 appends a row to `url_registry`. `force_reprocess` (default `false`) bypasses dedup for manual/future overrides. Workflows 02–03 do not dedup.

### `url_registry` tab — 10 columns (NOT the 35-column business schema)

A separate registry tab, written/read only by Workflow 04. Its own header (10 columns, in order):

| # | Column | Type | Description |
|---|--------|------|-------------|
| 1 | `normalized_source_url` | string | dedup key — normalized URL (lowercase scheme/host, no `#fragment`, no tracking params, no trailing slash) |
| 2 | `source_url` | string | normalized URL as stored on the business row |
| 3 | `first_seen_at` | string | ISO 8601 when first processed |
| 4 | `last_seen_at` | string | ISO 8601 of this processing attempt |
| 5 | `last_route` | string | last business route (`monitor_queue`, `technical_errors`, …) |
| 6 | `last_processing_status` | string | `parsed_success` / `business_skip` / `technical_error` |
| 7 | `last_entity_type` | string | last `entity_type` |
| 8 | `run_id` | string | `firecrawl_YYYYMMDD_HHmmss` |
| 9 | `batch_index` | integer | 1-based URL position |
| 10 | `note` | string | `processed_by_workflow_04` |

**Column counts:** the **6 business tabs use 35 columns**; **`url_registry` uses its own 10 columns**; the discovery tabs are **`url_candidates` = 26 columns** and **`discovery_requests` = 18 columns** (Stage 2.2, Workflow 05 built/under test — see below). **No existing sheet is removed.** **Workflows 02/03 may leave `run_id`/`batch_index` empty**; **Workflow 04 fills `run_id`/`batch_index`** on every business path and populates `url_registry`.

**Placeholder pre-filter (DEC-054).** Before the Claude call, `Normalize Firecrawl Output` detects obvious placeholder/parking/domain-not-connected pages (e.g. Wix "domain not connected", parking page, `сайт/домен не подключен`, `заглушка сайта`, or bare "coming soon" with no business content) and emits a **35-field `skipped_log`** row with `parse_method=firecrawl_placeholder_prefilter` (`processing_status=business_skip`, scores 1, `recommended_action=ignore`) — **no Claude cost**. The row still appends to `url_registry` so the URL is not re-processed by default.

**Source of truth + backfill (DEC-053).** `url_registry` is the **single source of truth for dedup**. Business rows written **before** the registry existed do **not** dedup unless their `normalized_source_url` is backfilled into `url_registry`. This is why a previously-analyzed URL can be re-processed on the first run after the registry is introduced (registry was empty) — expected behaviour. Backfilling older rows into `url_registry` is **optional future maintenance**, not required. Validated 2026-06-08: Run 1 (empty registry) processed 3 URLs; Run 2 (same 3) skipped all via dedup at 0 cost.

### `url_candidates` tab — 26 columns (Workflow 05 BUILT/under test, Stage 2.2 — DEC-055/058/060/061)

The discovery **supplier** sheet (Workflow 05). Holds candidate URLs and a human approval gate; **no
candidate reaches Firecrawl/Claude until `approval_status=approved`**. Written by the discovery layer;
`url_registry` is read-only from here. `normalized_source_url` uses Workflow 04's normalizer so it matches
`url_registry` exactly. **DEC-061 added `candidate_type` (col 11, after `domain`) → 26 columns**, and moved
`domain` ahead of `title`/`snippet`. Header (26 columns, in order):

| # | Column | Type | Description |
|---|--------|------|-------------|
| 1 | `candidate_id` | string | `cand_YYYYMMDD_HHmmss_<index>` |
| 2 | `discovery_request_id` | string | groups one request, `disc_YYYYMMDD_HHmmss` |
| 3 | `created_at` | string | ISO 8601 intake time |
| 4 | `requested_by` | string | `manual` / `operator` / `telegram_operator` / `system` |
| 5 | `requested_limit` | integer | default candidate count (usually 10) |
| 6 | `query` | string | original topic/query |
| 7 | `source` | string | `manual` / `search_api` / `apify_search` / `serp_actor` / `telegram_operator` / `unknown` |
| 8 | `candidate_url` | string | raw URL as provided |
| 9 | `normalized_source_url` | string | normalized key — matches `url_registry` |
| 10 | `domain` | string | hostname, lowercased, leading `www.` stripped (e.g. `autolombard-moskva.ru`) |
| 11 | `candidate_type` | string | `direct_competitor` / `aggregator` / `directory` / `media_article` / `marketplace` / `social` / `unknown` |
| 12 | `title` | string | result title |
| 13 | `snippet` | string | result snippet |
| 14 | `rank` | integer | position in the source result list |
| 15 | `region_hint` | string | e.g. `Москва/МО` |
| 16 | `service_hint` | string | e.g. `pts_loan` |
| 17 | `confidence_score` | integer | 1–100 deterministic relevance (direct competitors rank above aggregators/directories/media) |
| 18 | `dedup_status` | string | **discovery-time hint only** (advisory): `unique` / `duplicate_in_batch` / `duplicate_in_registry`. Set once by Workflow 05; operator-editable. **Not** the final dedup gate — Workflow 06 re-checks `url_registry` at runtime (DEC-065). |
| 19 | `registry_status` | string | **discovery-time hint only** (advisory): `not_in_registry` / `in_registry`. Set once by Workflow 05; operator-editable. **Not** the final dedup gate — Workflow 06 re-checks `url_registry` at runtime (DEC-065). |
| 20 | `approval_status` | string | `new` / `approved` / `rejected` / `processed` / `duplicate` / `error` |
| 21 | `approved_by` | string | operator id (blank until approved) |
| 22 | `approved_at` | string | ISO 8601 (blank until approved) |
| 23 | `rejection_reason` | string | free text |
| 24 | `estimated_firecrawl_credits` | integer | estimate if processed (0 for duplicates) |
| 25 | `estimated_claude_cost_usd` | number | estimate if processed (0 for duplicates) |
| 26 | `notes` | string | free text |

**`candidate_type` enum:** `direct_competitor` (lender / autolombard / MFO / broker offering loans directly),
`aggregator` (comparison/listing portals — banki.ru, vbr.ru, finuslugi.ru), `directory` (map/review listings —
2gis), `media_article` (articles/listicles — kp.ru), `marketplace` (classified/marketplace platforms),
`social` (social networks/channels), `unknown` (fallback). **Direct competitors are prioritized for approval;
aggregators/directories/media are optional intelligence, not direct competitors.**

**`approval_status` lifecycle (no new sheet — Workflow 05 writes, operator approves, Workflow 06 runs):**

```
new ──(operator approves)──> approved ──(Workflow 06 + confirmed WF04 processing)──> processed
duplicate  — stays duplicate   (Workflow 05 marked it a dedup/registry duplicate; never processed)
rejected   — stays rejected    (operator declined; never processed)
error      — set on runner/processing failure
```

- `new` → set by Workflow 05 for unique candidates (and for aggregators/directories/media, with a "review manually" note).
- `approved` → set **by the operator**; also fill `approved_by` + `approved_at`. This is the spend gate.
- `processed` → set after **Workflow 06 (DEC-064)** hands the URL to Workflow 04 **and** the operator confirms `monitor_queue` output (via the disabled `Mark Candidates Processed` node or manually). `approved_by`/`approved_at` are preserved; `notes` gets `Processed by Workflow 06 run_id=…`.
- `duplicate` / `rejected` → terminal; Workflow 06 never selects them. Workflow 06 requires `approval_status=approved` + non-empty `candidate_url` + the **re-normalized** URL **absent from `url_registry`** (runtime recheck, DEC-065). `dedup_status`/`registry_status` are advisory hints, **not** the gate: even if the operator manually sets them to `unique`/`not_in_registry`, a URL already in `url_registry` is skipped as `registry_recheck_duplicate`.
- `error` → reserved for a runner/processing failure on an approved candidate.
- `candidate_type` in {`aggregator`,`directory`,`marketplace`,`social`,`media_article`} **can** be selected if `approval_status=approved` (DEC-065 relaxed the old `aggregator_approved` hard block), but the selected item carries a warning (`candidate_type is not direct_competitor; review before Workflow 04`).
- **Workflow 06 `runner_mode` is workflow config, NOT a `url_candidates` column** (DEC-072). Set in the WF06 `Set Runner Config` node: `first_pass_domain_diversity` (DEFAULT — max 1 selected URL per normalized **domain** per run; extras → `duplicate_domain_in_run`) or `deep_domain_analysis` (EXPLICIT — up to 3 URLs/domain/run; extras → `domain_deep_limit`). Domain is re-derived from `candidate_url` at runtime. This is a **per-run selection rule only** and does **not** change `url_registry` (still full-normalized-URL dedup, never domain). No sheet column changes.

> **Google Sheet change required:** the existing `url_candidates` tab must be updated from 25 → 26 columns by
> inserting **`candidate_type` immediately after `domain`** (col 11), with `domain` positioned before
> `title`/`snippet`. The Workflow 05 append uses auto-mapping by header name, so the header must match exactly.

### `discovery_requests` tab — 18 columns (Workflow 05 BUILT/under test, Stage 2.2 — DEC-059/060)

One row per discovery request (Workflow 05). Groups all `url_candidates` of that request via
`discovery_request_id`; used for summaries and the future Telegram bot. Header (18 columns, in order):

| # | Column | Type | Description |
|---|--------|------|-------------|
| 1 | `discovery_request_id` | string | `disc_YYYYMMDD_HHmmss` |
| 2 | `created_at` | string | ISO 8601 |
| 3 | `requested_by` | string | `manual` / `operator` / `telegram_operator` / `system` |
| 4 | `request_text` | string | raw operator request (NL, esp. from Telegram) |
| 5 | `query` | string | search query sent to Apify |
| 6 | `region` | string | e.g. `Москва` |
| 7 | `service_focus` | string | e.g. `pts_loan` / `secured_auto_loan` / blank |
| 8 | `requested_limit` | integer | candidate target (default 10) |
| 9 | `source_mode` | string | `search` / `manual` |
| 10 | `source_api` | string | `apify_search` / `google_cse` / `serpapi` / `manual` / `unknown` |
| 11 | `status` | string | `new` / `search_done` / `needs_review` / `approved` / `processing` / `processed` / `error` / `cancelled` |
| 12 | `candidate_count` | integer | total candidates written |
| 13 | `unique_candidate_count` | integer | `dedup_status=unique` count |
| 14 | `duplicate_count` | integer | duplicate (registry + batch) count |
| 15 | `approved_count` | integer | candidates moved to `approved` |
| 16 | `estimated_firecrawl_credits` | integer | sum over unique candidates |
| 17 | `estimated_claude_cost_usd` | number | sum over unique candidates |
| 18 | `notes` | string | free text |

**`status` values:** `new`, `search_done`, `needs_review`, `approved`, `processing`, `processed`, `error`, `cancelled`.

**Tab column counts:** 6 business tabs = **35**; `url_registry` = **10**; `url_candidates` = **26**; `discovery_requests` = **18**. Existing sheets (`results`, `review_queue`, `monitor_queue`, `content_queue`, `skipped_log`, `technical_errors`, `url_registry`) are **kept — nothing is removed**.

---

## Column Reference

| # | Column Name           | Type    | Source     | Description |
|---|-----------------------|---------|------------|-------------|
| 1 | `created_at`          | string  | n8n (Code) | ISO 8601 timestamp when the row was created (pipeline run time) |
| 2 | `source_type`         | string  | n8n Set    | Source category: `manual_test` / `scraped_web` / `apify` / `firecrawl` / `social` / `classified` / `unknown` |
| 3 | `platform`            | string  | n8n Set    | Platform name: `avito`, `vk`, `instagram`, `website`, `manual_test`, etc. |
| 4 | `source_url`          | string  | scraper    | URL of the scraped page or listing |
| 5 | `parsed_at`           | string  | n8n Set    | Date when the item was scraped (YYYY-MM-DD) |
| 6 | `published_at`        | string  | scraper    | Original publish date of the content (if available, else empty) |
| 7 | `freshness_status`    | string  | Claude     | `fresh` (≤7 days) / `recent` (8–30 days) / `old` (>30 days) / `unknown` |
| 8 | `entity_type`         | string  | Claude     | `competitor` / `lead_signal` / `market_signal` / `content_idea` / `irrelevant` |
| 9 | `company_name`        | string  | Claude     | Company or brand name if detected, else empty |
|10 | `profile_name`        | string  | Claude     | Individual or author name if detected, else empty |
|11 | `profile_url`         | string  | scraper    | Direct link to profile or author page |
|12 | `region`              | string  | Claude     | City or region explicitly mentioned in source text, else empty |
|13 | `service_type`        | string  | Claude     | `secured_auto_loan` / `secured_real_estate_loan` / `pts_loan` / `refinancing` / `mortgage_adjacent` / `generic_lending` / `unknown` |
|14 | `offer_text`          | string  | Claude     | 1-sentence description of what is offered or advertised |
|15 | `terms`               | string  | Claude     | Explicitly stated price, rate, or conditions; empty if none |
|16 | `contact_public`      | string  | Claude     | Publicly visible contact info from source text only (phone, email, Telegram); empty if none |
|17 | `text_context`        | string  | n8n        | Cleaned summary of raw source text, max 300 characters |
|18 | `detected_need`       | string  | Claude     | 1-sentence inferred need or intent of the author; empty if not a lead |
|19 | `competitor_strength` | integer | Claude     | 1–100: assessed strength of this competitor (1 if entity is not a competitor) |
|20 | `lead_signal_score`   | integer | Claude     | 1–100: likelihood this record represents a potential inbound client |
|21 | `content_idea_score`  | integer | Claude     | 1–100: value as inspiration for content marketing |
|22 | `quality_score`       | integer | Claude     | 1–100: overall quality and actionability of this record |
|23 | `reason`              | string  | Claude     | 2–3 sentences explaining the scores and recommended action |
|24 | `recommended_action`  | string  | Claude     | `monitor` / `contact` / `create_content` / `ignore` / `investigate` |
|25 | `status`              | string  | Claude     | `analyzed` (record processed normally) / `skipped` (boilerplate or low quality) |

---

## Scoring Scale

All numeric scores use the **1–100 integer scale** (not 0–10).

| Score range | Interpretation |
|-------------|----------------|
| 80–100 | High value — rich data, clear signals, directly actionable |
| 60–79 | Useful — good data with minor gaps |
| 40–59 | Weak — partial data, incomplete context |
| 20–39 | Low — sparse or ambiguous, minimal value |
| 1–19 | Skip — noise, boilerplate, or irrelevant (status = skipped) |

**Quality gate (v1 only):** In the legacy single-step Workflow 02 v1, only rows with `status = analyzed` AND `quality_score >= 60` were written. The **Resilient Router replaces this binary gate with multi-tab routing** (DEC-035/036): every analyzed record is written to the tab named by `route` — low-value rows land in `skipped_log` rather than being dropped.

---

## Entity Type Values

| Value | Meaning |
|-------|---------|
| `competitor` | Business or individual actively offering secured lending products |
| `lead_signal` | Person or business actively seeking a secured loan |
| `market_signal` | News item, regulation, or industry trend providing strategic context |
| `content_idea` | Discussion, question, or topic revealing client pain points |
| `irrelevant` | No connection to secured lending or financial services |

---

## Status Values

| Value | Set by | Meaning |
|-------|--------|---------|
| `analyzed` | Claude | Record was analyzed normally; scores are meaningful |
| `skipped` | Claude | Record was too short, boilerplate, or irrelevant; quality_score = 1 |

---

## Notes

- `text_context` is truncated to 300 characters before sending to Claude to control token cost.
- `contact_public` stores only contact information that is explicitly visible in the source text — no inference.
- `published_at` may be empty if the scraper cannot determine the publish date.
- `competitor_strength` is 1 (minimum) when `entity_type` is not `competitor`.
- Scores are assigned by Claude; they reflect the model's assessment based on the prompt calibration in `modules/marketing-scout-v0/MARKETING_AGENT_PROMPT_V1.md`.
- The `results` sheet must have a single horizontal header row (row 1). See DEC-017.
- **`service_type` normalization (DEC-036):** the resilient router's `Normalize + Route` node maps free-text `service_type` returned by Claude/repair into the enum above (e.g. `"займ под залог ПТС"` → `pts_loan`). Always one of the seven enum values reaches Sheets; raw free text is never written.
- **`company_name` fallback (DEC-036):** when Claude returns an empty `company_name` for a `competitor`, the resilient router writes a descriptive label (`МФО / частный кредитор`, `Частный инвестор`, `Автоломбард`, `Брокер`, or `Конкурент без бренда`) instead of leaving it blank. It never invents a real brand name.

---

## Mapping: Uncle's Requested Fields → Current Columns

These fields were requested by the operator (confirmed 2026-06-05). Full mapping in `docs/BUSINESS_REQUIREMENTS.md` Section 9.

| Requested | Current column | Gap |
|-----------|---------------|-----|
| Name / title | `company_name` + `profile_name` | None |
| Source link | `source_url` | None |
| Offer | `offer_text` | None |
| Terms | `terms` | None |
| Public contacts | `contact_public` | None |
| Region | `region` | None |
| Competitor strength | `competitor_strength` | None |
| Client pain | `detected_need` | Partial — v2 will expand to capture pain dimension explicitly |
| Recommendation | `recommended_action` | None |
| Comment / source link | `profile_url` | Partial — Telegram/Instagram comment links may need dedicated field |
| Scores | `quality_score`, `lead_signal_score`, `content_idea_score`, `competitor_strength` | None |
| Verification fields | Not in schema | Planned post-v0.1 |

---

## Proposed — Lead Discovery Layer (PROPOSED, NOT CREATED)

> **Status:** 📐 PROPOSED only. These three sheets are **not created** in Google Sheets and **no workflow
> writes them yet.** They support the future Lead Discovery Layer (see `docs/LEAD_DISCOVERY_ARCHITECTURE.md`
> and `docs/LEAD_SOURCE_CONNECTORS_PLAN.md`). Build is gated behind Stage 3.0 (Lead Source Evaluation) approval.
> The existing web-pipeline sheets (6 business tabs, `url_registry`, `url_candidates`, `discovery_requests`)
> are **unchanged**; `url_registry` semantics are **not** altered.

### A. `lead_discovery_requests` (proposed) — lead-search request ledger

One row per lead-search request (the lead analogue of `discovery_requests`).

| # | Column | Type | Notes |
|---|--------|------|-------|
| 1 | `lead_request_id` | string | unique id, e.g. `lead_req_YYYYMMDD_hhmmss` |
| 2 | `created_at` | string | ISO 8601 |
| 3 | `requested_by` | string | operator id (later: from the control bot) |
| 4 | `request_text` | string | raw operator command, e.g. "собери лидов по Avito по теме займ под ПТС Москва" |
| 5 | `source_scope` | string | e.g. `classified` / `social` / `search` / `mixed` |
| 6 | `platforms` | string | comma list, e.g. `avito` / `telegram,vk` |
| 7 | `query` | string | normalized search query |
| 8 | `region` | string | e.g. `Москва/МО` |
| 9 | `service_focus` | string | e.g. `pts_loan` |
| 10 | `requested_limit` | integer | max records to discover this run |
| 11 | `status` | string | see status set below |
| 12 | `candidate_count` | integer | records discovered |
| 13 | `unique_count` | integer | non-duplicate records |
| 14 | `duplicate_count` | integer | duplicates per `market_record_registry` |
| 15 | `approved_count` | integer | records approved by operator |
| 16 | `estimated_cost_usd` | number | estimated downstream analysis cost (source cost tracked separately) |
| 17 | `notes` | string | free text |

**`status` values:** `new`, `source_search_done`, `needs_review`, `approved`, `processing`, `processed`,
`error`, `cancelled`.

### B. `raw_market_records` (proposed) — raw candidate records

Chosen over `lead_candidates` because it holds leads **and** competitor posts, content ideas, and market
signals (see `LEAD_DISCOVERY_ARCHITECTURE.md` §6). One row per discovered record.

| # | Column | Type | Notes |
|---|--------|------|-------|
| 1 | `record_id` | string | unique id, e.g. `rec_YYYYMMDD_hhmmss_N` |
| 2 | `lead_request_id` | string | FK → `lead_discovery_requests` |
| 3 | `created_at` | string | ISO 8601 |
| 4 | `source_type` | string | `classified` / `social` / `scraped_web` / `manual` |
| 5 | `platform` | string | `avito` / `telegram` / `vk` / `instagram` / `website` / `manual` |
| 6 | `source_url` | string | canonical source URL if any (may be empty) |
| 7 | `post_url` | string | listing/message/post URL if any |
| 8 | `profile_url` | string | author/seller profile URL if any |
| 9 | `profile_name` | string | display name |
| 10 | `author_handle` | string | @handle / seller id |
| 11 | `published_at` | string | original post time if known |
| 12 | `region_hint` | string | e.g. `Москва/МО` |
| 13 | `service_hint` | string | e.g. `pts_loan` |
| 14 | `query` | string | query that surfaced the record |
| 15 | `text_context` | string | normalized record text (cap ~3500, same as web analyzer input) |
| 16 | `contact_public` | string | deterministic public contact only (same sanitation rules as Workflow 04) |
| 17 | `dedup_key` | string | composite key (see `market_record_registry`) |
| 18 | `record_type_hint` | string | `lead_signal` / `competitor_post` / `content_idea` / `market_signal` / `unknown` |
| 19 | `lead_intent_hint` | string | deterministic intent guess (no LLM) |
| 20 | `urgency_hint` | string | deterministic urgency guess (no LLM) |
| 21 | `candidate_type` | string | reserved (parallels `url_candidates.candidate_type`) |
| 22 | `confidence_score` | integer | 1–100 deterministic relevance |
| 23 | `dedup_status` | string | `unique` / `duplicate_in_batch` / `duplicate_in_registry` (advisory — analyzer/runner re-checks) |
| 24 | `approval_status` | string | `new` / `approved` / `rejected` / `processed` / `duplicate` / `error` |
| 25 | `approved_by` | string | operator id |
| 26 | `approved_at` | string | ISO 8601 |
| 27 | `estimated_analysis_cost_usd` | number | per-record Claude estimate |
| 28 | `notes` | string | free text |

**`record_type_hint` values:** `lead_signal`, `competitor_post`, `content_idea`, `market_signal`, `unknown`.
**`approval_status` values:** `new`, `approved`, `rejected`, `processed`, `duplicate`, `error`.

### C. `market_record_registry` (proposed) — non-URL dedup ledger

Chosen over `lead_registry` (parallels `raw_market_records`). Dedups by a **composite** `dedup_key`, because a
URL-only key is insufficient for social/classified leads (same intent reposted across places; post IDs vs
URLs; records with no stable URL; identity may need profile + text hash — see `LEAD_DISCOVERY_ARCHITECTURE.md`
§7). **Separate from `url_registry`, which stays URL-only for the web pipeline.**

| # | Column | Type | Notes |
|---|--------|------|-------|
| 1 | `dedup_key` | string | composite: `platform + (post_url|message_id)` else `platform + profile + hash(normalized_text)` |
| 2 | `source_type` | string | `classified` / `social` / `scraped_web` / `manual` |
| 3 | `platform` | string | `avito` / `telegram` / `vk` / … |
| 4 | `source_url` | string | if any |
| 5 | `post_url` | string | if any |
| 6 | `profile_url` | string | if any |
| 7 | `first_seen_at` | string | ISO 8601 |
| 8 | `last_seen_at` | string | ISO 8601 |
| 9 | `last_route` | string | last analyzer route |
| 10 | `last_processing_status` | string | last processing status |
| 11 | `last_entity_type` | string | last classified entity |
| 12 | `lead_request_id` | string | last request that touched it |
| 13 | `note` | string | free text |
