# Marketing Scout — Project Root

AI-powered marketing intelligence automation running on a self-hosted VPS stack.

## What This Is

Marketing Scout monitors public web sources — competitor sites, classifieds, social media —
extracts lead signals and content ideas, scores them with Claude API, stores results in
Google Sheets, and delivers a Telegram summary.

## Quick Orientation

| File / Directory              | Purpose                                      |
|-------------------------------|----------------------------------------------|
| `CLAUDE.md`                   | Agent instruction file — read first          |
| `core/`                       | Identity, rules, memory                      |
| `docs/`                       | Project briefs, architecture, logs           |
| `modules/marketing-scout-v0/` | Active module: workflow, prompt, test data   |
| `tools/TOOLS.md`              | Stack inventory                              |
| `n8n/`                        | n8n workflow exports (JSON) + `n8n/lib/` shared engine |
| `config/taxonomy.json`        | Canonical semantic taxonomy (single source of truth) |
| `scripts/`                    | Example shell scripts + `validate_workflows.py` |
| `tests/`                      | Offline regression harness ($0, no network)  |
| `backups/`                    | Backup metadata and restore notes            |

## Current Stage

**Stage 4 — Single-User Telegram Agent MVP (BUILT, offline-validated).**
A Telegram request flows through one operator-facing agent: plan → human approval → website collection →
WF16 quality gate → WF08 analysis → WF10 aggregation → WF12 report → Telegram delivery, with a durable
14-state machine and a single fail-closed approval/budget gate for every paid call. Four new workflows
(WF17–WF20) wrap the existing Stage 1–3 pipeline; seven contract libraries (`n8n/lib/agent_*`,
`request_planner`, `approval_gate`, `source_adapter`, `telegram_io`, `execution_summary`) hold the logic and
are embedded byte-identically into the workflow Code nodes (drift-tested).

A **conversational layer** (DEC-151/152) then turned the button-driven bot into a real natural-language agent:
free-text intent routing, bounded multi-layer memory, conversational source management (WF18 ext + WF22), and a
context-aware deep-competitor-analysis mode that separates evidence-backed facts from recommendations (WF21 +
WF20 reuse). See [`docs/CONVERSATIONAL_AGENT.md`](docs/CONVERSATIONAL_AGENT.md).

**Read first:** [`docs/CONVERSATIONAL_AGENT.md`](docs/CONVERSATIONAL_AGENT.md) (conversation + memory + deep
analysis), [`docs/STAGE_4_AGENT.md`](docs/STAGE_4_AGENT.md) (architecture + Mermaid + user flow + setup),
[`docs/SHEETS_MIGRATION_STAGE_4.md`](docs/SHEETS_MIGRATION_STAGE_4.md) (exact tabs/headers),
`scripts/deploy_n8n.sh` (inactive-by-default import).

**Prior stage — Stage C Hardening + Closure (BUILT).** 16 live-capable workflows (WF00–WF16). WF16 (Source
Quality Gate) gates report generation; WF08 runs an `llm_primary` semantic-v2 contract; a shared semantic
engine + canonical taxonomy (`config/taxonomy.json`, `n8n/lib/`) replace ad-hoc keyword logic. Stage C Closure
wired WF16/`source_health` enforcement into WF10 + WF12 (shared `n8n/lib/report_gate.js`) and closed the
remaining source-workflow defects (WF04–WF09, WF14). See `docs/STAGE_C_HARDENING_IMPLEMENTATION.md`,
`docs/STAGE_C_CLOSURE_PATCH_2.md`, `docs/SOURCE_QUALITY_GATE.md`, `docs/SEMANTIC_TAXONOMY.md`, `docs/ROADMAP.md`.

## Testing (offline, $0, no paid APIs)

```bash
make test            # full regression: JS suites + workflow validator + lead-scout harness
# or:
node tests/run_all.js
python3 scripts/validate_workflows.py
```

All Claude/Apify/Firecrawl/VK calls are **gated and off by default**. The regression performs
**zero external calls and incurs $0**. CI (`.github/workflows/regression.yml`) runs the same `make test` on
every pull request and on pushes to `main`, with no repository secrets. See
`docs/STAGE_C_HARDENING_TEST_RESULTS.md`.

## Operator

Nik — see `core/USER.md`.
