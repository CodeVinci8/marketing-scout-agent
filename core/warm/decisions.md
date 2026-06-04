# Warm Decisions — Stable Design Choices

Decisions that have survived at least one session and actively shape current behavior.
Curated subset of `docs/DECISIONS.md`.

---

## DEC-001 — Lightweight Architecture

**Decision:** Build a custom lightweight agent structure using only Markdown files and Claude Code.
Do not adopt external agent frameworks (LangChain, AutoGen, CrewAI, etc.).

**Reason:** Operator is learning. External frameworks add complexity, hide mechanics,
and are harder to debug on a VPS with limited resources.

**Impact:** All architecture is file-based. Agents are roles, not running processes.

---

## DEC-002 — Plan-Before-Code Workflow

**Decision:** The engineering agent must always show a plan and get explicit approval
before creating or editing any file.

**Reason:** Operator is iterative and hands-on. Surprises are unwanted. Approval gates
keep the operator in control and build trust in the agent's behavior.

**Impact:** Every action starts with a plan message. No silent file creation.

---

## DEC-003 — Stack Locked for v0.1

**Decision:** The v0.1 stack is fixed: n8n + Apify/Firecrawl + Claude API + Google Sheets + Telegram Bot.
No new tools without explicit operator approval.

**Reason:** Avoid scope creep in the first working version. Prove the pipeline works
before adding complexity.

**Impact:** Tool proposals outside this stack are deferred to later roadmap stages.

---

## DEC-004 — Secrets Stay Out of Project Files

**Decision:** No real API keys, tokens, or passwords in any project file.
Example/sample files use placeholder strings only (e.g., `YOUR_API_KEY_HERE`).

**Reason:** Security. Project files may be reviewed, shared, or version-controlled later.

**Impact:** All `scripts/*.example` and config templates use placeholder values only.

---

## DEC-005 — English for Technical Files

**Decision:** All technical documentation files are written in English.
Russian is permitted in informal operator notes only.

**Reason:** Technical files should be readable by future collaborators or tools
without language barriers.
