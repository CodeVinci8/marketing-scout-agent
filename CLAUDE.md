# CLAUDE.md — Vinci AI Pilot Project Agent

## Project Purpose

Vinci AI Pilot is an AI-powered automation ecosystem that monitors competitor activity,
extracts lead signals, and generates content ideas from public web sources.
It runs on a VPS, orchestrated by n8n, and uses Claude API as its analytical brain.

## Current Module

**Vinci AI Pilot v0.1** — Manual-triggered pipeline:
scrape → normalize → analyze → score → store → notify.

## Target Stack

| Layer         | Tool                        |
|---------------|-----------------------------|
| Orchestration | n8n (self-hosted)           |
| Scraping      | Apify, Firecrawl            |
| Analysis      | Claude API (claude-sonnet)  |
| Storage       | Google Sheets               |
| Notification  | Telegram Bot                |
| Infrastructure| VPS Ubuntu 24.04            |

## How to Read Context Files

Read in this order at the start of each session:

1. `core/hot/recent.md` — what happened last session
2. `core/warm/decisions.md` — key decisions made so far
3. `core/rules.md` — what is allowed and forbidden
4. `docs/PROJECT_BRIEF.md` — business goal and MVP definition
5. `docs/ROADMAP.md` — current stage and next stages
6. `docs/ARCHITECTURE.md` — system design
7. `docs/NEXT_ACTIONS.md` — immediate next steps

## Operating Rules

- Read project files before proposing any action.
- For Markdown documentation inside this project directory, you may create and edit files autonomously.
  For scripts, configs, Docker files, workflow exports, secrets, system commands, external API calls,
  deployment, deletion, or anything outside this project directory, ask for explicit approval first.
- After editing, report all changed files.
- Propose shell commands; do not run system-level commands without explicit confirmation.
- Keep responses practical and direct. No unnecessary filler.
- Default to Markdown for all documentation.
- Use English for all technical files; Russian is allowed in user-facing notes if the operator prefers.

## Safety Rules

- Never run: `apt`, `docker`, `systemctl`, `ufw`, `iptables`, or any firewall command.
- Never delete files without explicit confirmation.
- Never edit paths outside `/opt/marketing-scout-agent`.
- Never use real API keys, secrets, or credentials in any file.
- Never deploy to production without explicit operator approval.
- Never spend money (API calls, cloud resources) without confirmation.
- **External API calls:** During documentation and design sessions, do not call real external APIs.
  During implementation sessions, external API calls (Apify, Claude API, Telegram, Google Sheets, Firecrawl)
  are allowed only after explicit operator approval and only for the specific service and action approved.
  Each new service or action requires its own approval — prior approval for one does not extend to others.

## Reporting Rules

- After each session, summarize: what was done, what was decided, what is next.
- Always state which files were created or changed.
- If uncertain about scope, ask before acting.

## Forbidden Without Explicit Confirmation

- Running any shell command that affects the system.
- Creating files outside this project directory.
- Modifying real scripts, real n8n workflow exports, or real backups. Example/template files may be edited autonomously.
- Changing any configuration that affects running services.
- Calling real external APIs or using real credentials.

## Autonomy Levels

### Green Zone — autonomous
- Reading project files
- Editing Markdown documentation inside the project
- Updating `docs/AGENT_LOG.md`
- Updating `docs/NEXT_ACTIONS.md`
- Updating `docs/DECISIONS.md`
- Editing example files such as `.example` templates

### Yellow Zone — ask before action
- Creating or editing scripts
- Creating `docker-compose.yml`
- Editing n8n workflow exports
- Preparing commands that affect the server
- Preparing files that will later contain secrets

### Red Zone — explicit approval required
- Running `apt`, `docker`, `systemctl`, `ufw`, `iptables`
- Deleting files
- Editing outside `/opt/marketing-scout-agent`
- Calling paid APIs
- Using real credentials
- Public deployment
- Changing firewall or network settings

## When to Update AGENT_LOG.md

Update `docs/AGENT_LOG.md` after every session that produces a tangible output:
new file, design decision, workflow draft, prompt version, or data schema change.

## When to Update DECISIONS.md

Update `docs/DECISIONS.md` when a non-obvious architectural or design choice is made
and the reasoning should be preserved for future sessions.

## When to Update core/hot/recent.md

Update after every session. This is the single most important file for continuity.
It should reflect the last 1–3 sessions in bullet form: what was done, what changed, what is next.

## When to Update core/warm/decisions.md

Update when a decision is stable enough to survive multiple sessions.
Warm memory is a curated subset of DECISIONS.md — only the choices that still actively shape behavior.
