# WF10_COMPETITOR_AUDIENCE_INTELLIGENCE_AGGREGATOR_PLAN.md — Workflow 10 Market Intelligence Aggregator (PLAN)

**Status:** ✅ **v0.1 BUILT (2026-06-11, DEC-104)** — the DEC-099 gate was satisfied by Stage 3.3 closure
(DEC-102: Avito is a stable live source). Implementation: `n8n/workflows/10_competitor_audience_intelligence_aggregator.json`
(`active=false`, deterministic, $0); exact column specs in `docs/WF10_TABLE_SCHEMAS.md`; operator guide in
`docs/N8N_WORKFLOW_10_COMPETITOR_AUDIENCE_INTELLIGENCE_AGGREGATOR_RU.md`. §4 step 4 (bounded LLM synthesis) is
**deferred to v0.2** — v0.1 uses deterministic templates only. This document remains the design rationale.
**Date:** 2026-06-11 · **Decisions:** DEC-099 (WF10 planned after one stable live source), DEC-101 (Competitor Ad
Intelligence is first-class).
**Related:** `docs/COMPETITOR_AD_INTELLIGENCE_PLAN.md`, `docs/NICHE_PACK_SYSTEM_PLAN.md`,
`docs/CONTACT_AND_OUTREACH_POLICY.md`, `docs/STAGE_3_4_SOCIAL_SOURCE_PARSING_STRATEGY.md`.

---

## 1. Role: WF08 vs WF10

| | Workflow 08 (built) | Workflow 10 (planned) |
|---|---------------------|------------------------|
| Question answered | **"What is this one record?"** | **"What is happening in the market overall?"** |
| Unit | one `raw_market_records` row | a time window of routed records |
| Output | one routed business row | aggregated profiles / angles / plans |
| LLM use | optional enrichment per record | synthesis over many records (bounded, approved per run) |

WF10 reads what WF08 already routed and turns isolated observations into market intelligence: who the
competitors are, what angles repeat, what the audience asks, and what content/offers we should produce.

## 2. Inputs

- `monitor_queue` (competitor records — primary)
- `content_queue` (semantic/content signals)
- `review_queue` (lead signals, pains)
- optionally `raw_market_records` (for evidence counts / dedup-aware frequency)
- **Time window:** 7 / 14 / 30 days (config)
- **Filters:** niche / platform / region / service_type (config; later supplied by niche packs)

## 3. Output tables (future Google Sheets tabs — NOT created yet)

### 3.1 `competitor_profiles`
One row per identified competitor, updated per run.

`competitor_id`, `competitor_name`, `first_seen_at`, `last_seen_at`, `platforms`, `source_urls`,
`service_types`, `offers`, `prices_terms`, `semantic_keywords`, `pain_points_targeted`, `ad_channels`,
`observed_strengths`, `observed_weaknesses`, `evidence_count`, `source_confidence_score`, `notes`.

### 3.2 `market_angles`
One row per recurring advertising/positioning angle.

`angle_id`, `angle_text`, `category` (price / speed / refusals-rescue / no-prepayment / business-finance / …),
`platforms`, `frequency`, `example_sources`, `related_pain`, `recommended_content_response`, `confidence`.

### 3.3 `audience_activity_signals`
One row per platform/source per time window. **Aggregate/statistical only** (contact policy §5).

`signal_id`, `platform`, `source_url`, `time_window`, `active_authors_count` (if available),
`repeat_authors_count` (if available), `question_count`, `objection_count`, `complaint_count`,
`buying_intent_count`, `top_topics`, `top_pains`, `confidence`, `notes`.

### 3.4 `content_positioning_plan`
One row per generated plan (per run/window).

`plan_id`, `created_at`, `niche`, `region`, `top_angles`, `recommended_posts`, `recommended_ads`,
`FAQ_topics`, `counterarguments`, `lead_magnets`, `source_evidence`, `next_action`.

### 3.5 `source_confidence_rules` (static rules table; per-record scores live in the rows above)

`rule_id`, `pattern`, `confidence_effect`, `rationale`. Seed rules:

| Evidence | Confidence |
|----------|------------|
| direct competitor listing with price/offer | **high** |
| competitor website page | **high** |
| same pain repeated across several independent sources | **high** |
| one isolated comment | **low/medium** |
| vague `source_candidate` | **low** |
| duplicate/reposted content | **lower** (count once, discount repeats) |
| explicit public contact present | raises **lead** confidence only — still passes `CONTACT_AND_OUTREACH_POLICY` checks |

## 4. Processing sketch (for the future build)

1. Manual trigger → config (window, filters, niche pack).
2. Read routed tabs; filter by window/filters; dedup by `dedup_key`/registry.
3. Deterministic grouping first: competitor_name/platform → profile candidates; keyword/angle counting.
4. Optional bounded LLM synthesis (angles naming, content plan) — operator-approved per run, cost-capped.
5. Append/update output tables; one `agent_requests` row with counts and cost; no auto-actions, no outreach.

## 5. Build gate (DEC-099)

WF10 is built only after **at least one live source is stable** (Avito connector passing live runs with the
DEC-095 relevance filter, producing clean competitor rows over multiple runs). Until then this plan is the spec.
