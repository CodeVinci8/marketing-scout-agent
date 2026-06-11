# COMPETITOR_AD_INTELLIGENCE_PLAN.md — Competitor Ad Intelligence (FIRST-CLASS CAPABILITY)

**Status:** 📐 CAPABILITY PLAN — describes the end-to-end competitor ad intelligence pipeline. WF09/WF08 are
built and live-proven (Stage 3.3 CLOSED, DEC-102); **WF10 v0.1 is built** (deterministic aggregator, DEC-104 —
`docs/WF10_TABLE_SCHEMAS.md`), awaiting the operator's first run.
**Date:** 2026-06-11 · **Decision:** DEC-101 (Competitor Ad Intelligence is a first-class capability of the
Business Scout Agent, not a side effect of lead discovery).

---

## 1. Stakeholder need

The stakeholder's core question is **how competitors advertise**, so we can position against them:

- **headlines** — what their ad titles promise;
- **price anchors** — "от 500 ₽ консультация", "от 30 000 ₽ за результат";
- **payment conditions** — оплата за результат, без предоплаты, работа по договору;
- **pain promises** — кредит после отказов, плохая КИ, просрочки — what pain they monetize;
- **objections handled** — без справок, без поручителей, не банк, конфиденциально;
- **channels** — Avito, Telegram, VK, websites, maps/review platforms;
- **repeated semantics** — keyword fields they all share (SEO/ad copy overlap);
- **weak points** — complaints in reviews, missing offers, vague terms;
- **content opportunities** — what we should publish/offer in response.

## 2. Pipeline

```
WF09 Avito connector  ─┐
future source connectors (Telegram, VK, reviews/maps, Dzen — Stage 3.4) ─┤
WF04/05/06 competitor website pipeline ─┘
        │
        ▼
raw_market_records  (normalized records; relevance-filtered at the source — DEC-095;
                     dedup via market_record_registry)
        │
        ▼
WF08 Touchpoint Analyzer  — one-record analysis:
   offer_text (listing title), terms (price + conditions), service_type (specific theme),
   semantic_keywords, competitor_name, competitor_strength, content_idea_score, reason
   → monitor_queue (competitor) / content_queue (semantic signal) / skipped_log (irrelevant)
        │
        ▼
WF10 Market Intelligence Aggregator (PLANNED) — cross-record synthesis over 7/14/30-day windows
        │
        ▼
competitor_profiles   — who they are, offers, prices/terms, keywords, pains targeted, channels,
                        strengths/weaknesses, evidence counts, source confidence
market_angles         — recurring ad angles + recommended content responses
content_positioning_plan — posts/ads/FAQ/counterarguments/lead magnets to produce, with evidence
```

## 3. What each layer contributes

| Layer | Contribution to ad intelligence |
|-------|--------------------------------|
| WF09 (+ future connectors) | clean, relevant, deduplicated competitor listings; preserves offer/price/seller verbatim; rejects false positives (legal-address, POS-terminal — DEC-095) |
| WF08 | per-record extraction: headline (`offer_text`), price anchor + conditions (`terms`), pain/semantic keywords, service theme, competitor strength score |
| WF10 (planned) | frequency and overlap analysis: which angles repeat, which pains are most monetized, where competitors are weak, what content gaps exist |
| Niche packs (planned) | the vocabulary (offer patterns, pains, negatives) per niche, so the same pipeline serves other niches |

## 4. Constraints

- Public data only; contacts governed by `docs/CONTACT_AND_OUTREACH_POLICY.md` (competitor staff contacts =
  `no_outreach`, identification only).
- Source costs (Apify/Firecrawl) and any LLM synthesis are operator-approved per run.
- Intelligence outputs feed **our** content/offers; no automated actions against competitors.
