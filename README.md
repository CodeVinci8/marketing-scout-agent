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

**Stage C Hardening — BUILT (offline-validated, pending operator runtime retest).**
16 live-capable workflows (WF00–WF16). WF16 (Source Quality Gate) gates report generation;
WF08 runs an `llm_primary` semantic-v2 contract; a shared semantic engine + canonical taxonomy
(`config/taxonomy.json`, `n8n/lib/`) replace ad-hoc keyword logic.

See `docs/STAGE_C_HARDENING_IMPLEMENTATION.md`, `docs/SOURCE_QUALITY_GATE.md`,
`docs/SEMANTIC_TAXONOMY.md`, and `docs/ROADMAP.md`.

## Testing (offline, $0, no paid APIs)

```bash
make test            # full regression: JS suites + workflow validator + lead-scout harness
# or:
node tests/run_all.js
python3 scripts/validate_workflows.py
```

All Claude/Apify/Firecrawl/VK calls are **gated and off by default**. The regression performs
**zero external calls and incurs $0**. See `docs/STAGE_C_HARDENING_TEST_RESULTS.md`.

## Operator

Nik — see `core/USER.md`.
