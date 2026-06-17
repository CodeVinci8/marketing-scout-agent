# TELEGRAM_CONTROL_AGENT_PLAN.md — Telegram Control / Report Agent Plan

> **Wording note (2026-06-17, DEC-135):** operator-facing control/report text uses **"tracked Telegram channels /
> список отслеживаемых каналов"**, not "allowlist" (internal config names may stay for compatibility). The control
> agent is a **conversational AI layer** (natural-language → plan/cost/approval → run → report → next actions),
> with slash commands as fallback affordances; it never contains parser/scraping logic.

**Status:** 📐 PLAN — **not built.** No bot token, no webhook, no workflow is authorized by this document.
**Date:** 2026-06-12 · **Decisions:** DEC-067 (Control Bot ≠ source parser), DEC-112 (Claude in report/control
layer), DEC-098 (no auto-outreach).
**Related:** `docs/REPORTING_AND_TELEGRAM_SUMMARY_PLAN.md`, `docs/MARKET_INTELLIGENCE_REPORT_SCHEMA.md`,
`docs/FUTURE_CAPABILITIES_BACKLOG.md` (item 1 — Business Agent Control Kernel), `docs/ROADMAP.md` Stage 4.

---

## 1. Role definition

The Telegram agent is a **control and report interface**. It is explicitly **not a parser**: it never scrapes
Telegram (or anything else), never reads channels/groups/members, never harvests contacts. The Telegram
**source connector** (WF11) is a separate workflow with a separate purpose and — when live mode ever lands —
a separate transport; the **bot token** is a separate credential reserved for this control interface.

What it does:
1. **Creates `agent_requests`** — every operator command becomes a ledger row (`request_type`, `status`),
   so the request history is auditable in Sheets like every other run.
2. **Triggers or reads workflows** — calls existing manual workflows (WF10 run, Report Builder) or reads
   their outputs; it contains no analysis logic of its own.
3. **Returns short summaries + links** — digest in chat, full data in Google Sheets / Markdown reports.
4. **Gates spending** — any action with a non-zero cost estimate shows plan + cost and requires an explicit
   "yes" before execution (same approval spine as the rest of the project).

## 2. Command set (v1 target)

| Command | Action | Cost |
|---------|--------|------|
| `/status` | last runs from `agent_requests` (id, status, result_summary) | $0 |
| `/report` | latest `market_intelligence_reports` digest + links | $0 |
| `/run_wf10` | create `agent_requests` row + trigger WF10 (deterministic) | $0 |
| `/run_report` | trigger Report Builder (deterministic; Claude only if explicitly `/run_report llm`) | $0 / bounded |
| `/run_avito` | **prepare** a WF09 live run request (`status=needs_approval`, cost estimate) — never auto-runs | approval-gated |
| `/help` | list commands | $0 |

Free-text conversational control (intent detection, niche switching, multi-step plans) belongs to the later
**Business Agent Control Kernel** (backlog item 1) — the slash-command bot is its thin transport predecessor.

## 3. Safety rules

- **Operator allowlist:** the bot answers only allowlisted chat IDs; everyone else gets silence.
- Bot token lives **only** in n8n credentials; never in repo files.
- The bot never executes a paid action from a single message — plan + cost + explicit confirmation, recorded
  in `agent_requests` (`approval_required=true`, `approved_by`, `approved_at`).
- No outreach features of any kind (no DM sending to third parties) — DEC-098.
- Claude usage inside the bot (summaries, intent parsing) follows DEC-112: optional, bounded, cost-recorded;
  command parsing starts deterministic (slash commands), not LLM.

## 4. Prerequisites before build

1. Report Builder v1 + `market_intelligence_reports` tab exist (otherwise the bot has nothing to report) —
   🔧 the WF12 deterministic skeleton is built (DEC-118); the tab + operator validation runs are still pending.
2. WF10 validated by operator runs (v0.2 patch tested).
3. Bot token created via BotFather; webhook or polling decision (VPS currently has no public ingress —
   polling or SSH-tunneled webhook decision needed at build time).
4. Explicit operator approval for the build (Stage 4 gate).

## 5. Non-goals

- No parsing/scraping through the bot, ever.
- No public bot, no inline mode, no group installs.
- No autonomous scheduled actions in v1 (manual commands only).
- No CRM features (later stage).
