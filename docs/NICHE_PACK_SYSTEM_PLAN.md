# NICHE_PACK_SYSTEM_PLAN.md — Niche Pack System (PLAN)

**Status:** 📐 PLAN ONLY — no YAML packs are created yet; workflows still use hardcoded credit-broker rules.
**Date:** 2026-06-11 · **Decision:** DEC-100 (Niche Pack System planned to remove hardcoded niche rules).
**Related:** `docs/STAGE_3_4_SOCIAL_SOURCE_PARSING_STRATEGY.md`, `docs/WF10_COMPETITOR_AUDIENCE_INTELLIGENCE_AGGREGATOR_PLAN.md`,
`docs/CONTACT_AND_OUTREACH_POLICY.md`, `docs/COMPETITOR_AD_INTELLIGENCE_PLAN.md`.

---

## 1. Problem

The DEC-095 business relevance filter hardcodes credit-broker terms inside Workflow 09's Normalize node, and
Workflow 08's deterministic enrichment hardcodes the same niche. Every new niche (or new source connector)
would duplicate and drift these lists. The fix: externalize niche knowledge into versioned **niche packs**.

## 2. Proposed layout

```
niches/
  secured_lending.yaml
  credit_brokerage.yaml
  crypto_research.yaml
  real_estate_brokers.yaml
  local_services.yaml
```

## 3. Niche pack fields

| Field | Purpose | Used by |
|-------|---------|---------|
| `niche_id` | stable id (`credit_brokerage`) | all |
| `display_name` | human name | reports |
| `core_services` | canonical service list (maps to `service_type`) | WF08/WF09/WF10 |
| `positive_keywords` | weak relevance terms (Cyrillic + translit for URL slugs) | WF09 relevance |
| `strong_positive_phrases` | phrases that alone make a listing relevant | WF09 relevance |
| `hard_negative_terms` | terms that mark false positives (legal address, POS terminals, …) | WF09 relevance |
| `intent_keywords` | buying-intent phrases ("посоветуйте", "срочно нужен") | WF08 lead scoring |
| `competitor_offer_patterns` | offer/terms patterns (оплата за результат, без предоплаты…) | WF08 enrichment, WF10 angles |
| `pain_patterns` | audience pain phrases (отказы, просрочки, плохая КИ) | WF08/WF10 |
| `platform_priorities` | ranked source list for this niche | Stage 3.4 rollout, WF10 filters |
| `scoring_weights` | weights for confidence/lead/content scores | WF08/WF09 |
| `contact_policy_overrides` | may only **tighten** `CONTACT_AND_OUTREACH_POLICY` | all |
| `risk_rules` | niche-specific compliance notes (e.g. financial-services ad rules) | operator review |
| `source_priorities` | per-source query/start-URL templates | connectors |

## 4. Minimal example (illustrative only — full packs come with the build stage)

```yaml
# niches/credit_brokerage.yaml (EXAMPLE SKELETON)
niche_id: credit_brokerage
display_name: "Кредитный брокеридж (Москва/МО)"
core_services: [credit_broker, business_credit, credit_after_refusals, mortgage_refinance]
strong_positive_phrases: ["кредитный брокер", "помощь в получении кредита", "кредит после отказов",
  "ипотечный брокер", "рефинансирование ипотеки", "кредит для бизнеса", "банковские гарантии"]
positive_keywords: ["кредит", "займ", "ипотека", "просрочки", "подбор банка", "одобрение кредита"]
hard_negative_terms: ["юридический адрес", "регистрация ооо", "бухгалтерские услуги", "эквайринг",
  "pos-терминал", "онлайн-касса", "печать", "штамп", "эцп", "аренда офиса", "коворкинг"]
contact_policy_overrides: {}   # tighten-only
```

## 5. How WF09 / WF08 / WF10 will consume packs

- **WF09 (and every future connector):** the Normalize node's relevance term sets (`STRONG_POS`/`WEAK_POS`/
  `HARD_NEG` from DEC-095) are loaded from the selected pack instead of being inlined; config gets
  `niche_id='credit_brokerage'`. Same hard rule stays: query alone never makes a record relevant.
- **WF08:** deterministic enrichment (offer/terms/service_type detection, intent and pain matching, score
  weights) reads pack fields instead of the hardcoded `classifiedCompetitorDet()` lists; the LLM enrichment
  prompt receives the pack's service/pain vocabulary as context.
- **WF10:** angle categories, pain taxonomies, platform filters, and report headings come from the pack, so one
  aggregator serves all niches.
- **Loading mechanism (to decide at build time):** either a `Set Niche Pack` Code node generated from YAML at
  export time, or a small file-read step on the VPS; packs are version-controlled in git.

## 6. Migration order

1. Stage 3.3 closes with hardcoded credit-broker rules (acceptable for one niche, one source).
2. When the **second source connector** (Telegram) or the **second niche** appears — extract the rules into
   `niches/credit_brokerage.yaml` and refit WF09/WF08 to read them (behavior-preserving refactor, fixture-tested).
3. WF10 is built pack-aware from day one.
