# DECISIONS.md — Decision Register

Non-obvious architectural and design choices with reasoning.
Most recent first.

---

## DEC-008 — v0.1 Apify Integration: Simple Start + Wait + Fetch

**Date:** 2026-06-04
**Context:** Apify actor runs are asynchronous. A proper polling loop or webhook callback
requires additional n8n nodes and error handling logic — too complex for the first working version.
**Decision:** v0.1 uses a simple three-step pattern: POST to start the actor run → Wait node
(30–60 sec fixed delay) → GET dataset items. If the dataset is empty, the operator waits
and manually re-triggers the fetch node. No automated retry logic in v0.1.
**Future:** v0.2 will implement a polling loop (check run status → loop until SUCCEEDED)
or an Apify webhook that triggers n8n on completion.
**Alternatives considered:** Polling loop in v0.1 (rejected — adds complexity before basic pipeline is proven).

---

## DEC-007 — Public HTTPS/Domain Deferred Until Required

**Date:** 2026-06-04
**Context:** n8n does not need inbound public access for a manual, operator-run pipeline.
Setting up a reverse proxy (nginx/Caddy) and TLS certificate adds setup time and
introduces attack surface before the pipeline even works.
**Decision:** Public HTTPS and a domain name are deferred until they become technically required —
specifically when Apify/Telegram webhooks need to call n8n, or when Google OAuth requires
a verified redirect URI. Until then, all n8n access is via SSH tunnel.
**Alternatives considered:** Set up nginx + Let's Encrypt from day one (rejected — unnecessary for v0.1).

---

## DEC-006 — n8n Accessed via SSH Tunnel in v0.1 (No Public Domain)

**Date:** 2026-06-04
**Context:** The VPS is a production machine. Exposing n8n on a public port without
authentication hardening and HTTPS creates unnecessary security risk for a tool still under development.
**Decision:** n8n UI is accessed exclusively via SSH port forwarding during v0.1:
`ssh -L 5678:localhost:5678 user@vps-ip` → open `http://localhost:5678` locally.
No public port, no domain, no reverse proxy required for MVP.
**Alternatives considered:** Direct public port exposure (rejected — security risk); VPN (deferred as overkill for one operator).

---

## DEC-005 — English for Technical Files

**Date:** 2026-06-04
**Context:** Project files may be reviewed by tools, collaborators, or future agents.
**Decision:** All technical documentation files are written in English.
Russian permitted in informal operator notes only.
**Alternatives considered:** Russian-first (rejected — limits tool compatibility and future sharing).

---

## DEC-004 — Secrets Stay Out of Project Files

**Date:** 2026-06-04
**Context:** Project files will eventually be version-controlled on GitHub.
**Decision:** No real API keys, tokens, or passwords in any project file.
All example/config files use placeholder strings (`YOUR_API_KEY_HERE`).
Credentials live only in n8n's built-in credential manager.
**Alternatives considered:** `.env` files with `.gitignore` (rejected for v0.1 — adds complexity before Git is set up).

---

## DEC-003 — Stack Locked for v0.1

**Date:** 2026-06-04
**Context:** Risk of scope creep before first working pipeline.
**Decision:** v0.1 stack is fixed: n8n + Apify/Firecrawl + Claude API + Google Sheets + Telegram.
No new tools without explicit operator approval.
**Alternatives considered:** Adding Notion, Airtable, or Slack (deferred to later stages).

---

## DEC-002 — Plan-Before-Code Workflow

**Date:** 2026-06-04
**Context:** Operator is iterative and wants control over all changes.
**Decision:** Engineering agent always shows a plan and gets explicit approval before
creating or editing any file. No silent file creation.
**Alternatives considered:** Auto-create files (rejected — removes operator oversight).

---

## DEC-001 — Lightweight Architecture (No External Agent Frameworks)

**Date:** 2026-06-04
**Context:** Operator is learning. External frameworks (LangChain, CrewAI, AutoGen) add
complexity, hide mechanics, and are harder to debug on a VPS.
**Decision:** Custom lightweight structure using only Markdown files and Claude Code.
Agents are roles defined in docs, not running processes or SDK objects.
**Alternatives considered:** LangChain, CrewAI (rejected — too heavy for learning context and VPS resources).
