# LEAD_DATA_MODEL_PLAN.md — Lead Discovery Data Model (DESIGN / PROPOSED ONLY)

**Status:** 📐 PROPOSED ONLY — these sheets are **not created** in Google Sheets and **no workflow writes them.**
**Stage:** 3.0 design output; sheets would be created in Stage 3.1 only after approval.
**Date:** 2026-06-08
**Authoritative column lists:** `docs/TABLE_SCHEMA.md` → "Proposed — Lead Discovery Layer". This doc explains
the **why**; `TABLE_SCHEMA.md` holds the canonical column tables.

> **Do not reuse `url_candidates` for lead records.** Lead records are not URLs. They are posts, listings,
> comments, messages, profiles, forum threads, or manually pasted snippets — often with **no stable URL**.
> They get their own schema and their own non-URL dedup ledger. `url_candidates`/`url_registry` are **unchanged**.

> **REFRAME (2026-06-08, DEC-078):** under the Business Scout Agent, the request ledger is generalized from
> `lead_discovery_requests` to **`agent_requests`** (a `request_type` field selects the tool — touchpoint
> discovery, comment mining, semantic/ads, etc.). We keep **one** request table, not two. `raw_market_records`
> is **expanded** for touchpoints/comments/competitor/semantic signals (12 record classes, `comment_text`,
> `touchpoint_type`, `lead_temperature`, `next_action`, …), and `market_record_registry`'s FK is now
> `agent_request_id`. The **authoritative, current** column lists live in `TABLE_SCHEMA.md` → "Proposed —
> Business Scout Agent Layer"; the tables in §2–§4 below are the earlier lead-only draft, retained for rationale.

---

## 1. Three proposed sheets (planned, not created)

| Sheet | Role | Web-pipeline analogue |
|-------|------|------------------------|
| `lead_discovery_requests` | one row per lead-search request (scope, query, counts, cost, status) | `discovery_requests` |
| `raw_market_records` | one row per discovered record (post/listing/comment/profile/snippet) | `url_candidates` |
| `market_record_registry` | non-URL dedup ledger keyed on a composite `dedup_key` | `url_registry` |

---

## 2. A. `lead_discovery_requests`

One row per request, the lead analogue of `discovery_requests`.

**Columns:** `lead_request_id`, `created_at`, `requested_by`, `request_text`, `source_scope`, `platforms`,
`query`, `region`, `service_focus`, `requested_limit`, `status`, `candidate_count`, `unique_count`,
`duplicate_count`, `approved_count`, `estimated_source_cost_usd`, `estimated_analysis_cost_usd`, `notes`.

**Why two cost columns.** `estimated_source_cost_usd` (Apify/API/actor collection) is tracked **separately** from
`estimated_analysis_cost_usd` (Claude). They have different drivers and different gates: source cost is spent at
collection, analysis cost is spent only **after approval** (see `COSTS_AND_LIMITS.md`).

**`status` values:** `new` → `source_search_done` → `needs_review` → `approved` → `processing` → `processed`;
plus `error`, `cancelled`.

## 3. B. `raw_market_records`

**Name chosen: `raw_market_records`** (not `lead_candidates`). Justification: **not every record is a lead.**
The same table carries leads, competitor posts, client pains, questions/objections, market signals, and
irrelevant noise. Naming it `lead_candidates` would mislead operators when a row is a competitor post or a
content idea. `raw_market_records` names the **raw, pre-analysis, multi-purpose** nature accurately and mirrors
the analyzer's output classes.

**Columns:** `record_id`, `lead_request_id`, `created_at`, `source_type`, `platform`, `source_url`, `post_url`,
`profile_url`, `profile_name`, `author_handle`, `published_at`, `region_hint`, `service_hint`, `query`,
`text_context`, `contact_public`, `dedup_key`, `record_type_hint`, `lead_intent_hint`, `urgency_hint`,
`candidate_type`, `confidence_score`, `dedup_status`, `approval_status`, `approved_by`, `approved_at`,
`estimated_analysis_cost_usd`, `notes`.

**`record_type_hint` values:** `lead_signal`, `competitor_post`, `content_idea`, `market_signal`, `irrelevant`,
`unknown`.
**`candidate_type` values:** `potential_client`, `competitor_activity`, `client_pain`, `question_objection`,
`market_noise`, `unknown`.
**`approval_status` values:** `new`, `approved`, `rejected`, `processed`, `duplicate`, `error`.

**Hints are deterministic, not LLM.** `record_type_hint`, `candidate_type`, `lead_intent_hint`, `urgency_hint`,
and `confidence_score` are cheap deterministic guesses set by the connector to help the operator triage **before
spend**. The source-agnostic analyzer (Claude) makes the authoritative call **after approval**.

## 4. C. `market_record_registry`

Non-URL dedup ledger. **Name chosen over `lead_registry`** because it parallels `raw_market_records` (records,
not just leads).

**Columns:** `dedup_key`, `source_type`, `platform`, `source_url`, `post_url`, `profile_url`, `author_handle`,
`text_hash`, `first_seen_at`, `last_seen_at`, `last_route`, `last_processing_status`, `last_entity_type`,
`lead_request_id`, `note`.

### `dedup_key` strategy (composite, in priority order)
1. **If `post_url` exists:** `dedup_key = platform + post_url` (the listing/message/post permalink).
2. **Else if `source_url` + `profile_url` + `published_at` exist:** `dedup_key = hash(source_url + profile_url +
   published_at)`.
3. **Else:** `dedup_key = platform + (author_handle | profile_url) + text_hash`, where `text_hash` is a hash of
   the normalized record text (stored in the registry's `text_hash` column).
4. **Never dedup by domain alone.** Domain equality is meaningless for social/classified leads.

### Why URL-only `url_registry` is insufficient
- **Same intent, many places** — one person reposts the same need across Avito, VK, and chats; URL equality sees
  several leads where there is one.
- **Post IDs, not clean URLs** — records are identified by platform + post/message id; share links and tracking
  params make URL equality unreliable.
- **No stable URL at all** — forwarded messages, comments, and pasted leads have no durable URL.
- **Identity may need profile + text** — dedup sometimes requires author identity and a normalized text hash,
  not a link.

Therefore `market_record_registry` keys on the **composite `dedup_key`** above and stores `text_hash` and
`author_handle` to support fallback identity. The existing `url_registry` stays **URL-only and unchanged** for
the web pipeline; the two ledgers coexist.

---

## 4a. Stage 3.1 implementation candidate (BUILT, UNDER TEST)

`Workflow 07 — Manual Touchpoint Intake` (`n8n/workflows/07_manual_touchpoint_intake.json`, `active=false`) is
the **first implementation** of this data model. The operator has created the four tabs (`agent_requests`,
`raw_market_records`, `market_record_registry`, `agent_memory`); Workflow 07 writes the first three and proves
the 40-column record shape, the composite `dedup_key`, and registry dedup with hand-picked examples. **No LLM,
no scraping, no external API.** See `docs/STAGE_3_1_MANUAL_TOUCHPOINT_INTAKE_PLAN.md` and
`docs/N8N_WORKFLOW_07_MANUAL_TOUCHPOINT_INTAKE_RU.md`. `agent_memory` is **not** written yet.

## 4b. Stage 3.2 — analyzer consumes the data model (BUILT, UNDER TEST)

`Workflow 08 — Touchpoint Analyzer` (`active=false`) is the **first consumer** of `raw_market_records`. It reads
`dedup_status=unique` records whose `approval_status` is allowed, analyzes them (Claude, resilient JSON/repair),
and writes the existing **35-column** business tabs (`results`/`review_queue`/`monitor_queue`/`content_queue`/
`skipped_log`/`technical_errors`). It does **not** modify `raw_market_records`, `market_record_registry`,
`agent_requests`, or `agent_memory`. The connector→record→analyzer→route contract is now exercised end to end on
manually-provided records. See `docs/STAGE_3_2_TOUCHPOINT_ANALYZER_PLAN.md`.

**Hints power deterministic routing (DEC-081).** The hint columns (`record_type_hint`, `touchpoint_type`,
`competitor_related`, `lead_temperature`, `lead_intent_hint`, `urgency_hint`, `service_hint`, `competitor_name`,
`probable_need`, `contact_public`) are not only triage aids — Workflow 08 uses them to **deterministically
classify and route every record** when Claude fails to return valid JSON. This makes the analyzer resilient to
gateway prose/thinking output and confirms the intake hints carry enough signal to route without an LLM.

**Hints are now the PRIMARY classifier (DEC-082).** Because the second live test proved the intake hints route
the records correctly without any LLM (and Claude cost ≈$0.159/12 for `primary_json=0`), Workflow 08 is
**deterministic-first**: it classifies and routes from the hint columns by default (`analysis_mode=
'deterministic_first'`, `llm_enrichment=false`) and calls Claude only for records the hints cannot resolve
(`deterministic_needs_llm=true`) or when enrichment is explicitly enabled. The quality of these hint columns —
set by the connector / manual intake — now directly determines routing quality, so connectors should populate
`record_type_hint`, `touchpoint_type`, `competitor_related`, `lead_temperature`/`lead_intent_hint`/`urgency_hint`,
`service_hint`, and `contact_public` as accurately as possible.

## 5. Invariants

- `raw_market_records` is **separate** from `url_candidates`; `market_record_registry` is **separate** from
  `url_registry`. No existing sheet is modified.
- Connectors write `raw_market_records` with `approval_status=new`; **no Claude call** before approval.
- These are **PROPOSED** — created in Stage 3.1 only after Stage 3.0 approval. Nothing is created now.
