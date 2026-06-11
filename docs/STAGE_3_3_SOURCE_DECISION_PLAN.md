# STAGE_3_3_SOURCE_DECISION_PLAN.md — First Real Source Connector Decision

**Status:** ✅ **AVITO/CLASSIFIEDS SELECTED, BUILT, AND STAGE 3.3 CLOSED / APPROVED (DEC-090 → DEC-102, 2026-06-11).**
Avito is the project's **first stable live source** (live run `avito_req_20260611_184324`: relevance filter PASS,
WF08 handoff PASS, $0 Claude). Next per DEC-096: Telegram public-channel feasibility (Stage 3.4 step 2).
**Stage:** 3.3 (First real source connector) of the Business Scout Agent.
**Date:** 2026-06-10 · **Decisions:** DEC-090 (Avito connector built) · DEC-084 (recommendation) · prior: DEC-077/078/079/080/081/082/089.
**Related:** `docs/STAGE_3_3_AVITO_CLASSIFIEDS_CONNECTOR_PLAN.md`, `docs/N8N_WORKFLOW_09_AVITO_CLASSIFIEDS_CONNECTOR_RU.md`,
`docs/STAGE_3_3_TEST_RESULTS.md`, `docs/LEAD_DISCOVERY_ARCHITECTURE.md`, `docs/LEAD_DATA_MODEL_PLAN.md`,
`docs/SOCIAL_CLASSIFIED_SOURCE_MATRIX.md`, `docs/STAGE_3_LEAD_SOURCE_EVALUATION.md`.

> **SELECTED & BUILT (DEC-090, 2026-06-10):** the first real source connector is the **Avito/Classifieds Listing
> Connector** (`Workflow 09`, `active=false`, **fixture mode by default — no Apify call, $0**). It transforms
> Avito/classified listings into `raw_market_records` for the Touchpoint Analyzer (Workflow 08); it directly
> supports **Competitor Ad Intelligence / Semantic Intelligence** (offers, prices/terms, ad wording, positioning,
> semantic keywords, ad channels). It writes only `agent_requests`/`raw_market_records`/`market_record_registry`,
> never the business tabs, and **never auto-runs Workflow 08** (manual handoff). Live Apify mode is documented but
> disabled by default; build-out beyond fixture requires a chosen actor + explicit operator approval + a
> feasibility/compliance check (no direct Avito scraping). **Telegram public parsing (≠ Control Bot) is the next
> feasibility (Stage 3.4); Instagram/VK/Dzen deferred.** Plan: `docs/STAGE_3_3_AVITO_CLASSIFIEDS_CONNECTOR_PLAN.md`.

> **Scope guard:** this document records the source choice and reasoning. The built Workflow 09 runs in **fixture
> mode** ($0) by default; it authorizes **no** live scraping / Apify run / external API call without explicit
> operator approval and a per-source feasibility/compliance check. No Telegram/Instagram/VK/Dzen parser or Telegram
> bot is built.

> **Status update (DEC-095, 2026-06-11):** live retest #2 (`avito_req_20260611_001222`) proved the **Apify
> transport works** (10/10 valid items), but **live business relevance failed** — the 2 unique rows were
> legal-address services, not credit-broker offers. WF09 v005 adds a business relevance filter (listing evidence
> only — title/description/decoded-slug/category; the query never makes a listing relevant; hard negatives →
> `hard_skipped`, never written). **Decision: Stage 3.3 does not close until a live run produces only relevant
> rows.** The wider social strategy is now written: `docs/STAGE_3_4_SOCIAL_SOURCE_PARSING_STRATEGY.md` (DEC-096:
> one source at a time — Avito stabilized first, then Telegram public feasibility, then VK, reviews/maps, Dzen;
> Instagram only after a separate risk review). Contact handling is governed by
> `docs/CONTACT_AND_OUTREACH_POLICY.md` (DEC-097/098).

> **Status update (DEC-092, 2026-06-10):** WF09 fixture tests + the WF08 deterministic handoff **passed** (monitor 5 /
> skipped 1 / technical_errors 0 / Claude 0), and the Competitor Ad / Semantic Intelligence fields were upgraded
> (offer/title, price/terms, specific service themes, richer keywords). **This is fixture-mode only — real Avito
> scraping has NOT been tested** (`fixture_mode=true`, `live_mode=false`, source cost $0, Apify node did not run).
> Avito remains the **first** connector; the **wider social-source parsing strategy is Stage 3.4** (Telegram/VK/
> Instagram/Dzen/review-maps — official APIs vs Apify/actor vs Firecrawl/web vs public-preview; access/legal/rate-limit
> risks; dedup/quality; competitor-intel vs lead-signal value; cost; source ranking). No social parser is built here.

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
public parsing and Instagram comment/audience mining **deferred to separate feasibility stages**.

**DEC-090 (2026-06-10):** the Avito/Classifieds Listing Connector is **built** as `Workflow 09` (`active=false`,
**fixture mode by default — no Apify call, $0**), implementing this decision. It is a deterministic, no-LLM,
fixture-first connector that supports **Competitor Ad / Semantic Intelligence** and writes only
`agent_requests`/`raw_market_records`/`market_record_registry` (never the business tabs, no auto-handoff to
Workflow 08). Live Apify mode is documented but disabled by default and gated behind a chosen actor + explicit
operator approval. See `docs/STAGE_3_3_AVITO_CLASSIFIEDS_CONNECTOR_PLAN.md` and `docs/STAGE_3_3_TEST_RESULTS.md`.
