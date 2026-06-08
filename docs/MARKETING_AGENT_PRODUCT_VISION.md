# MARKETING_AGENT_PRODUCT_VISION.md — Marketing Scout as the First Domain (DESIGN ONLY)

**Status:** 📐 VISION / DESIGN ONLY. Nothing here is built beyond the approved Stage 2 web pipeline.
**Date:** 2026-06-08 (reframed after `docs/STAKEHOLDER_INTERVIEW_2026_06_08.md`).
**Parent vision:** `docs/BUSINESS_SCOUT_AGENT_VISION.md`.

> **Reframe:** the larger product is the **Business Scout Agent**. **Marketing Scout** is its **first capability
> domain** — marketing / lead / competitor intelligence for a secured-lending business in Moscow & MO. This file
> describes that first domain; the parent file describes the broader agent.

---

## 1. What Marketing Scout is (within the bigger agent)

Marketing Scout is the **first domain** of the Business Scout Agent: it scouts the market for **leads,
touchpoints, and competitor intelligence**, then helps turn findings into **USP/positioning** and **outreach
drafts**, recommending next actions. It is **not** a simple command bot — it uses **internal tools/workflows**,
keeps **project memory**, and runs behind **human approval + cost gates**.

## 2. Why "not a simple command bot"

- The future Telegram/chat layer is a **control interface**, not the product.
- The value is in the **tools** (discovery, mining, semantic/ads analysis, USP, outreach drafts, reporting), the
  **memory**, and the **analysis/next-action** recommendations.
- After receiving results, the agent should **suggest next actions** — like an employee, not a script.

## 3. First-domain capabilities (mapped to tools)

| Capability | Tool (see `AGENT_TOOL_ARCHITECTURE.md`) | Status |
|------------|------------------------------------------|--------|
| Web competitor discovery + analysis | `web_competitor_discovery_tool` (Stage 2 WF05/06/04) | ✅ approved |
| Social/classified touchpoint discovery | `social_classified_touchpoint_discovery_tool` | 📐 Stage 3, design |
| Competitor audience mining (public) | `competitor_audience_mining_tool` | 📐 design |
| Comment mining + intent/pain classification | `comment_mining_tool` | 📐 design |
| Semantics / ad-channel analysis | `semantic_ads_analysis_tool` | 📐 design |
| USP / positioning drafting | `usp_positioning_tool` | 📐 design |
| Outreach/call-script drafting (no send) | `outreach_draft_tool` | 📐 design, deferred for send |
| Reporting / XLSX / summaries | `report_summary_tool` | 📐 design |
| Next-action recommendations | `next_action_recommender` | 📐 design |

## 4. Memory in the marketing domain

The agent remembers the **business profile** (secured lending; PTS/auto/RE; Moscow/MO), **known competitors**
(brokers/lenders found via Stage 2), **source quality** (which sources gave useful results), **lead/follow-up
status**, and **campaign insights** (semantic themes, USP drafts, scripts). See `docs/AGENT_MEMORY_PLAN.md`.

## 5. Generalization

The architecture is **niche-agnostic**: a future `market_profile` lets the same agent scout other services/
regions. Secured lending in Moscow/MO is simply the **first** profile.

## 6. Near-term boundaries

- Stage 2 web competitor intelligence is the only **built/approved** capability.
- All Stage 3+ tools are **design-only**; no parser/scraper/bot/outreach is built.
- Outreach/autocall/mass messaging **deferred** until compliance/platform review.
