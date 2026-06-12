# CONTACT_AND_OUTREACH_POLICY.md — Contact Data and Outreach Policy

**Status:** ✅ POLICY — binding for all current and future source connectors, analyzers, and aggregators.
**Date:** 2026-06-11 · **Decisions:** DEC-097 (public contacts only, with source evidence), DEC-098 (no automatic outreach by default).
**Related:** `docs/LEAD_DATA_MODEL_PLAN.md`, `docs/AGENT_CAPABILITIES.md`, `docs/STAGE_3_4_SOCIAL_SOURCE_PARSING_STRATEGY.md`,
`docs/WF10_COMPETITOR_AUDIENCE_INTELLIGENCE_AGGREGATOR_PLAN.md`.

> This policy governs how the Business Scout Agent collects, stores, and uses contact data. It applies to
> Workflow 07 (manual intake), Workflow 09 (Avito/classifieds), every future source connector
> (Telegram/VK/Dzen/Instagram/reviews), Workflow 08 (analyzer), and the planned WF10 aggregator.

---

## 1. Purpose

The business needs **real, actionable, public contacts for manager handoff where available** (phone, email,
Telegram, profile link, contact form). At the same time the system must never become a covert contact harvester.
This policy draws the line: **public contacts only, with source evidence, no automatic outreach by default.**

## 2. Contact data model

Every record that carries contact data uses these fields (already present or to be added in
`raw_market_records` / business tabs — see `docs/LEAD_DATA_MODEL_PLAN.md`):

| Field | Meaning | Allowed values |
|-------|---------|----------------|
| `contact_public` | the contact exactly as published by its owner (verbatim, no reconstruction) | string or empty |
| `contact_channel` | type of contact | `phone` / `email` / `telegram` / `profile` / `form` / `unknown` |
| `contact_source_url` | URL of the **public page where the contact is visible** (the evidence) | URL or empty |
| `contact_confidence` | how certain we are this contact belongs to this entity and is current | `high` / `medium` / `low` |
| `contact_use_policy` | what may be done with this contact | see §3 |

Rules for the fields:
- `contact_public` is **never invented, never reconstructed** (no "show phone" bypass, no pattern-guessing
  emails). If the platform hides the phone behind a button/anti-bot, the contact is `unknown` — full stop.
- `contact_source_url` is **mandatory whenever `contact_public` is non-empty.** A contact without source
  evidence must be blanked at normalization time.
- `contact_confidence` is `high` only when the contact appears on the entity's own public page/listing;
  `medium` when relayed (e.g. mentioned in a post); `low` for anything indirect.

## 3. `contact_use_policy` values

| Value | Meaning | When assigned |
|-------|---------|---------------|
| `manager_allowed` | a manager may use this contact for a manual, individual, relevant outreach | public contact + `contact_source_url` + `contact_confidence=high` + lead/partner context |
| `manual_review` | operator must review before any use | medium/low confidence, ambiguous ownership, or sensitive context |
| `no_outreach` | stored for identification only; outreach forbidden | competitor staff personal contacts; contacts found in complaint/dispute contexts; anything doubtful |
| `aggregate_only` | may be counted in statistics, never used individually | audience-analysis records, comment authors, group members |

Default when uncertain: `manual_review`. Default for audience/competitor-audience data: `aggregate_only`.

## 4. Hard rules (forbidden)

1. **Public contacts only.** No contact may enter the system unless its owner published it openly.
2. **No hidden-phone extraction or platform-protection bypass** (Avito "show phone", anti-bot circumvention,
   session/browser tricks to reveal masked data).
3. **No private chat/DM scraping.** Private conversations are out of scope entirely.
4. **No collection from private accounts** unless the account itself publishes an explicit public contact.
5. **No contact collection "just in case."** A contact is stored only when attached to a concrete record with
   a concrete business reason (lead signal, partner candidate, competitor identification).
6. **No automatic outreach by default.** No auto-DM, no auto-email, no auto-call. Any future mass-DM idea is
   a separate, explicitly-approved project with its own legal review — out of scope now (DEC-098).
7. **Manager handoff requires source evidence.** A contact reaches a manager only together with
   `contact_source_url` and the record that justifies the outreach.

## 5. Routing consequences

- A **lead without a public contact** routes to `review_queue` as a `lead_signal` — **not** to `results`
  with a contact action. The analyzer must never fabricate a "contact" recommendation for a record with empty
  `contact_public` (already enforced deterministically in Workflow 08).
- **Audience analysis is aggregate/statistical** (counts, topics, pains, frequency) unless an explicit public
  contact with evidence exists for a specific author — and even then the record defaults to `manual_review`.
- **Competitor intelligence** uses contacts only for identification (which company is this listing) — policy
  `no_outreach` for competitor staff/personal contacts.

## 6. Enforcement points

| Layer | Enforcement |
|-------|-------------|
| Source connectors (WF09, future) | only copy contacts visible in the public payload; set channel/source/confidence; blank anything without evidence |
| Workflow 08 (analyzer) | no-contact safety: route without public contact → `review_queue`/`lead_signal`; never outputs outreach advice for empty contacts |
| WF10 (aggregator, planned) | audience tables are aggregate-only; contact fields surface only with policy + evidence |
| Niche packs (planned) | `contact_policy_overrides` may only tighten this policy, never loosen it |
| Operator | approves any new contact-bearing source; reviews `manual_review` items |

## Addendum (2026-06-12, DEC-130) — Public Lead Signal Layer

The `public_lead_signals` tab (WF14) is governed by this policy in full:
- A **public profile URL is evidence, not permission for outreach.** It exists for human verification of
  the signal in context, never for messaging the author.
- `contact_use_policy` on every row: `manual_review` (public contact was verbatim in the source text) or
  `aggregate_only` (default). No workflow may emit an outreach-typed `recommended_action`.
- Reports (WF12) consume lead signals **as aggregates only** — no names, handles, profile URLs or contacts
  appear in any report or Telegram digest.
- Sheets-safe writing (DEC-124) preserves contact evidence verbatim (apostrophe prefix is presentation-only).
