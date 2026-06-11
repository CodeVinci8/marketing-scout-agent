# WF10_TABLE_SCHEMAS.md — WF10 Output Table Schemas (BUILD-READY SPEC)

**Status:** ✅ SPEC — these are the exact tabs/columns Workflow 10 v0.1 writes. The operator must create the 5 tabs
with these headers before the first WF10 run.
**Date:** 2026-06-11 · **Decisions:** DEC-104 (WF10 v0.1 built, deterministic).
**Related:** `docs/WF10_COMPETITOR_AUDIENCE_INTELLIGENCE_AGGREGATOR_PLAN.md`,
`docs/N8N_WORKFLOW_10_COMPETITOR_AUDIENCE_INTELLIGENCE_AGGREGATOR_RU.md`, `docs/TABLE_SCHEMA.md` (master index),
`docs/CONTACT_AND_OUTREACH_POLICY.md`.

> **v0.1 update strategy for all tables except `source_confidence_rules`: append-only snapshots.** Every WF10 run
> appends a fresh snapshot of rows (traceable via `notes`/ids carrying the `run_id` stamp). Upsert-by-primary-key
> is a v0.2 feature — defined below so the schema doesn't change later. `source_confidence_rules` is seeded once
> (only when the tab is empty) and then operator-curated.

---

## 1. `competitor_profiles` (17 columns)

| # | Column | Notes |
|---|--------|-------|
| 1 | `competitor_id` | `comp_<hash of group key>` — stable across runs for the same identity evidence |
| 2 | `competitor_name` | company_name → profile_name → `(unnamed) <offer prefix>` |
| 3 | `first_seen_at` | min `created_at` of evidence rows (MSK `+03:00`) |
| 4 | `last_seen_at` | max `created_at` (MSK `+03:00`) |
| 5 | `platforms` | comma list (`avito`, …) |
| 6 | `source_urls` | up to 3 canonical evidence URLs, ` | `-joined |
| 7 | `service_types` | comma list (credit_broker / business_credit / …) |
| 8 | `offers` | up to 3 offer_texts (headlines), ` | `-joined |
| 9 | `prices_terms` | up to 3 terms strings (price anchors + conditions) |
| 10 | `semantic_keywords` | deterministic phrase extraction (≤12) |
| 11 | `pain_points_targeted` | deterministic pain extraction |
| 12 | `ad_channels` | `classifieds` for avito/classified, else platform |
| 13 | `observed_strengths` | deterministic: price anchor present / оплата за результат / без предоплаты / high avg competitor_strength |
| 14 | `observed_weaknesses` | deterministic: no price/terms; single channel |
| 15 | `evidence_count` | rows in the group within the window |
| 16 | `source_confidence_score` | 80 if any priced listing; 60 if ≥2 evidence rows; else 45 (see `source_confidence_rules`) |
| 17 | `notes` | run_id + window + group_key (audit trail) |

- **Primary key:** `competitor_id` (within one run; v0.2 upsert key: `competitor_id`).
- **Update strategy:** v0.1 append snapshot per run; v0.2 upsert (update last_seen_at/evidence/notes, merge lists).
- **Entity matching (dedup):** group key priority — normalized `company_name` → normalized `profile_name` →
  normalized `offer_text`(≤80)+platform → listing id from `source_url` → record hash.
- **Source inputs:** `monitor_queue` rows + any row with `entity_type=competitor` (content/review), window-filtered.
- **Confidence scoring:** per `source_confidence_rules` (priced first-party listing = high).
- **Example row:** `comp_1a2b3c4d | КредитЭксперт | 2026-06-11T18:46:00+03:00 | … | avito | https://www.avito.ru/...8000151804 | credit_broker | Помощь с кредитом быстро. Кредитный брокер | от 500 ₽ | кредитный брокер, помощь с кредитом, после отказов, быстро | отказы банков | classifieds | явный ценовой якорь (от 500 ₽) | виден только один канал (avito) | 1 | 80 | wf10 v0.1 …`
- **Feeds:** Telegram summary "топ конкурентов за 30 дней"; future Business Agent answers "кто наши конкуренты и чем берут".

## 2. `market_angles` (9 columns)

`angle_id`, `angle_text`, `category` (speed/price/trust/pain/segment), `platforms`, `frequency`,
`example_sources` (≤3 URLs), `related_pain`, `recommended_content_response`, `confidence` (high ≥3 / medium 2 / low 1).

- **Primary key:** `angle_id` = `angle_<key>_<run stamp>` (angle key is stable: speed, price_anchor, no_prepayment,
  result_payment, after_refusals, bad_credit_history, business_finance, mortgage_refinance, guarantees).
- **Update strategy:** append per run (frequency is per-window); trend analysis compares runs by angle key.
- **Dedup/matching:** fixed deterministic angle taxonomy (niche-pack-able later, DEC-100).
- **Source inputs:** all window-filtered rows; matching over offer_text+terms+reason+detected_need+text_context.
- **Confidence:** by frequency; duplicates discounted upstream by registry dedup.
- **Example:** `angle_after_refusals_20260611_190000 | кредит после отказов | pain | avito | 2 | <url1> | <url2> | отказы банков | Чек-лист «7 причин отказа банка…» | medium`.
- **Feeds:** content plan generation; Telegram "какие углы давят конкуренты"; Business Agent positioning advice.

## 3. `audience_activity_signals` (14 columns) — **aggregate-only (contact policy §5)**

`signal_id`, `platform`, `source_url`, `time_window`, `active_authors_count`, `repeat_authors_count`,
`question_count`, `objection_count`, `complaint_count`, `buying_intent_count`, `top_topics`, `top_pains`,
`confidence`, `notes`.

- **Primary key:** `signal_id` = `sig_<platform>_<run stamp>`; one row per platform per run.
- **Update strategy:** append per run (time series by platform).
- **Source inputs:** window-filtered rows grouped by platform. For Avito/classified data author counts are
  **empty/unknown** (listings carry no audience info) — recorded as `''`, never invented; counts derive only from
  routed business rows (`buying_intent_count` = rows with `lead_signal_score≥50`, etc.).
- **Confidence:** `low` until comment-bearing sources (Telegram/VK) exist.
- **Example:** `sig_avito_20260611_190000 | avito | | 30d | | | 0 | 0 | 0 | 0 | credit_broker | отказы банков | low | aggregate-only…`.
- **Feeds:** Telegram weekly digest "активность аудитории по площадкам"; gates Stage 3.4 source priorities with data.

## 4. `content_positioning_plan` (12 columns)

`plan_id`, `created_at`, `niche`, `region`, `top_angles`, `recommended_posts`, `recommended_ads`, `faq_topics`
(renamed from FAQ_topics for snake_case consistency), `counterarguments`, `lead_magnets`, `source_evidence`,
`next_action`.

- **Primary key:** `plan_id` = `plan_<run stamp>`; exactly one row per run.
- **Update strategy:** append per run (history of plans).
- **Source inputs:** top-3 `market_angles` + extracted pains; all text deterministic templates (no LLM in v0.1).
- **Confidence:** inherits from angle confidences via `source_evidence` counts.
- **Example:** `plan_20260611_190000 | 2026-06-11T19:00:00+03:00 | credit_brokerage | Москва/МО | кредит после отказов (x2) | Чек-лист «7 причин отказа…» | … | FAQ: отказы банков… | … | чек-лист «7 причин отказа банка» | rows=3 (window 30d)… | operator review; no outreach`.
- **Feeds:** direct input to the operator's content calendar; later the Report Builder renders it to Telegram/MD.

## 5. `source_confidence_rules` (5 columns)

`rule_id`, `pattern`, `confidence_effect`, `rationale`, `created_at`.

- **Primary key:** `rule_id` (`sc_rule_01`…`sc_rule_07` seed).
- **Update strategy:** **seeded once** by WF10 only when the tab is empty (`write_confidence_seed_rules_if_empty=true`);
  afterwards operator-curated; WF10 never overwrites or duplicates existing rules.
- **Seed rules:** priced competitor listing=high · competitor website=high · pain repeated ≥3 sources=high ·
  isolated comment=low/medium · vague source_candidate=low · duplicate/repost=discounted · public contact raises
  lead confidence only (policy checks still apply).
- **Feeds:** documents how `source_confidence_score`/`confidence` values in the other tables are assigned; the
  future Business Agent cites these rules when explaining confidence.

---

## Telegram summary / report / Business Agent flow

```
WF10 tabs → (future) Report & Diagram Builder → Telegram weekly digest:
  top competitors (competitor_profiles, by evidence_count/confidence)
  top angles + trend vs previous run (market_angles by angle key)
  audience signals per platform (audience_activity_signals)
  this week's content plan (content_positioning_plan, latest plan_id)
Future Business Agent Control Kernel reads the same tabs to answer market questions with sourced evidence.
```
