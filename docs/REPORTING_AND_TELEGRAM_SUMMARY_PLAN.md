# REPORTING_AND_TELEGRAM_SUMMARY_PLAN.md — Report / Claude / Telegram Layer Plan

**Status:** 🔧 PLAN + **Report Builder v0.3 DETERMINISTIC — OPERATOR PASS (2026-06-16, TEST D):**
`n8n/workflows/12_market_intelligence_report_builder.json` (`active=false`, deterministic, $0 — no Claude,
no Telegram send; Claude HTTP node DISABLED; guide: `docs/N8N_WORKFLOW_12_MARKET_INTELLIGENCE_REPORT_BUILDER_RU.md`).
No Telegram bot, no Claude report call, no schedule is authorized by this document.

> **2026-06-16 (TEST D):** WF12 v0.3 deterministic report now **passes with the `public_lead_signals` block**
> — after the WF14 retest the report includes `public_lead_signals: 4 (new: 4)` and no longer says the lead
> tab is empty; `market_intelligence_reports +1`, `live_source_runs +1`, `llm_status=disabled`, `llm_cost_usd=0`.
> The Claude summary + Telegram delivery remain **planned/gated** (own approval each); nothing live is authorized here.
**Date:** 2026-06-12 · **Decisions:** DEC-112 (Claude belongs in the report/control layer, not the
deterministic fact core), DEC-113 (MVP = market intelligence foundation, not Avito-only output),
DEC-118 (WF12 deterministic skeleton).
**Related:** `docs/MARKET_INTELLIGENCE_REPORT_SCHEMA.md`, `docs/TELEGRAM_CONTROL_AGENT_PLAN.md`,
`docs/WF10_TABLE_SCHEMAS.md`, `docs/FUTURE_CAPABILITIES_BACKLOG.md` (items 1/4), `docs/CONTACT_AND_OUTREACH_POLICY.md`.

---

## 1. Architecture principle (DEC-112)

**WF10 is the deterministic fact core. Claude does not belong inside it by default.**

- The fact core (connectors → WF08 → WF10) must stay reproducible, auditable, and $0: the same inputs always
  produce the same competitor profiles, angles, and counts. Putting an LLM inside the aggregation would make
  the facts non-reproducible and add cost to every run.
- Claude belongs **above** the fact core, in the report/control layer: it reads finished deterministic tables
  and explains them. If a Claude summary is wrong, the facts underneath are still intact and re-summarizable.
- WF08 keeps its existing, separately-approved compact enrichment (DEC-089) — that is per-record analysis,
  not aggregation, and stays opt-in.

## 2. Target flow

```
WF10 output tabs (competitor_profiles / market_angles / audience_activity_signals /
                  content_positioning_plan / source_confidence_rules)
  → Report Builder (deterministic: select latest run, compute deltas vs previous run, render Markdown)
  → optional Claude summary (DISABLED by default; operator enables per run)
  → market_intelligence_reports tab (one row per report — schema: MARKET_INTELLIGENCE_REPORT_SCHEMA.md)
  → Telegram summary (short digest + links to Sheets/report)
  → later: Business Agent Control Kernel (conversational layer over the same tabs/requests)
```

The Report Builder is **deterministic v1** (Markdown from the latest WF10 snapshot + trend vs the previous
run by angle key / competitor_id). It works with Claude disabled — the report is then purely factual.

## 3. Claude's role in the report layer

| Claude DOES | Claude does NOT |
|---|---|
| summarize the deterministic facts (top competitors, angles, trends) | invent facts, numbers, competitors, or trends not present in the tabs |
| explain what matters and why (stakeholder-friendly language, RU) | invent or surface contacts (CONTACT_AND_OUTREACH_POLICY binding) |
| produce the `llm_summary` / `llm_recommendations` fields of the report | recommend outreach (DEC-098) |
| suggest next analytical actions (e.g. "broaden source scope", "watch angle X") | trigger workflows or spend money |
| flag data-quality caveats (e.g. `source_mix`, `no_data` runs) | run on a schedule or without per-run operator enablement |

Hard rules: `enable_llm_summary=false` by default; the prompt receives **only** WF10 table rows + run stats
(never raw contact fields); output is stored next to — never instead of — the deterministic sections; every
report carries the `source_mix` label from WF10 (`mixed: live + historical/manual + web pipeline`) so a
summary never implies all data was freshly collected.

## 4. Telegram's role

Telegram is a **control/report interface — not a parser** (Control Bot ≠ Telegram source connector, DEC-067;
WF11 is the parser-side and shares nothing with the bot):

1. **Report delivery:** short digest (counts, top-3 competitors, top-3 angles, plan headline) + links to the
   Google Sheet / report row. Long content stays in Sheets/Markdown; Telegram gets the summary.
2. **Control:** operator commands create `agent_requests` rows (`request_type`, `status=pending`), show
   plan + cost estimate, require approval for anything paid, then trigger or read existing workflows.
3. **Never:** scraping, parsing, contact harvesting, outreach, autonomous spending.

Details: `docs/TELEGRAM_CONTROL_AGENT_PLAN.md`.

## 5. Build order (each step gated on operator approval)

1. **Report Builder v1 (deterministic, $0):** 🔧 **skeleton built (WF12, DEC-118)** — reads the 4 WF10 tabs →
   latest run by `plan_id` stamp → angle trends vs the previous run (↑/↓/=/NEW) → Markdown (inline in `notes`
   v0.1) → appends one `market_intelligence_reports` row + one `agent_requests` row. The Claude branch is a
   guard node (throws if `enable_llm_summary=true`); `telegram_send` not implemented. Operator must create the
   `market_intelligence_reports` tab (20 cols) before the first run. Needs ≥2 WF10 runs for trends.
2. **Telegram delivery v1:** send the digest of an existing report row to the operator chat (bot token in n8n
   credentials only; manual trigger).
3. **Optional Claude summary:** `enable_llm_summary=true` per run; bounded prompt + token cap; cost recorded
   in `COSTS_AND_LIMITS.md`.
4. **Control commands** (`/report`, `/run_wf10`, `/status`) writing `agent_requests` — read-only + $0 actions
   first; paid actions always behind approval.
5. **Business Agent Control Kernel** (backlog item 1) — conversational layer; out of scope here.

## 6. Non-goals

- No scheduled reports until manual reports are validated.
- No public bot; operator chat-id allowlist only.
- No report distribution outside the operator/stakeholder.
- No LLM inside WF10/WF08 routing (WF08 enrichment stays as separately approved).

---

## Addendum (2026-06-12, DEC-128)

WF12 v0.3 implements the report side of this plan: 25-col `market_intelligence_reports` row, executive
digest bullets (ready for direct Telegram digest rendering in Stage 5), и controlled Claude summary path
(approval token + budget guard + JSON sections + quality flags + cost recording). Telegram delivery itself
remains Stage 5 (`delivered_to=none` until then).
