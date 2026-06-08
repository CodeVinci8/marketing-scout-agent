# STAGE_3_LEAD_SOURCE_EVALUATION.md — Stage 3.0 Lead Source Evaluation (EVALUATION ONLY)

**Status:** 📐 EVALUATION ONLY — nothing here is built, approved, or scheduled. No connector, no parser, no
bot, no scraping, no external API call. This document chooses *which source to build first*, not how to build it.
**Stage:** 3.0 (Lead Source Evaluation) → 3.1 (Lead Data Model + Manual Records Intake) → 3.2 (first real
connector) → 3.3 (analyzer hardening) → 3.4 (E2E).
**Date:** 2026-06-08
**Companion docs:** `LEAD_DISCOVERY_ARCHITECTURE.md`, `LEAD_SOURCE_CONNECTORS_PLAN.md`,
`LEAD_DATA_MODEL_PLAN.md`, `SOCIAL_CLASSIFIED_SOURCE_MATRIX.md`, `TABLE_SCHEMA.md`.

> **No-build gate:** No source connector, Telegram parser, or Telegram Control Bot is implemented from this
> document. The first connector is built only **after** this evaluation is reviewed and approved, and only for
> the specific source approved. This is a decision document, not an implementation order.

> **REFRAME (2026-06-08, DEC-078 — stakeholder interview):** Stage 3 is reframed from "Lead Source Evaluation"
> to **Social/Classified Touchpoint Discovery**. **Lead discovery is a subset.** The goal is not only hot leads
> but **points of contact with the client** at every temperature, plus competitor-audience, comment, and
> semantic/ad signals. This is the first capability domain of the broader **Business Scout Agent** (see
> `docs/BUSINESS_SCOUT_AGENT_VISION.md`). The source evaluation below is now read through the
> **touchpoint/agent lens** (§5a).

---

## 0. Touchpoint reframe — record classes & examples

Touchpoints include: **hot leads · warm touchpoints · cold audience candidates · commenters · subscribers/
followers (public) · competitor audience · questions/objections · client pain · competitor activity · content
ideas · market signals.**

**Record classes:** `hot_lead`, `warm_touchpoint`, `cold_audience_candidate`, `client_pain`,
`question_objection`, `competitor_audience`, `competitor_activity`, `semantic_signal`, `ad_channel_signal`,
`content_idea`, `market_signal`, `irrelevant`.

| Example | Class |
|---------|-------|
| "Срочно нужен займ под ПТС, банк отказал" | `hot_lead` |
| "Кто пользовался такими брокерами?" | `question_objection` / `warm_touchpoint` |
| Comment under broker post: "напишите условия" | `warm_touchpoint` |
| Public follower of a broker, no explicit interest text | `cold_audience_candidate` |
| Negative comment about a competitor's speed/price | `client_pain` |
| Active competitor page with many comments | `competitor_activity` |
| Repeated keyword in competitor ads/listings | `semantic_signal` |
| Competitor appears heavily on Avito/Yandex/Dzen | `ad_channel_signal` |

These classes are carried by `raw_market_records.record_type_hint` / `touchpoint_type` (see `TABLE_SCHEMA.md`).

---

## 1. Purpose

Stage 2 proved the **web competitor** pipeline (Workflow 05 → 06 → 04). Stage 3 turns the same proven shape —
**discover → normalize → dedup → human approval → analyze → route** — toward the operator's actual primary
goal: **finding leads**. Stage 3.0 exists to **evaluate candidate sources** for lead discovery and recommend a
**safe first implementation path**, before any code or spend.

The future operator commands this layer must eventually serve:
- "собери лидов по соцсетям на тему займ под ПТС Москва"
- "собери лидов по VK на тему срочно нужны деньги под авто"
- "найди лидов в Telegram-чатах по залоговым займам"
- "найди объявления/посты, где человек ищет деньги под ПТС"
- "найди боли и вопросы клиентов по займам под ПТС"
- "найди лидов по Avito/Classifieds по Москве"

Each command resolves to a `lead_discovery_request` (region, service_focus, platforms, query) → a **source
connector** → `raw_market_records` → human approval → the **source-agnostic analyzer** → routed output.

---

## 2. Why Stage 3 is about leads, not competitor websites

- **Stage 2 finds businesses; Stage 3 finds people.** The web pipeline answers "who are the competing
  lenders?" Stage 3 answers "who needs money now, with PTS/auto/real-estate collateral, in Moscow/MO?"
- **The unit of value changes.** Stage 2's unit is a *competitor website URL*. Stage 3's unit is a
  *person-with-intent record*: a classified listing, a chat message, a post, a comment, a profile — often with
  no clean website at all.
- **Competitor monitoring continues as a by-product.** The same record stream still surfaces competitor posts
  and content ideas, but the *priority output* is now a contactable lead.

## 3. Why social/classified records are different from URL candidates

`url_candidates` is a **web-URL abstraction**: one row = one canonical website URL, deduped by full normalized
URL in `url_registry`. Lead records break every one of those assumptions:

- A record is a **post / listing / comment / message / profile / forum thread / pasted snippet**, not a site.
- Identity is **platform + post/message id** (or **profile + text**), not a clean URL. Many records have **no
  stable URL at all** (a forwarded message, a manually pasted lead).
- The same intent ("срочно нужны деньги под ПТС, Москва") can appear **in many places at once** — URL equality
  would treat one lead as several.
- Records carry **author/contact/region/urgency** signal that a URL row does not model.

Therefore lead records get **their own schema** (`raw_market_records`) and **their own non-URL dedup ledger**
(`market_record_registry`). `url_candidates`/`url_registry` are **not reused** and **not modified**
(see `LEAD_DATA_MODEL_PLAN.md`).

---

## 4. Evaluation criteria

Each source is judged on:

| Criterion | Question |
|-----------|----------|
| Expected lead intent | How dense are real "I need money" signals vs noise? |
| Contactability | Can we reach the person (phone / profile / messenger / handle)? |
| Regional targeting | Can we constrain to Moscow / Moscow Oblast? |
| Technical accessibility | Is there a usable actor/API/read path without ToS violation? |
| Cost | Source-collection cost per N records (separate from Claude cost). |
| Risk / blocking | Anti-bot, bans, privacy, ToS/compliance exposure. |
| Implementation complexity | Connector build + maintenance effort. |
| Dedup complexity | How hard is reliable identity/dedup for this source? |
| Fit for secured lending | PTS / auto / real-estate intent presence. |
| Fit for future Telegram bot | Does it map cleanly to an operator command later? |
| Expected MVP value | What does a small bounded test actually prove? |

---

## 5. Source-by-source evaluation

### A. Avito / Classifieds
- **High-intent public listings?** Yes — classifieds carry the densest "ищу деньги / займ под ПТS/авто"
  intent of the candidate sources.
- **Contact/profile links?** Often — listing pages expose a seller profile and frequently a phone (sometimes
  gated behind a click/anti-bot step).
- **Query by region/category/keywords?** Yes — region (Москва/МО), category, and keyword filters are native.
- **Apify actor / API usable?** Likely — to be confirmed by evaluating an existing Avito actor or search-result
  fetch; **no scraping in this stage**.
- **Anti-bot / rate-limit risks?** Real — anti-bot, rate limits, ToS/compliance, gated phones, relisted duplicates.
- **Better for?** **Direct leads** primarily; also competitor monitoring (competing lender listings).
- **MVP test (later):** one query, ≤10 listings → `raw_market_records` (no Claude) → operator reviews intent +
  contact quality → approve ≤3 → analyzer → confirm routing. Record actor cost + Claude delta.

### B. Telegram Public Channels / Chats *(parser, NOT the control bot)*
- **Bot vs client/parser?** The **Bot API** only reads chats where the bot is already a member — it is a poor
  historical/public harvester and is reserved for the **Stage 4 Control Bot**. Collecting public channel/chat
  history needs a **client / MTProto / TDLib-style** reader — a **separate connector** with its own
  session/compliance design.
- **Public channels vs public groups vs private groups:** public channels/groups are readable with a client;
  **private groups are impossible without membership/permission** and are out of scope.
- **Membership/permission:** required for anything non-public; we restrict to an **explicit operator allowlist**
  of public channels/chats.
- **Historical collection difficulty:** moderate-to-hard; pagination + session management.
- **Keyword monitoring:** filter messages on the allowlist by query terms; no broad crawling.
- **Risks:** privacy (personal messages), account/session bans, ToS/compliance, very noisy data.
- **Control bot first or parser first?** **Neither in Stage 3.0.** The Control Bot is Stage 4. The parser is a
  Stage 3.x connector that comes **after** Avito because it needs separate access design.
- **MVP test (later):** 1–2 operator-provided **public** channels, last N messages → `raw_market_records` →
  review → approve a few → analyzer. No scheduling.

### C. VK / Social
- **Public posts/groups/comments?** Yes — public communities, posts, and comments are available.
- **API or actor route?** Evaluate the **VK official API** (community/public search) first; Apify VK actor as
  fallback.
- **Search by query/communities?** Yes — community and keyword search.
- **Risk / rate limits?** API scopes/permissions, rate limits, content-access constraints, noise.
- **Lead quality vs content insight:** stronger for **pain/content/market signal** than for hot, contactable
  leads; contact is rarely public.
- **MVP test (later):** one community/topic query, ≤10 records → `raw_market_records` → review → approve → analyzer.

### D. Instagram
- **Public profile/post/comment scraping?** Technically possible (Apify actor over public profiles), but low
  direct lead intent.
- **Competitor content vs hot leads?** Better for **competitor content / comment** intelligence than for hot
  leads.
- **Risks:** login/session restrictions and bans, official API limits, weak lead intent.
- **MVP test or defer?** **Defer** — revisit only if competitor-content monitoring becomes a priority.

### E. Yandex / Search / Forums
- **Search-based discovery?** Yes — search queries surface forum threads, Q&A, and pages.
- **Strength:** content ideas and **market pain** discovery; weak for direct, contactable hot leads.
- **Source specificity:** search finds *pages*, not source-native records; it is a **discovery aid**, the
  search analogue of Workflow 05, not a hot-lead source.
- **MVP role:** feed the web pipeline and/or flag forum/Q&A pages for `content_queue`; **not** a hot-lead source.

### F. Manual Records Intake
- **Zero-risk schema/analyzer test?** Yes — the operator pastes 5–10 raw posts/listings/comments directly into
  `raw_market_records`.
- **Useful before a real parser?** Strongly — it validates the lead schema, dedup keying, and analyzer routing
  with **zero source cost and zero source risk**.
- **Recommended before first connector?** **Yes — recommended as the first thing wired in Stage 3.1.**

---

## 5a. Source evaluation through the touchpoint/agent lens

Re-scored across the **broader** dimensions the stakeholder cares about (H/M/L = high/medium/low). Now includes
**Yandex Dzen** and **competitor pages/public subscribers/commenters** as distinct sources.

| Source | hot lead | warm touchpoint | competitor audience mining | comment mining | semantic/ad signal | contactability | public data avail. | tech difficulty | risk/compliance | cost | likely MVP role |
|--------|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|---|
| **Avito / Classifieds** | H | M | M | M | H | M-H | H | M | M | M | direct high-intent listings + competitor ads |
| **Yandex Dzen** | L | M | M | **H** | M | M | H | M | M | M | pains/questions + contacts/touchpoints via thematic pages & comments |
| **VK / public groups / comments** | L-M | **H** | **H** | **H** | M | M | H | M | M | M | audience mining + warm touchpoints + pains |
| **Telegram public channels/chats** *(parser ≠ control bot)* | M-H | M | M | M | M | M | M | H | **H** | M | intent/pain in public залог-чаты; separate access design |
| **Instagram competitor pages/comments** | L | L | M | M | M | L | M | H | M | M | competitor content/comment analysis (not hot leads) |
| **Competitor pages / public subscribers / commenters** | L | M | **H** | **H** | M | L-M | M | M | **H** | M | mine competitor audience — **public data only, careful** |
| **Yandex / Search / forums** | L | L | L | M | **H** | L | H | M | L | M | discovery/content/semantic source — not primary hot-lead |
| **Manual records intake** | n/a | n/a | n/a | n/a | n/a | — | H | **L** | **L** | **0** | zero-risk validation of schema/analyzer/classes |

**Key reads (touchpoint lens):**
- **Avito/Classifieds** — strongest for **direct high-intent listings** *and* **competitor ads/semantics**.
- **Yandex Dzen / VK / comments** — better for **pains, questions, audience mining, and warm touchpoints** than
  for hot leads; comments are the high-value vein here.
- **Telegram parser** is **separate** from the Telegram **Control Bot**.
- **Instagram** — better for **competitor content/comment analysis** than hot-lead discovery.
- **Competitor audiences/subscribers/commenters** — handle **carefully, public data only**, minimized, no
  unauthorized outreach.
- **Yandex/Search/forums** — **discovery/content/semantic** source, not a primary hot-lead source.

## 6. Weighted scoring table (hot-lead-focused — retained as one lens)

> The single-number scoring below ranks **hot-lead + feasibility** specifically. Under the broader touchpoint
> lens (§5a) Dzen/VK/comments rank higher for audience/pain mining than their hot-lead total suggests; read both.


Scale 1–5. **`risk_score`: 5 = low risk.** **`implementation_score`: 5 = easy.** `total_score` is the sum of the
six dimensions (max 30). Totals rank **technical feasibility + safety**; the *strategic* order in §7 adjusts for
business value where it diverges.

| Source | lead_intent | contactability | access | cost | risk (5=low) | implementation (5=easy) | total | recommendation |
|--------|:----------:|:--------------:|:------:|:----:|:------------:|:-----------------------:|:-----:|----------------|
| **Manual Records Intake** | 3 | 4 | 5 | 5 | 5 | 5 | **27** | **Build first** — validate schema + analyzer at zero risk |
| **Avito / Classifieds** | 5 | 4 | 3 | 3 | 2 | 3 | **20** | **First real connector** — pending feasibility/compliance check |
| **Yandex / Search / Forums** | 2 | 2 | 4 | 3 | 4 | 3 | **18** | Discovery / content aid — **not** a hot-lead source |
| **VK / Social** | 3 | 2 | 3 | 3 | 3 | 3 | **17** | Later — pain/content + weak leads |
| **Telegram (parser)** | 4 | 3 | 2 | 3 | 2 | 2 | **16** | After Avito — needs separate client/access design |
| **Instagram** | 2 | 2 | 2 | 3 | 2 | 2 | **13** | Defer — competitor/content only |

**Reading the table.** Manual Intake wins on safety/feasibility (the right *bootstrap*, not the end goal).
Avito leads the *real* sources on intent + total. Telegram scores lower on access/risk/implementation than its
business value implies — hence it ranks **second among real connectors despite a lower total** (value vs
tractability gap). Instagram is last for leads.

---

## 7. Recommended first implementation path

1. **Stage 3.1 — Manual Records Intake first.** Wire the `raw_market_records` schema + dedup keying + the
   source-agnostic analyzer with operator-pasted records. Zero source cost, zero source risk. Proves the data
   model and routing before any external dependency.
2. **Stage 3.2 — Avito / Classifieds as the first real connector** *(pending the feasibility/compliance check
   in `SOCIAL_CLASSIFIED_SOURCE_MATRIX.md`)* — highest intent density and the most tractable real source.
3. **Telegram parser second among real connectors** — high value, but only after a **separate** client/access
   and compliance design; the parser is **not** the Control Bot.
4. **VK later** for pain/content + weak leads; **Yandex/Search** as a discovery/content aid feeding the web
   pipeline or `content_queue`; **Instagram deferred**.
5. **Telegram Control Bot is Stage 4** and is explicitly **out of scope** for all of Stage 3.

## 8. No-build gate (explicit)

- ❌ No Avito scraping, no Telegram parsing, no VK/Instagram/Yandex connectors.
- ❌ No Telegram Control Bot, no Telegram parser, no automated outreach, no scheduled scraping.
- ❌ No Apify/Firecrawl/Claude calls, no credentials, no workflow JSON, no Google Sheets creation.
- ✅ Allowed now: this evaluation, the data-model and matrix design docs, and the operator's decision on the
  first safe test (Manual Intake vs Avito evaluation).

**Next operator decision:** approve this evaluation and choose the first safe step —
**Option A: Manual Records Intake** (recommended) or **Option B: Avito/Classifieds source evaluation**. Build
nothing until that decision is recorded.
