# STAGE_3_3_AVITO_CLASSIFIEDS_CONNECTOR_PLAN.md — Stage 3.3 Plan

**Status:** 🔧 BUILT, UNDER TEST (fixture mode default) — `n8n/workflows/09_avito_classifieds_listing_connector.json`, `active=false`.
**Stage:** 3.3 (First real source connector) of the Business Scout Agent.
**Date:** 2026-06-10 · **Decisions:** DEC-090 (build) · DEC-084 (source choice) · prior DEC-078/079/080/089.
**Guide:** `docs/N8N_WORKFLOW_09_AVITO_CLASSIFIEDS_CONNECTOR_RU.md` · **Test log:** `docs/STAGE_3_3_TEST_RESULTS.md`.
**Source decision:** `docs/STAGE_3_3_SOURCE_DECISION_PLAN.md` · **Next stage:** Stage 3.4 (Telegram public feasibility).

---

## 1. Goal

Build the **first real source connector** after manual intake (Workflow 07): the **Avito/Classifieds Listing
Connector** (Workflow 09). It transforms Avito/classified listing data into `raw_market_records` rows so that the
**Touchpoint Analyzer (Workflow 08)** can later analyze and route them into the business queues. The connector is
**deterministic, no-LLM, fixture-first**, and never writes to the business route tabs.

Primary business value: **Competitor Ad Intelligence / Semantic Intelligence** — competitor offers, prices/terms,
ad wording, positioning, semantic keywords, targeted pains, and ad channels for the secured-lending / credit-broker
niche (Moscow/MO).

## 2. Why Avito first (DEC-084 → DEC-090)

- **Lowest complexity** real source — listings are well-structured (title, price, description, region, seller).
- **Closest to the existing web/URL data model** — reuses URL-normalize + `*_registry` dedup spine and the
  Apify-actor pattern already proven in Workflow 05; smallest architectural jump.
- **Directly supports competitor offer / semantic / ad intelligence** — exactly what the stakeholder cares about.
- **Simple, stable dedup** — by listing **id / URL**, no fuzzy author/text hashing required for the common case.
- **Lower risk** than Telegram/Instagram audience or comment scraping (public listings, no client/MTProto session,
  no member/DM surface).

## 3. Scope (what Stage 3.3 builds)

- Workflow 09: Manual Start → Set Config → IF fixture_mode → (Build Fixture | Apify actor) → Normalize → Read
  registry → Deduplicate → Build raw rows (40) → Append raw → Build registry rows (15, unique) + Build agent_requests
  row (21) → Appends → Final Summary.
- **fixture_mode=true** by default (6 representative listings, **no Apify call, $0**).
- Optional **live Apify** mode (`fixture_mode=false`, `live_mode=true`, actor id + credential) — documented, not run.
- Writes only `agent_requests`, `raw_market_records`, `market_record_registry` (unique only).
- MSK `+03:00` timestamps; ids `avito_req_*` / `avito_rec_*` / `avito_*`.

## 4. Out of scope (not built / not authorized here)

- **No business-tab writes** (results/review_queue/monitor_queue/content_queue/skipped_log/technical_errors) — that
  stays with Workflow 08.
- **No auto-handoff** to Workflow 08 (manual only).
- **No Claude/LLM** call, **no Firecrawl**, **no direct Avito scraping**, **no real Apify run by default**.
- **No Telegram/Instagram/VK/Dzen parser, no Telegram bot, no scheduling.**
- **No schema changes** (reuses the existing 40/15/21 columns), **no workflow activation**, **no real credentials /
  keys / Spreadsheet ID**.

## 5. Architecture & mapping

Listing → normalized record (deterministic) → `raw_market_records` (40 cols). Key mappings:
`source_type=classified`, `platform=avito`, `source_url=post_url=`listing URL, `profile_url=`seller URL,
`profile_name=seller_name`, `region_hint`, `service_hint` (credit_broker / business_credit / mortgage_refinance),
`text_context` (compact title+price+location+desc+query), `record_type_hint`/`touchpoint_type` (competitor_activity/
competitor_listing · market_signal/classified_offer · irrelevant/irrelevant_source), `semantic_keywords`,
`ad_channel_hint=classifieds`, `competitor_related`, `competitor_name`, `probable_need`, `confidence_score`,
`lead_temperature`, `next_action`, `manager_note` (competitor ad-intelligence note), `dedup_key`
(`avito::classified::avito_listing_<id>` or `…avito_url_<hash>`). Classification uses **title+description+category
only** (not the search query) so the query never inflates the type.

Registry row (15): `last_route` = predicted route, `last_processing_status=raw_collected`, `last_entity_type`,
`author_handle=seller_name`, `note=avito_classifieds_connector_stage_3_3`. agent_requests row (21): `status=completed`,
`source_scope=classified_listings`, `platforms=avito`, `result_summary=total/unique/duplicates/skipped`,
`next_action='Run Workflow 08 on collected raw records manually'`.

## 6. Acceptance criteria

- JSON valid; `active=false`; default `fixture_mode=true` / `live_mode=false`; no real keys / Spreadsheet ID; MSK
  helpers present; no bare `new Date().toISOString()` for operational timestamps; no `tool_use`; no `KEY=VALUE`.
- Writes only `agent_requests` / `raw_market_records` / `market_record_registry`; **no** business-tab writes.
- `raw_market_records` output = 40 columns; `market_record_registry` = 15; `agent_requests` = 21 (exact match to
  Workflow 07 schema).
- **Test 1 (fixture, empty registry):** 6 raw rows; 6 unique registry rows; 1 agent_requests row (status=completed);
  predicted routes `monitor_queue=5`, `skipped_log=1`; `skipped_count=1`; cost $0.
- **Test 2 (fixture, repeat):** all 6 `duplicate_in_registry` / `approval_status=duplicate`; raw +6 (audit);
  registry +0; duplicate competitor `next_action=monitor_duplicate`, irrelevant `next_action=ignore`.
- Fixture test runs **without Apify**. Duplicate test supported.

## 7. Test plan

See `docs/STAGE_3_3_TEST_RESULTS.md` (Test 1 fixture first run, Test 2 fixture duplicate run, Test 3 optional live
Apify smoke test, Test 4 Workflow 08 handoff).

## 8. Risks

- Avito anti-bot / rate-limits / ToS → Apify-actor (not direct scraping), live disabled by default, explicit approval
  required.
- Relistings/duplicates → handled by `listing_id`/URL-hash dedup.
- Hidden contacts → `contact_public` only when explicitly present (never invented).
- Live cost depends on the Apify actor; fixture = $0.
- Deterministic keyword classification is coarse; nuanced semantic/offer enrichment is Workflow 08's job (optional
  LLM enrichment), not this connector.

## 9. Next stage

- **Stage 3.4 — Telegram public source feasibility** (separate parser design; ≠ Control Bot).
- **Stage 3.5 — Competitor Semantic & Ad Intelligence aggregation** (later) — aggregate offers/keywords/ad channels
  across collected records into reusable competitor/semantic intelligence.
