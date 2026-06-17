# GOOGLE_SHEETS_VALIDATION_PLAN.md — Data Validation / Dropdown Plan (Operator Safety Layer)

**Status:** ✅ **v1.1 — APPLIED by operator (2026-06-12):** the `validation_lists` tab exists with **26 lists**
(incl. `angle_category`); dropdowns applied in `raw_market_records`, `agent_requests`, the business tabs, and
the WF10 tabs. v1.1 makes every list **compatible with current historical data** (legacy/current values kept
alongside canonical ones) and fixes the `contact_channel` semantics (DEC-114).
**Date:** 2026-06-12 (v1.0 → v1.1 same day) · **Decisions:** DEC-111 (validation_lists is the operator safety
layer), DEC-114 (`contact_channel` is a channel category — `handle` is a contact *format*, never a channel),
DEC-115 (v1.1: 26 legacy-compatible lists; warning vs reject modes).
**Related:** `docs/TABLE_SCHEMA.md`, `docs/WF10_TABLE_SCHEMAS.md`, `docs/CONTACT_AND_OUTREACH_POLICY.md`.

---

## 1. What dropdowns are (and are not)

**Dropdowns are NOT new data columns.** They are Google Sheets **data validation rules** applied to
**existing, manually edited fields**. The pipeline schemas (35/40/15/21/17/9/14/12/5 columns) do not change.
Purpose: when a human (operator/manager) edits a cell, they can only pick a valid enum value — no typos like
`aproved`, no invented statuses, no silent schema drift. System-generated append-only fields keep working
unchanged; validation simply flags (or blocks) bad manual edits.

### Validation modes (v1.1 rule — DEC-115)

- **System-written columns → "Show warning".** n8n appends must never be blocked: when a workflow legitimately
  emits a new enum value (e.g. a new `dedup_status` from a connector patch), strict validation would break the
  append or silently corrupt runs. A warning marker is itself a useful data-quality signal — extend the list
  rather than weakening it if a recurring system value warns.
- **Human-only / manual columns → "Reject input".** Where the operator/manager is the sole writer
  (`approval_status` curation, `responsible`), typos have no legitimate source, so hard rejection is safe.
- `approved_by` stays free text — no rule.

## 2. Helper tab: `validation_lists` (v1.1 — 26 lists, CREATED by operator)

One helper tab `validation_lists`. Each column = one named list; row 1 = list name; values below.
All dropdowns reference ranges from this tab (e.g. `=validation_lists!$A$2:$A`). Updating a list updates
every dropdown at once. This tab is operator-owned; workflows never read or write it.

**v1.1 compatibility rule:** lists include both **canonical** values and **legacy/current** values already
present in historical rows (e.g. `web` next to `website`, `social_content`/`social_search` from the web
pipeline era) so existing data does not light up as invalid. Never delete a legacy value while rows carry it.

### Lists (33 — column per list; v1.2 adds 27–33 for the Lead Scout v0.3 layer)

| # | List | Values |
|---|------|--------|
| 1 | `source_type` | classified, website, web, social_channel, social_post, social_comment, social_content, social_search, review, review_platform, forum, search, manual, unknown *(+ legacy `scraped_web`, `manual_test` in historical business rows — warning mode covers them)* |
| 2 | `platform` | avito, website, web, telegram, vk, instagram, dzen, yandex_maps, 2gis, zoon, banki_forum, google_search, yandex_search, manual, unknown |
| 3 | `service_type` | credit_broker, business_credit, credit_after_refusals, mortgage_refinance, pts_loan, real_estate_loan, generic_lending, consumer_credit, secured_lending, unknown |
| 4 | `entity_type` | competitor, lead_signal, market_signal, content_idea, source_candidate, audience_signal, irrelevant |
| 5 | `record_type_hint` | competitor_activity, lead_signal, market_signal, content_idea, source_candidate, audience_signal, question_objection, irrelevant, invalid_source_item, technical_error |
| 6 | `touchpoint_type` | competitor_listing, competitor_website, competitor_review, competitor_post, competitor_content_channel, competitor_content_post, classified_offer, public_channel_post, public_comment, forum_thread, forum_discussion, review_item, review_source, source_candidate, irrelevant_source, weak_market_noise |
| 7 | `lead_temperature` | none, cold, warm, hot |
| 8 | `next_action` | monitor, contact, create_content, investigate, ignore, manual_review, monitor_duplicate, no_data, enrich, report |
| 9 | `approval_status` | new, approved, rejected, duplicate, processed, needs_review, skipped |
| 10 | `dedup_status` | unique, duplicate, duplicate_in_batch, duplicate_in_registry, hard_skipped, invalid, over_pipeline_limit, skipped_irrelevant_live, skipped_invalid, unknown |
| 11 | `processing_status` | raw_collected, analyzed, skipped, business_skip, parse_error, technical_error, completed, completed_no_data |
| 12 | `route` | results, review_queue, monitor_queue, content_queue, skipped_log, technical_errors, no_route |
| 13 | `contact_channel` | phone, email, telegram, profile, form, unknown — **never `handle`** (DEC-114: `handle` is a contact *format*; Telegram handles get `contact_channel=telegram`, the format goes to `notes` as `contact_format=handle`; empty cell = no contact) |
| 14 | `contact_use_policy` | manager_allowed, manual_review, no_outreach, aggregate_only, do_not_use *(v0.3: `do_not_use` added for weak/unprovable public-contact evidence)* |
| 15 | `confidence_level` | high, medium, low, raises lead confidence only, lower |
| 16 | `lead_intent_hint` | none, low, medium, high, unknown |
| 17 | `urgency_hint` | none, low, medium, high, unknown |
| 18 | `request_status` | pending, completed, completed_no_data, failed, needs_review, skipped, approved |
| 19 | `request_type` | manual_touchpoint_intake, classified_competitor_discovery, market_intelligence_aggregation, social_source_discovery, report_summary, competitor_discovery, lead_search, source_discovery, niche_setup |
| 20 | `source_scope` | classified_listings, business_queues, social_public, competitor_websites, reviews_maps, search_results, manual, all |
| 21 | `boolean` | TRUE, FALSE |
| 22 | `responsible` | operator, manager, agent, manual_review, unassigned |
| 23 | `ad_channel_hint` | classifieds, website, telegram, vk, instagram, dzen, maps_reviews, forum, search, unknown |
| 24 | `freshness_status` | fresh, stale, unknown |
| 25 | `repair_status` | none, not_needed, repaired_json, failed, fallback |
| 26 | `angle_category` | speed, price, trust, pain, segment |
| 27 | `review_status` | new, needs_review, accepted, rejected, duplicate, stale *(Lead Scout v0.3 — manager edit field)* |
| 28 | `review_priority` | high, medium, low |
| 29 | `score_band` | high, medium, low, ignore |
| 30 | `intent_type` | question, objection, complaint, buying_intent, content_signal |
| 31 | `pain_type` | bank_refusal, bad_credit_history, overdue_debt, refinancing_need, mortgage_need, business_finance_need, pledge_auto_pts, broker_price_question, fraud_fear, prepayment_fear, document_problem, unknown *(comma-multi — warning mode)* |
| 32 | `public_contact_type` | phone, username, profile_url *(empty = no public contact)* |
| 33 | `lead_recommended_action` | manual_review, content_idea, monitor, ignore *(Lead Scout — outreach values forbidden)* |

> v1.1 changes vs v1.0: `dedup_status` now contains the full set WF09/WF11 emit (`duplicate_in_batch`,
> `hard_skipped`, `invalid`, `over_pipeline_limit`); `source_type`/`platform` carry legacy `web` and the
> social_* variants; `record_type_hint` adds `question_objection`; `touchpoint_type` adds
> `competitor_content_channel`/`competitor_content_post`/`forum_discussion`/`review_source`; `angle_category`
> added as list #26 (replaces the v1.0 "small inline list" for `market_angles.category`). Use "Show warning"
> mode on system-written columns so legitimate system values are never blocked.

## 3. Where to apply dropdowns

Apply validation **mainly where humans may review or edit**. Do **not** add dropdowns to every
system-generated append-only field (ids, timestamps, hashes, free-text evidence, counters).

### 3.1 `raw_market_records` (40 cols — WF07/WF09/WF11 write; operator reviews/edits)

| Column | List |
|--------|------|
| `source_type` | source_type |
| `platform` | platform |
| `service_hint` | service_type |
| `contact_channel` | contact_channel *(DEC-114: workflows write the channel category — `telegram` for handles; empty = no contact)* |
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
| `market_angles` | `category` | angle_category *(list #26 — was an inline list in v1.0)* |
| `market_angles` | `confidence` | confidence_level |
| `audience_activity_signals` | `platform` | platform |
| `audience_activity_signals` | `confidence` | confidence_level |
| `content_positioning_plan` | `next_action` | next_action *(warning mode — WF10 writes sentence-style next actions; `no_data` rows match the list)* |
| `source_confidence_rules` | `confidence_effect` | confidence_level *(warning mode — seed rules carry ranges like `high (75-85)`)* |

### 3.6 `public_lead_signals` (47 cols — Lead Scout v0.3, WF14 writes; manager reviews/edits)

| Column | List | Mode |
|--------|------|------|
| `source_platform` | platform | warning |
| `source_type` | source_type | warning |
| `service_type` | service_type | warning |
| `intent_type` | intent_type | warning |
| `pain_type` | pain_type | warning *(comma-multi)* |
| `score_band` | score_band | warning |
| `freshness_status` | freshness_status | warning |
| `public_contact_type` | public_contact_type | warning |
| `contact_use_policy` | contact_use_policy | warning |
| `recommended_action` | lead_recommended_action | warning |
| `review_status` | review_status | **Reject input** *(manager's main edit field — typos must not drift)* |
| `review_priority` | review_priority | warning |
| `outreach_allowed` | boolean | **Reject input** *(must stay FALSE in Stage 3.5)* |

Not validated here (system-written / free text / numeric): `lead_signal_id`, timestamps, urls, `evidence_text`,
`evidence_excerpt`, `score_reasons`, `privacy_flags`, `policy_note`, `public_phone`, `public_username`,
`public_profile_url`, scores/`lead_score`, `manager_note`, `notes`.

### 3.5 Not validated (deliberately)

- ids, hashes, dedup keys, URLs, timestamps, free text (`offer_text`, `reason`, `notes`, `result_summary`, …);
- counters and scores (numeric — optionally add a number-range validation 1–100 later);
- `market_record_registry` (pure system ledger, never hand-edited);
- `validation_lists` itself.

## 4. How to apply (operator, Google Sheets UI) — ✅ done 2026-06-12; kept for re-application

1. Create the `validation_lists` tab; paste the lists above (one column each, name in row 1).
2. For each target column: select the column range below the header (e.g. `D2:D`),
   *Data → Data validation → Add rule → Dropdown (from a range)* → point to the list range
   (e.g. `=validation_lists!$A$2:$A`).
3. Choose **Show warning** (default for all system-written tabs) or **Reject input**
   (only where humans are the sole writers).
4. Optional display style "Chip" makes review queues visually scannable.

**Cost: $0. No workflow re-import needed.** Validation rules survive appends — appended values that match a
list show normally; mismatches get a warning marker, which itself is a useful data-quality signal.

## Addendum (2026-06-12) — New tabs for the live-source/intelligence MVP

Before re-importing WF11 v0.3 / WF12 v0.3 / WF13 v0.2 / WF14 / WF15, the operator creates (headers from
`TABLE_SCHEMA.md` §E–G and `MARKET_INTELLIGENCE_REPORT_SCHEMA.md` v0.3):
1. `competitor_site_snapshots` — 22 columns (may stay empty; WF12 tolerates absence).
2. `live_source_runs` — 23 columns (required for WF11/12/13/15 appends).
3. `public_lead_signals` — **47 columns (v0.3 Lead Scout, Stage 3.5, DEC-138)** — migrate the old 28-col tab to
   the 47 headers in `TABLE_SCHEMA.md` §G before re-importing WF14 v0.3 (required for WF14; WF12 tolerates absence
   and both schemas). Add the §3.6 dropdowns; confirm `outreach_allowed` only ever contains `FALSE`; `#ERROR!`
   check on `public_phone` (`+7 …` must render as text — DEC-124).
4. `market_intelligence_reports` — extend/recreate headers to the 25-column v0.3 layout.
Validation: append-only; `#ERROR!` check on `contact_public` cells with `+7…` values (must render as text —
DEC-124); `approval_token_used` in `live_source_runs` must only ever contain `yes`/`no`.

---

## Long report rows — visual formatting recommendations (2026-06-17)

The `market_intelligence_reports.notes` cell carries the **full** Markdown report inline (DEC-128). This is by
design and **must not be truncated** — the row is the single source of truth for "what was reported when". The
only side effect is large row height in Google Sheets. This is a **display ergonomics** matter, not a workflow
bug, and is handled in the Sheet UI, not by shortening the data.

**Recommended formatting for the `market_intelligence_reports` tab (operator, in Sheets UI):**

- **Keep the full Markdown field** (`notes`). Do not truncate, do not split across runs.
- Set long-text columns (`notes`, `top_competitors`, `top_angles`, `audience_summary`, `llm_summary_ru`,
  `llm_recommendations_ru`) text-wrap to **Clip** (Format → Wrapping → Clip) or a **controlled Wrap** with a
  fixed row height — Clip keeps every row the same height and the full text stays in the cell/formula bar.
- **Vertical align: Top** for the whole tab (Format → Vertical align → Top) so clipped rows read cleanly.
- Optional **fixed row height** for the report table (right-click row → Resize rows → set a fixed px height) so
  one giant report does not stretch the sheet.
- Keep the **summary fields short** (`top_competitors`, `top_angles`, `audience_summary` are already short,
  bounded strings) so the at-a-glance columns stay readable while `notes` holds the full report.
- **Future UX option (no data loss):** when a cleaner display is needed, export the full report to a
  Google Doc / a Markdown artifact (`report_markdown_path`) / a Telegram digest, **while keeping the full raw
  Markdown in Sheets**. The Sheet stays the source of truth; the export is a view.

**Do not** call Google Sheets formatting APIs from a workflow in the current patch. There is no existing,
safe formatting script; formatting is a one-time manual UI step per tab. (If a vetted formatting script is added
later, it must be idempotent and touch only display properties, never cell values.)
