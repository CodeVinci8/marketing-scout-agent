# LEAD_DISCOVERY_ARCHITECTURE.md — Lead Discovery Layer (DESIGN ONLY)

**Status:** 📐 DESIGN ONLY — nothing in this document is built. No connector, no parser, no bot.
**Stage:** prerequisite for Stage 3.0 (Lead Source Evaluation) → 3.1 (first connector) → 3.2 (analyzer integration).
**Date:** 2026-06-07 (Stage-3-entry note added 2026-06-08)

> **Build gate:** Do **not** implement any source connector, Telegram parser, or Telegram Control Bot from
> this document. It exists to lock the architecture so the later build stages are incremental and safe.

> **Stage 2 is finalized (APPROVED, 2026-06-08, DEC-074)** — the web pipeline (05→06→04) is the proven,
> human-approval-gated, modular template this layer generalizes. **Stage 3 starts with Stage 3.0 — Lead
> Source Evaluation, NOT the Telegram bot (DEC-076).** Preliminary (non-binding) source order:
> **Avito/Classifieds first** (public, high-intent, most tractable — pending actor/API + compliance check);
> **Telegram second** — the Telegram **Parser** (a source connector needing a separate client/MTProto access
> design) is **distinct** from the Telegram **Control Bot** (a Stage 4 controller); VK/Instagram/Yandex later.
> Manual Records Intake is wired first to validate the lead schema + analyzer at zero source risk.

---

## 1. Why this layer exists

The **primary business goal** of the future system is **lead search**, not only competitor monitoring.
The web pipeline (Workflows 05 → 06 → 04) has proven the *competitor discovery* path end-to-end. The
Lead Discovery Layer generalizes that proven shape — **discover → normalize → dedup → human approval →
analyze → route** — to **non-web, lead-bearing sources** (classifieds, social, chats, search).

Competitor monitoring stays valuable, but it is a **by-product**. Most of the new value is in finding
**people with intent** ("срочно нужны деньги под ПТС", "нужен займ под авто Москва") and the **pains/questions**
that feed content.

---

## 2. Core distinction — Controller vs Connector (do not mix)

| Concept | What it is | Example | Build status |
|---------|-----------|---------|--------------|
| **Telegram Control Bot** | An **interface/controller**. The operator issues commands; the bot triggers workflows and returns summaries. It does **not** harvest leads itself. | "собери лидов по Avito по теме займ под ПТС Москва" | ❌ Stage 4, not built |
| **Telegram Parser / Connector** | A **source connector**. It reads messages from public Telegram channels/chats to extract candidate records. Needs a client/MTProto-style approach, not the Bot API. | reads a public залоговый-займ chat for posts | ❌ Stage 3.x, not built, separate design |

**Rule (DEC):** the Telegram **Bot API** is only ever the *control surface*. Collecting historical/public
chat content is a **different** connector with its own session/compliance design. Never conflate them in code,
credentials, or planning.

### Future bot command examples (Stage 4 controller — illustrative only)
- "собери лидов по Avito по теме займ под ПТС Москва"
- "собери лидов по соцсетям по теме срочно нужны деньги под авто Москва"
- "найди лидов по Telegram-чатам по залоговым займам"
- "найди вопросы/боли по ВК на тему займов под ПТС"
- "найди конкурентов по ПТС в Москве"
- "дай summary по сильным конкурентам за неделю"

Each command maps to: **a lead_discovery_request** (region, service_focus, platforms, query) → the relevant
**connector** → `raw_market_records` → human approval → the **source-agnostic analyzer** → routed output.

---

## 3. Layer shape (mirrors the proven web pipeline)

```
                         ┌─────────────────────────────────────────────┐
   operator / (later)    │  lead_discovery_requests  (request ledger)   │
   Telegram Control Bot ─┤  region, service_focus, platforms, query     │
                         └───────────────┬─────────────────────────────┘
                                         │  one request → one or more connectors
                 ┌───────────────────────┼───────────────────────────────┐
                 ▼                       ▼                                ▼
        ┌─────────────────┐    ┌──────────────────┐            ┌──────────────────┐
        │ Avito/Classifieds│    │ Telegram Public  │   ...      │ Manual Records   │
        │ Connector        │    │ Channels/Chats   │            │ Intake           │
        └────────┬─────────┘    └────────┬─────────┘            └────────┬─────────┘
                 │  normalize to a COMMON record shape + dedup_key        │
                 └───────────────────────┬───────────────────────────────┘
                                         ▼
                          ┌──────────────────────────────┐
                          │   raw_market_records          │  (NEW sheet — not url_candidates)
                          │   approval_status=new         │
                          └───────────────┬──────────────┘
                                          │  OPERATOR approves (spend gate)
                                          ▼
                          ┌──────────────────────────────┐
                          │  Source-agnostic Market/Lead  │  (the SAME core analyzer,
                          │  Analyzer (Claude)            │   reused from Workflow 02/04)
                          └───────────────┬──────────────┘
                                          ▼
              route ∈ {results, review_queue, monitor_queue, content_queue, skipped_log, technical_errors}
                                          │
                                          ▼
                          ┌──────────────────────────────┐
                          │  market_record_registry       │  (NEW dedup ledger — NOT url-only)
                          └──────────────────────────────┘
```

**Reused, unchanged:** the resilient analyzer (Claude → repair → deterministic fallback → normalize → route)
and the six business tabs. The Lead Discovery Layer **feeds** that analyzer; it does not replace it.

---

## 4. Three responsibilities

### 4.1 Source-specific connectors (one per platform)
Each connector's only job: **pull candidate records from one source and normalize them to the common shape**.
Connectors differ in auth, rate limits, and data availability, but all emit the **same** `raw_market_records`
columns. Connectors do **not** call Claude and do **not** decide routing.

Planned connectors (all design-only here; see `LEAD_SOURCE_CONNECTORS_PLAN.md`):
- **Avito / Classifieds Connector**
- **Telegram Public Channels/Chats Connector** (client/MTProto-style, **not** the Bot API)
- **VK / Social Connector**
- **Instagram Connector**
- **Yandex / Search Connector** (a *discovery* layer, like Workflow 05, not a lead analyzer)
- **Manual Records Intake** (operator pastes records — the zero-risk bootstrap path)

### 4.2 Source-agnostic analyzer
The **same** Market/Lead Analyzer classifies any normalized record into:
- `lead_signal` — a person/entity expressing borrowing intent or pain (the priority output)
- `competitor` — a competing lender/broker post or page
- `content_idea` — a question/pain worth turning into content
- `market_signal` — a trend/aggregate observation (rates, demand, regulation chatter)
- `irrelevant` — drop

It must be **source-agnostic**: it reads `text_context` + light hints (`region_hint`, `service_hint`,
`platform`, `record_type_hint`) and never assumes the source was a website.

### 4.3 Separate record schema
Lead/social/classified records **must not** be forced into `url_candidates`. URL candidates are a *web-URL*
abstraction; lead records have authors, posts, profiles, and sometimes **no stable URL**. The Lead Discovery
Layer introduces its own raw-record concept (`raw_market_records`) and its own dedup ledger
(`market_record_registry`).

---

## 5. Proposed sheets (PROPOSED — not created)

Full column lists live in `docs/TABLE_SCHEMA.md` under "Proposed — Lead Discovery Layer". Summary:

### A. `lead_discovery_requests` — request ledger
One row per lead-search request (the lead analogue of `discovery_requests`). Tracks scope, platforms, query,
region, service focus, counts, estimated cost, and `status` ∈
`new → source_search_done → needs_review → approved → processing → processed` plus `error`, `cancelled`.

### B. `raw_market_records` — raw candidate records  *(chosen name; see §6)*
One row per discovered record (post/listing/comment/profile). Holds `source_type`, `platform`, `source_url`,
`post_url`, `profile_url`, `author_handle`, `published_at`, `text_context`, `contact_public`, `dedup_key`,
`record_type_hint` ∈ {`lead_signal`,`competitor_post`,`content_idea`,`market_signal`,`unknown`},
`lead_intent_hint`, `urgency_hint`, `confidence_score`, and `approval_status`
∈ {`new`,`approved`,`rejected`,`processed`,`duplicate`,`error`}.

### C. `market_record_registry` — dedup ledger  *(chosen name; see §7)*
Dedup by `dedup_key` (composite), tracking `source_type`/`platform`/`source_url`/`post_url`/`profile_url`,
`first_seen_at`/`last_seen_at`, and `last_route`/`last_processing_status`/`last_entity_type` for audit.

---

## 6. Record-table name decision — `raw_market_records` (chosen)

**Chosen: `raw_market_records`.** Justification: the table holds **more than leads** — it can carry
`lead_signal`, `competitor_post`, `content_idea`, and `market_signal` records from many sources. Naming it
`lead_candidates` would imply lead-only content and would mislead operators when the same row is a competitor
post or a content idea. `raw_market_records` names the **raw, pre-analysis, multi-purpose** nature accurately
and mirrors the analyzer's five output classes. (`lead_candidates` is recorded as the rejected alternative.)

---

## 7. Why URL-only `url_registry` is insufficient for lead dedup

`url_registry` dedups by **full normalized URL** — perfect for websites, wrong for social/classified leads:

- **Same intent, many places.** One person can post "нужен займ под ПТС, Москва, срочно" in several chats,
  on Avito, and on VK. URL equality would treat these as distinct; they are the **same lead**.
- **Post IDs, not clean URLs.** Messages/listings are identified by platform + post/message ID, not a
  canonical web URL; tracking params and share links make URL equality unreliable.
- **No stable URL at all.** Some records (a forwarded message, a comment, a manually pasted lead) have **no**
  durable URL.
- **Identity may need profile/text.** Dedup may require **author/profile** identity and/or a **text hash** of
  the normalized message, not just a link.

Therefore `market_record_registry` keys on a **composite `dedup_key`** — e.g.
`platform + (post_url|message_id) ` when present, else `platform + profile + hash(normalized_text)` — while the
existing `url_registry` stays **unchanged** for the web pipeline. The two ledgers coexist.

---

## 8. Source evaluation (summary; full plan in LEAD_SOURCE_CONNECTORS_PLAN.md)

| Source | Lead potential | Main risks | Initial plan |
|--------|----------------|-----------|--------------|
| **Avito / Classifieds** | High — public, high-intent listings; often contain phone/profile | anti-bot/rate limits, legal/compliance, duplicate listings, contact availability; may need Apify actor or browser automation | **Evaluate Apify actors / search URLs first.** No direct scraping until the evaluation doc is approved. |
| **Telegram** | High but hard — public channels/chats carry intent + pain | account/session management, ToS/compliance, **private chats impossible without membership/permission**, noisy data, privacy | Bot API = **control only**, later. Lead connector designed **separately** (client/MTProto). Start with **manually provided public channels/chats only**, no broad scraping. |
| **VK / Social** | Medium — public posts/comments/community search; good for pain/content + some leads | API permissions, rate limits, access constraints, noise | Evaluate VK API / Apify actor **later**. |
| **Instagram** | Low for direct leads — better for competitor content/comments | official API restrictions, scraping risk, login/session risk | **Defer** until Avito/Telegram/VK assessed. |
| **Yandex / Search** | Indirect — lead pages, forums, competitor & content-idea discovery; not usually hot leads | search quotas, result noise | Use as a **discovery** layer (like Workflow 05), **not** a lead analyzer. |

---

## 9. Recommended next step — Stage 3.0 Lead Source Evaluation (DO NOT BUILD YET)

Before any connector is built, run **Stage 3.0 — Lead Source Evaluation**, comparing **Avito vs Telegram vs VK**
across:
- **data availability** (can we legally/technically get the records?)
- **cost** (actor/API/credit cost per N records)
- **risk** (ToS/compliance/account/session/privacy)
- **lead quality** (intent density, contactability)
- **implementation complexity** (connector effort, maintenance)

**Suggested preliminary choice (pending evaluation):**
1. **Avito / Classifieds first** — public, lead-like listings with the highest intent density and the most
   tractable access, **but only after** evaluating available actors/APIs and compliance risks.
2. **Telegram second** — high value but needs a **separate parser/client design**, not just a bot; start with
   manually supplied public channels only.

No connector is implemented until the Stage 3.0 evaluation is written **and approved**.

---

## 10. Invariants the Lead Discovery Layer must preserve

- **Modularity (DEC):** keep 05 (discovery), 06 (approval runner), 04 (analyzer) as separate workflows;
  do **not** merge them into a monolith. The lead layer adds peers, it does not collapse the existing ones.
- **Human approval is the spend gate** — no record is analyzed (Claude) until `approval_status=approved`.
- **Connectors never analyze**; the analyzer never scrapes. One responsibility each.
- **`url_registry` semantics unchanged**; lead dedup uses the new `market_record_registry`.
- **No auto-processing, no schedules, no bot** in the connector layer for v0.x — manual, bounded runs only.
