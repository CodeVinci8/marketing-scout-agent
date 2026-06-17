# FUTURE_CAPABILITIES_BACKLOG.md — Strategic Capabilities Backlog

> **Preservation note (2026-06-12, DEC-123):** all strategic ideas below remain canonical and are now
> mapped onto stages: WF10 outputs (competitor_profiles, market_angles, audience_activity_signals,
> content_positioning_plan, source_confidence_rules) = Stage 3 core; Report & Diagram Builder = Stage 4
> (WF12 v0.2 built, DEC-122); Business Agent Control Kernel = Stage 5
> (`STAGE_5_TELEGRAM_BUSINESS_AGENT_PLAN.md`). Niche Pack System, Market Graph Engine, Source Strategy &
> Budget Planner, Contact/Manager Handoff Layer, Competitor Ad Intelligence stay in this backlog.
> Binding invariants across all of them: public contact policy with evidence URLs, **no hidden contacts,
> no private chats, no auto-outreach by default** (`CONTACT_AND_OUTREACH_POLICY.md`).
>
> **Progress annotation (2026-06-16):** Report & Diagram Builder is now **WF12 v0.3 deterministic — operator
> PASS** (with `public_lead_signals` block; Claude/diagram still gated). The **public lead-signal layer**
> (WF14 → `public_lead_signals`, DEC-130) is **built + quota-fixed (DEC-131) + retest PASS** — it covers the
> "audience pain/lead mining → manager-reviewable rows" slice (evidence-not-permission; no outreach). Telegram
> live preview (WF11 v0.4, DEC-132) is **built but gated**. These are annotations, not new backlog items.


**Status:** 📋 BACKLOG — ideas preserved so they are not lost; **nothing here is approved for build** unless its
own entry says otherwise. Every item follows the project's gates: explicit operator approval, fixture-first,
no external calls without per-service approval, contact policy binding.
**Date:** 2026-06-11 · **Decision:** DEC-105 (backlog established).

---

## 1. Business Agent Control Kernel

- **Status:** idea / design-not-started — **= Stage 5 Telegram Business Agent; NOT started (2026-06-16).**
  The bot is a control/report interface, not a parser: commands create `agent_requests`, paid/live actions
  require approval, no scraping/Claude/auto-outreach inside the bot. See `STAGE_5_TELEGRAM_BUSINESS_AGENT_PLAN.md`.
- **Purpose:** a future conversational control layer — the operator (or the stakeholder) talks to the agent;
  the kernel performs **intent detection** → **niche detection** → **workflow/tool selection** → **cost/risk
  estimate** → **approval plan** → writes the request to `agent_requests` → runs/prepares the chosen workflows →
  returns a report + next actions.
- **Prerequisites:** stable WF09 (done), WF08 (done), WF10 (v0.1 built, under test); Niche Pack System (so the
  kernel can switch niches); Telegram Control Bot transport (Stage 4); a request/approval state machine in
  `agent_requests`.
- **Risks:** intent misclassification triggering wrong/costly workflows; approval bypass; scope creep into
  autonomous spending. Mitigation: kernel only *prepares* paid runs, never executes without approval.
- **First safe implementation step:** a deterministic "request planner" doc + dry-run mode: parse a written
  request into `{intent, niche, workflows, estimated_cost, approval_needed}` and write a `status=needs_review`
  row to `agent_requests` — no execution.
- **Related:** `docs/AGENT_TOOL_ARCHITECTURE.md`, `docs/BUSINESS_SCOUT_AGENT_VISION.md`, `docs/ROADMAP.md` Stage 4,
  `docs/TELEGRAM_CONTROL_AGENT_PLAN.md` (2026-06-12 — the slash-command Telegram control/report bot is the
  kernel's thin transport predecessor; Telegram is a control interface, never a parser).

## 2. Niche Pack System

- **Status:** planned (DEC-100) — `docs/NICHE_PACK_SYSTEM_PLAN.md` written; no YAML built.
- **Purpose:** move from hardcoded credit-broker terms (WF09 relevance filter, WF08 enrichment, WF10 angle
  taxonomy) to versioned `niches/*.yaml` packs: credit brokerage, secured lending, crypto research, real estate
  brokers, local services, B2B.
- **Prerequisites:** Stage 3.3 closed (done); a second niche or second source connector as migration trigger;
  pack loading mechanism decision (generated Code node vs file read).
- **Risks:** behavior drift during extraction (mitigate: fixture-tested, behavior-preserving refactor);
  pack sprawl without ownership.
- **First safe implementation step:** extract the existing WF09 credit-broker term sets verbatim into
  `niches/credit_brokerage.yaml` and prove WF09 fixture output is byte-identical with the pack-driven build.
- **Related:** `docs/NICHE_PACK_SYSTEM_PLAN.md`, DEC-095/100.

## 3. Market Graph Engine

- **Status:** idea / design-not-started.
- **Purpose:** a graph of competitors, offers, pains, sources, audience segments, and content ideas — relations
  like "competitor X pushes angle Y on platform Z targeting pain P". Can start **in Google Sheets** via
  `market_entities` / `market_edges` / `market_clusters` tabs long before any graph database.
- **Prerequisites:** WF10 stable (entities already emerge as competitor_profiles/market_angles); entity-id
  discipline (stable competitor_id/angle keys — already designed in `WF10_TABLE_SCHEMAS.md`).
- **Risks:** premature abstraction; edge explosion; double bookkeeping vs WF10 tables. Mitigation: derive edges
  *from* WF10 outputs, never hand-maintain.
- **First safe implementation step:** a deterministic exporter that converts one WF10 run into
  `market_entities` (competitors, angles, pains) + `market_edges` (competitor→angle, angle→pain) rows in Sheets.
- **Related:** `docs/WF10_TABLE_SCHEMAS.md`, `docs/COMPETITOR_AD_INTELLIGENCE_PLAN.md`.

## 4. Report & Diagram Builder

- **Status:** 🔧 **deterministic skeleton BUILT (2026-06-12, DEC-118)** — WF12
  `n8n/workflows/12_market_intelligence_report_builder.json` (`active=false`, $0: no Claude — guard node;
  no Telegram send; reads the 4 WF10 tabs, writes one `market_intelligence_reports` row (20 cols) + one
  `agent_requests` row; angle trends vs the previous WF10 run). Architecture:
  `docs/REPORTING_AND_TELEGRAM_SUMMARY_PLAN.md` + `docs/MARKET_INTELLIGENCE_REPORT_SCHEMA.md`; guide:
  `docs/N8N_WORKFLOW_12_MARKET_INTELLIGENCE_REPORT_BUILDER_RU.md`. Claude is optional and disabled by
  default; WF10 stays the deterministic fact core. Pending: operator creates the tab + first run; diagrams/
  file export later.
- **Purpose:** weekly summaries and competitor reports from WF10 tables — Markdown first, then CSV/Sheets
  export, PDF later; diagrams: sources map, offer frequency, pain frequency, competitor positioning quadrant.
- **Prerequisites:** WF10 producing real data over ≥2 windows (trend needs two points); Telegram notification
  channel (exists in stack, workflow TBD).
- **Risks:** chart generation dependencies on the VPS; report spam. Mitigation: operator-triggered, MD-only v1.
- **First safe implementation step:** deterministic Markdown weekly digest generated from the latest WF10 run
  (top competitors / top angles / plan) written to a docs/reports/ file — no external calls.
- **Related:** `docs/WF10_TABLE_SCHEMAS.md` §"Telegram summary", `docs/ARCHITECTURE.md`.

## 5. Source Strategy & Budget Planner

- **Status:** idea / partially covered by Stage 3.4 strategy doc — **still FUTURE, but the `live_source_runs`
  ledger (DEC-126; WF11/WF12/WF13 auto + WF15 manual) now provides the baseline run/cost history** a future
  planner would consume (per-run mode, allowlist, counters, `external_calls`, source cost incl. `cost_not_recovered`).
  Not started as an automated planner.
- **Purpose:** given a task ("find competitor offers", "mine audience pains") and a niche, rank sources by
  expected value, risk, cost, and contact availability — e.g. Avito high for competitor offers; Telegram
  medium-high for audience pains; Instagram deferred. Output: ranked source plan + budget estimate before any run.
- **Prerequisites:** Stage 3.4 source matrix (done — `STAGE_3_4_SOCIAL_SOURCE_PARSING_STRATEGY.md` §2/§3 carries
  the static ranking); measured per-source costs in `COSTS_AND_LIMITS.md`; niche packs for per-niche priorities.
- **Risks:** stale cost data producing wrong plans. Mitigation: every live run records actual cost (existing rule).
- **First safe implementation step:** encode the Stage 3.4 comparison table as a small deterministic scoring
  function (doc/table first) that the future Control Kernel can call.
- **Related:** `docs/STAGE_3_4_SOCIAL_SOURCE_PARSING_STRATEGY.md`, `docs/COSTS_AND_LIMITS.md`,
  `docs/NICHE_PACK_SYSTEM_PLAN.md` (`platform_priorities`, `source_priorities`).

## 6. WF10 Competitor/Audience Intelligence Aggregator

- **Status:** ✅ **v0.2 PATCHED (2026-06-12, DEC-106/107/108)** after v0.1 operator tests — no-data guard,
  improved entity resolution (profile_url/canonical-listing-id before offer text), mandatory `source_mix`
  label. Deterministic, $0, `active=false`. **In-WF10 LLM synthesis is dropped (DEC-112)** — Claude moved to
  the report/control layer (backlog item 4). Remaining v0.3 idea: upsert competitor_profiles.
- **Purpose:** aggregate `monitor_queue`/`content_queue`/`review_queue` into `competitor_profiles`,
  `market_angles`, `audience_activity_signals`, `content_positioning_plan` (+ `source_confidence_rules` seed).
- **Prerequisites (met):** Stage 3.3 closed — one stable live source (Avito) feeding WF08-routed rows.
- **Risks:** append-only snapshots inflating tabs over many runs (v0.2 upsert planned); hardcoded niche vocabulary
  (migrates to niche packs).
- **Next step:** operator first run per `docs/N8N_WORKFLOW_10_COMPETITOR_AUDIENCE_INTELLIGENCE_AGGREGATOR_RU.md`;
  then v0.2: upsert competitor_profiles, optional bounded LLM synthesis (operator-approved per run).
- **Related:** `docs/WF10_COMPETITOR_AUDIENCE_INTELLIGENCE_AGGREGATOR_PLAN.md`, `docs/WF10_TABLE_SCHEMAS.md`.

## 7. Contact / Manager Handoff Layer

- **Status:** policy written and binding (DEC-097/098); handoff tooling not built.
- **Purpose:** evidence-bound manager handoff of **public contacts only** (`contact_public` + mandatory
  `contact_source_url` + `contact_use_policy=manager_allowed`); no auto-outreach by default. Future **mass
  auto-DM** is explicitly a separate compliance/risk project — out of scope until then.
- **Prerequisites:** a source that actually yields public contacts with evidence (review platforms/org cards are
  the most likely first); `contact_confidence`/`contact_use_policy` columns added at the next schema revision.
- **Risks:** policy erosion under growth pressure; contact staleness. Mitigation: policy is tighten-only via
  niche packs; every handoff carries the source URL for re-verification.
- **First safe implementation step:** add the three planned contact columns to the schema revision and a manual
  "handoff sheet" view filtered to `manager_allowed` rows — no automation.
- **Related:** `docs/CONTACT_AND_OUTREACH_POLICY.md`, `docs/LEAD_DATA_MODEL_PLAN.md`.

---

## Future Telegram Discussion / Group Connector (high-risk optional, NOT current MVP)

A future connector for Telegram **groups/discussions** (distinct from the WF11 public-channel `t.me/s` preview):

- **Separate workflow**, not WF11 public preview.
- **MTProto / user-session** connector as a high-risk **optional** extension, separately approved.
- **Explicit allowlist only**; only groups/chats where the operator has **legitimate access**.
- **Separate credential boundary**; no sharing with the public-preview path.
- **No auto-outreach; no hidden/private data export.**
- **Member extraction only if legally/ethically permitted and explicitly approved**; default output is
  **aggregate signals + manual-review evidence, not contact lists.**
- Not part of current MVP source closure. (Cross-ref: `docs/STAGE_3_4_SOCIAL_SOURCE_PARSING_STRATEGY.md` §5.9.)

## Stage 5 — Telegram Business Agent = conversational AI control/report layer (NOT just a command menu)

Direction for the Stage 5 operator interface (do **not** build now):

- **Primary UX = natural language.** Operator describes a niche/region/task in plain Russian; the agent understands
  intent, **proposes a source plan**, a **cost/risk estimate**, and the **expected output format**, **asks
  approval** for any paid/live step, **creates `agent_requests`**, triggers the right workflows, tracks progress,
  returns the report, and suggests next actions.
- **Commands are fallback affordances only:** `/status`, `/latest_report`, `/costs`, `/help`.
- Approval-gated and budget-gated end to end; no auto-outreach. Cross-ref: `docs/REPORTING_AND_TELEGRAM_SUMMARY_PLAN.md`.

## VK live connector (Stage 3 EXPANSION, NOT MVP closure blocker)

Moved out of the Stage 3 MVP closure path (2026-06-17, DEC-135). VK live remains a planned **expansion**, not a
blocker for closing the Telegram source:

- **Official VK API only** — bound credential in n8n; no user sessions, no unofficial clients.
- Methods limited to **`wall.get`** + **`wall.getComments`**; **public groups only**, from an explicit **list of
  tracked groups** (operator-provided).
- **Approval token** `I_APPROVE_LIVE_VK_PUBLIC_DISCUSSION` + gate (WF13 v0.2 path already built/inert, DEC-125).
- **No messages, no member extraction, no outreach.** Max 1–2 public groups on first smoke; cost recorded
  (free tier for public `wall.get`; `cost_not_recovered` if unknown).
- Cross-ref: `docs/STAGE_3_4_SOCIAL_SOURCE_PARSING_STRATEGY.md`, WF13 RU doc.

## Stage 2 cleanup (backlog, NOT a Stage 3 blocker)

Tracked so the web pipeline is not forgotten; none of this blocks Stage 3 closure (2026-06-17):

- **WF06** still uses a manual **`Set Runner Config`** node (operator edits `runner_mode` by hand).
- **WF06 `Mark Candidates Processed`** update node ships **disabled** (operator enables after confirming
  `monitor_queue`).
- **deep / no-deep domain policy** needs a cleaner operator flow (currently mode-switch by hand).
- **`competitor_site_snapshots`** tab still needs population (WF04 Phase B snapshot-append, own approval — DEC-129).
- Cross-ref: `docs/STAGE_2_WEB_PIPELINE_REVIEW.md`, `docs/WORKFLOW_06_AUTO_HANDOFF_PLAN.md`.

## Post-Stage-3.5 audit P2/P4 triage (DEC-140, 2026-06-17)

The external audit's non-P0 / future suggestions, classified. **Nothing here is built in the alignment patch** —
only items required for Stage-C live-readiness/safety/schema-consistency were done now (those were code fixes in
WF14, not backlog). Everything below stays gated.

| Suggestion | Classification | Note |
|------------|----------------|------|
| `review_priority` enum explicit + 4-value | **DONE now** (DEC-140) | needed for schema/validation consistency — WF14 `priorityOf` + docs |
| Canonical timestamp clarification | **DONE now** (DEC-140) | `created_at` is the write/append timestamp; no `append_timestamp` column |
| `source_comment_url` / dedup stable across fixture & live | **DONE now** (DEC-140) | WF14 `splitCmt()`; required for "dedup keys stable" |
| VK live path implementation-ready | **DONE now** (DEC-140) | code complete; runtime = `BLOCKED_BY_OPERATOR_CREDENTIALS_OR_LIVE_RUN` |
| LLM / Claude enrichment of lead signals | **`STAGE_4_SCOPE`** | Phase D 4.1 — refine intent/pain/score; deterministic fallback intact; never before Stage C |
| Telegram Business Agent / conversational manager UX | **`STAGE_5_SCOPE`** | after the Stage 4 contract (4.3) |
| Manager dashboard / lead UI | **`BACKLOG_AFTER_STAGE_C`** | product polish; Google Sheets review workflow is the MVP surface |
| CRM layer / status automation | **`BACKLOG_AFTER_STAGE_C`** | Stage 7 historical; not needed for Stage C |
| Cross-platform / cross-source dedup | **`BACKLOG_AFTER_STAGE_C`** | current per-source dedup (`market_record_registry` + `lead_signal_id`) is sufficient for Stage C |
| Additional public sources (reviews/maps, Dzen, forums, Telegram comments) | **`BACKLOG_AFTER_STAGE_C`** | one-source-at-a-time; VK first; each its own approval + feasibility |
| Contact-permission / consent checker | **`BACKLOG_AFTER_STAGE_C`** | current policy already blanks unprovable contacts + `outreach_allowed=false`; a richer checker is polish |

Binding invariants unchanged: public evidence only; contact = evidence not permission; `outreach_allowed=false`;
no hidden/private/member extraction; no MTProto; no auto-outreach (`CONTACT_AND_OUTREACH_POLICY.md`).
