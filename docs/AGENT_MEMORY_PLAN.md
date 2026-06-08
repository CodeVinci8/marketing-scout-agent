# AGENT_MEMORY_PLAN.md — Project-Owned Agent Memory (DESIGN / PROPOSED ONLY)

**Status:** 📐 PROPOSED ONLY — the `agent_memory` sheet is **not created**; no workflow writes it.
**Date:** 2026-06-08
**Parent:** `docs/BUSINESS_SCOUT_AGENT_VISION.md` (Layer 4). Schema: `docs/TABLE_SCHEMA.md`.

> **Principle:** memory is **project-owned structured data**, not vague chatbot memory. It is auditable, lives in
> the project's data layer, and is governed by the same approval/compliance rules as everything else.

---

## 1. Why memory

For the agent to behave like an employee it must remember the business, the competitors, which sources are
useful, what was already checked/contacted, and the decisions/constraints that shape its behavior. This avoids
re-running the same discovery and lets the agent give **context-aware next actions**.

## 2. Memory categories

| Category | Holds | Example |
|----------|-------|---------|
| **business_profile** | niche, region, services, target audience, constraints | secured lending; Moscow/MO; PTS/auto/RE |
| **stakeholder_preferences** | preferred outputs, risk tolerance, approval rules | "always show cost before running", "public data only" |
| **known_competitors** | domains, names, strengths, `last_seen` | brokers/lenders found via Stage 2 |
| **source_quality_memory** | which sources gave useful/poor results | "Avito = high intent; Instagram = weak leads" |
| **lead_processing_memory** | statuses, follow-ups, what was already contacted | "record X = contacted 2026-06-10" |
| **campaign_memory** | semantic themes, USP drafts, outreach scripts | "USP draft v1", "keyword cluster: займ под ПТС срочно" |
| **decision_memory** | architecture decisions — **DEC files remain source of truth** | DEC-078 reframe |
| **run_history** | what was run, costs, outputs, next actions | "WF05 run 2026-06-08, 9 candidates, $X" |

> `decision_memory` mirrors/points to `docs/DECISIONS.md`; the DEC files stay authoritative, the sheet is an
> index/pointer only.

## 3. Proposed sheet — `agent_memory` (PROPOSED, not created)

**Columns:** `memory_id`, `created_at`, `updated_at`, `memory_type`, `entity_type`, `entity_key`, `title`,
`content`, `source`, `confidence`, `status`, `last_used_at`, `notes`. (Canonical table in `TABLE_SCHEMA.md`.)

**`memory_type` values:** `business_profile`, `stakeholder_preference`, `known_competitor`, `source_quality`,
`lead_followup`, `campaign_insight`, `decision`, `run_summary`, `constraint`.
**`status` values:** `active`, `archived`, `needs_review`.

- `entity_type` + `entity_key` link a memory to a thing (e.g. `competitor`/`autolombardn1.ru`,
  `source`/`avito`, `request`/`agent_req_…`).
- `confidence` lets low-trust memories be flagged `needs_review` before reuse.

## 4. Privacy & compliance (mandatory)

- **Minimize sensitive/personal data.** Store the minimum needed (prefer aggregates, handles, public links over
  raw personal details). Do not store private-chat content.
- **No memory may drive unauthorized outreach.** `lead_followup` memory must never be used for mass send or
  autocall; outreach is deferred until compliance review.
- **Public data only**, consistent with `SOCIAL_CLASSIFIED_SOURCE_MATRIX.md` and source ToS.
- Memories are **human-reviewable** and can be set `archived`/`needs_review`; nothing is auto-acted-upon.

## 5. Build status

- `agent_memory` is **PROPOSED** — created only after the stakeholder approves the Stage 3.1 data model.
- No memory automation is built. Until then, `core/hot/recent.md`, `docs/DECISIONS.md`, and `docs/AGENT_LOG.md`
  remain the working memory of the project.
