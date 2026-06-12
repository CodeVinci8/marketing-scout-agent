# STAGE_4_REPORT_AND_CLAUDE_LAYER.md — Stage 4 Definition

**Status:** PREPARED (2026-06-12, session 4: WF12 v0.3 built) · **Decisions:** DEC-112, DEC-118, DEC-122, DEC-123, **DEC-128 (v0.3 stakeholder report + budget-gated test-ready Claude branch, 25-col schema)**

## 1. What Stage 4 is

Stage 4 turns the deterministic WF10 fact core into **stakeholder-ready output**:

```
WF10 tabs (competitor_profiles / market_angles / audience_activity_signals / content_positioning_plan)
  → WF12 Report Builder (deterministic, $0 by default)
  → market_intelligence_reports (20 cols) + agent_requests
  → [optional, gated] Claude business-interpretation summary (cost-tracked)
  → [Stage 5] Telegram delivery
```

**Division of labor (DEC-112):** WF10 stays the deterministic fact core — every number and name in a
report is traceable to WF10 rows. Claude is the **business interpretation brain** on top: it summarizes
and interprets the deterministic report, never collects, never invents, never sees raw contact fields.

## 2. WF12 v0.2 (built — DEC-122)

Deterministic report sections (all derived from WF10 rows only):
`executive_summary` · `competitor_snapshot` · `top_offers_and_prices` · `market_angles_summary`
(with ↑/↓/=/NEW trends vs the previous WF10 run) · `audience_signals_summary` (aggregate-only) ·
`content_plan` · `source_confidence` (avg/min/max of source_confidence_score + rules reference) ·
`limitations/source_mix` (mandatory DEC-108 label) · `next_actions`. `no_data` WF10 runs produce a
clearly marked `no_data_notice` report. No invented facts, no contacts, no outreach recommendations.

**Claude branch (disabled by default):**
- `enable_llm_summary=false` + `llm_approval_token=''` → approval gate **throws**.
- Arming requires ALL of: explicit operator approval (`llm_approval_token=I_APPROVE_CLAUDE_REPORT_SUMMARY`),
  an Anthropic credential bound **in n8n** (never in the file), and enabling the **disabled** HTTP
  placeholder node (model `claude-sonnet-4-6`, project stack).
- Prompt is **evidence-bound**: only the deterministic report fields (JSON, capped), with hard rules —
  no invented facts/competitors/numbers/trends, no contacts, no outreach, "say so if data is thin".
- **Cost tracking**: usage tokens × $3/MTok input + $15/MTok output → `llm_cost_usd` on the report row,
  token counts in `notes`; record in `agent_requests` and `COSTS_AND_LIMITS.md`.
- The merge node throws if no API response arrives (disabled HTTP) — a fabricated summary is impossible.

## 3. Stage 4 backlog (not yet built)

- Report quality checks: golden-report fixtures, section completeness assertions, trend sanity checks.
- Report file output (markdown file / Sheets tab `report_markdown_path`) instead of inline `notes`.
- Weekly digest mode (`report_type=weekly_digest`) on a schedule — only after manual runs are proven.
- Claude recommendations field (`llm_recommendations`) with its own evidence-bound prompt.
- Cost budget guard: refuse the Claude branch if month-to-date LLM spend exceeds the cap in
  `COSTS_AND_LIMITS.md`.

## 4. Exit criteria

1. Operator runs WF12 v0.2 deterministically against ≥2 WF10 runs → report row with trends, $0.
2. `no_data` and guard tests PASS (`enable_llm_summary=true` without token → error).
3. First approved Claude summary run: cost recorded, summary contains no facts absent from the report.
4. Report judged useful by the stakeholder (readability check) — then Stage 5 delivery.

## 5. WF12 v0.3 (built 2026-06-12, DEC-128)

Stage 4 now contains two concrete deliverables:
1. **Deterministic report v0.3 ($0 default):** executive digest (5–7 bullets), clean competitor names
   (no `(unnamed)` — `<Platform> offer: <short offer>` fallback), shortened offers, competitor-website
   block (`competitor_site_snapshots`), public lead/audience signal block (aggregates from
   `public_lead_signals` + `audience_activity_signals`), manager/content/source action blocks,
   limitations + mandatory source_mix. Schema = 25 columns (MARKET_INTELLIGENCE_REPORT_SCHEMA.md v0.3).
2. **Controlled Claude summary test path:** approval token + **budget guard before the HTTP node**
   (`llm_max_input_chars`, `llm_max_estimated_cost_usd`) + evidence-bound JSON prompt (six required RU
   sections) + disabled HTTP placeholder (credential bound in n8n only) + merge with usage-based cost and
   quality flags. Operator test steps in N8N_WORKFLOW_12 RU doc §v0.3. Every run logs to `live_source_runs`.
