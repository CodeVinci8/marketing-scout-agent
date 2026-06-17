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

## DEC-140 — Stage 3.5 audit alignment + live-readiness hardening (2026-06-17, session 12)

**Rule:** post-audit hardening before Stage C — **no new features, no Stage 4, no external calls.** Canonical
public_lead_signals timestamps = **`created_at`** (write/append) / `updated_at` / `extracted_at`; **there is no
`append_timestamp`/`timestamp_appended` column.** `review_priority` ∈ **{high, medium, low, ignore}** and faithfully
mirrors `score_band` (WF14 `priorityOf` fixed to 4 values; default `min_lead_score=25` keeps `ignore` out of the
sheet unless lowered). WF14 `splitCmt()` derives `source_comment_url` from a reply-anchored `post_url` so **fixture
and live rows share dedup keys / `lead_signal_id`** (raw_market_records stays 40-col). VK live path =
**`IMPLEMENTED_READY_FOR_STAGE_C`** (only runtime API = `BLOCKED_BY_OPERATOR_CREDENTIALS_OR_LIVE_RUN`).

**Pinned Stage C fixture outcomes (harness-derived):** standalone 10-scenario → **7 written**, H/M/L **3/2/2**,
contacts_found=2, contacts_blank=1 (F10), dup=1 (F8), irrelevant=1 (F7), F6 excluded; WF13 9-item fixture → **5
written**, H/M/L **2/2/1**, repeat=0/dup=5; `outreach_allowed=FALSE` everywhere. WF12 unchanged (already compliant).
Full text: DEC-140 in `docs/DECISIONS.md`. Related: [[project-stage3-closed-stage4-next]].

---

## DEC-139 — Stage 3.5 Lead Scout Foundation BUILT (2026-06-17, session 11)

**Rule:** Stage 3.5 Lead Scout = **BUILT** (deterministic, fixture-validated, $0). Architecture = Option A refined
(**no new WF16**): WF13 is the VK public lead source, WF14 is the central Lead Scout engine, WF12 reports — the
competitor branch (WF08/WF10) is untouched so lead flows don't pollute competitor intelligence.

- **WF14 v0.3 Lead Scout engine:** reads `raw_market_records` audience rows (PRIMARY, decoupled from WF08) +
  `review_queue`; deterministic 0–100 scoring (intent25+urgency15+pain20+niche15+contact8+region7+freshness10 −
  penalties) → `lead_score`/`score_band`/`review_priority`; public-contact extraction (verbatim only,
  `contact_source_url` mandatory, blank+`do_not_use` when unprovable); multi-key dedup; supplier/competitor-ad
  exclusion; writes `public_lead_signals` v0.3 (47 cols) + `agent_requests`; self-test summary.
- **WF13 v0.3 VK lead source:** consumer-demand detection → audience lead rows; gated live `wall.get` +
  `wall.getComments` (inert; runtime = PENDING_STAGE_C); synthetic lead fixtures.
- **WF12 lead block:** priority counts + contact counts + top-N anonymized summaries (**no contacts in report**).
- **public_lead_signals v0.3** (47 cols), validation lists 27–33, WF15 family +=public_lead_source.

**Binding:** public evidence only; contact = evidence not permission; `outreach_allowed=false` always; no
hidden/inferred contacts, no member extraction, no private-group scraping, no MTProto. Live VK + full end-to-end =
**Stage C** (max 7 checks). Stage 4 (Claude) = Phase D, not started. Full text: DEC-139 in `docs/DECISIONS.md`.
Related: [[project-stage3-closed-stage4-next]].

---

## DEC-138 — LOCKED A/B/C/D stage model (2026-06-17, session 10)

**Rule:** Stage sequence is locked: **A Cleanup Lock → B Stage 3.5 Lead Scout Foundation + paid/live readiness
(NEXT ACTIVE BUILD) → C Acceptance Pack → D Stage 4 Claude Intelligence Layer.** Locked status: Stage 1 CLOSED ·
Stage 2 CODE-COMPLETE / READY FOR CONTROLLED PAID-LIVE ACCEPTANCE · Stage 3 MVP CLOSED/PASS · **Stage 3.5 NEXT
ACTIVE BUILD** · Stage 4 after Stage 3.5 + Acceptance Pack · Stage 5 after the Stage 4 contract.

- Stage 3.5 Lead Scout is next — do **not** point to Stage 4 as the next active build.
- Stage 2 paid/live acceptance is **postponed to Stage C Acceptance Pack** (not run now).
- Stage 4 starts **only after** Stage 3.5 + the Acceptance Pack.
- **No micro-tests per node** — testing happens after full builds (Stage C).

Supersedes the "next active stage = Stage 4" framing of DEC-135/136 (DEC-136 closure facts stand). Full text:
DEC-138 in `docs/DECISIONS.md`. Related: [[project-stage3-closed-stage4-next]].

---

## DEC-137 — Stage 2 excellence consolidation IMPLEMENTED (2026-06-17)

**Rule:** Stage 2 web pipeline is implemented, not scoped. **WF06** marks `processed` via a **confirmation-based,
idempotent** node (enabled): only approved candidates whose `normalized_source_url` is now in `url_registry`;
never skipped/failed; never re-marks. **WF04** writes baseline `competitor_site_snapshots` (per-URL, gated,
change_type=baseline) and appends one `live_source_runs` + one `agent_requests` row per run on the loop **done**
output via `$input.all()` (DEC-134). **WF05/07/09** append `live_source_runs` automatically (manual WF15 = fallback
only). **WF14** has a read-once/cap/dedup self-test. All `active=false`, placeholder-safe, no external calls.

**Stage 2 status:** WF04–WF07 **code-complete / ready**; full populated-closure is **BLOCKED_BY_OPERATOR_ACTION**
(needs a real Firecrawl/Apify run + tab/credential setup — out of patch scope). Phase B (prompt-rich snapshot
fields) + Phase C (snapshot diff/change-detection) = deferred. Full text: DEC-137 in `docs/DECISIONS.md`,
`STAGE_2_WEB_COMPETITOR_PIPELINE_REVIEW.md` §6. Related: [[project-stage3-closed-stage4-next]].

---

## DEC-136 — Stage 3 MVP closure + Stage 2 scope + WF12 human wording + Stage 4 in 3 sub-stages (2026-06-17)

**Rule:** Stage 3 MVP source/intelligence foundation is **CLOSED / PASS** (Telegram tracked-channel public
preview closed on the clean two-channel run; WF08/WF10/WF12 deterministic chain PASS). VK live + Telegram
groups/MTProto/member extraction = expansion/future, **not** MVP blockers; perfect semantic classification =
**Stage 4.1** task. Dirty diagnostic runs are kept but **never** count as closure evidence.

**WF12 wording:** operator-facing report text uses "публичный превью по отслеживаемым каналам", **no
"allowlist"/"enable HTTP node"**; empty `competitor_site_snapshots` = "Stage 2 not yet populated, not a fault".
Full Markdown is **never** shortened (Sheets row height is a display setting: Clip + top-align — see
GOOGLE_SHEETS_VALIDATION_PLAN).

**Stage 2:** WF06 already auto-reads candidates (no hardcoded URLs); "Mark Processed" stays disabled (manual
WF04 handoff = no success signal) → safe pattern is a confirmation pass keyed on `url_registry` presence.
Shallow is the MVP default; deep ≤3 pages/domain for priority competitors only. Snapshot population is a
controlled runbook, not run now.

**Stage 4:** exactly 3 sub-stages — 4.1 Claude Enrichment Core, 4.2 Intelligence Synthesis & Executive Report,
4.3 Agent-Ready Report & Control Contract — started **after** the external audit
(`PRE_STAGE_4_EXTERNAL_AUDIT_BRIEF.md`). Project = Lead + Market Intelligence Agent
(`LEAD_SCOUT_LAYER_PLAN.md`): public lead signals only, manual review, no auto-outreach, no member extraction.
Full text: DEC-136 in `docs/DECISIONS.md`. Related: [[project-mvp-session4-state]].

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
