# AGENT_TOOL_ARCHITECTURE.md — Internal Tools / Automations (DESIGN ONLY)

**Status:** 📐 DESIGN ONLY — only `web_competitor_discovery_tool` (Stage 2) is built/approved. All others are
design-only. Nothing here authorizes a parser, scraper, bot, scheduling, or outreach.
**Date:** 2026-06-08
**Parent:** `docs/BUSINESS_SCOUT_AGENT_VISION.md` (Layer 2). Data: `docs/TABLE_SCHEMA.md`. Memory:
`docs/AGENT_MEMORY_PLAN.md`.

> **Key clarification:** these tools are **not necessarily separate LLM agents** at first. Each can be an **n8n
> workflow + prompt(s) + schema**. Later the Control Agent (Stage 4) **chooses which tool to run**; it does not
> contain parser logic itself. Every tool runs behind **human approval + cost gates**.

---

## Tool catalog

### 1. `web_competitor_discovery_tool` — ✅ BUILT/APPROVED (Stage 2)
The existing pipeline: **WF05 (Apify search → `url_candidates`) → human approval → WF06 (approved runner) →
manual handoff → WF04 (Firecrawl analyzer → `monitor_queue`/`skipped_log`/`technical_errors`)**. Discovers and
analyzes competitor **websites**. Source-of-truth example for how every other tool should behave (discover →
approve → analyze → route, modular, no auto-spend).

### 2. `social_classified_touchpoint_discovery_tool` — 📐 Stage 3
Discovers **touchpoints** (not only hot leads) from social/classified sources (Avito, Dzen, VK, Telegram, etc.),
normalizes to `raw_market_records`, dedups via `market_record_registry`, sets `approval_status=new`. Never calls
Claude itself (the analyzer does, post-approval). See `LEAD_DISCOVERY_ARCHITECTURE.md`,
`SOCIAL_CLASSIFIED_SOURCE_MATRIX.md`.

### 3. `competitor_audience_mining_tool` — 📐 design
Collects **public** commenters/subscribers/followers of competitor pages where allowed → `competitor_audience` /
`cold_audience_candidate` records. **Public data only, minimized, no unauthorized outreach** (see compliance in
`AGENT_MEMORY_PLAN.md` and `STAKEHOLDER_INTERVIEW_2026_06_08.md`).

### 4. `comment_mining_tool` — 📐 design
Extracts **comments** (Avito/Dzen/VK/Instagram/Telegram where public) and classifies intent/pain →
`warm_touchpoint` / `client_pain` / `question_objection` / `competitor_activity` / `content_idea`. Comments are a
first-class source per the stakeholder.

### 5. `semantic_ads_analysis_tool` — 📐 design
Collects **relevant queries**, competitor **ad/listing language**, recurring **keywords/themes**, and **where
competitors advertise** → `semantic_signal` / `ad_channel_signal` records and `campaign_insight` memory. Answers
"what queries bring competitors clients" and "where do they advertise".

### 6. `usp_positioning_tool` — 📐 design
Uses competitor + pain + semantic data to **draft USP / positioning** (advantages, differentiators, messaging
angles). Writes `campaign_insight` memory; produces a draft, not a published asset.

### 7. `outreach_draft_tool` — 📐 design, **send deferred**
Drafts **first-touch messages / call scripts** from touchpoint + pain + USP context. **No mass send, no autocall,
no automated messaging** — drafting only, deferred for any sending until compliance/platform review.

### 8. `report_summary_tool` — 📐 design
Produces **summaries, Google Sheet links, and XLSX snapshots** (per-run, weekly digests, competitor/lead
reports). Read-only over existing sheets; no new collection.

### 9. `next_action_recommender` — 📐 design
After any tool run, suggests **what to do next** (e.g., "approve these 4 warm touchpoints", "mine comments on
competitor X", "draft USP from pains found"). Writes `next_action` on records/requests and a `run_summary`
memory entry. This is what makes the agent feel like an employee.

---

## How tools relate to data & memory
- Every tool run is driven by an **`agent_requests`** row (`request_type` selects the tool) and writes results
  back (`result_summary`, `next_action`). See `TABLE_SCHEMA.md`.
- Discovery/mining tools write **`raw_market_records`** and check **`market_record_registry`**.
- Analysis/insight tools read records + write **`agent_memory`** (competitors, source quality, campaign insights,
  run history).

## Sequencing
1. Document the **agent/tool map** (this doc) — done.
2. Build **Manual Records Intake** first (zero source risk) to exercise records + analyzer + next_action.
3. Add real discovery/mining tools per Stage 3 source feasibility (Avito first candidate).
4. Reporting + USP + outreach-draft tools follow; **send/autocall deferred** to a compliance-reviewed stage.
5. Control Agent (Stage 4) later orchestrates tool selection.
