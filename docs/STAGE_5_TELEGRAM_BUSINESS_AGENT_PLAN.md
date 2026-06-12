# STAGE_5_TELEGRAM_BUSINESS_AGENT_PLAN.md — Stage 5 Definition

**Status:** PLANNED (2026-06-12) · **Decisions:** DEC-067 (control interface ≠ parser), DEC-112, DEC-123
**Related:** `TELEGRAM_CONTROL_AGENT_PLAN.md`, `REPORTING_AND_TELEGRAM_SUMMARY_PLAN.md`,
`FUTURE_CAPABILITIES_BACKLOG.md` §1 (Business Agent Control Kernel)

## 1. What Stage 5 is

The **Telegram Business Agent** is the operator/stakeholder control surface over the Stage 3–4 pipeline.
Hard rule: **no parser logic lives inside Telegram**. The bot translates commands into `agent_requests`
rows and triggers existing workflows; all collection/analysis stays in WF09/11/13 → WF08 → WF10 → WF12.

```
Telegram command → command parser → agent_requests row (+ approval gate)
  → workflow selection (WF09 / WF11 / WF13 / WF08 / WF10 / WF12)
  → run → result_summary + report delivery back to Telegram (links to Sheets / reports)
```

## 2. Command set (v1 target)

| Command | Effect | Gate |
|---|---|---|
| `/status` | last runs from `agent_requests` (result_summary lines) | read-only |
| `/report` | latest `market_intelligence_reports` row → digest + Sheets link | read-only |
| `/scan <source>` | create an `agent_requests` row for WF09/WF11/WF13 | **approval required for live/paid** |
| `/analyze <request_id>` | WF08 handoff config for one connector run (llm_enabled stays false) | approval |
| `/aggregate` | WF10 run request | approval |
| `/build_report` | WF12 run request (deterministic; Claude summary = separate approval) | approval |
| `/approve <id>` / `/reject <id>` | flip `approval_status` on a pending request | operator-only |
| `/costs` | month-to-date spend from agent_requests cost fields | read-only |

Future: `/niche <pack>` — niche selection once the Niche Pack System (DEC-100) exists.

Session-4 note (2026-06-12): the command surface stays `commands → agent_requests → workflow selection →
report delivery`, now over the expanded roster — `/scan` covers WF09 (live), WF11 (Telegram live-ready),
WF13 (VK live-ready); new candidates `/triage` (WF14) and `/runs` (live_source_runs digest) join v1.1;
`/report` delivers the WF12 v0.3 stakeholder digest (executive digest bullets render directly).

## 3. Approval gates

- Every command that can spend money or touch a live source creates a **pending** `agent_requests` row
  (`approval_required=true`); nothing runs until `/approve`.
- Claude summary and live connector transports keep their own in-workflow gates (tokens + disabled
  HTTP nodes) — Telegram approval does not bypass them; it is a second, outer gate.
- Operator allowlist by Telegram user id; everyone else read-only at most.

## 4. Delivery

- Report delivery = WF12 output (`report_type`, top lists, source_mix, link to the Sheets row/tab).
- Digest format per `REPORTING_AND_TELEGRAM_SUMMARY_PLAN.md`; `delivered_to` recorded on the report row.
- No contacts in any Telegram message (CONTACT_AND_OUTREACH_POLICY).

## 5. Build order (after Stage 4 exit)

1. Read-only bot: `/status`, `/report`, `/costs` (no state changes — safest first slice).
2. Request-creation commands with approval gates (`/scan`, `/analyze`, `/aggregate`, `/build_report`).
3. Workflow triggering (n8n webhook/manual bridge) — each trigger path needs operator approval.
4. Niche selection + Control Kernel features (backlog §1) — only after 1–3 are proven.

## 6. Non-goals

No scraping inside the bot · no MTProto/user sessions (Bot API only) · no auto-outreach ·
no anonymous control · no Claude calls from the bot itself (Claude runs only inside gated WF12 branch).
