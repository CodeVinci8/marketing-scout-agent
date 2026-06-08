# STAGE_3_2_TOUCHPOINT_ANALYZER_PLAN.md — Stage 3.2 Plan

**Status:** 🔧 BUILT, PATCHED v3 — DETERMINISTIC-FIRST (DEC-082), UNDER RETEST (`n8n/workflows/08_touchpoint_analyzer.json`, `active=false`).
**Stage:** 3.2 (Touchpoint Analyzer) of the Business Scout Agent.
**Date:** 2026-06-08 · **Decisions:** DEC-080, DEC-081, DEC-082 · **Guide:** `docs/N8N_WORKFLOW_08_TOUCHPOINT_ANALYZER_RU.md`
**Test log:** `docs/STAGE_3_2_TEST_RESULTS.md`.

> **Patch v3 (DEC-082):** the second live test (v2) was ROUTING PASS but **LLM-stability FAIL + cost-efficiency
> FAIL** — `primary_json=0`, `repaired_json=2`, `deterministic_fallback_after_llm_fail=8`, Claude cost ≈ **$0.159
> for 12 records** while the deterministic floor did all the classification. The analyzer is now
> **deterministic-first**: `analysis_mode='deterministic_first'`, `llm_enrichment=false` (default). Obvious
> records route **without Claude** (`deterministic_pre_route` / `deterministic_irrelevant_skip`, $0); Claude is
> called only when `deterministic_needs_llm=true` or enrichment is switched on. See §6a/§7.

> **Patch v2 (DEC-081):** the first live test failed partially — the gateway returns prose/thinking/signature
> instead of JSON, so primary+repair failed and classifiable records (incl. the forum lead, record 11) fell to
> `technical_errors`. Introduced the **deterministic classification (`det`) + fallback after LLM+repair failure**
> that v3 promotes to the primary path. See §6a below.

---

## 1. Goal

Turn the normalized records produced by Stage 3.1 (Workflow 07) into **analyzed, routed** rows. The Touchpoint
Analyzer is **source-agnostic**: it reads `raw_market_records`, analyzes each record with Claude using the
**Stage 2 resilient JSON/repair pattern**, and appends to the existing **six business tabs** (35 columns) via a
dynamic route. It does **not** scrape or parse any source.

## 2. Why reuse the Stage 2 resilient analyzer

The proven Workflow 04 chain (**primary JSON → repair formatter → deterministic fallback → normalize → route**)
already solves output-contract instability. Stage 3.2 reuses it verbatim where possible:
- `Parse Primary JSON` / `Parse Repaired JSON` (balanced-brace extraction, fence-strip, quote normalization).
- `parse_method`, `repair_used`, `repair_status`, `processing_status`, `raw_response_preview`, route validation.
- `technical_errors` fallback when both primary and repair fail.
The only swaps: **input is `raw_market_records`** (not Firecrawl), and **routing is touchpoint-aware** (not
website-competitor-specific).

## 3. Source-agnostic input

One analyzer handles all current and future record platforms: Avito listing, Dzen post/channel, VK
search/post/comment, Telegram public channel/message, Yandex Maps reviews, forum discussion, review platform,
and irrelevant web/source. The connector's deterministic hints (`record_type_hint`, `touchpoint_type`,
`lead_temperature`, `urgency_hint`) are passed to Claude as **context**, but Claude makes the authoritative call.

## 4. Mapping touchpoints onto the existing 35-column schema

The 35-column business schema is **unchanged** (no new sheets, no header changes). Touchpoint classes map onto
the existing `entity_type` enum:

| Touchpoint class | entity_type | typical route |
|------------------|-------------|---------------|
| hot_lead / warm_touchpoint | `lead_signal` | `results` (hot + contact) or `review_queue` |
| competitor_activity / competitor_audience | `competitor` | `monitor_queue` |
| client_pain / question_objection / semantic_signal / ad_channel_signal / content_idea | `content_idea` (or `market_signal`) | `content_queue` |
| irrelevant | `irrelevant` | `skipped_log` |

`recommended_action` (extended with `add_to_semantics`) drives the route: contact→results,
investigate→review_queue, monitor→monitor_queue, create_content/add_to_semantics→content_queue, ignore→skipped_log.

## 5. Scoring rules (in the prompt)

- **lead_signal_score:** 90–100 direct urgent personal need + region + amount/collateral/contact; 70–89 strong
  need missing one field; 40–69 warm touchpoint/question/interest; 1–39 weak/none.
- **content_idea_score:** high for questions, objections, pains, reviews, repeated concerns, forum discussions;
  low for pure competitor ads or irrelevant.
- **competitor_strength:** high for competitor listings/pages/channels with offer/price/USP/contact; low for
  generic source candidates.
- **quality_score:** overall confidence/usefulness for the operator.

## 6. Routing safeguards (encoded, not just prompted)

- `recommended_action=contact` (→ `results`) requires `entity_type=lead_signal`, `lead_signal_score>=70`, **and**
  a usable public contact. Otherwise a lead routes to `review_queue` (investigate) — so the **forum hot-pattern
  record 11 with no direct contact does NOT auto-contact**.
- Avito competitor listings → `competitor`/`monitor_queue`.
- Dzen/VK/Telegram channels/search → source candidates → `review_queue`/`content_queue`, never `results`.
- Reviews/comments → `content_idea`/`content_queue`.
- Irrelevant → `skipped_log` **deterministically before Claude** (no spend).
- Invalid route → `technical_errors`.

## 6a. Deterministic-first routing + optional LLM enrichment (v3, DEC-082)

**Default mode is `deterministic_first` with `llm_enrichment=false`.** The deterministic classification is the
**primary** classifier; Claude is **optional enrichment, OFF by default**. `Prepare Record` computes `det` + a
`deterministic_needs_llm` flag and an LLM gate `call_claude = (NOT irrelevant) AND (llm_enrichment=true OR
deterministic_needs_llm=true)`. The **`IF Call Claude?`** node sends `false` rows to **`Build Deterministic Row`**
(no Claude, $0): irrelevant → `deterministic_irrelevant_skip`, obvious records → **`deterministic_pre_route`**.
`true` rows go to the Claude primary → repair → deterministic-fallback chain. For the 12-record fixture in the
default mode: **Claude calls = 0, `deterministic_pre_route = 10`, `deterministic_irrelevant_skip = 2`,
`technical_errors = 0`, cost delta $0.** Deterministic route scores follow the exact table in DEC-082 (Avito/clear
competitor strength 78, review-source competitor 70, source candidate content 55, hot+contact lead 85/results,
hot-no-contact lead 75/review_queue, etc.). **Future `llm_enriched` mode** (`analysis_mode='llm_enriched'`,
`llm_enrichment=true`) calls Claude on non-irrelevant records; the deterministic fallback still applies.

## 6b. Deterministic pre-classification + fallback (v2, DEC-081)

The analyzer must **not depend fully on Claude JSON**. `Prepare Record` computes a deterministic `det`
classification from the intake hints (`record_type_hint`, `touchpoint_type`, `competitor_related`,
`lead_temperature`/`lead_intent_hint`/`urgency_hint`, `service_hint`, `competitor_name`, `contact_public`,
`source_url`/`profile_name`) for **every** record. Pipeline order:

1. Filter selected records. 2. Build `det` for every record. 3. Irrelevant → `skipped_log` **before Claude**
(`deterministic_irrelevant_skip`, $0). 4. Non-irrelevant → Claude primary. 5. Primary parse. 6. On failure →
repair. 7. On repair failure → **deterministic fallback from `det`** (`deterministic_fallback_after_llm_fail`).
8. Only if `det` has no valid route (or Sheets/API error) → `technical_errors`.

Deterministic routing rules (also the floor when the gateway misbehaves):
- **irrelevant** (`record_type_hint=irrelevant` or `touchpoint_type∈{irrelevant_source,weak_market_noise}`) → `skipped_log`.
- **competitor_activity / competitor_related+competitor touchpoint** → `competitor` → `monitor_queue` (strength 70–85 clear / 55–69 weak; company from competitor_name/profile/host; service from service_hint).
- **market_signal + source_candidate** (VK/Telegram channels, search) → `content_idea` → `content_queue` (score 40–65).
- **review_source** → `monitor_queue` if competitor_related else `content_queue`.
- **question_objection / hot / high intent / high urgency** → `lead_signal`; with usable contact + direct need → `results`/`contact` (score 85–95); else → `review_queue`/`investigate` (score 70–85, needs_manual_review).
- default → `review_queue`/`content_idea`/`investigate` (still classifiable).

`parse_method` values: `primary_json`, `repaired_json`, `deterministic_irrelevant_skip`,
`deterministic_fallback_after_llm_fail`, `deterministic_pre_route`, `technical_error`.
`repair_status`: `''`, `success`, `failed_fallback`, `failed`.

**Prompt/parser hardening:** primary + repair prompts demand strict JSON only (no prose/markdown/thinking;
"Return exactly one JSON object. First char `{`, last `}`"); the repair prompt builds JSON from
`original_record` when the raw response has no usable JSON; the parser concatenates **all** `text` content
items and ignores thinking/signature blocks; raw preview + original record are preserved on failure.

## 7. Cost posture (v3 deterministic-first)

- **Default (`deterministic_first`, `llm_enrichment=false`): $0 Claude** — all classifiable records route
  deterministically; only `deterministic_needs_llm=true` records would call Claude (none in the 12-fixture).
- The prior v2 design spent ≈ **$0.159 for 12 records** for near-zero usable LLM output (TEST 2) — the reason for
  the deterministic-first switch.
- **Future `llm_enriched` mode:** primary call per non-irrelevant record (≈10), repair only on parse failure,
  bounded by `max_records=12`. Enable only after Claude JSON stability is proven. See `docs/COSTS_AND_LIMITS.md`.

## 8. Out of scope (not built here)
- No source parser/connector (Avito/Dzen/VK/Telegram/Instagram).
- No scraping, no Apify/Firecrawl.
- No changes to existing business-tab headers or to Workflows 04/05/06/07.
- No Telegram Control Bot, no scheduling, no outreach.

## 9. Exit criteria → Stage 3.3 / 3.4
- The 12 Workflow-07 records route as expected (records 1→monitor_queue, 9–10→skipped_log, 11→review_queue),
  resilient JSON/repair behaves, `technical_errors` only on genuine failures.
- Record outcomes + Claude cost in `docs/STAGE_3_2_TEST_RESULTS.md`.
- Then **Stage 3.3 — analyzer/scoring hardening** (calibrate lead/temperature/next_action on real touchpoints)
  and **Stage 3.4 — E2E** (request → connector → records → approval → analyzer → routing).
