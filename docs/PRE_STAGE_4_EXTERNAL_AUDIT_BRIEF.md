# PRE_STAGE_4_EXTERNAL_AUDIT_BRIEF.md — External Architecture Audit Brief (before Stage 4)

**Status:** 📋 BRIEF FOR AN EXTERNAL AGENT — to be handed to another AI agent (e.g. a ChatGPT Agent) for an
independent review of Marketing Scout **before Stage 4 implementation begins**. This file does not authorize
any code change, API call, or deployment.
**Date:** 2026-06-17 · **Prepared by:** project agent (Claude). **Audience:** external auditor.

---

## 0. Your role (external auditor)

You are an independent technical auditor. **Read only. Do not modify files, do not call any external API, do not
run any workflow, do not use real credentials.** Produce **one Markdown file** with the verdict structure in §4.
Be concrete: name files, workflows, columns, and exact risks. Prefer precise, falsifiable findings over generic
advice. Where you disagree with a stated closure or decision, say so and give the reason.

## 1. What the project is

AI-powered market + (emerging) lead intelligence automation for a credit-brokerage niche (Москва/МО).
Self-hosted **n8n** orchestrates source connectors → deterministic analysis → Google Sheets storage →
(planned) Claude enrichment → (planned) Telegram Business Agent. **Claude API** is the analytical brain but is
deliberately kept **out** of the deterministic fact core (DEC-112). Everything is fixture-first, `active=false`,
$0 by default, with per-action operator approval for anything live/paid.

## 2. Read these first (in order)

1. `CLAUDE.md` (operating/safety rules) · `core/rules.md`
2. `core/hot/recent.md` · `core/warm/decisions.md`
3. `docs/ROADMAP.md` · `docs/NEXT_ACTIONS.md`
4. `docs/STAGE_3_SOURCE_AND_INTELLIGENCE_FOUNDATION.md` (Stage 3 closure claims)
5. `docs/STAGE_4_REPORT_AND_CLAUDE_LAYER.md` (3 sub-stages 4.1/4.2/4.3)
6. `docs/LEAD_SCOUT_LAYER_PLAN.md` (lead layer)
7. `docs/TABLE_SCHEMA.md` + `docs/WF10_TABLE_SCHEMAS.md` + `docs/MARKET_INTELLIGENCE_REPORT_SCHEMA.md`
8. `docs/COSTS_AND_LIMITS.md` · `docs/CONTACT_AND_OUTREACH_POLICY.md`
9. `docs/GOOGLE_SHEETS_VALIDATION_PLAN.md`
10. Workflows: `n8n/workflows/04..15*.json` (focus 04/05/06/07/08/10/11/12/14)
11. Per-workflow RU docs `docs/N8N_WORKFLOW_*` and `docs/DECISIONS.md` (DEC index)

## 3. What to assess

- **Architecture** — connector → WF08 → WF10 → WF12 separation; is the deterministic-core / LLM-on-top split (DEC-112) sound and actually enforced in the JSON?
- **Workflows** — correctness, guards, idempotency, quota safety (DEC-131), loop-tail accounting (DEC-134), dead/disabled nodes.
- **Data model** — `raw_market_records`, `market_record_registry`, `public_lead_signals`, `competitor_*`, `live_source_runs`, `agent_requests`, `market_intelligence_reports`. Coherent? Drift between schema docs and node mappings?
- **Google Sheets schema** — column counts vs node mappings; long-markdown report cell ergonomics (see GOOGLE_SHEETS_VALIDATION_PLAN formatting section).
- **Prompt quality** — WF08/WF12 prompt evidence-binding, anti-hallucination rules, repair-loop bounds.
- **Claude usage plan** — Stage 4.1/4.2/4.3 scope: selective enrichment, budget guards, cost/token logging, deterministic fallback. Realistic? Any unbounded-cost path?
- **Cost / guard model** — approval tokens, budget guards before HTTP nodes, caps; any way to spend money without approval?
- **Public data / contact policy** — CONTACT_AND_OUTREACH_POLICY enforcement; any path that surfaces contacts in reports or enables outreach?
- **Lead Scout gap** — is `LEAD_SCOUT_LAYER_PLAN.md` concrete and safe? What's missing to ship the MVP lead layer?
- **Stage 2 debt** — WF04–07 web pipeline: observability, WF06 handoff/"Mark Processed", `competitor_site_snapshots` not yet populated (WF04 Phase B). Is the cleanup checklist sufficient?
- **Stage 3 closure validity** — is "Stage 3 MVP CLOSED/PASS" justified by the cited acceptance evidence, or were dirty diagnostic runs used as closure evidence? (Diagnostic run IDs are listed in the Stage 3 doc and AGENT_LOG.)
- **Stage 4 readiness** — can 4.1 start cleanly on current data?
- **Stage 5 Telegram Business Agent architecture** — control-not-parser separation; approval flow; no-outreach.

## 4. Required output (single Markdown file)

```
# Marketing Scout — Pre-Stage-4 External Audit

## Executive verdict            (ship Stage 4? conditions?)
## P0 blockers before Stage 4    (must fix first)
## P1 important before demo      ("uncle demo")
## P2 later improvements
## Strengths
## Weaknesses
## Data-quality risks
## Prompt / LLM risks
## Lead Scout implementation recommendations
## Suggested Stage 4 implementation plan   (4.1 → 4.2 → 4.3, concrete)
## Concrete file/workflow recommendations  (path : finding : fix)
```

## 5. Ground rules for the auditor

- Treat all "PASS/CLOSED" claims as **claims to verify**, not facts. Cross-check counters against AGENT_LOG.
- Do **not** propose outreach features, member extraction, private-group scraping, or MTProto — these are out of scope by policy.
- Flag any real secret/Spreadsheet ID if you find one (there should be none — placeholders only).
- Keep recommendations buildable on the current stack (n8n + Apify/Firecrawl + Claude API + Google Sheets + Telegram); no new frameworks (DEC-001).
- Distinguish MVP blockers from expansion (VK live, Telegram groups, extra sources are expansion, not blockers).
