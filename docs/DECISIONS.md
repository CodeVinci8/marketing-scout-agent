# DECISIONS.md — Decision Register

Non-obvious architectural and design choices with reasoning.
Most recent first.

---

## DEC-153 — Release hardening: proactive delivery + real scheduled monitoring (WF20 ext + WF23)

**Date:** 2026-06-21

**Context:** Pre-installation hardening exposed two gaps: (a) the proactive post-report continuation lived only
in a helper lib — the **actual** WF20 delivery node built a bare factual line — and (b) `tracked_sources` was
registration-only with no scheduled checking. Also needed: a truthful Telegram/VK capability map and a local
n8n-compatibility/persistence audit.

**Decisions:**
1. **Proactive assistance moved into the real delivery path.** WF20 `Build Delivery Outbox` now co-embeds
   `conversation_response` + `agent_charter` and builds `deliveryBody` = immutable report facts (verbatim) +
   a state-aware proactive continuation drawn from the deterministic capability registry. Actions are offered
   only when available; partial/no-data reports offer recovery actions (rerun/sources), not success actions.
   The optional keyboard (`intent:<id>` callbacks == typed intents) is attached to the **final chunk only**.
2. **Real scheduled monitor (WF23) with a Schedule Trigger, `active=false` in repo.** New `source_monitor`
   library: due selection (skips paused/removed/setup_required/not-due), a deterministic check window
   (`sched_<bucket>` vs `manual_<sec>` for the conversational "check now"), normalized-content hashing, a
   baseline-then-diff change model (first check is a silent baseline), lifecycle field updates
   (last_checked/success/next_check/content_hash/change_at/status/error/error_count), a deterministic
   `change_id = source_id::new_hash`, and notify-once (`shouldNotifyChange` is existence-based). The change
   event is persisted **before** the Telegram notification.
3. **Collector truthfulness.** `collectorState`/`tracked_sources.initialStatus`: website is collectable (WF04);
   Telegram is a fixture-first/approval-gated `t.me/s` public-preview collector (WF11) — recent preview posts
   only, not bot `channel_post`/comments/history — available only when `MS_ENABLE_TELEGRAM_COLLECTOR=true`; VK
   (WF13) is fixture + disabled placeholders → `setup_required` until a real collector+creds exist. A source on
   an unconfigured platform is tracked but `setup_required`, never silently treated as live.

**Constraints honored:** WF20 extended + WF23 added (real Schedule Trigger), both `active=false`; Claude/Apify
nodes guarded; lineage/idempotency preserved; no secrets; `make test` ALL SUITES PASS (monitoring suite 59);
0 external calls; $0; not pushed; no n8n import.

---

## DEC-152 — Context-aware deep competitor analysis + orchestration reuse (WF21 + WF20 ext)

**Date:** 2026-06-21

**Context:** The agent needed (a) a bounded deep-analysis mode that goes beyond homepages but only across
configured sources, with a hard separation between observed facts and recommendations, and (b) a way for
follow-up turns ("explain the second", "generate ideas", "compare with last time") to reuse stored evidence
instead of paying for collection again.

**Decisions:**
1. **Two pure libraries.** `deep_analysis` (bounded plan with graceful degradation + evidence contract +
   fact/recommendation separation) and `orchestration_policy` (reuse/collect/extend decision). Unit-tested
   (`test_deep_analysis_contracts.js`, 43) and embedded into WF21 + WF20 (drift in
   `test_deep_analysis_workflows.js`, 22).
2. **Graceful, honest deep plan.** `buildDeepPlan` selects only platforms that are in the allowlist AND (for
   Telegram/VK) backed by an active tracked source; everything else lands in `unavailable_sources` with a
   reason. Scope degrades website_only → website_history → website_telegram → website_vk → full. Page limit,
   external-call count and source/LLM budgets are clamped to config; the plan requires approval.
3. **Evidence contract; recommendations can never become facts.** A `deepFinding` is a FACT only with a full
   evidence anchor (source URL/record + source_run_id + excerpt + collected_at + quality + confidence);
   `validateFinding` rejects anything else. `assembleDeepReport` separates evidence-backed facts from
   recommendations, and a recommendation that doesn't reference at least one valid finding is held back as an
   orphan — it is never stored or shown as a fact.
4. **Conversation-aware reuse (Part 7).** `reuseDecision` returns reuse | collect | extend with a reason and a
   `needs_external_call` flag: context-answerable intents (report_followup/generate_ideas/compare_periods)
   reuse the last report with zero external calls; deep analysis on fresh same-platform evidence reuses; a
   newly-requested *configured* platform extends; stale evidence or an explicit refresh/rerun collects. WF20
   gained an `Orchestration Reuse Decision` node + a `Needs External Call?` branch that answers from context
   without a paid call, persisting every decision to `orchestration_decisions`.

**Constraints honored:** WF21 added + WF20 extended, both `active=false`; approval/budget gate reused for deep
analysis; Claude/Apify nodes guarded; lineage/idempotency preserved; no secrets; `make test` ALL SUITES PASS;
0 external calls; $0; not pushed; no n8n import.

---

## DEC-151 — Conversational agent: NL intent routing + bounded multi-layer memory (WF18 ext + WF22)

**Date:** 2026-06-21

**Context:** Stage 4 (DEC-150) was a button-driven workflow interface. The product goal is a real conversational
Marketing Scout: free-form natural language is the primary interface, buttons are optional accelerators, and the
agent must resolve contextual references ("the first two", "them", "the previous report") without sending the
whole transcript to Claude every turn.

**Decisions:**
1. **Library-first again (extends DEC-142/150).** Five new pure libraries — `agent_charter`, `intent_router`,
   `conversation_memory`, `conversation_response`, `tracked_sources` — hold all logic, are unit-tested
   (`test_agent_contracts.js`, 109 checks) and embedded byte-identically into WF18/WF22 Code nodes (drift
   asserted by `test_agent_workflows.js`). No cross-lib `require` in embeddable libs (the embed strips only
   `use strict`/`module.exports`); shared helpers are `function` declarations so co-embedding two libs in one
   node is legal in sloppy mode; top-level `const` names are unique per lib to avoid redeclaration SyntaxErrors.
2. **Immutable charter + deterministic capability registry.** `agent_charter` injects a compact versioned
   charter every turn and is the single source of truth for runnable capability IDs. Claude may select/phrase a
   capability but cannot invent an ID or callback — only registry IDs route. Availability is derived from cfg
   (a platform is available only if it is in the source allowlist), so the agent never claims Telegram/VK access
   it lacks.
3. **Deterministic-first intent routing.** `intent_router` resolves obvious commands/callbacks and clear
   keyword phrases with zero LLM; genuinely ambiguous free text goes to a GUARDED Claude classifier whose JSON
   is validated against a strict schema (`validateIntentJSON`); anything invalid/unsupported falls back to ONE
   clarification question. **No external collection starts from an unvalidated intent** — `start_work` requires
   `requested_action==='build_plan'` AND an available capability AND a deterministic route. Optional buttons use
   `intent:<capability_id>` callbacks, so a button is exactly equivalent to typing the request.
4. **Bounded multi-layer memory (the full transcript is never sent).** `conversation_memory` implements L1 state,
   L2 recent window (default 8), L3 versioned rolling summary that PRESERVES decisions/entities/IDs/references
   verbatim (a regex collects IDs and they are copied unchanged; the previous summary is retained for audit),
   L4 durable per-user memory, and L5 artifact selection. `buildContext` assembles sections in a fixed priority
   order under a token budget and NEVER drops charter / current state / safety-approval constraints / the newest
   user message; omitted sections + truncation are recorded in `context_usage`.
5. **Memory control + isolation.** `/new` resets active context but keeps durable preferences; `/forget` and
   `/forget_all` (confirmation-gated) tombstone memory and write an audit event that keeps a value HASH, never
   the raw value; memory is strictly isolated by Telegram user; a no-memory mode is supported per request.
   `makeMemory` refuses to store token/secret-like values.
6. **Conversational source management.** `tracked_sources` adds/lists/pauses/resumes/removes/checks public
   sources purely from text; adds are idempotent; a platform not in the allowlist is honestly refused; refs can
   be resolved from context ("add their sites" uses last-report competitor URLs).

**Constraints honored:** WF18 extended + WF22 added, both `active=false`; Claude nodes guarded, not disabled;
messages are not reloaded in full each turn; no secrets in Sheets/JSON; `make test` ALL SUITES PASS (agent
contracts 109 + agent workflows 30); 0 external calls; $0; not pushed; no n8n import.

---

## DEC-150 — Stage 4: single-user Telegram agent MVP (WF17–WF20 + seven contract libraries)

**Date:** 2026-06-21

**Context:** Stage 3 closed the per-workflow runtime contracts (DEC-148/149) but the system was still a
set of manually-triggered workflows. Stage 4 turns it into one operator-facing agent: a Telegram request
flows through planning → human approval → website collection → quality gate → analysis → aggregation →
report → delivery, with durable state and a single chokepoint for every paid call. The single-user scope
is deliberate (one operator, website-first); multi-tenant and multi-source breadth are out of scope.

**Decisions:**
1. **Library-first, embed-mirrored (extends DEC-142).** Seven pure libraries hold all Stage 4 logic —
   `agent_config`, `agent_state`, `request_planner`, `approval_gate`, `source_adapter`, `telegram_io`,
   `execution_summary`. Each is unit-tested directly (`test_stage4_contracts.js`, 72 checks) and embedded
   byte-identically into the workflow Code nodes between drift markers; `tools/gen_stage4_workflows.js`
   deterministically (re)generates WF17–WF20 and `test_stage4_workflows.js` asserts embed == library core.
2. **One central config object, no per-workflow Spreadsheet ID.** WF17 `Resolve Agent Config` reads env
   (`MS_SPREADSHEET_ID`, `MS_TELEGRAM_ALLOWED_USER_IDS`, budgets, limits, allowlist, feature flags) into a
   single canonical config consumed by every other Stage 4 workflow. Defaults fail closed
   (`require_approval=true`, `require_source_health=true`, `source_allowlist=['website']`, planner/summary
   LLM **off**). Missing required keys set `config_complete=false` rather than guessing. No secrets in JSON.
3. **Durable state machine with rejected illegal transitions.** `agent_state` defines the 14 lifecycle
   states (received→…→completed/partial/failed/cancelled). `canTransition` makes terminal states absorbing
   and lets `cancelled` interrupt any live state; `canMakeExternalCall(state)` is false for terminal states,
   so a cancelled/completed request can never start new external work even if a stale callback arrives.
4. **Approval & budget gate is the single paid-call chokepoint (fail-closed).** `approval_gate.evaluateGate`
   blocks unless: not cancelled/terminal, approved (when required), source allowlisted, under item/call
   ceilings, under source and LLM budgets, and the deterministic `idempotencyKey(request, source, attempt)`
   has not already completed. A repeated approval callback or a re-fired source call cannot spend twice.
   Note: `approval_gate.js` uses `GATE_TERMINAL` (not `TERMINAL`) so it can be co-embedded in the same Code
   node as `agent_state` (which exports `TERMINAL`) without a `const` redeclaration SyntaxError in sloppy mode.
5. **Source-adapter contract decouples the orchestrator from source internals.** `normalizeAdapterResult`
   maps any source's raw output to one canonical shape (status/next_state/cost_status, never a fabricated
   `0` cost); `rollupCollection` reduces N adapter results to `complete | partial | no_data`. Website is
   first-class; Avito experimental, VK optional — added behind the allowlist without touching the orchestrator.
6. **Idempotent Telegram I/O.** `telegram_io.parseUpdate` classifies request/`/status`/`/cancel`/callback/
   command; duplicate `update_id` (matched against `agent_request_events`) yields one request, not two.
   Delivery uses an outbox (`makeDelivery` + `shouldSend` payload-hash dedup, MarkdownV2 escaping, 3900-char
   chunking) so a re-executed delivery branch cannot produce a duplicate user-visible send.
7. **One canonical execution summary.** `buildExecutionSummary` collapses request state + collection rollup
   + analysis/aggregation/report facts + delivery into one flat record (records received/eligible/analyzed/
   reported, external calls, primary vs repair LLM calls, source/LLM cost status, blocking errors, single
   `next_operator_action`); unknown costs stay `unknown`.

**Constraints honored:** all four workflows `active=false`; production Claude/Apify nodes guarded by runtime
checks, not physically disabled; `make test` → ALL SUITES PASS (stage4-contracts 72, stage4-workflows 33);
0 external calls, $0; not pushed; no n8n import.

---

## DEC-149 — Stage 3 closure: production analysis/aggregation/reporting gates (WF05/06/08/09/10/12)

**Date:** 2026-06-20

**Context:** The website pipeline (DEC-148) flowed data, but the production-facing gates were either
permissive or self-attesting: WF10 let a `data_mode=live` row pass without a matching `source_health` join,
the Claude nodes in WF08/WF12 were guarded only by hand-disabling, WF05 had no executable pre-Apify gate,
WF06 root detection used `new URL` (unavailable in the n8n sandbox), and WF09 counted search cards as
confirmed offers. These are the remaining Phase-A production blockers.

**Decisions:**
1. **Fail-closed verification (WF10 + WF12 + `n8n/lib/report_gate.js`).** In `rowEligible`, live
   self-attestation no longer verifies a row when `require_source_health=true` (the production default):
   `verified = (healthMatched && healthEligible) || (selfAttestsLive && cfg.require_source_health !== true)
   || fixtureOptedIn`. A missing `source_health` join is now excluded unless the operator sets the explicit
   dev bypass `allow_unverified_source=true`. The embedded mirrors in WF10/WF12 stay byte-identical to the
   library (drift-proof test). `require_source_health` defaults to `true` in both WF10 and WF12 config.
2. **Guarded LLM execution, not disabled nodes.** WF08 `Prepare Record` and WF12 `Claude Summary Approval
   Gate`/`Build Claude Summary Prompt` carry executable runtime guards (enabled flag + valid approval token
   + canonical quality-eligibility + not-cancelled + not-previously-analyzed/summarized + per-call budget).
   `llm_enabled/enable_llm_summary=false` ⇒ zero Claude calls; invalid primary ⇒ one bounded repair ⇒
   deterministic fallback; primary/repair counted separately; unknown cost stays `null`. The Claude HTTP
   nodes remain `disabled:false` in JSON.
3. **WF12 report isolation parity.** Report data is isolated by the current run stamp **and** (additively)
   by `agent_request_id` when rows carry it; `report_data_mode=live` now excludes fixture/manual snapshots,
   and lineage-carrying snapshots are held to the same `__bodyEligible` gate as profiles — a snapshot can no
   longer survive a gate that excluded its source run.
4. **WF05** gains an executable approval/budget IIFE that throws before the Apify request when unapproved
   (token value never logged); `items_relevant` counts direct competitors, `approval_token_used` is truthful.
5. **WF06** root detection is regex-based and sandbox-safe (no `new URL(` call).
6. **WF09** search cards are source candidates: `items_relevant=0` for a search-card-only run, which emits
   exactly `Detail enrichment required; do not run WF08`. (Search-card→offer enrichment stays a documented
   source limitation, not closed here.)

**Scope:** commit `fix(stage3): close production analysis aggregation and reporting gates`. Proven by
`tests/test_stage3_gates.js` (47 checks) plus updated `test_lineage_e2e.js`/`test_report_gate.js`.
`make test` → ALL SUITES PASS; external calls=0; live cost=$0; all workflows `active=false`.

---

## DEC-148 — Stage 3 closure: connect the website source quality & analysis pipeline (WF04→WF16→WF08)

**Date:** 2026-06-20

**Context:** After the lineage join was fixed (DEC-147), WF04 still wrote final business-route rows but no
canonical `raw_market_records`, so WF16 could not score WF04 web data and WF08 (the analyzer) never saw it —
risking double semantic analysis (WF04 Claude + WF08 Claude on the same page).

**Decisions:**
1. **WF04 is the website source adapter.** New `Build Canonical Raw Record` node emits ONE canonical
   `raw_market_records` row per scraped URL with full lineage (`agent_request_id`, `source_run_id`,
   `workflow_run_id`, `source_record_id`, `data_mode`), structural/quality fields and `analysis_status='pending'`.
   WF04's own extraction is retained only as source hints/evidence; transport/Firecrawl/cleaning/snapshots stay.
2. **WF08 is the single semantic owner.** It consumes the canonical record exactly once: `Filter & Select
   Records` adds `source_run_id_filter`, a record-level quality gate (degraded/quarantined/pending blocked —
   mixed runs gate per record), and exactly-once idempotency via a new `analysis_runs` ledger
   (`analysis_idempotency_key = source_run_id::source_record_id`; `force_reprocess=true` overrides).
3. **WF16** scores the WF04 canonical rows by `source_run_id` (no `no_compatible_baseline`).

**Scope:** commit 2 of the Stage-3-closure effort (`fix(stage3): connect website source quality and analysis
pipeline`). Proven by `tests/test_website_pipeline.js` (36 checks) on `firecrawl_20260620_104531` (CASHMOTOR
healthy reaches WF08 once; CarCapital degraded blocked; lineage identical WF04==WF16==WF08; repeated run = no
duplicate). New Sheets: `raw_market_records` WF04 columns + `analysis_runs` tab (migration §24/§25). Open
follow-up: WF08 LLM via runtime guard (not a node kill switch). `make test` → ALL SUITES PASS; $0; active=false.

---

## DEC-147 — Stage 3 closure: canonical identity/lineage contract + WF16 Sheets-boolean fidelity

**Date:** 2026-06-20

**Context:** The Stage 3 live investigation found WF16 quarantined the WF04 web run with `no_compatible_baseline`.
Root cause: WF04 wrote downstream rows with `firecrawl_20260620_104531` but `live_source_runs` with
`wf04_20260620_104531` — `Build live_source_runs Row` deliberately rewrote the canonical id, breaking WF16's
`source_run_id` join. Separately, WF16's `Assemble` treated the Sheets string `'FALSE'` as truthy.

**Decisions:**
1. **Canonical lineage contract** (`n8n/lib/lineage.js`): one `source_run_id` per source-connector execution is
   THE join key carried by raw records, snapshots, source_health, analyzer outputs, aggregation and reports. A
   workflow-local id (`wf04_*`) is recorded separately as `workflow_run_id` and never replaces `source_run_id`.
   Joins resolve via `canonicalSourceRunId = source_run_id || run_id(legacy) || agent_request_id`.
2. **WF04 fix:** `live_source_runs` emits `source_run_id = run_id = firecrawl_<stamp>` + `workflow_run_id =
   wf04_<stamp>` + `data_mode`; snapshots carry the same canonical `source_run_id`. Ledger honesty:
   `approval_token_used='not_required'`, separated `primary_calls`/`repair_calls`, cost `unknown`/`null` (never 0).
3. **WF16 boolean fidelity:** `Assemble` coerces Sheets booleans via an embedded `cbool()` mirroring
   `lineage.coerceSheetBool` (drift-proven) so explicit `TRUE`/`FALSE`/strings/empty are preserved.

**Scope:** This is commit 1 of the Stage-3-closure-and-Stage-4 effort. It closes the lineage *join* and boolean
defects (proven by `tests/test_lineage_contract.js`, 34 checks). The WF04 canonical-raw-record emission / WF08
single-semantic-owner handoff (§2.2/§2.4), WF10/WF12 production filtering (§2.5/§2.6), the §2.7 remainder, and the
whole Stage 4 orchestration layer (Phase B) are tracked in `docs/STAGE_3_CLOSURE_REPORT.md` as open follow-ups.
`make test` → ALL SUITES PASS; 0 external calls, $0; all workflows `active=false`.

---

## DEC-146 — Stage C Runtime Patch 5 (WF09 Apify actor-input regression from the live retest)

**Date:** 2026-06-20

**Context:** Two real WF09 live retests stalled after `Build raw_market_records Rows`, which received exactly
one malformed/empty item (empty `source_url`/`post_url`/`title`/`listing_id`/`query`). Before Patch 4 the
actor `fatihtahta/avito-russia-scraper` returned 10 listings correctly. Patch 4 changed the Apify input from
plain URL strings to `actor_start_urls` (`{url,userData}` objects); the actor expects `startUrls` (array of
URL strings) + `limit` (integer) and returns `parentSourceUrl` per item.

**Root cause & decisions:**
1. **Wrong live actor input.** The Apify request sent `actor_start_urls` objects → the actor could not parse
   them → it emitted one empty item → `Build raw_market_records Rows` dropped it as `invalid` → zero rows →
   the run stalled. Decision: the live request sends `startUrls = cfg.start_urls` (plain string URLs) +
   `limit = cfg.actor_limit`. `actor_start_urls` is preserved in `Set Config` for **internal mapping/tests
   only**, never as the live actor input.
2. **Query origin must survive the string-`startUrls` switch.** With userData no longer echoed, Normalize
   recovers per-record origin in order: (1) explicit actor query metadata; (2) the actor's `parentSourceUrl`
   matched against `cfg.query_plan` / configured search URLs; (3) `search_query='unknown'`. `source_search_url`
   comes from `parentSourceUrl` when present, else the matched `query_plan` entry's specific URL. It **never**
   falls back to `start_urls[0]` or the concatenated configured-query list (removed the old `firstStart`
   fallback that silently single-query-biased every card).
3. **Malformed items never become empty records.** An item with no listing URL/title/ID stays `invalid` and is
   excluded from `raw_market_records` and `market_record_registry`; the run emits an explicit error/skip
   summary (`invalid_items=N`, "do NOT run WF08") on `agent_requests`/`live_source_runs`/Final Summary. This
   was already enforced; Patch 5 proves it with a direct regression test.

**Scope:** WF09 only (`Set Config` comment, Apify request body, `Normalize`). WF16 and `n8n/lib/quality_gate.js`
unchanged (no failing test required it). New `tests/test_wf09_actor_input.js` (48 checks). `make test` → ALL
SUITES PASS; 0 external calls, $0; all workflows `active=false`.

---

## DEC-145 — Stage C Runtime Patch 4 (first real WF09→WF16 live run: identity, search-card classification)

**Date:** 2026-06-20

**Context:** The first real live execution (`avito_20260620_055017`: 10 Apify items, all non-detail Avito
search cards, 9 unique + 1 duplicate) exposed runtime defects that the offline fixtures had not. WF16 returned
`healthy`/`report_eligible=true`/`llm_eligible=true`, `report_candidate_items=0`, `duplicate_items=0`, and
blank workflow/platform/source-family metadata.

**Root causes & decisions:**
1. **WF09 `live_source_runs.run_id` was the `agent_request_id`, not the connector `run_id`** → WF16's
   `live_source_runs`↔`raw_market_records` join (keyed on `source_run_id`/`run_id`) silently failed, blanking
   all run metadata. Decision: `run_id = cfg.run_id`; also emit `source_run_id` + preserve `agent_request_id`;
   WF16 join gets a legacy fallback that matches `agent_request_id`. `approval_token_used` now reflects the live
   safety gate (value never stored). Cost: `external_calls>0` & cost not recovered ⇒ `unknown`/`null`, never `0`.
2. **Raw records did not carry the search-card signal** (`is_detail`/`detail_fetch_required`/`placeholder_title`/
   `quality_flags`/…), and WF16 only inferred search cards from placeholder titles. A constructed `text_context`
   defeated the `missing_description` heuristic, so the run scored healthy. Decision: WF09 emits the full §13
   observability contract on each raw row; WF16 detects search cards from explicit + backward-compatible fields
   (`touchpoint_type`/`record_type_hint`/`detail_fetch_required`/`is_detail`/flags/`skip_reason`).
3. **Duplicate undercount:** WF16 matched only `dedup_status==='duplicate'`, missing `duplicate_in_registry`/
   `duplicate_in_batch`. Decision: recognize all canonical duplicate statuses.
4. **Quarantine rule:** a run with `report_candidate_items=0` whose records are all search cards/source
   candidates is `quarantined` by a **critical** `search_cards_only` flag (overrides the numeric score); an
   all-`pending` run is never report/LLM eligible. A non-detail card no longer counts toward
   `exact_evidence_url_rate` (evidence requires detail content). Mirrored identically in
   `n8n/lib/quality_gate.js` and the WF16 embedded node (drift-proven).
5. **Summary semantics:** WF09 `Final Summary` separates structurally-valid / source-candidate / confirmed-detail-
   offer / irrelevant / report-candidate / unique / duplicate; a search card (incl. an unrelated company-
   registration result) is preserved for review but never counted as a confirmed offer.
6. **Query origin:** `search_query` is the specific per-record query (start-URL `userData` is now attached and
   propagated), or `unknown` — never the concatenated configured-query list.

**Proof:** `tests/test_wf16_runtime_searchcards.js` (77 checks) runs the REAL WF09→WF16 nodes on the production-
shaped run; `make test` → ALL SUITES PASS, **0 external calls, $0**, all workflows `active=false`. Runtime-only
(real n8n) checks remain: live Apify call, `live_source_runs`/`raw_market_records` header mapping (migration §19–§21).

---

## DEC-144 — Stage C Closure Patch 3 (end-to-end source lineage; WF04 accounting wired; S3-D21 proof)

**Date:** 2026-06-20
**Context:** The Patch 2 audit found the WF16→WF10/WF12 enforcement was inert on real data (B1/C1/C2/D1/D5):
WF10 joined on a `source_run_id` that no upstream workflow wrote, and the mode fields (`data_mode`/
`quality_status`/`review_status`) were absent from the queue rows WF10 reads — so degraded/quarantined/
fixture runs were never excluded. The audit also found WF04's repair/fallback counters (`__rr`/`__acct`) were
dead code (never invoked), and S3-D21 (WF09 search-card quarantine) had no direct test.
**Decision:**
- **Canonical lineage contract** (`docs/SOURCE_LINEAGE_CONTRACT.md`): connectors (WF09/WF07/WF13) write
  `source_run_id`+`data_mode`+`quality_status`+`report_eligible`+`review_status`+`quality_flags` onto
  `raw_market_records`; **WF08** propagates the SAME lineage onto `monitor_queue`/`content_queue`/
  `review_queue` on BOTH its deterministic and LLM-merge paths, deriving `source_run_id` via the same
  `source_run_id‖run_id‖agent_request_id` chain WF16 uses to key `source_health` (so the join always
  resolves). `report_eligible` is decoupled from `data_mode` (mode gating is separate + overridable).
- **`report_gate.rowEligible` rewritten** to MERGE record-local lineage with the matched `source_health`
  verdict (stricter wins) and **fail closed in production**: a record is included only if affirmatively
  verified (health matched-eligible, or self-attests live+healthy, or explicit fixture opt-in). Fail-open
  requires the explicit `allow_unverified_source=true` override (never the production default — audit D5).
- **WF10** stamps `source_run_ids`/`data_mode`/`report_eligible` onto every aggregate output;
  **WF12** filters its rendered body by that stamp (`__bodyEligible`) so the body and the source-quality
  section can never contradict (audit C1; reports `body_records_excluded`).
- **WF04 accounting wired into real execution:** outcome counters live at single points (Normalize+Route for
  repair_success/repair_failure/deterministic_fallback; the snapshot writer for degraded/quarantined/
  snapshots_written); dead `__rr`/`__acct` removed; per-run reset preserved; cost stays `unknown`/null.
- **S3-D21** proven by executing the real WF09 nodes on a production-shaped search card.
**Proof (not documentation):** `tests/test_lineage_e2e.js` runs the REAL WF09→WF08→WF10→WF12 chain and proves
a quarantined connector run's competitor is excluded from WF10 and absent from the WF12 body;
`tests/test_wf04_accounting.js` runs the real parse/route/snapshot nodes and asserts accumulated counters;
`tests/test_wf09_searchcard.js` proves the search-card quarantine. `make test` green, 0 external calls, $0,
all workflows `active=false`.

---

## DEC-143 — Stage C Closure Patch 2 (WF16 physically enforced in WF10/WF12; WF04–WF09/WF14 source fixes; CI)

**Date:** 2026-06-19
**Context:** The Stage C hardening patch (DEC-142) built WF16 + `source_health` and the canonical
taxonomy/semantic engine, but several defects were only *detectable* by WF16, only documented, or not
physically wired into their source workflows. WF10/WF12 did not yet enforce `source_health`.
**Decision:**
- Add a shared, pure, $0 **`n8n/lib/report_gate.js`** and **embed a mirror** of it inside WF10 and WF12
  (drift-proof, like WF16). WF10 and WF12 each add a `Read source_health` node and **physically exclude**
  fixture/manual_test/quarantined/pending/semantic-failed/stale/degraded(-without-opt-in) runs by default;
  degraded is includable only via explicit `allow_degraded_report` (with a visible warning) and fixture only
  via `allow_fixture_report` (with a TEST/FIXTURE watermark).
- Fix defects **at the source workflow**, each covered by an offline test that runs the real node code:
  WF04 (Final Summary + repair/fallback accounting, MKBK brand-preserving fallback, no raw Markdown in offer,
  evidence confidence, page_type/services taxonomy, phone normalization, cost telemetry), WF05
  (regulator/publisher/direct/indirect/source separation, root URL canonicalization, scope/service
  representation, cost telemetry), WF06 (`approval_status=processed` persisted in the real payload), WF07
  (actual-vs-estimated cost, irrelevant≠hard_skipped, `data_mode=manual_test`), WF09 (declared multi-query
  drives discovery start URLs), WF14 (`zero_write_reason` never an ambiguous empty string).
- Add `.github/workflows/regression.yml` (Node 20 / Python 3.12, no secrets, no external calls) running
  `make test`.
**Why not "WF16 flags it" alone:** a defect is only *fixed* when the faulty source logic is corrected (or
removed via a shared runtime component the workflow demonstrably invokes), proven by a workflow-level test —
not when WF16 can merely hide the bad row.
**Cost/safety:** 0 external calls, $0, all workflows `active=false`, no real keys/Spreadsheet IDs, no contacts
surfaced, `outreach=false` preserved. BUILT + offline-validated; operator runtime retest required.
See `docs/STAGE_C_CLOSURE_PATCH_2.md`.

---

## DEC-142 — Stage C Hardening (canonical taxonomy + semantic engine + WF16 quality gate + WF08 llm_primary)

**Date:** 2026-06-19 (session 14)
**Context:** external/acceptance audit produced a 64-item defect register (C1/S2/S3/S3-L). The root causes were
systemic: per-workflow private enum lists + keyword heuristics, hint over-trust, no run-level quality gate, no
report-eligibility/pending-review isolation, faked/zero cost semantics, and Avito search cards / Telegram system
events polluting intelligence.

**Decision (systemic, not keyword crutches):**
1. **Single canonical taxonomy** `config/taxonomy.json` (`semantic-v2.0`) — record/entity/activity/service enums,
   alias compatibility (e.g. `secured_auto_loan→pts_loan`, `return_lease_refinancing→auto_lease_refinance`,
   `question_objection→audience_question`), route map, confidence caps, quality flags. **One source of truth**;
   workflows must not redeclare enums.
2. **Shared semantic engine** `n8n/lib/semantic_core.js` — Stage A pre-gate (system-event/placeholder/search-card/
   evidence completeness), owned-media/affiliate/direct-offer/negation detectors, explainable evidence-based
   confidence with caps, Stage D validator, deterministic route mapper, and `classifyOffline()` (free offline/
   fixture classifier = LLM fallback). The MODEL decides semantics; CODE maps class→queue.
3. **WF16 Source Quality Gate** (`16_…json` + `n8n/lib/quality_gate.js`) — run/source health → `source_health`
   tab; `quality_score/status/report_eligible/llm_eligible/quality_flags`; gates WF10/WF12. Critical flags force
   quarantine; fixture/manual_test/no-data never report-eligible; degraded excluded unless explicitly opted in.
4. **WF08 = `llm_primary`** — Claude is the primary classifier (semantic-v2; POST_EVIDENCE overrides hints);
   deterministic logic kept only as pre-gate/dedup/system-event/hard-negative/safety/freshness/fallback/fixture.
   `llm_enabled=false` stays the safe default until operator Claude approval.
5. **WF09 paid-path safety gate** (fixture=false ∧ live=true ∧ token match ∧ max_items ∧ budget; token value
   never logged); search-card/placeholder quarantine; query separation. **WF11** system-event gate + affiliate
   subtype + negation + freshness.

**Status:** BUILT, offline-validated (`make test` → 654 checks, $0, 0 external calls). All `active=false`.
Pending operator runtime retest (controlled Claude batch + one live channel + one approved Avito smoke).
**Cost = $0; no live calls.** Supersedes nothing — additive over DEC-141.

---

## DEC-141 — Stage C.1 consolidated patch (report redaction, PTS service_type, evidence-based hints, WF14 handoff, dedup diagnosis, audience authors, run isolation, monitored VK engine)

**Date:** 2026-06-19 (session 13)
**Context:** the operator ran the Lead Scout path (WF13 → raw_market_records → WF14 → public_lead_signals) and the
WF12 report end-to-end in n8n. Counters/dedup were correct, but real runtime evidence exposed several defects, stale
instructions, and a missing monitored-VK architecture. This is a corrective patch — **no new product features beyond
the operator-approved monitored engine, no Stage 4/Claude, no live calls, all `active=false`, $0.**

**Decision (defects fixed, root-caused against the actual Code nodes):**
- **A — WF12 contact leakage:** the report printed `evidence_excerpt`/`evidence_text` verbatim, so contacts embedded
  in evidence text leaked while the report claimed contacts were hidden. Fix: a deterministic `redact()` applied
  **before** truncation and as a final pass over **every** printed field (markdown/`notes`, `audience_summary`,
  digest, top-leads, Claude facts) — removes RU/intl phones, `@handles`, `t.me`/VK **profile** links and emails →
  `[PUBLIC CONTACT REDACTED]`; preserves amounts/%/rates/dates and `vk.com/wall…` post URLs. Contact counts stay
  correct; full evidence remains only in `public_lead_signals` for manual review.
- **B — PTS `service_type=unknown`:** WF14 used `str(c.service_need)||svc`, so WF13's literal `"unknown"` hint
  shadowed the correct `svcType()→pts_loan`. Fix: **deterministic-first** — `svcType()` evidence wins unless it
  returns `unknown`; non-informative hints (`unknown`/empty) are ignored. `pts_loan` is the canonical value
  (TABLE_SCHEMA §G col 15). WF13 also now emits `service_hint=pts_loan` for PTS.
- **C — false probable-need hint:** WF13 hardcoded `probable_need='помощь с кредитом после отказов'` for any
  question. Fix: evidence-based `probableNeed()` — refusal hint only with refusal evidence; business/PTS/mortgage/
  bad-credit map to their own needs.
- **D — stale WF08 handoff:** WF13 told the operator to run WF08 as the mandatory next step. Fix: canonical Lead
  Scout handoff = **WF13 → WF14 → public_lead_signals**; WF08 remains an **optional** Stage 3 analytical path.
- **E — misleading zero-write diagnosis:** WF14 suggested lowering thresholds when the real reason was successful
  dedup. Fix: `diagnoseZeroWrite()` (8 reasons) + a `below_threshold_skipped` counter; the repeat run reports
  "all N eligible already exist (dedup succeeded); collect new source data; no threshold change."
- **F — author aggregate semantics:** `active_author_count` counted competitor/editor accounts as audience. Fix:
  **audience authors only** (`record_type_hint=question_objection`) → `audience_author_count`/
  `repeat_audience_author_count` (fixture: 5, not 7).
- **G — review_queue contamination:** WF14 always read all `review_queue` + `raw_market_records`. Fix: config
  `include_review_queue` + `source_agent_request_id` for deterministic acceptance isolation (defaults unchanged).
- **H — doc/sticky contradictions:** WF13→WF08, 20-col report, 28-col leads, monitored-vs-smoke, "live not
  implemented" — resolved across active docs/stickies; historical sections clearly marked.

**Decision (new scope — monitored VK groups, operator-approved):** WF13 gains a monitored two-stage engine
(`wall.get` → POST-level relevance → bounded post selection → `wall.getComments` → COMMENT-level relevance → dedup →
counters), exposed as a deterministic `monitored_fixture_mode` **simulation** (20 §6.4 cases, $0) plus
`monitored_groups` config (categories: competitor/finance_community/city_community/entrepreneur_community; caps).
The live two-stage transport ships as **DISABLED/staged** HTTP placeholders + inert parser; live =
`BLOCKED_BY_OPERATOR_CREDENTIALS_OR_LIVE_RUN` (`docs/VK_MONITORED_SOURCE_RUNBOOK.md`). PUBLIC-only; no private/member/
hidden data; `outreach_allowed=false`.

**Validation:** a new Node harness runs the **actual Code-node logic** under n8n shims —
`node n8n/fixtures/lead_scout/run_all.js` → **132/132 PASS ($0)**. Pinned fixture counters unchanged (vector A 7/3-2-2;
vector B 5/2-2-1; repeat 0/dup 5). All workflows `active=false`; HTTP nodes disabled; no real creds/Spreadsheet IDs/VK
groups.

**Status:** local validation PASS; **Stage C.1 NOT marked passed** — operator runtime retest required
(`docs/STAGE_C_1_TEST_RESULTS.md` §3). Supersedes the WF13→WF08-handoff framing and the author-aggregate semantics of
earlier sessions; DEC-140 facts otherwise stand. Related: [[project-stage3-closed-stage4-next]].

---

## DEC-140 — Stage 3.5 audit alignment + live-readiness hardening (canonical schema, review_priority enum, comment-URL contract, VK live readiness)

**Date:** 2026-06-17 (session 12)
**Context:** an external post-Stage-3.5 audit found **no P0 blockers** but flagged four pre-Stage-C items: (1)
`review_priority` enum not explicit; (2) `append_timestamp` vs `timestamp_appended` ambiguity; (3) Stage C fixture
expected outcomes not exact; (4) VK live readiness needed to be implementation-ready, not just documented. This is a
hardening patch — no new features, no Stage 4, no external calls.

**Findings & decisions:**
1. **Canonical timestamps.** WF14's 47-col output has **no** `append_timestamp`/`timestamp_appended` column under
   either name (neither string exists anywhere in workflows or docs). The canonical timestamps are **`created_at`**
   (write/append time), `updated_at`, `extracted_at`. The append/write timestamp **is `created_at`**. Documented in
   TABLE_SCHEMA §G + validation plan + plan doc; no workflow change needed.
2. **`review_priority` enum made explicit + 4-value.** WF14 `priorityOf` collapsed ignore→low (3 values), while
   `score_band` has 4. Fixed `priorityOf` to **faithfully mirror `score_band` over {high, medium, low, ignore}**
   (1-line). Safe: with the default `min_lead_score=25`, ignore-band rows are filtered **before** write, so the
   emitted set stays {high, medium, low} unless the operator lowers `min_lead_score`. Validation list 28 +
   TABLE_SCHEMA §35 + plan doc updated to the 4-value enum.
3. **Comment-URL contract fix (`splitCmt`).** WF13 (fixture **and** live) folds the comment anchor into `post_url`
   (`…_201#reply2011`) and — because `raw_market_records` is a fixed 40-col schema — never emits a separate
   `comment_url`, while WF14 + the standalone fixtures key on `source_comment_url`. Added a hoisted `splitCmt()`
   helper in WF14: when `comment_url` is empty and `post_url` carries a `#reply`/`?reply=` anchor, it derives
   `source_comment_url` and cleans `source_post_url` to the base post. Result: **fixture and live rows for the same
   comment produce identical dedup keys + `lead_signal_id`**, and `source_comment_url` is populated. Verified
   signals_written/bands/ids unchanged (5 on the WF13 path; 7 on the standalone fixtures).
4. **Stage C fixture expected outcomes pinned (harness-derived, not invented).** Two vectors: (A) standalone
   10-scenario file → WF14 = **7 written**, priority **3/2/2**, `contacts_found_public=2`,
   `contacts_blank_due_to_policy=1` (F10), `duplicates_skipped=1` (F8), `irrelevant_skipped=1` (F7), F6 competitor
   excluded; (B) operational WF13 fixture (9 items, hard_skipped=1, unique=7, dup=1) → WF14 = **5 written**, priority
   **2/2/1**, repeat=0/dup=5. `outreach_allowed=FALSE` everywhere. Documented in the fixtures README + Stage C C3/C5.
5. **VK live readiness = `IMPLEMENTED_READY_FOR_STAGE_C`.** The WF13 live path is complete (token gate, allowlist-only
   `wall.get` + `wall.getComments` v5.199, disabled HTTP node with placeholder token, inert throwing parser, caps,
   live_source_runs + agent_requests ledger, `active=false`). Only runtime API behaviour is
   `BLOCKED_BY_OPERATOR_CREDENTIALS_OR_LIVE_RUN`. Exact operator setup added to LEAD_SCOUT_LAYER_PLAN §12.

**Scope guard:** no Stage 4 / Claude; no live VK/Telegram/Firecrawl/Apify/OpenAI; no activation; no real
credentials/Spreadsheet IDs; no auto-outreach; no member/private-group extraction. WF12 unchanged (already
audit-compliant — anonymized, schema-tolerant). Related: [[project-stage3-closed-stage4-next]], DEC-139.

---

## DEC-139 — Stage 3.5 Lead Scout Foundation BUILT (WF14 v0.3 engine + WF13 VK lead source + WF12 lead block + public_lead_signals v0.3)

**Date:** 2026-06-17 (session 11)
**Context:** Phase B of the LOCKED model (DEC-138). The project had a deterministic public-lead-signal triage (WF14
v0.2) but no real Lead Scout: thin schema, no scoring engine, no public-contact extraction discipline, no VK lead
capture, no review workflow. Stage 3.5 turns the foundation into a real public Lead Scout layer.

**Architecture decision (Option A refined; NOT a new WF16):** WF13 is already the VK public source on the shared
`raw_market_records` contract and WF14 is already the lead-triage layer. A separate WF16 connector/engine would
duplicate VK logic and split the lead engine in two. So: **extend WF13** (VK public *lead* source) + **upgrade
WF14 into the central Lead Scout engine** + **upgrade WF12 lead block**. The competitor branch (WF08/WF10/WF12
competitor sections) is untouched → lead flows do not pollute competitor intelligence; future lead sources reuse
the same connector→raw→WF14 contract.

**Decision (implemented, all `active=false`, $0, no external calls, fixture-validated):**
1. **WF14 v0.3 — Lead Scout Triage & Scoring engine.** Reads `raw_market_records` audience rows (PRIMARY,
   decoupled from WF08) + `review_queue` (enrichment), each tab read once (DEC-131). Deterministic 0–100 scoring
   (intent25+urgency15+pain20+niche15+contact8+region7+freshness10 − penalties) → `lead_score`/`score_band`
   (high≥75/medium50-74/low25-49/ignore<25)/`review_priority`/`recommended_action`/`score_reasons`. Public-contact
   extraction (phone/username/profile, verbatim only; `contact_source_url` mandatory; blanked + `do_not_use` when
   unprovable). Multi-key dedup. Supplier/competitor-ad exclusion. Writes `public_lead_signals` v0.3 (47 cols) +
   `agent_requests`. Final-summary self-test (`read_once_ok`/`append_cap_ok`/`dedup_ok`/`policy_ok`). Canonical
   `pain_type` set: bank_refusal/bad_credit_history/overdue_debt/refinancing_need/mortgage_need/
   business_finance_need/pledge_auto_pts/broker_price_question/fraud_fear/prepayment_fear/document_problem/unknown.
2. **WF13 v0.3 — VK public lead source.** Consumer-demand detection routes public comments/posts to audience lead
   rows; gated live `wall.get` **and** `wall.getComments` (inert HTTP placeholder + dual-shape parser; runtime
   verification = `PENDING_STAGE_C_ACCEPTANCE`); lead-rich synthetic fixtures (+7 000 synthetic phones).
3. **WF12 lead block.** Priority H/M/L counts, public-contact-evidence count + policy-hidden count, top-N
   **anonymized** lead summaries — **no phone/username/profile ever surfaced in the report**; manual-review +
   `outreach_allowed=false` statements; tolerates v0.3 + old 28-col schema during migration.
4. **Schema/validation:** `public_lead_signals` v0.3 (47 cols, TABLE_SCHEMA §G + migration map); validation lists
   27–33 + §3.6 dropdowns; WF15 source_family += `public_lead_source`/`lead_triage`.
5. **Fixtures:** `n8n/fixtures/lead_scout/` synthetic golden data + README.

**Hard policy (binding, CONTACT_AND_OUTREACH_POLICY):** public evidence only; public profile/contact = evidence,
NOT outreach permission; `outreach_allowed=false` on every row; `recommended_action ∈ {manual_review, content_idea,
monitor, ignore}`; no hidden/inferred contacts; no member extraction; no private-group scraping; no MTProto.

**Validation:** WF14 engine 61/61 fixture checks (bands/pains/contacts/policy/47-col) + repeat-run dedup; WF13
routing 6 audience rows incl. dedup + competitor kept separate + 1 hard-skip; WF12 lead block 12/12 incl. no-leak
checks (phone/username/profile never in report). All workflows JSON-valid; Code nodes `node --check` OK.

**Stage status:** Stage 3.5 = **BUILT (deterministic, fixture-validated)**. Live VK lead capture + full end-to-end
acceptance = **Stage C** (`STAGE_C_ACCEPTANCE_PACK.md`, max 7 checks). Stage 4 (Claude) still not started (Phase D).
Related: [[project-stage3-closed-stage4-next]].

---

## DEC-138 — LOCKED A/B/C/D stage model: Stage 3.5 Lead Scout is next; Stage 2 acceptance → Stage C; Stage 4 after Stage 3.5 + Acceptance Pack

**Date:** 2026-06-17 (session 10)
**Context:** After Stage 3 MVP closure (DEC-136) and the Stage 2 code consolidation (DEC-137), the docs still
pointed to "Stage 4 as the next active stage" and carried stale "closure pending" wording. The operator wanted
the stage model **locked** and the documentation made internally consistent (Stage A Cleanup Lock) before any
further build — specifically to stop pointing at Stage 4 prematurely and to move lead work ahead of the Claude
layer.

**Decision (locked stage model A/B/C/D):**
- **A — Cleanup Lock:** this documentation/stage-model consistency patch. No new build, no code/workflow edits,
  no external calls.
- **B — Stage 3.5 Lead Scout Foundation + paid/live readiness:** the **next active build**. Public lead-signal
  layer on the current architecture (public signals only, manual review, no auto-outreach), plus paid/live
  readiness prep.
- **C — Acceptance Pack:** controlled acceptance run after the builds — **Stage 2 paid/live website acceptance**
  + **Stage 3.5 lead acceptance** — performed as one deliberate pass, not micro-tested per node.
- **D — Stage 4 Claude Intelligence Layer:** Claude enrichment + executive report (4.1/4.2/4.3). Starts **only
  after** Stage 3.5 **and** the Acceptance Pack.

**Locked status:** Stage 1 = CLOSED · Stage 2 = CODE-COMPLETE / READY FOR CONTROLLED PAID-LIVE ACCEPTANCE ·
Stage 3 = MVP CLOSED / PASS (DEC-136) · **Stage 3.5 = NEXT ACTIVE BUILD** · Stage 4 = after Stage 3.5 +
Acceptance Pack · Stage 5 = after the Stage 4 contract (4.3).

**Locked rules:**
1. Stage 3.5 Lead Scout Foundation is the next active build. Do **not** point to Stage 4 as the next active build.
2. Stage 2 paid/live acceptance is **postponed to the Stage C Acceptance Pack** — not run now.
3. Stage 4 (Claude Intelligence Layer) starts **only after** Stage 3.5 + the Acceptance Pack.
4. **No micro-tests after every node.** Testing happens after full builds, as the Stage C Acceptance Pack.

**Impact:** ROADMAP carries the authoritative LOCKED block; session-6/7/8 "next active = Stage 4 / closure
pending" lines are historical; NEXT_ACTIONS current priority = Stage 3.5; `LEAD_SCOUT_LAYER_PLAN.md` reframed as
Stage 3.5 NEXT ACTIVE BUILD; STAGE_3/STAGE_4 docs de-ambiguated. Supersedes the "next active stage = Stage 4"
framing of DEC-135/DEC-136 (the closure facts of DEC-136 stand). Related: [[project-stage3-closed-stage4-next]].

---

## DEC-137 — Stage 2 excellence consolidation: WF06 confirmation-marking + WF04 snapshots + WF04/05/07/09 auto-ledger (IMPLEMENTED)

**Date:** 2026-06-17
**Context:** DEC-136 scoped Stage 2 as a checklist; the operator rejected docs-only/micro-patch handling and
required real implementation before Stage 4. This decision records the implemented consolidation (supersedes the
"stays disabled / manual backfill / scoped" parts of DEC-136 and STAGE_2 §5).

**Decision (implemented, all `active=false`, no external calls in-patch):**
1. **WF06 processed-marking — solved & enabled.** Removed `Mark Candidates Processed (DISABLED)`; added a
   **confirmation-based, idempotent** marker: `Select` emits `_confirm_processed` only for `approval_status=approved`
   candidates whose `normalized_source_url` now exists in `url_registry` (proof WF04 wrote them); `IF Confirmed
   Processed?` → enabled update node sets `approval_status=processed` + notes audit. Never marks skipped/failed,
   never re-marks processed. Fresh handoffs stay `approved` until confirmed. Confirmation criterion = presence in
   `url_registry`.
2. **WF04 — competitor_site_snapshots writer + run ledger.** New per-URL branch writes a 22-col baseline
   snapshot (TABLE_SCHEMA §E; gated to skip technical-error/placeholder rows; `change_type=baseline`,
   `source_confidence=80`, Sheets-safe contact). Loop **done** output now appends one `live_source_runs` (23-col)
   + one `agent_requests` (21-col) row per run, aggregating via `$input.all()` (DEC-134). `guarantees/cta/title`
   richer extraction = **Phase B prompt work (deferred)**; snapshot **diff/change-detection** = **Phase C (deferred)**.
3. **WF05/WF07/WF09 — automatic `live_source_runs` ledger** (one row/run), so source workflows no longer rely on
   "manual WF15 logging optional". WF15 remains a fallback.
4. **WF14 — read-once/cap/dedup self-test** added to Final Summary (`read_once_ok`, `append_cap_ok`,
   `self_test_passed`, `health_check`), confirming each broad tab read once + append ≤25 + repeat dedup.

**Stage 2 closure status:** WF04–WF07 are **code-complete / ready for controlled website snapshot collection**.
Final "verified-populated" closure is **BLOCKED_BY_OPERATOR_ACTION** (requires a real Firecrawl/Apify run +
new-tab creation/credential binding — out of patch scope: no external calls). No code blocker remains.

**Impact:** the WF05 → approve → WF06 → WF04 → `competitor_site_snapshots` pipeline is fully wired with dedup,
domain diversity, idempotent marking, ledger, technical_errors. Full text: STAGE_2_WEB_COMPETITOR_PIPELINE_REVIEW §6.

---

## DEC-136 — Stage 3 MVP closure + Stage 2 cleanup scope + WF12 human wording + Stage 4 in 3 sub-stages

**Date:** 2026-06-17
**Context:** Stage 3 had been retested many times; the operator wanted the stage **closed cleanly**, visible
product/doc issues fixed, Stage 2 web debt scoped, and the repo prepared for an external pre-Stage-4 audit —
**not** another open-ended Stage 3 retest loop.

**Decision (closure):** Stage 3 MVP source/intelligence foundation is **CLOSED / PASS**. Telegram
public-channel source is **CLOSED for the MVP tracked-channel public preview** (WF11 v0.4.2, DEC-135) on the
final clean two-channel acceptance run (posts=20, business_relevant=8, hard_skipped=11, unique=0, dup=8,
external_calls=2, technical_errors=0). WF08 handoff/accounting, WF10 aggregation, WF12 deterministic report all
PASS. **VK live** and **Telegram groups/MTProto/member extraction** are expansion/future, **not** MVP blockers.
**Perfect semantic classification** (e.g. `brokershakurova/1237`, `/1245`, `ipotekapro/4090`) is a **Stage 4.1**
enrichment task, not a Stage 3 blocker. The listed 2026-06-16/17 diagnostic runs are kept as diagnostic
evidence and **must never** be cited as closure evidence.

**Decision (WF12 wording):** the deterministic report's `source_collection_actions` and the empty-snapshot
notice were rewritten to human/product language — Telegram = "публичный превью по отслеживаемым каналам
протестирован … добавить/одобрить"; **no "allowlist", no "enable HTTP node"** in operator-facing report text;
Firecrawl/HTTP mentioned only as a technical detail; VK = future expansion; empty `competitor_site_snapshots` =
"Stage 2 web snapshots not yet populated, not a system fault". Full Markdown report is **not** shortened.

**Decision (Stage 2 cleanup scope):** WF06 already auto-reads `url_candidates` + re-reads `url_registry`
(no hardcoded URLs); the only safe code change applied was a sharper WF06 handoff `operator_note`. "Mark
Candidates Processed" stays **disabled** — the manual WF04 handoff gives WF06 no success signal, so the safe
pattern is a separate confirmation pass that marks `processed` only when `normalized_source_url` appears in
`url_registry` (idempotent, never marks skipped). Native `live_source_runs` append for WF04/05 is folded into
Phase B; WF15 manual logging is the interim standard. Deep vs shallow policy: **shallow is the MVP default**
(single-page WF04 + first-pass domain diversity); deep is ≤3 key pages/domain for priority competitors only,
within the ≤5 URLs/run cap. `competitor_site_snapshots` population is a controlled operator runbook (3–5 top
competitors), **not run now**. Full text: `STAGE_2_WEB_COMPETITOR_PIPELINE_REVIEW.md` §5.

**Decision (Stage 4 structure):** Stage 4 = exactly three sub-stages — **4.1 Claude Enrichment Core**
(selective, capped, cost-logged, deterministic fallback; includes the semantic-classification corrections),
**4.2 Intelligence Synthesis & Executive Report** (WF12 Claude executive summary, evidence-bound, budget-gated),
**4.3 Agent-Ready Report & Control Contract** (Telegram-friendly summary + report contract for Stage 5).
Stage 4 starts **after** the external audit (`PRE_STAGE_4_EXTERNAL_AUDIT_BRIEF.md`).

**Decision (Lead Scout):** the project is a **Lead + Market Intelligence Agent**, not only a competitor
analyzer. The MVP lead layer (`LEAD_SCOUT_LAYER_PLAN.md`) reuses `raw_market_records` → WF08/WF14 →
`public_lead_signals` → manager review → WF12 lead block. Public contact evidence may be stored only if verbatim
public, always with `source_url` + `extracted_at`, `contact_use_policy=manual_review/aggregate_only`; **no
auto-outreach, no member extraction, no private-group scraping** in the MVP.

**Impact:** Stage 3 closed; Stage 2 debt scoped with a runbook; WF12 operator-facing wording de-jargoned;
Stage 4 structured; Lead Scout concrete; external audit brief prepared. Next active stage = Stage 4, after audit.

---

## DEC-135 — WF11 v0.4.2 final quality gate: 5-class post-level relevance + adjacent-RE skip + gate-based transport

**Date:** 2026-06-17
**Context:** After DEC-133 (post-level relevance) fixed greeting/personal false positives, the diagnostic run
`wf11_req_20260617_032817` (`ipotekapro`) showed a remaining class of pollution for the `credit_brokerage` MVP:
**adjacent real-estate posts** — object/lot/ЖК promotions and real-estate **agent recruitment** — were written as
`competitor_activity`, and a holiday post was written as `market_signal`. Channel-level membership ("it's a
competitor channel") was still leaking into relevance via weak shared tokens (`комиссия`, `ставка`, `программа`).
This is the final Stage 3 closure patch; the operator is fatigued by repeated manual retests, so the fix had to be
robust and validated locally, with a short (≤5-test) acceptance plan rather than another open-ended retest loop.

**Decision:**
1. **Relevance is decided by POST TEXT ONLY.** Channel title/username, source URL, the list of tracked channels,
   channel description, and source context may raise confidence/metadata but **never by themselves** make a post
   relevant.
2. **Five post-level classes** for `credit_brokerage`:
   - `competitor_activity` — requires post-level broker/credit/mortgage **service** evidence (offer, case, CTA,
     pricing/commission, guarantee, approval/refusal handling, refinancing, rate reduction, "подберём банк",
     "кредит под залог", "оплата за результат", …).
   - `market_signal` — market/program/rate/regulatory **news** affecting credit/mortgage, **not** a direct offer
     (digests, government-program changes, demand/rate trends). A digest on a competitor channel stays
     `market_signal`, not `competitor_activity`.
   - `adjacent_real_estate_signal` (**new**) — real-estate object/lot promos, agent recruitment, property marketing
     with only weak mortgage context. **Skipped by default** (not written to `raw_market_records` /
     `market_record_registry`); counted in `adjacent_real_estate_skips`. Overridden to `competitor_activity` only on
     strong, unambiguous broker/credit-service evidence (`STRONG_SERVICE`).
   - `irrelevant_live_false_positive` — greetings/holidays/personal/illness/lifestyle without finance evidence.
     Skipped; counted in `irrelevant_false_positives`.
   - `hard_negative` — legal address, company registration, accounting, unrelated B2B. Skipped.
   Strong service CTA wins over market context (e.g. family-mortgage rule change + "запишитесь на консультацию,
   подберём программу" → `competitor_activity`) — chosen consistently and documented.
3. **Gate-based transport safety (Task B).** Transport nodes renamed (`Firecrawl Scrape t.me Preview (LIVE gated
   transport)`, `Fetch t.me Preview Page (HTTP fallback, LIVE gated)`) and **enabled**. Safety is now the
   **approval gate + tracked-channel validation + caps**, not manual node disabling — the same pattern as the other
   live-capable workflows. The transport is unreachable unless `live_mode=true` + exact approval token + non-empty
   validated tracked-channel list + selected transport; `Route Live Transport` runs only the selected transport.
   Fixture mode and empty-token both yield `external_calls=0` by graph logic. `active=false` preserved.
4. **Operator-facing wording** uses "tracked Telegram channels / список отслеживаемых каналов", not "allowlist";
   internal config name `live_channel_allowlist` kept for compatibility.

**Scope decisions:** VK live → Stage 3 **expansion** (not MVP blocker); Telegram groups/MTProto/member extraction
→ **future high-risk extension**; Stage 2 web snapshot / WF06 manual config → backlog. **Next active stage = Stage 4**
(Claude enrichment + executive report) after the short acceptance run.

**Validation:** JSON valid (`python3 -m json.tool`); 11 Code nodes pass `node --check`; local sim 16/16
representative snippets correct; fixture regression unchanged (6/5/1/4/1, `irrelevant_false_positives=0`,
`adjacent_real_estate_skips=0`, unique=4, dup=1). No real keys/Spreadsheet ID; no Telegram Bot API/MTProto/member
code; no outreach path. WF08 untouched (DEC-134 fix verified intact, not re-edited).

**Alternatives considered:** hardcoding the known bad post IDs (rejected — brittle, channel-specific, violates
post-level-evidence principle); adding a new "adjacent" sink/tab (rejected for MVP closure — documented as optional
future, not implemented); keeping transport nodes disabled (rejected — operator wants the gate-based pattern used
elsewhere, and the gate already guarantees inertness).

---

## DEC-134 — WF08 Final Summary aggregates over the loop "done" output, not the last in-loop iteration

**Date:** 2026-06-16
**Context:** Operator TEST 7 (WF08 handoff on dirty `ipotekapro` data) wrote multiple rows to the queues, but
`Final Summary Output` reported `selected_count=8`, `total_processed=1`, `deterministic_rows=1`. Root cause:
`Final Summary` is on the `Loop Over Items` (SplitInBatches, batch size 1) **done** output and was computing
totals from `$('Build Deterministic Row').all()` / `$('Merge ...').all()`. After a SplitInBatches loop those
`.all()` calls return **only the last iteration**, so every counter except `selected_count` was undercounted.
**Decision:** Aggregate counters over `$input.all()` — the rows emitted on the loop's done output, which carry
**every** processed row that looped back through `Loop Over Items`. Derive `deterministic_rows` vs
`claude_path_rows` from each row's `parse_method` (deterministic vs claude/merge methods) rather than from node
output lengths. Added `processed_accounting_ok` (rows split exactly into claude+deterministic and never exceed
`selected_count`). A legacy single-iteration read is kept only as a fallback if the done branch is empty.
**Scope guard:** **summary/counter aggregation only** — no change to routing, the LLM kill switch (DEC-119),
or the deterministic classifier. `claude_calls=0` and `estimated_analysis_cost_usd=0` remain when
`llm_enabled=false`.

---

## DEC-133 — WF11 live business relevance is decided by POST-LEVEL evidence only (channel context is metadata, not relevance)

**Date:** 2026-06-16
**Context:** Operator live smoke (TEST 4–6, channels `brokershakurova` / `ipotekapro`) showed the transport,
parser and dedup all working, but **relevance was too loose**: holiday/personal/motivation posts ("С Днём
России", "выздоровления", "память телефона… мотивация") were written as business-relevant, and a market-news
post was promoted to `competitor_activity`. Root cause: `Normalize Telegram Posts` built its relevance blob as
`low(text)+' '+low(channel_title)` — so a competitor channel's title alone (e.g. "Кредитный брокер…") made
every post in it relevant.
**Decision (WF11 v0.4.1):**
1. **Relevance is computed from POST TEXT ONLY.** Channel title/username/allowlist may only **raise
   confidence/metadata** on an already-relevant post; they can never create relevance.
2. **Three positive evidence sets, post-level:** `OFFER` (service pitch/case/price/CTA/commission/guarantee/
   broker positioning…) → `competitor_activity`; `MARKET` (rate/program/regulatory/demand news) → `market_signal`;
   `POSITIVE` (general credit/mortgage/broker finance terms) → `market_signal` floor. Short tokens (`ип/ки/цб/
   ооо/бки`) use Cyrillic-aware word boundaries to avoid substring false hits.
3. **No post-level finance/broker evidence ⇒ `irrelevant_live_false_positive`** → `hard_skip` (counted in
   `hard_skipped_items`, surfaced as `irrelevant_false_positives`); **not** written to `raw_market_records` /
   `market_record_registry` by default. Optional audit only when `live_debug_audit=true` (default false).
4. **`competitor_activity` requires post-level offering evidence** — a market/news/digest post on a competitor
   channel routes as `market_signal`, never promoted to competitor merely because the channel is a competitor.
5. **No hardcoded post IDs** — general rules; verified against the live false positives and the fixture set
   (fixture counters unchanged: 6 received / 1 hard-neg / 5 relevant / 4 unique / 1 dup).
**Also (Task B):** in LIVE mode `agent_requests` title/details/notes now use the **actual live allowlist** +
`source=live_preview` + `transport=firecrawl|http_get` (was logging the fixture allowlist). `live_source_runs`
behavior preserved.

---

## DEC-132 — WF11 Telegram Live Preview = Gated Public `t.me/s` Only, Firecrawl-Preferred / HTTP-Fallback, Both Transports Disabled by Default

**Date:** 2026-06-16
**Context:** WF11 needed a real (not just placeholder) Telegram live-source path. Telegram has many unsafe
collection routes (Bot API on private content, MTProto/user sessions, groups, member lists). The only
compliant public surface is the channel **preview** page `https://t.me/s/<channel>`, which renders recent
public posts as plain HTML with no login.
**Decision:** WF11 v0.4 implements a gated live preview path with these fixed rules:
1. **Public preview only** — fetch `https://t.me/s/<channel>` pages. No Telegram Bot API for source scraping,
   no MTProto, no user sessions, no groups/private chats, no `t.me/+`/`joinchat`/`t.me/c`, no member extraction.
2. **Transport: Firecrawl preferred, plain HTTP GET fallback** — selected by `live_transport`
   (`firecrawl`|`http_get`) and routed by a `Route Live Transport` IF. **Both transport nodes ship DISABLED**;
   arming requires token + non-empty allowlist + enabling the chosen node in the editor.
3. **Allowlist gate normalizes + validates** — accepts a username or a `t.me/s/<channel>` / `t.me/<channel>`
   URL, normalizes to a username, and rejects invite/private/group/numeric-id entries; caps
   `live_max_channels≤2` (first smoke) and `max_posts≤10`.
4. **Cost honesty** — `external_calls` and source cost are written to `agent_requests` + `live_source_runs`:
   `http_get` has no per-call fee ($0); Firecrawl cost is unknown at log time → recorded `cost_not_recovered`
   (never implied free; see DEC-131 cost rule).
5. **Contact/outreach policy unchanged** — public contacts verbatim from post text only, `contact_channel=telegram`
   for handles, default `contact_use_policy=manual_review`, no outreach. `llm_calls=0`. Fixture path untouched.
**Reason:** keeps the live path real and operator-armable while structurally preventing every unsafe Telegram
collection mode; the disabled-by-default transports plus the approval token make accidental live calls
impossible.
**Impact:** WF11 v0.4. The same gated-preview + disabled-transport + URL-normalizing-allowlist pattern is the
template for the next live connector (VK official-API `wall.get`/`wall.getComments`).

---

## DEC-131 — Triage/Aggregation Workflows Must Avoid Broad Sheet Reads After Multi-Item Flows (single-read + scoped/capped + capped append)

**Date:** 2026-06-16
**Context:** WF14 v0.1 failed operator TEST 8 with `The service is receiving too many requests from you`. Root cause was a structural n8n pattern, not a logic bug: Google Sheets read nodes were chained linearly, so `Read raw_market_records` / `Read public_lead_signals` re-executed **once per upstream item** (15 review rows → 1410+ raw rows → thousands of read requests) and the append fired far too many times → Google Sheets quota error. There was also no input scoping, so the whole project history was in play.
**Decision (stable rule for all triage/aggregation workflows):**
1. **Single-read sheets** — never place a broad Sheet read downstream of a multi-item flow. Collapse to one control item between readers (e.g. `Hold Config` nodes returning a single item) so each tab is read exactly once; consume data in a Code node via `$('Read …').all()`.
2. **Scoped/capped candidate sets** — the config node must carry real bounds (`max_source_rows`, time window, filters, `min_signal_score`); apply the source cap **after** scoring/sorting/filtering so good older untriaged rows are not lost.
3. **Capped/batched append** — append must receive a hard-capped item list (`max_signals_to_write ≤ 25` for WF14) in one batched write; never send hundreds/thousands of items. No-data path returns a controlled summary, never a crash.
4. **Deterministic dedup identity** — stable hash key (`platform|post_url|norm(text)|intent`) + fallback, compared against existing rows, so repeat runs write zero duplicates.
**Reason:** Google Sheets quota failures are driven by request **count**, which item-explosion inflates silently; bounding reads, candidate volume, and append size keeps deterministic workflows quota-safe and predictable.
**Impact:** Applied to WF14 v0.2. This pattern is the template for any future triage/aggregation workflow that reads operator tables. WF14 retest (TEST 8/9) still pending.

---

## DEC-130 — Public Lead Signal Layer (WF14 + `public_lead_signals`, deterministic, evidence-not-permission)

**Date:** 2026-06-12
**Context:** Public audience voice (VK comments, questions, reviews) sat in operator tables (`review_queue`, `raw_market_records`) where a manager cannot work with it; the product needed a manager-usable lead-signal layer without crossing into outreach.
**Decision:** Built `14_public_lead_signal_triage.json` (active=false, manual, $0, no Claude): reads `review_queue` + audience-type `raw_market_records` rows, classifies pains (after_refusal / bad_credit_history / overdue_debt / urgent_money_need / prepayment_fear / fraud_fear / broker_price_question / mortgage_refinance_need / business_finance_need) and intents (question / objection / complaint / buying_intent / content_signal) with deterministic 0–100 scores, writes `public_lead_signals` (28 cols) + `agent_requests`. Hard policy: **a public profile URL is evidence, never permission for outreach**; `contact_use_policy` defaults `manual_review`/`aggregate_only`; recommended_action never contains outreach; dedup by post_url+text_hash; writes only the two tabs. WF12 consumes aggregates only (no names/contacts in reports).
**Alternatives considered:** Claude-based triage (rejected for v0.1 — cost/control; deterministic vocab is auditable and $0); putting lead flags onto review_queue rows (rejected — managers need a clean dedicated table with policy fields).

---

## DEC-129 — Stage 2 Website Pipeline Reintegrated as First-Class Intelligence Source (`competitor_site_snapshots`)

**Date:** 2026-06-12
**Context:** The approved Stage 2 web pipeline (WF03/04/05/06) was functionally parked — its output never reached WF10/WF12, so the deepest first-party evidence (competitor sites: offers, prices, guarantees, CTA, changes) was missing from the intelligence layer.
**Decision:** New tab `competitor_site_snapshots` (22 cols: identity + business content + contact policy fields + `content_hash`/`change_type`/`previous_snapshot_id` change tracking). WF12 v0.3 reads it (tolerant of absence) and renders a competitor-websites block + change counts in the executive digest. Population is phased: Phase A manual backfill; Phase B WF04 gets an additive snapshot-append step (own session+approval; current WF04 behavior untouched — verified untouched this session); Phase C scheduled re-scans with hash diffing (own cost approval). **WF06→WF04 auto-handoff stays deferred (DEC-075 reaffirmed)** — the approval gate before paid Firecrawl runs is a feature; the guarded plan in `WORKFLOW_06_AUTO_HANDOFF_PLAN.md` activates only with live volume, via approval-flagged agent_requests.
**Alternatives considered:** patching WF04 immediately (rejected — 80KB approved workflow, no test budget this session; additive change deserves its own run); auto-handoff now (rejected — removes the cost gate).

---

## DEC-128 — WF12 v0.3 Stakeholder Report + Budget-Gated, Test-Ready Claude Branch (25-col schema)

**Date:** 2026-06-12
**Context:** The v0.2 report was operator-grade: ugly `(unnamed)` competitor names, overlong offers, no executive digest, no website/lead-signal sections; the Claude branch was guarded but not operator-test-ready and had no budget control.
**Decision:** WF12 v0.3 deterministic ($0 default): executive digest (5–7 clean bullets), clean competitor names (`<Platform> offer: <short offer>` fallback), offers shortened (`max_offer_chars=90`), competitor-website block (from `competitor_site_snapshots` + web-derived WF10 profiles), public lead/audience block (aggregates from `public_lead_signals` + `audience_activity_signals`), manager/content/source action blocks, limitations+source_mix. Schema v0.3 = 25 columns: llm block split into `llm_status`/`llm_model`/`llm_input_tokens`/`llm_output_tokens`/`llm_cost_usd`/`llm_summary_ru`/`llm_recommendations_ru`/`llm_quality_flags`. Claude branch is now test-ready: approval gate (token `I_APPROVE_CLAUDE_REPORT_SUMMARY`) → **budget guard throws BEFORE the HTTP node** (`llm_max_input_chars=8000`, `llm_max_estimated_cost_usd=0.10`, estimate = chars/4 × $3/MTok + max_tokens × $15/MTok) → evidence-bound JSON prompt (deterministic fields + aggregates only; required sections executive_summary_ru / key_findings / market_risks / recommended_next_actions / content_recommendations / source_limitations; hard no-invention/no-contacts/no-outreach rules) → DISABLED HTTP placeholder (credential bound in n8n only) → merge with usage-based cost + quality flags (non_json / truncated / unverified_numbers / outreach_language). Every run also logs to `live_source_runs`.
**Alternatives considered:** separate report workflow for the LLM variant (rejected — one report row contract, two paths); monthly budget ledger guard (deferred to Stage 4 backlog — per-run guard first).

---

## DEC-127 — WF10 v0.3: Objection Counting + Merged Pain Labels (review_queue-only objection scope)

**Date:** 2026-06-12
**Context:** `audience_activity_signals.objection_count` was hardcoded 0 — VK comment «Боюсь мошенников / предоплата» was invisible; pain labels were too granular for managers.
**Decision:** Objection vocabulary (боюсь мошенников / мошенник / предоплат / берут деньги и пропадают / обман / кидал / развод / не верю / гарантии / договор questions) counted **only on review_queue rows** so competitor ad copy («без предоплаты», «по договору») never inflates audience objections. Pain labels merged: «просрочки / плохая КИ», «страх предоплаты / мошенников» added. Row blob now includes `comment_text`. Expected VK row after WF13→WF08: question_count≥2, objection_count≥1, buying_intent_count≥1, top_pains ⊇ {отказы банков, просрочки / плохая КИ, страх предоплаты / мошенников}. Aggregate-only policy unchanged; no Claude; no external calls.
**Alternatives considered:** counting objections on all tabs (rejected — ad copy contamination); per-keyword objection rows (rejected — counts suffice for v0.3).

---

## DEC-126 — `live_source_runs` Run Ledger (23 cols) + WF15 Manual Logger; WF11/WF12/WF13 log automatically

**Date:** 2026-06-12
**Context:** Going live (Avito approved; Telegram/VK live-ready) without per-run observability makes cost and guard behavior invisible.
**Decision:** New tab `live_source_runs` (23 cols: workflow, source_family, platform, mode, approval_token_used yes/no — never the token value, allowlist, item counters, external_calls, source/LLM cost, status, error_summary, operator_next_action). WF11/WF13 append one row per run (fixture and live); WF12 logs deterministic vs llm_summary mode with token/cost accounting. `15_live_source_run_logger.json` (active=false, manual) logs everything else (WF09 live runs, guard-blocked attempts, WF04 website runs) with enum validation that **rejects rows containing approval-token values**.
**Alternatives considered:** logging only in agent_requests (rejected — request ledger mixes semantics; run observability needs uniform counters); a separate log per connector (rejected — one queryable ledger).

---

## DEC-125 — WF13 v0.2: Guarded Live VK Path (official API wall.get), `public_comment` Touchpoint, Stage Label Fix

**Date:** 2026-06-12
**Context:** WF13's live branch was a bare "not implemented" throw; VK comments mislabeled as `forum_discussion`; notes used a confusing `stage_3_5` label.
**Decision:** Live path now mirrors WF11's guarded pattern: approval gate (token `I_APPROVE_LIVE_VK_PUBLIC_DISCUSSION` + non-empty `live_group_allowlist`, rejects invite/private entries) → **DISABLED** HTTP placeholder calling **VK official API `wall.get`** (preferred transport; access token only as an n8n credential, never in the file; `wall.getComments` follows in the live session) → inert parser (throws without an API response; maps API items to the fixture shape; `profile_url` derivable only for public user authors). Scope hard-limited: public groups/posts/comments; no private messages/closed groups/member extraction/hidden contacts/auto-outreach; aggregate author counts only. Business-relevant VK **comments** now carry `touchpoint_type=public_comment`; stage label everywhere is `stage_3_source_foundation_vk_public_discussion`. No live calls were made.
**Alternatives considered:** Apify VK actor transport (kept as documented fallback — official API is cheaper/cleaner for public walls); HTML scraping of vk.com (rejected — fragile, ToS-riskier than the official API).

---

## DEC-124 — Sheets-Safe Text Writing for `+`/`=`-Leading Values (fixes phone `#ERROR!`)

**Date:** 2026-06-12
**Context:** `contact_public` values like `+7 999 000-11-22` rendered as `#ERROR!` in Google Sheets — n8n appends use USER_ENTERED, and a leading `+` or `=` is parsed as a formula.
**Decision:** All writers of contact-bearing columns (WF11, WF13, WF14; rule documented for future connectors in TABLE_SCHEMA.md) prepend an invisible apostrophe to values starting with `+` or `=` (`sheetsSafeText`). Registry/dedup keys are unaffected (they never carry contacts).
**Alternatives considered:** switching the append nodes to RAW value input (rejected — changes behavior of every other column and node option support varies by node version); storing phones without `+` (rejected — mutates evidence).

---

## DEC-123 — Stage 3/4/5 Boundaries Defined (source foundation · report/Claude layer · Telegram Business Agent)

**Date:** 2026-06-12
**Context:** The MVP direction (DEC-113) needed explicit stage boundaries so work stops drifting into "one more parser".
**Decision:** Three stage-definition docs are canonical: `STAGE_3_SOURCE_AND_INTELLIGENCE_FOUNDATION.md` (connectors WF09/11/13 → raw/registry → WF08 → WF10; scoring/source hardening; explicitly NOT infinite parser collection), `STAGE_4_REPORT_AND_CLAUDE_LAYER.md` (WF12 → market_intelligence_reports; optional gated Claude summary with cost tracking; quality checks; stakeholder-ready output), `STAGE_5_TELEGRAM_BUSINESS_AGENT_PLAN.md` (commands → agent_requests → approval gates → workflow selection → report delivery; no parser logic inside Telegram). Strategic ideas stay preserved in `FUTURE_CAPABILITIES_BACKLOG.md` (Control Kernel, Niche Packs, Market Graph, Report & Diagram Builder, Source/Budget Planner, Contact Handoff, Competitor Ad Intelligence).
**Alternatives considered:** keeping stage scope only in ROADMAP (rejected — too coarse; scope creep showed it needs binding per-stage docs).

---

## DEC-122 — WF12 v0.2: Full Report Sections + Guarded Claude Branch (disabled, cost-tracked, claude-sonnet-4-6)

**Date:** 2026-06-12
**Context:** The WF12 v0.1 skeleton proved the schema but was not operator/stakeholder-ready, and the Claude layer needed a concrete (still inert) shape.
**Decision:** WF12 v0.2 renders all required sections deterministically from WF10 rows only: executive_summary, competitor_snapshot, top_offers_and_prices (offers/prices_terms from competitor_profiles), market_angles_summary (with trends), audience_signals_summary, content_plan, source_confidence (avg/min/max of source_confidence_score), limitations/source_mix (DEC-108), next_actions. Claude branch replaced the throw-only guard with: Approval Gate (throws unless `llm_approval_token=I_APPROVE_CLAUDE_REPORT_SUMMARY`) → evidence-bound prompt builder (deterministic report fields only — never raw records or contacts; hard no-invention/no-contacts/no-outreach rules; max_tokens cap 1200) → **DISABLED** HTTP placeholder (`claude-sonnet-4-6`, header placeholder string, no real key, no live call made) → merge node that throws without a response and otherwise computes `llm_cost_usd` from usage tokens ($3/$15 per MTok). WF10 stays the deterministic fact core; Claude is the business-interpretation brain on top (DEC-112). Sim: deterministic sections, no_data, gate/merge throws, and a 0.012-USD cost calc all PASS.
**Alternatives considered:** keeping the throw-only guard (rejected — Stage 4 needs the request shape and cost math proven now, while remaining inert); claude-opus tier (rejected — project stack pins claude-sonnet; summary is a bounded summarization task).

---

## DEC-121 — Third Source Foundation = VK Public Groups/Posts/Comments (WF13; reviews/maps deferred to 4th)

**Date:** 2026-06-12
**Context:** Stage 3 needed a third source after Avito (WF09) and Telegram (WF11). Candidates: VK public discussions, reviews/maps (Zoon/Яндекс/2GIS), Dzen.
**Decision:** Built `13_public_discussion_or_reviews_connector_foundation.json` for **VK public groups/posts/comments** (fixture-first, `active=false`, no HTTP node, live guard throws). Rationale: Avito and Telegram both feed competitor-ad data; the weakest WF10 input is `audience_activity_signals` — VK public discussions supply audience pains, questions/objections, buying intent and **aggregate-only** author counts (`active_author_count`/`repeat_author_count`, computed over unique items, never member lists). Classification: competitor ad → monitor_queue; question/objection → `question_objection`/`forum_discussion`/review_queue; weak finance → market_signal/content_queue; hard negatives skipped before registry (WF09/WF11 pattern). Contact policy enforced (verbatim public contacts only; author profile_url only if public; DEC-114 channel categories). Fixture sim: 6 items → 5 relevant / 1 hard-skip / 4 unique / 1 dup; raw +5 / registry +4; repeat run 0/5; 40/15/21 column counts exact. Reviews/maps = recommended 4th source (trust/reputation evidence); Dzen later.
**Alternatives considered:** reviews/maps first (rejected for now — reputation evidence is valuable but doesn't feed the empty audience-signals tab); building all three (rejected — DEC-096 one source at a time).

---

## DEC-120 — WF11 v0.2: Guarded Live Telegram Preview Path (approval token + DISABLED HTTP placeholder; inert by default)

**Date:** 2026-06-12
**Context:** DEC-116 left live preview as a plan with placeholder config only; Stage 3 needed the actual guarded path without executing anything live.
**Decision:** WF11 live branch is now: `LIVE Preview Approval Gate` (throws unless `live_approval_token=I_APPROVE_LIVE_TELEGRAM_PREVIEW` AND non-empty `live_channel_allowlist`; rejects group/invite/private-style entries) → **DISABLED** HTTP placeholder (GET `https://t.me/s/<channel>` public preview only, no credentials) → `Parse Live Preview Posts (inert)` (throws if no HTML — fabricated posts impossible; parses tgme_widget_message blocks when real HTML arrives, capped at `live_max_posts_per_channel<=10`). `Normalize Telegram Posts` now reads `$input` so fixture and live branches share normalization (fixture counters unchanged: 6/5/1/4/1, repeat 0/5 — re-verified). Scope unchanged: allowlist-only public channels, no groups/private chats/MTProto/member extraction/hidden contacts/auto-outreach; outputs only agent_requests/raw/registry. Going live still requires explicit operator approval (token) **plus** manually enabling the HTTP node.
**Alternatives considered:** keeping the throw-only guard (rejected — the transport shape and parser need to exist and be reviewable before any approval is meaningful); enabling HTTP behind the token alone (rejected — two deliberate operator actions are required: token + node enable).

---

## DEC-119 — WF08 Cost-Control Mode: `llm_enabled=false` Master Kill Switch (uncertain records never escalate to Claude)

**Date:** 2026-06-12
**Context:** During the WF11 → WF08 handoff, the uncertain Telegram market signal produced `parse_method=primary_json` despite `llm_enrichment=false` — root cause: `Prepare Record` computed `call_claude = !irrelevant && (llm_enrichment || deterministic_needs_llm)`, so *uncertain* records always called Claude.
**Decision:** Added `llm_enabled:false` to `Set Analyzer Config` as the master kill switch. When false: NO record may reach Claude nodes regardless of `llm_enrichment`/`llm_enrichment_test_mode`/`deterministic_needs_llm`; obvious records still route deterministically (`deterministic_pre_route`/`deterministic_irrelevant_skip` — Avito behavior unchanged); uncertain records go to `review_queue` with **`parse_method=deterministic_uncertain_no_llm`**, `needs_manual_review=true`, reason explicitly states Claude disabled / manual review / $0. Defense in depth: `Build Primary Claude Request` now throws if `llm_enabled!==true` even if `call_claude` were miscomputed. Summary adds `llm_enabled`, `deterministic_uncertain_no_llm` count, `claude_calls`, `estimated_analysis_cost_usd=0`, and **zero-record diagnostics** (duplicate-run ids / filters / dedup_status / test_mode checklist when `selected_count=0` — extends DEC-117). The existing LLM path is restored exactly by setting `llm_enabled=true` (explicit operator approval). Sim: uncertain blocked + routed, Avito pre-route unchanged, irrelevant skip unchanged, guard throws, `llm_enabled=true` restores `call_claude=true` — all PASS.
**Alternatives considered:** redefining `llm_enrichment=false` to also block uncertain records (rejected — silently changes Stage 3.2-approved semantics where `deterministic_needs_llm` was the designed escalation; a separate master switch keeps both modes explicit).

---

## DEC-118 — WF12 Report Builder Built as a Deterministic Skeleton (Claude/Telegram = guarded, not implemented)

**Date:** 2026-06-12
**Context:** DEC-112 placed Claude in the report/control layer above the WF10 fact core; the layer needed its first concrete artifact without authorizing any external call.
**Decision:** Built `n8n/workflows/12_market_intelligence_report_builder.json` (`active=false`, 15 nodes, manual trigger, **no HTTP node, $0**). It reads the 4 WF10 output tabs, selects the latest WF10 snapshot by `plan_id` stamp (previous plan = trend base: angle frequency ↑/↓/=/NEW by stable angle key), computes top competitors/angles/audience aggregates, renders a Markdown report (inline in `notes` v0.1), and writes one `market_intelligence_reports` row (20 cols per `MARKET_INTELLIGENCE_REPORT_SCHEMA.md`) + one `agent_requests` row (`request_type=report_summary`, completed, $0). `enable_llm_summary=false` routes to a **guard node that throws** — the Claude branch is not implemented; enabling it later requires explicit approval, a bounded facts-only prompt (never raw contact fields), a token cap, and cost recording. `telegram_send=false`/`delivered_to=none` — delivery not implemented. A `no_data` WF10 run produces a `no_data_notice` report with empty top lists. Verified: vm-sandbox simulation, 20 checks PASS.
**Alternatives considered:** plan-only without a skeleton (rejected — the schema contract is best proven by a deterministic writer); including the Claude HTTP branch disabled-by-flag (rejected — a guard with no HTTP node is strictly safer and matches the WF11 live-guard pattern).

---

## DEC-117 — WF08 Handoff Uses First-Run Request Ids; Duplicate-Run Ids Correctly Yield Zero Records

**Date:** 2026-06-12
**Context:** A WF08 handoff attempted with the WF11 *duplicate-run* id (`wf11_req_20260612_033756`) returned zero records and looked like a failure.
**Decision:** Documented as correct-by-design, not a bug: repeat connector runs write only duplicate-audit rows with `approval_status=duplicate`, and WF08's default `analyze_statuses=['approved','new']` ignores them. The operator handbook now mandates first-run ids for handoff (verified config: `agent_request_id_filter=wf11_req_20260612_033442`, `platform_filter=telegram`, `source_type_filter=''`, `max_records=10`, `deterministic_first`, `llm_enrichment=false`, `llm_enrichment_test_mode=false`). Analyzing duplicates requires explicitly adding `duplicate` to `analyze_statuses` — not recommended for normal handoff (audit rows would create repeat business-tab entries). A diagnostics sticky note was added to WF08 (documentation-only; no behavior change) and a diagnostics section to the WF08/WF11 RU guides.
**Alternatives considered:** changing WF08 defaults to include `duplicate` (rejected — would re-analyze audit rows on every handoff); silently warning in the summary (insufficient — the handbook is where operators look first).

---

## DEC-116 — WF11 Fixture Foundation PASS; Live Telegram Preview Is a Gated v0.2 Plan with Inert Placeholders

**Date:** 2026-06-12
**Context:** Operator ran the three WF11 fixture tests; Stage 3.4 needed an explicit live-mode plan without enabling anything.
**Decision:** WF11 fixture foundation is **working** (Test 1: 6 posts → 5 relevant / 1 hard-skip / 4 unique / 1 duplicate, raw +5 / registry +4 / agent_requests +1; Test 2 repeat: unique=0 / duplicates=5 / registry +0; Test 3: live guard stops correctly; $0, no external/Claude calls). Live Telegram public-channel preview is **pending and requires explicit operator approval**: allowlist-only public channels, `t.me/s/<channel>` preview pages only, no groups/private chats/MTProto/login-session scraping/member extraction/hidden contacts/auto-outreach, `max_posts` default 10 per channel, `live_mode=false` default, same connector pipeline (WF11 → raw/registry/requests → WF08 → WF10 → report). WF11 carries **inert placeholder config fields** (`live_transport='none_not_implemented'`, `live_channel_allowlist=[]`, `live_max_posts_per_channel=10`, `live_requires_operator_approval=true`) — the guard fires regardless of their values; no HTTP node was added. Plan: strategy §5.7.
**Alternatives considered:** adding a disabled HTTP node now (rejected — a credential-bearing node "just flipped off" weakens the guard guarantee); leaving the live plan undocumented (rejected — the boundaries must be fixed before any transport discussion).

---

## DEC-114 — `contact_channel` Is a Channel Category, Never a Contact Format (`handle` banned; v0.1.1 patch) · DEC-115 — validation_lists v1.1 (26 legacy-compatible lists; warning/reject modes)

**Date:** 2026-06-12
**Context (114):** WF11 fixture Test 1 wrote Telegram handle contacts as `contact_channel=handle`. `handle` describes the *format* of the contact string, not the channel it reaches.
**Decision (114):** `contact_channel` holds only channel categories: `phone`, `email`, `telegram`, `profile`, `form`, `unknown` (empty = no contact). Telegram @handles → `contact_channel=telegram`; the format is recorded in the row `notes` as `contact_format=handle` together with `contact_source_url=<post_url>` and `contact_use_policy=manual_review`. WF11 patched (v0.1.1); the no-contact default also changed from the non-enum `none` to empty. Fixture counts unchanged (patch simulation: 24 checks PASS). No contacts invented, no hidden contacts collected, no outreach actions created.
**Context (115):** The operator created `validation_lists` with 26 lists (incl. `angle_category`) and applied dropdowns; v1.0 lists missed legitimate legacy/system values.
**Decision (115):** v1.1 makes every list compatible with current historical data (e.g. `web`, `social_content`, `social_search`, `review_platform`, `forum_discussion`; full `dedup_status` set incl. `hard_skipped`/`invalid`/`over_pipeline_limit`/`duplicate_in_batch`). Validation modes are fixed policy: **system-written columns → "Show warning"** (strict validation on n8n-written fields can break appends when a new enum value appears), **human-only/manual columns → "Reject input"**. `handle` is NOT added to `contact_channel` — workflows are patched instead (see 114).
**Alternatives considered (114):** adding `handle` to the enum (rejected — collapses two dimensions into one column and breaks channel-based filtering); a new `contact_format` column (deferred to the next schema revision; notes carry it until then).

---

## DEC-113 — MVP Is a Market Intelligence Foundation, Not Avito-Only Output

**Date:** 2026-06-12
**Context:** With Avito live-proven and WF10 v0.1 tested, the MVP risked being framed as "Avito output in Sheets".
**Decision:** The MVP is the layered market-intelligence foundation: **source connectors → `raw_market_records` → WF08 one-record analysis → WF10 market aggregation → report/Telegram-ready summary → (later) Business Agent Control Kernel.** Avito is the **first stable live source feeding that pipeline**, not the product. Every new capability (WF11, report layer, validation lists) is judged by whether it strengthens this pipeline.
**Alternatives considered:** ship Avito-only and defer the layered framing (rejected — it would optimize for one connector and make every next source a redesign).

---

## DEC-112 — Claude Belongs in the Report/Control Layer, Not the Deterministic Fact Core

**Date:** 2026-06-12
**Context:** WF10 v0.1 deferred "bounded LLM synthesis" as a possible in-workflow v0.2 feature. That would make the market facts non-reproducible and add cost to every aggregation run.
**Decision:** **Claude API is NOT inside WF10 by default — ever.** The deterministic fact core (connectors → WF08 → WF10) stays $0 and reproducible. Claude lives **above** it, in the report/control layer: WF10 tabs → deterministic Report Builder → **optional** Claude summary (disabled by default, per-run operator enablement, facts-only prompt, no contacts, no outreach, cost recorded) → `market_intelligence_reports` → Telegram digest → later Control Kernel. WF08's separately approved compact enrichment (DEC-089) is unaffected (per-record, opt-in). Plans: `docs/REPORTING_AND_TELEGRAM_SUMMARY_PLAN.md`, `docs/MARKET_INTELLIGENCE_REPORT_SCHEMA.md`, `docs/TELEGRAM_CONTROL_AGENT_PLAN.md`.
**Alternatives considered:** bounded LLM synthesis inside WF10 (rejected — couples cost/non-determinism to fact generation; a wrong summary would corrupt the fact tables instead of being regenerable above them).

---

## DEC-111 — Google Sheets `validation_lists` Is the Operator Safety Layer

**Date:** 2026-06-12
**Context:** Operators/managers hand-edit fields (`approval_status`, `responsible`, hints) in growing tabs; typos and invented enum values silently break filters and workflow selection logic.
**Decision:** Add a `validation_lists` helper tab and apply Google Sheets **data validation (dropdowns) to existing manually edited fields** — dropdowns are validation rules, NOT new columns; no schema or workflow changes. 25 named lists (source_type, platform, service_type, entity_type, record_type_hint, touchpoint_type, hints, statuses, route, contact policy enums, request enums, boolean, responsible, etc.) applied to `raw_market_records` (15 cols), `agent_requests` (7), the six 35-col business tabs (12), and WF10 tabs (6) — "Show warning" mode on system-written columns so appends are never blocked, "Reject input" only on human-only fields. Full plan: `docs/GOOGLE_SHEETS_VALIDATION_PLAN.md`.
**Alternatives considered:** enforcing enums in every workflow only (insufficient — workflows already do; the gap is *human* edits); Apps Script validation (rejected — heavier, another runtime to maintain).

---

## DEC-110 — Workflow 11 Built: Social Source Connector Foundation (fixture-only, no HTTP node)

**Date:** 2026-06-12
**Context:** Stage 3.4 needed an implementation foundation, but live Telegram fetching requires its own approval, transport choice, and real-markup parser work.
**Decision:** Built `n8n/workflows/11_social_source_connector_foundation.json` (`active=false`, 17 nodes, manual trigger): Telegram public-channel preview connector, **fixture_mode=true / live_mode=false**, and **no HTTP node exists in the workflow** — the live branch is a guard node that fails with an explanatory error (live needs explicit approval + Firecrawl/HTTP transport + credential + preview-DOM parser patch). 6 fixture posts (channels suffixed `_fixture`): 3 competitor ads, 1 weak finance market signal, 1 hard-negative control (filtered before raw/registry), 1 in-batch duplicate. Mirrors the proven WF09 pattern: relevance filter (strong/weak/hard-negative, hardcoded credit_brokerage v0.1 → niche packs later), `dedup_key=telegram::social_channel::<canonical post_url>`, registry + in-batch dedup, duplicate-audit rows, 8-count `result_summary`. Writes **only** `agent_requests` (21) / `raw_market_records` (40) / `market_record_registry` (15); no auto-handoff to WF08. Contact policy enforced: public contacts verbatim from post text only, evidence URL + `manual_review` recorded in notes; no groups/private chats/MTProto, no outreach.
**Verified by simulation (vm sandbox, 31 checks PASS):** counts 6 received / 1 hard-skipped / 4 unique / 1 duplicate; raw +5 / registry +4 / agent_requests +1; repeat run unique=0 registry+0; column widths 40/15/21; live guard throws; determinism; no httpRequest node, no real IDs/keys.
**Files:** `n8n/workflows/11_social_source_connector_foundation.json`, `docs/N8N_WORKFLOW_11_SOCIAL_SOURCE_CONNECTOR_FOUNDATION_RU.md`, `docs/STAGE_3_4_SOCIAL_SOURCE_PARSING_STRATEGY.md` §5.

---

## DEC-109 — First Non-Avito Connector: Telegram Public-Channel Preview

**Date:** 2026-06-12
**Context:** Stage 3.4 strategy ranked sources but no first implementation path was committed. Candidates compared on public availability, compliance risk, complexity, data quality, competitor-intel value, audience-pain value, contact availability, cost, fixture-first testability, and stakeholder-MVP usefulness (`STAGE_3_4_SOCIAL_SOURCE_PARSING_STRATEGY.md` §5.2).
**Decision:** **Telegram public-channel preview (`t.me/s/<channel>`) is the first non-Avito source.** Highest competitor-ad-copy value per unit of risk and effort: public pages, no login/session/token, no member data, reuses existing Firecrawl/HTTP transport, trivially fixture-able, and immediately adds a second platform to WF10 `market_angles`. Order stays VK API (#3) → reviews/maps (#4) → Dzen (#5) → Instagram after a separate risk review (#6), one source at a time (DEC-096). The MTProto/client-session route remains a deferred high-risk last resort.
**Alternatives considered:** VK first (rejected for now — account/app/token setup cost and person-data comments); reviews/maps first (high value but no lead signals and benefits from WF10 maturing); Dzen first (lower intel density).

---

## DEC-108 — WF10 v0.2: Mandatory source_mix Label

**Date:** 2026-06-12
**Context:** WF10 aggregates mixed provenance — live WF09 rows, manual/fixture WF07 intake, and the historical web pipeline (WF03/04/05/06) across platforms (avito/website/dzen/zoon/…). A reader of `agent_requests`/reports could wrongly assume everything was collected live in the latest run.
**Decision:** WF10 stats, `agent_requests.result_summary`, and `notes` carry the explicit label **`source_mix=mixed: live + historical/manual + web pipeline`** (plus observed platform/tab lists in stats). Mixing is acceptable internally, but every report layer consuming WF10 (Report Builder, Telegram digest) must surface this label — `MARKET_INTELLIGENCE_REPORT_SCHEMA.md` makes it a mandatory report column.
**Alternatives considered:** per-row provenance columns in WF10 tabs (deferred — heavier schema change; the run-level label solves the misrepresentation risk now).

---

## DEC-107 — WF10 v0.2: Entity Resolution Priority (profile_url / canonical listing id before offer text)

**Date:** 2026-06-12
**Context:** WF10 Test 1 produced 21 competitor_profiles — useful but inflated: rows without `company_name` grouped by normalized offer_text first, so the same Avito listing with offer-text variants produced multiple `(unnamed)` profiles.
**Decision:** Group key priority is now **`company_name` → normalized `profile_url` → canonical listing id from `source_url` → `profile_name` → normalized offer_text+platform (fallback only) → record hash.** Stable URL identities outrank text similarity, so repeated unnamed rows of one listing form one profile. Append-only snapshot behavior preserved; upsert remains future work (v0.3) — not implemented because safe upsert needs read-modify-write on `competitor_profiles`, which is not trivial in the append-only v0 design.
**Verified by simulation:** two unnamed rows of listing `8000151804` with different offer texts → ONE profile (`listing::avito::8000151804`); profile_url-based and named groups intact.

---

## DEC-106 — WF10 v0.2: No-Data Guard (no generic plan on rows=0)

**Date:** 2026-06-12
**Context:** WF10 v0.1 no-data test: with `rows_after_filters=0` the run still appended a generic `content_positioning_plan` row with template lead_magnets — fabricated-looking advice with zero market evidence.
**Decision:** When `rows_after_filters=0`: no competitor_profiles / market_angles / audience_activity_signals rows; `content_positioning_plan` gets **one clearly marked no_data row** (`plan_id=plan_<stamp>_no_data`, empty top_angles/recommended_posts/recommended_ads/faq_topics/counterarguments/lead_magnets, `source_evidence=rows=0`, `next_action=no_data; broaden filters or source scope`); `agent_requests.result_summary` starts with `no_data;` and `next_action` repeats the guidance. `source_confidence_rules` seed-on-empty and all normal-run behavior preserved.
**Alternatives considered:** write no plan row at all (rejected — the marked row keeps the per-run plan time series complete and makes the empty run visible in the tab itself).
**Verified by simulation (31 checks PASS, incl. normal-run regression and seed/determinism/column-width checks).**

---

## DEC-105 — Strategic Ideas Preserved in FUTURE_CAPABILITIES_BACKLOG.md

**Date:** 2026-06-11
**Context:** Several strategic capabilities (conversational control kernel, market graph, report builder, source/budget planner) kept surfacing in sessions without a durable home, risking loss between sessions.
**Decision:** `docs/FUTURE_CAPABILITIES_BACKLOG.md` is the canonical backlog. Seven entries, each with status/purpose/prerequisites/risks/first-safe-step/related-docs: 1) Business Agent Control Kernel; 2) Niche Pack System; 3) Market Graph Engine (Sheets-first via market_entities/market_edges/market_clusters); 4) Report & Diagram Builder; 5) Source Strategy & Budget Planner; 6) WF10 Aggregator (v0.1 built); 7) Contact/Manager Handoff Layer. Nothing in the backlog is build-approved by the backlog itself.
**Alternatives considered:** scattering ideas across stage docs (rejected — items were already getting lost).

---

## DEC-104 — Workflow 10 v0.1 Built: Deterministic Competitor/Audience Intelligence Aggregator ($0, no LLM)

**Date:** 2026-06-11
**Context:** The DEC-099 build gate (at least one stable live source) is satisfied — Stage 3.3 closed (DEC-102) with a clean live Avito run feeding WF08-routed rows.
**Decision:** Built `n8n/workflows/10_competitor_audience_intelligence_aggregator.json` (`active=false`, 22 nodes, manual trigger). **v0.1 is fully deterministic:** no Claude, no Apify, no Firecrawl, no external API — $0 per run. Reads `monitor_queue`/`content_queue`/`review_queue` (+ `source_confidence_rules` for the seed check); filters by `time_window_days=30` and `niche_id='credit_brokerage'`/`platform_filter=''`/`region_filter='Москва/МО'`/`service_type_filter=''`; groups competitors by company_name → profile_name → normalized offer_text+platform → listing id from source_url; writes `competitor_profiles` (17 cols), `market_angles` (9, fixed 9-angle taxonomy: speed/price-anchor/no-prepayment/result-payment/after-refusals/bad-KI/business-finance/mortgage-refinance/guarantees), `audience_activity_signals` (14, **aggregate-only** per contact policy — author counts left empty for classifieds, never invented), `content_positioning_plan` (12, one row per run, deterministic templates), `source_confidence_rules` (5, 7 seed rules only when the tab is empty), plus one `agent_requests` row (21 cols, `request_type=market_intelligence_aggregation`, `status=completed`, $0). MSK `+03:00` throughout; no bare `new Date().toISOString()`. Update strategy v0.1: append-only snapshots (upsert = v0.2). Niche vocabulary is hardcoded v0.1 — migrates to niche packs (DEC-100).
**Reason:** aggregation must start deterministic and free so its shapes/groupings are validated on real data before any LLM synthesis cost; WF08 stays the per-record brain, WF10 the market-level view.
**Verified by simulation (vm sandbox without URL global, 19 checks PASS):** window+region filters (5 considered → 4 in window → 3 after filters); 2 competitor groups from the real live monitor rows (priced row → confidence 80); angles incl. after_refusals freq 2 with examples; aggregate-only signals; 1 plan row with no-outreach next_action; seed 7 rules on empty tab and 0 when populated; agent_requests 21 cols with full count summary; exact column counts 17/9/14/12/5; repeated run byte-identical modulo timestamps; no contacts anywhere in output.
**Files:** `n8n/workflows/10_competitor_audience_intelligence_aggregator.json`, `docs/N8N_WORKFLOW_10_COMPETITOR_AUDIENCE_INTELLIGENCE_AGGREGATOR_RU.md`, `docs/WF10_TABLE_SCHEMAS.md`, `docs/WF10_COMPETITOR_AUDIENCE_INTELLIGENCE_AGGREGATOR_PLAN.md`, `docs/TABLE_SCHEMA.md`.

---

## DEC-103 — Workflow 09 URL Helpers Made Sandbox-Safe (root cause of the live ?context= leak)

**Date:** 2026-06-11
**Context:** Live run #3 (`avito_req_20260611_184324`) passed the relevance filter, but `source_url`/`post_url` in raw and monitor rows still carried Avito `?context=` tracking params — although the v005 `canonUrl` stripped them in plain-Node tests. **Root cause found by sandbox simulation:** `normUrl`/`canonUrl`/`slugText` depended on the `new URL()` constructor; the n8n Code-node sandbox does not expose the `URL` global, so the try/catch fallbacks silently kept the query string (and blanked the decoded-slug relevance evidence — relevance still worked via title/description, which is why hard_skipped=7 was correct).
**Decision (patch v006):** rewrote the three helpers as **pure regex/string implementations with no URL-constructor dependency**. `canonUrl` strips query+hash only when the path carries a listing id (`_<6+ digits>` or `/<7+ digits>`) — safe; non-listing URLs keep their query (start/search URL matching unchanged). `slugText` decodes the slug via string ops, so slug evidence now also works in the restricted sandbox. Dedup unchanged: `dedup_key=avito::classified::avito_listing_<id>`. Registry/raw rows copy the canonical values.
**Verified by simulation (vm context WITHOUT the URL global, 12 checks PASS):** fixture first run 6 raw/6 registry/monitor 5/skipped 1 unchanged; fixture duplicate run unchanged; live batch modeled on run #3 with `?context=`-bearing URLs → accepted rows' source_url/post_url canonical (no `?`), registry rows canonical, hard-skip/duplicate/unique counts identical to the real run pattern (4 hard_skipped / 3 relevant / 2 unique / 1 duplicate), dedup keys stable.
**Files:** `n8n/workflows/09_avito_classifieds_listing_connector.json` (versionId `…v006-canonical-url-sandbox-safe-20260611`), `docs/N8N_WORKFLOW_09_AVITO_CLASSIFIEDS_CONNECTOR_RU.md`, `docs/STAGE_3_3_TEST_RESULTS.md`.

---

## DEC-102 — Stage 3.3 CLOSED / APPROVED (Avito/Classifieds Listing Connector)

**Date:** 2026-06-11
**Context:** Live run #3 (`avito_req_20260611_184324`, actor `fatihtahta~avito-russia-scraper`): `actor_items_received=10; structurally_valid_items=10; invalid_items=0; business_relevant_items=3; hard_skipped_items=7; unique=2; duplicates=1; over_pipeline_limit=0`. All 7 hard-skipped false positives (legal-address/query-only) were filtered **before** raw/registry writes; the 3 accepted rows are genuine credit-broker listings; registry gained exactly the 2 unique keys (`avito_listing_8000151804`, `avito_listing_8011965808`). WF08 live handoff (filters set, `deterministic_first`, all LLM flags false): `monitor_queue +2`, `technical_errors=0`, Claude calls=0, business fields populated (terms «от 500 ₽» / «Цена договорная», competitor_strength 79, content_idea_score 45, quality_score 70, `parse_method=deterministic_pre_route`).
**Decision:** **Stage 3.3 is CLOSED / APPROVED.** All closure criteria pass: fixture first run ✅, fixture duplicate run ✅, fixture WF08 handoff ✅, live Apify transport ✅, live business relevance filter ✅, hard false positives skipped pre-raw/registry ✅, raw/registry consistency ✅, WF08 live handoff ✅, technical_errors=0 ✅, Claude cost $0 ✅. One cosmetic issue found (`?context=` in stored URLs — does not affect dedup/relevance/routing) and fixed by DEC-103 (v006); verifying canonical URLs is a **watch item for the next routine live run**, not a closure blocker. Avito is the project's first stable live source; the DEC-099 gate for WF10 is satisfied.
**Files:** `docs/STAGE_3_3_TEST_RESULTS.md`, `docs/STAGE_3_3_AVITO_CLASSIFIEDS_CONNECTOR_PLAN.md`, `docs/STAGE_3_3_SOURCE_DECISION_PLAN.md`, `docs/ROADMAP.md`, `docs/NEXT_ACTIONS.md`.

---

## DEC-101 — Competitor Ad Intelligence Is a First-Class Capability

**Date:** 2026-06-11
**Context:** The stakeholder's primary need is understanding how competitors advertise (headlines, price anchors, payment conditions, pain promises, objections handled, channels, repeated semantics, weak points, content opportunities) — not only lead discovery.
**Decision:** Competitor Ad Intelligence is treated as a first-class capability of the Business Scout Agent with its own end-to-end pipeline documentation: source connectors (WF09 + future) → `raw_market_records` → WF08 one-record analysis → WF10 aggregation → `competitor_profiles` / `market_angles` / `content_positioning_plan`. See `docs/COMPETITOR_AD_INTELLIGENCE_PLAN.md`.
**Alternatives considered:** keep it an implicit by-product of lead routing (rejected — it is the stakeholder's stated core value and needs its own design target).

---

## DEC-100 — Niche Pack System Planned to Replace Hardcoded Niche Rules

**Date:** 2026-06-11
**Context:** The DEC-095 relevance filter and WF08's deterministic enrichment hardcode credit-broker vocabulary. A second niche or second source would duplicate and drift these lists.
**Decision:** Plan a versioned **Niche Pack System** (`niches/*.yaml`: `niche_id`, keywords, strong phrases, hard negatives, intent/offer/pain patterns, platform priorities, scoring weights, tighten-only contact-policy overrides, risk rules, source priorities). WF09/WF08/WF10 will consume packs instead of inline lists. Migration happens when the second source connector or second niche appears; nothing is refactored now. See `docs/NICHE_PACK_SYSTEM_PLAN.md`.
**Alternatives considered:** refactor WF09/WF08 to packs immediately (rejected — premature for one niche/one source; Stage 3.3 closes on hardcoded rules).

---

## DEC-099 — WF10 Market Intelligence Aggregator Planned, Build Gated on One Stable Live Source

**Date:** 2026-06-11
**Context:** WF08 answers "what is this one record?"; the stakeholder also needs "what is happening in the market overall?" (competitor profiles, recurring angles, audience activity, content positioning).
**Decision:** Workflow 10 (Market Intelligence Aggregator) is **planned, not built**. Inputs: `monitor_queue`/`content_queue`/`review_queue` (+ optional `raw_market_records`), 7/14/30-day windows, niche/platform/region/service_type filters. Future output tables: `competitor_profiles`, `market_angles`, `audience_activity_signals`, `content_positioning_plan`, `source_confidence_rules` (field lists in the plan). Build starts only after at least one live source is stable (Avito with the DEC-095 filter passing live runs). See `docs/WF10_COMPETITOR_AUDIENCE_INTELLIGENCE_AGGREGATOR_PLAN.md`.
**Alternatives considered:** build WF10 now on fixture data (rejected — aggregation over unstable/false-positive-polluted input would lock in wrong shapes).

---

## DEC-098 — No Automatic Outreach by Default

**Date:** 2026-06-11
**Context:** The business wants actionable contacts for manager handoff; automation pressure could drift toward auto-DM/auto-email.
**Decision:** **No automatic outreach by default** — no auto-DM, auto-email, or auto-call anywhere in the system. Outreach is a manual manager action on records with `contact_use_policy=manager_allowed` and source evidence. Mass auto-DM may be considered much later only as a separate, explicitly approved project with its own legal review. Enforced in `docs/CONTACT_AND_OUTREACH_POLICY.md` §4.
**Alternatives considered:** opt-in auto-DM for hot leads (rejected — legal/platform risk, brand risk, out of scope).

---

## DEC-097 — Public Contacts Only, With Explicit Source Evidence (Contact & Outreach Policy)

**Date:** 2026-06-11
**Context:** Managers need real public contacts (phone/email/telegram/profile/form) for handoff; at the same time hidden-phone extraction, private-chat scraping, and "just in case" harvesting are explicitly forbidden by the operator.
**Decision:** Adopt `docs/CONTACT_AND_OUTREACH_POLICY.md` as binding policy: contact fields are `contact_public` (verbatim, never reconstructed), `contact_channel` (phone/email/telegram/profile/form/unknown), `contact_source_url` (**mandatory evidence** when a contact is present), `contact_confidence`, `contact_use_policy` (manager_allowed / manual_review / no_outreach / aggregate_only). Public contacts only; no platform-protection bypass; no private accounts without explicit public contact; leads without public contact route to `review_queue`/`lead_signal` (never `results`/contact); audience analysis is aggregate-only; manager handoff requires source evidence.
**Alternatives considered:** per-source ad-hoc rules (rejected — one binding policy enforced at connector, analyzer, and aggregator layers).

---

## DEC-096 — One-Source-at-a-Time Connector Pattern (Do NOT Build All Social Parsers at Once)

**Date:** 2026-06-11
**Context:** Stage 3.4 evaluates Telegram, VK, Instagram, Dzen, review platforms/maps, and competitor websites as future sources. Building several parsers in parallel multiplies risk, cost, and unvalidated code.
**Decision:** Every source follows the proven connector pattern (source connector → `raw_market_records` → WF08 → aggregator/report), added **one at a time** and stabilized on live data before the next starts. Recommended order: 1) stabilize Avito live; 2) Telegram public-channel feasibility (preview parsing, no MTProto without separate risk review); 3) VK public groups/posts via official API; 4) review platforms/maps; 5) Dzen; 6) Instagram only after a separate risk review. See `docs/STAGE_3_4_SOCIAL_SOURCE_PARSING_STRATEGY.md`.
**Alternatives considered:** parallel multi-source build (rejected — each source has distinct access/legal/quality risks needing individual validation).

---

## DEC-095 — Workflow 09 Live Business Relevance Filter (Stage 3.3 cannot close without it)

**Date:** 2026-06-11
**Context:** Live Apify retest #2 (`agent_request_id=avito_req_20260611_001222`, actor `fatihtahta~avito-russia-scraper`) proved the transport works: `actor_items_received=10; valid_items=10; invalid_items=0; unique=2; duplicates=1; over_pipeline_limit=7`. But **both unique rows were business false positives** — legal-address services (`yuridicheskiy_adres_dlya_ooo_ot_sobstvennika`, `ne_massovyy_yuridicheskiy_adres_ot_sobstvennika`), not credit-broker offers — while a relevant credit-broker row was a duplicate. Pre-patch WF09 classified by generic service words and let the search query imply relevance; `pipeline_limit` also applied to arbitrary first actor rows, so junk consumed the write budget.
**Decision (patch v005):**
- **Relevance evidence = title + description + decoded URL slug + category only.** The search query **never** makes a listing relevant (query-only relevance → rejected). Term sets include Cyrillic + transliterated forms (slugs are translit).
- **Strong positive phrases** (кредитный брокер, помощь в получении кредита, кредит после отказов, ипотечный брокер, рефинансирование ипотеки, кредит для бизнеса, банковские гарантии, …) → `competitor_activity`/`competitor_listing`.
- **Hard negatives** (юридический адрес, адрес для ООО, немассовый/массовый адрес, регистрация ООО/ИП, бухгалтерия, эквайринг, POS-терминал, касса, печать, штамп, ЭЦП, аренда офиса, коворкинг, юридические услуги, оборудование, …) without strong credit/broker evidence → live `irrelevant_live_false_positive`, `dedup_status=hard_skipped`: **not written to `raw_market_records` (by default) or `market_record_registry`**, counted in `hard_skipped_items`. Optional `hard_skip_debug_audit=false` config flag can write them to raw for debugging (registry never).
- **Weak finance evidence** (кредит/займ/ипотека/рефинансирование/просрочки… in listing evidence) → `market_signal`/`source-candidate-style` content routing; no evidence at all → hard skip (query-only rejection).
- **Pipeline order:** score ALL structurally valid actor items first → filter hard negatives → apply `pipeline_limit` to **accepted business-relevant records only** (hard negatives never consume the cap). `pipeline_limit=10` for the next live smoke (`actor_limit=10` unchanged).
- **Summary counts:** `result_summary`/Final Summary now report `actor_items_received / structurally_valid_items / invalid_items / business_relevant_items / hard_skipped_items / unique / duplicates / over_pipeline_limit`.
- **Canonical Avito URL:** tracking query/context params stripped from `source_url`/`post_url` when the path carries a listing id (safe); `dedup_key` unchanged (`avito::classified::avito_listing_<id>`).
- **Fixture path preserved:** `fixture_mode=true`/`live_mode=false` defaults, `max_items=6` (5 competitor + 1 POS-terminal control), control still written as `irrelevant` → `skipped_log` prediction, duplicate behavior unchanged.
**Reason:** Apify transport works, but Stage 3.3 cannot close while live runs register non-broker listings as competitors; relevance must come from listing evidence, never from the query that found it.
**Verified by simulation (Node harness, 31 checks PASS):** fixture first run 6 raw/6 registry/monitor 5/skipped 1 unchanged; fixture duplicate run unchanged; modeled live batch with the two real legal-address items + POS terminal + query-only cleaning listing + legal-services listing → all 5 `hard_skipped` (0 raw/0 registry), known broker → `duplicate_in_registry`, 2 strong brokers unique, weak-finance consultation → `market_signal` accepted, search-URL item → `invalid`; counts `10/9/1/4/5/3/1/0`; pipeline_limit=3 with 4 leading hard negatives → 3 brokers written + 2 over_pipeline_limit (cap not consumed by junk); debug audit writes hard-skips to raw only.
**Files:** `n8n/workflows/09_avito_classifieds_listing_connector.json`, `docs/N8N_WORKFLOW_09_AVITO_CLASSIFIEDS_CONNECTOR_RU.md`, `docs/STAGE_3_3_TEST_RESULTS.md`, `docs/STAGE_3_3_AVITO_CLASSIFIEDS_CONNECTOR_PLAN.md`, `docs/NEXT_ACTIONS.md`, `docs/DECISIONS.md`, `docs/AGENT_LOG.md`, `core/hot/recent.md`.

---

## DEC-094 — Workflow 09 Live Apify Mode: Strict Valid-Listing Guard, actor_limit vs pipeline_limit Split, and Invalid-Item Counting (after a failed first live smoke)

**Date:** 2026-06-11
**Context:** First live Apify smoke (`agent_request_id=avito_req_20260610_234404`, actor `fatihtahta~avito-russia-scraper`, `Source=apify_live`) **executed the real Apify call** but useful listing extraction **failed**: the actor returned 1 item with empty `url`/`post_url`/`title`/`offer`/`seller`, and only the Avito **search URL** in `query`. WF09 (pre-patch) wrongly normalized it to `record_type_hint=market_signal`/`touchpoint_type=classified_offer`, `dedup_key=avito::classified::avito_url_37f07315`, `approval_status=new`, and **registered it as a unique record** — polluting `raw_market_records` + `market_record_registry` with a non-listing. Diagnosis: **LIVE SCRAPE PARTIAL FAIL / NORMALIZATION GUARD FAIL** (the live call worked; extraction + validation did not). Also learned: this actor's `limit` minimum is ~10, so a pipeline cap of 3 cannot be enforced at the actor level.
**Decision (patch v004):**
- **Task A — config split (`Set Avito Connector Config`):** add `actor_limit=10` (sent to Apify) and `pipeline_limit=3` (how many **valid** normalized listings WF09 writes after validation). `live_max_items=3` kept as a legacy alias of `pipeline_limit`. `max_items=6` stays the fixture output count. Defaults unchanged: `fixture_mode=true`, `live_mode=false`. `apify_actor_id='fatihtahta~avito-russia-scraper'`; `start_urls=[valid Avito search URL]`.
- **Task B — Apify body:** `{ "limit": {{ $json.actor_limit || 10 }}, "startUrls": {{ JSON.stringify($json.start_urls) }} }` — no `queries`/`maxItems`/`region`.
- **Task C — robust field aliases (`Normalize Avito Listings`):** accept varied actor shapes — url from `url|sourceUrl|source_url|listingUrl|adUrl|link`, title from `title|name|heading`, price from `priceText|price|price_text`, seller from `sellerName|seller|seller_name|userName`, description from `description|text`, location from `location|address|region`, profile from `profileUrl|sellerUrl`, query from `parentSourceUrl|first start_url`. No invented data; description capped 800.
- **Task D — strict valid-listing guard:** a live item is valid only if `listing_url` is non-empty, is an `avito.ru` URL, is **not** a `start_url`, is **not** a search/category URL (no `?q=`, must contain a listing id `_<6+ digits>` or `/<7+ digits>`), **and** has at least one of title/description/price. Invalid items (and valid items beyond `pipeline_limit` in live mode) are **NOT** appended to `market_record_registry`, **NOT** counted as unique, **NOT** written as `competitor_activity`, and **NOT** written to `raw_market_records` (skipped, not polluting). `dedup_status` = `invalid` / `over_pipeline_limit`. Fixtures all pass the guard → fixture behaviour unchanged.
- **Task E/F — counts + debug:** `Final Summary` and `agent_requests.result_summary` now report `actor_items_received`, `valid_items`, `invalid_items`, `unique`, `duplicates`, `skipped` (e.g. failed-smoke shape → `actor_items_received=1; valid_items=0; invalid_items=1; unique=0; duplicates=0; skipped=0`). When invalid items exist, `notes` carries: "Live Apify returned item(s), but no valid listing_url/title/price fields were found. Inspect Apify node output and actor schema." + a `raw_response_preview` capped at 300 chars (no full JSON to Sheets). `next_action` becomes "Do NOT run Workflow 08 (valid_items=0): inspect Apify output / actor schema…" when nothing valid was written.
- **Unchanged/preserved:** `active=false`; fixture first run (6 raw / 6 registry) and duplicate run (registry +0) identical; 40/15/21-column outputs; MSK `+03:00` timestamps; header-auth (no token in file/URL); WF09 still writes only `agent_requests`/`raw_market_records`/`market_record_registry`, no business tabs, no auto-handoff. WF04/05/06/07/08 untouched.
**Reason:** a connector must never register an empty/search-only actor response as a real competitor listing; validating the listing URL + minimal content at the source keeps `raw_market_records`/registry clean and makes a failed live extraction observable (counts + debug note) instead of silently polluting the dataset. Splitting `actor_limit` (provider-imposed ≥10) from `pipeline_limit` (our write budget) lets small smokes stay cheap-to-review without fighting the actor's minimum.
**Verified by simulation:** JSON VALID; `active=false`; failed-smoke item → `invalid` (`no_listing_url`), 0 raw / 0 registry, summary exactly `actor_items_received=1; valid_items=0; invalid_items=1; unique=0; duplicates=0; skipped=0`, "Do NOT run WF08" + debug note; search-URL-as-url item → `invalid` (`search_or_start_url_not_a_listing`); fixture first run unchanged (6 raw / 6 registry, routes monitor 5 / skipped 1); fixture duplicate run unchanged (registry +0, duplicates 6); 5 valid live listings with `pipeline_limit=3` → 3 unique written + 2 `over_pipeline_limit` (raw 3 / registry 3); body uses `limit`+`startUrls` only; no token in URL/file; no real keys/Spreadsheet ID; MSK preserved, no bare `new Date().toISOString()`; no tool_use/KEY=VALUE; 40/15/21 columns intact.
**Files:** `n8n/workflows/09_avito_classifieds_listing_connector.json`, `docs/N8N_WORKFLOW_09_AVITO_CLASSIFIEDS_CONNECTOR_RU.md`, `docs/STAGE_3_3_TEST_RESULTS.md`, `docs/STAGE_3_3_AVITO_CLASSIFIEDS_CONNECTOR_PLAN.md`, `docs/COSTS_AND_LIMITS.md`, `docs/NEXT_ACTIONS.md`, `docs/DECISIONS.md`, `docs/AGENT_LOG.md`, `core/hot/recent.md`.

---

## DEC-093 — First Live Avito Smoke Actor Selected: `fatihtahta~avito-russia-scraper` (startUrls + limit; actor min limit ~10)

**Date:** 2026-06-10
**Context:** Stage 3.3 fixture + WF08 handoff passed; the next step is the first real Avito scrape. An Apify actor was selected for the first live smoke.
**Decision:** Use Apify actor **`fatihtahta~avito-russia-scraper`** (REST id with `~`, human slug `fatihtahta/avito-russia-scraper`) for the first live smoke. Its documented input is `startUrls` + `limit`; the actor's `limit` **minimum is ~10**, so the small-smoke write budget is enforced in-pipeline (see DEC-094 `pipeline_limit`), not via the actor `limit`. WF09 config carries `apify_actor_id`, `start_urls` (a Moscow «кредитный брокер» search URL), `actor_limit=10`, `pipeline_limit=3`; the live Apify node sends `{ "limit", "startUrls" }` and uses HTTP Header Auth (`Authorization: Bearer <APIFY_TOKEN>`, bound in n8n; no token in file). Defaults stay `fixture_mode=true`/`live_mode=false`; the node runs only on the IF false branch.
**Reason:** picks a concrete, documented Avito actor so the first live smoke is reproducible, while keeping the connector fixture-safe and secret-free by default.
**Files:** `n8n/workflows/09_avito_classifieds_listing_connector.json`, `docs/N8N_WORKFLOW_09_AVITO_CLASSIFIEDS_CONNECTOR_RU.md`, `docs/STAGE_3_3_TEST_RESULTS.md`.

---

## DEC-092 — Stage 3.3 Competitor Ad / Semantic Intelligence Quality Patch: WF09 fixture-count clarity + richer service_hint/keywords + safe Apify header-auth; WF08 deterministic Avito/classified offer/terms/score enrichment

**Date:** 2026-06-10
**Context:** Workflow 09 fixture tests + the Workflow 08 deterministic handoff passed (monitor_queue=5 / skipped_log=1 / technical_errors=0 / Claude=0), all **fixture-mode only** (no real Avito scrape: `fixture_mode=true`, `live_mode=false`, Apify HTTP node did not run, source cost $0). Two quality gaps surfaced: (a) WF09 `max_items=5` contradicted the 6 emitted fixtures (5 competitors + 1 irrelevant control), service_hint was coarse (general broker mislabeled `business_credit`), and keywords were generic; the Apify node had no auth wiring; (b) WF08 routed Avito competitors correctly but produced weak business fields — `offer_text` held the query not the listing title, `terms` empty, `content_idea_score=1`, and specific service themes were lost.
**Decision (patch — WF09 v002, WF08 v009):**
- **WF09 Task A (fixture count):** default `max_items=6`; new `include_irrelevant_control_fixture=true`. In fixture mode `max_items` = total emitted records (competitors + the irrelevant control); `Build Fixture` emits `min(maxItems, …)` and always keeps the control when the flag is on. `agent_requests.requested_limit` = actual fixture output count in fixture mode (matches `result_summary`). Default = 6 (5 competitor + 1 control).
- **WF09 Task B (service_hint + keywords):** `service_hint` ∈ {`credit_broker`, `business_credit` (only when ИП/ООО/"для бизнеса"/оборотные/тендерные/банковские гарантии are explicit — not bare "бизнесу"), `credit_after_refusals` (после отказов / просрочки / плохая КИ), `mortgage_refinance` (ипотека/рефинансирование/ставка), `unknown` (irrelevant)}. `semantic_keywords` now extracts concrete ad/semantic phrases (помощь в получении кредита, после отказов, без предоплаты, оплата за результат, работа по договору, ИП/ООО, оборотные кредиты, тендерные займы, банковские гарантии, рефинансирование, снижение ставки, …), deduplicated, comma-separated. `manager_note` preserves offer + price + terms/keywords + platform=Avito/classifieds.
- **WF09 Task C (Apify auth, no secrets):** the live `Apify Avito Classifieds Actor Request` now uses `authentication=genericCredentialType` + `genericAuthType=httpHeaderAuth` with a **placeholder** credential (`Apify API - Marketing Scout`). Operator binds an HTTP Header Auth credential (header `Authorization`, value `Bearer <APIFY_TOKEN>`). **No real token / actor id** in JSON (actor id templated from `apify_actor_id=PASTE_AVITO_ACTOR_ID`). Runs **only** on the IF false branch (`fixture_mode=false`); never in fixture mode.
- **WF08 Task D/E (deterministic classified enrichment):** a new `classifiedCompetitorDet()` builder fires **only** for `source_type=classified` + `platform=avito` rows whose `text_context` matches the WF09 signature `^Avito объявление:` (so WF07 manual avito records are untouched). It parses title/price/location/seller/description/query and sets: `offer_text`=listing title; `terms`=price + explicit conditions (без предоплаты, оплата за результат, работа по договору, консультация, после отказов, с просрочками, плохая КИ, пакет документов, банковские гарантии, рефинансирование, снижение ставки); `service_type`=preserved specific `service_hint`; `detected_need`=`probable_need`; `company_name`=competitor/seller; a competitor-ad `reason` (offer/price/semantic angle + Avito/classifieds + monitor). Scores: `competitor_strength` 75–85 (specificity), `lead_signal_score`=1 (competitor ad, not client demand), `content_idea_score` 35/45/50–55 (offer/price/terms/strong-pain semantics), `quality_score` 70–85 (completeness). Irrelevant control stays all-1 / `skipped_log`. `Build Deterministic Row` now emits `terms:str(det.terms)` and uses `det.reason` when present. No-contact safety unchanged; **no Claude in deterministic_first**.
- **Routing/baseline unchanged:** simulation confirms the 12-record Stage 3.2 deterministic baseline routes identically pre/post patch (monitor 5 / content 4 / skipped 2 / review 1 — the post-DEC-087 state); only Avito competitor **business-field values** improve. Source-handoff filters (DEC-091), `llm_enrichment_test_mode`, 35 business fields, MSK timestamps, and the WF09 40/15/21-column outputs all preserved.
**Reason:** the connector and analyzer were structurally correct but the competitor-intelligence payload was thin; extracting offer/price/terms/semantics deterministically (gated to WF09-origin rows) turns Avito rows into real Competitor Ad / Semantic Intelligence without LLM cost and without disturbing any routing or the approved baseline. Fixture-count clarity removes a confusing config contradiction; header-auth wiring makes live mode ready without embedding secrets.
**Verified by simulation:** both JSON VALID; `active=false`; defaults `fixture_mode=true`/`live_mode=false`/`max_items=6`/`include_irrelevant_control_fixture=true`; WF09 fixtures → service_hint credit_broker/credit_after_refusals/business_credit/credit_after_refusals/mortgage_refinance/unknown, concrete keywords, manager_note with offer+price+terms; WF08 handoff (filtered to the avito run) → monitor_queue=5 / skipped_log=1, `deterministic_pre_route×5 + deterministic_irrelevant_skip×1`, competitor_strength 78–85, lead=1, content_idea 50–55, quality 78–82, offer_text=title, terms=price+conditions, service_type themes preserved, irrelevant all-1; 12-record baseline route counts identical to pre-patch HEAD; Apify node header-auth + placeholders only; no real keys/Spreadsheet ID; no tool_use; no KEY=VALUE; WF04/05/06/07 untouched.
**Files:** `n8n/workflows/09_avito_classifieds_listing_connector.json`, `n8n/workflows/08_touchpoint_analyzer.json`, `docs/N8N_WORKFLOW_09_AVITO_CLASSIFIEDS_CONNECTOR_RU.md`, `docs/N8N_WORKFLOW_08_TOUCHPOINT_ANALYZER_RU.md`, `docs/STAGE_3_3_TEST_RESULTS.md`, `docs/STAGE_3_3_AVITO_CLASSIFIEDS_CONNECTOR_PLAN.md`, `docs/STAGE_3_3_SOURCE_DECISION_PLAN.md`, `docs/LEAD_DISCOVERY_ARCHITECTURE.md`, `docs/LEAD_DATA_MODEL_PLAN.md`, `docs/SOCIAL_CLASSIFIED_SOURCE_MATRIX.md`, `docs/NEXT_ACTIONS.md`, `docs/COSTS_AND_LIMITS.md`, `docs/AGENT_CAPABILITIES.md`, `docs/ROADMAP.md`, `docs/AGENT_LOG.md`, `core/hot/recent.md`.

---

## DEC-091 — Workflow 08 Gains Optional Source-Handoff Filters (agent_request_id / platform / source_type) Applied Before max_records; Empty Filters Keep the Deterministic Baseline Unchanged

**Date:** 2026-06-10
**Context:** Workflow 09 (Avito/Classifieds Connector) fixture tests passed and wrote 6 `raw_market_records` rows under `agent_request_id=avito_req_20260610_214709` (`platform=avito`, `source_type=classified`; 5 competitor + 1 irrelevant). Workflow 08 reads **all** `raw_market_records`, so a Stage 3.3 handoff run would also process old Stage 3.1/3.2 rows — there was no way to scope the analyzer to one connector run. `llm_test_batch_indexes` is **not** a source filter (it selects positions 1/7/11/12 for the small LLM test), so it must not be repurposed for handoff.
**Decision (patch v8):** Add three **optional** source-handoff filters to `Set Analyzer Config`, all **empty (`''`) by default**:
- `agent_request_id_filter` — if non-empty, process only `raw_market_records` rows whose `agent_request_id` matches (exact, trimmed).
- `platform_filter` — if non-empty, process only rows whose `platform` matches (case-insensitive).
- `source_type_filter` — if non-empty, process only rows whose `source_type` matches (case-insensitive).
**Behavior:**
- Implemented in `Filter & Select Records` as additional `continue` guards **after** the existing `dedup_status=unique` / `approval_status` / irrelevant checks and **before** the `max_records` cap and `batch_index` assignment — i.e. filters apply **before `max_records` and before per-record processing**.
- **Empty filters = current behavior unchanged** — the deterministic_first baseline (Test 3, routes 6/3/1/2) and the LLM tests (C2–C4) select exactly as before.
- Filters are **independent of `llm_enrichment_test_mode` / `llm_test_batch_indexes`** and work in both `deterministic_first` and `llm_enriched` modes; `llm_enrichment_test_mode` is preserved.
- No other node changed; MSK `+03:00` timestamps, dynamic route sheet, 35-field output, deterministic fallback, and "no source APIs" all intact. `active=false`.
**Stage 3.3 handoff config:** `agent_request_id_filter="avito_req_20260610_214709"`, `platform_filter="avito"`, `source_type_filter="classified"`, `max_records=6`, `analysis_mode="deterministic_first"`, `llm_enrichment=false`, `llm_enrichment_test_mode=false`. **Expected:** `monitor_queue=5`, `skipped_log=1`, `content_queue=0`, `review_queue=0`, `technical_errors=0`; `parse_method` = `deterministic_pre_route` ×5 + `deterministic_irrelevant_skip` ×1; Claude calls=0. After the test, clear the filters.
**Reason:** scoping a connector handoff to one `agent_request_id` is the correct, minimal way to keep WF08 idempotent across accumulating `raw_market_records` history without touching the analyzer's routing logic; doing it pre-`max_records` guarantees the cap counts only the targeted run's rows; keeping the filters empty by default preserves the approved baseline and all prior tests.
**Verified by simulation:** `python3 -m json.tool` VALID; `active=false`; `Set Analyzer Config` exposes the 3 filters (default `''`); `Filter & Select Records` — empty filters → identical selection (mixed dataset: 3 old + 6 avito → 9 selected); handoff filters → exactly the 6 avito rows (batch_index 1–6, 5 competitor_activity + 1 irrelevant, all `platform=avito`/`source_type=classified`/matching `agent_request_id`); `max_records=3` with filters → first 3 avito rows (old rows excluded by filter, proving filter-before-max_records); `llm_enrichment_test_mode=true` still filters by batch_index independently. No real keys / Spreadsheet ID; no `tool_use`; no `KEY=VALUE`; WF04/05/06/07/09 untouched.
**Files:** `n8n/workflows/08_touchpoint_analyzer.json`, `docs/N8N_WORKFLOW_08_TOUCHPOINT_ANALYZER_RU.md`, `docs/STAGE_3_2_TEST_RESULTS.md`, `docs/STAGE_3_3_TEST_RESULTS.md`, `docs/LEAD_DISCOVERY_ARCHITECTURE.md`, `docs/NEXT_ACTIONS.md`, `docs/DECISIONS.md`, `docs/AGENT_LOG.md`, `core/hot/recent.md`.

---

## DEC-090 — Stage 3.3: Avito/Classifieds Listing Connector (Workflow 09) Built as the First Real Source Connector — Fixture-First, Deterministic, No-LLM, Competitor Ad/Semantic Intelligence; Writes Only Intake Sheets, No Auto-Handoff

**Date:** 2026-06-10
**Context:** Stage 3.1 (manual intake, WF07) and Stage 3.2 (Touchpoint Analyzer, WF08) are closed; the connector → `raw_market_records` → registry dedup → analyzer → route contract is proven. DEC-084 recommended the **Avito/Classifieds Listing Connector** as the first real source. The stakeholder specifically cares about **competitor intelligence**: competitors, offers, ad wording, positioning, prices/terms, semantic keywords, targeted pains, ad channels — i.e. **Competitor Ad Intelligence / Semantic Intelligence**.
**Decision:** Build `Workflow 09 — Avito Classifieds Listing Connector` (`active=false`) as the first real source connector, **fixture-first and deterministic (no LLM, no real Apify call by default)**.
- **Architecture:** Manual Start → Set Avito Connector Config → IF `fixture_mode` → (Build Fixture Avito Listings | Apify Avito Classifieds Actor Request) → Normalize Avito Listings → Read market_record_registry → Deduplicate Listings → Build raw_market_records Rows → Append raw_market_records → (Build market_record_registry Rows → Append; Build agent_requests Row → Append) → Final Summary. 18 nodes incl. 3 sticky notes.
- **Defaults:** `fixture_mode=true`, `live_mode=false`, `source_type=classified`, `platform=avito`, `request_type=classified_competitor_discovery`, `region=Москва/МО`, `service_focus=credit_broker`, `max_items=10`, `approval_status_for_unique=new`, `write_duplicate_audit=true`, `duplicate_next_action=monitor_duplicate`; placeholders `PASTE_AVITO_ACTOR_ID` / `PASTE_APIFY_TOKEN_OR_USE_CREDENTIAL` / `PASTE_SPREADSHEET_ID`. MSK helpers (`moscowIsoNow`/`moscowStamp`); ids `avito_req_*` / `avito_rec_*` / `avito_*`.
- **Fixture mode (default, $0):** 6 representative listings (broker от 30 000 ₽, cheap broker от 500 ₽, business/ИП/ООО, after-refusals, mortgage/refinance, irrelevant POS-terminal). No Apify call.
- **Live Apify mode (documented, disabled by default):** `Apify Avito Classifieds Actor Request` runs only when `fixture_mode=false`; posts `search_queries`/`max_items` to the actor; auth via an n8n credential or token (no real token/key in the file); `onError=continueRegularOutput`. No direct Avito scraping.
- **Normalization (Competitor Ad/Semantic Intelligence):** classifies from **title+description+category only** (not the search query) into `record_type_hint`/`touchpoint_type` (competitor_activity/competitor_listing · market_signal/classified_offer · irrelevant/irrelevant_source); extracts `semantic_keywords`, `ad_channel_hint=classifieds`, `competitor_name`, `service_hint`, `probable_need`, `manager_note` ("Семантика/оффер конкурента: …"); `contact_public` only if explicitly present (never invented); MSK timestamps.
- **Dedup:** stable `dedup_key=avito::classified::avito_listing_<id>` (or `…avito_url_<hash>`); `text_hash`=hash(title+description+price); duplicate-in-registry → `dedup_status=duplicate_in_registry`/`approval_status=duplicate`/`next_action=monitor_duplicate` (competitor) or `ignore` (irrelevant), not appended to registry; unique → appended.
- **Writes ONLY** `agent_requests` (21, `status=completed`, `source_scope=classified_listings`, `platforms=avito`, `result_summary=total/unique/duplicates/skipped`, `next_action='Run Workflow 08 on collected raw records manually'`), `raw_market_records` (40, all rows when `write_duplicate_audit=true`), `market_record_registry` (15, unique only). **Never** writes results/review_queue/monitor_queue/content_queue/skipped_log/technical_errors — Workflow 08 owns routing. **No auto-handoff** to Workflow 08 (manual only).
- **No schema change** (reuses the exact 40/15/21 columns from WF07); WF04/05/06/07/08 untouched; Stage 3.2 not broken.
**Reason:** Avito is the lowest-complexity real source, structurally closest to the existing URL/listing model (reuses URL-normalize + `*_registry` dedup + the Apify-actor pattern), and directly produces competitor offer/semantic/ad intelligence — the stakeholder's priority. Fixture-first keeps the build verifiable at $0 with no scraping risk; deterministic normalization keeps the connector free of LLM cost and feeds the proven deterministic_first analyzer.
**Verified by simulation:** `python3 -m json.tool` VALID; `active=false`; all code nodes compile; fixture run 1 (empty registry) → 6 raw, 6 unique registry, 1 agent_requests (completed), predicted routes `monitor_queue=5`/`skipped_log=1`, `skipped_count=1`; fixture run 2 (populated registry) → all 6 `duplicate_in_registry`, raw +6 (audit), registry +0, competitor dup `next_action=monitor_duplicate` / irrelevant `ignore`; raw=40 cols, registry=15 cols, agent_requests=21 cols (exact WF07 match); no business-tab writes; MSK helpers present, no bare `new Date().toISOString()`; no real keys / Spreadsheet ID (placeholders only); no `tool_use`; no `KEY=VALUE`; fixture runs without Apify.
**Files:** `n8n/workflows/09_avito_classifieds_listing_connector.json`, `docs/N8N_WORKFLOW_09_AVITO_CLASSIFIEDS_CONNECTOR_RU.md`, `docs/STAGE_3_3_AVITO_CLASSIFIEDS_CONNECTOR_PLAN.md`, `docs/STAGE_3_3_TEST_RESULTS.md`, `docs/STAGE_3_3_SOURCE_DECISION_PLAN.md`, `docs/SOCIAL_CLASSIFIED_SOURCE_MATRIX.md`, `docs/LEAD_DISCOVERY_ARCHITECTURE.md`, `docs/LEAD_DATA_MODEL_PLAN.md`, `docs/NEXT_ACTIONS.md`, `docs/COSTS_AND_LIMITS.md`, `docs/AGENT_CAPABILITIES.md`, `docs/ROADMAP.md`, `docs/AGENT_LOG.md`, `core/hot/recent.md`.

---

## DEC-089 — Stage 3.2 Closed: Touchpoint Analyzer APPROVED — deterministic_first baseline + compact LLM enrichment APPROVED WITH WATCH ITEM (Test C4 PASS); Default Stays deterministic_first

**Date:** 2026-06-10
**Context:** Test C4 (`docs/STAGE_3_2_TEST_RESULTS.md`) ran the 4 fixtures (batch_index 1, 7, 11, 12) against the v7 specialized-schema patch (DEC-088) and **passed**: exactly 4 records processed, `technical_errors=0`, **`primary_json=3/4`** (target ≥3/4), `repaired_json=0/4`, **`deterministic_fallback_after_llm_fail=1/4`** (≤1 acceptable), `repair_used=false` for the 3 `primary_json` rows and `true` only for the fallback row, MSK `+03:00` timestamps correct, routes preserved. The C2/C3 failing case — **Telegram `source_candidate` (7) — is fixed** (now `primary_json`, `content_queue`/`content_idea`/`create_content`). The one remaining fallback moved to the **Banki/forum lead-pattern (11)**, which the deterministic floor routed **safely** to `review_queue` (NOT `results`), with **no unsafe «обратиться напрямую» wording** in the final row. Per record: 1 Avito → `monitor_queue`/competitor/monitor/`primary_json`; 7 Telegram → `content_queue`/content_idea/create_content/`primary_json`; 11 Banki → `review_queue`/lead_signal/investigate/`deterministic_fallback_after_llm_fail`; 12 Zoon → `content_queue`/content_idea/create_content/`primary_json`. Compact overlay mode produced useful `offer_text`/`detected_need`/`reason` for the 3 `primary_json` rows. No `results`/`contact` without `contact_public`.
**Decision (Stage 3.2 closed):**
- **deterministic_first baseline APPROVED** (Test 3, unchanged) — `technical_errors=0`, Claude calls=0, `repair_used=false`, routes 6/3/1/2, cost $0.
- **Compact LLM enrichment APPROVED WITH WATCH ITEM** for **optional / test use** (the v4→v7 compact enrichment-only merge with the v7 specialized 7-key source_candidate schema). It can be enabled per-run via `analysis_mode='llm_enriched'` + `llm_enrichment=true`.
- **Default MUST remain `deterministic_first`** (all LLM flags `false`) **unless the operator explicitly enables `llm_enrichment`.** Enrichment never changes routing/action/entity/contact (deterministic floor + post-merge safety assertion hold).
- **Watch item:** the Banki/forum lead-pattern record still falls back to `deterministic_fallback_after_llm_fail`. The fallback is **safe** (correct `review_queue`, no unsafe contact wording), but a future enrichment prompt/model iteration can improve strict-JSON reliability for the forum lead-pattern family.
- **C4 cost delta: TODO_OPERATOR_FILL** (target ≤ $0.04 for 4 records; the specialized Telegram path is smaller, so cost should not rise).
- **Stage 3.3 unblocked:** the **Avito/Classifieds Listing Connector** (DEC-084) feasibility/build can proceed **after commit**. Connectors never call Claude; human approval is the spend gate; build only after explicit approval + feasibility.
**Reason:** the only remaining acceptance gap (Telegram strict-JSON) is closed and the lone remaining fallback is on a record class the deterministic floor already routes correctly and safely — so enrichment now adds value (better human-readable fields) at bounded cost without any routing/safety risk. Keeping `deterministic_first` as the default preserves the $0, stable path while making enrichment an explicit, operator-controlled opt-in.
**Files:** `docs/STAGE_3_2_TEST_RESULTS.md`, `docs/STAGE_3_2_TOUCHPOINT_ANALYZER_PLAN.md`, `docs/N8N_WORKFLOW_08_TOUCHPOINT_ANALYZER_RU.md`, `docs/DECISIONS.md`, `docs/NEXT_ACTIONS.md`, `docs/COSTS_AND_LIMITS.md`, `docs/AGENT_CAPABILITIES.md`, `docs/ROADMAP.md`, `docs/AGENT_LOG.md`, `core/hot/recent.md`. (No workflow JSON changed.)

---

## DEC-088 — Workflow 08 Uses Specialized Compact Enrichment Schemas by Record Family; Source Candidates / Social Channels Use a Minimal 7-Key Schema + Deterministic Route Preservation (v7, C4)

**Date:** 2026-06-09
**Context:** Test C3 (`docs/STAGE_3_2_TEST_RESULTS.md`) ran the 4 fixtures against the v6 quality patch and was a **PARTIAL PASS / LLM enrichment NOT APPROVED**: `primary_json=2/4` (target ≥3/4), `repaired_json=1/4`, `deterministic_fallback_after_llm_fail=1/4`, `technical_errors=0`, routes preserved. Quality clearly improved — Avito (1) `primary_json` competitor with good offer/terms/reason (78/80); Banki (11) semantically correct `review_queue`/`lead_signal`/`investigate` with **no** direct-contact wording (lead 75); Zoon (12) now `content_idea`/`content_queue` with `competitor_strength=45`, content 70, quality 68. **The single remaining weakness was the Telegram `source_candidate` (7):** the model understands the record but **still fails strict JSON and falls back**.
**Decision (patch v7):** Workflow 08's optional LLM enrichment uses **specialized compact enrichment schemas by record family**. **Source candidates / social channels** (`record_type_hint=market_signal AND touchpoint_type=source_candidate`, OR `source_type=social_channel`, OR `platform=telegram` with no direct personal request) get a **minimal 7-key schema** and **deterministic route preservation**, to improve JSON reliability and reduce hallucinations.
- **Task A — `Build Primary Claude Request`:** the source_candidate family uses a separate **ultra-short** system prompt ("Return JSON only… first char `{`, last char `}`… use only the given record… do not browse/fetch/verify… public monitoring/content source, NOT a direct lead and NOT outreach… do not claim users ask questions unless text says so") and a **minimal user payload** (`task=enrich_source_candidate`, platform, profile_name, profile_url, text_context, interest_topic, service_hint, deterministic_entity_type, deterministic_action). The output schema is **7 keys only**: `profile_name, service_type, offer_text, detected_need, reason, content_idea_score, quality_score`. The model is explicitly told **not** to output `company_name / route / entity_type / recommended_action / lead_signal_score / competitor_strength`. `max_tokens=500`.
- **Task B — no regression:** Avito/Banki keep the general prompt; Zoon keeps the review-source compact prompt; v6 behaviour preserved.
- **Task C — `Build Repair Request`:** for the source_candidate family, repair targets the **same 7-key schema** (never inflates to the 15-key general schema), `max_tokens=400`, RAW_RESPONSE = capped sanitized preview only.
- **Task D — `Merge …` safety assertion:** for `source_type=social_channel` or `telegram`+`source_candidate` (or `market_signal`+`source_candidate`): `route` stays `content_queue` (unless deterministic route was `review_queue`), `entity_type=content_idea`, `recommended_action∈{create_content,investigate}`, `contact_public` empty unless literally present, `lead_signal_score=1` unless a direct personal request is present, `competitor_strength=1` unless the record is explicitly `competitor_activity`. The 7-key enrichment overlays only its descriptive fields + content/quality scores; route/action/entity/lead/competitor/contact stay deterministic. `parse_method=primary_json` when the specialized JSON parses.
- **Cost:** specialized path is *smaller* (500/400 vs the general 700/600); no `max_tokens`/cost increase. Defaults unchanged (`deterministic_first`/`llm_enrichment=false`/`llm_enrichment_test_mode=false`); 35 business fields, MSK `+03:00` timestamps, the 4-record test filter and "no source APIs" all intact.
- **C4 acceptance:** same 4 fixtures; `primary_json ≥ 3/4`; `deterministic_fallback_after_llm_fail = 0` ideally (≤1 acceptable); `technical_errors=0`; routes unchanged; **Telegram no longer falls back**; Banki reason no direct-contact; Zoon stays content_idea/content_queue; no results/contact without contact_public; cost ≤ $0.04. **LLM enrichment stays NOT APPROVED until C4 passes or is explicitly deferred; deterministic_first (TEST 3) remains the approved default.**
**Reason:** a record-family-specific minimal schema is the highest-leverage fix for the one failing case — a smaller, rigid output surface makes the gateway far more likely to emit clean strict JSON, while deterministic route/score preservation + a post-merge safety assertion guarantee a public social source can never become a lead/competitor/outreach row even if the model misbehaves. Verified by simulation: all 10 code nodes compile, JSON valid; Build Primary selects the specialized 7-key path for the Telegram fixture (max_tokens 500, `enrich_source_candidate`) and the general/review paths for Avito/Banki/Zoon; merge of a 7-key Telegram enrichment → `content_queue`/`content_idea`/`create_content`, `lead=1`, `comp=1`, `contact=""`, content/quality 60 with descriptive fields merged; Avito→monitor, Banki→review (forbidden contact phrase sanitized), Zoon→content; 35 fields on every path; C4 test filter selects exactly [1,7,11,12].
**Files:** `n8n/workflows/08_touchpoint_analyzer.json`, `docs/N8N_WORKFLOW_08_TOUCHPOINT_ANALYZER_RU.md`, `docs/STAGE_3_2_TEST_RESULTS.md`, `docs/STAGE_3_2_TOUCHPOINT_ANALYZER_PLAN.md`, `docs/NEXT_ACTIONS.md`, `docs/COSTS_AND_LIMITS.md`, `docs/AGENT_CAPABILITIES.md`, `docs/ROADMAP.md`, `docs/AGENT_LOG.md`, `core/hot/recent.md`.

---

## DEC-087 — Workflow 08 Enrichment-Quality Patch (v6) After C2 PARTIAL PASS: Compact Source/Review Prompt + HINTS, Named-Only Competitor for Review Directories, Deterministic No-Contact & No-Trend Reason Sanitizers

**Date:** 2026-06-09
**Context:** Test C2 attempt #2 (`docs/STAGE_3_2_TEST_RESULTS.md`) processed the intended 4 fixtures (batch_index 1, 7, 11, 12) with `technical_errors=0`, routes preserved and MSK timestamps OK, but was a **PARTIAL PASS — LLM enrichment NOT APPROVED**: `primary_json=2/4` (target ≥3/4), `repaired_json=1/4`, `deterministic_fallback_after_llm_fail=1/4`. Four quality issues: (1) Telegram `source_candidate` (7) still fails strict JSON and falls back; (2) Zoon reviews (12) needed repair and were classified **too strongly as a competitor** even though it is a generic category/review directory; (3) Banki (11) reason said «обратиться напрямую» although `contact_public` is empty and `recommended_action=investigate`; (4) reasons risked unsupported trend claims like «спрос растёт».
**Decision (patch v6):** improve enrichment quality without increasing `max_tokens` or cost; the deterministic layer remains the source of truth for route/action/entity/contact.
- **Task A — compact source/Telegram prompt.** `Build Primary Claude Request` branches a **shorter** system prompt for `record_type_hint=market_signal AND touchpoint_type=source_candidate` and for `platform=telegram` content-idea records with no direct personal request. It forces `entity_type=content_idea`, `recommended_action=create_content|investigate`, frames the reason as «источник мониторинга тем, вопросов и рыночных сигналов» — **not** a direct lead, **not** outreach, **no** contact claim, **no** broad external facts, «можно использовать как источник лидов» only reframed as monitoring.
- **Task B — `review_source` named-only competitor (`Prepare Record`).** Only a **named competitor** (`competitor_name` set) → strong competitor / `monitor_queue` (competitor_strength 70). A **generic category/listing/review directory** (e.g. a Zoon "кредитные брокеры в Москве" category) → `entity_type=content_idea`, `route=content_queue`, `recommended_action=create_content`, **competitor_strength capped at 45**, content_idea_score 70, quality_score 68, `detected_need` seeded from `probable_need`.
- **Task C — no-contact reason safety (`Merge …`).** Deterministic sanitizer: with no usable `contact_public`, a reason containing «обратиться напрямую/написать/позвонить/связаться» is replaced with a manual-review-safe sentence; route stays `review_queue`, action stays `investigate`. (Belt-and-suspenders on top of the existing route safety floor.)
- **Task D — no unsupported claims (prompt + `Merge …`).** «спрос растёт», «активно задают вопросы», «много лидов», «высокая конверсия» are forbidden in the prompt and stripped in the merge unless literally present in `ORIGINAL_RECORD`. Allowed framing: «есть рыночный паттерн», «подходит для мониторинга», «требует ручной проверки».
- **Task E — JSON reliability.** Deterministic **HINTS** (`expected_entity_type`, `expected_action`, `expected_route`, `no_contact_safety`, `forbidden_phrases`) are injected into the primary **and** repair payloads; compact enrichment schema kept; primary still one JSON object, first `{` last `}`, no markdown/prose/thinking/browse language. `max_tokens` unchanged (700/600), thinking disabled — no cost increase.
- **C3 acceptance:** same 4 fixtures; `primary_json ≥ 3/4`; `deterministic_fallback ≤ 1/4`; `technical_errors=0`; Banki reason has no direct-contact instruction; Zoon generic review → `content_idea`/`content_queue` (or at least no "demand-growth"/"strong-competitor" claim); Telegram source_candidate gets primary/repaired JSON, not fallback; cost ≤ $0.04. **LLM enrichment stays NOT APPROVED until C3 passes; deterministic_first (TEST 3) remains the approved default.**
**Reason:** the C2 failures were quality/specificity, not pipeline — a shorter, hint-constrained prompt is more likely to return clean JSON for the two hard cases (Telegram/Zoon), and deterministic sanitizers guarantee reason safety (no fake outreach, no invented trends) regardless of what Claude returns. Verified by simulation: all 10 code nodes compile, JSON valid; det routes for the 4 fixtures = 1 monitor / 7 content / 11 review / 12 content (Zoon now content, competitor_strength 45); named-competitor review still monitor; sanitizer strips forbidden contact phrases and unsupported trend claims; 35 business fields and MSK timestamps preserved; defaults and the 4-record test filter unchanged.
**Files:** `n8n/workflows/08_touchpoint_analyzer.json`, `docs/N8N_WORKFLOW_08_TOUCHPOINT_ANALYZER_RU.md`, `docs/STAGE_3_2_TEST_RESULTS.md`, `docs/STAGE_3_2_TOUCHPOINT_ANALYZER_PLAN.md`, `docs/NEXT_ACTIONS.md`, `docs/COSTS_AND_LIMITS.md`, `docs/AGENT_CAPABILITIES.md`, `docs/ROADMAP.md`, `docs/AGENT_LOG.md`, `core/hot/recent.md`.

---

## DEC-086 — Workflow 08 C2 Test Filtering Happens Pre-Loop in Filter & Select Records; Code Nodes Inside the Split-in-Batches Loop Must Never Return [] for a Routed Item

**Date:** 2026-06-08
**Context:** The first C2 enrichment run (`docs/STAGE_3_2_TEST_RESULTS.md`, Test C2 attempt #1) showed the v4 compact enrichment design works — batch_index=1 (Avito competitor) wrote to `monitor_queue` with `parse_method=primary_json`, `repair_used=false`, `technical_errors=0`, and useful enriched `offer_text`/`terms`/`reason`. **But only record 1 was written**: the run stalled around `Build Deterministic Row` on the next non-target item and never reached fixtures 7/11/12. Root cause: C2 filtering was implemented **inside `Build Deterministic Row`** as `if(llm_enrichment_test_mode) return [];` for non-target records. In the Split-in-Batches loop, a routed item whose Code node returns **`[]`** yields no output, so `Append to Dynamic Route Sheet → Loop Over Items` never fires for that iteration and **loop continuation stalls**.
**Decision (patch v5):** Move C2 batch filtering **before the processing loop** and forbid empty returns inside the loop.
- **`Filter & Select Records`** assigns `batch_index` over the full selection (so 1,7,11,12 stay stable), then — when `llm_enrichment_test_mode=true` — returns **only** records whose `batch_index` ∈ `llm_test_batch_indexes`. The loop receives **exactly the test fixtures** (4 items), all of which are Claude targets. It also stamps `selected_count_before_test_filter` / `selected_count_after_test_filter` / `llm_enrichment_test_mode` / `llm_test_batch_indexes` on each selected record.
- **`Build Deterministic Row` no longer returns `[]`** for any record (the test-mode guard is removed). Non-target test records never reach it, so loop continuation can never be broken by an empty return.
- **`Final Summary Output`** surfaces `selected_count`, `llm_enrichment_test_mode`, `llm_test_batch_indexes` next to `route_counts` / `parse_method_counts` / `repair_used_count` / `technical_error(s)_count`.
- **Default (`llm_enrichment_test_mode=false`) is unchanged**: all selected unique + approved/new records flow; deterministic baseline route distribution (monitor 6 / content 3 / review 1 / skipped 2; `deterministic_pre_route=10`, `deterministic_irrelevant_skip=2`; Claude calls=0) is preserved. Verified by simulation: `false → [1..12]`, `true → [1,7,11,12]`.
- **General rule recorded:** any Code node on a per-item path inside a Split-in-Batches loop must emit at least one item (or be bypassed by routing) — never `return []` mid-loop, or downstream loop-back never fires.
**Reason:** pre-loop filtering is the correct place to scope a test run; it makes C2 produce exactly 4 auditable rows and removes the loop-stall failure mode without touching the approved deterministic baseline.
**Files:** `n8n/workflows/08_touchpoint_analyzer.json`, `docs/N8N_WORKFLOW_08_TOUCHPOINT_ANALYZER_RU.md`, `docs/STAGE_3_2_TEST_RESULTS.md`, `docs/STAGE_3_2_TOUCHPOINT_ANALYZER_PLAN.md`, `docs/NEXT_ACTIONS.md`, `docs/COSTS_AND_LIMITS.md`, `docs/AGENT_CAPABILITIES.md`, `docs/ROADMAP.md`, `docs/AGENT_LOG.md`, `core/hot/recent.md`.

---

## DEC-085 — Workflow 08 LLM Enrichment Is Compact Enrichment-Only JSON Merged Into the Deterministic Row; Claude No Longer Generates the Full Business Row

**Date:** 2026-06-08
**Context:** The first live LLM-enrichment test (`docs/STAGE_3_2_TEST_RESULTS.md`, TEST 4 / Test C) under the v3 design ran the 4 fixtures (`llm_enrichment_test_mode=true`) and was a **PARTIAL PASS / LLM NOT APPROVED**: routing stayed safe and `technical_errors=0`, but **too many records fell back** (`deterministic_fallback_after_llm_fail` for records 1, 7, 12), strict-JSON primary/repair still failed often, and the **cost delta was $0.0967 for 4 records** for almost no usable LLM contribution. Root cause: the v3 prompt asked Claude to generate the **full 25/35-field business row from scratch** (long output → gateway emits prose/extended-thinking/signature instead of one JSON object).
**Decision:** Workflow 08's optional LLM enrichment is redesigned as **compact enrichment-only JSON merged into the deterministic row** — Claude never generates the full business row again. v4 patch:
- **`Build Primary Claude Request`** sends `ORIGINAL_RECORD` + `DETERMINISTIC_ROW` + a 15-key `OUTPUT_SCHEMA` (company_name, profile_name, region, service_type, offer_text, terms, contact_public, detected_need, reason, recommended_action, entity_type, lead_signal_score, competitor_strength, content_idea_score, quality_score). System prompt: "JSON-only enrichment formatter… cannot browse/fetch… one JSON object, first `{` last `}`, no markdown/prose/comments/thinking… do not invent a contact… do not return market_signal → use content_idea… if uncertain preserve DETERMINISTIC_ROW." `model=claude-sonnet-4-6`, `temperature=0`, `max_tokens=700`, **`thinking={type:'disabled'}`** (sent in the HTTP body to suppress the gateway's thinking/signature blocks).
- **`Build Repair Request`** is enrichment-only too (`max_tokens=600`, thinking disabled): repair `RAW_RESPONSE_SANITIZED` to `OUTPUT_SCHEMA`, or build it from `ORIGINAL_RECORD` + `DETERMINISTIC_ROW`.
- **Parsers** concatenate only `text` content items (ignore thinking/signature/tool), strip code fences, try direct `JSON.parse` → first balanced object → first `{`…`}`; preview capped 500; thinking/prose-only → `non_json_non_text_or_thinking_response`. Both-fail → deterministic fallback marker.
- **`Merge LLM Enrichment With Deterministic Row`** (renamed from `Normalize + Route`) builds the deterministic 35-field row from `det`, then overlays **only safe enrichment**: descriptive fields (company_name, profile_name, region, service_type∈enum, offer_text, terms, detected_need, reason) + scores (1–10 → ×10, floored at the deterministic value). **Route, recommended_action, entity_type, and contact_public stay deterministic** — Claude cannot change routing, cannot downgrade a deterministic competitor to irrelevant, cannot set `results`/`contact` without a usable intake contact, and a hot/question without contact stays `review_queue`. `parse_method` = `primary_json` | `repaired_json` | `deterministic_fallback_after_llm_fail` (`technical_error` only if `det` has no valid route).
- **`llm_enrichment_test_mode`** writes exactly the 4 fixture rows (batch_index 1,7,11,12): `Build Deterministic Row` returns `[]` in test mode so the other 8 records are not appended.
- **Defaults unchanged and approved baseline preserved:** `analysis_mode='deterministic_first'`, `llm_enrichment=false`, `llm_enrichment_test_mode=false`; deterministic baseline route distribution, MSK `+03:00` timestamps, dynamic route sheet, 35-field output, deterministic fallback, and "no source APIs" all intact.
- **Test C2 acceptance:** exactly 4 LLM records; `technical_errors=0`; `primary_json ≥ 3/4`; `repaired_json ≤ 1/4`; `deterministic_fallback ≤ 1/4`; routes unchanged; no contact/results without contact_public; cost delta ≤ $0.04 (vs the prior $0.0967). LLM enrichment stays **optional and unapproved** until Test C2 passes.
**Reason:** asking the LLM for a tiny, well-scoped JSON object (with thinking disabled) is far more likely to return clean JSON than asking it to author the whole row; merging into the deterministic row keeps all routing/safety deterministic while letting Claude improve only the human-readable fields and scores — recovering value at a fraction of the cost and risk. Logic verified by simulation: routes and contact safety held for all 4 fixtures, hallucinated contacts rejected, 35 fields on every path, fallback safe.
**Files:** `n8n/workflows/08_touchpoint_analyzer.json`, `docs/N8N_WORKFLOW_08_TOUCHPOINT_ANALYZER_RU.md`, `docs/STAGE_3_2_TOUCHPOINT_ANALYZER_PLAN.md`, `docs/STAGE_3_2_TEST_RESULTS.md`, `docs/COSTS_AND_LIMITS.md`, `docs/AGENT_CAPABILITIES.md`, `docs/ROADMAP.md`, `docs/NEXT_ACTIONS.md`, `docs/AGENT_LOG.md`, `core/hot/recent.md`.

---

## DEC-084 — Stage 3.3 Recommended First Real Connector Is Avito/Classifieds; Telegram & Instagram Deferred to Feasibility Stages

**Date:** 2026-06-08
**Context:** With Stage 3.1 (manual intake) passed and Stage 3.2 (analyzer) baseline approved, the connector→record→analyzer→route contract is proven on manual records. The next step is the **first real source connector**, but the source must be chosen deliberately (data value vs complexity vs risk) and **nothing should be built yet**. See `docs/STAGE_3_3_SOURCE_DECISION_PLAN.md`.
**Decision:** The recommended **first real connector after Stage 3.2 is the Avito/Classifieds Listing Connector**, because it is the **lowest-complexity** real source, **closest to the existing Stage 2 web/URL data model** (reuses URL-normalize + `*_registry` dedup + the Apify-actor pattern), strong for **competitors / offers / prices / ad wording / semantics** in the secured-lending niche, with **simple dedup by listing URL/id** and **lower risk** than Telegram/Instagram audience/comment scraping.
- **Caveat:** Avito is **not** for comments/subscribers/audience mining — treat it as a **competitor listing source**, an **offer/semantic source**, and an **occasional lead-like source**; hot-lead yield is modest.
- **Telegram is second / separate feasibility:** useful for public channel messages, questions, market pains, but the **Telegram Control Bot ≠ Telegram Parser** (reaffirms DEC-067); the parser needs a separate client/MTProto + compliance design, and **groups/members/comments/DMs are higher-risk** and require their own design.
- **Instagram** is useful for competitor content/comments, **less useful for hot leads**, higher access/ToS risk → **deferred** until after Avito + Telegram feasibility. Dzen/VK public feasibility also follows Avito.
- **Nothing built here.** The analyzer (Workflow 08) and data model are reused unchanged for every source. Build only after explicit operator approval + a per-source feasibility/compliance check.
**Reason:** sequence value by accessibility and lowest architectural jump; lock the lowest-risk, highest-fit first connector before any access-risky social/audience scraping; keep controller-vs-parser separation intact.
**Files:** `docs/STAGE_3_3_SOURCE_DECISION_PLAN.md`, `docs/LEAD_DISCOVERY_ARCHITECTURE.md`, `docs/SOCIAL_CLASSIFIED_SOURCE_MATRIX.md`, `docs/ROADMAP.md`, `docs/NEXT_ACTIONS.md`.

---

## DEC-083 — Operational Timestamps Use Explicit Moscow Time (+03:00); Stage 3.2 Finalized (deterministic_first baseline approved, LLM enrichment optional & test-gated)

**Date:** 2026-06-08
**Context:** Live rows wrote operational timestamps as UTC-`Z` (e.g. `2026-06-08T18:55:43.425Z`); the operator (Moscow business) wants Moscow wall-clock with an explicit offset (`2026-06-08T21:55:43.425+03:00`). Separately, Stage 3.2 needed to be finalized: the deterministic_first baseline passed (TEST 3), but the LLM enrichment path still needed prompt/parser hardening and a small live retest before approval, and the docs needed to clearly separate "approved baseline" from "optional/under test".
**Decision:**
- **Moscow-time timestamps (all workflow-generated):** Workflows 04/05/06/07/08 use helpers `moscowIsoNow()` (now → `+03:00`) and `moscowStamp()` (compact `YYYYMMDD_HHmmss` in Moscow time) for `created_at`, `parsed_at`, `generated_at`, `first_seen_at`, `last_seen_at`, workflow-generated `approved_at` (none currently), and the `run_id` timestamp source (`touchpoint_…`, `firecrawl_…`, `approved_run_…`, `disc_…`, `agentreq_…`, `rec_…`, `cand_…`). **Source-provided `published_at` is NOT altered.** **Existing historical UTC-`Z` rows are left as-is** (no rewrite of Google Sheets). No schema change.
- **Workflow 08 default stays `deterministic_first`, `llm_enrichment=false`** — the approved safe baseline (TEST 3: `technical_errors=0`, Claude calls=0, `repair_used=false`, routes 6/3/1/2).
- **LLM enrichment is OPTIONAL and must pass a small-batch test before approval.** Hardened the `llm_enriched` path: primary prompt uses only `original_record` + `deterministic_classification`, cannot browse/fetch/verify URLs, no narration ("fetching/checking/analyzing"), one strict JSON object (first `{` last `}`), no markdown/prose/thinking/comments, scores 1–100, **never output `market_signal` (use `content_idea`)**, and **if uncertain preserve the deterministic route/action and enrich only the reason**; repair builds JSON from `original_record` + `deterministic_classification`; parser concatenates text items / ignores thinking+signature / caps preview at 500 / emits `non_json_non_text_or_thinking_response` for thinking-only. **Deterministic safety floor in `Normalize + Route`:** no `contact`/`results` without a usable `contact_public`; irrelevant stays `skipped_log`; a deterministic `competitor` record cannot be downgraded to `irrelevant`; hot/question without contact stays `review_queue`; `market_signal`→`content_idea`; scores clamped 1–100 (1–10 → ×10) with deterministic floor.
- **LLM enrichment test config (Part C):** `Set Analyzer Config` adds `llm_enrichment_test_mode=false` and `llm_test_batch_indexes=[1,7,11,12]`; when the flag is true, **only** those four non-irrelevant fixtures (Avito competitor, Telegram source candidate, Banki forum hot-no-contact, Zoon reviews) are sent through Claude — all other records still route deterministically ($0). Test plan = `docs/STAGE_3_2_TEST_RESULTS.md` TEST 4.
**Reason:** the operator needs human-readable Moscow timestamps without corrupting history; finalizing Stage 3.2 means making the cheap deterministic path the documented default while keeping a clearly-bounded, test-gated, safety-floored enrichment switch.
**Files:** `n8n/workflows/04_firecrawl_url_list_resilient.json`, `n8n/workflows/05_apify_search_candidate_discovery.json`, `n8n/workflows/06_approved_candidates_runner.json`, `n8n/workflows/07_manual_touchpoint_intake.json`, `n8n/workflows/08_touchpoint_analyzer.json`, `docs/STAGE_3_2_TEST_RESULTS.md`, `docs/STAGE_3_2_TOUCHPOINT_ANALYZER_PLAN.md`, the five workflow RU guides, `docs/COSTS_AND_LIMITS.md`, `docs/AGENT_CAPABILITIES.md`, `docs/ROADMAP.md`, `docs/NEXT_ACTIONS.md`, `docs/AGENT_LOG.md`, `core/hot/recent.md`.

---

## DEC-082 — Workflow 08 Is Deterministic-First; Claude Is Optional Enrichment, Disabled by Default Until JSON Stability Is Proven

**Date:** 2026-06-08
**Context:** Workflow 08's second live test (`docs/STAGE_3_2_TEST_RESULTS.md`, TEST 2) under the v2 deterministic-**fallback** design: routing PASS and `technical_errors=0`, but **`primary_json=0`**, `repaired_json=2`, `deterministic_fallback_after_llm_fail=8`, `deterministic_irrelevant_skip=2` — i.e. the gateway returned prose/thinking/signature (e.g. "Fetching the Dzen channel…", "Проверяю Avito-объявление…") for essentially every primary call, and **Claude cost ≈ $0.159 for 12 records** while the deterministic floor did all the real classification. Paying for an LLM that contributes ~nothing usable is **LLM-stability FAIL + cost-efficiency FAIL**.
**Decision:** Workflow 08's **default mode is `deterministic_first`; Claude enrichment is optional and disabled by default** (`llm_enrichment=false`) until JSON stability is proven. v3 patch:
- **`Set Analyzer Config`** adds `analysis_mode='deterministic_first'`, `llm_enrichment=false`, keeps `max_records=12`, `test_mode=true`.
- **`Prepare Record`** computes the deterministic classification (`det`, exact scores/routes) + a `deterministic_needs_llm` flag (true only for the uncertain default class) for every record, and an LLM gate `call_claude = (NOT irrelevant) AND (llm_enrichment=true OR deterministic_needs_llm=true)`.
- **`IF Call Claude?`**: `false` → **`Build Deterministic Row`** (renamed from Build Skip Row; **no Claude, $0**) emitting `deterministic_irrelevant_skip` for irrelevant and **`deterministic_pre_route`** for obvious classifiable records; `true` → Claude primary → repair → deterministic fallback (`deterministic_fallback_after_llm_fail`). `technical_errors` remains reserved for records with no valid `det` route or Sheets/API failure.
- **Future `llm_enriched` mode** (`analysis_mode='llm_enriched'`, `llm_enrichment=true`) is preserved: Claude may enrich non-irrelevant records, but the deterministic fallback still applies.
- **Prompt/normalizer hardening:** primary prompt states it cannot browse/fetch URLs and must not narrate ("fetching/checking/analyzing"), return exactly one JSON object (first `{`, last `}`); repair builds JSON from `original_record` + `deterministic_classification`; `Normalize + Route` collapses `market_signal`→`content_idea`, scales 1–10 scores to 1–100 with a deterministic floor, caps `raw_response_preview` at 500 and emits `non_json_non_text_or_thinking_response` for thinking/signature-only responses.
- **Expected `deterministic_first` retest (12 fixtures):** `technical_errors=0`, **Claude calls=0**, `repair_used=false` for all 12, `deterministic_pre_route=10`, `deterministic_irrelevant_skip=2`, cost delta $0.
**Reason:** the gateway's non-JSON output is the dominant failure mode and the intake hints already classify/route deterministically, so paying per-record for Claude buys nothing today. Deterministic-first makes the cheap, stable path the default and keeps Claude as a switch-on enrichment once its JSON contract is reliable.
**Files:** `n8n/workflows/08_touchpoint_analyzer.json`, `docs/N8N_WORKFLOW_08_TOUCHPOINT_ANALYZER_RU.md`, `docs/STAGE_3_2_TOUCHPOINT_ANALYZER_PLAN.md`, `docs/STAGE_3_2_TEST_RESULTS.md`, `docs/LEAD_DISCOVERY_ARCHITECTURE.md`, `docs/LEAD_DATA_MODEL_PLAN.md`, `docs/COSTS_AND_LIMITS.md`, `docs/AGENT_CAPABILITIES.md`, `docs/ROADMAP.md`, `docs/NEXT_ACTIONS.md`, `docs/AGENT_LOG.md`, `core/hot/recent.md`.

---

## DEC-081 — Workflow 08 Uses a Deterministic Fallback After LLM/Repair Failure; Claude JSON Failure Alone Must Not Send Classifiable Records to technical_errors

**Date:** 2026-06-08
**Context:** Workflow 08's first live test partially failed (`docs/STAGE_3_2_TEST_RESULTS.md`, TEST 1). The Claude gateway frequently returns prose / extended-thinking / signature content instead of strict JSON — sometimes with **no `text` content item at all** — so both primary and repair parses failed, and classifiable records (records 2,3,4,5,7,11,12) dropped to `technical_errors`. The forum positive-control record 11 (a clear lead) wrongly landed in `technical_errors` instead of `review_queue`.
**Decision:** Workflow 08 must **not depend fully on Claude JSON**. Patch v2:
- **Deterministic pre-classification (`det`) for every record** in `Prepare Record`, derived from the `raw_market_records` hints (`record_type_hint`, `touchpoint_type`, `competitor_related`, `lead_temperature`/`lead_intent_hint`/`urgency_hint`, `service_hint`, `competitor_name`, `contact_public`, `source_url`/`profile_name`). Rules: irrelevant→skipped_log (pre-Claude, $0); competitor_activity / competitor_related+competitor touchpoint→competitor/monitor_queue; market_signal+source_candidate→content_idea/content_queue; review_source→monitor_queue (competitor_related) or content_queue; question_objection/hot/high-intent/high-urgency→lead_signal (results+contact if usable contact+direct need, else review_queue/investigate, score≥70); default→review_queue.
- **Deterministic fallback after LLM+repair failure** (`parse_method=deterministic_fallback_after_llm_fail`, `repair_status=failed_fallback`) builds a routed 35-field row from `det`. **`technical_errors` is reserved** for records with no valid `det` route, an invalid route after normalization, or Sheets/API failure. **A Claude parse failure alone never sends a classifiable record to `technical_errors`.**
- **Prompt + parser hardening:** primary & repair prompts demand strict JSON only (no prose/markdown/thinking; "Return exactly one JSON object. First char `{`, last `}`"); the repair prompt builds JSON from `original_record` when the raw response has no usable JSON; the parser concatenates **all** `text` content items and ignores thinking/signature blocks; raw preview + original record preserved on failure.
- **parse_method** values: `primary_json`, `repaired_json`, `deterministic_irrelevant_skip`, `deterministic_fallback_after_llm_fail`, `deterministic_pre_route`, `technical_error`. **repair_status**: `''`, `success`, `failed_fallback`, `failed`.
- Preserved from v1: deterministic irrelevant skip (no Claude, $0), dynamic route append, 35-field output on every path, resilient primary→repair structure.
**Reason:** the gateway's non-JSON output is the dominant failure mode; the intake hints already carry enough signal to classify/route deterministically, so the analyzer should degrade gracefully to a hint-based route rather than discard usable records. Logic dry-run on the 12 fixtures: **0 technical_errors**, record 11 → `review_queue`/`lead_signal`/`investigate`/score 75.
**Files:** `n8n/workflows/08_touchpoint_analyzer.json`, `docs/N8N_WORKFLOW_08_TOUCHPOINT_ANALYZER_RU.md`, `docs/STAGE_3_2_TOUCHPOINT_ANALYZER_PLAN.md`, `docs/STAGE_3_2_TEST_RESULTS.md`, `docs/LEAD_DISCOVERY_ARCHITECTURE.md`, `docs/LEAD_DATA_MODEL_PLAN.md`.

---

## DEC-080 — Stage 3.2 Touchpoint Analyzer Reuses the Stage 2 Resilient Analyzer and the Existing 35-Column Schema

**Date:** 2026-06-08
**Context:** With Stage 3.1 records landing in `raw_market_records`, the analyzer could be a new bespoke design or a reuse of the proven Stage 2 resilient analyzer (Workflow 04). The touchpoint model also has 12 record classes, but the business tabs use a fixed 35-column schema with a 5-value `entity_type` enum.
**Decision:** Build **`Workflow 08 — Touchpoint Analyzer`** (`active=false`) by **reusing the Stage 2 resilient pattern** (primary JSON → repair formatter → `technical_errors` fallback; `parse_method`/`repair_used`/`repair_status`/`processing_status`/`raw_response_preview`/route validation) and **mapping the 12 touchpoint classes onto the existing 35-column schema** rather than adding columns or sheets:
- hot_lead/warm_touchpoint → `entity_type=lead_signal`; competitor_activity/competitor_audience → `competitor`; client_pain/question_objection/semantic_signal/ad_channel_signal/content_idea → `content_idea` (or `market_signal`); irrelevant → `irrelevant`.
- Route is driven by `recommended_action` (extended with `add_to_semantics`→content_queue) reconciled with `entity_type`; output is appended via a **dynamic** `Sheet Name = {{ $json.route }}` to the six business tabs. **No business-tab headers change.**
- **Encoded safeguards (not just prompted):** `contact`→`results` requires `lead_signal` + `lead_signal_score>=70` + a usable public contact, so the forum hot-pattern record (record 11) with no direct contact routes to `review_queue`, not auto-contact; Avito competitor listings → `monitor_queue`; Dzen/VK/Telegram source candidates → review/content, never `results`; **irrelevant is skipped deterministically before any Claude call ($0)**; invalid route → `technical_errors`.
- Source-agnostic: one analyzer for Avito/Dzen/VK/Telegram/Yandex Maps/forum/review/irrelevant inputs. It reads `raw_market_records` and writes only the business tabs (not `agent_requests`/`market_record_registry`/`agent_memory`). No scraping, no Apify/Firecrawl.
**Reason:** the resilient analyzer already solves output-contract instability; reusing it (and the stable 35-column schema) minimizes risk and keeps Stage 2 tabs/dashboards intact while extending coverage to social/classified touchpoints. Scoring/temperature calibration is deferred to Stage 3.3.
**Files:** `n8n/workflows/08_touchpoint_analyzer.json`, `docs/N8N_WORKFLOW_08_TOUCHPOINT_ANALYZER_RU.md`, `docs/STAGE_3_2_TOUCHPOINT_ANALYZER_PLAN.md`, `docs/STAGE_3_2_TEST_RESULTS.md`, `docs/LEAD_DISCOVERY_ARCHITECTURE.md`, `docs/TABLE_SCHEMA.md`.

---

## DEC-079 — Stage 3.1 Starts With Manual Touchpoint Intake, Not the Avito Parser

**Date:** 2026-06-08
**Context:** With the data model defined (DEC-078) and the operator having created the four tabs (`agent_requests`, `raw_market_records`, `market_record_registry`, `agent_memory`), the first build step could be a real source connector (Avito) or a manual intake.
**Decision:** Stage 3.1 builds **`Workflow 07 — Manual Touchpoint Intake`** (`active=false`) **first**, not the Avito (or any) source parser. Workflow 07 deterministically normalizes 12 manually-provided mixed-source examples into `raw_market_records` (40), dedups via `market_record_registry` (15), and logs one `agent_requests` (21) row. **No LLM, no scraping, no external API; `agent_memory` not written.**
**Reason:** validate the **shared data model and analyzer input** (40-column record shape, composite non-URL `dedup_key`, 12 record classes, registry dedup incl. re-run idempotency) at **zero source cost/risk** before any source-specific parsing. The hand-labeled records also become the golden fixtures for the Stage 3.2 Touchpoint Analyzer. Connectors never analyze; the analyzer never scrapes — manual intake is the cleanest first "connector" to lock that contract.
**Files:** `n8n/workflows/07_manual_touchpoint_intake.json`, `docs/N8N_WORKFLOW_07_MANUAL_TOUCHPOINT_INTAKE_RU.md`, `docs/STAGE_3_1_MANUAL_TOUCHPOINT_INTAKE_PLAN.md`, `docs/TABLE_SCHEMA.md`, `docs/LEAD_DATA_MODEL_PLAN.md`, `docs/LEAD_DISCOVERY_ARCHITECTURE.md`.

---

## DEC-078 — Product Reframed as Business Scout Agent (AI Employee), Not a Telegram Bot; Stage 3 = Touchpoint Discovery

**Date:** 2026-06-08
**Context:** Stakeholder interview (`docs/STAKEHOLDER_INTERVIEW_2026_06_08.md`) clarified the product is far broader than lead parsing or a slash-command bot: an AI "employee" with internal automations, memory, and next-action recommendations covering leads, touchpoints, competitor intelligence, comment/audience mining, semantic/ad analysis, USP/positioning, and outreach drafting.
**Decision:**
- **Product reframed as the `Business Scout Agent`** — an agentic business automation system with tools + memory + analysis. **Marketing/lead/competitor intelligence is its first capability domain** ("Marketing Scout"). Telegram/chat is a future **control interface**, not the product. (`BUSINESS_SCOUT_AGENT_VISION.md`, `MARKETING_AGENT_PRODUCT_VISION.md`.)
- **Stage 3 is `Social/Classified Touchpoint Discovery`, not only lead parsing** — lead discovery is a subset. Records span **12 classes** (`hot_lead`, `warm_touchpoint`, `cold_audience_candidate`, `client_pain`, `question_objection`, `competitor_audience`, `competitor_activity`, `semantic_signal`, `ad_channel_signal`, `content_idea`, `market_signal`, `irrelevant`).
- **`agent_requests` generalizes `lead_discovery_requests`** (a `request_type` field selects the tool). **One request table, not two** — no duplicate request ledgers without justification.
- **`raw_market_records` remains central** (comments, posts, profiles, listings, pains, competitor activity, leads) and is **expanded** (`comment_text`, `touchpoint_type`, `lead_temperature`, `next_action`, semantic/ad fields). `market_record_registry` FK renamed `lead_request_id` → `agent_request_id`.
- **`agent_memory` is project-owned structured memory** (business profile, competitors, source quality, follow-ups, campaign insights, decisions index, run history) — **not** uncontrolled chatbot memory; sensitive data minimized.
- **Internal tools defined** (`AGENT_TOOL_ARCHITECTURE.md`): web competitor discovery (built), touchpoint discovery, competitor audience mining, comment mining, semantic/ads analysis, USP/positioning, outreach draft, report/summary, next-action recommender — initially n8n workflows + prompts + schemas, not separate LLM agents.
- **Outreach / autocall / mass messaging DEFERRED** until a dedicated compliance/platform review. Competitor audience/commenter mining is **public data only**, minimized, never for unauthorized outreach.
- **Control agent and source parsers remain separate** (Control Agent ≠ parser; reaffirms DEC-067).
**Reason:** align architecture with the stakeholder's actual product (an AI employee), avoid duplicate request tables, and lock compliance boundaries before any outreach.
**Files:** `STAKEHOLDER_INTERVIEW_2026_06_08.md`, `BUSINESS_SCOUT_AGENT_VISION.md`, `MARKETING_AGENT_PRODUCT_VISION.md`, `AGENT_TOOL_ARCHITECTURE.md`, `AGENT_MEMORY_PLAN.md`, `STAGE_3_LEAD_SOURCE_EVALUATION.md`, `LEAD_DISCOVERY_ARCHITECTURE.md`, `LEAD_SOURCE_CONNECTORS_PLAN.md`, `LEAD_DATA_MODEL_PLAN.md`, `SOCIAL_CLASSIFIED_SOURCE_MATRIX.md`, `TABLE_SCHEMA.md`, `ROADMAP.md`.

---

## DEC-077 — Stage 3.0 Lead Source Evaluation Completed: Manual Intake First, Avito First Real Connector, Source-Agnostic Layer

**Date:** 2026-06-08
**Context:** Stage 3.0 evaluation written (`STAGE_3_LEAD_SOURCE_EVALUATION.md` with a weighted scoring table, `LEAD_DATA_MODEL_PLAN.md`, `SOCIAL_CLASSIFIED_SOURCE_MATRIX.md`). The operator clarified the layer is a broad **Social/Classified Lead Discovery Layer**, not just an "Avito parser".
**Decision (consolidates DEC-067/068/069/076):**
- **Stage 3 starts with evaluation, not a connector build** (reaffirms DEC-076); no source is approved by this evaluation.
- The lead layer is **source-agnostic**: request → connector → normalize to `raw_market_records` → `market_record_registry` dedup → optional approval → analyzer → route (`results`/`review_queue`/`content_queue`/`monitor_queue`/`skipped_log`/`technical_errors`).
- **`raw_market_records` is chosen over `lead_candidates`** (reaffirms DEC-068) because records can be leads, pains, competitor posts, questions/objections, market signals, or irrelevant.
- **Telegram Control Bot (Stage 4) and Telegram Parser (Stage 3.x connector) are separate systems** (reaffirms DEC-067); the parser needs separate client/MTProto access design.
- **Manual Records Intake is recommended first** (Stage 3.1) to validate schema + analyzer at zero source risk, before any risky source parsing.
- **Avito/Classifieds is the preliminary first real connector** (reaffirms DEC-069), pending the feasibility/compliance check; weighted scoring ranks Manual(27) > Avito(20) > Yandex(18) > VK(17) > Telegram(16) > Instagram(13), with Telegram ranked 2nd among *real* connectors on business value despite a lower feasibility total.
- Lead scoring (`lead_signal_score`/`urgency_score`/`contactability_score`/`region_score`/`collateral_fit_score`) reuses the Stage 2 analyzer but is **hardened in Stage 3.3**.
**Reason:** lock a safe, source-agnostic architecture and a zero-risk bootstrap before any spend, access risk, or build effort.
**Files:** `docs/STAGE_3_LEAD_SOURCE_EVALUATION.md`, `docs/LEAD_DATA_MODEL_PLAN.md`, `docs/SOCIAL_CLASSIFIED_SOURCE_MATRIX.md`, `docs/LEAD_DISCOVERY_ARCHITECTURE.md`, `docs/LEAD_SOURCE_CONNECTORS_PLAN.md`, `docs/TABLE_SCHEMA.md`.

---

## DEC-076 — Stage 3 Starts With Lead Source Evaluation, Not the Telegram Bot

**Date:** 2026-06-07
**Context:** With Stage 2 approved, the temptation is to jump to a visible feature (the Telegram Control Bot). But the bot is a *controller*; without evaluated, compliant lead sources behind it, it would have nothing to drive.
**Decision:** **Stage 3.0 = Lead Source Evaluation** is the first Stage 3 step. Compare Avito/Classifieds vs Telegram vs VK on data availability, cost, risk, lead quality, and implementation complexity **before** building any connector. Preliminary (non-binding) recommendation: **Avito/Classifieds first** (public, high-intent, most tractable — pending actor/API + compliance check); **Telegram second** (the Telegram **Parser** is a source connector needing a separate client/MTProto access design, distinct from the Telegram **Control Bot**); VK/Instagram/Yandex later. The Telegram Control Bot stays Stage 4. **Do not build lead connectors or the Telegram bot yet.**
**Reason:** evaluate data/cost/risk before sinking build effort; avoid conflating controller vs parser; sequence value by accessibility and lead quality.
**Files:** `docs/LEAD_DISCOVERY_ARCHITECTURE.md`, `docs/LEAD_SOURCE_CONNECTORS_PLAN.md`, `docs/ROADMAP.md`, `docs/NEXT_ACTIONS.md`.

---

## DEC-075 — Auto-Handoff (06 → 04) Allowed Only If Implemented Safely Without Duplicating Workflow 04

**Date:** 2026-06-07
**Context:** Manual copying of Workflow 06's URL block into Workflow 04 is the one remaining manual step in the chain. Auto-handoff was evaluated this pass (`docs/WORKFLOW_06_AUTO_HANDOFF_PLAN.md`).
**Decision:** Auto-handoff is **permitted only** via a *callable entry path on Workflow 04* (Execute Workflow Trigger feeding the **existing** analyzer chain) driven by an Execute Workflow node in Workflow 06 — **never** by duplicating Workflow 04's Firecrawl+Claude logic into Workflow 06. It must keep manual mode (`Manual Start` + `Set URL List`) intact, default `processing_mode=manual_handoff_to_workflow_04`, `active=false`, `max_per_run=5`, the runtime `url_registry` recheck, and must mark candidates `processed` **only after** Workflow 04 confirms success per candidate (`technical_error` → `error`/`approved+note`, never `processed`). **This pass: DEFERRED** — a safe implementation is non-trivial (no `source_candidate_id` threading through Workflow 04's 25-node, 35-field-locked, branching/looped analyzer; the confirm-then-mark safety property cannot be live-tested in this environment). Scheduled as **Stage 2.4** before the Telegram bot; manual handoff remains the approved Stage 2 path.
**Reason:** stability over removing one manual copy step; the riskiest behavior (confirm-then-mark) must be live-validated, which is impossible here.
**Files:** `docs/WORKFLOW_06_AUTO_HANDOFF_PLAN.md`, `docs/STAGE_2_WEB_PIPELINE_REVIEW.md`.

---

## DEC-074 — Stage 2 Web Pipeline APPROVED With Manual-Handoff Limitation; Stays Modular (Not a Monolith)

**Date:** 2026-06-07
**Context:** Stage 2 (05 → approval → 06 → manual handoff → 04) passed real tests (see `docs/STAGE_2_FINAL_TEST_RESULTS.md`): WF05 discovery PASS, WF06 runtime registry recheck PASS, WF04 PTS override PASS, contact-partial blanking PASS, manual handoff PASS. Runner modes are implemented + simulation-validated (live re-test with fresh same-domain candidates recommended — watch item W1).
**Decision:** **Stage 2 is APPROVED with minor limitations** — human approval required; **manual** 06→04 handoff; candidates marked `processed` manually after WF04 confirmation; Telegram bot / lead connectors / universal `market_profile` not built. The three workflows **remain modular** (discovery / approval-runner / analyzer) and are **not** merged into one monolith: separation preserves the human-approval spend gate, auditability, independent failure/reuse, and incremental change.
**Reason:** the chain is proven and safe as separate, inspectable stages; the remaining manual steps are deliberate safety gates, not defects.
**Files:** `docs/STAGE_2_WEB_PIPELINE_REVIEW.md`, `docs/STAGE_2_FINAL_TEST_RESULTS.md`.

---

## DEC-073 — Workflow 06 Must Always Re-Check `url_registry` at Runtime (Reaffirmed)

**Date:** 2026-06-07
**Context:** Test 4 re-confirmed live: when the operator re-set already-processed URLs to `approval_status=approved`, Workflow 06 returned `selected_count=0`, `skipped_count=18` with `registry_recheck_duplicate` / `already_processed` / `duplicate_status` / `approval_status_not_approved`.
**Decision (reaffirms DEC-065):** Workflow 06 **must always** re-read `url_registry` at runtime and re-normalize each `candidate_url`, and must **never** trust the editable `url_candidates` `dedup_status`/`registry_status` fields. This holds in **both** runner modes (`first_pass_domain_diversity` and `deep_domain_analysis`) — Test 5 confirmed deep mode does not bypass the recheck. This is the primary guard against duplicate Firecrawl/Claude spend.
**Reason:** editable sheet fields are advisory and can be wrong/stale; the registry is the source of truth.
**Files:** `n8n/workflows/06_approved_candidates_runner.json`, `docs/STAGE_2_FINAL_TEST_RESULTS.md`.

---

## DEC-072 — Workflow 06 Default Is Domain-Diverse First Pass; deep_domain_analysis Is Explicit, Not Default

**Date:** 2026-06-07
**Context:** The E2E run selected two URLs from the same domain `autolombard-moskva.ru` in one run. Surveying many pages of one competitor is sometimes useful (deep analysis) but should not happen by default — a first pass should cover **diverse** competitors.
**Decision:** Workflow 06 gains a `runner_mode` (Set Runner Config node), default **`first_pass_domain_diversity`**: at most **1** selected URL per normalized domain per run; extra approved same-domain URLs are skipped with `reason_category=duplicate_domain_in_run` (reason: "Same domain already selected in this run; use deep_domain_analysis mode for multi-page domain analysis."). The explicit **`deep_domain_analysis`** mode allows multiple URLs per domain, **capped at 3/domain/run** (extras → `domain_deep_limit`), and tags each selected item with `warning="deep_domain_analysis mode: multiple URLs from same domain allowed intentionally."` Both modes always keep `max_per_run=5`, `url_registry` runtime recheck, exact normalized-URL dedup, `direct_competitor`→confidence→rank→root priority, manual handoff, no auto-call, no auto-mark-processed. **`url_registry` semantics are unchanged (full normalized URL, never domain-based).** Summary adds `runner_mode`, `domain_diversity`, `domain_selected_counts`.
**Reason:** make breadth the safe default and depth an explicit, bounded opt-in; keep dedup semantics intact.
**Verification:** WF06 JSON VALID; Set Runner Config node present (default first_pass); both modes simulated on the 4 E2E URLs (first_pass → 3 selected + 1 `duplicate_domain_in_run`; deep → 4 selected with deep warning); registry recheck + max 5 + manual handoff preserved; active=false; no tool_use / no KEY=VALUE.
**File:** `n8n/workflows/06_approved_candidates_runner.json`.

---

## DEC-071 — Stage 2 Web Pipeline Stays Modular (05 / 06 / 04); Not Merged Into a Monolith

**Date:** 2026-06-07
**Context:** As Stage 2 nears final approval and the Lead Discovery Layer is designed, there is recurring temptation to collapse discovery + approval + analysis into one workflow.
**Decision:** Keep the three workflows separate — **05 (discovery / URL supplier) → human approval → 06 (approval runner / selection) → manual handoff → 04 (resilient analyzer / URL consumer)**. Do **not** merge them into a monolith. The human-approval spend gate sits between 05 and 06; the manual handoff sits between 06 and 04. Future lead sources add **peer** workflows of the same shape, not a bigger monolith. Recorded in `docs/STAGE_2_WEB_PIPELINE_REVIEW.md` §5.
**Reason:** separation of concerns, auditability, spend safety (the approval gate cannot be accidentally bypassed), independent failure/reuse, and incremental change. A monolith would be unauditable, unsafe to modify, and would not generalize to lead connectors.
**File:** `docs/STAGE_2_WEB_PIPELINE_REVIEW.md`.

---

## DEC-070 — Workflow 04 Keeps Valid Full Contacts and Blanks Partial/Hallucinated Ones; Stronger PTS Override

**Date:** 2026-06-07
**Context:** Final Stage 2 hardening. The E2E run left `service_type=generic_lending` on clear PTS/autolombard pages (`autolombardn1.ru`, `autolombard-moskva.ru/services/…`), and `contact_public` must keep real contacts while never storing a hallucinated partial.
**Decision (patch `Normalize + Route` only — no field-count/architecture/dedup change):**
- **Stronger PTS `service_type` override (B3):** if `entity_type=competitor` and the combined `text_context + offer_text + terms + reason` (+ URL) contains **≥3** distinct strong tokens (`ПТС`, `ЭПТС`, `под ПТС`, `залог ПТС`, `займ под залог ПТС`, `автоломбард`, `залог авто`, `залог автомобиля`, `автомобиль остаётся`, `машина остаётся`, `без проверки КИ`, `любая кредитная история`) ⇒ `service_type=pts_loan`, **unless** a genuine multi-product root (kept `generic_lending`) or clearly real-estate-only (kept `secured_real_estate_loan`). Clear auto-without-PTS can still be `secured_auto_loan`.
- **Contact extraction/sanitation (`bestContact`/`extractContacts`):** deterministically extract reliable public contacts — RU phone (10–11 digits after cleanup; `+7`/`7`/`8`/`8-800`), email, Telegram (`@handle` ≥4 chars or `t.me/`), WhatsApp (`wa.me/`), and contact/profile/application URLs that are **not** just the page `source_url`. Extract from the **model value first** (keeps a valid full contact, drops partials), else from page text; **prefer a deterministic extracted contact over a model partial**. Blank values like `"+7 (495) ..."`, `"номер указан на сайте"`, `"телефон есть на сайте"`, `"требуется извлечение"`, or any ellipsis value with no full reliable contact. Phones inside `wa.me/<digits>`/`t.me/<handle>` URLs are not misread (phone/email/handle scan runs on a URL-stripped copy).
**Reason:** PTS mislabeling undercounts the core product; a contact field must be actionable — keep real contacts, never store a partial/invented one.
**Verification:** WF04 JSON VALID; **exactly 35 business fields** on all 3 emitters + **10** `url_registry` fields unchanged; B3 token set expanded; `extractContacts`/`bestContact(3-arg)` at all 3 emitters; unit-tested — full model contacts kept (no stray phone), `8 800…`/`@handle`/email kept, partials blanked, text fallback works; dedup architecture unchanged; active=false; no tool_use / no KEY=VALUE.
**File:** `n8n/workflows/04_firecrawl_url_list_resilient.json`.

---

## DEC-069 — Lead Discovery Layer: Avito/Classifieds Likely First Source, Pending Stage 3.0 Evaluation

**Date:** 2026-06-07
**Context:** The system's primary business goal is **lead search**, not only competitor monitoring. We need a direction for the next major layer without committing to a connector prematurely.
**Decision:** Design the Lead Discovery Layer now (`docs/LEAD_DISCOVERY_ARCHITECTURE.md`, `docs/LEAD_SOURCE_CONNECTORS_PLAN.md`), but **build nothing** until **Stage 3.0 — Lead Source Evaluation** compares Avito vs Telegram vs VK on data availability, cost, risk, lead quality, and implementation complexity. **Preliminary** (non-binding) recommendation: **Avito/Classifieds first** (public, high-intent, most tractable access — pending actor/API + compliance evaluation), **Telegram second** (needs a separate parser/client design, not just a bot). Manual Records Intake is wired first to validate the lead schema + analyzer with zero source risk.
**Reason:** avoid sinking effort into a connector before its data/cost/risk are known; keep the highest-intent, most-accessible source as the default candidate.
**Files:** `docs/LEAD_DISCOVERY_ARCHITECTURE.md`, `docs/LEAD_SOURCE_CONNECTORS_PLAN.md`.

---

## DEC-068 — Lead Records Use a Separate Schema (`raw_market_records`), Not `url_candidates`; Lead Dedup Is Non-URL

**Date:** 2026-06-07
**Context:** `url_candidates`/`url_registry` model **web URLs**. Leads from classifieds/social/chats have authors, posts, profiles, and sometimes **no stable URL**, and the same intent can be reposted in many places.
**Decision:** Introduce a **separate** record concept for the Lead Discovery Layer: `raw_market_records` (chosen over `lead_candidates` because it also holds competitor posts, content ideas, and market signals), a `lead_discovery_requests` ledger, and a `market_record_registry` that dedups by a **composite `dedup_key`** (`platform + (post_url|message_id)` else `platform + profile + hash(normalized_text)`). The existing **`url_registry` stays URL-only and unchanged**; the two ledgers coexist. All three new sheets are **proposed, not created** (see `TABLE_SCHEMA.md`).
**Reason:** URL equality is insufficient for social/classified dedup (post IDs vs URLs, no-URL records, cross-posting, identity via profile/text). Forcing leads into `url_candidates` would corrupt both models.
**Files:** `docs/TABLE_SCHEMA.md` (Proposed — Lead Discovery Layer), `docs/LEAD_DISCOVERY_ARCHITECTURE.md`.

---

## DEC-067 — Telegram Control Bot Is a Controller, Not a Parser; Pipeline Stays Modular (05 / 06 / 04)

**Date:** 2026-06-07
**Context:** "Telegram" means two different things that must not be conflated, and there is pressure to merge workflows as the system grows.
**Decision:** (1) The **Telegram Bot API** is only ever the **control interface** (commands + summaries; Stage 4) — it is **not** a lead harvester. Historical/public channel/chat collection is a **separate** connector (client/MTProto-style) with its own session/compliance design. (2) The web pipeline **remains modular**: Workflow 05 = discovery, Workflow 06 = approval runner, Workflow 04 = analyzer/consumer. **Do not merge them into one monolith;** the Lead Discovery Layer adds peer workflows rather than collapsing existing ones. Connectors never call Claude; the analyzer never scrapes; human approval is always the spend gate.
**Reason:** conflating bot-vs-parser leads to ToS/compliance and architecture mistakes; a monolith would be unauditable and unsafe to change.
**Files:** `docs/LEAD_DISCOVERY_ARCHITECTURE.md`, `docs/LEAD_SOURCE_CONNECTORS_PLAN.md`.

---

## DEC-066 — Web Pipeline E2E Passed; WF06 Domain Diversity + WF04 Stronger PTS Override & Contact Extraction

**Date:** 2026-06-07
**Context:** A full manual end-to-end test of the web competitor path passed: WF05 (query «автоломбард Москва займ под ПТС без проверки кредитной истории») → 4 approved direct competitors → WF06 selected 4 (read 18, skipped 14, max 5, registry_recheck=enabled) → WF04 processed all 4 → `monitor_queue`, competitors, `parsed_success`. Two issues surfaced: (a) WF06 selected **two URLs from the same domain** `autolombard-moskva.ru` in one run; (b) WF04 left `service_type=generic_lending` on two clearly-PTS pages (`autolombardn1.ru`, `autolombard-moskva.ru/services/…`).
**Decision (patch WF06 + WF04 only — no architecture/dedup change):**
- **WF06 domain diversity (default):** re-derive `domain` from `candidate_url` (same rules as WF05: hostname, lowercase, strip `www.`) and select **at most one URL per domain per run**. A second+ URL from an already-selected domain is skipped with `reason_category=duplicate_domain_in_run`. Priority unchanged + a **root-homepage-first** tiebreaker (root page is preferred for first-pass competitor analysis). A `mode=deep_domain_analysis` is reserved to allow multiple pages/domain but is **not enabled** in v0.1. **`url_registry` semantics unchanged** (still full-normalized-URL dedup); diversity is a per-run selection rule only. `max_per_run=5`, registry recheck, and `manual_handoff_to_workflow_04` all preserved; no auto-call of WF04, no auto-`processed`.
- **WF04 stronger PTS override (B3):** after the existing B2 chain, if `entity_type=competitor` and the URL+evidence contains **≥3** distinct strong tokens (`птс`, `залог птс`, `под птс`, `автоломбард`, `залог авто`, `залог автомобил(я)`, `авто остаётся`, `любая ки`, `без проверки кредитной истории`/`ки`), force `service_type=pts_loan` — **unless** the page is a genuine **multi-product root** (kept `generic_lending`) or **clearly real-estate-only** (kept `secured_real_estate_loan`). Verified by simulation: `autolombardn1.ru`→`pts_loan`, `autolombard-moskva.ru/services/…`→`pts_loan`, `mosinvestfinans.ru/` root→`generic_lending`, lioncredit RE page→`secured_real_estate_loan`.
- **WF04 contact extraction/sanitation:** keep valid full contacts (e.g. `"+7 495 740-01-01, https://t.me/autolombardvip, https://wa.me/79857375386"`, `"8 800 777-95-67; https://lk.cashmotor.ru/"`); blank partial/invented ones (`"+7 (495) … требуется извлечение"`). New `bestContact(model, text)` = sanitized model value if valid, **else** a deterministic `extractContactFromText()` (RU phone 10–11 digits, `t.me/`, `wa.me/`, email) from `text_context` — **prefers a real extracted contact over a model-invented partial**. Applied at all 3 contact emitters. **35 business + 10 registry field counts unchanged; dedup architecture unchanged.**
**Reason:** one run should survey diverse competitors, not many pages of one; PTS mislabeling undercounts the core product; partial contacts are non-actionable but real contacts are valuable.
**Verification:** both `python3 -m json.tool` VALID; WF06 reads `url_registry`, rechecks registry, enforces 1 URL/domain/run (`usedDomains` + `duplicate_domain_in_run`), `MAX=5`, manual handoff; WF04 has `ptsStrongHits`/B3 + `bestContact`/`extractContactFromText` (×3 emitters); both active=false; placeholders only; no Apify/Firecrawl/Claude node added; no tool_use / no KEY=VALUE.
**Files:** `n8n/workflows/06_approved_candidates_runner.json`, `n8n/workflows/04_firecrawl_url_list_resilient.json`.

---

## DEC-065 — Workflow 06 Must Re-Check `url_registry` at Runtime; `url_candidates` Dedup Fields Are Advisory

**Date:** 2026-06-07
**Context:** First Workflow 06 test exposed a trust bug. The operator manually edited an **old duplicate** candidate (`https://www.autolombard-moskva.ru/pledge-pts/`) in `url_candidates` to `dedup_status=unique`, `registry_status=not_in_registry`, `candidate_type=direct_competitor`, `approval_status=approved`. Workflow 06 trusted those editable discovery-time fields and selected it for hand-off (`selected_count=1`) — even though the URL **already exists in `url_registry`**. Selecting a URL already in the registry would cause a duplicate Firecrawl/Claude spend in Workflow 04. The dedup fields in `url_candidates` are set once at discovery time (Workflow 05) and are operator-editable, so they are not a safe final gate.
**Decision (patch Workflow 06 only — same node skeleton):** Workflow 06 must perform the **final dedup check at runtime against `url_registry`**, not against the editable candidate fields:
- Add a **`Read url_registry`** Google Sheets node (Manual Start → Read url_candidates → Read url_registry → Select). The selection code reads both tabs.
- **Re-normalize** `candidate_url` with the **same `normalizeUrl()` rules as Workflow 04/05** (lowercase scheme/host, drop fragment + utm/gclid/yclid/fbclid params, strip trailing slash) and compare the result against the set of `normalized_source_url` values in `url_registry`.
- Selection gate is now: `approval_status=approved` **AND** `candidate_url` not empty **AND** re-normalized URL **NOT** in `url_registry`. `approval_status` ∈ {`processed`,`duplicate`,`rejected`,`error`} is skipped. The editable `dedup_status`/`registry_status` are **ignored** for the decision (kept in output only as informational fields).
- If `url_candidates` says `unique` but the registry contains the URL → **skip** with reason category `registry_recheck_duplicate`. Manual edits to `dedup_status`/`registry_status` cannot force a duplicate through.
- Skip reason categories: `approval_status_not_approved`, `already_processed`, `duplicate_status`, `registry_recheck_duplicate`, `missing_candidate_url`, `not_direct_competitor_optional_warning`, `over_limit`.
- **Change vs DEC-064:** aggregators/directories/marketplaces/socials/media are no longer hard-blocked behind an `aggregator_approved` note — if `approval_status=approved` they **can** be selected, but the selected item carries a `warning` (`candidate_type is not direct_competitor; review before Workflow 04`). Priority unchanged (`direct_competitor` → `confidence_score` desc → `rank` asc), hard cap 5/run unchanged, manual hand-off unchanged, no auto-`processed` in v0.1.
**Reason:** the registry is the single source of truth for dedup; a runtime recheck makes accidental or manual duplicates impossible to hand off and prevents wasted Firecrawl/Claude spend. Candidate-table dedup fields are discovery-time hints, not a final gate.
**Verification:** `python3 -m json.tool` VALID; node types = manualTrigger, **3×googleSheets** (2 read + 1 disabled update), 2×code, if, 2×stickyNote — **no Apify/Firecrawl/Claude/httpRequest node**; `normalizeUrl` present; reads both `url_candidates` and `url_registry`; `registry_recheck_duplicate` skip present; hard cap 5; `manual_handoff_to_workflow_04` preserved; active=false; placeholders only; no tool_use / no KEY=VALUE.
**File:** `n8n/workflows/06_approved_candidates_runner.json`. **Stage 2.2c remains under test until the registry recheck is validated.**

---

## DEC-064 — Workflow 06 Is the Approved-Candidate Bridge; ≤5 Approved URLs per Run

**Date:** 2026-06-07
**Context:** The manual discovery→approval→consume chain is now proven end-to-end (DEC-062). The repetitive operator step — pick approved candidates from `url_candidates`, prioritize them, and hand ≤5 to Workflow 04 — needed a dedicated, auditable workflow without duplicating discovery or analysis logic.
**Decision:** Build `06 - Approved Candidates Runner` (`n8n/workflows/06_approved_candidates_runner.json`, active=false) as the **bridge between discovery (Workflow 05) and the URL consumer (Workflow 04)**:
- Reads `url_candidates`, filters `approval_status=approved AND dedup_status=unique AND registry_status=not_in_registry AND candidate_url not empty`, excludes aggregators/directories/marketplaces/socials/media unless the operator explicitly overrides (note contains `aggregator_approved`).
- Prioritizes `direct_competitor` first, then higher `confidence_score`, then lower `rank`; **hard cap = 5 candidates per run** (eligible rows beyond 5 are skipped with reason `over_max_5_limit`).
- Emits a WF04-shaped batch (`target_url`, `source_type=scraped_web`, `platform=website`, `source_candidate_id`, `discovery_request_id`, `candidate_type`, `run_id`, `batch_index`) plus an Execution Summary and a ready-to-paste `Set URL List` block.
- **Does not** call Apify/Firecrawl/Claude, discover URLs, or duplicate the analyzer. **v0.1 = manual hand-off**: Workflow 04 keeps its Manual Trigger + fixed `Set URL List`; turning it into a callable subworkflow is a risky trigger/input refactor, deferred. A `Mark Candidates Processed` Google Sheets update node exists but is **disabled by default** — the operator enables it (or sets `approval_status=processed` manually) only after confirming `monitor_queue` output, preserving `approved_by`/`approved_at` and appending `Processed by Workflow 06 run_id=…` to `notes`.
**Reason:** keep one controlled, spend-bounded place to release approved work into the consumer; 5/run mirrors Workflow 04's hard cap and bounds cost; manual hand-off avoids destabilizing the proven consumer.
**Verification:** `python3 -m json.tool` VALID; node types = manualTrigger, 2×googleSheets (read + disabled update), 2×code, if, 2×stickyNote — **no Apify/Firecrawl/Claude/httpRequest node**; active=false; placeholders only (no Spreadsheet ID / credential ID); no tool_use / no KEY=VALUE.
**File:** `n8n/workflows/06_approved_candidates_runner.json`.

---

## DEC-063 — Contact Fields Must Be Exact; Partial Contacts Are Blanked

**Date:** 2026-06-07
**Context:** During the first manual E2E test, Workflow 04 stored `contact_public = "+7 (495) ... (номер указан на сайте, требуется извлечение)"` — a partial/placeholder value, not a usable contact. Storing partial contacts is misleading and risks acting on non-data.
**Decision (patch `Normalize + Route` only — no field-count or architecture change):** add a `sanitizeContact()` helper applied wherever `contact_public` is emitted. A value is **blanked** unless it matches at least one reliable public-contact pattern, and is blanked outright if it contains an ellipsis (`...`/`…`) or `требуется извлечение`. Reliable patterns: phone led by `+7`/`8`/`7` with **10–11 digits** after cleanup; valid email; Telegram (`@handle` or `t.me/`); or a contact/profile URL (`t.me/`, `wa.me/`, whatsapp, viber, `vk.com/`, contact/kontakt/profile). `указан на сайте` with no full contact fails the pattern gate → empty. **Never invent or keep a partial contact.**
**Reason:** a contact field must be actionable; an empty cell is correct when extraction is incomplete.
**Verification:** `python3 -m json.tool` VALID; exactly **35** business + **10** registry fields unchanged; dedup untouched; `sanitizeContact` referenced 4× (1 definition + 3 emitters: main analyzed return, technical_error pass-through, deterministic-fallback pass-through).
**File:** `n8n/workflows/04_firecrawl_url_list_resilient.json`.

---

## DEC-062 — Workflow 04 service_type: Root Page May Get a Specific Type When Content Is Overwhelmingly Focused

**Date:** 2026-06-08
**Context:** First manual **end-to-end** test of the discovery→consume chain passed: Workflow 05 discovered `https://carcapital.ru/` (`candidate_type=direct_competitor`, `service_hint=pts_loan`, confidence 100) → operator approved → Workflow 04 processed it → `monitor_queue`, competitor, `CarCapital`, strength 87. **But `service_type=generic_lending` was wrong** — the page text is overwhelmingly PTS/auto (займы под залог ПТС, ставка 2%/мес, автомобиль остаётся у владельца, ПТС, автоломбард, Москва и МО). The prior B2 override (DEC-053/054) only fired on **non-root** URLs, so a single-product *root* homepage kept `generic_lending`.
**Decision (patch `Normalize + Route` B2 only — no architecture/dedup change):** keep the rule that a genuine multi-product root stays `generic_lending`, but add **content-based deterministic scoring** that lets a root page receive a specific `service_type` when its content is overwhelmingly focused:
- count distinct `pts_auto` / `real_estate` / `refinancing` signal tokens over `source_url + evidence`;
- **multi-product root** (`real_estate ≥ 2 AND refinancing ≥ 1`) → keep `generic_lending`;
- else **`pts_auto ≥ 3 AND real_estate ≤ 1 AND refinancing == 0`** → `pts_loan` (applies even to a root homepage);
- else `pts_auto ≥ 3 AND url/path has pts|avto|car|zalog` → `pts_loan`;
- else `real_estate ≥ 3 AND pts_auto ≤ 1 AND refinancing == 0` → `secured_real_estate_loan`;
- existing non-root path-token overrides (pts/auto/real-estate) unchanged.
**Reason:** competitor monitoring needs an accurate product label; a focused autolombard homepage is a PTS lender, not generic. Multi-product portals (e.g. `mosinvestfinans.ru/`) still resolve to `generic_lending`.
**Verification:** `python3 -m json.tool` VALID; 35 business + 10 registry fields unchanged; dedup architecture untouched; simulation of all 6 documented cases PASS — `carcapital.ru/`→`pts_loan`, `cashmotor.ru/`→`pts_loan`, `autolombard-moskva.ru/pledge-pts/`→`pts_loan`, `mosinvestfinans.ru/`→`generic_lending`, `…/kredit/pod-zalog-avto/`→`pts_loan`, `lioncredit…/kredit-pod-zalog-nedvizhimosti`→`secured_real_estate_loan`.
**File:** `n8n/workflows/04_firecrawl_url_list_resilient.json`.

---

## DEC-061 — Workflow 05 Candidate Quality: `candidate_type`, Fixed Domain, Competitor-First Scoring

**Date:** 2026-06-08
**Context:** First real Apify run («займ под залог ПТС Москва») passed technically (10 candidates, 1 registry duplicate, `discovery_requests` row), but quality was weak: `domain` empty for all rows; `confidence_score` too high for aggregators/directories/media; no way to tell a direct competitor from a portal.
**Decision (patch, no architecture change):**
1. **Fixed `domain` extraction** — robust hostname parse with regex fallback, lowercased, leading `www.` stripped (e.g. `https://www.autolombard-moskva.ru/` → `autolombard-moskva.ru`). Computed authoritatively in `Classify Candidates` so it is never empty.
2. **Added `candidate_type`** (`direct_competitor` / `aggregator` / `directory` / `media_article` / `marketplace` / `social` / `unknown`), deterministic from domain allow-lists + keyword/path heuristics. **`url_candidates` grows 25 → 26 columns** (`candidate_type` inserted after `domain`; `domain` moved before `title`/`snippet`).
3. **Competitor-first confidence** — `+30 direct_competitor`; positives for залог/ПТС/авто/Москва/кредит-займ/ставка-сумма/lender; negatives `-50 duplicate_in_registry`, `-35 directory`, `-25 aggregator`, `-20 media_article`, `-20 marketplace` (unless the query asks for one), `-30 social`; clamp 1–100.
4. **Approval policy:** duplicates → `duplicate`; unique direct competitors → `new`; unique aggregators/directories/media → `new` **with a "review manually; not a direct competitor" note**. No auto-reject.
5. Also fixed `looksLender` to match `займ` (not only `заим`/`заём`) — without it, e.g. `carcapital.ru` mis-typed as `unknown`.
**Reason:** make discovery output directly usable for approval and future Telegram summaries; push spend toward real competitors and away from low-value aggregator/portal pages.
**Verification:** `python3 -m json.tool` VALID; only the Apify HTTP node (0 Firecrawl/0 Claude); node simulation on the 10 real-test-like candidates → domains filled, types correct (4 direct_competitor new, cashmotor direct_competitor duplicate, 2gis directory, finuslugi/vbr/banki aggregator, kp media_article), competitors 85–100 vs aggregators/directory/media 15–45, exact **26** url_candidates + **18** discovery_requests field counts.
**Operator action required:** add `candidate_type` to the `url_candidates` sheet (after `domain`) → 26-column header, re-import, rerun the same query.
**File:** `n8n/workflows/05_apify_search_candidate_discovery.json`.

---

## DEC-060 — Workflow 05 Built: Apify Google Search Sync Endpoint, 0 Firecrawl/Claude, Manual Approval

**Date:** 2026-06-08
**Context:** Implementing Stage 2.2 (DEC-059) as a concrete n8n workflow.
**Decision:**
1. **Workflow 05 (`05 - Apify Search Candidate Discovery`) is built** (`n8n/workflows/05_apify_search_candidate_discovery.json`, active=false, 13 nodes). It calls the **Apify Google Search Results Scraper** via the **sync endpoint** `POST /v2/acts/apify~google-search-scraper/run-sync-get-dataset-items?format=json&clean=true` (one query, one page, ≤10 results) using Header Auth credential `Apify API - Marketing Scout`.
2. **Workflow 05 spends 0 Firecrawl and 0 Claude.** It only searches, normalizes (Workflow 04 rules → keys match `url_registry`), reads `url_registry` for dedup, scores candidates **deterministically** (no LLM), and writes `url_candidates` (25 cols) + one `discovery_requests` row (18 cols). It writes **no** business tab.
3. **Manual approval required.** Unique → `approval_status=new`; duplicates (registry or batch) → `duplicate`. No candidate reaches Workflow 04 without a human setting `approved`. The Approved Candidates Runner (Stage 2.2c) and Telegram bot stay deferred.
4. **Robust-write design:** both Sheets-append branches start from the always-1-item `Classify Candidates` node, so the `discovery_requests` row is written even on 0 candidates / Apify error (`status=error`). The Apify HTTP node uses `onError=continueRegularOutput` so a failure still produces a summary row.
5. **Source-agnostic + future-compatible:** Workflow 05 is the *Web Search Connector*; lead-source connectors (Avito/social/classified) come later as separate connectors feeding the same source-agnostic analyzers. Not hardcoded to competitors only.
**Reason:** keep discovery cheap and separate; preserve the human spend gate; reuse the dedup spine; leave room for lead discovery later.
**Verification:** `python3 -m json.tool` VALID; active=false; only the Apify HTTP node (no Firecrawl/Claude/anthropic nodes); no `tool_use`/`KEY=VALUE`; placeholders only (no real token/Spreadsheet ID); node-logic simulation confirmed 25/18 field counts, dedup/batch-dup/registry classification, error path, and confidence discrimination.
**File:** `n8n/workflows/05_apify_search_candidate_discovery.json`, `docs/N8N_WORKFLOW_05_APIFY_SEARCH_CANDIDATES_RU.md`.

---

## DEC-059 — Stage 2.2 = Apify Search Candidate Discovery (Level 2); Manual Intake Demoted; `discovery_requests` Added

**Date:** 2026-06-08
**Context:** Manual URL *lists* are already handled by Workflow 04 (the URL consumer). Positioning Workflow 05 as "manual candidate intake" added little. The real gap is **automated** candidate discovery from a search query, with a human gate before paid processing.
**Decision (refines DEC-058):**
1. **Stage 2.2 becomes `05 - Apify Search Candidate Discovery` (Level 2).** Given a query, an **Apify Google Search Results Scraper** actor returns up to 10 candidate URLs (+title/snippet/rank); Workflow 05 normalizes, checks `url_registry`, scores deterministically, marks duplicates, writes `url_candidates`, and writes/updates a `discovery_requests` row. **Workflow 05 calls neither Firecrawl nor Claude and never auto-processes.**
2. **Manual URL intake is demoted** to an optional fallback input mode of Workflow 05 — **not** the main next step (DEC-058's "Option A first" is superseded on ordering).
3. **Primary discovery API = Apify** (Header Auth credential `Apify API - Marketing Scout`, `Authorization: Bearer <token>`, domain `api.apify.com`). Apify is already the planned stack for future Avito/social/classified actors; **Firecrawl stays the content-extraction layer for known approved URLs**, not for discovery. Fallbacks: Google CSE (low-cost), SerpAPI (paid) — later. Firecrawl `/v2/search` parked.
4. **New sheet `discovery_requests` (18 cols)** groups candidates per request (id, query, region, counts, estimates, lifecycle `status`); `url_candidates` confirmed at 25 cols. No existing sheet removed.
5. **Telegram Control Bot is a control interface later, not a data-processing engine** — it orchestrates `discovery_requests` + `url_candidates` + Workflow 04 and duplicates no scraping/analysis logic.
6. **Source connectors are separate from core analyzers** — new platforms add a *connector* (Web Search / Website Scrape / Classifieds / Social); analyzers (Market Record / Lead Signal / Content Insight / Report) classify records as competitor/lead_signal/content_idea/market_signal/irrelevant **independent of source**.
**Reason:** Workflow 04 already covers manual lists; the valuable next capability is query→candidates automation with approval. Apify fits and is already planned. Keeping discovery, approval, and processing separate preserves cost control and testability.
**Default volumes:** collect 10 candidates; Workflow 04 processes ≤5/run → two batches of 5; nothing processed until `approval_status=approved`.
**File:** planning — `docs/WORKFLOW_05_URL_DISCOVERY_PLAN.md`, `docs/URL_DISCOVERY_STRATEGY.md`, `docs/TABLE_SCHEMA.md`.

---

## DEC-058 — URL Discovery = Hybrid A+B+D; `url_candidates` Grows to 25 Columns; Collect 10 / Process 5

**Date:** 2026-06-08
**Context:** Refining Stage 2.2 before building Workflow 05. The discovery layer must support a future Telegram bot and per-request summaries without re-architecting, while keeping discovery, approval, and processing as separate, independently testable stages.
**Decision:**
1. **Selected architecture = Hybrid A + B + D** (C parked): Option A (manual intake) **first**, then Option B (search/API or Apify actor) once a source is evaluated, then Option D (Telegram) **as an interface only**. Firecrawl `/v2/search` (C) is **parked** — do not combine search+scrape+analysis in one step; if evaluated later, use C for candidate discovery only.
2. **`url_candidates` schema grows from 22 → 25 columns**, adding request-level grouping fields `discovery_request_id`, `requested_by`, `requested_limit` (plus `query`, `created_at` already present) so candidates from one operator request can be grouped, summarized, and reported by a future bot.
3. **Default volumes:** a discovery request **collects up to 10 candidates** (`requested_limit=10`); **Workflow 04 still processes max 5 URLs per run**, so 10 approved candidates run as **two controlled batches of 5**. **No candidate reaches Firecrawl/Claude until `approval_status=approved`.**
4. **Stage 2.2c Approved Candidates Runner** is the named hand-off layer (approved candidates → Workflow 04 in batches of 5); manual for now, not built.
**Reason:** the grouping fields are cheap to add now and expensive to retrofit; the hybrid order de-risks cost and quality; Telegram-as-interface keeps core logic in one place.
**Supersedes:** the 22-column proposal in DEC-055.
**File:** planning — `docs/URL_DISCOVERY_STRATEGY.md`, `docs/WORKFLOW_05_URL_DISCOVERY_PLAN.md`, `docs/TABLE_SCHEMA.md`.

---

## DEC-057 — Telegram Control Bot Deferred Until Candidate + Approval Flow Exists

**Date:** 2026-06-08
**Context:** A natural-language Telegram interface is attractive but it is an *interface*, not a discovery source. Building it before a candidate sheet + human approval flow exist would couple NL parsing, discovery, approval, and processing into one fragile step.
**Decision:** Telegram Control Bot (Stage 2.3) is **deferred** until Stage 2.2a (manual candidate intake) and the approval flow are built and validated (gates G1–G3 in `URL_DISCOVERY_STRATEGY.md`). The bot will then only orchestrate: submit query → show estimated cost → operator approves → write approved URLs → trigger Workflow 04 (or a future Workflow 06).
**Reason:** keep each layer independently testable; never auto-process without a human gate.
**File:** planning — `docs/URL_DISCOVERY_STRATEGY.md`.

---

## DEC-056 — Manual Candidate Intake Before Automated Search (Option A first)

**Date:** 2026-06-08
**Context:** Discovery can be manual (operator pastes candidate URLs) or automated (search API / SERP actor / Firecrawl `/v2/search`). Automated sources carry cost, rate-limit, quality, and ToS risk that must be evaluated.
**Decision:** Stage 2.2 starts with **Option A — Manual URL Candidates** (Workflow 05: normalize → `url_registry` lookup → write `url_candidates`, 0 cost). **Option B** (search API / Apify actor) is a later, measured test after source evaluation (gate G4). **Option C** (Firecrawl `/v2/search`) stays **blocked** until explicitly evaluated — not assumed best.
**Reason:** cheapest, safest, no new external dependency; proves the candidate + approval + dedup flow before any paid discovery.
**File:** planning — `docs/WORKFLOW_05_URL_DISCOVERY_PLAN.md`.

---

## DEC-055 — URL Discovery Is a Separate Layer; Workflow 04 Remains the URL Consumer

**Date:** 2026-06-08
**Context:** Workflow 04 is validated as the URL **consumer** (≤5 URLs → dedup → Firecrawl → Claude → routing). Stage 2.2 needs a URL **supplier** that turns an operator topic/query into vetted candidate URLs.
**Decision:** Build the supplier as a **separate layer**, not inside Workflow 04. A new **`url_candidates`** sheet (22 columns; **expanded to 25 in DEC-058**) holds candidates with `approval_status` (`new`/`approved`/`rejected`/`processed`/`duplicate`/`error`); discovery checks `url_registry` early so already-processed URLs never reach approval or spend; **human approval is required** before any Firecrawl/Claude processing. Workflow 04 is unchanged and keeps its ≤5-URL limit. The candidate normalizer reuses Workflow 04's rules so `url_candidates.normalized_source_url` matches `url_registry` exactly.
**Reason:** separates cost profiles and failure modes (discovery vs analysis), inserts a human gate, and reuses dedup. Keeps each workflow simple and independently testable.
**File:** planning — `docs/URL_DISCOVERY_STRATEGY.md`, `docs/WORKFLOW_05_URL_DISCOVERY_PLAN.md`.

---

## DEC-054 — Workflow 04 Approved for Manual ≤5-URL Mini-Batch; Placeholder Pre-Filter + Stronger PTS Override

**Date:** 2026-06-08
**Context:** 5-URL validation run (`firecrawl_20260607_100715`) passed end-to-end:
- 2 duplicates (`mosinvestfinans.ru/`, `lioncredit.ru/…/kredit-pod-zalog-nedvizhimosti`) → `skipped_log`/`dedup_source_url`, 0 cost.
- 1 placeholder (`zalogpts.ru/`, a Wix "domain not connected" page) → `irrelevant`/`skipped_log` but **only after a Claude call** (`parse_method=primary_json`) — wasteful.
- 2 competitors (`cashmotor.ru/` → `pts_loan`; `autolombard-moskva.ru/pledge-pts/` → competitor but `generic_lending`, should be `pts_loan`).
- Cost: Claude delta **$0.0429**; Firecrawl ~3 credits (only the 3 non-duplicates).

**Decision:**
1. **Workflow 04 is APPROVED for manual ≤5-URL mini-batches.** Hard limits unchanged: manual trigger only, max 5 URLs, no schedule, no crawl/batch/search, no Telegram bot yet.
2. **Placeholder pre-filter (`Normalize Firecrawl Output`):** after markdown cleaning, if the page is an obvious placeholder/parking/domain-not-connected page (`domain not connected`, `wix domain not connected`, `parking page`, `сайт/домен не подключен`, `заглушка сайта`, or bare `coming soon` with **no** business content) → emit a 35-field `skipped_log` row (`parse_method=firecrawl_placeholder_prefilter`, `business_skip`, scores 1, `ignore`) **before any Claude call**. The row still appends to `url_registry` (no repeat processing by default). Strong phrases skip unconditionally; `coming soon` skips only when there are zero commercial terms, to avoid false skips of real pages.
3. **Stronger PTS/path service-type override (`Normalize + Route`):** explicit tokens now force `pts_loan` (`pledge-pts`, `zalog-pts`, `залог ПТС`, `под залог птс`, `птс автомобиля`, `займ под залог птс`, bare `птс`/`pts`), `secured_auto_loan` (`pod-zalog-avto`, `под залог автомобиля`, …) without explicit PTS, and `secured_real_estate_loan` (`pod-zalog-nedvizhimosti`, `залог недвижимости`, `квартир`, `коммерческ`, `залог дом`). Root homepage / multi-product stays `generic_lending`.

**Reason:** deterministic, no architecture/dedup change, no prompt tuning. Placeholder pre-filter saves Claude spend on parked domains; the PTS override fixes the one mislabelled competitor (`autolombard-moskva.ru/pledge-pts/`).

**Operational note:** after each import, `Append url_registry` must be set manually — **Sheet = `url_registry` (name mode, NOT the dynamic `{{ $json.route }}`), Mapping = Automatically, real Document ID, Google Sheets credential**. `Registry Lookup` also uses Sheet = `url_registry`. Only `Append to Dynamic Route Sheet` uses `{{ $json.route }}`.

**Verification:** `python3 -m json.tool` VALID; 35 business + 10 registry fields preserved; dedup path unchanged; node simulation — `pledge-pts` → `pts_loan`, `pod-zalog-avto` → `secured_auto_loan`, `…nedvizhimosti` → `secured_real_estate_loan`, root → `generic_lending`; Wix-not-connected + bare coming-soon → skip, coming-soon-with-offer + real page → process. Primary lane nodes lifted to y=140 so the technical-error arrow reads cleanly.

**File:** `n8n/workflows/04_firecrawl_url_list_resilient.json`.

---

## DEC-053 — Workflow 04 Approved for Manual Mini-Batch; Output Language Guard + URL/Path Service-Type Override

**Date:** 2026-06-08
**Context:** Two-run validation of Workflow 04 (after the `url_registry` patch) passed:
- **Run 1** (`firecrawl_20260607_094000`, 3 URLs) — all reached `monitor_queue` as competitors (`МосИнвестФинанс` 78/80; `МОСИНВЕСТФИНАНС` 78/82; `LionCredit` 75/75). `url_registry` was empty, so all three were processed (expected).
- **Run 2** (`firecrawl_20260607_094303`, same 3 URLs) — all three → `skipped_log` / `business_skip` / `parse_method=dedup_source_url`, **0 Firecrawl / 0 Claude**. Dedup confirmed working.

Two output-quality issues surfaced: (a) the auto/PTS service page `…/kredit/pod-zalog-avto/` was labelled `generic_lending` instead of `pts_loan`/`secured_auto_loan`; (b) the repaired `LionCredit` row came back with an **English** `reason` on a Russian source page.

**Decision:**
1. **Workflow 04 is APPROVED for manual mini-batch (3–5 URLs, manual trigger only).** Larger automation stays blocked (no schedule, no crawl/batch/search, no >5 URLs, no discovery/Telegram).
2. **`url_registry` is the single source of truth for dedup.** Old business rows written before the registry existed do **not** dedup unless backfilled into `url_registry`. Backfilling older rows is **optional future maintenance**, not required.
3. **Output language guard (`Normalize + Route`):** when the source is Cyrillic but the final `reason` is mostly English / CJK / foreign-script, replace it with a deterministic Russian fallback by `entity_type` (competitor → "Страница содержит признаки конкурента … Запись отправлена в мониторинг конкурентов."). Same guard applied to `offer_text` (build a short Russian offer from company/service/terms).
4. **URL/path service-type override (`Normalize + Route`):** a **specific** service URL beats the multi-product `generic_lending` default — `pod-zalog-avto`/`залог ПТС`/`ПТС` → `pts_loan` (or `secured_auto_loan` without PTS), `pod-zalog-nedvizhimosti`/`залог недвижимости`/`квартир`/`коммерческ` → `secured_real_estate_loan`. A **root homepage** (no service path segment) stays `generic_lending`.

**Reason:** keep deterministic, no heavy prompt tuning, no architecture/dedup change. Language consistency and service-type precision are post-model normalization, where they are cheap and reliable.

**Verification:** `python3 -m json.tool` VALID; 35 business fields + 10 registry fields preserved; dedup path unchanged; root → `generic_lending`, `/kredit/pod-zalog-avto` → `pts_loan`/`secured_auto_loan`, `/uslugi/kredit-pod-zalog-nedvizhimosti` → `secured_real_estate_loan`.

**File:** `n8n/workflows/04_firecrawl_url_list_resilient.json`.

---

## DEC-051 — Workflow 04 Dedup Uses a Dedicated `url_registry` Tab (Supersedes Six-Tab Scan)

**Date:** 2026-06-08
**Context:** The first Workflow 04 test re-processed a URL that had already been analyzed earlier — the four-tab `Dedup Lookup` chain (`results/review_queue/monitor_queue/content_queue`) was fragile and did not reliably block duplicates. Scanning six business tabs per URL is brittle and does not scale to a future Telegram Bot / URL Discovery agent.

**Decision:** Dedup uses a **dedicated `url_registry` tab** (10 columns), keyed by `normalized_source_url`, checked **before** Firecrawl/Claude. A match (with `force_reprocess=false`) → `skipped_log` / `parse_method=dedup_source_url`, **0 cost**. After **every** non-duplicate processing attempt — including `technical_errors` — Workflow 04 appends a row to `url_registry` (`Build Registry Row` → `Append url_registry`), so a URL is not re-processed by default. `force_reprocess` (a field on `Set URL List`, default `false`) bypasses dedup for manual/future overrides. The six-tab scan is **rejected and removed**.

**Reason:** one registry tab is cleaner, cheaper (one read), and future-proof. Telegram Bot / URL Discovery can write/consume the same registry.

**Verification:** node simulation — duplicate → 35-field `skipped_log`; non-duplicate → source record; `Build Registry Row` emits exactly the 10 registry fields.

**File:** `n8n/workflows/04_firecrawl_url_list_resilient.json`.

---

## DEC-052 — Deterministic Competitor Fallback After Primary+Repair JSON Failure

**Date:** 2026-06-08
**Context:** On long real pages (`mosinvestfinans.ru/kredit/pod-zalog-avto/`, `lioncredit.ru/…/kredit-pod-zalog-nedvizhimosti`) Firecrawl returned rich markdown but both the primary and repair JSON parses failed, routing clear competitors to `technical_errors` even though `raw_response_preview` plainly showed `entity_type=competitor`, a company, and a service type. Those should be `monitor_queue`, not lost.

**Decision:** After primary+repair both fail to yield JSON, `Parse Repaired JSON` runs a **deterministic** fallback: count competitor signals (кредит, займ, залог, ПТС, авто, недвиж, ставка, сумма, телефон, Москва, руб, %, …) over `text_context`+primary raw preview. If **≥5 signals** and the source is a scraped website → build a 35-field `competitor` row (`route=monitor_queue`, `parse_method=deterministic_competitor_fallback`, `recommended_action=monitor`, `repair_status=failed_fallback`, `needs_manual_review=true`), deriving `company_name` (МосИнвестФинанс / LionCredit / hostname / «Конкурент без бренда»), `service_type` (pts_loan / secured_real_estate_loan / generic_lending), short `offer_text`/`terms`, `region`, and `competitor_strength` 70 (or 80 with ≥8 signals + contact/amount). If **<5 signals** → `technical_errors` (unchanged). This is **deterministic hardening, not prompt experimentation** — the primary/repair prompts were left intact (only a small safety line added to the repair prompt). Also lowered `text_context` cap to **3500** + added markdown cleaning (drop image/svg lines, commercially-relevant lines first), and made both JSON parsers deterministic (strip fences → direct parse → first balanced object → first `{`..last `}`).

**Verification:** simulation — junk repair text + 8 signals → `monitor_queue` / `deterministic_competitor_fallback` / МосИнвестФинанс / pts_loan / strength 80, 35 fields; low-signal junk → `technical_errors`, 35 fields.

**File:** `n8n/workflows/04_firecrawl_url_list_resilient.json`.

---

## DEC-048 — Batch Schema = 35 Columns (run_id + batch_index)

**Date:** 2026-06-08
**Context:** Workflow 04 processes several URLs per run; rows need to be grouped by run and ordered by URL position for traceability and cost attribution. The operator extended all six Google Sheets tabs from 33 to 35 columns by adding `run_id` and `batch_index`.

**Decision:** The production/batch schema is now **35 columns** = 25 core + 8 technical + `run_id` + `batch_index`. `run_id` is one id per execution (`firecrawl_YYYYMMDD_HHmmss`); `batch_index` is the 1-based URL position within the run (0 if N/A). **Workflow 04 fills both on every output path** (dedup-skip, firecrawl-error, analyzer, repaired-technical-error). **Workflows 02 and 03 may leave them empty** — the dynamic append auto-maps by header, so absent fields are written blank. All six tabs must carry the same 35-column header.

**Verification:** node simulation confirms all WF04 output paths emit exactly 35 keys including `run_id`/`batch_index`.

---

## DEC-049 — Workflow 04 Deduplicates by source_url Before Firecrawl/Claude Spend

**Date:** 2026-06-08
**Context:** Re-running an overlapping URL list would create duplicate rows and waste Firecrawl credits + Claude tokens. The plan made dedup a first-class requirement.

**Decision:** Workflow 04 normalizes each URL (lowercase scheme/host, strip `#fragment`, drop tracking params `utm_*`/`gclid`/`yclid`/`fbclid`, remove trailing slash except root) into `normalized_source_url`, then looks it up in the four **business** tabs (`results`, `review_queue`, `monitor_queue`, `content_queue`) **before** calling Firecrawl/Claude. A match → `skipped_log` row with `parse_method=dedup_source_url`, `processing_status=business_skip`, **zero Firecrawl/Claude cost**. `technical_errors` and `skipped_log` are intentionally **not** hard-duplicate blockers, so previously failed/skipped URLs can be retried.

**Implementation status: IMPLEMENTED (best-effort).** Four Google Sheets `read` nodes filter `source_url` (`filtersUI` lookup) with `alwaysOutputData=true` + `onError=continueRegularOutput`; `Evaluate Dedup` aggregates via `$('node').all()` and matches the exact normalized key. If a given n8n build rejects the lookup config on import, the RU guide documents a fallback (whole-tab read + compare, or temporary dedup bypass). Dedup is never silently omitted.

**File:** `n8n/workflows/04_firecrawl_url_list_resilient.json`.

---

## DEC-050 — Future Telegram Bot May Feed URL Lists to Workflow 04; URL Discovery Deferred

**Date:** 2026-06-08
**Context:** A natural next-product step is letting the operator request analysis in plain language (e.g. «найди конкурентов по кредитам под залог авто в Москве») instead of pasting URLs.

**Decision:** A future Telegram Control Bot / URL Discovery agent may collect or generate candidate URLs, estimate cost, ask for confirmation, then pass the list into Workflow 04 (whose dedup prevents repeated processing). **This is deferred** — URL discovery and NL requests are a separate future layer. **Workflow 04 accepts only manually provided URLs** (max 5). Not built now.

---

## DEC-045 — Firecrawl Single-URL Competitor Websites Approved (After Two Successful Tests)

**Date:** 2026-06-08
**Context:** Workflow 03 (`03_firecrawl_single_url_resilient.json`), after the DEC-043/044 hardening, passed two real single-URL tests:
- **Test 1 — `https://mosinvestfinans.ru/`** (multi-product homepage): `route=monitor_queue`, `entity_type=competitor`, `company_name=МосИнвестФинанс`, `region=Москва`, `service_type=generic_lending`, `competitor_strength=78`, `quality_score=78`, `recommended_action=monitor`, `processing_status=parsed_success`, `parse_method=primary_json`, `repair_used=false`.
- **Test 2 — `https://www.lioncredit.ru/uslugi/kredit-pod-zalog-nedvizhimosti`** (specific real-estate collateral page): `route=monitor_queue`, `entity_type=competitor`, `company_name=LionCredit`, `service_type=generic_lending`, `competitor_strength=75`, `quality_score=75`, `recommended_action=monitor`, `parsed_success`, `primary_json`, `repair_used=false`.

**Decision:** **Firecrawl single-URL ingestion of competitor websites is approved** for controlled, manual use, and competitor-website → `monitor_queue` routing is approved. This is now a known-good source type for the pipeline.

**Still blocked:** multi-page crawl, batch scraping over large URL lists, scheduled scraping, and real ingestion of Avito/Telegram/Instagram. The next step up is the **small mini-batch** (DEC-047), not a crawler.

**Note:** `service_type` may later be refined to `secured_real_estate_loan` for clearly single-product real-estate pages (Test 2 returned `generic_lending`); not a blocker.

---

## DEC-046 — n8n Credential Rebinding After Import Is an Operational Requirement

**Date:** 2026-06-08
**Context:** Workflow JSON stores credentials by **name + a placeholder ID** (`PASTE_CREDENTIAL_ID_HERE`). n8n credential IDs are **local to each instance**, so on every import the four credential-bearing nodes lost their binding and required manual reselection before the workflow could run.

**Decision:** Treat **manual credential rebinding after every import** as a standard operational step, documented in each workflow's RU guide. After importing Workflow 03 (and future Firecrawl workflows), rebind:
- `Firecrawl Scrape API` → `Firecrawl API - Marketing Scout`
- `Claude Primary API Request` → `Claude API - Marketing Scout`
- `Claude Repair API Request` → `Claude API - Marketing Scout`
- `Append to Dynamic Route Sheet` → `Google Sheets - Marketing Scout Service Account` (+ real Spreadsheet ID)

This is expected behavior, not a bug. Keeping credential IDs as placeholders in the repo is correct (no secret leakage); the cost is one manual rebinding pass per import.

---

## DEC-047 — Workflow 04 May Process a Small Manual URL List (Max 5, No Schedule)

**Date:** 2026-06-08
**Context:** With single-URL competitor ingestion approved (DEC-045), the next step is to iterate over a few URLs — but without jumping to crawl/batch/schedule, which multiply cost and failure surface.

**Decision:** Workflow 04 (planned, not built) may process a **manually provided list of 3–5 competitor URLs in one manual run**. Hard limits: **max 5 URLs**, **manual trigger only**, **no crawl**, **no schedule**, `text_context`≤6000, continue-on-failure per URL (failed URL → `technical_errors`). **Deduplication by `source_url` is a first-class requirement** for Workflow 04 (in-run de-dup always; cross-run Sheets lookup recommended). Reuses Workflow 03's analyzer/normalize/routing nodes verbatim.

**Build gate:** plan documented in `docs/WORKFLOW_04_FIRECRAWL_URL_LIST_PLAN.md`. **Do not build until the operator approves the plan.**

---

## DEC-043 — Post-Repair Business-Consistency Hardening for Scraped Competitor Pages

**Date:** 2026-06-08
**Context:** First real-source test (Firecrawl on `https://mosinvestfinans.ru/`, a rich secured-lending homepage). Firecrawl succeeded (1 credit); the **primary** Claude analysis failed JSON parse; the **repair** branch succeeded (`parse_method=repaired_json`, `repair_used=true`, `repair_status=success`). But the repaired output was internally contradictory and was routed to `review_queue`: `entity_type=competitor` yet `competitor_strength=1`, `quality_score=6`, `recommended_action=investigate`, `service_type=pts_loan` (despite many real-estate/refinancing products), and a **reason written in Chinese** ("活跃抵押贷款竞争对手…"). Architecture worked; the **repaired JSON is structurally valid but not trustworthy for business values**.

**Decision:** `Normalize + Route` now distrusts repaired/low-confidence output and enforces business invariants for scraped website pages (it does **not** change any prompt):

1. **Competitor signal counting** over `text_context + offer_text + terms + reason + scraped markdown` using a Russian secured-lending term list (кредит, займ, залог, ПТС, авто, недвиж, рефинанс, ипотек, ставка, сумма, одобрен, плохая кредитн, просрочк, телефон, москва, московск).
2. **Competitor consistency rule (≥3 signals, `entity_type=competitor`, `source_type=scraped_web`, `platform=website`):** `competitor_strength=max(cur,65)`, `quality_score=max(cur,65)`, `recommended_action=monitor`, `route=monitor_queue`, `needs_manual_review=false` unless `parse_error` exists, `processing_status` stays `parsed_success`. **≥5 signals:** floors raised to 75.
3. **Repaired-JSON trust rule:** if `repair_used=true` and `entity_type=competitor`, never allow `competitor_strength<45` unless the scraped text is empty/unusable (<80 chars); rich competitor website pages must **never** land in `review_queue` (route forced to `monitor_queue` before the weak-lead branch).
4. **Language guard:** if the source text contains Cyrillic but `reason` contains CJK characters or is mostly non-Cyrillic/non-Latin, replace `reason` with a Russian fallback (a fixed competitor sentence, or a templated sentence from entity/company/service/terms/region/scores for non-competitors).
5. **`raw_response_preview`** capped at **200** chars on `parsed_success` (still 500 on `technical_error`) — no need to store large model output after a clean parse.

**Verification:** Node simulation of the mosinvest repaired output → `monitor_queue`, `entity_type=competitor`, `company_name=МосИнвестФинанс`, `service_type=generic_lending`, `competitor_strength=75`, `quality_score=75`, `recommended_action=monitor`, Russian `reason`, `needs_manual_review=false`, 33 fields. Regression (hot lead→results, weak lead→review_queue, skip→skipped_log, technical_error passthrough, auto/PTS-only competitor→monitor_queue keeping `pts_loan`) all pass with 33 fields.

**File:** `n8n/workflows/03_firecrawl_single_url_resilient.json` (`Normalize + Route` only). No new workflow copy (validation passed). No prompt change, no new fields.

---

## DEC-044 — Multi-Product Website Pages Classify as generic_lending Unless One Product Dominates

**Date:** 2026-06-08
**Context:** The mosinvest homepage advertises залог недвижимости, рефинансирование, ипотека, and залог авто/ПТС together. The repaired `service_type` came back `pts_loan` merely because "ПТС" appeared, misrepresenting a multi-product lender as an auto-collateral specialist.

**Decision:** In `Normalize + Route`, when `source_type=scraped_web` and `platform=website`, detect product categories (real-estate collateral, refinancing, mortgage, auto/PTS). If **two or more** categories are present, set `service_type=generic_lending` — a single keyword (e.g. "ПТС") must not force a narrow type. A genuinely single-product page (e.g. only `кредит под залог авто`/ПТС) keeps its specific enum (`pts_loan`/`secured_auto_loan`). Expected for the mosinvest homepage: `generic_lending` (or `secured_real_estate_loan`), never `pts_loan`.

**File:** `n8n/workflows/03_firecrawl_single_url_resilient.json` (`Normalize + Route`).

---

## DEC-039 — First Scraper Source Is Firecrawl Single URL (Not Crawl / Batch / Search)

**Date:** 2026-06-07
**Context:** Workflow 02 production resilient analyzer smoke test passed (competitor record → `monitor_queue`, `processing_status=parsed_success`, `parse_method=primary_json`, dynamic Sheets routing confirmed). The first real source can now be connected.

**Decision:** The first scraper is **Firecrawl `POST /v2/scrape` on one URL at a time** — not crawl, not batch, not search, no `actions`, no browser steps. Workflow 03 (`03_firecrawl_single_url_resilient.json`) scrapes one public competitor page, normalizes the markdown into a source record, and feeds it to the same resilient analyzer.

**Rationale:** Lowest risk and lowest cost. One URL keeps anti-bot exposure, credit burn, and failure surface minimal while the per-URL cost profile is still unknown. The competitor → `monitor_queue` path is already validated (Test C + production smoke). Crawl/batch/search multiply cost and failure modes before we have a cost baseline.

**Trigger to expand:** Only after a passing single-URL test with a recorded cost delta may multi-URL be considered (then Avito/Apify → Telegram → Instagram).

**File:** `n8n/workflows/03_firecrawl_single_url_resilient.json`. active=false, placeholders only.

---

## DEC-040 — Firecrawl MCP/CLI Integration Deferred

**Date:** 2026-06-07
**Context:** Firecrawl offers an HTTP API, an MCP server, and a CLI.

**Decision:** Use the **n8n HTTP Request node** against `https://api.firecrawl.dev/v2/scrape` with Header Auth. The **MCP server and CLI are deferred** to a later phase for local agent / browser automation, where an interactive agent drives scraping itself.

**Rationale:** The HTTP node is transparent (visible in the execution log), reuses the existing Claude HTTP pattern and the credential-by-name model, and needs no extra daemon/runtime on the constrained VPS. MCP/CLI add a local process and a different auth/runtime surface with no benefit for a single n8n-orchestrated scrape.

**Doc:** `docs/FIRECRAWL_SETUP.md`.

---

## DEC-041 — Firecrawl Failures Route to technical_errors Without a Claude Call

**Date:** 2026-06-07
**Context:** If Firecrawl returns an HTTP/API error or an empty/unusable page, sending it to Claude would waste AI spend and produce a meaningless analysis.

**Decision:** The `Normalize Firecrawl Output` Code node emits a complete **33-field `technical_errors` row** directly when (a) the Firecrawl call errored, or (b) the scrape succeeded but the cleaned markdown has **fewer than 80 meaningful characters**. The `IF Firecrawl Normalized OK?` node then sends that row straight to `Append to Dynamic Route Sheet`, **bypassing Claude**. Error rows carry `parse_method=firecrawl_error`, `processing_status=technical_error`, `needs_manual_review=true`, `route=technical_errors`, and a `raw_response_preview` (≤500) of the error/markdown.

**Note on empty content:** an empty-but-successful scrape is treated as `technical_errors` (scrape succeeded, content unusable) rather than `skipped_log`, so the operator sees a pipeline issue, not a business skip (DEC-038 distinction preserved).

**File:** `n8n/workflows/03_firecrawl_single_url_resilient.json` (`Normalize Firecrawl Output`, `IF Firecrawl Normalized OK?`).

---

## DEC-042 — text_context Capped at 6000 Chars Before Claude (Firecrawl Cost Control)

**Date:** 2026-06-07
**Context:** Real scraped pages are far longer than the ~200-char test records. Unbounded markdown would inflate Claude token cost per record and risk gateway limits.

**Decision:** `Normalize Firecrawl Output` cleans the markdown (strip `\r`, collapse 3+ blank lines, trim) and caps `text_context` at **6000 characters** before it reaches `Build Primary Claude Request`. The first test uses **one URL only**; per-record cost is measured on that run and logged in `docs/COSTS_AND_LIMITS.md`.

**Rationale:** 6000 chars preserves enough of a competitor landing page to classify it (offer, rates, region, contact) while bounding token cost. Tighter caps can be applied later once the cost/quality tradeoff is measured on real pages.

**File:** `n8n/workflows/03_firecrawl_single_url_resilient.json` (`Normalize Firecrawl Output`).

---

## DEC-038 — Production Smoke-Test Patch: Diagnostics Preservation, Compact Repair, 33 English Columns

**Date:** 2026-06-06
**Context:** First manual production smoke test (competitor website record) failed: primary parse failed, the Repair API returned **502 Bad Gateway / upstream_error**, the row went to `technical_errors`, and `raw_response_preview` showed only the repair error — the primary raw response was lost, making diagnosis impossible.

**Decisions:**
1. **`technical_errors` rows must preserve both failure stages.** `parse_error` = `Primary: <primary error> | Repair: <repair error>` (≤800). `raw_response_preview` keeps the **primary** raw response first (≤500), appending the repair error only if space remains. The primary raw response is never overwritten by the repair error alone. `Parse Primary JSON` now always emits `primary_parse_error`, `primary_raw_response_preview`, `content_summary`, `original_record`; `Parse Repaired JSON` reads them back via `$('Parse Primary JSON')`.
2. **Compact repair payload to reduce gateway 502 risk.** Repair request: trimmed `original_record` (essential fields, `text_context`≤500), `primary_raw_response_preview`≤500, `primary_parse_error`≤300, compact schema + enum summary, `max_tokens=700`, `temperature=0`. System prompt opens "You are a JSON repair formatter, not a market analyst…". No tool_use, no KEY=VALUE.
3. **Production schema is 33 English machine columns** (25 core + 8 technical). Every Sheets tab uses exactly this header. **Russian/human display names are deferred to the Telegram/reporting layer** — they are not part of the internal schema, and the Sheets headers must stay English.
4. **`parse_method=technical_error`** is used when repair fails (distinct from `primary_json` / `repaired_json` success values).
5. **Primary prompt reminder** added (short): JSON-only output, and classify competitor-website records as `competitor` when they offer secured lending services/rates/speed/contact/Moscow-MO coverage. No methodology bloat, no format experiment.
6. **No new workflow copy** — patched in place (validation passed). Firecrawl stays blocked until the patched production smoke test passes.

**Verification:** `python3 -m json.tool` VALID; output schema still exactly 33 fields; leakage scan shows no test/mock/tool_use/KEY=VALUE; logic simulation of primary-fail + repair-502 chain produces a `technical_errors` row carrying both errors and the primary raw preview (33 fields).

**File:** `n8n/workflows/02_claude_api_single_record_v2_resilient_router_production.json` (patched).

---

## DEC-037 — Production Resilient Workflow Strips Test Fields; Test Harness Retained as Evidence

**Date:** 2026-06-06
**Context:** Tests A–E passed on the dynamic-sheet test harness. The harness writes 14 test-only columns (`test_id`, `expected_*`, `actual_*`, `test_pass_basic`, `test_notes`, `source_record_type`) plus mock-mode logic — correct for testing, wrong for production tabs.

**Decision:**
1. **Create a separate production workflow** `02_claude_api_single_record_v2_resilient_router_production.json` (name: `... RESILIENT ROUTER PRODUCTION`). It removes `Set Test Selector`, `Select Test Record`, `IF Skip Primary API?`, all mock-mode logic (`mock_markdown`, `mock_unrepairable`), and every test-only output field. Production emits exactly **33 fields = 25 core + 8 technical**.
2. **Production input** is a single `Set Source Record` node with a safe placeholder (`source_url=https://example.com/source`, `text_context=PLACEHOLDER_TEXT_REPLACE_BEFORE_RUN`, `parsed_at={{ $today }}`) until a scraper is connected.
3. **Test harness retained** (`..._resilient_router_test_dynamic_sheet.json`) as A–E evidence — not the production artifact.
4. **Obsolete Switch-based workflows removed** via `git rm`: `..._resilient_router_test.json` (Switch v3) and `..._resilient_router_test_fixed.json` (Switch v1). Superseded by dynamic-sheet routing (DEC-035).
5. **`repair_used` and `repair_status` retained** as production technical fields — they tell the operator whether the JSON Repair Formatter ran and whether it succeeded, which is operationally important for trust and cost.
6. **`raw_response_preview` capped at 500 chars** in production (was 1200 in the harness) — enough for debugging, not too wide for Sheets, reduces noise/leakage.
7. **`recommended_action` normalized to the route** in `Normalize + Route`: results→contact (lead), review_queue→investigate (unless lead contact & score≥70), monitor_queue→monitor (competitor), technical_errors/skipped_log→ignore, content_queue→create_content (unless a stronger action is justified).
8. **`source_url` is the first v0.1 dedup key.** No dedup column yet; a future scraper workflow should check existing `source_url` before append. Any future `dedup_key` column requires a documented justification and a matching schema/header update.

**Verification:** logic simulation of production `Normalize + Route` — A→results/contact/pts_loan, B→review_queue/investigate/secured_auto_loan, C→monitor_queue/monitor/`МФО / частный кредитор`, D→results/contact/pts_loan, E→technical_errors/ignore, skip→skipped_log/ignore; all emit exactly 33 fields. `python3 -m json.tool` VALID. No test/mock/tool_use/KEY=VALUE leakage.

**Files:** `n8n/workflows/02_claude_api_single_record_v2_resilient_router_production.json` (created); two Switch workflows removed. active=false, placeholders only, no real secrets.

---

## DEC-036 — Routing Priority Fix + service_type/company_name Normalization (Post Tests A–E)

**Date:** 2026-06-06
**Context:** Dynamic-sheet resilient router Tests A–E were run. A, C, D, E passed. **Test B failed business intent:** a weak/potential lead with clear product fit was classified (via repair) as `content_idea` and routed to `content_queue`. Two secondary gaps surfaced: Test C had empty `company_name` for a competitor MFO, and Test D's repaired `service_type` came back as free text (`"займ под залог ПТС"`) instead of an enum.

**Decision:** Patch `Normalize + Route` only (no prompt change, no architecture change, no new workflow copy):

1. **Routing priority** (strict order): technical_errors → business-skip/irrelevant → hot lead (`results`) → **weak/potential lead (`review_queue`)** → competitor (`monitor_queue`) → pure content idea (`content_queue`) → fallback `review_queue`. The weak-lead rule runs **before** content_queue.

2. **Weak/potential lead rule** → `review_queue` if ANY: entity=lead_signal with lead_signal_score 30–69; OR recommended_action=investigate; OR (lead_signal_score≥30 AND source_type in [social, classified] AND text mentions loan/collateral/PTS/auto/real-estate/refinancing); OR (entity=content_idea AND lead_signal_score≥30 AND source_type in [social, classified] AND service_type≠unknown).

3. **content_queue** only if entity=content_idea AND content_idea_score≥50 AND the weak-lead rule did not match.

4. **service_type normalization** to enum: птс/pts→`pts_loan`; авто/машин + collateral→`secured_auto_loan`; недвиж/квартир/дом/земл→`secured_real_estate_loan`; рефинанс→`refinancing`; ипотек→`mortgage_adjacent`; бизнес→`generic_lending` (or `secured_real_estate_loan` only if real-estate collateral explicit); else `unknown`. Already-valid enums pass through unchanged.

5. **company_name descriptive fallback** (competitor, when empty): МФО/микрофинанс/mfo→`МФО / частный кредитор`; частный инвестор→`Частный инвестор`; автоломбард→`Автоломбард`; брокер→`Брокер`; otherwise `Конкурент без бренда`. Never invents a brand.

6. **Test-pass logic:** for `expected_route=review_queue`, pass = (route=review_queue AND needs_manual_review=true AND lead_signal_score≥30) — route-focused, since entity may legitimately differ after repair. Other routes keep strict entity match.

**Verification:** logic simulation confirmed A→results, B→review_queue, C→monitor_queue (company_name=`МФО / частный кредитор`), D→results (service_type=`pts_loan`); all `test_pass_basic=true`.

**Retest required:** Test B (live), then optional A/D smoke. C/E paths unchanged.

**File:** `n8n/workflows/02_claude_api_single_record_v2_resilient_router_test_dynamic_sheet.json` (Normalize + Route node only). active=false, no real secrets.

---

## DEC-035 — Dynamic Google Sheets Routing Replaces Switch by Route

**Date:** 2026-06-06
**Context:** The Switch by Route node (6 outputs → 6 separate Google Sheets Append nodes) caused recurring visual/import problems in the n8n UI: append nodes shifted position, connection lines from Switch did not render reliably, and the six near-identical Append nodes were redundant. Two prior attempts (`_test.json` typeVersion 3 rules-mode, `_fixed.json` typeVersion 1 string-match) both imported but left a cluttered, hard-to-read canvas.

**Decision:** Replace the Switch by Route node and the six per-tab Append nodes with a **single dynamic Google Sheets Append Row node**. The `route` field already contains the exact target tab name (`results`, `review_queue`, `monitor_queue`, `content_queue`, `skipped_log`, `technical_errors`), so the node uses Sheet Name expression `={{ $json.route }}` with Map Automatically. `Normalize + Route` connects directly to this one node.

**Routing logic unchanged.** All thresholds and priority ordering stay in `Normalize + Route`. Only the n8n destination implementation changed: 7 nodes (1 Switch + 6 Append) → 1 node.

**Route-validation safety added to `Normalize + Route`:** if `route` is missing or not one of the six valid values, the node forces `route = technical_errors`, `processing_status = technical_error`, `needs_manual_review = true`, and appends `invalid_route` to `parse_error`. No record can be lost to a bad/empty tab name.

**Fallback:** if a given n8n build rejects an expression in the Google Sheets Sheet Name resourceLocator, revert to branch-based routing — six IF nodes (one per `route` value), each feeding a fixed-tab Append node — using `_fixed.json` as the base. Documented in `docs/N8N_WORKFLOW_02_RESILIENT_ROUTER_TEST_RU.md`.

**Credential/secret pattern unchanged:** `PASTE_CREDENTIAL_ID_HERE`, `PASTE_SPREADSHEET_ID_HERE`, credentials by name only. active=false.

**File:** `n8n/workflows/02_claude_api_single_record_v2_resilient_router_test_dynamic_sheet.json`
**Supersedes (for testing):** `_test.json` and `_fixed.json` (kept as history, not deleted).

---

## DEC-034 — Resilient Router TEST HARNESS: 21-Node Workflow with Mock Modes

**Date:** 2026-06-06
**Context:** Building a testable harness for the Resilient Output Layer (DEC-033) without requiring real scraped data or live API calls for negative tests.
**Decision:** The TEST HARNESS uses three mock modes in Select Test Record:
- `none` — real Primary Claude API call (Tests A, B, C)
- `mock_markdown` — bypasses primary API; feeds a simulated Markdown response to Repair Formatter (Test D)
- `mock_unrepairable` — bypasses primary API; feeds an unreadable response; Parse Repaired JSON checks `mock_mode` and forces `processing_status=technical_error`, `route=technical_errors` regardless of repair output (Test E)

Repair API is still called for Test E (unavoidable — the mock bypass is in Parse Repaired JSON, not before the HTTP node). One extra API call for Test E is acceptable — costs ~$0.001.

IF Skip Primary API? checks `skip_primary_api === true` and routes True → Build Repair Request, False → Claude Primary API Request. The HTTP body strips `skip_primary_api` via explicit field selection in body expression so Anthropic API does not receive unknown parameters.

Normalize + Route passes through confirmed `technical_error` records without re-routing. For all others it validates entity_type and recommended_action against allowed enum sets, clamps scores 1–100, and applies routing thresholds. Test assertion fields (`test_pass_basic`, `test_notes`, `expected_route`) are output alongside business fields for easy review in Sheets.

**Credential pattern:** `PASTE_CREDENTIAL_ID_HERE` for both httpHeaderAuth and googleApi in all relevant nodes. `PASTE_SPREADSHEET_ID_HERE` for all 6 Append nodes. No real secrets in file.

**File:** `n8n/workflows/02_claude_api_single_record_v2_resilient_router_test.json`
**Guide:** `docs/N8N_WORKFLOW_02_RESILIENT_ROUTER_TEST_RU.md`

---

## DEC-033 — Resilient Output Layer: Two-Pass Parse + Repair + Multi-Tab Router

**Date:** 2026-06-06
**Context:** Extended tests 9–12 confirmed that the single-step Claude JSON output is structurally unstable for non-obvious records:
- Test 9 (Instagram competitor): no `text` item in content array — thinking-only response.
- Test 10 (Avito refinancing): Claude returned Markdown analysis block instead of JSON.
- Test 11 (weak website competitor): Claude returned Markdown analysis block instead of JSON.
- Test 12 (out-of-region SPb lead): invalid JSON structure.
- Test 5 (content_idea): JSON.parse failure from unescaped characters in string fields.

In all cases, Claude's reasoning was sound. The failures were output serialization failures, not reasoning failures.

Five output strategy experiments (v2.0 raw JSON, v2.1 safety rules, v2.2 tool_use, v2.3–v2.5 KEY=VALUE) all failed — either from gateway 502 constraints or from parsing edge cases. Further prompt-level format experiments are not expected to eliminate the failure mode.

**Decision:** Replace the single-step output architecture with a Resilient Output Layer:
1. **Primary parse:** attempt JSON.parse on Claude's natural output (baseline behavior unchanged).
2. **Repair pass:** on parse failure, send the raw response to a dedicated JSON Repair Formatter (a second Claude call, Haiku model, ~400-char strict schema-only prompt). Reformats without re-analyzing. Does not add new facts.
3. **Multi-tab Router:** replaces the binary Quality Gate. Routes to 6 Google Sheets tabs: `results`, `review_queue`, `monitor_queue`, `content_queue`, `skipped_log`, `technical_errors`.

**Three output states defined:**
- `parsed_success`: machine-parseable on first attempt.
- `technical_error`: unparseable even after repair.
- `business_skip`: correctly parsed; Claude determined record is not actionable.

**tool_use status:** Deferred — gateway returns 502 for `tools`/`tool_choice` parameters.
**KEY=VALUE status:** Deferred — v2.3–v2.5 all returned 502 from gateway at various prompt sizes.

**Applies to:** Workflow 02 TEST HARNESS (Phase 1). After Tests A–E pass, migrate to production Workflow 02. All future output layers in this project should use the two-pass pattern.

**Design spec:** `docs/WORKFLOW_02_RESILIENT_OUTPUT_LAYER.md`

---

## DEC-032 — Telegram Control Bot Is Future Roadmap, Not Current MVP

**Date:** 2026-06-05
**Decision:** An operator Telegram Control Bot (Stage 2.5 in ROADMAP.md) is added to the project plan but is not part of the current MVP scope. It requires: (1) at least one stable real scraping source, (2) Workflow 02 approved for production, (3) Telegram Webhook configured in n8n. Building the bot before the data pipeline is stable would create an interface with nothing to interface. Prioritize real source testing first.
**Applies to:** All session planning. Do not start bot implementation until Step E (Firecrawl) is complete and approved.

---

## DEC-031 — Do Not Repeat Proven Tests; Extend with Business-Priority Scenarios

**Date:** 2026-06-05
**Decision:** Tests 1–7 were designed to cover basic classification correctness. Test 1 confirmed the baseline works strongly. Rather than re-running all 7 tests (which would cost ~$0.10 and mostly repeat confirmed behavior), the extended test set (8–12) covers the uncle's actual business priorities: Telegram hot leads, Instagram competitors, Avito refinancing, website weak signal, and out-of-region cap. These scenarios are more representative of real scraping output and cover edge cases not exercised in the original 7-test set.
**Applies to:** Workflow 02 v2 testing. After extended tests pass, close this testing stage.

---

## DEC-030 — Content Automation Deferred to Stage 3 (Content Agent)

**Date:** 2026-06-05
**Decision:** `content_idea` records are not production-approved for Workflow 02. The current Quality Gate (status=analyzed AND quality_score≥60) passes content_idea records to Google Sheets, but the schema has no dedicated column or review process for them. They create noise in the leads/competitors table. Content intelligence is deferred to Stage 3 (Content Agent) with a separate Sheets tab, separate Quality Gate, and separate n8n branch. Extended tests 8–12 do not include content_idea scenarios.
**Applies to:** Workflow 02 configuration and all future Quality Gate decisions until Stage 3 is designed.

---

## DEC-029 — Baseline Raw JSON Is the Working Fallback; v2.1–v2.5 Experiments Deferred

**Date:** 2026-06-05
**Context:** The d350069 baseline raw JSON harness works: Test 1 passed (entity_type=lead_signal, recommended_action=contact, quality_score=97, lead_signal_score=98). The v2.1–v2.5 experiments all failed or were unstable:
- v2.1: JSON.parse failures on Test 1 and Test 5.
- v2.2: Gateway 502 on tool_use.
- v2.3: Gateway 502 at 9.2 KB.
- v2.4: Gateway 502 at 5.3 KB.
- v2.5 MICRO: curl still returned 502 at ~2 KB.
All 502 failures happened after Test 1 passed on the baseline — the gateway can handle the baseline payload.
**Decision:** The baseline raw JSON harness (d350069) is the current working approach. The v2.1–v2.5 experiment files are preserved in the repository but are not the active test path. The immediate task is to fix the only known baseline failure point: Test 5 (`content_idea` with long text that produced JSON.parse errors). A shortened Test 5 is the smallest possible change to validate before approving the baseline.
**Rationale:** Incrementally fixing the baseline is lower-risk than chasing gateway compatibility with experimental output formats that all returned 502. The gateway clearly handles the baseline payload — the only remaining question is whether Claude produces valid JSON for the shortened Test 5 text.
**Next step:** Run `02_claude_api_single_record_v2_baseline_short_test5.json` with test_id=5 first. If it passes, run test_id=1 to confirm baseline is unaffected. Then decide whether to approve the baseline for production.
**Applies to:** Prompt v2 test strategy until gateway constraints are resolved or a direct Anthropic API endpoint is available.

---

## DEC-028 — Micro-Sized Runtime Prompts Required; Detailed Methodology Stays in Docs Only

**Date:** 2026-06-05
**Context:** v2.4 compact prompt (5.3 KB / 5343 chars) still returned 502 upstream_error from the gateway. Minimal curl with a very small prompt continues to work. Conclusion: the gateway cannot reliably handle even moderately sized prompts — the threshold is well below 5 KB.
**Decision:** Strip runtime prompts to the absolute minimum — essential rules, enums, field limits, and output format only. Target: 1500–2200 chars (~1.5–2 KB). All detailed methodology (ICP description, evidence rules, anti-hallucination prose, full skip rules) is preserved in the canonical prompt file (`MARKETING_AGENT_PROMPT_V2.md`) for reference and debugging, but is NOT included in the runtime prompt sent to Claude.
**v2.5 MICRO changes:**
- System prompt: 5343 chars (v2.4) → 1997 chars (v2.5). −63%.
- max_tokens: 700 → 450. Sufficient for 25 KEY=VALUE lines.
- User message: removed profile_url (not needed for core analysis).
- Field limits tightened: offer_text 140→80, text_context 220→100, detected_need 160→100, reason 220→120.
**Long-term posture:** Detailed agent prompts and tool_use are deferred until an official Anthropic API endpoint or a verified-stable gateway is confirmed. Micro prompt is the production approach for this gateway. If scoring quality is insufficient, restore sections one at a time and retest.
**If 502 persists with v2.5 MICRO:** The issue is NOT prompt size. Check gateway balance (402 masks as 502), per-minute rate limits, or account-level routing. Run raw curl from VPS with the full v2.5 payload to isolate n8n from gateway.
**Applies to:** All Claude API calls via aiprimetech.io until gateway constraints are resolved or a different gateway is adopted.

---

## DEC-027 — Compact Prompts Required for Stable Gateway Execution

**Date:** 2026-06-05
**Context:** v2.3 used the correct KEY=VALUE line protocol (resolves JSON parsing failures) but still returned 502 Bad Gateway on Test 1. The prompt was 9.2 KB. A minimal curl with a short prompt to the same gateway and same model works correctly. Conclusion: the gateway has request-size or processing-time constraints that cause 502 for large payloads. The failure is not network-level or credential-level.
**Decision:** Use compact prompts for all Claude API calls via this gateway. Target: ≤6 KB system prompt. Specific reductions in v2.4:
- System prompt: 9.2 KB → 5.3 KB (same business logic, rewrote all sections for brevity).
- max_tokens: 1100 → 700 (line protocol responses are short; 700 is sufficient for 25 KEY=VALUE lines plus field content).
- temperature: kept at 0.1.
- Field char limits tightened: offer_text 180→140, detected_need 220→160, text_context 300→220, reason 350→220.
**If 502 persists with v2.4 compact prompt:** the issue is not prompt size. Check gateway balance (402 can be masked as 502), model routing, or per-minute rate limits. Do a raw curl from the VPS to isolate n8n vs. gateway.
**Long-term:** If an official Anthropic API endpoint or a verified-compatible gateway becomes available, restore full prompt length and re-evaluate tool_use (DEC-025). Compact prompt is a workaround for the current gateway constraint.
**Applies to:** All Claude API calls via aiprimetech.io until gateway constraints are clarified.

---

## DEC-026 — KEY=VALUE Line Protocol for Claude Output (Gateway Does Not Support tool_use)

**Date:** 2026-06-05
**Context:** Three output strategies failed or were unavailable:
1. v2.0/v2.1: Raw JSON text. Claude put unescaped quotes or colons inside field values (`offer_text`, `reason`, `detected_need`), breaking `JSON.parse`. Prompt-level rules and Parse-node cleanup reduced but did not eliminate failures.
2. v2.2: Anthropic tool_use structured output. The gateway (aiprimetech.io) returned 502 Bad Gateway for all requests containing `tools` and `tool_choice` parameters. tool_use is not supported by this gateway.
   Also discovered: Select Test Record node was not connected to Build Claude Request v2.2 in the generated workflow JSON (stale connection key from node rename). Entire test chain was broken.
**Decision:** Use plain text KEY=VALUE line protocol. Claude returns exactly 25 lines in order: `field_name=value`. The n8n Parse node (`Parse Claude Line Response`) splits each line on the first `=` character and assembles a JS object. No `JSON.parse` is called on Claude's output. Integer fields are parsed with `parseInt` and clamped to 1–100. Enum fields are validated; invalid values fall back to safe defaults. Parse failures are caught deterministically: if fewer than 5 fields are found, `parse_method=line_failed` is returned.
**Workflow fix:** All connections rebuilt from scratch in the Python generation script. The broken connection bug is resolved. The connection chain is now explicit and verified at build time.
**Build parameters changed:** `max_tokens` 1400 → 1100; `temperature` 0.2 → 0.1; no `tools`; no `tool_choice`. User message appended with `\n\nReturn KEY=VALUE lines only.` for reinforcement.
**Known edge case:** If Claude returns a value containing `=` (e.g. in `terms` field), the parser takes everything before the first `=` as the key and everything after as the value. The prompt instructs Claude to avoid `=` inside values. This is acceptable for MVP.
**Applies to:** TEST HARNESS v2.3. If a gateway supporting tool_use becomes available, DEC-025 strategy is preferred and should be re-evaluated at that point.

---

## DEC-025 — tool_use Structured Output Is the Preferred Architecture for Claude API Integration

**Date:** 2026-06-05
**Context:** Raw JSON text output from Claude failed JSON.parse in production twice across two prompt versions:
- v2.0: Test 5 (content_idea) — Claude put colons and quotes inside `offer_text` string value.
- v2.1: Test 1 (strong lead) — Claude put unescaped content inside `reason` or `detected_need` string value.
Prompt-level instructions (JSON SAFETY RULES) and Parse-node-level cleanup (brace extraction, smart-quote normalization) reduced but did not eliminate the failure mode. The root cause is that any Russian text field containing a period, quote, or colon adjacent to other JSON syntax will break `JSON.parse` if Claude serializes incorrectly.
**Decision:** Use Anthropic Messages API `tool_use` structured output instead of asking Claude to write JSON text. The API request includes:
1. `tools`: array with one tool definition `return_marketing_analysis` containing a full JSON Schema (25 fields, `additionalProperties: false`).
2. `tool_choice: { type: "tool", name: "return_marketing_analysis" }` to force the call.
Claude fills schema fields directly. The API serializes the result — Claude never writes raw JSON string values containing quotes or escape sequences. The Parse node reads `content.find(c => c.type === "tool_use" && c.name === "return_marketing_analysis").input` directly as a plain JS object.
**Text fallback retained:** The old text parser remains as a fallback path (`parse_method=text_fallback`) in case the gateway (aiprimetech.io) strips `tools`/`tool_choice` parameters before passing to Claude. If all 7 tests return `text_fallback`, the gateway does not support tool_use and a different solution is needed.
**Parse method field:** The Parse node now outputs `parse_method` = "tool_use" | "text_fallback" | "text_failed" | "none" for observability.
**Prompt changes:** Removed JSON SAFETY RULES, OUTPUT FORMAT, and REQUIRED JSON SCHEMA sections. Added FIELD CONSTRAINTS and OUTPUT INSTRUCTION sections. Business logic unchanged.
**Applies to:** All Claude API integrations in this project from v2.2 onward. If the gateway supports tool_use, prefer it over raw text output for all structured data extraction.

---

## DEC-024 — Prompt v2 Cannot Be Approved If Any Expected-Analyzed Record Fails JSON Parsing

**Date:** 2026-06-05
**Context:** Test 5 (content_idea record) failed with a JSON.parse error in the Parse node during the first full test run. Tests 1, 2, 3, 4, 6, 7 passed. The failure was caused by Claude returning unescaped double quotes or colons inside the `offer_text` string value — a well-formed reasoning response but invalid JSON output.
**Decision:** A JSON parse failure on any record that is expected to return `status=analyzed` is an automatic blocker for Prompt v2 approval. Prompt must be patched and the failing test rerun before the full suite can be approved.
**Rationale:** A parse failure means the output cannot be written to Google Sheets and cannot be used by any downstream system. A prompt that passes 6/7 tests on reasoning quality but produces unparseable output on the 7th is not production-ready. Parse errors are not acceptable in a data pipeline.
**Fix applied in v2.1:** JSON SAFETY RULES section added to prompt; offer_text and detected_need field instructions tightened; Parse node upgraded with brace extraction and smart-quote normalization as a defensive backstop.
**Trigger to unblock:** Rerun Test 5 after v2.1 patch; confirm JSON.parse succeeds and `offer_text` is a plain-text angle (no leading labels, no internal quotation marks, ≤180 chars).

---

## DEC-023 — Prompt v2 Testing: Use TEST HARNESS Workflow, Not Manual Node Editing

**Date:** 2026-06-05
**Context:** The original plan for testing Prompt v2 was to duplicate Workflow 02, manually paste the new prompt into the Build Claude Request Code node, and manually change the Set node fields for each of the 7 test records. This requires 7 manual Set-node edits per run and risks introduction of copy-paste errors.
**Decision:** Use a dedicated importable test harness workflow (`02_claude_api_single_record_v2_test_harness.json`) that has Prompt v2 and all 7 test records pre-embedded. The operator changes only a single `test_id` integer (1–7) to select each record. No manual prompt pasting or code editing required.
**Benefits:** Reproducible, error-resistant, keeps the production Workflow 02 untouched, the harness can be re-imported from Git if accidentally broken in n8n UI.
**Gate unchanged:** The production Workflow 02 is still updated only after all test criteria pass and the operator gives explicit approval.

---

## DEC-022 — Prompt v2 Schema: No New Columns Until v2 Is Validated in Production

**Date:** 2026-06-05
**Context:** The Prompt v2 plan (`MARKETING_AGENT_PROMPT_V2_PLAN.md`) defines four new output fields: `competitor_threat_summary`, `content_angle`, `urgency_indicator`, `icp_fit`. These would provide richer intelligence but require Google Sheets schema changes (new columns), updated n8n output mapping, and re-import of the workflow JSON.
**Decision:** Prompt v2 will use the same 25-field schema as Prompt v1. No new columns are added until v2 passes the 7-record synthetic test, is approved by the operator, runs successfully on real scraped data, and the operator confirms the additional fields are worth the added complexity.
**The new fields are documented as planned** in `MARKETING_AGENT_PROMPT_V2.md` (Planned Future Fields section) and will be implemented in schema v2.1+ after production validation.
**Rationale:** Adding columns before the schema is stable is technical debt. The priority is getting v2 reasoning quality validated, not expanding the output surface area.
**Trigger to add new fields:** v2 is in stable production use (≥ 20 real scraped records analyzed); operator reviews output and confirms new fields are needed.

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
