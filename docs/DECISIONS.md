# DECISIONS.md — Decision Register

Non-obvious architectural and design choices with reasoning.
Most recent first.

---

## DEC-014 — Execution Pruning Enabled at Launch

**Date:** 2026-06-04
**Context:** VPS disk is tight (~1.4G free, 86% used after n8n launch). n8n stores execution
history in its SQLite database by default, which grows unboundedly.
**Decision:** Execution pruning configured in `n8n.env` at deployment time:
`EXECUTIONS_DATA_PRUNE=true`, `EXECUTIONS_DATA_MAX_AGE=168` (7 days), `EXECUTIONS_DATA_PRUNE_MAX_COUNT=1000`.
This caps history to the last 7 days or 1000 executions, whichever is hit first.
**Alternatives considered:** Disable pruning and rely on manual cleanup (rejected — too easy to forget on a constrained disk).

---

## DEC-013 — VPS Disk Constraint Acknowledged; Upgrade Deferred

**Date:** 2026-06-04
**Context:** After n8n launch, VPS disk is at ~86% used with ~1.4G free.
This is sufficient for MVP (no high-volume scraping yet), but leaves little headroom.
**Decision:** Proceed with current VPS for v0.1 MVP. Plan a disk upgrade or VPS tier change
before running high-volume Apify scrape jobs or accumulating significant execution history.
Do not run large scrapes without checking free disk first.
**Trigger for upgrade:** Disk usage exceeds 90%, or before any run expected to produce >500 items.
**Alternatives considered:** Immediate upgrade (deferred — no pressing need before first workflow test).

---

## DEC-012 — Real Credentials Stay Outside Git

**Date:** 2026-06-04
**Context:** n8n requires an encryption key and may later hold API tokens via env file.
**Decision:** `n8n.env` and any `docker-compose.yml` containing real values are never committed
to Git. Only `.example` template files are versioned. The encryption key is generated once on
the VPS and stored only in the live `n8n.env` file outside the project directory.
**Alternatives considered:** `.env` in repo with `.gitignore` (rejected — risk of accidental commit).

---

## DEC-011 — No Public Domain or HTTPS for v0.1

**Date:** 2026-06-04
**Context:** v0.1 is a manual, operator-only pipeline. Public access is not required.
Setting up a reverse proxy and TLS certificate adds setup time before the pipeline is proven.
**Decision:** n8n has no public domain or HTTPS in v0.1. All access is via SSH tunnel.
Public HTTPS will be added when a specific technical requirement arises: Apify/Telegram webhooks,
Google OAuth redirect URI, or remote monitoring.
**Alternatives considered:** Caddy with auto-TLS from day one (rejected — unnecessary complexity for v0.1).

---

## DEC-010 — n8n Bound to localhost, Accessed via SSH Tunnel

**Date:** 2026-06-04
**Context:** n8n must not be exposed to the public internet in v0.1. The operator is the only user.
**Decision:** n8n is bound to `127.0.0.1:5678` in the Docker Compose port mapping.
Access is via SSH tunnel: `ssh -L 5678:127.0.0.1:5678 root@SERVER_IP`.
This eliminates the need for firewall rules, TLS, or authentication hardening for v0.1.
**Alternatives considered:** Bind to `0.0.0.0:5678` with firewall rule (rejected — accidental exposure risk if firewall misconfigured).

---

## DEC-009 — Docker Compose Installed Manually (Not via apt)

**Date:** 2026-06-04
**Context:** `apt install docker-compose-plugin` failed — package not found on this VPS.
Docker Engine (v29.1.3) was already present with 3 running containers and 39 images.
**Decision:** Docker Compose v5.1.2 was installed manually as a CLI plugin:
`/usr/local/lib/docker/cli-plugins/docker-compose`
Used as `docker compose` (plugin syntax).
**Impact:** On any server migration, rebuild, or fresh OS install, Docker Compose must be
reinstalled manually from the official Docker GitHub releases page. It will not be present
after a standard apt Docker install.
**Safety note:** Do not run `docker system prune` or destructive Docker cleanup without
explicit operator approval — existing containers are actively running.
**Alternatives considered:** `docker-compose` standalone binary (rejected — plugin syntax preferred; standalone is deprecated).

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
