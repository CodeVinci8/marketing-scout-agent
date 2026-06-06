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
| `parse_method` | string | `primary_json` / `repaired_json` / `firecrawl_error` / `dedup_source_url` / `technical_error` |
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

### Dedup (v0.1)

**`source_url` is the dedup key.** **Workflow 04 implements this (DEC-049):** before any Firecrawl/Claude spend it looks up the normalized `source_url` in `results`, `review_queue`, `monitor_queue`, `content_queue`; a match → `skipped_log` with `parse_method=dedup_source_url`. `technical_errors`/`skipped_log` are **not** treated as hard duplicates (so failed/skipped URLs can be retried). Workflows 02–03 do not dedup. A dedicated `dedup_key` column is still not used; if added later it needs a documented justification and a matching header change (DEC-037).

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
