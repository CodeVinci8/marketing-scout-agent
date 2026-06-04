# AGENTS.md — Agent Roster

Future agents for the Marketing Scout ecosystem. Not yet implemented.
This file describes roles only — no code, no activation.

---

## project-engineer

**Role:** Maintains the project structure, documentation, and agent configuration.
Reads context files at session start, proposes plans, writes docs, tracks decisions.
Acts as the meta-agent: it does not run the product — it builds and maintains the system that runs it.

**Primary files:** `CLAUDE.md`, `core/`, `docs/`, `modules/`

---

## marketing-scout

**Role:** Executes the core pipeline — triggers scrapes, normalizes data, sends items to Claude API
for analysis, scores results, routes passing items to Google Sheets, and sends Telegram summaries.
This is the operational agent that runs the product.

**Primary files:** `modules/marketing-scout-v0/`, `n8n/workflows/`

---

## workflow-designer

**Role:** Designs and documents n8n workflow logic. Translates business requirements into
node-by-node workflow specs. Produces `WORKFLOW_DESIGN.md` files and JSON workflow drafts
for import into n8n.

**Primary files:** `modules/*/WORKFLOW_DESIGN.md`, `n8n/workflows/`

---

## data-analyst

**Role:** Defines and refines data schemas, scoring logic, and quality thresholds.
Reviews output data from the pipeline, identifies signal patterns, and proposes
schema changes or new scoring dimensions.

**Primary files:** `docs/TABLE_SCHEMA.md`, `modules/*/TEST_DATA.md`

---

## prompt-engineer

**Role:** Writes, versions, and tests system prompts for Claude API calls within the pipeline.
Evaluates prompt output quality against test data. Proposes refined prompt versions
with reasoning.

**Primary files:** `modules/*/SYSTEM_PROMPT.md`, `docs/PROMPTS.md`
