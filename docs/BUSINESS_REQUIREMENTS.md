# BUSINESS_REQUIREMENTS.md — Uncle Consultation Output

**Date:** 2026-06-05
**Status:** Confirmed — based on direct conversation with operator's uncle (business owner)
**Feeds into:** `MARKETING_AGENT_PROMPT_V2_PLAN.md`, `docs/NEXT_ACTIONS.md`, `docs/TABLE_SCHEMA.md`

---

## 1. Business Goal

Help a secured lending business (Moscow / Moscow Oblast) to:
1. **Find potential clients** — surface people actively seeking secured loans before they go to a competitor
2. **Monitor competitors** — understand who is active, what they offer, and how threatening they are
3. **Extract content ideas** — identify client pain points and market topics worth writing about

Priority order: **lead signals first → competitors second → content ideas third.**

---

## 2. Priority Order (Business)

| Priority | Category | What it means |
|----------|----------|---------------|
| 1 | Lead signals | People actively seeking a secured loan — contact them |
| 2 | Competitors | Active players in the same market — monitor them |
| 3 | Content ideas | Topics from client complaints and questions — create content |

This priority order must be reflected in Prompt v2 reasoning and in the `recommended_action` output.

---

## 3. Source Priority (Business View)

The operator wants to monitor these sources, in this order of business interest:

| Priority | Source | Reason |
|----------|--------|--------|
| 1 | Telegram | Active loan-seeker groups; direct lead signals |
| 2 | Instagram | Competitor ads, content ideas, some lead signals |
| 3 | Avito | Classified ads — both competitors and clients looking for loans |
| 4 | Yandex / competitor websites | Competitor positioning, SEO intelligence |

---

## 4. Technical Source Execution Order

Despite the business priority above, **technical implementation must start with the most reliable sources** to validate the pipeline with low failure risk:

| Step | Source | Reason |
|------|--------|--------|
| 1 | Competitor websites / Yandex | Firecrawl-ready; predictable HTML; no auth required |
| 2 | Avito | Apify actor available; structured listings; reliable |
| 3 | Telegram | Requires group access; complex scraping; higher risk |
| 4 | Instagram | Highest scraping complexity; rate limits; access restrictions |

**Decision:** Technical sequence ≠ business priority sequence. Build confidence in the pipeline first on easy sources, then add harder ones. See `docs/DECISIONS.md`.

---

## 5. Region

- **Primary:** Moscow (Москва)
- **Secondary:** Moscow Oblast (Московская область)
- Records from other regions are low priority and should score lower on `lead_signal_score`.
- If region cannot be determined, leave `region` empty — do not assume.

---

## 6. Product Scope

Products the operator offers and wants to monitor:

| Product | Notes |
|---------|-------|
| PTS / car collateral loans | Core product — highest priority for lead signals |
| Secured auto lending | Overlap with PTS loans |
| Real estate collateral loans | Secondary product |
| Refinancing | Existing loan clients who need better terms |
| Mortgage | Adjacent product — relevant for content and referrals |
| Business loans | Niche — lower priority |

**Lead scoring priority:** PTS / car collateral > real estate > refinancing > other.

---

## 7. Definition of a Useful Row

A row is **useful** if it helps the operator do at least one of the following:

1. **Identify and contact a potential client** — person seeking a secured loan, Moscow / MO, urgency present
2. **Monitor a competitor** — active business offering the same products in the same region
3. **Extract a content or offer insight** — specific client pain point, fear, or frequently asked question
4. **Understand market demand** — pricing trends, product gaps, seasonal patterns in Moscow / MO

A row is **not useful** if it is:
- From a region other than Moscow / Moscow Oblast (unless nationally relevant competitor)
- About a product unrelated to secured lending
- Boilerplate marketing text with no specific claim or signal
- Old content with no current relevance (>60 days without fresh activity)

---

## 8. Recommended Actions After Finding a Record

| Situation | Action |
|-----------|--------|
| Strong lead signal (product fit + urgency + region) | **Contact / write to the person** |
| Weak lead signal (intent present, no urgency) | **Monitor** — revisit if they post again |
| Active competitor (same region + same product) | **Monitor** regularly |
| Significant competitor move (new rate, new region) | **Alert** — operator should know immediately |
| Content idea with clear angle | **Create content** |
| Ambiguous but potentially useful | **Investigate** — gather more context |
| Irrelevant or boilerplate | **Ignore** |

---

## 9. Table Fields Requested by Operator

The operator described the following desired output columns. Mapping to current schema:

| Requested Field | Current Column | Status |
|-----------------|---------------|--------|
| Name / title | `company_name` + `profile_name` | Covered |
| Source link | `source_url` | Covered |
| Offer (what they offer) | `offer_text` | Covered |
| Terms (rate, conditions) | `terms` | Covered |
| Public contacts if available | `contact_public` | Covered |
| Region | `region` | Covered |
| Competitor strength | `competitor_strength` | Covered |
| Client pain | `detected_need` | Partially covered — v2 will expand |
| Recommendation | `recommended_action` | Covered |
| Source / comment link | `profile_url` | Partially covered — comment links not always captured |
| Scores | `quality_score`, `lead_signal_score`, `content_idea_score`, `competitor_strength` | Covered |
| Verification fields | Not yet in schema | Planned for v2 |

**Gap items to address in v2 or post-v2:**
- `detected_need` should more explicitly capture the client pain dimension, not just intent
- "Comment link" (e.g., link to specific Telegram message) may need a dedicated field when Telegram is added
- Verification fields (e.g., `verified_by`, `verified_at`) are not yet defined — defer until workflow includes human review step

---

## 10. Open Questions

These were not answered in the uncle conversation and need follow-up:

| Question | Impact |
|----------|--------|
| Does uncle use Telegram personally — can he join target groups? | Determines if Telegram scraping is possible |
| Does uncle have an Instagram business account? | Determines Instagram monitoring approach |
| What is the typical loan amount range for his clients? | Refines ICP scoring in Prompt v2 |
| Are there specific competitors uncle already monitors manually? | Provides seed URLs for Workflow 03 |
| What does uncle want to receive — Sheets table, Telegram summary, or both? | Shapes notification design |
| Is there a minimum frequency — daily, weekly, or on-demand? | Shapes scheduling design |

---

## 11. Implications for Prompt v2

Uncle's priorities directly shape Prompt v2 design:

1. **Lead signals must be priority 1** in the agent's reasoning — not an afterthought after competitor classification
2. **ICP is now confirmed:** car owner with PTS, Moscow / MO, bad credit likely, urgency is key
3. **Region filter must be explicit** — records outside Moscow / MO should receive a lower score unless they are nationally relevant competitors
4. **Product fit scoring must align with product priority:** PTS > real estate > refinancing > other
5. **`recommended_action = contact`** requires: product fit + urgency + region match
6. **Competitor monitoring** applies to: businesses offering same products in Moscow / MO
7. **Content angle** should address the fears and questions of Moscow car owners seeking quick loans with bad credit history

See `modules/marketing-scout-v0/MARKETING_AGENT_PROMPT_V2_PLAN.md` for the full prompt design.

---

## 12. Implications for Firecrawl / Apify Configuration

| Source | Tool | Key Configuration |
|--------|------|------------------|
| Competitor websites | Firecrawl | Scrape service pages; extract offer text and terms |
| Avito | Apify | Search for "займ под ПТС Москва", "деньги под залог авто Москва" |
| Telegram | Apify (if available) | Join relevant groups; scrape posts; requires manual access |
| Instagram | Apify | Hashtag scraping; competitor profile monitoring |

**Avito keyword candidates:**
- `займ под ПТС Москва`
- `деньги под залог авто Москва`
- `займ под залог недвижимости Москва`
- `рефинансирование кредита Москва`

**Competitor seed URLs** — operator should provide 2–3 known competitors for Workflow 03 testing.

---

## 13. What Not to Build Yet

| Feature | Reason to defer |
|---------|----------------|
| Telegram scraping | High complexity; requires group membership; do after Avito is proven |
| Instagram scraping | Highest restriction risk; do last |
| Automatic lead contact | Out of scope for v0.1 — operator contacts leads manually |
| CRM integration | Out of scope for v0.1 |
| Verification / human review workflow | Out of scope for v0.1 |
| Multi-city expansion | Moscow / MO only for now |
| Automated scheduling | Deferred until manual runs are stable |

---

## Key Decision Recorded Here

**Before any real scraping begins, Prompt v2 must be adapted to these priorities:**
- Lead signals first
- Competitors second
- Content ideas third

This is a hard gate. Do not run real scraping with Prompt v1 tuned only for competitor extraction.
See also `docs/DECISIONS.md` (DEC-021 and to-be-added DEC-022).
