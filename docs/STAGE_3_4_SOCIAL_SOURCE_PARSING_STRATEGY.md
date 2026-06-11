# STAGE_3_4_SOCIAL_SOURCE_PARSING_STRATEGY.md — Social Source Parsing Strategy

**Status:** 📐 STRATEGY ONLY — **no parser is built or approved by this document.** No external API call, no
credential, no actor run is authorized here.
**Stage:** 3.4 of the Business Scout Agent · **Date:** 2026-06-11
**Decisions:** DEC-096 (one-source-at-a-time connector pattern; do NOT build all social parsers at once).
**Related:** `docs/SOCIAL_CLASSIFIED_SOURCE_MATRIX.md` (Stage 3.0 evaluation), `docs/CONTACT_AND_OUTREACH_POLICY.md`,
`docs/WF10_COMPETITOR_AUDIENCE_INTELLIGENCE_AGGREGATOR_PLAN.md`, `docs/NICHE_PACK_SYSTEM_PLAN.md`,
`docs/COMPETITOR_AD_INTELLIGENCE_PLAN.md`.

---

## 1. Core decision (DEC-096)

**Do not build all social parsers at once.** Every new source follows the same proven connector pattern:

```
source connector (deterministic, no LLM, fixture-first, active=false)
  → raw_market_records (+ market_record_registry dedup, + agent_requests)
  → Workflow 08 Touchpoint Analyzer (manual handoff, deterministic_first)
  → WF10 aggregator / report (planned)
```

One source is added, stabilized on live data, and only then is the next source started. The Avito connector
(Workflow 09) is the template: fixture mode, strict validity guard, business relevance filter (DEC-095),
registry dedup, summary counts, no auto-handoff.

## 2. Source-by-source analysis

Legend: lead = lead-signal value, comp = competitor-intelligence value, contact = public-contact availability.

### 2.1 Telegram public channels/groups

| Aspect | Assessment |
|--------|------------|
| Access methods | (a) **official Bot API** — only for channels/groups where our bot is admin (useless for monitoring others); (b) **t.me/s/<channel> public preview parsing** (Firecrawl/HTTP) — public channels only, no login, lowest risk; (c) **Apify Telegram actors** — wrap preview or client sessions, check per-actor; (d) **MTProto client session (Telethon etc.)** — full access to public groups, **high-risk last resort** (account ban risk, ToS, session credential management); (e) **manual source list** of channel URLs from the operator. |
| Expected data | channel posts (competitor ads, offers, prices), public group questions/pains, post dates, view counts (preview), author handles in groups (client only) |
| Risks | preview shows only recent posts and no comments; MTProto = account/ToS risk; group scraping borders private-community data |
| Cost | preview parsing ≈ Firecrawl page cost (cents); Apify actors $ per run; MTProto "free" but high operational risk |
| Data quality | medium-high for channels (clean post text); medium for groups (noise) |
| Lead signal | **medium-high** — niche groups carry direct "посоветуйте брокера / кредит после отказов" questions |
| Competitor intel | **high** — competitor channels are pure ad copy: offers, prices, semantics |
| Contacts | handles sometimes public on posts/bio; policy: public + evidence only |
| **Priority** | **#2 — first feasibility after Avito stabilizes.** Start with public-channel preview parsing from a manual channel list. No MTProto without separate risk review. |

### 2.2 VK public groups/posts/comments

| Aspect | Assessment |
|--------|------------|
| Access methods | (a) **official VK API** (`wall.get`, `wall.getComments`, `groups.search`) — documented, token-based, rate-limited, **legitimate path**; (b) Apify/actors — exist, mostly wrap the API; (c) Firecrawl/web — VK renders poorly without login, weak; (d) manual source list of group URLs. |
| Expected data | group posts (competitor ads), comments (pains, objections, questions), author profiles (public), post dates, like/comment counts |
| Risks | API token requires a VK account/app; rate limits; comment authors are persons → contact policy applies strictly (aggregate_only default) |
| Cost | VK API free within limits; Apify $ per run |
| Data quality | high (structured API JSON) |
| Lead signal | **medium-high** — regional/niche groups carry real demand questions |
| Competitor intel | **high** — competitor communities + their ad posts + audience reactions |
| Contacts | profile links public; phones rare; policy: aggregate_only for commenters by default |
| **Priority** | **#3 — after Telegram feasibility.** Official API first; no scraping workarounds. |

### 2.3 Instagram public profiles/posts/comments

| Aspect | Assessment |
|--------|------------|
| Access methods | (a) official Graph API — only for own/business-connected accounts, useless for competitor monitoring; (b) Apify Instagram actors — exist but fight Meta anti-bot, fragile, ToS-aggressive; (c) web parsing — login-walled, weak; (d) browser/session scraping — **high-risk last resort, not proposed**; (e) manual source list + manual paste via Workflow 07. |
| Expected data | competitor posts/reels captions, ad wording, comments (pains), bio contacts |
| Risks | **highest of all sources** — Meta actively blocks, account bans, legal exposure; frequent actor breakage |
| Cost | Apify actors comparatively expensive; high re-run cost due to breakage |
| Data quality | medium (caption text + OCR-less images lose info) |
| Lead signal | low-medium (comments rarely carry direct intent in this niche) |
| Competitor intel | medium-high (visual ads, stories not capturable) |
| Contacts | bio contacts public when published; policy applies |
| **Priority** | **#6 — deferred until a separate risk review.** Until then: manual paste of notable competitor posts via WF07. |

### 2.4 Dzen posts/comments

| Aspect | Assessment |
|--------|------------|
| Access methods | (a) no useful official API; (b) Firecrawl/web parsing of public article pages — moderate; (c) Apify/actors — few, unproven; (d) manual source list of competitor channel URLs. |
| Expected data | competitor longread content, SEO semantics, comments with pains/objections |
| Risks | anti-bot on comment loading (dynamic); medium |
| Cost | Firecrawl per page (cents) |
| Data quality | medium (long text, needs trimming) |
| Lead signal | low-medium (comments; weak intent) |
| Competitor intel | **medium-high** — shows competitor content strategy and semantic fields |
| Contacts | rare; channel about-pages sometimes |
| **Priority** | **#5 — after review platforms.** |

### 2.5 Review platforms / maps (Yandex Maps, 2GIS, Otzovik, Banki.ru, Zoon)

| Aspect | Assessment |
|--------|------------|
| Access methods | (a) partner APIs mostly closed/paid; (b) **Apify/Firecrawl parsing of public org pages + reviews** — moderate, page-structured; (c) manual source list of competitor org URLs (strong start). |
| Expected data | competitor org cards (services, prices sometimes, contacts), reviews = **pains, objections, complaints, what clients value**; ratings |
| Risks | medium (scraping ToS); review text is personal opinion — store aggregate insights, not reviewer identities |
| Cost | Firecrawl per page; predictable |
| Data quality | high for org cards, high-value text in reviews |
| Lead signal | low (reviews are post-purchase) |
| Competitor intel | **high** — weaknesses/strengths straight from competitor clients; objection bank for content |
| Contacts | org contacts fully public (cards) — ideal for competitor_profiles identification |
| **Priority** | **#4 — after VK.** Manual org-URL list + existing Firecrawl pipeline makes this cheap. |

### 2.6 Competitor websites / search (existing capability)

| Aspect | Assessment |
|--------|------------|
| Access methods | **already built**: WF05 (Apify search discovery) + WF06 (approved runner) + WF04 (Firecrawl page analysis) |
| Expected data | offers, rates, terms, positioning, public org contacts |
| Risks | low (public marketing pages) |
| Cost | known (Firecrawl + Claude per page, measured in COSTS_AND_LIMITS) |
| Lead signal | none (it's competitor content) |
| Competitor intel | **high** — canonical source for competitor_profiles |
| Contacts | public org contacts |
| **Priority** | continuous — feeds WF10 alongside connectors; no new build needed. |

## 2b. Compact decision table

| Source | Access method (chosen path) | Lead value | Competitor value | Public contacts | Risk | Cost | Reliability | Priority | First safe test |
|--------|------------------------------|-----------|------------------|-----------------|------|------|-------------|----------|-----------------|
| Avito/Classifieds | Apify actor (✅ built, WF09 — the template) | med/low | **high** | rare (listings hide phones — never bypass) | med | actor per run (measured) | proven live (Stage 3.3 closed) | **#1 — done/stabilized** | routine live run, watch canonical URLs |
| Telegram **public channels** (preview) | `t.me/s/<channel>` preview via Firecrawl/HTTP — **distinct from groups/client-session** | med | **high** (competitor ad copy) | sometimes (bio/post) | **low** (public preview, no login) | ~Firecrawl page cost | recent posts only, no comments | **#2 — next** | fixture connector + preview parse of 1–2 operator-listed channels |
| Telegram groups (MTProto client) | client session — **high-risk last resort, NOT planned** | med-high | med | rare | **high** (account ban/ToS) | low $ / high risk | fragile | deferred (separate risk review) | none until risk review |
| VK public groups/posts | **official VK API** (`wall.get`/`wall.getComments`) — distinct from scraping/actors | med-high | **high** | profile links (aggregate_only default) | low-med (token/limits) | free within limits | high (structured API) | **#3** | API token + read 1 public group, fixture-first |
| Reviews/maps (Yandex/2GIS/Otzovik/Banki/Zoon) | manual org-URL list + Firecrawl (existing pipeline) | low | **high — emphasized**: client-voiced strengths/weaknesses + objection bank; org cards = public contacts | **good** (org cards) | med (ToS) | Firecrawl per page | high (stable pages) | **#4** | 3–5 competitor org URLs through the WF04-style parse |
| Dzen | Firecrawl of public articles | low-med | med-high (**content/SEO semantics, not a lead source**) | rare | med (dynamic comments) | Firecrawl per page | medium | **#5** | parse 2–3 competitor articles, no comments |
| Instagram | **deferred pending separate risk review**; meanwhile manual paste via WF07 | low-med | med-high | bio only | **highest** (Meta anti-bot/ToS) | high (fragile actors) | low | **#6 — deferred** | none; manual WF07 paste only |

All sources follow the same pattern: **source connector → `raw_market_records` → Workflow 08 → WF10/report.**
No all-social-parsers-at-once build (DEC-096).

**Why Telegram public-channel preview is #2:** highest competitor-ad-copy value per unit of risk — public pages,
no login/session, no member data, reuses the existing Firecrawl transport, and the niche's competitors actively
run Telegram channels. VK is #3 (higher setup cost: account/app/token) and reviews/maps #4 (high value but purely
competitor-side, no lead signals; benefits from WF10 being live first to absorb the strengths/weaknesses data).

## 3. Recommended order (DEC-096)

1. **Stabilize the Avito live source** ✅ done — Stage 3.3 CLOSED (DEC-102); keep routine runs + canonical-URL watch item.
2. **Telegram public source feasibility** (preview parsing of a manual channel list; no MTProto).
3. **VK public groups/posts** (official API).
4. **Review platforms / maps** (manual org list + Firecrawl).
5. **Dzen** (competitor content + comments).
6. **Instagram — only after a separate risk review.**

Each step gets its own connector workflow, fixture set, niche-pack-driven relevance rules
(`docs/NICHE_PACK_SYSTEM_PLAN.md`), and live smoke with explicit operator approval before any external call.

## 4. Non-goals of Stage 3.4

- No parser implementation, no workflow creation, no actor selection in this document.
- No browser/session scraping of any platform without an explicit, separate risk review and operator approval.
- No private-data collection of any kind — `docs/CONTACT_AND_OUTREACH_POLICY.md` is binding for every source above.
