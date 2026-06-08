# STAGE_3_3_SOURCE_DECISION_PLAN.md — First Real Source Connector Decision

**Status:** 📐 DECISION PLAN ONLY — **no connector built**, nothing approved to scrape.
**Stage:** 3.3 (First real source connector) of the Business Scout Agent.
**Date:** 2026-06-08 · **Decisions:** DEC-084 (recommendation) · prior: DEC-077/078/079/080/081/082.
**Related:** `docs/LEAD_DISCOVERY_ARCHITECTURE.md`, `docs/LEAD_DATA_MODEL_PLAN.md`,
`docs/SOCIAL_CLASSIFIED_SOURCE_MATRIX.md`, `docs/STAGE_3_LEAD_SOURCE_EVALUATION.md`.

> **Scope guard:** this document only **recommends** the first real connector and records the reasoning.
> It does **not** build the Avito connector, Telegram parser, Dzen/VK/Instagram parser, or the Telegram bot,
> and it authorizes **no** scraping / Apify / Firecrawl / external API call. Build only after explicit operator
> approval and a per-source feasibility/compliance check.

---

## 1. Prerequisite — Stage 3.2 is closed

- **Stage 3.1 Manual Touchpoint Intake** passed: run 1 = 12 unique → `raw_market_records` + 12 registry rows;
  run 2 = 12 `duplicate_in_registry`, registry +0 (idempotent dedup confirmed).
- **Stage 3.2 Touchpoint Analyzer** has an **approved deterministic_first baseline** (TEST 3: `technical_errors=0`,
  Claude calls=0, `repair_used=false`, routes 6/3/1/2). LLM enrichment is **optional / under test** (TEST 4).
- The connector → `raw_market_records` → registry dedup → analyzer → route contract is therefore proven on
  manually-provided records. A real connector is the next step, but the analyzer/data-model do **not** change.

## 2. Candidate first sources

| # | Source | What it gives | Dedup key | Complexity | Risk | Best for |
|---|--------|---------------|-----------|:---------:|:----:|----------|
| 1 | **Avito / Classifieds Listing Connector** | competitor listings, offers, prices, ad wording, semantics, occasional lead-like posts | listing **URL / item id** (simple) | **Low** | **Low–Med** | competitors, offers, semantics, ad copy |
| 2 | **Telegram Public Channel / Message** | public channel posts, questions, market pains, content ideas | platform + message_id | Medium | Medium (client/MTProto, ToS) | public pains/questions, content/market signals |
| 3 | **Dzen comments / posts** | competitor content, audience pains, comment mining | platform + post/comment id | Medium | Medium | content ideas, competitor content |
| 4 | **VK public posts / comments** | public posts/comments, group activity, pains | platform + owner+post/comment id | Medium–High | Medium–High | audience pains, competitor audience |
| 5 | **Instagram competitor / comments** | competitor content, comments | platform + media/comment id | High | High (access/ToS) | competitor content (not hot leads) |

(Each maps onto the existing 40-column `raw_market_records` shape and the 12 record classes; see
`docs/LEAD_DATA_MODEL_PLAN.md`. Connectors **never** call Claude; the analyzer **never** scrapes.)

## 3. Recommendation — Avito/Classifieds Listing Connector FIRST

**The first real connector after Stage 3.2 should be the Avito/Classifieds Listing Connector**, because:

- **Easiest source structure** — listings are well-structured (title, price, description, region, contact area).
- **Closest to the existing Stage 2 web/URL model** — it reuses the URL-normalize + `*_registry` dedup spine and
  the Apify-actor pattern already used by Workflow 05; smallest architectural jump.
- **High-value content** — competitor offers, prices, USP/ad wording, and semantics for the secured-lending niche
  (PTS/auto/real-estate, Moscow/MO).
- **Simple dedup** — by listing **URL / item id**, no fuzzy author/text hashing needed for the common case.
- **Lower risk** than Telegram/Instagram audience or comment scraping (no client/MTProto session, no member/DM
  surface, public listings only).

### Caveat — what Avito is NOT for
Avito is **not** the best source for comments / subscribers / audience mining. Treat it as:
- a **competitor listing source**,
- an **offer / semantic / ad-wording source**,
- an **occasional lead-like source** (some listings resemble demand),

**not** as an audience/commenter-mining source. Hot-lead yield will be modest; its main value is competitor and
semantic intelligence.

## 4. Second / separate feasibility — Telegram

- Useful for **public channel messages, questions, market pains**, content/market signals.
- **The Telegram Control Bot is NOT the Telegram Parser** (reaffirms DEC-067): the bot is a control interface
  (Stage 4); the parser is a source connector needing a **separate client / MTProto-style session and compliance
  design**.
- **Groups / members / comments / DMs are higher-risk** and require their own design + approval; do not bundle
  them with the public-channel reader.
- Sequence: Telegram **public channel/message feasibility** comes **after** Avito, as its own feasibility stage.

## 5. Instagram and the rest

- **Instagram** — likely useful for **competitor content/comments**, **less useful for hot leads**; higher
  access/ToS risk. **Defer until after Avito + Telegram feasibility.**
- **Dzen / VK** — public posts/comments feasibility after Avito, ranked by value vs risk; comment/audience mining
  is public-data-only and minimized.

## 6. Recommended sequence

1. **Stage 3.3a — Avito/Classifieds Listing Connector** (first real connector; build only after feasibility +
   approval). Output → `raw_market_records` (`approval_status=new`), dedup by listing URL/id, **no Claude**.
2. **Stage 3.3b — Telegram public channel/message feasibility** (separate parser design; not the bot).
3. **Stage 3.3c — Dzen / VK public feasibility.**
4. **Stage 3.3d — Instagram feasibility** (deferred).

The analyzer (Workflow 08) and data model are **reused unchanged** for every source.

## 7. Out of scope (not built / not authorized here)
- No Avito connector, no Telegram parser, no Dzen/VK/Instagram parser, no Telegram bot.
- No scraping, no Apify/Firecrawl/external API call, no credentials, no real Spreadsheet ID.
- No schema changes; no workflow activation.

## 8. Decision recorded
**DEC-084:** Stage 3.3's recommended first real connector is the **Avito/Classifieds Listing Connector** (lowest
complexity, matches the existing web/URL data model, strong for competitors/offers/semantics), with Telegram
public parsing and Instagram comment/audience mining **deferred to separate feasibility stages**. No connector
is built by this plan.
