# SOCIAL_CLASSIFIED_SOURCE_MATRIX.md — Practical Source Matrix (EVALUATION ONLY)

**Status:** 📐 EVALUATION ONLY — **no source is approved.** Nothing here is built, scheduled, or scraped. No
external API call, no credential, no actor run.
**Stage:** 3.0. Companion to `STAGE_3_LEAD_SOURCE_EVALUATION.md` (scoring/recommendation) and
`LEAD_SOURCE_CONNECTORS_PLAN.md` (connector design).
**Date:** 2026-06-08

> Tools/actors/APIs named below are **candidates to evaluate later**, not selected, not approved, not tested.
> "Possible APIs/actors/tools" = things to assess in a future stage, behind explicit operator approval.

> **Stage 3.3 first-source decision (DEC-084, 2026-06-08):** with Stage 3.2 finalized, the **recommended first
> real connector is the Avito/Classifieds Listing Connector** — lowest complexity, closest to the existing web/URL
> data model, strong for competitors/offers/semantics (caveat: not for comments/audience mining). **Telegram public
> parsing (≠ Control Bot) is second/separate feasibility; Instagram comment/audience mining is deferred; Dzen/VK
> public feasibility follow Avito.** Still **EVALUATION ONLY — no connector built.** Full reasoning:
> `docs/STAGE_3_3_SOURCE_DECISION_PLAN.md`.

> **REFRAME (2026-06-08, DEC-078):** sources are evaluated for **touchpoints** (hot leads, warm touchpoints,
> competitor audiences, comments, semantic/ad signals), not hot leads alone — the first domain of the
> **Business Scout Agent**. Added: **Yandex Dzen** and **Competitor audience / public commenters** (public data
> only). Avito/Classifieds = strongest for direct high-intent + competitor ads; Dzen/VK/comments = stronger for
> pains/questions/audience mining/warm touchpoints; Instagram = competitor content/comments not hot leads;
> competitor audiences handled carefully (public only); Yandex/Search/forums = discovery/semantic, not primary
> hot-lead.

---

## 1. Avito / Classifieds
- **Target use case:** direct, high-intent leads ("займ под ПТС / деньги под авто Москва"); secondary competitor listings.
- **Data expected:** classified listings + seller profiles, region/category filterable.
- **Likely fields:** `post_url` (listing), `profile_url`/`profile_name`/`author_handle`, `published_at`,
  `region_hint`, `text_context` (title+body), `contact_public` (phone/profile when public).
- **Connector approach:** evaluate, in order — (a) existing Apify Avito/search actor; (b) public search-result
  fetch (read-only, low volume); (c) browser automation only if (a)/(b) fail. Prefer the lowest-risk path.
- **Possible APIs/actors/tools to evaluate later:** Apify Avito actor / Avito search-results actor.
- **Credentials likely needed:** Apify token (actor route) — **in n8n only**, never in files. No Avito login.
- **Risks:** anti-bot/rate limits, ToS/compliance, gated phones, relisted duplicates, actor maintenance.
- **First MVP test:** one query, ≤10 listings → `raw_market_records` (no Claude) → operator reviews intent +
  contact → approve ≤3 → analyzer → confirm routing; record actor + Claude cost.
- **Go/No-Go:** **GO** if a compliant path exists, intent density is meaningful (≥~30% real leads), per-lead
  cost is acceptable. **NO-GO** if it needs login/ToS violation or yields mostly duplicates/spam.

## 2. Telegram public channels/chats *(parser — NOT the control bot)*
- **Target use case:** intent/pain records from public залоговый-займ channels/chats.
- **Data expected:** public channel/group messages on an explicit operator allowlist.
- **Likely fields:** `post_url` (`t.me/<chan>/<msg_id>` when public), `profile_name`/`author_handle`,
  `published_at`, `text_context`, `contact_public` (if shared).
- **Connector approach:** client/MTProto-style reader over an explicit **public** allowlist; **no broad
  crawling**; no private chats without membership/permission. The **Bot API** is reserved for the Stage 4
  Control Bot, **not** harvesting.
- **Possible APIs/actors/tools to evaluate later:** Telegram Client API (TDLib / MTProto / Telethon-style).
- **Credentials likely needed:** Telegram API id/hash + a session (client route) — **in n8n / secured store
  only**. The control-bot token is a **separate** credential for a separate purpose.
- **Risks:** privacy (personal messages), account/session bans, ToS/compliance, very noisy data; **highest
  compliance care** of all sources.
- **First MVP test:** 1–2 operator-provided **public** channels, last N messages → `raw_market_records` →
  review → approve a few → analyzer. No scheduling.
- **Go/No-Go:** **GO** only if a compliant, stable read path over an explicit public allowlist is demonstrated
  and privacy posture is acceptable. **NO-GO** if it needs private-chat access, risks bans, or raises
  unresolved privacy/ToS issues.

## 3. VK
- **Target use case:** pain/content + weak leads ("боли/вопросы по займам под ПТС").
- **Data expected:** public posts, community content, comments; community/keyword search.
- **Likely fields:** `post_url`, `profile_url`/`profile_name`, `published_at`, `text_context`, `contact_public`
  (rare).
- **Connector approach:** evaluate VK **official API** (community/public search) first; Apify VK actor fallback.
  Read-only, bounded queries.
- **Possible APIs/actors/tools to evaluate later:** VK API (app token), Apify VK actor.
- **Credentials likely needed:** VK API token/app credentials **in n8n only**; or Apify token.
- **Risks:** API scopes/permissions, rate limits, content-access constraints, noise.
- **First MVP test:** one community/topic query, ≤10 records → `raw_market_records` → review → approve → analyzer.
- **Go/No-Go:** **GO** if public API access covers target queries at acceptable cost/risk. **NO-GO** if it needs
  broad scraping or returns mostly noise.

## 4. Instagram
- **Target use case:** competitor content & public comments; weak for direct leads.
- **Data expected:** public profile posts/captions/comments.
- **Likely fields:** `post_url`, `profile_url`/`profile_name`, `published_at`, `text_context` (caption/comment).
- **Connector approach:** **deferred**; later an Apify Instagram actor over **public** profiles, no login sessions.
- **Possible APIs/actors/tools to evaluate later:** Apify Instagram actor.
- **Credentials likely needed:** Apify token (actor route) in n8n only; avoid any login/session credential.
- **Risks:** official API restrictions, scraping risk, login/session bans, limited lead value.
- **First MVP test:** **deferred** — define when the stage is reached.
- **Go/No-Go:** default **NO-GO for leads**; revisit only as competitor/content intelligence if a compliant
  public-only path exists.

## 5. Yandex / Search / forums
- **Target use case:** discovery of forum/Q&A pages, competitor sites, content/pain topics — **not** hot leads.
- **Data expected:** search-result pages, forum threads, Q&A pages.
- **Likely fields:** emits **URL candidates** for the web pipeline + forum/Q&A pages that may become
  `content_idea`/`market_signal` after analysis (`source_type=scraped_web`, `platform=website`).
- **Connector approach:** a **discovery layer** (the search analogue of Workflow 05) feeding 05→06→04 and/or
  flagging pages for `content_queue`; **not** a hot-lead analyzer.
- **Possible APIs/actors/tools to evaluate later:** Apify search actor / a search API.
- **Credentials likely needed:** search actor/API credential in n8n only.
- **Risks:** search quotas, result noise; do **not** mix discovery with lead capture.
- **First MVP test:** one query → URL/page candidates → existing approval → analyzer (mirrors Workflow 05).
- **Go/No-Go:** **GO** as a discovery aid; **NO-GO** as a direct lead source.

## 5b. Yandex Dzen
- **Target use case:** pains/questions, warm touchpoints, and contacts via thematic pages **and their comments**.
- **Data expected:** Dzen articles + public comments on thematic pages.
- **Likely fields:** `post_url`, `profile_url`/`profile_name`, `published_at`, `text_context`, `comment_text`.
- **Connector approach:** evaluate Apify Dzen actor / public page fetch over an explicit topic/page allowlist; read-only.
- **Possible APIs/actors/tools to evaluate later:** Apify Dzen actor / generic page fetch.
- **Credentials likely needed:** Apify token (actor route) in n8n only.
- **Risks:** ToS, comment privacy (public only), noise.
- **First MVP test:** one thematic page + its public comments, ≤10 records → `raw_market_records` → review → analyzer.
- **Go/No-Go:** **GO** if public pages/comments are accessible and yield real pains/touchpoints; **NO-GO** if it
  needs login or is mostly noise.

## 5c. Competitor pages / public subscribers / public commenters
- **Target use case:** competitor audience mining — public commenters/subscribers/followers of competitor pages.
- **Data expected:** public profiles + comments tied to a competitor page.
- **Likely fields:** `profile_url`/`profile_name`/`author_handle`, `comment_text`, `competitor_related=true`,
  `competitor_name`, `record_type_hint` ∈ {`competitor_audience`,`cold_audience_candidate`,`warm_touchpoint`,`client_pain`}.
- **Connector approach:** per-platform, **public data only**, minimized retention; no private data.
- **Possible APIs/actors/tools to evaluate later:** per-platform actor/API (VK/Dzen/Instagram/Telegram public).
- **Credentials likely needed:** per-platform (n8n only).
- **Risks:** **highest privacy/compliance care** — public data only, no unauthorized outreach, minimize personal data.
- **First MVP test:** one competitor page, public commenters/subscribers only, ≤10 records → review → analyzer.
- **Go/No-Go:** **GO** only with a clear public-only, compliant path + minimized retention; **NO-GO** if it needs
  private data or risks privacy/ToS.

## 6. Manual intake
- **Target use case:** zero-risk validation of the lead schema + analyzer + routing before any connector.
- **Data expected:** 5–10 operator-pasted raw posts/listings/comments.
- **Likely fields:** all `raw_market_records` columns, filled by the operator; `source_type=manual`,
  `platform=manual`.
- **Connector approach:** a manual-entry/paste path that writes one `raw_market_records` row, computes a
  `dedup_key`, sets `approval_status=new`. **No external calls.**
- **Possible APIs/actors/tools to evaluate later:** none (manual).
- **Credentials likely needed:** none.
- **Risks:** none (zero source risk/cost).
- **First MVP test:** paste 1–3 records → approve → analyzer → confirm routing.
- **Go/No-Go:** **always GO** — recommended as the **first** thing wired in Stage 3.1.

---

> No source above is approved. This matrix supports the Stage 3.0 decision only; the first connector is built
> after Stage 3.0 approval and only for the specific approved source.
