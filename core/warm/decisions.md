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

---

## DEC-133 / DEC-134 — Live relevance & loop-summary accounting (2026-06-16)

**Rule (DEC-133):** Live source relevance (Telegram public preview, and any future social connector) is
decided by **post-level evidence only**. Channel title/username/allowlist/source context may raise
confidence/metadata but must **never by itself** make a post business-relevant. A post with no post-level
finance/broker evidence is `irrelevant_live_false_positive` → skipped (not written to raw/registry by
default; counted in `hard_skipped_items`). `competitor_activity` requires post-level offering/competitor
evidence; pure market news/digest routes as `market_signal` even on a competitor channel. No hardcoded IDs.

**Rule (DEC-134):** A run summary placed on a SplitInBatches **done** output must aggregate over
`$input.all()` (the rows that looped back), **not** `$('<in-loop node>').all()` — after the loop the latter
returns only the **last** iteration, silently undercounting totals/routes. Derive path splits from each row's
`parse_method`, and assert coherence (`processed == claude_path + deterministic`, `≤ selected_count`).

**Reason:** loose relevance contaminates downstream WF08/WF10/WF12; channel-level relevance was the exact
false-positive bug in the first live smoke. Loop-tail `.all()` is a recurring n8n footgun. Full text: DEC-133 /
DEC-134 in `docs/DECISIONS.md`.

---

## DEC-135 — WF11 v0.4.2 final quality gate: 5-class post-level relevance + adjacent-RE skip + gate-based transport (2026-06-17)

**Rule:** Live social-source relevance has **five post-level classes** for `credit_brokerage`, decided by **post
text only**: `competitor_activity` (post-level broker/credit/mortgage **service** evidence), `market_signal`
(market/program/rate/regulatory **news**, no direct offer — digests stay market even on a competitor channel),
`adjacent_real_estate_signal` (real-estate object/lot promos + agent recruitment — **skipped by default**;
overridden to competitor only on strong unambiguous service evidence), `irrelevant_live_false_positive`
(greetings/holidays/personal/lifestyle — skipped), `hard_negative` (legal/registration/accounting/B2B — skipped).
Channel title/username, the **list of tracked channels**, channel description, source URL and source context
**never** create relevance. Strong service CTA wins over market context (chosen consistently).

**Rule (transport safety):** live transport nodes stay **enabled** but are **gate-protected** — unreachable unless
the approval gate passes (`live_mode` + exact token + non-empty validated tracked-channel list + selected
transport); only the selected transport runs. Safety = **approval gate + tracked-channel validation + caps**, not
manual node disabling (same pattern as other live workflows). Fixture/empty-token → `external_calls=0` by graph.

**Wording:** operator-facing text/summaries say "tracked Telegram channels / список отслеживаемых каналов";
internal config name `live_channel_allowlist` kept for compatibility.

**Scope:** VK live = Stage 3 expansion (not MVP blocker); Telegram groups/MTProto/member extraction = future
high-risk extension; Stage 2 WF06 cleanup = backlog. Next active stage = Stage 4 (Claude enrichment + report).
Full text: DEC-135 in `docs/DECISIONS.md`.
