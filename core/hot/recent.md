# Hot Memory — Recent Sessions

Most recent first. Keep last 3 sessions max. Archive older entries to `core/warm/decisions.md`.

---

## Session: 2026-06-23 (session 25) — Moscow time + non-empty staging + Stage 4 free path (DEC-157)

**Status (exact):** same branch `fix/stage3-verification-stage4-readiness`. **$0, 0 external calls, every
workflow `active=false`, NOT pushed/merged/imported, no production change, no secret exposed.** Consolidated
package fixing the SECOND live Stage 3C failure (non-empty staging) + completing the Russian Stage 4 free path.

**Residual QA-018 cause (found):** a correct live write still failed `READ_BACK_AGENT_REQUEST` because the
staging sheet held prior QA runs AND the timestamp columns (`created_at`/`ts`/`updated_at`/`added_at`/
`last_change_at`) re-render in Google's offset-less locale form (`23.06.2026 15:04:05`) that `Date.parse` can't
round-trip. **Fix:** new `n8n/lib/ms_time.js` (Europe/Moscow, IANA offset, RFC3339 `+03:00`, `DD.MM.YYYY HH:mm
МСК`); engine `toInstant` now Moscow-aware (mirrors it) so Z/+03:00/offset-less/RU+US renderings = one instant;
QA harness writes Moscow RFC3339.

**Non-empty staging (QA-019 robustness):** `findRequestARow` locates request A by FULL identity (qa_run_id +
agent_request_id + owner + data_mode + role marker, never first-match); `verifyBeforeAfter` classifies
current_run_owned / previous_qa_run / foreign_non_qa and holds the latter two unchanged. Diagnostics gain
physical_row/key/qa_run_id/reason; empty = `[]` not `[null]`. New markers CURRENT_RUN_OWNED_ROWS /
PREVIOUS_QA_RUN_ROWS / FOREIGN_NON_QA_ROWS. Proven by §21 (fresh run over prior A+B + foreign rows).

**Stage 4 free path:** `agent_config` gains canonical fail-closed zero-paid guards (enable_telegram/
enable_external_actions/enable_claude/enable_apify/firecrawl/vk/monitoring/weekly_digest; `zero_paid_mode`,
`effective_max_external_calls`, helpers paidCallsAllowed/collectorEnabled/llmAllowed/freePathStatus);
`MS_MAX_EXTERNAL_CALLS=0` master kill-switch; approval can't bypass. `/start` now a deterministic Russian command
(intent_router → welcome/help, no API). Stage 4 workflows regenerated (deterministic).

**Evidence (offline):** `make test` ALL SUITES PASS — sheets-operations-qa **190**, ms-time **24**,
stage4-freepath **76**; manifest 187, validate_workflows.py 277, validate_sheet_contracts 363; all generators
drift-clean. New docs: `docs/STAGE_4_BOT_DEPLOYMENT.md` (BotFather list + Russian UX + auth + idempotency +
approval + zero-paid + env + deploy + webhook + smoke + rollback). DEC-157.

**Status markers:** QA-018/QA-019 = FIXED IN CODE — LIVE RETEST REQUIRED; STAGE_4_IMPLEMENTATION = READY FOR
LIVE DEPLOYMENT TEST. **Next:** operator live Stage 3C retest (4-run sequence) + Stage 4 free-path smoke.

---

## Session: 2026-06-23 (session 24) — Stage 3C QA-018/QA-019 fix + Stage 4A readiness audit (DEC-156)

**Status (exact):** branch `fix/stage3-verification-stage4-readiness` off `main` `820a593`. **$0, 0 external
calls, every workflow `active=false`, NOT pushed/merged/imported, no n8n import, no credentials touched, no
production change.** Consolidated repair of the two live Stage 3C defects + a read-only Stage 4A Telegram
live-readiness audit.

**QA-018 (read-back) — FIXED IN CODE, LIVE RETEST REQUIRED.** The first live write was correct but
`READ_BACK_AGENT_REQUEST` failed because `USER_ENTERED` values come back **rendered**: `-5`→`-5.00` /
`-4.5`→`-4.50` (bootstrap number format `#,##0.00####` on `*_usd` columns), `false`→`FALSE` (checkbox). Fix =
one shared **contract-aware comparison layer** in `n8n/lib/sheets_operations_qa.js` (numeric/boolean/timestamp/
text/blank semantics; blank never == 0/false; locale digits only on proven-numeric columns; legitimate
apostrophes preserved) with structured `READ_BACK_FAILURES` diagnostics. Formula safety stays **separate**: a
bounded `spreadsheets.get?includeGridData=true` typed read (new nodes *Build Request-A Type Range* + *Get
Request-A Cell Types*) proves each formula cell is `userEnteredValue.stringValue`, never `formulaValue`.

**QA-019 (before/after scope) — FIXED IN CODE, LIVE RETEST REQUIRED.** Byte comparison mis-counted the run's
own normalized rows as foreign, so `BEFORE_AFTER_SCOPE` failed while all scope counters were 0. Fix =
**identity-based** `verifyBeforeAfter` (run-owned vs foreign by marker/identity; foreign rows compared with the
same contract-aware comparator) returning structured `BEFORE_AFTER_FAILURES`. No check removed.

**Markers (D):** `WRITE_NODE_EXECUTED / WRITE_REQUEST_SUCCEEDED / MUTATIONS_EXECUTED / AFTER_SNAPSHOT_READ /
ACCEPTANCE_VERIFIED / CHANGES_APPLIED / RESULT` are now separable & truthful — `CHANGES_APPLIED=true` even when
verification fails; once the write node ran, `RESULT` is acceptance-based (no fall-back to the dry-run PASS).

**Evidence (offline):** `tests/test_sheets_operations_qa.js` **162 checks** PASS; generated workflow **20 nodes**,
deterministic (`source_hash=h1287b23e`, regen twice byte-identical); `node tests/run_all.js` ALL SUITES PASS
(`$0`, 0 external calls); manifest 187, `validate_workflows.py` 277, `validate_sheet_contracts` 363.

**Stage 4A audit:** read-only (`docker compose ps`, `docker ps`, `n8n --version`); no import/activation/restart;
no secrets printed. See `docs/STAGE_4A_TELEGRAM_LIVE_READINESS.md`.

**Commits (local only):** `fix(sheets): verify normalized Stage 3C read-back`, `docs(stage4): add Telegram
live-readiness audit`.

**Next:** operator live retest sequence (dry-run → first write new `QA_RUN_ID` → repeat same id → final dry-run)
to close QA-018/QA-019; then Stage 4A controlled live E2E. See `docs/STAGE3_SHEETS_OPERATIONS_ACCEPTANCE.md`.

---

## Session: 2026-06-21 (session 23) — Reporting UX & release-verification phase (DEC-155)

**Status (exact):** branch `feat/reporting-ux-and-release-verification` (baseline `b7a95c1`). **$0, 0 external
calls, all 31 workflows `active=false`, NOT pushed/merged/imported, no credentials.** Built reporting outputs
(scoped CSV/XLSX/charts, evidence, compare, NL filter, smart refresh), conversation UX (scope/cost preview in
WF19, progress in WF20, weekly digest WF25), optional VK public-community collector (`vk_collector.js` + WF26 +
WF23 edge — *structurally implemented, offline-tested, live-unverified*), honest Telegram channel capability,
URL SSRF + prompt-injection safety, and the storage layer (`sheets_contracts.json` + validator + `sheet_audit` +
`retention_policy`). New WF24/25/26; libs embedded drift-proof.

**Commits this session (local only):** `6478ac0` progress/scope/digest libs · `8fc91bf` reporting WF integration
· `673a5bd` VK collector · `9cc2068` storage contracts/retention · `b9bec47` url-safety + telegram channel +
capability matrix · (+ test(release) e2e/docs commit). `make test` ALL SUITES PASS (external calls=0, $0).

**Next:** operator review → optional push/PR; credentialed staging test for VK + Telegram bot-update before
marking production-live; n8n import remains unproven (CLI absent). See
`docs/REPORTING_UX_AND_RELEASE_VERIFICATION.md`.

---

## Session: 2026-06-21 (session 22) — Release hardening: proactive delivery + scheduled monitoring (DEC-153)

**Status (exact):** final automated release-hardening before controlled install. Branch
`stage-3-closure-and-stage-4`. **0 external calls, $0**, all workflows `active=false`, **not pushed**, no n8n
import. Three planned commits: (1) `feat(agent): complete proactive report assistance and scheduled
monitoring`; (2) `fix(release): verify n8n persistence subworkflow and delivery wiring`; (3) `test(release):
add full project regression and disposable import smoke`.

**Commit 1 — BUILT (DEC-153):**
- **Proactive delivery in the REAL path:** WF20 `Build Delivery Outbox` now co-embeds conversation_response +
  agent_charter; `deliveryBody` = immutable facts + state-aware proactive continuation (registry-driven;
  partial/no-data → recovery actions); keyboard on FINAL chunk only (`intent:<id>` callbacks).
- **WF23 Scheduled Tracked Source Monitor** (16 nodes, real Schedule Trigger, `active=false`) + new
  `n8n/lib/source_monitor.js`: due selection, sched/manual idempotency window, content-hash change detection
  (baseline-then-diff), lifecycle updates, change event persisted BEFORE notify, notify-once (`change_id =
  source_id::new_hash`). Manual "check now" reuses the contract with a manual window.
- **Collector truthfulness:** website=WF04; telegram=WF11 fixture-first/approval-gated t.me/s preview (recent
  posts only, not bot channel_post/comments) — `MS_ENABLE_TELEGRAM_COLLECTOR`; vk=WF13 disabled placeholders →
  `setup_required`. `tracked_sources.addSource` sets honest initial status + monitoring fields + chat_id.
- Tests: `test_monitoring.js` (59). Migration: tracked_sources monitoring fields + chat_id, new
  `source_change_events`, §B4 collector config. Deploy order += WF23. `make test` → ALL PASS (28 workflows,
  validator 259, $0, 0 calls).

**Was scheduled monitoring present before this block?** NO — no schedule trigger / WF23 existed (verified).
**n8n CLI:** NOT installed locally → static resolver (`tools/audit_workflows.js`) + documented disposable-import.

**Commit 2 — DONE `35990e5` (DEC-154):** operator-authorized fix of callable triggers.
- **Execute Sub-workflow Triggers added** to WF04/08/10/12/16 (node *When Called by Agent*), each preserving its
  Manual Trigger for standalone diagnosis. Each declares a canonical input contract (`agent_request_id`,
  `source_run_id`, `workflow_run_id`, `data_mode`, + per-workflow filters/budget/force flags). The config node
  merges those inputs over its defaults; manual mode (empty input) is **byte-identical** (all Stage 1-3 suites
  still pass). WF20/21/23 now pass **named** canonical fields via `workflowInputs` (no `.first()` reliance in the
  callable). `audit_workflows.js` now **hard-fails** if a callable lacks the trigger or is publicly exposed.
- **Persistence/delivery wiring proven:** WF18 reconstructs context from Sheets (conversation_state read+upsert,
  messages read+append, summaries); WF20 persists execution_summaries + telegram_outbox before send.
- **`deploy_n8n.sh --activate-triggers`** finished: WF18 always, WF23 only when `MS_MONITORING_ENABLED=true`;
  version detection; explicit confirm; never activates a callable; refuses if n8n CLI absent. `test_release_audit.js`
  → 98 checks. `docs/N8N_COMPAT_AND_TOPOLOGY.md` updated (gap RESOLVED + classification + contracts).

**Commit 3 — DONE (this session):** `test_release_e2e.js` (62) — full 20-step multi-turn monitoring E2E
(search→clarify→approve→collect→quality→report→proactive→deep facts/recs→add source→idempotent dup→scheduled
no-change→meaningful change→one notification→reuse evidence→compaction→follow-up resolves competitors) + negative
paths (unauth, dup update, invalid plan, unapproved/cancelled/over-budget gate, fail-closed source health,
all-quarantined no-data, Telegram retry/never-resend, dup monitor window, missing tg/vk collector, deleted memory,
ephemeral no-state). `scripts/n8n_import_smoke.sh` = disposable temp-folder import (prints exact command when n8n
absent). `make test` → ALL PASS (34 suites, validator 259, $0, 0 calls, all `active=false`). **Not pushed.**

---

## Session: 2026-06-21 (session 21) — Conversational agent: NL intent + bounded memory + deep analysis (DEC-151/152)

**Status (exact):** transforming the button-driven Stage 4 bot into a real conversational agent. Branch
`stage-3-closure-and-stage-4`. **0 external calls, $0**, all workflows `active=false`, **not pushed**, no n8n
import, no AI attribution. Three planned commits: (1) `feat(agent): add conversational intent routing and
bounded memory`; (2) `feat(agent): add context-aware deep competitor analysis`; (3) `test(agent): add
multi-turn memory and deep-analysis e2e`.

**Commit 1 (conversational intent + memory) — BUILT:**
- 5 libs in `n8n/lib/`: `agent_charter` (immutable versioned charter + deterministic capability registry;
  availability from allowlist; Claude can't invent IDs), `intent_router` (deterministic-first; guarded Claude
  classifier with strict `validateIntentJSON`; clarification fallback; `intent:<id>` button == typed intent;
  no external work from unvalidated intent), `conversation_memory` (L1 state, L2 window=8, L3 versioned rolling
  summary preserving IDs/decisions verbatim, L4 per-user durable memory + forget/forget_all audit with value
  HASH not raw, L5 artifacts, token-budgeted `buildContext` never drops charter/state/safety/newest),
  `conversation_response` (useful text w/o buttons + post-report NL invitation; optional buttons only),
  `tracked_sources` (add/list/pause/resume/remove/check; idempotent; honest platform availability).
- Generator extended: WF18 now conversational (13 nodes: Route Intent, Build Conversation Context, Build
  Conversational Reply) + new **WF22 Conversation Control & Sources** (9 nodes). Both `active=false`.
- Tests: `test_agent_contracts.js` (109) + `test_agent_workflows.js` (30 drift+harness). Registered.
- Migration extended (§B2: conversations/conversation_messages/conversation_state/conversation_summaries/
  durable_memories/memory_audit_events/context_usage/tracked_sources/source_audit_events). Deploy order += WF22.
- `make test` → ALL SUITES PASS (29 suites + validator 247 + lead_scout); $0; 0 calls; 26 workflows active=false.

**Commit 2 (context-aware deep analysis) — BUILT (DEC-152):**
- 2 libs: `deep_analysis` (bounded plan w/ graceful degradation website_only→full; honest unavailable_sources;
  evidence contract; `assembleDeepReport` separates evidence-backed FACTS from RECOMMENDATIONS — orphan recs
  never become facts) + `orchestration_policy` (`reuseDecision` reuse/collect/extend; context-answerable intents
  spend $0; explicit refresh/stale collects; new configured platform extends).
- Generator: new **WF21 Deep Competitor Analysis** (14 nodes) + WF20 gains `Orchestration Reuse Decision` +
  `Needs External Call?` branch (21 nodes). Both `active=false`.
- Tests: `test_deep_analysis_contracts.js` (43) + `test_deep_analysis_workflows.js` (22). Registered.
- Migration §B3: orchestration_decisions / deep_analysis_findings / deep_analysis_recommendations. Deploy += WF21.

**Commit 3 (multi-turn E2E + docs) — BUILT:**
- `test_agent_e2e.js` (30) — full mocked dialogue: search→plan→approve(free text)→report→"сравни первых двух
  подробнее"→deep plan from prior report→approve→deep report (facts vs recommendations)→"добавь их сайты"
  (resolved from context, added once/idempotent)→"что ещё умеешь?" (only configured caps)→window overflow→
  rolling summary preserves rep_1→follow-up still resolves CASHMOTOR,CarCapital→"идеи" reuses report, $0 calls.
  Single external-call counter; 0 external calls.
- `docs/CONVERSATIONAL_AGENT.md` (Mermaid architecture + sequence + intent schema + memory/compaction + control
  commands + deep analysis + source availability + reuse + tests + limitations). README points to it.
- Fix surfaced by E2E: help regex broadened (`умеешь|что ещё`) so "а что ещё ты умеешь?" routes to help; WF18
  regenerated.
- Three commits landed: `215a6c8` (intent+memory), `0f13f9f` (deep analysis), + this docs/e2e commit.
- `make test` → ALL SUITES PASS (32 JS suites + validator 253 + lead_scout); $0; 0 calls; 27 workflows active=false.

**Open:** operator runtime retest (Stage C.1 + the one controlled live E2E). No further code work queued.

---

## Session: 2026-06-21 (session 20) — Stage 4 single-user Telegram agent MVP (branch stage-3-closure-and-stage-4, DEC-150)

**Status (exact):** Phase A (Stage 3 closure) already LANDED as `0d0ab69`
(`fix(stage3): close production analysis aggregation and reporting gates`). Phase B (Stage 4 MVP) BUILT and
about to land as `feat(stage4): add telegram agent orchestration MVP`. **0 external calls, $0**, all
workflows `active=false`, **not pushed**, no n8n import, no AI attribution.

**Phase B (Stage 4) — what's in:**
- **7 contract libraries** (`n8n/lib/`): `agent_config` (one central config, fail-closed defaults, no
  secrets), `agent_state` (14-state durable machine, terminal absorbing, cancel-from-any, `canMakeExternalCall`),
  `request_planner` (deterministic plan + guarded Claude planner + strict JSON validation + budget clamps),
  `approval_gate` (single paid-call chokepoint; `GATE_TERMINAL` renamed to avoid `const` clash with
  `agent_state.TERMINAL` when co-embedded; deterministic `idempotencyKey`), `source_adapter` (canonical
  result + `rollupCollection` complete/partial/no_data; cost never fabricated to 0), `telegram_io`
  (parse/auth/duplicate-`update_id`/MarkdownV2 escape/3900-chunk/outbox payload-hash dedup),
  `execution_summary` (one flat canonical summary + single next action).
- **`tools/gen_stage4_workflows.js`** deterministically generates **WF17** (config, 2 nodes), **WF18**
  (Telegram gateway, 9), **WF19** (planner, 9), **WF20** (orchestrator, 16) with libs embedded byte-identically
  between drift markers. Re-running is idempotent.
- **Tests:** `test_stage4_contracts.js` (72) direct lib units + `test_stage4_workflows.js` (33) drift proof +
  offline harness node execution. Registered in `run_all.js` + `Makefile`.
- `make test` → **ALL SUITES PASS** (24 JS suites + validator 241 + lead_scout); 0 external calls; $0;
  25 workflow JSON all `active=false`.

**Phase C (testing/deploy/docs) — LANDED as `test(stage4): add replay e2e deployment and portfolio docs`:**
- `n8n/fixtures/stage4/replay_fixtures.json` (sanitized: Apify SERP discovery / Avito search cards /
  CASHMOTOR healthy Firecrawl / CarCapital degraded / source_health / WF08 / WF10 / WF12).
- `tests/test_stage4_e2e.js` (62 checks) — mocked replay driving all 7 libs through the full lifecycle:
  16 scenarios (duplicate-update, unauthorized, unapproved, cancelled/terminal-blocked, gate pass, off-allowlist,
  budget/call/item overflow, deterministic idempotency, no-double-spend, healthy-proceeds, degraded-blocked,
  partial state, all-quarantined no_data, invalid-planner-JSON 0 calls, summary-OFF 0 LLM, delivery-retry dedupe)
  + full happy path Telegram→…→completed + illegal-transition rejection. Single external-call counter proves 0
  calls on every negative path. Registered in run_all.js + Makefile.
- `scripts/deploy_n8n.sh` — DRY-RUN default (validate JSON + config check + print plan, offline, no n8n);
  `--apply` imports WF17→WF18→WF19→WF20 inactive, never touches credentials.
- `docs/SHEETS_MIGRATION_STAGE_4.md` — 7 new tabs (exact headers: agent_requests/agent_request_events/
  execution_plans/approval_decisions/telegram_outbox/execution_summaries/dead_letter_events) + existing-tab
  append-only deps + verification checklist.
- `docs/STAGE_4_AGENT.md` (Mermaid architecture + Telegram sequence + state machine + setup + controlled live
  E2E + known limitations) + README updated to Stage 4.
- **Fix surfaced by E2E:** `execution_summary.js` next-action ordering — `no_data` now precedes the generic
  `partial` message (all-quarantined ⇒ "broaden sources", not "review partial report"); WF20 embed regenerated.
- `make test` → **ALL SUITES PASS** (25 JS suites + validator 241 + lead_scout); 0 external calls; $0;
  25 workflow JSON `active=false`. **Not pushed**, no n8n import, no AI attribution.

**Open:** operator runtime retest (Stage C.1 + Stage 4 controlled live E2E). No further code work queued.

---

## Session: 2026-06-20 (session 19) — Stage 3 closure + Stage 4 (branch stage-3-closure-and-stage-4, DEC-147)

**Status (exact):** new authoritative two-phase spec (Phase A = close Stage 3 runtime contracts; Phase B =
Stage 4 orchestration). Branch `stage-3-closure-and-stage-4` from `origin/main` (4ba4e52, already contains
Patch 5). **0 external calls, $0**, all workflows `active=false`, **not pushed**, no AI attribution. Three-commit
plan: (1) `fix(stage3): unify runtime contracts and quality gates`; (2) `feat(stage4): add production
orchestration and telegram gateway`; (3) `test(stage4): add end-to-end contracts and deployment docs`.

**Commit 1 LANDED (canonical lineage + WF16 boolean fidelity):**
- New `n8n/lib/lineage.js` — canonical identity contract (`source_run_id` join key vs `workflow_run_id`),
  `canonicalSourceRunId`, `coerceSheetBool`.
- **WF04 mismatch FIXED** (the live `no_compatible_baseline` blocker): `live_source_runs` no longer rewrites
  `firecrawl_*`→`wf04_*`; emits `source_run_id=run_id=firecrawl_<stamp>` + `workflow_run_id=wf04_<stamp>` +
  `data_mode`; snapshots carry the same canonical `source_run_id`. Ledger honesty: `approval_token_used=not_required`,
  separated `primary_calls`/`repair_calls`, cost `unknown`/`null` (never 0).
- **WF16 §2.3 boolean fidelity:** `Assemble` `cbool()` (mirrors lib) — Sheets string `'FALSE'` now scored invalid.
- `tests/test_lineage_contract.js` (34 checks). `make test` → ALL SUITES PASS (20 JS suites + validator + lead_scout).

**Commit 2 LANDED — `fix(stage3): connect website source quality and analysis pipeline` (DEC-148):**
- **WF04 = website source adapter:** new `Build Canonical Raw Record` emits one canonical `raw_market_records`
  row per scraped URL (full lineage + `source_record_id` + `analysis_status=pending`); WF04 extraction kept as
  source hints; snapshots/transport preserved. + `Append raw_market_records` node.
- **WF08 = single semantic owner:** `Filter & Select Records` + `source_run_id_filter` + record-level quality gate
  (degraded/quarantined/pending blocked, per-record) + exactly-once via new `analysis_runs` ledger
  (`Read analysis_runs` + `Build/Append analysis_runs Row`; key=`source_run_id::source_record_id`; `force_reprocess`).
- WF16 scores WF04 rows by `source_run_id`. `tests/test_website_pipeline.js` (36 checks) on
  `firecrawl_20260620_104531` (CASHMOTOR healthy→WF08 once; CarCapital degraded blocked; lineage identical).
  `make test` → ALL SUITES PASS (21 JS suites). Sheets: `raw_market_records` WF04 cols + `analysis_runs` tab (§24/§25).

**Commit 3 IN PROGRESS — `fix(stage3): close production analysis aggregation and reporting gates` (DEC-149):**
- **WF10/WF12 fail-closed verification:** `rowEligible` no longer lets a live row self-attest past a missing
  `source_health` join when `require_source_health=true` (production default in both WF10 + WF12); explicit
  `allow_unverified_source=true` is the only dev bypass. Embedded mirrors stay byte-identical to
  `n8n/lib/report_gate.js` (drift-proof).
- **Guarded LLM (not disabled nodes):** WF08 `Prepare Record` guard (enabled+token+quality+not-cancelled+
  not-analyzed+budget); WF12 `Claude Summary Approval Gate`/`Build Claude Summary Prompt` (enable flag+token+
  eligible facts+budget+idempotency); OFF⇒0 calls; invalid⇒1 repair⇒deterministic fallback; unknown cost=null.
- **WF12 isolation parity:** report scoped by run stamp + (additive) `agent_request_id`; `report_data_mode=live`
  excludes fixture/manual snapshots; lineage-carrying snapshots held to the same `__bodyEligible` gate as profiles.
- **WF05** executable pre-Apify approval/budget gate (token never logged); `items_relevant`=direct competitors;
  truthful `approval_token_used`. **WF06** regex root detection (no `new URL(`, sandbox-safe). **WF09** search
  cards `items_relevant=0` + `Detail enrichment required; do not run WF08` (enrichment = documented limitation).
- `tests/test_stage3_gates.js` (47 checks) + updated `test_lineage_e2e.js`/`test_report_gate.js`.
  `make test` → ALL SUITES PASS (22 JS suites + validator + lead_scout); $0; 0 external calls; active=false.

**Open:** ALL of Stage 4 (Phase B — Telegram gateway, planner, state machine, approval/budget gate,
source-adapter contract, idempotency/outbox, dead-letter) + Phase C (replay fixtures, mocked E2E, deploy script,
consolidated migration, portfolio docs). Continuing autonomously per the single-user MVP directive.

## Session: 2026-06-20 (session 18) — Stage C Runtime Patch 5 (DEC-146): WF09 Apify actor-input regression

**Status (exact):** narrow WF09 fix from the first live retest — two runs stalled after `Build
raw_market_records Rows`, which got one empty/malformed item. **0 external calls, $0**, all workflows
`active=false`. Local commit only — **not pushed**. `make test` → ALL SUITES PASS (19 JS suites + validator +
lead_scout); new `wf09-actor-input` = 48 checks; `intake-gates` back to 55.

**Root cause:** Patch 4 sent `actor_start_urls` (`{url,userData}` objects) to the actor
`fatihtahta/avito-russia-scraper`, which expects `startUrls` (array of **URL strings**) + `limit` (int) → it
returned one empty item → zero raw rows → stalled run.

**Fix (WF09 only):**
- Apify request body now sends `startUrls = cfg.start_urls` (string URLs) + `limit = cfg.actor_limit`.
  `actor_start_urls` kept in `Set Config` for internal mapping/tests only — never the live input.
- Normalize per-record query origin: explicit actor query metadata → `parentSourceUrl` matched against
  `cfg.query_plan` → `unknown`. `source_search_url` from `parentSourceUrl` (else matched query_plan URL).
  Removed the old `start_urls[0]`/`firstStart` fallback; never the concatenated query list.
- Malformed/empty actor items stay `invalid` → zero raw/registry rows + explicit error/skip summary (proven).

**Files:** `n8n/workflows/09…json` (Set Config comment, Apify request, Normalize); `tests/test_wf09_actor_input.js`
(new), `tests/run_all.js`, `Makefile`; docs (migration §22–§23, DEC-146, this entry). **WF16 + quality_gate.js
unchanged.**

**Next:** operator live retest on n8n (real Apify call now returns listings; verify `parentSourceUrl` echo →
query mapping, and that an empty actor response yields zero rows + error summary, not a stall). No Claude before
Phase D.

## Session: 2026-06-20 (session 17) — Stage C Runtime Patch 4 (DEC-145): first real WF09→WF16 live run

**Status (exact):** narrow runtime patch from the first live execution (`avito_20260620_055017`: 10 items, all
non-detail Avito search cards, 9 unique + 1 dup). **0 external calls, $0**, all workflows `active=false`. Local
commit only — **not pushed**. `make test` → ALL SUITES PASS (18 JS suites + validator + lead_scout); new
`wf16-runtime-searchcards` = 77 checks.

**Root causes fixed (the live run looked healthy when it was not):**
- **WF09 `live_source_runs.run_id` = `agent_request_id`** broke WF16's join → blank workflow/platform/family.
  Now `run_id=cfg.run_id` (+ `source_run_id`, preserved `agent_request_id`); WF16 join has an `agent_request_id`
  legacy fallback. `approval_token_used` from the live gate (value never stored); cost `unknown`/`null` (never 0).
- **Raw rows lacked the search-card contract** (`is_detail`/`detail_fetch_required`/`placeholder_title`/
  `exact_evidence_url`(now boolean)/`activity_subtype`/`skip_reason`/`detail_fetch_status=pending`/populated
  `quality_flags`/`llm_eligible`/`search_query`/`source_search_url`). WF16 now detects search cards from explicit
  + legacy fields, recognizes `duplicate_in_registry`/`_in_batch`, and **quarantines** a `report_candidate=0`
  search-card-only run via a critical `search_cards_only` flag; all-`pending` runs are never report/LLM eligible;
  non-detail cards don't inflate `exact_evidence_url_rate`. Mirrored in `n8n/lib/quality_gate.js` + WF16 node
  (drift-proven).
- **WF09 summary** now separates search cards from confirmed offers (the company-registration card is preserved
  for review, never an offer). **Query origin** = specific per-record query (start-URL `userData` propagated) or
  `unknown`, never the concatenated list.

**Files:** `n8n/lib/quality_gate.js`; `n8n/workflows/09…json` (Set Config, Apify request, Normalize, Build raw,
Build live_source_runs, Final Summary); `n8n/workflows/16…json` (Assemble Run Bundles, Build Source Health);
`tests/test_wf16_runtime_searchcards.js` (new), `tests/test_wf09_searchcard.js` (detail_fetch_status→pending),
`tests/run_all.js`, `Makefile`; docs (migration §19–§21, DEC-145, this entry).

**Next:** operator runtime retest on live n8n (real Apify call + Sheets header mapping per migration §19–§21);
no WF10/WF12 change. No Claude before Phase D.

## Session: 2026-06-20 (session 16) — Stage C Closure Patch 3 (DEC-144): make the gate real

**Status (exact):** narrow correctness patch closing the Patch-2 audit's blocking findings. **0 external
calls, $0**, all workflows `active=false`. Local commit only — **not pushed**. `make test` → ALL SUITES PASS
(19 JS suites + validator + lead_scout).

**Root causes fixed (audit B1/B2/C1/C2/D1/D5/S3-D21):**
- **Lineage was never produced upstream** → WF10/WF12 gate was a no-op. Now connectors (WF09/WF07/WF13) write
  `source_run_id`+`data_mode`+`quality_status`+`report_eligible`+`review_status`+`quality_flags` to
  `raw_market_records`; **WF08 propagates the identical lineage** onto monitor/content/review queues on BOTH
  deterministic + LLM paths (join key via `source_run_id‖run_id‖agent_request_id`, matching WF16).
- **`report_gate.rowEligible` rewritten**: merges record-local lineage + matched source_health (stricter
  wins), **production fail-closed**; fail-open only via explicit `allow_unverified_source` (default false on
  WF10/WF12). WF10 stamps lineage on outputs; WF12 filters its BODY by it (`__bodyEligible`,
  `body_records_excluded`) so body ↔ source-quality section never contradict.
- **WF04 counters wired into real execution** (Normalize+Route + snapshot writer single points; dead
  `__rr`/`__acct` removed; per-run reset; cost unknown=null).
- **S3-D21** proven by real WF09 node execution.

**New tests (run the real nodes):** `test_lineage_e2e.js` (33; WF09→WF08→WF10→WF12 negative+matrix),
`test_wf04_accounting.js` (28; real parse/route/snapshot → Final Summary counters),
`test_wf09_searchcard.js` (20; search-card quarantine), report_gate +12 (merge/verification + embed-parity).

**See:** `docs/SOURCE_LINEAGE_CONTRACT.md`, `docs/SHEETS_MIGRATION_STAGE_C_HARDENING.md` §14–§18, DEC-144.
**Next:** operator applies §14–§18 columns → re-run connectors → WF08 → WF16 → WF10 → WF12 (runtime retest).

---

## Session: 2026-06-19 (session 15) — Stage C Closure Patch 2 (DEC-143)

**Status (exact):** finishes the Stage C work DEC-142 left partial/merged-only/not-wired. **0 external calls,
$0**, all workflows `active=false`, no real keys/IDs, no contacts surfaced, `outreach=false` preserved. BUILT +
offline-validated; **operator runtime retest required** (see `docs/STAGE_C_CLOSURE_PATCH_2.md`). Local commit
only — **not pushed**.

**Headline:** WF16/`source_health` is now **physically enforced** in WF10 and WF12 via a shared, drift-proof
`n8n/lib/report_gate.js` (embedded mirror in both nodes; tests assert node==lib). Each adds a `Read
source_health` node + config switches. Excluded by default: fixture/manual_test/quarantined/pending/
semantic-failed/stale/degraded; degraded only via `allow_degraded_report` (warning), fixture only via
`allow_fixture_report` (watermark). WF10 also: strict run isolation + observed-vs-inferred split +
pending/uncertain record exclusion. WF12 also: no dangling `(x34 =)`, compatible baseline /
`no_compatible_baseline`, contact counters (`report_contains_contacts=false`), corrected VK wording,
`changed_domains=0` neutral action, degraded website-snapshot exclusion.

**Source-workflow fixes (each with a test running the real node):** WF04 (Final Summary + repair/fallback
accounting, MKBK brand fallback, no raw Markdown in offer, evidence confidence/page_type/services, phone
normalization, cost telemetry), WF05 (regulator/publisher/direct/indirect/source split — cbr.ru not a
competitor; root URL canonicalization; scope/service; cost), WF06 (`approval_status=processed` in the real
payload), WF07 (actual-vs-estimated cost, irrelevant≠hard_skipped, `data_mode=manual_test`), WF09 (declared
multi-query drives start URLs + dedup + origin), WF14 (`zero_write_reason` never empty).

**Tests/CI:** extended offline harness (no coverage removed); new suites `report-gate, wf04/05/06/07/09/10/12,
ci-workflow`; `.github/workflows/regression.yml` runs `make test` on PR + push:main (Node 20 / Python 3.12, no
secrets). `make test` → **ALL SUITES PASS (external calls=0, live cost=$0)**.

**Next:** operator applies Sheets migration (`docs/SHEETS_MIGRATION_STAGE_C_HARDENING.md` Closure Patch 2 §7–13)
→ import workflows (`active=false`) → run retest order → then Stage C / MVP close. No Claude before Phase D.

---

## Session: 2026-06-19 (session 14) — Stage C Hardening: taxonomy + semantic engine + WF16 + WF08 llm_primary (DEC-142)

**Status (exact):** systemic production-hardening patch over the 64-item acceptance defect register. **No
external calls** (no Claude/Apify/Firecrawl/VK/Telegram), no real keys/Spreadsheet IDs, all workflows
`active=false`. **$0.** BUILT + offline-validated; **operator runtime retest required** before Stage C close.

**New systemic core (all tested, $0):**
- **`config/taxonomy.json`** (`semantic-v2.0`) — ONE canonical taxonomy: record/entity/activity/service enums +
  alias compat (`secured_auto_loan→pts_loan`, `return_lease_refinancing→auto_lease_refinance`,
  `question_objection→audience_question`, `credit_broker→credit_brokerage`) + route map + confidence caps + flags.
- **`n8n/lib/semantic_core.js`** — Stage A pre-gate (system-event/placeholder/search-card/evidence completeness),
  owned-media/affiliate/direct-offer/negation detectors, explainable confidence + caps, Stage D validator, route
  mapper, `classifyOffline()` (free offline/fixture classifier = LLM fallback). Cyrillic-`\w` regex bug fixed.
- **`n8n/lib/quality_gate.js` + WF16** (`16_source_quality_gate_health_score.json`) — run/source health →
  `source_health` tab; quality_score/status/report_eligible/llm_eligible/flags; gates WF10/WF12. **Real, importable,
  NOT doc-only**; embedded scoring proven byte-equal to the lib.

**Workflows patched (real node code, harness-tested):**
- **WF08:** `analysis_mode=llm_primary` (Claude PRIMARY, POST_EVIDENCE overrides hints; semantic-v2 prompt with
  POST_EVIDENCE/SOURCE_METADATA/UPSTREAM_HINTS separation, canonical enums, evidence caps); system-event hard-skip
  pre-gate; `llm_enabled=false` safe default (guard intact).
- **WF09:** `LIVE Apify Safety Gate` (fixture=false ∧ live=true ∧ token match ∧ max_items ∧ budget; token value
  NEVER logged/propagated); placeholder/search-card → source_candidate + detail_fetch_required + report/llm
  ineligible (no fabricated `Оффер: Ещё4 фото`); search_query vs source_search_url separation; data_mode.
- **WF11:** system-event gate (service NOT from new title) + affiliate subtype + direct-offer override + negation/
  quotation + per-post freshness + data_mode/eligibility.

**Harness:** `make test` / `node tests/run_all.js` → **654 checks PASS, 0 external calls, $0**
(taxonomy 96 · semantic-contract 86 · quality-gate 31 · wf16-node 37 · intake-gates 55 · validate_workflows.py
217 · lead_scout 132/132). 12 semantic evidence fixtures + 3 quality fixtures. `scripts/validate_workflows.py`
(JSON validity + secret-leak scan).

**Docs:** new SEMANTIC_TAXONOMY, SOURCE_QUALITY_GATE, STAGE_C_HARDENING_IMPLEMENTATION, _TEST_RESULTS,
SHEETS_MIGRATION_STAGE_C_HARDENING; README + DECISIONS (DEC-142) updated.

**Next:** operator runtime retest — (1) import WF08/09/11/16 + add `source_health` tab/columns; (2) `make test`;
(3) WF16 fixture self-test; (4) controlled WF08 Claude batch (own approval); (5) one live Telegram channel;
(6) one approved Avito live smoke; (7) WF10/WF12 must consult `source_health.report_eligible`. Then Stage C close.

---

## Session: 2026-06-19 (session 13) — Stage C.1 consolidated patch (DEC-141)

**Status (exact):** corrective patch from REAL operator n8n runtime evidence. **No Stage 4/Claude, no external calls**
(no VK/Telegram/Firecrawl/Apify/Claude/OpenAI), no activation, no real keys/Spreadsheet IDs/VK groups, no
auto-outreach, no member/private extraction. All workflows `active=false`. **$0.** **Stage C.1 NOT passed — operator
runtime retest required** (`docs/STAGE_C_1_TEST_RESULTS.md` §3).

**Defects fixed (code, harness-validated):**
- **WF14:** (B) `service_type` deterministic-first → PTS = **`pts_loan`** (was `unknown`; the WF13 `"unknown"` hint no
  longer shadows `svcType()`). (E) `diagnoseZeroWrite()` (8 reasons) + `below_threshold_skipped` → repeat run says
  "all 5 already exist, dedup succeeded, collect new data" (NOT "lower min_lead_score"). (G) `include_review_queue` +
  `source_agent_request_id` for clean acceptance isolation (defaults unchanged).
- **WF13:** (C) evidence-based `probableNeed()` — business/PTS/bad-credit no longer get a false "после отказов" hint;
  `service_hint` for PTS = `pts_loan`. (D) handoff strings → **WF14** canonical (WF08 optional Stage 3). (F) audience
  aggregates = consumer authors only → **`audience_author_count=5`** (was `active_author_count=7`).
- **WF12:** (A) deterministic `redact()` before truncation + final pass over every field → no phone/@handle/profile/
  email/t.me ever printed; amounts/%/post-URLs kept; contact counts correct. (H) sticky schema counts 20→25, 28→47.

**New scope (operator-approved):** WF13 **monitored VK groups** engine (group→posts→relevant posts→public comments;
post+comment relevance, bounded selection, dedup, counters) + deterministic `monitored_fixture_mode` simulation (20
§6.4 cases). Live two-stage transport = STAGED/DISABLED, `BLOCKED_BY_OPERATOR` (`docs/VK_MONITORED_SOURCE_RUNBOOK.md`).

**New harness (real Code-node logic under n8n shims):** `node n8n/fixtures/lead_scout/run_all.js` → **132/132 PASS
($0)**. Pinned counters unchanged (A 7/3-2-2; B 5/2-2-1; repeat 0/dup 5). Files: `_harness.js`, `run_wf14_triage.test.js`,
`run_wf13_monitored.test.js`, `run_wf12_redaction.test.js`, `run_all.js`.

**Docs:** new `STAGE_C_1_TEST_RESULTS.md` (results + retest runbook + expected deltas) + `VK_MONITORED_SOURCE_RUNBOOK.md`;
updated WF12/13/14 RU, fixtures README, STAGE_C pack, report schema (20→25), CONTACT policy, DECISIONS (DEC-141), warm.

**Next:** operator runtime retest (import WF12/13/14, clear only raw_market_records/market_record_registry/
public_lead_signals/market_intelligence_reports, run WF13→WF14→WF14 repeat→WF12, verify pts_loan + dedup diagnosis +
redaction). Then Stage C C1 (paid Stage 2) / C4 (live VK) = operator-gated; monitored VK live = blocked. Stage 4 NOT started.

---

## Session: 2026-06-17 (session 12) — Stage 3.5 audit alignment + live-readiness hardening (DEC-140)

**Status (exact):** post-audit hardening patch before Stage C. **No new features, no Stage 4/Claude, no external
calls** (no VK/Telegram/Firecrawl/Apify/Claude/OpenAI), no activation, no real keys/Spreadsheet IDs, no
auto-outreach, no member/private extraction. External audit found **no P0 blockers**; this patch closes its 4
pre-Stage-C items. All workflows `active=false`.

**Code fixes (WF14 only — verified safe via local harness):**
- **`review_priority` → 4-value enum.** `priorityOf` now faithfully mirrors `score_band` over {high, medium, low,
  **ignore**} (was collapsing ignore→low). Default `min_lead_score=25` still filters ignore-band before write, so
  emitted set stays {high,medium,low} unless lowered. No behaviour change on fixtures.
- **`splitCmt()` comment-URL contract fix.** WF13 (fixture+live) folds the comment anchor into `post_url`
  (`…_201#reply2011`) and can't add a `comment_url` column (raw_market_records is fixed 40-col). WF14 now derives
  `source_comment_url` from a reply-anchored `post_url` and cleans `source_post_url` to the base post → **fixture
  and live rows share dedup keys + `lead_signal_id`**, and `source_comment_url` is populated. Harness: WF13-path
  `signals_written=5` (H/M/L 2/2/1) with **byte-identical lead_signal_ids** to baseline; repeat run 0/dup 5.

**Canonical decisions (docs):**
- **Timestamps:** `created_at` (write/append) / `updated_at` / `extracted_at`; **no `append_timestamp`/
  `timestamp_appended` column exists** under either name (phantom). Documented in TABLE_SCHEMA §G + validation plan.
- **Pinned Stage C fixture outcomes (harness-derived, not invented):** standalone 10-scenario → **7 written**, H/M/L
  **3/2/2**, contacts_found=2, **contacts_blank=1 (F10)**, dup=1 (F8), irrelevant=1 (F7), F6 competitor excluded;
  WF13 9-item fixture → **5 written**, H/M/L **2/2/1**, repeat 0/dup 5; `outreach_allowed=FALSE` everywhere.
- **VK live readiness = `IMPLEMENTED_READY_FOR_STAGE_C`** (token gate + allowlist-only wall.get/wall.getComments
  v5.199 + disabled HTTP placeholder-token node + inert throwing parser + caps + ledger). Only runtime API =
  `BLOCKED_BY_OPERATOR_CREDENTIALS_OR_LIVE_RUN`. Exact operator setup in LEAD_SCOUT_LAYER_PLAN §12.
- **WF12 unchanged** — already audit-compliant (anonymized lead block, schema-tolerant, no raw contacts, no Claude).

**Docs edited (md):** TABLE_SCHEMA §G, GOOGLE_SHEETS_VALIDATION_PLAN (list 28 + §3.6 explicit enums),
PUBLIC_LEAD_SIGNAL_LAYER, LEAD_SCOUT_LAYER_PLAN (§3a/§12), STAGE_C_ACCEPTANCE_PACK (C3/C5), fixtures README,
DECISIONS (DEC-140), warm decisions, NEXT_ACTIONS, AGENT_LOG.

**Next:** **Stage C acceptance** unchanged — C3/C5/C6/C7 fixture-runnable now ($0); C1 (Stage 2 paid) + C4 (live VK)
= `BLOCKED_BY_OPERATOR_CREDENTIALS_OR_LIVE_RUN`. Then Phase D / Stage 4 Claude (own approval). Stage 4 NOT started.

---

## Session: 2026-06-17 (session 11) — Stage 3.5 Lead Scout Foundation BUILT (DEC-139)

**Status (exact):** real build patch (Phase B of the LOCKED A/B/C/D model). Deterministic, **all `active=false`,
$0, NO external calls** (no VK/Telegram/Apify/Firecrawl/Claude), no activation, no real keys/Spreadsheet IDs, no
auto-outreach, no member/private extraction. Fixture/harness-validated only.

**Architecture (DEC-139):** Option A refined — **no new WF16**. WF13 = VK public lead source, WF14 = central Lead
Scout engine, WF12 = lead report block; competitor branch (WF08/WF10) untouched (no pollution).

**Built (code, fixture-validated):**
- **WF14 v0.3 Lead Scout Triage & Scoring engine:** reads `raw_market_records` audience rows (PRIMARY, decoupled
  from WF08) + `review_queue`; deterministic 0–100 scoring (intent25+urgency15+pain20+niche15+contact8+region7+
  freshness10 − penalties) → `lead_score`/`score_band`/`review_priority`/`recommended_action`/`score_reasons`;
  public-contact extraction (verbatim only, `contact_source_url` mandatory, blank+`do_not_use` if unprovable);
  multi-key dedup; supplier/competitor-ad exclusion; writes `public_lead_signals` v0.3 (47 cols) + `agent_requests`;
  self-test (read_once/cap/dedup/policy). **61/61 fixture checks; repeat-run dedup PASS.**
- **WF13 v0.3 VK public lead source:** consumer-demand detection → audience lead rows; gated live `wall.get` +
  `wall.getComments` (inert; runtime = PENDING_STAGE_C); lead-rich synthetic fixtures (+7 000 phones).
  **Routing harness: 6 audience rows incl dedup + competitor separate + 1 hard-skip PASS.**
- **WF12 lead block:** priority H/M/L + public-contact-evidence counts + top-N **anonymized** summaries (no
  contacts in report). **12/12 incl. no-leak checks.**
- **WF15:** source_family += public_lead_source/lead_triage.
- **Schema/docs:** `public_lead_signals` v0.3 (47 cols, TABLE_SCHEMA §G + migration); validation lists 27–33 +
  §3.6; LEAD_SCOUT_LAYER_PLAN BUILT; PUBLIC_LEAD_SIGNAL_LAYER v0.3; **new STAGE_C_ACCEPTANCE_PACK** (max 7 checks);
  COSTS note; fixtures `n8n/fixtures/lead_scout/`.

**Policy:** public evidence only; contact = evidence not permission; `outreach_allowed=false` always;
recommended_action ∈ {manual_review, content_idea, monitor, ignore}; no hidden/inferred contacts, no member
extraction, no private groups, no MTProto.

**Next:** **Stage C acceptance** (`STAGE_C_ACCEPTANCE_PACK.md`) — C3/C5/C6/C7 fixture-runnable now ($0); C1 Stage 2
paid snapshot + C4 live VK run = `BLOCKED_BY_OPERATOR_CREDENTIALS_OR_LIVE_RUN`. Then **Phase D / Stage 4 Claude** (own approval). Stage 4 NOT started.

---

## Session: 2026-06-17 (session 10) — Stage A Cleanup Lock: A/B/C/D stage model LOCKED (DEC-138)

**Status (exact):** documentation/stage-model cleanup-lock patch only. **No build, no Stage 3.5 build, no Stage 4,
no code/workflow edits, no external calls** (no Firecrawl/Apify/VK/Telegram/Claude), no activation, no real
keys/Spreadsheet IDs, no deletions.

**What was locked (DEC-138):**
- **Stage model A/B/C/D:** A = Cleanup Lock · B = **Stage 3.5 Lead Scout Foundation + paid/live readiness (NEXT
  ACTIVE BUILD)** · C = Acceptance Pack · D = Stage 4 Claude Intelligence Layer.
- **Locked status:** Stage 1 CLOSED · Stage 2 CODE-COMPLETE / READY FOR CONTROLLED PAID-LIVE ACCEPTANCE ·
  Stage 3 MVP CLOSED/PASS · **Stage 3.5 NEXT ACTIVE BUILD** · Stage 4 after Stage 3.5 + Acceptance Pack ·
  Stage 5 after the Stage 4 contract.
- Stage 2 paid/live acceptance **postponed to Stage C**; Stage 4 starts **only after** Stage 3.5 + Acceptance Pack;
  testing happens **after full builds**, not micro-tests per node.

**Docs edited (Markdown only):** ROADMAP (LOCKED block + session-7/8 historical), NEXT_ACTIONS (Stage 3.5 priority),
LEAD_SCOUT_LAYER_PLAN (reframed Stage 3.5 NEXT ACTIVE BUILD + source priority/fields/status/testing),
STAGE_3 doc (v0.4.2 closure-PENDING marked historical/superseded; current = MVP CLOSED/PASS), STAGE_4 doc
(Stage 4 = Claude Intelligence Layer, does NOT start now; Stage 3.5 + Acceptance Pack first; 4.1/4.2/4.3 kept),
PRE_STAGE_4_EXTERNAL_AUDIT_BRIEF (audit v2 response appended), AGENT_LOG (session 10 + session-7 historical),
DECISIONS + warm decisions (DEC-138).

**Next:** start **Stage 3.5 Lead Scout Foundation** (its own approval per step); Stage 2 paid/live acceptance and
Stage 4 wait for Stage C / Stage D respectively.
