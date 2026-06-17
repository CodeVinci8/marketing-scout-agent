# STAGE_4_REPORT_AND_CLAUDE_LAYER.md — Stage 4 Definition

**Status:** **DETERMINISTIC WF12 v0.3 REPORT — OPERATOR PASS (2026-06-16, TEST D, with `public_lead_signals`
integration); Claude live summary NOT live-tested (branch gated/disabled).** · **Decisions:** DEC-112, DEC-118, DEC-122, DEC-123, **DEC-128 (v0.3 stakeholder report + budget-gated test-ready Claude branch, 25-col schema)**

> **2026-06-16 update:** after the WF14 retest, the deterministic WF12 report run (TEST D) passed:
> `market_intelligence_reports +1`, `agent_requests +1`, `live_source_runs +1`, `llm_status=disabled`,
> `llm_cost_usd=0`, and the report includes the public lead-signal block (`public_lead_signals: 4 (new: 4)`) —
> it no longer reports the tab as empty. **The Claude summary branch remains disabled and has NOT been run live**
> (own approval + budget guard + credential required). Stage 4 deterministic layer passes; Claude layer stays gated.

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

---

## 2026-06-17 — Stage 4 is now the NEXT ACTIVE STAGE (after the WF11 v0.4.2 acceptance run, DEC-135)

With the Stage 3 Telegram source closure pending only a short acceptance run, **Stage 4 (Claude enrichment +
executive report) becomes the next active stage.** Nothing is built/called yet in this patch — Claude enrichment
is **not** implemented and **must not** be called until its own approval. Stage 4 entry plan, in order:

1. Finish the Stage 3 Telegram acceptance run (≤5 operator tests, WF11 RU doc) so enrichment runs on **clean,
   relevant** rows only — never adjacent/holiday/personal false positives (that is the whole point of DEC-135).
2. **Deterministic WF12 report** stays the default ($0) and is already PASS — no change required.
3. **Then, behind its own gate:** bind the Anthropic credential **in n8n** (never in files), enable the disabled
   Claude HTTP node, run the **budget-gated, evidence-bound** summary on the deterministic report (model
   `claude-opus-4-8` or `claude-sonnet-4-6` per cost/quality), record token/cost in `agent_requests` +
   `COSTS_AND_LIMITS.md`. Selective enrichment scope is below.

## Planned Claude enrichment scope (DEC-133/135 context) — selective, NOT every raw row

Claude enrichment (still **not implemented**, docs only) must be **selective**. Claude does **not** enrich every
raw row. Planned enrichment targets:

- ambiguous WF08 rows (uncertain deterministic classification)
- high-value competitor ads
- unclear `market_signal` rows
- public questions / objections
- рекламные углы / positioning angles
- semantic competitor analysis
- offer decomposition: price, guarantee, CTA, proof, risk reversal, trust signals
- audience pain / intent / objection extraction
- the WF12 executive summary for the руководитель

Claude enrichment must remain: **approval-gated**, **budget-gated**, **cost/token logged**, **no auto-outreach**,
**no uncontrolled repair loops**, and **selected-row only** — never the whole raw dump by default. The post-level
relevance fix (DEC-133) matters here: enrichment runs on **clean, relevant** rows, not channel-level false
positives, so token spend is not wasted on holiday/personal posts.
