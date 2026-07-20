# Discovery LLM Enrichment — Stage F design (NOT YET ENABLED)

Status: **DESIGN ONLY. No Claude call is wired.** LLM enrichment of discovery candidates is a
**Stage F** feature. Claude / aiprimetech.io calls are not authorized in the current pre-Stage-E
scope, so this document specifies the design; the code path is gated OFF and makes zero LLM calls.

## Why LLM enrichment is optional (and last)

The deterministic pipeline already produces production-safe candidates:

1. **DISCOVERY-003** — Firecrawl Search + normalization: clean canonical URLs, VK junk/personal-page
   rejection, search-engine/marketplace/**Avito** drop, aggregator/media host override.
2. **DISCOVERY-005** — component-scored confidence (0–100), region fit (`match`/`mismatch`/`unknown`
   with penalty), competitor-vs-directory-vs-content classification, `Прочее` bucketing.
3. **DISCOVERY-006** — evidence **validation**: top in-region non-aggregator competitors are fetched
   (Firecrawl Scrape of the website homepage / `t.me/s/<channel>` / public `vk.com/<community>`),
   re-classified on the real page (title/meta/visible text/CTA/offer/region → `validated=true`,
   recomputed confidence). The add policy adds **only validated, in-region competitors** above
   threshold — never aggregators, never a region mismatch, never Avito.

LLM enrichment can only **add commentary on top of this evidence** — it must never invent facts.

## Gating

| Control | Default | Meaning |
|---|---|---|
| `MS_DISCOVERY_LLM_ENRICHMENT` (`cfg.discovery_llm_enrichment`) | `false` | master switch; when false, no LLM call is ever made |
| `MS_ENABLE_CLAUDE` (`cfg.enable_claude`) | `false` | global Claude switch; enrichment additionally requires this |
| Stage F authorization | — | operator must explicitly authorize Stage F before enabling |
| cost cap | strict | enrichment budgeted separately; hard per-run ceiling |

Enrichment runs **only** when: `discovery_llm_enrichment === true` **AND** `enable_claude === true`
**AND** paid calls are allowed **AND** the candidate is one of the **top 3–5 validated** competitors
(never an aggregator/directory/news, never a region mismatch, never unvalidated).

## Contract (input is evidence-only)

Input to the model is **only** evidence the system already collected — no free-form web access:

```json
{
  "platform": "website|telegram|vk",
  "display_name": "zalog24h.ru",
  "query_region": "Москва/МО",
  "evidence": {
    "title": "…", "description": "…",
    "page_excerpt": "… (bounded, from Firecrawl Scrape) …",
    "evidence_url": "https://zalog24h.ru",
    "deterministic": { "region_match": "match", "confidence": 83, "category": "competitor" }
  }
}
```

Required structured JSON output (validated before use; on parse failure the deterministic result stands):

```json
{
  "is_competitor": true,
  "competitor_type": "автоломбард|кредитный брокер|мфо|…",
  "region_match": "match|mismatch|unknown",
  "evidence_summary": "факты со страницы, без домыслов",
  "offer_summary": "что предлагает (если есть на странице)",
  "confidence": 0,
  "risk_flags": ["нет явного адреса", "…"],
  "reason_ru": "Почему: …"
}
```

## Hard rules (never violated)

- **No fabrication.** The model may not invent region, offers, contacts, or competitor status not
  present in the supplied evidence. `region_match` from the model may only **narrow** trust
  (e.g. downgrade to `unknown`); it can never override a deterministic `mismatch`.
- **Facts vs. recommendations** stay separated (`evidence_summary` = facts; any advice is labelled).
- **Fail-closed.** Any error, timeout, budget breach, or invalid JSON → the deterministic result is
  used unchanged. The bot never blocks on enrichment.
- **Logged.** Every enrichment call records model, token/cost, and the evidence URLs it saw.
- **No aggregators.** Enrichment is never invoked for a directory/marketplace/SERP host.

## What exists today

- `cfg.discovery_llm_enrichment` resolves from `MS_DISCOVERY_LLM_ENRICHMENT` (default `false`).
- No WF27 node calls Claude. Wiring the enrichment node is deferred to Stage F.
