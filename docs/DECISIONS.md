# DECISIONS.md — Decision Register

Non-obvious architectural and design choices with reasoning.
Most recent first.

---

## DEC-021 — No Paid Scraping Until Prompt v2 Is Ready and Business Requirements Are Clarified

**Date:** 2026-06-05
**Context:** Milestone Review 02 identified that Marketing Agent Prompt v1 is an extractor/classifier, not a marketing analyst. It also confirmed that the operator's uncle's specific business requirements (which platforms, which outputs, which actions matter) have not been discussed. Starting paid Apify or Firecrawl scraping before these two things are resolved will produce low-value outputs and waste the limited test budget.
**Decision:** Do not start any paid web scraping (Apify, Firecrawl) until BOTH of the following are done:
1. Marketing Agent Prompt v2 is written, tested against synthetic records, and approved by the operator
2. The operator's uncle has confirmed what business outputs and target platforms he actually needs
**Rationale:** The $5 Claude API test budget and unknown Firecrawl/Apify free tier limits are finite. Burning them on v1 prompt + wrong targets is waste. The infrastructure is now proven. The next investment is in prompt and requirements quality.
**Trigger to unblock:** Operator confirms uncle's requirements in writing (even a brief bullet list) AND v2 prompt passes the 5-record synthetic test described in `MARKETING_AGENT_PROMPT_V2_PLAN.md`.
**Alternatives considered:** Proceed with scraping immediately to generate real data for prompt improvement (rejected — real data costs money; synthetic test records are sufficient for prompt iteration).

---

## DEC-020 — Prompt Duplication in v0.1: Embedded + File Source

**Date:** 2026-06-05
**Context:** The active Marketing Scout Agent system prompt exists in two places simultaneously: embedded as a JavaScript string inside the `Build Claude Request` Code node in `02_claude_api_single_record_analysis.json`, and as the canonical source file `modules/marketing-scout-v0/MARKETING_AGENT_PROMPT_V1.md`. These can diverge silently if one is updated without the other.
**Decision:** For v0.1 this duplication is acceptable — it avoids the complexity of runtime prompt loading (from a file, n8n variable, or external service). `MARKETING_AGENT_PROMPT_V1.md` is the **canonical source**. When the prompt changes, both the file and the Code node must be updated in the same session. The Code node text takes precedence at runtime.
**Future:** v0.2+ will move prompt loading to an n8n variable, a static file served locally, or an n8n credential field, so the workflow JSON contains only a reference, not the full text.
**Alternatives considered:** Storing prompt in n8n environment variable (deferred — requires n8n config change and a code node read pattern not yet tested).

---

## DEC-019 — Marketing Scout Agent: Scoring Scale Changed to 1–100

**Date:** 2026-06-05
**Context:** The original SYSTEM_PROMPT.md used a 0–10 scoring scale for quality_score, lead_signal_score, content_idea_score, and competitor_strength. For Workflow 02, the scoring scale was upgraded to 1–100 to provide finer granularity and enable more precise quality gating. The Quality Gate IF node uses threshold >= 60 (equivalent to ~6/10 in the old scale).
**Decision:** All scores in MARKETING_AGENT_PROMPT_V1.md and Workflow 02 use integers 1–100. The old SYSTEM_PROMPT.md retains the 0–10 scale as a legacy draft; MARKETING_AGENT_PROMPT_V1.md is the active prompt for all workflows from v02 onward.
**Quality gate threshold:** quality_score >= 60 passes to Google Sheets; below 60 discarded.
**Alternatives considered:** Keep 0–10 scale (rejected — too coarse for differentiated filtering at scale).

---

## DEC-018 — Claude API Gateway: Auth Format, Model ID, and Response Parsing

**Date:** 2026-06-05
**Context:** The project uses a Claude-compatible API gateway at `https://aiprimetech.io` rather than the official Anthropic endpoint. A compatibility test was run from the VPS to confirm auth format, model ID naming, and response structure.
**Decision:**
- Base URL: `https://aiprimetech.io`, endpoint `/v1/messages`
- Auth: `Authorization: Bearer <token>` (HTTP Header Auth in n8n)
- Working model ID: `claude-sonnet-4-6` (hyphen-dot notation — `claude-sonnet-4.6` with a literal dot returns "No available accounts")
- n8n credential name: `Claude API - Marketing Scout`
- Response parsing: do NOT use `content[0].text` — the response may include a `thinking` block before the text block. Always select the content item where `type == "text"`:
  ```javascript
  const content = $json.content.find(c => c.type === 'text');
  const parsed = JSON.parse(content.text);
  ```
- System prompt must include an explicit instruction to return raw JSON only — no markdown, no code fences. Without this, Claude may wrap output in triple-backtick blocks that break `JSON.parse`.
- API key must remain only in the n8n credential manager — never committed to any project file.
**Alternatives considered:** Official Anthropic endpoint (available as fallback — same auth format, same model IDs).

---

## DEC-017 — Google Sheets Headers: Single Row 1, Horizontal Only

**Date:** 2026-06-04
**Context:** During Workflow 01 testing, the Google Sheet was initially created with field names
entered vertically in column A (rows 1–25) instead of horizontally in row 1 (columns A–Y).
n8n's `autoMapInputData` mode matches fields by column header name in row 1 — it does not read
vertical headers. The rows 2–25 had to be deleted, leaving only the horizontal header row 1.
**Decision:** The Google Sheet `results` must have exactly one header row: row 1, columns A–Y,
with field names matching the output of the Code/Claude node exactly (case-sensitive).
All data rows start at row 2. No vertical layouts, no merged cells in the header.
**How to fix if broken:** Delete rows 2–25 in Google Sheets if they contain field names in column A;
keep only row 1 with horizontal headers.
**Alternatives considered:** Using `defineBelow` column mapping in n8n (deferred — adds maintenance burden when schema changes).

---

## DEC-016 — Google Sheets Integration: Service Account, Not OAuth2

**Date:** 2026-06-04
**Context:** n8n supports two authentication methods for Google Sheets: OAuth2 (browser-based)
and Service Account (key file). OAuth2 requires a browser redirect during credential setup,
which is cumbersome via SSH tunnel. Service Account credentials are created once using a JSON key
file and do not require interactive browser flow.
**Decision:** Use Google Service Account (`googleApi` credential type in n8n) for Google Sheets
in all v0.1 workflows. The service account email must be added as Editor to the target spreadsheet.
**Credential name convention:** `Google Sheets - Marketing Scout Service Account`
**Alternatives considered:** OAuth2 (deferred — requires browser redirect, adds setup friction in SSH-only environment).

---

## DEC-015 — n8n Workflow Delivery via Generated JSON (Confirmed)

**Date:** 2026-06-04
**Context:** Workflow 00 (Healthcheck Manual Test) was generated as a JSON file by Claude Code,
committed to the project repo, and imported into n8n by the operator. The workflow executed
successfully on first import with no manual node editing required.
**Decision:** All future n8n workflows will be delivered as importable JSON files committed
to `n8n/workflows/`. The operator imports via **Workflows → ⋮ → Import from File** or clipboard.
Manual node-by-node construction in the UI is the fallback only if JSON import fails.
**Confirmed path:** Claude Code → `n8n/workflows/*.json` → GitHub → n8n Import → execution.
**Workflow 00 baseline:** `n8n/workflows/00_healthcheck_manual_test.json` must not be modified —
it serves as the healthcheck reference to verify the platform is functioning.
**Alternatives considered:** Manual UI construction (retained as fallback); n8n API push (deferred — requires additional credentials).

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
