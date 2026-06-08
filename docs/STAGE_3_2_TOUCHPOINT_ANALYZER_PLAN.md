# STAGE_3_2_TOUCHPOINT_ANALYZER_PLAN.md — Stage 3.2 Plan

**Status:** 🔧 BUILT, UNDER TEST (`n8n/workflows/08_touchpoint_analyzer.json`, `active=false`).
**Stage:** 3.2 (Touchpoint Analyzer) of the Business Scout Agent.
**Date:** 2026-06-08 · **Decision:** DEC-080 · **Guide:** `docs/N8N_WORKFLOW_08_TOUCHPOINT_ANALYZER_RU.md`
**Test log:** `docs/STAGE_3_2_TEST_RESULTS.md`.

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

## 7. Cost posture

- Irrelevant records are skipped **deterministically with no Claude call** ($0).
- Only non-irrelevant records (≈10 of the 12 fixtures) incur a primary Claude call; repair is a second call only
  on parse failure. Bounded by `max_records=12`. See `docs/COSTS_AND_LIMITS.md`.

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
