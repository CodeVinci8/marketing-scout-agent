# BUSINESS_SCOUT_AGENT_VISION.md — Product Vision (DESIGN ONLY)

**Status:** 📐 VISION / DESIGN ONLY — nothing here is built beyond the approved Stage 2 web pipeline.
**Date:** 2026-06-08 (post stakeholder interview — `docs/STAKEHOLDER_INTERVIEW_2026_06_08.md`).
**Supersedes framing of:** "Marketing Scout Bot" → reframed as **Business Scout Agent**.

> **Build gate:** This document reframes the product. It does **not** authorize any connector, parser, bot,
> scraping, outreach, or scheduling. All near-term work stays manual, human-approval-gated, and design-first.

---

## 1. The product

**Business Scout Agent** is an **agentic business automation system** — an "AI employee" with **internal tools,
memory, and analysis** — that scouts the market for a business: it finds leads and touchpoints, analyzes
competitors, mines comments/audiences, surfaces advertising channels and semantic queries, helps formulate
USP/positioning, drafts outreach, and **recommends next actions** — while **remembering** business context,
competitors, prior findings, and what has already been checked.

It is **not** a simple Telegram slash-command bot. Telegram/chat is one possible **control interface**; the
**core product is tools + memory + analysis**, not the command surface.

## 2. First capability domain — Marketing Scout

The first domain delivered is **Marketing / Lead / Competitor Intelligence** ("Marketing Scout"), for a
secured-lending business in Moscow & MO (PTS / auto / real-estate collateral). The same agent architecture is
designed to generalize to **other niches** later via reusable market profiles.

> Framing rule: **Marketing Scout Agent = the first business domain of the broader Business Scout Agent.**

## 3. Product layers

```
┌──────────────────────────────────────────────────────────────────┐
│ 1. Control / Conversation Layer  (future Telegram/Chat)            │
│    receive task → clarify → show plan + cost → ask approval →      │
│    run tool(s) → return summary + next actions                     │
└───────────────┬────────────────────────────────────────────────────┘
                │ chooses & invokes tools (no parser logic lives here)
┌───────────────▼────────────────────────────────────────────────────┐
│ 2. Tool / Automation Layer  (n8n workflows + prompts + schemas)     │
│    web_competitor_discovery · social_classified_touchpoint ·        │
│    competitor_audience_mining · comment_mining ·                    │
│    semantic_ads_analysis · usp_positioning · outreach_draft ·       │
│    report_summary · next_action_recommender                        │
└───────────────┬────────────────────────────────────────────────────┘
                │ read/write
┌───────────────▼───────────────┐   ┌───────────────────────────────┐
│ 3. Data Layer (Google Sheets   │   │ 4. Memory Layer (project-owned) │
│    now; optional DB/CRM later) │   │ business profile · competitors  │
└───────────────┬───────────────┘   │ source quality · findings ·     │
                │                    │ preferences · decisions ·       │
                │                    │ follow-up tasks                 │
                │                    └───────────────────────────────┘
┌───────────────▼────────────────────────────────────────────────────┐
│ 5. Analysis Layer  (source-agnostic analyzer · scoring ·            │
│    next_action recommendations)                                     │
└──────────────────────────────────────────────────────────────────┘
```

### Layer 1 — Control / Conversation Layer (future)
A future Telegram/chat interface that **receives tasks, asks clarifying questions, shows the plan + cost, asks
for approval, runs the chosen tool(s), and returns a summary + next actions.** It **chooses** tools; it contains
**no scraping/parser logic** and is **not** built yet (Stage 4). The Control Agent ≠ any source parser.

### Layer 2 — Tool / Automation Layer
The internal tools/automations (full spec in `docs/AGENT_TOOL_ARCHITECTURE.md`):
- **Web Competitor Intelligence** — the **existing approved Stage 2** pipeline (WF05 → WF06 → WF04).
- **Social/Classified Touchpoint Discovery** — future Stage 3.
- **Competitor Audience Mining**, **Comment Mining**, **Semantic/Ads Query Analysis**,
  **USP/Positioning Assistant**, **Outreach Draft Assistant** (drafts only, no send),
  **Reporting/XLSX/Summary Exporter**.
> These are **not necessarily separate LLM agents** at first — they are **n8n workflows + prompts + schemas**.
> Later the Control Agent can choose which tool to run.

### Layer 3 — Data Layer
**Google Sheets now** (6 business tabs + registries + proposed agent sheets). Optional **DB/CRM later**.

### Layer 4 — Memory Layer
**Project-owned structured memory** (full spec in `docs/AGENT_MEMORY_PLAN.md`): business profile, stakeholder
preferences, known competitors, source quality, lead/follow-up status, campaign insights (semantics/USP/scripts),
decisions (DEC files remain source of truth), and run history. Not vague chatbot memory; minimized personal data.

### Layer 5 — Analysis Layer
The **source-agnostic analyzer** (reuses the Stage 2 resilient analyzer) classifies records, scores them, and
emits **`next_action` recommendations** — so the agent suggests what to do after each run, like an employee.

## 4. What makes it "an employee, not a bot"
- **Memory:** it knows the business, the competitors, and what was already checked.
- **Initiative:** it recommends next actions, not just rows.
- **Tools:** it runs the right automation for the task and reports cost/plan first.
- **Judgment under approval:** humans approve spend and any outward action; outreach/calls are deferred until
  compliance review.

## 5. Non-goals (near term)
- No mass outreach, autocall, or automated messaging.
- No source parsers/scrapers built yet (Avito/Dzen/VK/Telegram/Instagram all design-only).
- No scheduled scraping, no CRM integration, no Control Bot — all later, behind approval.
