# GOOGLE_SHEETS_VALIDATION_PLAN.md — Data Validation / Dropdown Plan (Operator Safety Layer)

**Status:** ✅ PLAN — operator applies manually in Google Sheets UI; no workflow change required.
**Date:** 2026-06-12 · **Decision:** DEC-111 (validation_lists is the operator safety layer).
**Related:** `docs/TABLE_SCHEMA.md`, `docs/WF10_TABLE_SCHEMAS.md`, `docs/CONTACT_AND_OUTREACH_POLICY.md`.

---

## 1. What dropdowns are (and are not)

**Dropdowns are NOT new data columns.** They are Google Sheets **data validation rules** applied to
**existing, manually edited fields**. The pipeline schemas (35/40/15/21/17/9/14/12/5 columns) do not change.
Purpose: when a human (operator/manager) edits a cell, they can only pick a valid enum value — no typos like
`aproved`, no invented statuses, no silent schema drift. System-generated append-only fields keep working
unchanged; validation simply flags (or blocks) bad manual edits.

Recommended mode: **"Show warning"** for system-written tabs (appends never get blocked),
**"Reject input"** only on fields that are exclusively human-edited (`approval_status`, `approved_by` is free
text — no rule, `responsible`).

## 2. Helper tab: `validation_lists`

Create one helper tab `validation_lists`. Each column = one named list; row 1 = list name; values below.
All dropdowns reference ranges from this tab (e.g. `=validation_lists!$A$2:$A`). Updating a list updates
every dropdown at once. This tab is operator-owned; workflows never read or write it.

### Lists (column per list)

| List | Values |
|------|--------|
| `source_type` | classified, website, social_channel, social_post, social_comment, review, forum, search, manual, unknown |
| `platform` | avito, website, telegram, vk, instagram, dzen, yandex_maps, 2gis, zoon, banki_forum, google_search, yandex_search, manual, unknown |
| `service_type` | credit_broker, business_credit, credit_after_refusals, mortgage_refinance, pts_loan, real_estate_loan, generic_lending, consumer_credit, secured_lending, unknown |
| `entity_type` | competitor, lead_signal, market_signal, content_idea, source_candidate, audience_signal, irrelevant |
| `record_type_hint` | competitor_activity, lead_signal, market_signal, content_idea, source_candidate, audience_signal, irrelevant, invalid_source_item, technical_error |
| `touchpoint_type` | competitor_listing, competitor_website, competitor_review, competitor_post, classified_offer, public_channel_post, public_comment, forum_thread, review_item, source_candidate, irrelevant_source, weak_market_noise |
| `lead_intent_hint` | none, low, medium, high, unknown |
| `urgency_hint` | none, low, medium, high, unknown |
| `lead_temperature` | none, cold, warm, hot |
| `next_action` | monitor, contact, create_content, investigate, ignore, manual_review, monitor_duplicate, no_data, enrich, report |
| `approval_status` | new, approved, rejected, duplicate, processed, needs_review, skipped |
| `dedup_status` | unique, duplicate, duplicate_in_registry, skipped_irrelevant_live, skipped_invalid, unknown |
| `processing_status` | raw_collected, analyzed, skipped, business_skip, parse_error, technical_error, completed, completed_no_data |
| `route` | results, review_queue, monitor_queue, content_queue, skipped_log, technical_errors, no_route |
| `contact_channel` | phone, email, telegram, profile, form, unknown |
| `contact_use_policy` | manager_allowed, manual_review, no_outreach, aggregate_only |
| `confidence_level` | high, medium, low, raises lead confidence only, lower |
| `request_status` | pending, completed, completed_no_data, failed, needs_review, skipped, approved |
| `request_type` | manual_touchpoint_intake, classified_competitor_discovery, market_intelligence_aggregation, social_source_discovery, report_summary, competitor_discovery, lead_search, source_discovery, niche_setup |
| `source_scope` | classified_listings, business_queues, social_public, competitor_websites, reviews_maps, search_results, manual, all |
| `boolean` | TRUE, FALSE |
| `responsible` | operator, manager, agent, manual_review, unassigned |
| `ad_channel_hint` | classifieds, website, telegram, vk, instagram, dzen, maps_reviews, forum, search, unknown |
| `freshness_status` | fresh, stale, unknown |
| `repair_status` | none, not_needed, repaired_json, failed, fallback |

> Some lists are supersets of what individual workflows emit today (e.g. `dedup_status` in WF09/WF11 also uses
> `duplicate_in_batch`, `hard_skipped`, `invalid`, `over_pipeline_limit`). Use "Show warning" mode on
> system-written columns so legitimate system values are never blocked; extend a list rather than weakening it
> if a recurring system value warns.

## 3. Where to apply dropdowns

Apply validation **mainly where humans may review or edit**. Do **not** add dropdowns to every
system-generated append-only field (ids, timestamps, hashes, free-text evidence, counters).

### 3.1 `raw_market_records` (40 cols — WF07/WF09/WF11 write; operator reviews/edits)

| Column | List |
|--------|------|
| `source_type` | source_type |
| `platform` | platform |
| `service_hint` | service_type |
| `contact_channel` | contact_channel |
| `record_type_hint` | record_type_hint |
| `touchpoint_type` | touchpoint_type |
| `lead_intent_hint` | lead_intent_hint |
| `urgency_hint` | urgency_hint |
| `competitor_related` | boolean |
| `ad_channel_hint` | ad_channel_hint |
| `lead_temperature` | lead_temperature |
| `next_action` | next_action |
| `responsible` | responsible |
| `dedup_status` | dedup_status |
| `approval_status` | approval_status *(the operator's main edit field — strongest candidate for "Reject input")* |

### 3.2 `agent_requests` (21 cols — every workflow writes; operator reads/curates)

| Column | List |
|--------|------|
| `requested_by` | responsible |
| `request_type` | request_type |
| `source_scope` | source_scope |
| `platforms` | platform *(warning mode — comma lists like `dzen,vk` are legitimate)* |
| `service_focus` | service_type |
| `status` | request_status |
| `approval_required` | boolean |

### 3.3 Business output tabs (35 cols): `results`, `review_queue`, `monitor_queue`, `content_queue`, `skipped_log`, `technical_errors`

| Column | List |
|--------|------|
| `source_type` | source_type *(warning mode — historical rows carry `scraped_web`/`manual_test`)* |
| `platform` | platform |
| `freshness_status` | freshness_status *(warning mode — Claude also emits `recent`/`old`)* |
| `entity_type` | entity_type |
| `service_type` | service_type *(warning mode — web pipeline also emits `secured_auto_loan` etc.)* |
| `recommended_action` | next_action |
| `status` | processing_status |
| `processing_status` | processing_status |
| `route` | route |
| `needs_manual_review` | boolean |
| `repair_used` | boolean |
| `repair_status` | repair_status |

### 3.4 WF10 intelligence tabs

| Tab | Column | List |
|-----|--------|------|
| `market_angles` | `category` | *(small inline list: speed, price, trust, pain, segment)* |
| `market_angles` | `confidence` | confidence_level |
| `audience_activity_signals` | `platform` | platform |
| `audience_activity_signals` | `confidence` | confidence_level |
| `content_positioning_plan` | `next_action` | next_action *(warning mode — WF10 writes sentence-style next actions; `no_data` rows match the list)* |
| `source_confidence_rules` | `confidence_effect` | confidence_level *(warning mode — seed rules carry ranges like `high (75-85)`)* |

### 3.5 Not validated (deliberately)

- ids, hashes, dedup keys, URLs, timestamps, free text (`offer_text`, `reason`, `notes`, `result_summary`, …);
- counters and scores (numeric — optionally add a number-range validation 1–100 later);
- `market_record_registry` (pure system ledger, never hand-edited);
- `validation_lists` itself.

## 4. How to apply (operator, Google Sheets UI)

1. Create the `validation_lists` tab; paste the lists above (one column each, name in row 1).
2. For each target column: select the column range below the header (e.g. `D2:D`),
   *Data → Data validation → Add rule → Dropdown (from a range)* → point to the list range
   (e.g. `=validation_lists!$A$2:$A`).
3. Choose **Show warning** (default for all system-written tabs) or **Reject input**
   (only where humans are the sole writers).
4. Optional display style "Chip" makes review queues visually scannable.

**Cost: $0. No workflow re-import needed.** Validation rules survive appends — appended values that match a
list show normally; mismatches get a warning marker, which itself is a useful data-quality signal.
