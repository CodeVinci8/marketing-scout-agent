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

## 5. Invariants

- `raw_market_records` is **separate** from `url_candidates`; `market_record_registry` is **separate** from
  `url_registry`. No existing sheet is modified.
- Connectors write `raw_market_records` with `approval_status=new`; **no Claude call** before approval.
- These are **PROPOSED** — created in Stage 3.1 only after Stage 3.0 approval. Nothing is created now.
