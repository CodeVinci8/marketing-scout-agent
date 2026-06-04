# Hot Memory — Recent Sessions

Most recent first. Keep last 3 sessions max. Archive older entries to `core/warm/decisions.md`.

---

## Session: 2026-06-05 — Documentation consistency fixes

**What was done:**
- Fixed 6 issues in `WORKFLOW_DESIGN.md`: gateway URL, auth format, prompt reference, parse pattern, threshold scale, Google Sheets auth
- Rewrote `TABLE_SCHEMA.md`: 12 type/value corrections — scoring scale 1–100, integer scores, updated entity/status/service enums
- Updated `PROMPTS.md`: MARKETING_AGENT_PROMPT_V1.md is now the active prompt; SYSTEM_PROMPT.md marked superseded
- Created `docs/AGENT_CAPABILITIES.md`: v1 capabilities, limitations, v2 requirements, risks, client explanation
- Restructured `NEXT_ACTIONS.md` into Steps A–E with explicit gates

**Remaining doc fixes (minor):** README.md current stage, tools/TOOLS.md auth note, core/warm/decisions.md DEC-018–021

**What is next (in order):**
- Step A: consult uncle (zero cost — shapes ICP for Prompt v2)
- Step B: finish remaining doc fixes (minor)
- Step C: write MARKETING_AGENT_PROMPT_V2.md
- Step D: test v2 on 5 synthetic records (~$0.10)
- Step E: only then Workflow 03 Firecrawl

---

## Session: 2026-06-05 (latest)

**What was done:**
- Milestone Review 02 completed — full audit of all project files
- Found: prompt v1 is extractor/classifier, not marketing analyst; 12 doc consistency issues; 7 risks before scraping
- Created `docs/MILESTONE_REVIEW_02.md` — comprehensive review with security checklist and 5 recommended actions
- Created `modules/marketing-scout-v0/MARKETING_AGENT_PROMPT_V2_PLAN.md` — 15-section plan for stronger agent prompt
- Added DEC-021: no paid scraping until Prompt v2 ready and uncle consulted
- Restructured NEXT_ACTIONS into 3 pre-steps before Workflow 03

**Baselines locked:**
- Workflow 00 / 01 / 02 — do not modify these files

**What is next (in order):**
1. **Step A:** Ask uncle — primary use case, target platforms, region, product types, what "useful output" means
2. **Step B:** Write MARKETING_AGENT_PROMPT_V2.md based on plan; test against 5 synthetic records; get approval
3. **Step C:** Fix 12 doc consistency issues (WORKFLOW_DESIGN.md, TABLE_SCHEMA.md, README.md, etc.)
4. Only then: Workflow 03 — Firecrawl

**Decisions since last hot memory update:** DEC-019, DEC-020, DEC-021

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
