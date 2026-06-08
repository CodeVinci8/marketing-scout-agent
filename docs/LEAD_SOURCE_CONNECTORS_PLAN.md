# LEAD_SOURCE_CONNECTORS_PLAN.md — Source-by-Source Connector Plan (DESIGN ONLY)

**Status:** 📐 DESIGN ONLY — no connector is built. Companion to `docs/LEAD_DISCOVERY_ARCHITECTURE.md`.
**Date:** 2026-06-07 (Stage-3-entry note added 2026-06-08)

> **Build gate:** This plan is for evaluation and design. Do **not** build any connector, parser, or bot from
> it. The first connector is chosen **after** Stage 3.0 (Lead Source Evaluation) is written and approved.

> **Stage 3 entry (DEC-076):** with Stage 2 approved, the **first Stage 3 step is Stage 3.0 — Lead Source
> Evaluation** (compare Avito vs Telegram vs VK on data availability, cost, risk, lead quality, implementation
> complexity), **not** the Telegram bot. Preliminary recommendation: **Avito/Classifieds first**, **Telegram
> second** (parser ≠ control bot; separate access/client design), VK/Instagram/Yandex later. Build nothing
> until Stage 3.0 is approved.

> **REFRAME (2026-06-08, DEC-078):** these connectors feed **Social/Classified Touchpoint Discovery** (the first
> domain of the **Business Scout Agent**), not lead parsing alone. They produce **touchpoints** (12 record
> classes), including comments, competitor audiences, and semantic/ad signals — not only hot leads. Added below:
> **Yandex Dzen** and **Competitor Audience Mining** (public data only). Requests are tracked in `agent_requests`
> (generalizing `lead_discovery_requests`); see `AGENT_TOOL_ARCHITECTURE.md`.

All connectors share one output contract: normalize to `raw_market_records` (see `TABLE_SCHEMA.md` →
"Proposed — Business Scout Agent Layer"), compute a composite `dedup_key`, check `market_record_registry`, and
set `approval_status=new`. Connectors **never** call Claude; the source-agnostic analyzer does that **after**
human approval.

Each section below uses the same template: **Goal · Data model · Connector approach · Credentials ·
Risk · Cost · Test plan · Go/No-Go**.

---

## 1. Avito / Classifieds Connector

**Goal.** Find lead-like public classified listings/searches expressing borrowing intent ("займ под ПТС",
"деньги срочно под авто Москва") and competitor listings. Highest expected intent density of the candidate
sources.

**Likely data model.** `source_type=classified`, `platform=avito`. Fields: `post_url` (listing URL),
`profile_url`/`profile_name`/`author_handle` (seller), `published_at`, `region_hint` (Москва/МО),
`service_hint`, `text_context` (title + body), `contact_public` (phone/profile when public),
`record_type_hint` ∈ {`lead_signal`,`competitor_post`}, `lead_intent_hint`, `urgency_hint`,
`dedup_key = avito + listing_id` (fallback `avito + profile + hash(text)`).

**Connector approach.** Evaluate, in order: (a) an existing **Apify Avito actor** or Avito search-results
actor; (b) public Avito **search-result pages** via Firecrawl-style fetch (read-only, low volume); (c) browser
automation only if (a)/(b) fail evaluation. Prefer the lowest-risk option that returns structured listings.

**Credentials needed.** Apify token (if actor route) **entered only in n8n**, never in files; otherwise none
beyond existing fetch credentials. No Avito login/account is used.

**Risk.** Anti-bot / rate limits; legal & ToS/compliance for classifieds scraping; contact availability
(phones often gated); duplicate/relisted ads; actor reliability/maintenance.

**Cost.** Apify actor run cost (per N listings) **tracked separately** from Claude analysis cost; plus ~the
standard per-record Claude cost only **after** approval.

**Test plan.** Manual, bounded: one query, ≤10 candidate listings → `raw_market_records` (no Claude) → operator
reviews intent/contact quality → approve ≤3 → run analyzer → confirm routing (`results`/`review_queue` for
leads, `monitor_queue` for competitor listings). Record actor cost + Claude delta.

**Go/No-Go.** GO if: a compliant access path exists, intent density is meaningful (≥~30% of sampled listings
are real leads), and per-lead cost is acceptable. NO-GO if access requires login/ToS violation or yields mostly
duplicates/spam.

---

## 2. Telegram Connector  *(parser — NOT the control bot)*

**Goal.** Collect intent/pain records from **public** залоговый-займ channels/chats ("найди лидов по
Telegram-чатам по залоговым займам"). Bootstrap from **manually supplied** public channels only.

**Do not confuse two Telegram surfaces:**
- **Telegram Bot API** — good for the **control bot** (commands, summaries) and for messages in chats where
  the bot is a member. **Not** a historical/public-chat harvester.
- **Telegram Client API / MTProto / TDLib / Telethon-like** — required for historical/public channel/chat
  **collection**. This is the **lead connector**, designed separately.

**Likely data model.** `source_type=social`, `platform=telegram`. Fields: `post_url` (t.me/<chan>/<msg_id> when
public), `profile_name`/`author_handle`, `published_at`, `text_context` (message text), `contact_public`
(if shared), `record_type_hint` ∈ {`lead_signal`,`content_idea`,`market_signal`,`competitor_post`},
`dedup_key = telegram + channel + message_id` (fallback `telegram + author + hash(text)`).

**Connector approach.** Design-only. A client/MTProto-style reader over an **explicit allowlist** of public
channels/chats. **No broad crawling.** No access to private chats without membership/permission.

**Credentials needed.** Telegram API id/hash + a session (client route) — **entered only in n8n / secured
store**, never in files. The control-bot token is a **separate** credential for a **separate** purpose.

**Risk.** Account/session management & bans; ToS/compliance; **private chats impossible** without
membership/permission; very noisy data; **privacy concerns** (personal messages). Highest compliance care of
all sources.

**Cost.** Mostly infrastructure/session cost + maintenance; Claude analysis cost separate and post-approval.

**Test plan.** Manual: 1–2 operator-provided **public** channels, last N messages → `raw_market_records` (no
Claude) → operator reviews → approve a few → analyzer → routing. No scheduling.

**Go/No-Go.** GO only if a compliant, stable read path over an explicit public allowlist is demonstrated and
privacy posture is acceptable. NO-GO if it needs private-chat access, risks account bans, or raises unresolved
privacy/ToS issues.

---

## 3. VK / Social Connector

**Goal.** Surface public posts/comments and community-search results for **pain/content** and some leads
("найди вопросы/боли по ВК на тему займов под ПТС").

**Likely data model.** `source_type=social`, `platform=vk`. Fields: `post_url`, `profile_url`/`profile_name`,
`published_at`, `text_context`, `contact_public` (rare), `record_type_hint` ∈
{`content_idea`,`market_signal`,`lead_signal`,`competitor_post`},
`dedup_key = vk + (post_id|comment_id)` (fallback `vk + profile + hash(text)`).

**Connector approach.** Evaluate VK **official API** (community/public search) first; an Apify VK actor as
fallback. Read-only, bounded queries.

**Credentials needed.** VK API token/app credentials (if API route) **in n8n only**; or Apify token. No
personal-account scraping.

**Risk.** API permissions/scopes; rate limits; access constraints to some content; noisy results; ToS.

**Cost.** API quota or actor cost, tracked separately; Claude cost post-approval.

**Test plan.** Manual: one community/topic query, ≤10 records → `raw_market_records` → review → approve → analyzer.

**Go/No-Go.** GO if public API access is sufficient for the target queries at acceptable cost/risk; NO-GO if it
needs broad scraping or returns mostly noise.

---

## 4. Instagram Connector

**Goal.** Mainly **competitor content & public comments** intelligence; weak for direct lead capture.

**Likely data model.** `source_type=social`, `platform=instagram`. Fields: `post_url`, `profile_url`/
`profile_name`, `published_at`, `text_context` (caption/comment), `record_type_hint` ∈
{`competitor_post`,`content_idea`,`market_signal`}, `dedup_key = instagram + (post_id|comment_id)`.

**Connector approach.** **Deferred.** Evaluate only after Avito/Telegram/VK. Likely an Apify Instagram actor
over **public** profiles/posts; no login sessions.

**Credentials needed.** Apify token (if actor route) in n8n only. Avoid any login/session credential.

**Risk.** Official API restrictions; scraping risk; **login/session risk** (account bans); limited lead value.

**Cost.** Actor cost separate; Claude post-approval.

**Test plan.** Deferred — define when the stage is reached.

**Go/No-Go.** Default **NO-GO for leads**; revisit only as a competitor/content intelligence source if a
compliant public-only path exists.

---

## 5. Yandex / Search Connector

**Goal.** **Discovery**, not lead analysis: find lead pages, forums, competitor sites, and content-idea topics
("найди конкурентов по ПТС в Москве"). This is the search-discovery analogue of Workflow 05.

**Likely data model.** Emits **URL candidates** (closer to `url_candidates`) for the web pipeline, plus forum/
Q&A pages that may become `content_idea`/`market_signal` after analysis. `source_type=scraped_web` /
`platform=website` for the pages it finds.

**Connector approach.** Treat as a **discovery layer** feeding the existing web pipeline (05→06→04) and/or
flagging forum/Q&A pages for content. Use an Apify/search actor or search API; **not** a hot-lead analyzer.

**Credentials needed.** Search actor/API credential in n8n only.

**Risk.** Search quotas; result noise; mixing discovery with lead capture (avoid — keep roles separate).

**Cost.** Search/actor cost separate; Claude post-approval.

**Test plan.** Manual query → URL/page candidates → existing approval → analyzer. Mirrors Workflow 05.

**Go/No-Go.** GO as a discovery aid; **NO-GO** to use it as a direct lead source.

---

## 5b. Yandex Dzen Connector  *(added in reframe — pains/comments/touchpoints)*

**Goal.** Find **touchpoints, contacts, pains, and questions** on thematic Dzen pages and **their comments**
("go to thematic pages and comments"). Better for warm touchpoints/audience than hot leads.

**Likely data model.** `source_type=social`, `platform=dzen`. Fields: `post_url`, `profile_url`/`profile_name`,
`published_at`, `text_context` (article), `comment_text`, `record_type_hint` ∈
{`warm_touchpoint`,`question_objection`,`client_pain`,`content_idea`,`competitor_activity`,`market_signal`},
`dedup_key = dzen + (post_url|comment_id)` fallback `dzen + author + text_hash`.

**Connector approach.** Evaluate an Apify Dzen actor / public page fetch over an explicit topic/page allowlist.
Read-only, bounded.

**Credentials / Risk / Cost.** Apify token (if actor) in n8n only / ToS + comment privacy, public data only /
actor cost separate, Claude post-approval.

**Test plan.** One thematic page + its public comments, ≤10 records → `raw_market_records` → review → analyzer.
**Go/No-Go.** GO if public pages/comments are accessible and yield real pains/touchpoints; NO-GO if it needs
login or yields mostly noise.

## 5c. Competitor Audience Mining Connector  *(added in reframe — PUBLIC DATA ONLY, careful)*

**Goal.** Mine **public** commenters/subscribers/followers of competitor pages ("collect brokers in Moscow,
analyze their pages, subscribers, comments; find people interested in services") → `competitor_audience` /
`cold_audience_candidate` / `warm_touchpoint` records.

**Likely data model.** `source_type=social`, varied `platform`. Fields: `profile_url`/`profile_name`/
`author_handle`, `comment_text` (if from a comment), `competitor_related=true`, `competitor_name`,
`record_type_hint` ∈ {`competitor_audience`,`cold_audience_candidate`,`warm_touchpoint`,`client_pain`}.

**Connector approach.** Only where **publicly accessible**; per-platform (VK/Dzen/Instagram/Telegram public).
Minimize stored personal data.

**Credentials / Risk / Cost.** Per-platform (n8n only) / **highest privacy/compliance care — public data only,
no unauthorized outreach, minimized retention** / per-platform cost separate, Claude post-approval.

**Test plan.** One competitor page, public commenters/subscribers only, ≤10 records → review → analyzer.
**Go/No-Go.** GO only with a clear public-only, compliant path and minimized retention; NO-GO if it needs
private data or risks privacy/ToS violations.

## 6. Manual Records Intake  *(zero-risk bootstrap)*

**Goal.** Let the operator paste records (a phone + text from a listing/chat) directly into
`raw_market_records` to exercise the analyzer + routing **before** any connector exists.

**Connector approach.** A manual-entry form / paste path that writes one `raw_market_records` row with
`source_type=manual`, computes a `dedup_key`, and sets `approval_status=new`. No external calls.

**Credentials / Risk / Cost.** None / none / Claude only after approval.

**Test plan.** Paste 1–3 records → approve → analyzer → confirm routing. This validates the lead schema +
analyzer integration with **zero** source risk.

**Go/No-Go.** Always GO — recommended as the **first** thing to wire when Stage 3.2 begins.

---

## 7. Sequencing & decision

**No connector is built yet.** Stage 3.0 chooses the first source; build follows only after approval.

| Stage | Scope | Build status |
|-------|-------|--------------|
| **3.0 Lead Source Evaluation** | compare Avito vs Telegram vs VK (+ others) on data availability, cost, risk, lead quality, implementation complexity; recommend first source | ✅ **written 2026-06-08** (`STAGE_3_LEAD_SOURCE_EVALUATION.md`), pending operator approval |
| **3.1 Lead Data Model + Manual Records Intake** | create the 3 proposed sheets; wire Manual Records Intake (zero source risk) | not built |
| **3.2 First Lead Connector** | likely Avito/Classifieds (pending feasibility/compliance) | not built |
| **3.3 Lead Analyzer Hardening** | harden lead scoring (`lead_signal_score`/`urgency_score`/`contactability_score`/`region_score`/`collateral_fit_score`) | not built |
| **3.4 Lead Pipeline E2E** | end-to-end request → connector → records → approval → analyzer → routing | not built |

**Source-specific notes:**
- **Avito/Classifieds** — likely first real connector; needs evaluation of the Apify actor / search / API
  route; good for high-intent listings.
- **Telegram** — split control bot vs parser; the **bot is not the parser**; the parser may require a Telegram
  client / TDLib / MTProto-style access or trusted public source lists.
- **VK** — evaluate API/actor and public posts/groups.
- **Instagram** — likely later; better for competitor/content than hot leads.
- **Yandex/Search** — good for discovery/content/market pain, weaker for direct leads.
- **Manual intake** — recommended zero-risk schema/analyzer test, wired first.

The Telegram **Control Bot** (Stage 4) is unrelated to the Telegram parser and is **not** built in Stage 3.
