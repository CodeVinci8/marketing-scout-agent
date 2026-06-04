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
| `n8n/`                        | n8n workflow exports (JSON)                  |
| `scripts/`                    | Example shell scripts (not executable)       |
| `backups/`                    | Backup metadata and restore notes            |

## Current Stage

**v0.1 — Manual Pipeline** (in design)

See `docs/ROADMAP.md` for full stage plan.

## Operator

Nik — see `core/USER.md`.
