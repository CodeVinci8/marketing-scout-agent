# Hot Memory — Recent Sessions

Most recent first. Keep last 3 sessions max. Archive older entries to `core/warm/decisions.md`.

---

## Session: 2026-06-04

**What was done:**
- Reviewed Claude Code agent architecture course concepts (identity files, rules, hot/warm/cold memory, plan-before-code, decision logs, safety boundaries)
- Designed lightweight project-agent structure for Marketing Scout — no external frameworks
- Created full directory structure: `core/`, `docs/`, `modules/marketing-scout-v0/`, `tools/`, `n8n/`, `scripts/`, `backups/`
- Wrote all foundation documents: `CLAUDE.md`, `README.md`, `core/AGENTS.md`, `core/USER.md`, `core/rules.md`, `core/MEMORY.md`, `tools/TOOLS.md`, all `docs/` files, all `modules/marketing-scout-v0/` files

**What was decided:**
- Markdown-first, lightweight architecture — no heavy agent SDKs
- Plan-before-code workflow: always show plan, get approval, then create files
- Five future agents defined but not implemented: project-engineer, marketing-scout, workflow-designer, data-analyst, prompt-engineer
- Stack locked for v0.1: n8n + Apify/Firecrawl + Claude API + Google Sheets + Telegram

**What is next:**
- Review all created files and refine content if needed
- Begin actual n8n workflow design in detail
- Draft the first real system prompt version for Claude API analysis node
- Set up n8n on VPS and configure first workflow nodes
