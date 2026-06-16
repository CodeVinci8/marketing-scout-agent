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

---

## DEC-131 — Quota-Safe Triage/Aggregation Workflows (single-read + scoped/capped + capped append)

**Decision:** Any n8n workflow that reads operator Google Sheets tabs and writes derived rows must:
(1) read each tab **exactly once** — never put a broad Sheet read downstream of a multi-item flow (collapse to
one control item between readers; consume data via `$('Read …').all()` in a Code node);
(2) build a **scoped, capped** candidate set (real config bounds: window, filters, `max_source_rows`,
`min_signal_score`), applying the source cap **after** scoring/sorting so good older untriaged rows survive;
(3) **append a hard-capped, batched** item list (WF14: `max_signals_to_write ≤ 25`), with a controlled
no-data summary instead of a crash; (4) dedup by a **deterministic hash identity** so repeat runs write zero
duplicates.

**Reason:** Google Sheets quota errors are driven by request **count**. Chaining reads after a multi-item node
silently multiplies executions (WF14 v0.1: 15 → 1410+ → thousands of requests → quota failure). Bounding
reads, candidate volume, and append size keeps deterministic workflows predictable and quota-safe.

**Impact:** Applied to WF14 v0.2; template for all future triage/aggregation workflows. Full text: DEC-131 in
`docs/DECISIONS.md`.
