# NEXT_ACTIONS.md — Immediate Next Steps

Updated at the end of each session. This is the first thing to read after `core/hot/recent.md`.

---

## CURRENT PRIORITY (2026-07-16, session 55) — wire force_reprocess, then the fresh-site WF28 E2E

WF20→WF28 is WIRED + DEPLOYED. The §4 honest AI cost + credential capability are LIVE-PROVEN (WF19 exec 840:
`mode=proven_credential`, message quotes `AI-анализ: ~$0.07–0.11`). WF04-ROUTE-001 is fixed + live-proven (exec 871
scraped 1 page through the full chain). **But WF28 has never yet been reached from WF20 with real data.**

**THE BLOCKER (and the next task):** `url_registry` dedup is **PERMANENT — no time window**
(`WF04 > Evaluate Dedup`: `const hit = !force && key !== '' && rows.some(...)`). Every site ever scraped
(autolombardn1.ru, mkbkfin.ru, carmoney.ru, finardi.ru, lioncredit.ru) is skipped forever, so every approved run
yields an empty WF12 bundle → `do_analyze=false reason=no_sources` → WF28 never fires. Without a refresh path a user
can NEVER re-analyze a source.

**WF04 ALREADY supports it** — `force_reprocess` is a declared callable input (FORCE-REPROCESS-001) and
`Evaluate Dedup` honours it. It is simply not wired end-to-end. This is ALSO required by spec §3/§5 (offer
"принудительно обновить источник" on a dedup skip).

1. **Wire force_reprocess** (planner → plan row → WF20 → WF04):
   - `request_planner.deterministicPlan`: detect refresh phrasing (обнови / заново / принудительно / ещё раз /
     свежие данные) → `plan.force_refresh = true`. NB Cyrillic `\b`/`\w` do not fire — use `[а-яё]` classes.
   - `config/sheets_contracts.json` → `execution_plans`: add a `force_refresh` column (headers + buildPlanRow in
     request_planner). Keep it OUT of `planFingerprint` only if it must not split B4 dedup — decide deliberately: a
     refresh IS a different request, so it SHOULD be in the fingerprint.
   - WF20 `Resolve Approved Plan`: read `force_refresh` off the row → plan.
   - WF20 `Resolve Collection Set`: expose `force_reprocess`.
   - WF20 `Run Website Source (WF04)` execWf: pass `force_reprocess: "={{ ... }}"` (input already declared on WF04).
   - Cost: a forced refresh DOES cost a Firecrawl page — the plan must quote it (it already does).
2. **Fresh-site WF28 E2E** — send "Обнови carmoney.ru" (already scraped, so force is required), approve, then verify:
   a WF28 execution actually runs; report has facts/inferences/recommendations; XLSX has the Stage-F sheets;
   estimate brackets actual; no WF08 per-record calls.
3. **Three distinct source outcomes** (currently conflated in one message): data / no-new-data (dedup skip) /
   technical failure. A dedup skip is NOT a provider failure; no evidence ⇒ no WF28 call ⇒ actual AI cost $0.
4. **Concise adaptive Telegram renderer** — measured "before": WF20 exec 878 no-data = **2082 chars** (historical
   context + other-source list + duplicated "no data"). Target 900–1600 enriched / 250–700 no-data; full detail stays
   in XLSX + bundle. One policy footer only.
5. **Cause-specific no-data recommendations** — dedup ⇒ open previous report / force refresh; unreachable ⇒ retry;
   never "запустить сбор" right after a failure without saying why.
6. Then: TG + VK single-source; multi-source synthesis; WF27 top-candidate enrichment; public lead interpretation;
   CodeVinci AI Pilot; repair-rate over ≥5 fresh packages.
7. **Cleanup disposable QA drivers:** msqamktetab, msqamkslog, msqawf28proof, msqamktabs, msdrvscope12.
8. **Operator/infra:** harden SSH (brute-force log flood), reclaim VPS disk (734M free; docker 2.6G all-active).

**Do NOT start Stage F.5 (Opportunity Radar) or Stage G.**

**Exact next command:**
```
grep -n "force_reprocess" n8n/workflows/04_firecrawl_url_list_resilient.json | head
```

---

## PRIOR PRIORITY (2026-07-16, session 53) — pre-F debt CLOSED → Stage F PRODUCTION INTEGRATION next

All fixable pre-Stage-F deterministic debt is CLOSED, deployed and (B4) live-proven: **B4** plan-fingerprint dedup
(efe0daf), **B6** requested-source terminal status (00bc4bf), **B7** Russian XLSX + hidden technical sheet (e67ece1).
Prod: 16 active, webhook ok, `make test` ALL SUITES PASS. The Stage F Claude CORE (adapter/contracts/evidence/analysis)
is built + live-proven (session 52). **Remaining = wire it into production:**

1. **WF28 — Claude Analyst** callable workflow per `docs/STAGE_F_RUNBOOK.md` §"Wiring into n8n" (Build Evidence Package
   → Claude HTTP w/ cred OEen8Vl1tdWtv7v4, 90s timeout, retryOnFail → Parse+Validate → ≤1 repair → merge/fallback →
   persist). Feature-flag `enable_llm_analysis && claude_key_present`, default OFF.
2. **Sheets tabs** `llm_analysis_results` + `llm_analysis_telemetry` (contracts in the prompt §4) + bootstrap/manifest
   + tab-count/contract tests.
3. **Report + XLSX enrichment** — «Подтверждённые факты / Аналитические выводы / Рекомендации / Доказательства и
   ограничения»; deterministic report+XLSX still ship on LLM failure (now with the Russian sheet names from B7).
4. **Prompt hardening** — force ASCII English schema keys in CA_SYSTEM_PROMPT (the one live repair was a Cyrillic
   `text_ю` key) to drive the repair rate toward 0.
5. **Multi-source synthesis** (ccSynthesisTool) + **candidate enrichment** (ccCandidateTool, top 3–5) + **public lead
   interpretation**.
6. **CodeVinci AI Pilot** conversational agent — `analyst_agent`/`analyst_tools`, read-only tool auto-select,
   approval-gated mutations, bounded loop; `/status`/`/cancel`/`/help` stay deterministic.
7. **§16 live scenario matrix** (only #1 website analysis proven so far).
8. **Operator/infra:** harden SSH (brute-force flood) + reclaim VPS disk.

**Do NOT start Stage F.5 (Opportunity Radar) or Stage G.**

---

## PRIOR PRIORITY (2026-07-16, session 52) — Stage F CORE built + live-proven → continue Stage F integration

Stage F is authorized and STARTED (commit d5ea56e). The Claude adapter + contracts + evidence package + analysis
engine are built, unit-tested (77), and LIVE-PROVEN (single-source analysis on the real endpoint, one bounded repair,
Russian, evidence-bound). Full status + what remains: `docs/STAGE_F_ACCEPTANCE.md`. How to operate/extend:
`docs/STAGE_F_RUNBOOK.md`. Measured endpoint behavior: `docs/STAGE_F_API_CAPABILITY_MATRIX.md`.

**Continue Stage F in this order (nothing else needs re-deriving):**
1. **WF28 — Claude Analyst** callable workflow per the runbook topology (Build Evidence Package → Claude HTTP w/ cred
   OEen8Vl1tdWtv7v4 → Parse+Validate → ≤1 repair → merge/fallback → persist telemetry). Feature-flag on
   `enable_llm_analysis && claude_key_present`, default OFF.
2. **Report + XLSX integration** — «Подтверждённые факты / Аналитические выводы / Рекомендации / Доказательства и
   ограничения»; deterministic report+XLSX still ship on LLM failure.
3. **llm_telemetry lib + `llm_analysis_telemetry` Sheets tab** (schema/prompt version, model, package hash, tokens,
   cache, repair, cost).
4. **Multi-source synthesis** (ccSynthesisTool exists) + **candidate enrichment** (ccCandidateTool exists, top 3–5
   only) + **public lead interpretation**.
5. **Conversational analyst agent** — `analyst_agent` / `analyst_tools` (CodeVinci AI Pilot), read-only tool
   auto-selection, approval-gated mutations, bounded loop; `/status`/`/cancel`/`/help` stay deterministic.
6. **§14 live scenario matrix** (only #1 website analysis proven so far).
7. **Still-open pre-F debt B4 / B6 / B7** (below) — deterministic-path polish, does not block Stage F.
8. **Operator/infra:** harden SSH (brute-force flood was filling logs) + reclaim VPS disk.

**Do NOT start Stage F.5 (Opportunity Radar) or Stage G.**

---

## PRIOR PRIORITY (2026-07-14, session 51) — Stage E2 live-proven + pre-F backlog closed → Stage F is READY (do not start without approval)

Stage E2 closed with real n8n execs + real Sheets. Pre-Stage-F user-facing defects fixed, deployed and LIVE-PROVEN:
**B1** single-source report scoping (exec 812: "сайты конкурентов: 1" + historical block, was 4); **B2/B3** request-
shaped plan wording + honest deterministic cost band; **COST-LLM-001** AI cost shown only with a real key (exec 818:
"AI-анализ: пока выключен"); **B5** terminology/italics; **B8** memory-forget regexes. Contracts written:
`docs/STAGE_F_EVIDENCE_BOUND_LLM_ANALYSIS.md`, `docs/STAGE_F5_OPPORTUNITY_RADAR_AGENT.md`. `make test` ALL SUITES PASS
($0). Prod: 16 active, WF18 webhook healthy, WF12/19/20/22 deployed.

**Do the remaining fixable debt, then Stage F:**
1. **B4** — pending-plan fingerprint dedup (a repeat identical request must reuse/supersede, not create a 2nd
   `awaiting_approval`; `/status` shows one logical pending). Reproduced live (plans 816+818). Touch `request_lifecycle`
   + WF18/WF19 plan upsert + a fingerprint over owner/chat/intent/normalized sources/platform/niche/region/scope/flags.
2. **B6-partial** — partial/completed state must be driven by the REQUESTED sources, not optional/preset branches
   (`source_adapter.rollupCollection` + WF20 state); name which source failed.
3. **B7-RU-names** — Russian sheet names (Сводка/Конкуренты/…) + a hidden Технические-данные sheet (high test blast
   radius — update the XLSX asserters together).
4. **Operator/infra:** reclaim VPS disk (root was 100% full — containerd/journal/usr), then Stage F.
5. `docker restart n8n-n8n-1` re-registers the WF18 webhook (needed after any WF18 re-import).

**Then Stage F** per its contract doc — evidence-bound Claude, strict JSON, one repair, fail-closed, budget-gated.
**Do not start Stage F without explicit operator approval.**

---

## PRIOR PRIORITY (2026-06-26, session 28) — Stage 8 release-path INTEGRATION REPAIR done (DISPOSABLE_DEPLOY=PASS) → WF18 rearchitecture next

Branch `fix/stage8-release-integration` off `main` @ `2ee4a71`. The first release-core session's standalone tools
were **not wired into the real deploy path**; this repair connected them into ONE shared, ordered, fail-closed,
idempotent release pipeline used by **both** production deploy and the disposable acceptance. **Proven against real
n8n 2.23.3** in a throwaway container — `DISPOSABLE_DEPLOY=PASS`; **production `n8n-n8n-1` / `n8n_n8n_data` never
touched** (Up 16h throughout); `$0`, no secrets printed, no workflow activated, no production volume touched,
`sing-box` untouched. `node tests/run_all.js` ALL SUITES PASS. 6 commits.

**Corrected operator sequence (DOCS-001), wired and documented everywhere:**
```
discovery → resolve IDs → preflight → dry-run → backup → apply inactive → verify
```
Ids are resolved **as part of** `make deploy-inactive` (lock→capture live export→resolve+persist installation-local
ids→reconcile workflows+credentials→strict preflight→**backup before any import**→import STAGED inactive→bind→
fresh-export verify→sanitized evidence→release lock). A failure stops, preserves diagnostics, prints rollback,
releases the lock.

**Fixed (all disposable-proven):** RELEASE-005 (tools wired), DEPLOY-002 (strict exact-name 0/1/>1, no first-match),
DEPLOY-003 (`id_fp` fingerprints, never `(assigned on import)`), DEPLOY-004 (production dry-run fails closed; explicit
soft `--offline-plan`), CONFIG/PREFLIGHT (`env_discovery.js` from file/container/process, secrets never printed),
staged import (`prepare_staged_workflows.js`, never raw), credential reconciliation (compatible preserved, ambiguous
aborts), backup/lock/evidence/rollback in apply, ACTIVATE-001 (docker-safe publish), ACTIVATE-002 (transactional
WF18-only activation, auto-unpublish on webhook failure), ROLLBACK-001 (real `scripts/rollback.sh`), TEST-002/003 +
MARKER-001 (disposable drives the shared pipeline; `PARENT_CHILD_TOPOLOGY`). Also fixed a docker-only blocker no prior
session caught: a docker-exec `import --input=<host path>` ENOENTs → `n8n_exec.sh` `n8n_put`/`n8n_get` (docker cp) +
`backup.sh` backup container `--user 0:0`.

**Operator, when ready (Docker-only VPS):** `make release-help`. Short version:
`make release-discovery` → `make release-smoke` → `make deploy-dry-run` → `make deploy-inactive` →
`make verify-production`. WF18 activation (`make telegram-activate`) stays BLOCKED by the gate until the WF18
rearchitecture lands. Rollback: `make rollback-dry-run` / `make rollback`. Runbook: `docs/STAGE8_RELEASE_CORE.md`;
defects: `docs/DEFECT_REGISTRY_STAGE8.md`.

**Next session (separate, focused):** WF18 gateway rearchitecture — exact work order in
`docs/WF18_REARCHITECTURE_HANDOFF.md`. The hard gate keeps WF18 unpublishable until all 19 P0/P1 blockers in
`config/wf18_blockers.json` are resolved with a named regression test.

---

## PRIOR PRIORITY (2026-06-19, session 13) — STAGE C.1 PATCH applied → operator runtime retest (DEC-141)

Corrective patch from real operator runtime evidence + operator-approved monitored-VK engine. Local validation
**132/132 PASS ($0)** (`node n8n/fixtures/lead_scout/run_all.js`). All `active=false`. **Stage C.1 NOT passed.**

**Operator next (exact runbook): `docs/STAGE_C_1_TEST_RESULTS.md` §3.**
1. Re-import patched WF12, WF13, WF14 (WF15 unchanged). Rebind Sheets cred + Spreadsheet ID. Keep inactive.
2. Clear ONLY `raw_market_records` / `market_record_registry` / `public_lead_signals` / `market_intelligence_reports`
   (NOT Stage-2/3 aggregate tabs). Optionally set WF14 `include_review_queue:false` to isolate cleanly.
3. WF13 fixture → raw +8 / registry +7 / `audience_author_count=5` / next_action → WF14. PTS raw row `service_hint=pts_loan`.
4. WF14 → public_lead_signals +5 (H/M/L 2/2/1), **PTS `service_type=pts_loan`**, `outreach_allowed=FALSE`.
5. WF14 repeat → +0, dup 5, diagnosis = "all eligible already exist (dedup)" (NOT lower min_lead_score).
6. WF12 → report +1; verify NO `@synthetic_lead_1` / `+7 000 000-00-01` / profile URLs / emails / t.me in `notes`.

Then Stage C: C1 (paid Stage 2) / C4 (live VK) operator-gated; monitored VK live = blocked
(`docs/VK_MONITORED_SOURCE_RUNBOOK.md`). Stage 4 (Claude) not started.

---

## CURRENT PRIORITY (2026-06-17, session 12) — STAGE 3.5 AUDIT ALIGNMENT + LIVE-READINESS HARDENING done → Stage C acceptance next (DEC-140)

Post-audit hardening patch (DEC-140) — **no new features, no Stage 4, no external calls.** External audit found
**no P0 blockers**; this closed its 4 pre-Stage-C items:
1. **`review_priority` enum** now explicit + 4-value **{high, medium, low, ignore}** (WF14 `priorityOf` mirrors
   `score_band`; default `min_lead_score=25` keeps `ignore` out of the sheet unless lowered).
2. **Canonical timestamps** = `created_at` (write/append) / `updated_at` / `extracted_at`; **no
   `append_timestamp`/`timestamp_appended` column** exists (phantom).
3. **Stage C fixture outcomes pinned** (harness-derived): standalone 10-scenario → **7 written**, H/M/L **3/2/2**,
   contacts_found=2, contacts_blank=1 (F10), dup=1, irrelevant=1, F6 excluded; WF13 9-item → **5 written**, H/M/L
   **2/2/1**, repeat 0/dup 5; `outreach_allowed=FALSE` everywhere.
4. **VK live readiness = `IMPLEMENTED_READY_FOR_STAGE_C`** (only runtime API blocked by VK credential). Plus a WF14
   `splitCmt()` fix so fixture & live rows share dedup keys / `lead_signal_id` and `source_comment_url` is populated.

**WF14 is the only workflow changed** (2 safe edits, verified by local harness — signals_written/bands/ids
unchanged). WF12/WF13/WF15 unchanged. **Operator next steps are still the Stage C steps below** (unchanged), except:
the `public_lead_signals` `review_priority` dropdown is now **{high, medium, low, ignore}**.

**Blocked (operator/credentials/live):** C1 Stage 2 paid snapshot · C4 live VK run (VK credential — LEAD_SCOUT_LAYER_PLAN §12).
**Do NOT:** start Stage 4 / call Claude · run paid/live external calls · micro-test per node.

---

## PREVIOUS PRIORITY (2026-06-17, session 11) — STAGE 3.5 LEAD SCOUT FOUNDATION = BUILT → Stage C acceptance next (DEC-139)

Stage 3.5 Lead Scout Foundation is **BUILT** (deterministic, fixture-validated, $0; DEC-139): **WF14 v0.3**
Lead Scout triage+scoring engine, **WF13 v0.3** VK public lead source (gated live `wall.get`/`wall.getComments`,
inert), **WF12** lead report block, **`public_lead_signals` v0.3** (47 cols), synthetic fixtures. Public signals
only, manual review, **`outreach_allowed=false` always.** Stage model still LOCKED A/B/C/D (DEC-138); Stage 4 NOT
started.

**Operator next steps (Phase B → Phase C):**
1. Migrate `public_lead_signals` to the **47-col v0.3** headers (TABLE_SCHEMA §G mapping); add §3.6 dropdowns
   (GOOGLE_SHEETS_VALIDATION_PLAN). Re-import WF14 v0.3 + WF13 v0.3 + WF12 + WF15 (do NOT activate; rebind
   credential + real Spreadsheet ID).
2. **$0 ready now:** WF13 fixture → WF14 → `public_lead_signals` (Stage C checks C3/C5/C6/C7 are fixture-runnable).
3. **Stage C — combined Acceptance Pack** (`docs/STAGE_C_ACCEPTANCE_PACK.md`, **max 7 checks**, run as ONE pass):
   Stage 2 paid/live website acceptance (C1, operator/paid) + Stage 3 regression (C2) + Stage 3.5 fixture lead
   run (C3) + controlled public VK live run (C4, operator/VK credential) + scoring/dedup/contact-policy (C5) +
   WF12 lead block (C6) + safety (C7).
4. After Stage C → **Phase D / Stage 4 Claude Intelligence Layer** (own approval + budget guard; never call
   Claude before that).

**Blocked (operator/credentials/live):** C1 Stage 2 paid snapshot run · C4 live VK run (VK API credential — see
Stage C §VK). Marked `BLOCKED_BY_OPERATOR_CREDENTIALS_OR_LIVE_RUN`.

**Do NOT:** start Stage 4 / call Claude · run paid/live external calls in-agent · micro-test per node (Stage C is
one deliberate pass).

---

## PREVIOUS PRIORITY (2026-06-17, session 10) — STAGE 3.5 LEAD SCOUT FOUNDATION (next active build) — LOCKED A/B/C/D model (DEC-138)

Stage model is **LOCKED** (DEC-138): A Cleanup Lock → **B Stage 3.5 Lead Scout Foundation + paid/live
readiness** → C Acceptance Pack → D Stage 4 Claude Intelligence Layer. **The next active build is Stage 3.5
Lead Scout Foundation — not Stage 4.** Stage 4 starts only after Stage 3.5 **and** the Acceptance Pack.

**Locked status:** Stage 1 = CLOSED · Stage 2 = CODE-COMPLETE / READY FOR CONTROLLED PAID-LIVE ACCEPTANCE ·
Stage 3 = MVP CLOSED / PASS (DEC-136) · **Stage 3.5 = NEXT ACTIVE BUILD** · Stage 4 = after Stage 3.5 +
Acceptance Pack · Stage 5 = after the Stage 4 contract.

**Current priority — Stage 3.5 Lead Scout Foundation** (plan: `docs/LEAD_SCOUT_LAYER_PLAN.md`):
- Build the lead-signal layer on the **current** architecture (public lead signals only, manual review, no
  auto-outreach). Source priority: **VK public comments/discussions/reviews first**, then Banki/forums/Q&A,
  then public reviews/complaints/questions, then Telegram public comments/groups (later/high-risk); Avito is
  mostly competitor/source evidence, not a primary consumer lead source.
- Add the lead fields + scoring + status workflow defined in `LEAD_SCOUT_LAYER_PLAN.md`.

**Testing philosophy (LOCKED, DEC-138):** **no micro-tests after every node.** Testing happens after the full
build, as the **Stage C Acceptance Pack** (fixture lead source + one controlled public source + WF14 + WF12
lead block + no-auto-outreach/contact-policy check).

**Postponed to Stage C Acceptance Pack:** **Stage 2 paid/live website acceptance** (controlled Firecrawl/Apify
snapshot runbook) — it is **not** run now. The Stage 2 code is ready; acceptance is deliberate, after the builds.

**Do NOT in this phase:** start Stage 4 / call Claude · run paid/live external calls · micro-test per node.

---

## PREVIOUS PRIORITY (2026-06-17, session 9) — STAGE 2 CODE-COMPLETE → controlled snapshot run → external audit → Stage 4.1 (DEC-137) — [SUPERSEDED by DEC-138: next build is Stage 3.5, Stage 2 acceptance → Stage C]

Stage 2 web pipeline is now **implemented** (DEC-137): WF06 confirmation-based idempotent processed-marking
(enabled); WF04 writes baseline `competitor_site_snapshots` + per-run `live_source_runs`/`agent_requests`;
WF05/07/09 auto-ledger; WF14 self-test. Stage 3 stays **CLOSED** (DEC-136). All `active=false`, no external calls
made this patch.

**Operator next steps (in order):**
1. Re-import WF04/05/06/07/09/14. Create the `competitor_site_snapshots` (22-col) tab; confirm `live_source_runs`
   (23) + `agent_requests` (21) tabs exist. Bind the Google Sheets credential + real Spreadsheet ID on the **new**
   nodes (`Append competitor_site_snapshots`, `Append live_source_runs`, `Append agent_requests`).
2. **Controlled website snapshot run (paid Firecrawl/Apify — operator-run, BLOCKED for the agent):** run
   WF05 → approve direct_competitor candidates in `url_candidates` → WF06 (handoff) → WF04 on 3–5 top domains.
   Verify Sheets deltas (below). Re-run WF06 → confirm idempotent `approval_status=processed` marking.
3. Refresh WF12 → the "Сайты конкурентов" block populates from the new snapshots.
4. Hand repo + `docs/PRE_STAGE_4_EXTERNAL_AUDIT_BRIEF.md` to the external ChatGPT-agent audit.
5. After audit → **Stage 4.1 Claude Enrichment Core** (own approval + budget guard; never call Claude before that).

Phase B (prompt-rich snapshot guarantees/CTA/title) + Phase C (snapshot change-detection diff) are deferred.

---

## PREVIOUS PRIORITY (2026-06-17, session 8) — STAGE 3 MVP CLOSED → external audit → Stage 4.1 (DEC-136)

Stage 3 MVP source/intelligence foundation is **CLOSED / PASS** on the clean two-channel WF11 v0.4.2 acceptance
run (posts=20, business_relevant=8, hard_skipped=11, unique=0, dup=8, external_calls=2, technical_errors=0).
WF08/WF10/WF12 deterministic chain PASS. **Do not reopen Stage 3.** This session was closure + cleanup only — no
Stage 4 build, no external calls.

**Operator next steps (in order):**
1. Re-import the patched **WF12** + **WF06** (wording/operator-note only; no behavior change). Confirm WF12
   deterministic report still PASS ($0, `llm_status=disabled`, no "allowlist"/"enable HTTP node" wording).
2. Apply the Google Sheets display fix on `market_intelligence_reports` (Clip + vertical-align Top; keep full
   Markdown) — see `GOOGLE_SHEETS_VALIDATION_PLAN.md`.
3. Hand the repo + `docs/PRE_STAGE_4_EXTERNAL_AUDIT_BRIEF.md` to the external ChatGPT-agent audit.
4. After the audit → **Stage 4.1 Claude Enrichment Core** (its own approval + budget guard; never call Claude
   before that). See `STAGE_4_REPORT_AND_CLAUDE_LAYER.md` (4.1/4.2/4.3) + `LEAD_SCOUT_LAYER_PLAN.md`.
5. Optional Stage 2 (when desired, own approval): controlled `competitor_site_snapshots` runbook for 3–5 top
   competitors — `STAGE_2_WEB_COMPETITOR_PIPELINE_REVIEW.md` §5.6.

Semantic-classification debt (`brokershakurova/1237`,`/1245`, `ipotekapro/4090`) → Stage 4.1, **not** a Stage 3
reopen. VK live + Telegram groups/MTProto = expansion/future.

---

## PREVIOUS PRIORITY (2026-06-17, session 7) — WF11 v0.4.2 FINAL Stage 3 quality gate → ONE short acceptance run, then Stage 4

WF11 v0.4.2 (DEC-135) closes the last relevance gap: **adjacent real-estate** posts (object/lot/ЖК promos +
agent recruitment) and holiday/personal posts no longer pollute `competitor_activity`/`market_signal`. Five
post-text-only classes; transport is now **gate-protected** (nodes enabled, unreachable unless the approval gate
passes). Local sim 16/16 + fixture regression unchanged. **Do not open another open-ended retest loop — run the
≤5-test acceptance plan below, then close the Telegram source and move to Stage 4.**

**Final acceptance test plan (operator, ≤5 tests — full version in WF11 RU doc):**
1. **WF11 fixture ($0):** `posts_received=6`, `business_relevant_items=5`, `hard_skipped_items=1`,
   `irrelevant_false_positives=0`, `adjacent_real_estate_skips=0`, `unique=4`, `duplicates=1`; raw +5, registry +4,
   `live_source_runs +1`.
2. **WF11 live `ipotekapro`** (arm gate: `live_mode=true`, token `I_APPROVE_LIVE_TELEGRAM_PREVIEW`, tracked
   channels=`ipotekapro`, choose transport): `4106`→`irrelevant_live_false_positive`; `4092`+`4098`→
   `adjacent_real_estate_signal` (all skipped, not in raw/registry); `4091/4093/4099`→`competitor_activity`;
   `4090/4097`→`market_signal`. `agent_requests` shows the live tracked-channel list + `transport=`.
3. **WF11 live `brokershakurova`** (no-regression): `1237/1245`→competitor, `1230/1234`→market,
   `1231/1233/1240` stay skipped; repeat run → `unique=0`, registry +0.
4. **WF08 handoff on a CLEAN WF11 live run** (`deterministic_first`, `llm_enabled=false`):
   `total_processed`==queue rows, `processed_accounting_ok=true`, `claude_calls=0`, `technical_errors=0`.
5. **WF10 on clean data:** no adjacent/false-positive noise in `competitor_profiles`/`audience_activity_signals`.
   → **Then close the Telegram public-channel source** and start **Stage 4 (Claude enrichment + executive report)**.

**Expected Google Sheets outcomes:** only `competitor_activity` + `market_signal` unique rows reach
`raw_market_records`/`market_record_registry`; no holiday/personal/recruitment/object rows (with
`live_debug_audit=false`); `agent_requests` + `live_source_runs` +1 per run; business tabs untouched until manual WF08.

**Not in this patch / future:** VK live (Stage 3 expansion), Telegram groups/MTProto/member extraction (high-risk
future), Stage 2 WF06 cleanup (backlog), Stage 5 bot, Claude enrichment (Stage 4, own approval). Workflows stay
`active=false`; no external calls authorized here.

---

## CURRENT PRIORITY (2026-06-16, session 6) — WF11 v0.4.1 relevance fix + WF08 accounting fix → retest on CLEAN data

First WF11 live smoke proved transport/parser/dedup but **live relevance was too loose** (channel-level
relevance). Patched: **WF11 v0.4.1** post-level relevance (DEC-133) + **WF08 v0.10** loop-summary accounting
(DEC-134). The live runs `wf11_req_…054733/055318/055705`, `touchpoint_…060227`, `wf10_…061138` are
**contaminated diagnostics — NOT Stage 3 closure.** Stage 3 remains open.

**Retest plan (operator):**
1. Re-import `11_social_source_connector_foundation.json` + `08_touchpoint_analyzer.json`; rebind credentials +
   Spreadsheet ID. Keep `active=false`, both WF11 transport nodes **disabled**.
2. **WF11 fixture retest** (`fixture_mode=true`): expect unchanged `posts_received=6`, `hard_skipped_items=1`,
   `business_relevant_items=5`, `unique=4`, `duplicates=1`, **`irrelevant_false_positives=0`**.
3. **WF11 live retest** (arm gate; `brokershakurova`, then `ipotekapro`): expect posts 1231/1233/1240/4106
   **skipped** as `irrelevant_live_false_positive`; real service/case/rate/CTA posts kept as `competitor_activity`;
   market/news digests = `market_signal` (not competitor). Confirm `agent_requests` shows the **live** allowlist +
   `transport=`. No rows written for false positives (unless `live_debug_audit=true`).
4. **WF08 handoff on a CLEAN WF11 live run** (`agent_request_id_filter=<clean wf11 id>`): confirm
   `total_processed` == queue rows written, `deterministic_rows` coherent, `processed_accounting_ok=true`,
   `claude_calls=0`, cost=0.
5. Only after clean WF11→WF08→WF10/WF12 may Stage 3 source closure be reconsidered. Live VK + Claude summary
   remain separately gated. Stage 5 bot NOT started.

---

## CURRENT PRIORITY (2026-06-16, session 5) — retests PASS · WF11 v0.4 gated Telegram live preview built → first live smoke next

**All operator retests PASS — no open blocker.** WF14 v0.2 quota fix confirmed; WF12 post-WF14 report shows the
public-lead-signal block. WF11 v0.4 (gated Telegram public-channel live preview) is built and inert by default.

**Retest results (reference):**
- WF14 TEST B (first run): `public_lead_signals +4`, `agent_requests +1`, `signals_written=4`,
  `duplicates_skipped=2`, `status=completed`, no quota error, no outreach.
- WF14 TEST C (repeat): `+0`, `duplicates_skipped=6`, `signals_written=0`, `status=completed`.
- WF14 TEST E (full-history quota): no quota error, `+0`, `duplicates_skipped=6`, `technical_errors +0`.
- WF12 TEST D: `market_intelligence_reports +1`, `live_source_runs +1`, `llm_status=disabled`,
  `llm_cost_usd=0`, report includes `public_lead_signals: 4 (new: 4)`.

**Built this session (WF11 v0.4, $0, no network, inert by default):** Firecrawl-preferred / HTTP-fallback gated
live transport for public `t.me/s/<channel>` previews; both transport nodes DISABLED; gate normalizes
username/URL allowlist and rejects `+`/joinchat/`t.me/c`/groups/private; `live_max_channels≤2`, `max_posts≤10`;
parser adds view_count + dual response shape; cost recorded (http_get=$0, firecrawl=`cost_not_recovered`);
fixture path unchanged; sanitized sample `n8n/fixtures/wf11_tme_s_preview_sample.html`. (DEC-132)

**Next action — WF11 Telegram public preview LIVE smoke (its own approval + cost note):**
1. [ ] Re-import **WF11 v0.4** (do NOT activate; paste Spreadsheet ID + rebind Google Sheets credential on the
   5 sheet nodes). Confirm `Tест 1` fixture counters unchanged (6/5/1/4/1; `live_source_runs +1`, mode=fixture,
   external_calls=0).
2. [ ] **Arm live (operator):** `live_mode=true`; `live_approval_token=I_APPROVE_LIVE_TELEGRAM_PREVIEW`;
   `live_channel_allowlist` = 1–2 PUBLIC channels (username or `https://t.me/s/<channel>`; NO `+`/joinchat/
   groups/`t.me/c`); choose `live_transport` (`firecrawl` needs a Firecrawl credential bound; else `http_get`);
   **enable the chosen transport node** (Firecrawl or HTTP — both ship disabled); keep `live_max_channels≤2`,
   `live_max_posts_per_channel≤10`.
3. [ ] **Run live smoke once:** expect `live_source_runs +1` (mode=live, external_calls=#channels, source cost
   recorded — firecrawl→`cost_not_recovered`, http_get→$0), `raw_market_records`/`market_record_registry`
   for unique posts, `agent_requests +1` (completed). Record the real Firecrawl cost in COSTS_AND_LIMITS.
4. [ ] WF08 handoff (manual, `deterministic_first`, `agent_request_id_filter=<wf11_req_…>`), then WF10 → WF12.
5. [ ] Live-guard regression: empty token / private-link allowlist → gate throws; transport stays disabled.

**Next-after-Telegram — VK live v0.3 (do NOT build now; operator prerequisites):**
- bind official **VK API credential** in n8n (no user sessions, official API only)
- public **group/post allowlist**; `live_approval_token='I_APPROVE_LIVE_VK_PUBLIC_DISCUSSION'`
- methods: **`wall.get`** + **`wall.getComments`** only
- **max 1–2 public groups** on first smoke; no private groups, no messages, no member lists, no auto-outreach
- record VK API cost (free tier for public wall.get) in COSTS_AND_LIMITS; `cost_not_recovered` if unknown

**Later (each its own approval gate + cost note):** WF12 controlled Claude summary (bind Anthropic credential,
enable HTTP, budget guard) · Stage 5 Telegram Business Agent · WF04 Phase B snapshot-append.

**Stage 5 Telegram Business Agent (planned, NOT this patch):** the bot is a **control/report interface, not a
parser** — commands create `agent_requests`; paid/live actions require approval; first safe slice `/status`
`/report` `/costs`, then request-creation `/scan` `/aggregate` `/build_report`; **no scraping inside the bot,
no auto-outreach, no Claude calls inside the bot itself.**

---

## PREVIOUS PRIORITY (2026-06-12, session 4) — Live-source readiness (WF11/WF13) · Public Lead Signal Layer (WF14) · Run ledger (WF15 + live_source_runs) · WF10 v0.3 objections · WF12 v0.3 stakeholder report + budget-gated Claude path · Stage 2 website reintegration (DEC-124–130)

**Built this session ($0, no external calls, no Claude calls, no Apify, no live scraping):**
- **WF13 v0.2:** guarded live VK path (token `I_APPROVE_LIVE_VK_PUBLIC_DISCUSSION` + allowlist + DISABLED
  official-API wall.get HTTP node + inert parser); phone `#ERROR!` fixed (Sheets-safe apostrophe, DEC-124);
  VK comments → `touchpoint_type=public_comment`; stage label → `stage_3_source_foundation_vk_public_discussion`;
  per-run `live_source_runs` logging.
- **WF11 v0.3:** per-run `live_source_runs` logging + Sheets-safe contacts (live path of DEC-120 unchanged).
- **WF14 NEW:** Public Lead Signal Triage — deterministic pains/intents/scores → `public_lead_signals` (47 cols v0.3; was 28);
  evidence-not-permission policy; dedup post_url+text_hash.
- **WF15 NEW:** manual live-source run logger with enum validation (rejects token values in rows).
- **WF10 v0.3:** objection_count now real (review_queue-scoped distrust vocabulary); pains merged
  («просрочки / плохая КИ», «страх предоплаты / мошенников»); comment_text in blob.
- **WF12 v0.3:** stakeholder report (executive digest 5–7 bullets, clean names, short offers, website block,
  lead/audience block, action blocks; 25-col schema) + **budget-gated test-ready Claude branch**
  (token + cost guard BEFORE HTTP + JSON sections + quality flags + token/cost recording).
- **Tabs to create:** `competitor_site_snapshots` (22) · `live_source_runs` (23) · `public_lead_signals` (28);
  `market_intelligence_reports` headers → 25 cols (v0.3).

**Operator tests next, in order (all $0 unless stated):**
1. [ ] Commit this session (commands in the session report).
2. [ ] Create/extend the 4 tabs above (headers from TABLE_SCHEMA.md §E–G + report schema v0.3).
3. [ ] Re-import WF13 v0.2 (do NOT activate; rebind credential, paste Spreadsheet ID on 5 sheet nodes).
   Fixture Test 1: counters unchanged (6/5/1/4/1, raw +5, registry +4) **plus** `live_source_runs` +1
   (mode=fixture, external_calls=0); contact `+7 999 000-11-22` renders as text (no `#ERROR!`);
   Anna's comments have `touchpoint_type=public_comment`; notes carry the new stage label.
   Test 2 repeat: unique=0/dups=5, runlog +1. Test 3: fixture_mode=false, empty token → LIVE VK Approval
   Gate error; HTTP node stays DISABLED.
4. [ ] Re-import WF11 v0.3; fixture retest (6/5/1/4/1) + `live_source_runs` +1; live gate test unchanged.
5. [ ] WF13→WF08 handoff (llm_enabled=false), then **WF10 v0.3**: vk audience row must show
   question_count≥2, objection_count≥1, buying_intent_count≥1, top_pains ⊇ {отказы банков,
   просрочки / плохая КИ, страх предоплаты / мошенников}.
6. [ ] Import **WF14**; Test 1: ≥2 public_lead_signals rows from VK comments (buying_intent + objection,
   correct pains, contact_use_policy, NO outreach recommendations); Test 2 repeat: signals_written=0.
7. [ ] Re-import **WF12 v0.3**; deterministic run ($0): 25-col row, executive digest, no `(unnamed)` names,
   website/lead blocks render (empty-tab fallbacks OK), `live_source_runs` +1 (mode=deterministic).
   Guard tests: enable_llm_summary=true without token → gate error; with token but
   llm_max_estimated_cost_usd=0.0001 → budget-guard error BEFORE HTTP.
8. [ ] Import **WF15**; log one historical WF09 live run manually → live_source_runs +1; enum-validation
   error test (mode='bogus' → clear error).
9. [ ] **Separate approvals later (each its own gate + cost note):** WF11 live Telegram preview ·
   WF13 live VK wall.get (bind VK credential) · WF12 Claude summary (bind Anthropic credential, enable HTTP,
   record cost in COSTS_AND_LIMITS.md) · WF04 Phase B snapshot-append · Telegram delivery (Stage 5).

---

## PREVIOUS PRIORITY (2026-06-12, session 3) — WF08 cost-control patch (DEC-119) · WF11 v0.2 live path (DEC-120) · WF13 VK foundation BUILT (DEC-121) · WF12 v0.2 report + Claude branch (DEC-122) · Stage 3/4/5 defined (DEC-123)

**Built this session ($0, no external calls, no Claude calls, no live scraping):**
- **WF08 v10:** `llm_enabled=false` master kill switch — uncertain records → `review_queue` with
  `parse_method=deterministic_uncertain_no_llm` ($0); hard guard in the Claude request node; zero-record
  diagnostics in the summary. Avito deterministic behavior untouched.
- **WF11 v0.2:** guarded live path — approval-token gate + DISABLED HTTP placeholder (t.me/s public preview
  only) + inert parser; fixture counters unchanged (sim re-verified 6/5/1/4/1, repeat 0/5).
- **WF13 BUILT:** VK public groups/posts/comments foundation (fixture-first, no HTTP node, live guard);
  audience-signal source with aggregate-only author counts.
- **WF12 v0.2:** full report sections (executive_summary … next_actions) + gated/disabled Claude branch
  (claude-sonnet-4-6 placeholder, cost math $3/$15 per MTok, merge throws without a response).
- Stage docs: STAGE_3 / STAGE_4 / STAGE_5 definitions; DEC-119…123.

**Operator tests next, in order (all $0 unless stated):**
1. [ ] **Commit this session** (see commit commands in the session report).
2. [ ] **Re-import WF08 v10** (do NOT activate). Test A — cost-control: run the WF11 first-run handoff
   (`agent_request_id_filter='wf11_req_20260612_033442'`, `platform_filter='telegram'`, `llm_enabled=false`)
   → the uncertain Telegram market signal lands in `review_queue` with
   `parse_method=deterministic_uncertain_no_llm`, summary shows `claude_calls=0`,
   `estimated_analysis_cost_usd=0`. Test B — zero-record diagnostics: use the duplicate-run id
   `wf11_req_20260612_033756` → `selected_count=0` + populated `zero_record_diagnostics`. Clear filters after.
3. [ ] **Re-import WF11 v0.2**; retest fixture Test 1 (same counters 6/5/1/4/1, raw +5 / registry +4) and
   the live gate (`fixture_mode=false`, empty token → gate error; HTTP node stays DISABLED).
4. [ ] **Import WF13** (do NOT activate; bind Sheets credential + Spreadsheet ID on 4 sheet nodes).
   Fixture Test 1: items=6 / relevant=5 / hard_skipped=1 / unique=4 / dup=1 → raw +5 / registry +4 /
   agent_requests +1; `active_author_count=3`, `repeat_author_count=1`, `question_objection_unique=2`;
   post-201 contact `phone`, non-public author has empty profile_url. Test 2 repeat: unique=0/dups=5.
   Test 3: live guard error. Then WF08 handoff on the first `wf13_req_*` id (`platform_filter='vk'`).
5. [ ] **Re-import WF12 v0.2**; deterministic run → report row with all sections in notes markdown ($0);
   guard test: `enable_llm_summary=true` without token → gate error.
6. [ ] After 2–5 pass: run WF10, then WF12 again for a 2-run trend report.
7. [ ] Separate approvals later (each its own gate): WF11 live transport · WF12 Claude summary ·
   Telegram delivery (Stage 5).

---

## CURRENT PRIORITY (2026-06-12, session 2) — ✅ WF11 fixture PASS → 🔧 v0.1.1 contact patch (DEC-114) re-import + retest; WF08 handoff on first-run id (DEC-117); validation_lists v1.1 (DEC-115); 🔧 WF12 Report Builder skeleton BUILT (DEC-118)

**WF11 fixture tests (operator, $0) ALL PASS:** Test 1 (`wf11_req_20260612_033442`): 6 posts → 5 relevant /
1 hard-skip / 4 unique / 1 dup → raw +5 / registry +4 / agent_requests +1. Test 2 repeat
(`wf11_req_20260612_033756`): unique=0 / duplicates=5 / registry +0. Test 3: live guard stops correctly.
**Stage 3.4 foundation works in fixture mode.** One defect fixed post-test — **v0.1.1 (DEC-114):** Telegram
handles were written as `contact_channel=handle` (a format, not a channel) → now `contact_channel=telegram` +
`contact_format=handle; contact_source_url=…; contact_use_policy=manual_review` in notes; no-contact rows write
empty `contact_channel` (was non-enum `none`). Counts unchanged (24-check sim PASS).

**WF12 (DEC-118)** — Report Builder v0.1 deterministic skeleton (`active=false`, no HTTP node, $0): WF10 tabs →
latest snapshot by `plan_id` → top competitors/angles (+trends vs prev run) → one `market_intelligence_reports`
row (20 cols) + one `agent_requests` row; Claude branch = guard (throws), `telegram_send` not implemented;
`no_data` WF10 run → `no_data_notice` report. 20-check sim PASS.

**validation_lists v1.1 (DEC-115):** 26 lists (operator already applied them, incl. `angle_category`);
legacy-compatible values added (`web`, `social_content`, `social_search`, `review_platform`,
`forum_discussion`, full `dedup_status` set…); modes fixed: system-written columns = "Show warning"
(appends never blocked), human-only = "Reject input". `handle` NOT added to `contact_channel`.

**Next, in order:**
1. [ ] **Commit this session** (WF11 v0.1.1 + WF12 + WF08 sticky + docs).
2. [ ] **Re-import WF11 v0.1.1** (do NOT activate; rebind Sheets credential on 4 sheet nodes + real
   Spreadsheet ID). **Retest fixture Test 1:** same counts (6/5/1/4/1; raw +5 / registry +4) AND the post-101
   row now has `contact_channel=telegram` with `contact_format=handle` in notes; no row carries
   `contact_channel=handle` or `none`.
3. [ ] **WF08 handoff on the WF11 FIRST-run id (DEC-117):** `agent_request_id_filter='wf11_req_20260612_033442'`,
   `platform_filter='telegram'`, `source_type_filter=''`, `max_records=10`,
   `analysis_mode='deterministic_first'`, `llm_enrichment=false`, `llm_enrichment_test_mode=false` →
   expect: unique/new Telegram competitor posts → monitor_queue, the Telegram market signal →
   content_queue/review_queue, duplicate audit rows ignored, `technical_errors=0`, Claude=0. Clear filters
   after. (Duplicate-run id `wf11_req_20260612_033756` yields 0 records — by design, see WF08 RU diagnostics.)
4. [ ] **Sync `validation_lists` to v1.1** in Sheets (operator, $0): extend lists per
   `docs/GOOGLE_SHEETS_VALIDATION_PLAN.md` §2 (legacy values + full dedup_status set; `angle_category` already
   exists); confirm modes (warning on system-written, reject on human-only).
5. [ ] **(Optional) WF12 first run:** create the `market_intelligence_reports` tab (25 v0.3 headers per
   `docs/MARKET_INTELLIGENCE_REPORT_SCHEMA.md`), import WF12 (do NOT activate; rebind credential on 6 sheet
   nodes + Spreadsheet ID) → Execute once → reports +1 (`on_demand`, `llm_*` empty, $0, `delivered_to=none`),
   agent_requests +1. Guard test: `enable_llm_summary=true` → expected error; restore false.
6. [ ] **Then (each behind explicit approval):** WF11 live preview transport v0.2 (strategy §5.7: allowlist-only
   `t.me/s/` pages, ≤10 posts/channel, Firecrawl preferred, cost recorded) → Telegram delivery v1 →
   optional Claude report summary (bounded, cost-recorded — DEC-112).

> Still NOT built/approved: WF11 live transport, Claude report summaries (guarded off — DEC-112/118), Telegram
> delivery/Control Bot, `market_intelligence_reports` tab creation, niche packs (YAML), VK/Dzen/Instagram/
> reviews parsers, outreach/auto-DM (forbidden by default — DEC-098), scheduled runs.

---

## PRIOR PRIORITY (2026-06-12) — 🔧 WF10 v0.2 patch (DEC-106/107/108) → re-import + retests; 🔧 WF11 Telegram-preview foundation BUILT (DEC-109/110); validation/report/Telegram plans written (DEC-111/112/113)

**WF10 v0.2 (DEC-106/107/108)** patched after the v0.1 operator tests (Test 1: 82 rows → 21 profiles / 9 angles /
8 signals / 1 plan / 7 rules, $0; repeat +0 rules; Avito filter PASS; **no-data test FOUND BUG** — generic plan
with lead_magnets at rows=0): no-data guard (marked `no_data` plan only; `result_summary` starts `no_data;`),
entity resolution company_name → profile_url → canonical listing id → profile_name → offer+platform fallback,
mandatory `source_mix` label. Sim: 31 checks PASS. Schemas unchanged (17/9/14/12/5).

**WF11 (DEC-109/110)** — first non-Avito connector foundation: **Telegram public-channel preview**, fixture-only
(`active=false`, `fixture_mode=true`, `live_mode=false`, **no HTTP node**; writes only agent_requests /
raw_market_records / market_record_registry). Sim: 31 checks PASS. Live fetch = separate future approval.

**New plans:** `GOOGLE_SHEETS_VALIDATION_PLAN.md` (DEC-111, validation_lists dropdowns),
`REPORTING_AND_TELEGRAM_SUMMARY_PLAN.md` + `MARKET_INTELLIGENCE_REPORT_SCHEMA.md` +
`TELEGRAM_CONTROL_AGENT_PLAN.md` (DEC-112: Claude in report/control layer, NOT in WF10; DEC-113: MVP =
connectors → raw → WF08 → WF10 → report/Telegram, Avito is just the first live source).

**Next, in order:**
1. [ ] **Commit this session** (WF10 v0.2 + WF11 + docs).
2. [ ] **Re-import WF10 v0.2** (do NOT activate; rebind Sheets credential on all 10 sheet nodes + real
   Spreadsheet ID).
3. [ ] **WF10 retest A (normal run, $0):** Execute once → expect FEWER competitor_profiles than v0.1's 21 for the
   same data (unnamed same-listing rows now collapse); `result_summary` ends with
   `source_mix=mixed: live + historical/manual + web pipeline`; other tabs as before; rules +0.
4. [ ] **WF10 retest B (no-data, $0):** set `region_filter='Нигдеград'` → expect profiles/angles/signals +0;
   `content_positioning_plan` +1 marked `no_data` (empty lists, `source_evidence=rows=0`);
   `result_summary` starts `no_data;`. **Restore the filter after.**
5. [ ] **Import WF11** (do NOT activate; rebind Sheets credential on 4 sheet nodes + real Spreadsheet ID).
6. [ ] **WF11 Test 1 (fixture, $0):** expect `posts_received=6; hard_skipped=1; unique=4; duplicates=1` →
   raw +5 / registry +4 / agent_requests +1. **Test 2 (repeat):** unique=0, registry +0.
   **Test 3 (guard):** `fixture_mode=false` → expected error on LIVE Mode Guard; restore `fixture_mode=true`.
7. [ ] **(Optional) WF08 handoff on the WF11 fixture run** (`agent_request_id_filter=<wf11_req_…>`,
   `platform_filter='telegram'`, deterministic_first, Claude=0) → expect 3 → monitor_queue, 1 → content/review.
   Clear filters after.
8. [ ] **Apply `validation_lists`** per `docs/GOOGLE_SHEETS_VALIDATION_PLAN.md` (operator, Sheets UI, $0).
9. [ ] **Then (each behind explicit approval):** WF11 live preview transport patch → Report Builder v1
   (deterministic, needs ≥2 WF10 runs for trends) → Telegram delivery v1.

> Still NOT built/approved: WF11 live mode, Report Builder, `market_intelligence_reports` tab, Telegram Control
> Bot, Claude report summaries (disabled by default — DEC-112), niche packs (YAML), VK/Dzen/Instagram/reviews
> parsers, outreach/auto-DM (forbidden by default — DEC-098), scheduled runs.

---

## PRIOR PRIORITY (2026-06-11, session 3) — ✅ STAGE 3.3 CLOSED (DEC-102) → WF09 v006 canonical-URL fix (DEC-103) → 🔧 WF10 v0.1 BUILT (DEC-104) → import + first WF10 run

**Stage 3.3 CLOSED / APPROVED (DEC-102):** live run #3 (`avito_req_20260611_184324`) — 10/10 valid, 7 false
positives hard-skipped **before** raw/registry, 3 relevant brokers (2 unique + 1 duplicate), registry +2 exact;
WF08 live handoff: **monitor_queue +2 / technical_errors=0 / Claude=0**, full ad-intelligence fields. All closure
criteria pass. Avito = first stable live source.

**WF09 v006 (DEC-103):** the remaining `?context=` in stored URLs was root-caused (the n8n Code sandbox lacks the
`URL` global; v005's try/catch silently kept the query and blanked slug evidence) → `normUrl`/`canonUrl`/`slugText`
rewritten as pure regex/string functions; verified in a URL-free vm sandbox (12 checks PASS, fixture/duplicate/
relevance unchanged, dedup stable).

**WF10 v0.1 BUILT (DEC-104, gate DEC-099 satisfied):** deterministic Competitor/Audience Intelligence Aggregator
(`active=false`, $0, no LLM/external calls) — monitor/content/review → competitor_profiles / market_angles /
audience_activity_signals / content_positioning_plan / source_confidence_rules (+1 agent_requests). Simulated:
19 checks PASS on the real live monitor rows. Schemas: `docs/WF10_TABLE_SCHEMAS.md`. Backlog of strategic ideas:
`docs/FUTURE_CAPABILITIES_BACKLOG.md` (DEC-105).

**Next, in order:**
1. [ ] **Commit this session** (WF09 v006 + WF10 + docs).
2. [ ] **Re-import WF09 v006** (do NOT activate; rebind Sheets credential + Spreadsheet ID). Canonical-URL watch
   item: on the next routine live run confirm `source_url`/`post_url` carry no `?context=`.
3. [ ] **Create the 5 WF10 tabs** with headers from `docs/WF10_TABLE_SCHEMAS.md`: competitor_profiles (17),
   market_angles (9), audience_activity_signals (14), content_positioning_plan (12), source_confidence_rules (5).
4. [ ] **Import WF10** (do NOT activate); rebind the Google Sheets credential on all 10 sheet nodes; set the real
   Spreadsheet ID.
5. [ ] **WF10 Test 1 (first run, $0):** Execute once → expect competitor_profiles +2 (the live brokers; priced row
   confidence 80), market_angles ≥3 (price anchor / speed / по договору / после отказов), audience_activity_signals
   +1 (avito, aggregate-only), content_positioning_plan +1, source_confidence_rules +7 (seed), agent_requests +1
   (completed, $0). Fill results into `docs/N8N_WORKFLOW_10_…_RU.md` §4 expectations.
6. [ ] **WF10 Test 2 (repeat run):** source_confidence_rules **+0** (seed only when empty); other tabs get a new
   snapshot (append-only v0.1).
7. [ ] **Then Stage 3.4 step 2:** Telegram public-channel feasibility (strategy written, no build without approval).

> Still NOT built/approved: niche packs (YAML), Telegram/VK/Dzen/Instagram parsers, Telegram Control Bot,
> report builder, market graph, outreach/auto-DM (forbidden by default — DEC-098), scheduled runs, WF10 LLM synthesis.

---

## PRIOR PRIORITY (2026-06-11, session 2) — Live transport PASS but business relevance FAILED (2 legal-address false positives) → DEC-095 relevance filter built → re-import WF09 v005 + LIVE RETEST #3; Stage 3.4 architecture pack created

**Live retest #2 (`avito_req_20260611_001222`, actor `fatihtahta~avito-russia-scraper`) results:**
`actor_items_received=10; valid_items=10; invalid_items=0; unique=2; duplicates=1; over_pipeline_limit=7` — the
Apify transport **works**, but **both unique rows were false positives** (legal-address services:
`yuridicheskiy_adres_dlya_ooo_ot_sobstvennika`, `ne_massovyy_yuridicheskiy_adres_ot_sobstvennika`); the one
relevant credit-broker row was a duplicate. **DEC-095 patch (WF09 v005):** business relevance from
title/description/decoded-URL-slug/category only (the query NEVER makes a listing relevant); hard negatives
(юр. адрес / регистрация ООО / POS-терминал / касса / бухгалтерия / эквайринг / печать / ЭЦП / аренда офиса …)
without strong credit evidence → `hard_skipped` — not written to raw/registry, filtered **before**
`pipeline_limit` (now **10**); 8-count `result_summary`; canonical listing URLs. Fixture path unchanged
(simulation: 31 checks PASS, incl. both real false positives hard-skipped).

**Architecture pack created (Stage 3.4 + beyond, docs only, nothing built):**
`docs/CONTACT_AND_OUTREACH_POLICY.md` (DEC-097/098), `docs/STAGE_3_4_SOCIAL_SOURCE_PARSING_STRATEGY.md`
(DEC-096: one source at a time — Avito → Telegram → VK → reviews/maps → Dzen → Instagram-after-risk-review),
`docs/WF10_COMPETITOR_AUDIENCE_INTELLIGENCE_AGGREGATOR_PLAN.md` (DEC-099: build gated on a stable live source),
`docs/NICHE_PACK_SYSTEM_PLAN.md` (DEC-100), `docs/COMPETITOR_AD_INTELLIGENCE_PLAN.md` (DEC-101).

**Next, in order:**
1. [ ] **Commit this session** (WF09 v005 + docs).
2. [ ] **Re-import WF09 v005** (do NOT activate); rebind Google Sheets credential + real Spreadsheet ID; bind
   the Apify HTTP Header credential.
3. [ ] **(Optional, recommended) registry cleanup:** delete/mark the 2 false-positive rows from attempt #2 in
   `market_record_registry` (+ raw audit note) — operator decision.
4. [ ] **LIVE RETEST #3 (after explicit approval):** `fixture_mode=false`, `live_mode=true`,
   `include_irrelevant_control_fixture=false`; keep `actor_limit=10`, `pipeline_limit=10`. Execute once, record
   Apify cost. Expect: legal-address/POS/registration listings → `hard_skipped` (0 written), relevant brokers →
   unique/duplicate, 8-count summary. Fill `docs/STAGE_3_3_TEST_RESULTS.md` Test 3b.
5. [ ] **If `unique>0`:** WF08 handoff with `agent_request_id_filter=<run id>` (clear filters after). If all
   relevant rows are duplicates — correct outcome, no WF08 run.
6. [ ] **Close Stage 3.3** when a live run produces only relevant rows; then start Stage 3.4 step 1
   (Telegram public-channel feasibility — strategy already written, no build yet).

> Still NOT built/approved: WF10 aggregator, niche packs (YAML), Telegram/Instagram/VK/Dzen parsers,
> Telegram Control Bot, outreach/autocall (auto-DM forbidden by default — DEC-098), scheduled scraping,
> auto-handoff WF09→WF08.

---

## PRIOR PRIORITY (2026-06-11) — Stage 3.3 fixture + handoff PASS; live smoke #1 PARTIAL FAIL (empty actor item) → validation guard added (DEC-094) → re-import + LIVE RETEST; valid live extraction not yet achieved

`Workflow 09 — Avito Classifieds Listing Connector` (`active=false`, DEC-090) + the Workflow 08 deterministic handoff
**passed fixture tests** (Test 1 raw+6/registry+6/agent_requests+1; Test 2 duplicate registry+0; handoff
monitor_queue=5 / skipped_log=1 / technical_errors=0 / Claude=0). **All fixture-mode only — no real Avito scrape**
(`fixture_mode=true`, `live_mode=false`, source cost $0, Apify node did not run). **DEC-092 quality patch applied:**
WF09 `max_items=6` (= total fixture records incl. control), richer `service_hint`/`semantic_keywords`, Apify live node
wired for HTTP Header Auth (no secrets); WF08 deterministic Avito enrichment (offer/title, price/terms, specific
service theme, content_idea_score 35–55, competitor_strength 75–85, competitor-ad reason), gated to WF09-origin rows so
the Stage 3.2 baseline is unchanged.

**Next, in order:**
1. [ ] **Re-import WF09 and WF08** (do NOT activate). Rebind the Google Sheets credential on WF09's 4 sheet nodes +
   real Spreadsheet ID. (Apify not needed for fixture/handoff retests.)
2. [ ] **(A) Workflow 08 handoff RETEST** using the existing `avito_req_20260610_214709` rows: WF08 `Set Analyzer
   Config` → `agent_request_id_filter="avito_req_20260610_214709"`, `platform_filter="avito"`,
   `source_type_filter="classified"`, `max_records=6`, `analysis_mode="deterministic_first"`, all LLM flags `false`.
   Run WF08 → expect **monitor_queue=5 / skipped_log=1 / technical_errors=0 / Claude=0** (unchanged) **and** now:
   `offer_text`=listing title, `terms`=price+conditions, `content_idea_score` 35–55, `service_type` preserves the
   theme, `reason` mentions offer/price/semantic. **Clear the 3 filters after.** Fill `docs/STAGE_3_3_TEST_RESULTS.md`.
3. [ ] **(B, optional) WF09 fixture duplicate retest:** Execute WF09 again on the populated registry → all 6
   `duplicate_in_registry`, registry +0, raw +6 audit, `requested_limit=6`.
4. [ ] **(C) LIVE Apify smoke RETEST (actor `fatihtahta~avito-russia-scraper`; attempt #1 PARTIAL FAIL, DEC-093/094):**
   after explicit approval — bind the Apify HTTP Header credential (`Authorization: Bearer <APIFY_TOKEN>`); set
   `fixture_mode=false`, `live_mode=true`, `include_irrelevant_control_fixture=false` (keep `actor_limit=10`,
   `pipeline_limit=3`, `apify_actor_id`, `start_urls`). Execute once; **record the Apify source cost** (the bad attempt
   #1 already incurred a real call). **Inspect the Apify HTTP node JSON output** to confirm the actor returns real
   listing objects. Expected: if the actor still returns empty/search items → `valid_items=0`, **nothing written** to
   raw/registry, `notes` carries the debug message — this is correct (no pollution); if it returns real listings →
   ≤`pipeline_limit=3` valid rows written. **If `valid_items=0`, do NOT run the WF08 handoff; inspect the actor schema,
   and if it keeps returning empty/search items, evaluate an alternative Avito actor.** 0 Firecrawl/Claude. If
   `valid_items>0`, run WF08 with `agent_request_id_filter=<this live run's id>`.

**Next stage after Stage 3.3 validates:** Stage 3.4 — **Social Source Parsing Strategy** (Telegram/VK/Instagram/Dzen/
review-maps; strategy doc, no build); Stage 3.5 — Competitor Semantic & Ad Intelligence aggregation (later).

> Still NOT built/approved: Telegram/Instagram/VK/Dzen parsers, competitor-audience scraping, Telegram Control Bot,
> outreach/autocall, scheduled scraping, auto-handoff WF09→WF08. Live Avito scraping gated behind a chosen actor +
> explicit operator approval.

---

## PRIOR PRIORITY (2026-06-10) — Stage 3.2 CLOSED (Test C4 PASS, DEC-089) → commit → Stage 3.3 Avito/Classifieds Listing Connector

**Stage 3.2 is CLOSED (DEC-089).** Test C4 (the 4-fixture LLM-enrichment retest against the v7 specialized-schema
patch) **passed**: exactly 4 records processed, `technical_errors=0`, **`primary_json=3/4`** (target ≥3/4),
`repaired_json=0/4`, **`deterministic_fallback_after_llm_fail=1/4`** (≤1 acceptable), `repair_used=false` for the 3
`primary_json` rows and `true` only for the fallback row, MSK `+03:00` OK, routes preserved. **The Telegram
`source_candidate` (7) is fixed** (now `primary_json` → `content_queue`/`content_idea`/`create_content`). Routes: 1
Avito → `monitor_queue`/competitor/monitor/`primary_json`; 7 Telegram → `content_queue`/content_idea/create_content/
`primary_json`; 11 Banki → `review_queue`/lead_signal/investigate/`deterministic_fallback_after_llm_fail` (safe — stayed
`review_queue`, no unsafe «обратиться напрямую»); 12 Zoon → `content_queue`/content_idea/create_content/`primary_json`.

**Verdict:** deterministic_first baseline **APPROVED**; **compact LLM enrichment APPROVED WITH WATCH ITEM** for optional
/ test use. **Default stays `deterministic_first` (all LLM flags `false`) unless the operator explicitly enables
`llm_enrichment`.** **Watch item:** the Banki/forum lead-pattern still falls back (safe); improve in a future enrichment
iteration. **C4 cost delta: TODO_OPERATOR_FILL** (target ≤ $0.04 / 4 records).

**Next, in order:**
1. [ ] **Commit the Stage 3.2 finalization** (docs only — see exact commands in the session report / below). No workflow
   JSON changed this pass.
2. [ ] *(Optional, operator)* fill the **C4 cost delta** (Claude balance before/after the C4 run) in
   `docs/STAGE_3_2_TEST_RESULTS.md` and `docs/COSTS_AND_LIMITS.md` (replace `TODO_OPERATOR_FILL`).
3. [ ] **Stage 3.3 — Avito/Classifieds Listing Connector** feasibility/build (DEC-084) — **now unblocked**, proceed
   after commit. Plan: `docs/STAGE_3_3_SOURCE_DECISION_PLAN.md`. Connectors never call Claude; human approval is the
   spend gate. **Build only after explicit operator approval + feasibility/compliance check.**

**Optional enrichment use (operator opt-in only):** `analysis_mode='llm_enriched'` + `llm_enrichment=true` for a run; or
the bounded 4-record test via `llm_enrichment_test_mode=true` (`llm_test_batch_indexes=[1,7,11,12]`). **Restore
`llm_enrichment_test_mode=false` after any test.** Default production mode stays `deterministic_first` / $0.

> Still NOT built/approved: Avito/Dzen/VK/Telegram/Instagram parsers, competitor-audience scraping, Telegram
> Control Bot, outreach/autocall, scheduled scraping.

---

## PRIOR PRIORITY (2026-06-08) — Stage 3.1 Manual Touchpoint Intake BUILT → import, bind, run, verify

`Workflow 07 — Manual Touchpoint Intake` is **built** (`n8n/workflows/07_manual_touchpoint_intake.json`,
`active=false`, JSON valid; DEC-079). It normalizes 12 manually-provided mixed-source examples into
`raw_market_records` (40), dedups via `market_record_registry` (15), and logs one `agent_requests` (21) row.
**No LLM, no scraping, no external API; `agent_memory` not written.**

**Next, in order:**
1. [ ] **Confirm headers** in the 4 created tabs match exactly: `agent_requests` (21), `raw_market_records` (40),
   `market_record_registry` (15), `agent_memory` (13). See `docs/N8N_WORKFLOW_07_MANUAL_TOUCHPOINT_INTAKE_RU.md`.
2. [ ] **Import Workflow 07** into n8n (do NOT activate).
3. [ ] **Bind the Google Sheets credential** (`Google Sheets - Marketing Scout Service Account`) on the 4 sheet
   nodes and **replace `PASTE_SPREADSHEET_ID_HERE`** with the real Spreadsheet ID.
4. [ ] **Run manual intake once** (Execute Workflow).
5. [ ] **Verify** `raw_market_records` (+12), `market_record_registry` (+12 unique on first run), `agent_requests`
   (+1, `status=needs_review`); check `Final Summary Output` (`irrelevant_count=2`, record-11 = hot control).
6. [ ] **(Optional) re-run** to confirm idempotent dedup (all `duplicate_in_registry`, registry +0, raw +12 audit).
7. [ ] **Then design/build the Touchpoint Analyzer (Stage 3.2)** over these records — source-agnostic, reusing
   the Stage 2 resilient analyzer. **Do NOT build any source parser yet.**

> Still NOT built/approved: Avito/Dzen/VK/Telegram/Instagram parsers, competitor-audience scraping, Telegram
> Control Bot, outreach/autocall, scheduled scraping. `agent_memory` not written by Workflow 07.

---

## PRIOR PRIORITY (2026-06-08) — PRODUCT REFRAMED to Business Scout Agent → choose Stage 3.1 path

Stakeholder interview (`STAKEHOLDER_INTERVIEW_2026_06_08.md`) reframed the product (DEC-078): it is the
**Business Scout Agent** (an AI "employee" with internal tools + memory + analysis), with marketing/lead/
competitor intelligence as its **first domain**. Stage 3 is now **Social/Classified Touchpoint Discovery** (leads
are a subset). New design docs: `BUSINESS_SCOUT_AGENT_VISION.md`, `MARKETING_AGENT_PRODUCT_VISION.md`,
`AGENT_TOOL_ARCHITECTURE.md`, `AGENT_MEMORY_PLAN.md`. Schema generalized: **`agent_requests`** (supersedes
`lead_discovery_requests`), expanded `raw_market_records`, plus proposed **`agent_memory`** (all PROPOSED, not created).

**Next operator decision — choose the Stage 3.1 path:**
- **Option A** — approve the proposed agent/touchpoint sheets and **build Manual Records Intake**.
- **Option B** — perform deeper **feasibility evaluation** of Avito/Dzen/VK/Telegram source connectors.
- **Option C** — **wait for the uncle's full list of desired agents** and map them to internal tools.

**Recommended: A + C** —
1. [ ] Document the **agent/tool map** now (done: `AGENT_TOOL_ARCHITECTURE.md`) and review it.
2. [ ] **Wait for the uncle's full desired-agent list**; map each to an internal tool/`request_type`.
3. [ ] **Build Manual Records Intake first**, using manually collected examples from Avito/Dzen/VK/Telegram/comments.
4. [ ] **Do NOT build any source parser yet.** No Telegram bot, no Avito/VK/Instagram/Dzen parser, no outreach/autocall.

> Touchpoint classes: hot_lead, warm_touchpoint, cold_audience_candidate, client_pain, question_objection,
> competitor_audience, competitor_activity, semantic_signal, ad_channel_signal, content_idea, market_signal,
> irrelevant. Source lens (touchpoints): Avito = direct intent + competitor ads; Dzen/VK/comments = pains/
> audience/warm; Instagram = competitor content; competitor audiences = public data only.

---

## PRIOR PRIORITY (2026-06-07) — Stage 2 APPROVED (minor limitations) → commit → Stage 3.0

Stage 2 web pipeline **05 → 06 → 04** is **APPROVED with minor limitations** (DEC-074). Real results:
`docs/STAGE_2_FINAL_TEST_RESULTS.md`. Auto-handoff (06→04) was evaluated and **deferred** to Stage 2.4
(`docs/WORKFLOW_06_AUTO_HANDOFF_PLAN.md`); **manual handoff remains the approved path**. No workflow logic was
changed this pass — docs/finalization only.

**Next, in order:**
1. [ ] **Commit the Stage 2 web pipeline finalization** (docs only this pass — see exact commands in the
   session report / below). Workflows are unchanged and already valid.
2. [ ] **(Optional) clear the two watch items** from `STAGE_2_FINAL_TEST_RESULTS.md` with live re-tests:
   - **W1 — runner modes with fresh inputs:** run WF05 on a *new* query to get fresh, unprocessed same-domain
     candidates (≥2 on one domain); approve them; run WF06 in `first_pass_domain_diversity` (expect 1 selected
     for that domain, rest → `duplicate_domain_in_run`) and `deep_domain_analysis` (expect up to 3 selected,
     4th+ → `domain_deep_limit`, deep-mode `warning` on selected).
   - **W2 — valid contact preservation:** process a competitor page with a clearly published phone/Telegram/
     WhatsApp; confirm `contact_public` is populated (not blanked).
3. [ ] **Stage 3.0 — Lead Source Evaluation** (design/eval doc; **no build**): compare **Avito vs Telegram vs
   VK** on data availability, cost, risk, lead quality, implementation complexity. See
   `docs/LEAD_DISCOVERY_ARCHITECTURE.md` + `docs/LEAD_SOURCE_CONNECTORS_PLAN.md`. (DEC-076: Stage 3 starts here,
   **not** the Telegram bot.)
4. [ ] **Do NOT build any lead connector** until the Stage 3.0 evaluation is written **and approved**.
   Preliminary (non-binding) choice: Avito/Classifieds first, Telegram second (the Telegram **parser** ≠ the
   Telegram **Control Bot** and needs a separate access/client design); VK/Instagram/Yandex later. Wire Manual
   Records Intake first to validate the lead schema + analyzer with zero source risk.
5. [ ] **(Future, before Telegram bot) Stage 2.4 — auto-handoff 06→04** per `WORKFLOW_06_AUTO_HANDOFF_PLAN.md`,
   only when it can be built safely **and live-validated** (confirm-then-mark). Default stays manual handoff.

> Still NOT approved / not built: Avito scraping, Telegram parser, VK/Instagram/Yandex connectors, Telegram
> Control Bot, auto-handoff 06→04, universal `market_profile`. Lead sheets (`lead_discovery_requests`,
> `raw_market_records`, `market_record_registry`) are **proposed only** (see `TABLE_SCHEMA.md`).

---

## Current Priority: v0.1 Pipeline Setup

### Step 1 — Review project structure ✓
- [x] Operator reviews all created files
- [x] Documentation review fixes applied (2026-06-04)
- [x] Confirm roadmap stages and stack are correct

### Step 2 — Prepare docker-compose.yml for n8n ✓

- [x] `scripts/docker-compose.n8n.example` created — localhost-only, n8n_data volume, env_file
- [x] `scripts/n8n.env.example` created — all required env vars with MVP-safe defaults
- [x] `docs/N8N_DEPLOYMENT.md` created — full deployment guide including SSH tunnel, HTTPS deferral, what not to commit

**To deploy** (operator runs — see `docs/N8N_DEPLOYMENT.md` for full steps):
```bash
mkdir -p /opt/n8n
cp scripts/docker-compose.n8n.example /opt/n8n/docker-compose.yml
cp scripts/n8n.env.example /opt/n8n/n8n.env
# Edit n8n.env: set N8N_ENCRYPTION_KEY=$(openssl rand -hex 32)
```

**Access method for v0.1:** n8n will be accessed via SSH tunnel only — no public domain,
no reverse proxy, no HTTPS required for MVP.

SSH tunnel command (run on your local machine):
```
ssh -L 5678:localhost:5678 user@your-vps-ip
```
Then open `http://localhost:5678` in a local browser.

Public HTTPS/domain access is deferred until webhooks or OAuth integrations require inbound access.

### Step 3 — Start n8n on VPS ✓

- [x] Docker Engine confirmed: v29.1.3, 3 containers running, 39 images present
- [x] Docker Compose confirmed: v5.1.2 (manual install at `/usr/local/lib/docker/cli-plugins/docker-compose`)
- [x] `docker-compose.yml` deployed to `/opt/n8n/` on VPS
- [x] `docker compose up -d` executed — container `n8n-n8n-1` running
- [x] n8n UI confirmed accessible via SSH tunnel at `http://localhost:5678`
- [x] Execution pruning configured in `n8n.env` (PRUNE=true, MAX_AGE=168h, MAX_COUNT=1000)

**Access:** SSH tunnel only — `ssh -L 5678:127.0.0.1:5678 root@SERVER_IP` → `http://localhost:5678`
**Do not open port 5678 publicly** — n8n is bound to `127.0.0.1` for v0.1. See DEC-010.

> **Disk warning:** VPS at ~86% used, ~1.4G free after n8n launch. Acceptable for MVP.
> Plan to upgrade VPS disk before running high-volume scrape jobs. See DEC-013.

> **Note:** Docker Compose was installed manually — not via apt. See `docs/DECISIONS.md` DEC-009 and `tools/TOOLS.md` for migration/troubleshooting details. Do not run `docker system prune` without explicit approval.

### Step 4 — API Credentials Setup in n8n

- [ ] Create Apify account and get API key → add to n8n Credentials UI (Header Auth)
- [ ] Create Firecrawl account and get API key → add to n8n Credentials UI (Header Auth)
- [ ] Get Claude API key → add to n8n Credentials UI (Header Auth, key name: `x-api-key`)
- [ ] Set up Google Sheets OAuth2 in n8n Credentials UI
- [ ] Create Telegram bot via BotFather → store token in n8n Telegram credential

### Step 5 — Google Sheets Setup

- [ ] Create output spreadsheet with columns from `docs/TABLE_SCHEMA.md`
- [ ] Share with n8n Google Sheets service account or authenticated OAuth account
- [ ] Note the Spreadsheet ID and Sheet name for n8n node configuration

### Step 6 — Build n8n Workflows (incremental)

Workflows are built incrementally — no external APIs until the platform is verified.

#### Workflow 00 — Healthcheck Manual Test ✓ COMPLETED 2026-06-04

**Guide:** `docs/N8N_WORKFLOW_00_HEALTHCHECK_RU.md`
**JSON:** `n8n/workflows/00_healthcheck_manual_test.json`

- [x] JSON generated and validated (Claude Code → JSON file)
- [x] Imported into n8n from JSON (via GitHub / file copy)
- [x] Executed successfully — output: `status=analyzed`, `quality_score=75`, no red nodes

**Do not modify this workflow** — it is the healthcheck baseline for the project.

> Confirmed working method: Claude Code generates n8n JSON → committed to repo →
> operator imports into n8n. This is the standard workflow delivery method going forward.

#### Workflow 01 — Google Sheets Append Row Test ✓ COMPLETED 2026-06-04

**Guide:** `docs/N8N_WORKFLOW_01_GOOGLE_SHEETS_RU.md`
**JSON:** `n8n/workflows/01_google_sheets_append_row_test.json`

- [x] Google Sheets spreadsheet "Marketing Scout Results" created; sheet named `results`
- [x] Service account created in n8n as `Google Sheets - Marketing Scout Service Account`
- [x] Spreadsheet shared with service account (Editor)
- [x] Workflow imported and configured (credential + Spreadsheet ID)
- [x] Executed successfully — test row appended: `status=analyzed`, `quality_score=75`, `source_type=manual_test`

**Note:** table initially had vertical header rows in column A (rows 2–25); fixed by deleting rows 2–25, keeping only row 1 as the single horizontal header row.

**Do not modify this workflow** — it is the Google Sheets baseline for the project.
**Do not commit** real Spreadsheet ID or service account email to Git.

#### Workflow 02 — Claude API Single Record Analysis ✓ COMPLETED 2026-06-05

**Guide:** `docs/N8N_WORKFLOW_02_CLAUDE_API_RU.md`
**JSON:** `n8n/workflows/02_claude_api_single_record_analysis.json`
**Prompt:** `modules/marketing-scout-v0/MARKETING_AGENT_PROMPT_V1.md`

- [x] MARKETING_AGENT_PROMPT_V1.md created — secured lending domain, 1–100 scoring
- [x] Workflow JSON generated and validated (9 nodes, active=false)
- [x] Russian guide created
- [x] Imported and configured in n8n (credential + Spreadsheet ID)
- [x] Executed successfully — Claude returned analyzed JSON, row appended to Google Sheets
- [x] Measured API cost: $0.0115 per short scoring ≈ 0.84 RUB

**Results:** service_type=pts_loan, quality_score=72, lead_signal_score=75, content_idea_score=80, status=analyzed

**Do not modify this workflow** — it is the Claude API + Google Sheets baseline for the project.
**Prompt duplication note:** prompt is embedded in Build Claude Request node AND stored in MARKETING_AGENT_PROMPT_V1.md — update both on any change (see DEC-020).

#### Step A — Ask Uncle: Business Requirements ✓ COMPLETED 2026-06-05

**Goal:** Before any paid scraping, confirm what the operator's uncle actually needs.

- [x] Ask uncle: primary use case — **lead signals first, competitors second, content third**
- [x] Ask uncle: which platforms/sources matter most? — **Telegram, Instagram, Avito, Yandex / competitor websites**
- [x] Ask uncle: target region? — **Moscow + Moscow Oblast**
- [x] Ask uncle: which loan products? — **PTS, auto collateral, real estate, refinancing, mortgage, business loans**
- [x] Ask uncle: what does a useful result look like? — row in Sheets; contact strong leads, monitor competitors
- [x] Recorded in `docs/BUSINESS_REQUIREMENTS.md` — full BRD with product scope, ICP, source priorities, table fields, open questions
- [x] Updated `MARKETING_AGENT_PROMPT_V2_PLAN.md` — ICP confirmed; priority order locked

**Output:** `docs/BUSINESS_REQUIREMENTS.md` created. See also implications sections for Prompt v2 and scraping config.

> See DEC-021. Paid scraping is still gated on Prompt v2 approval (Step C/D).

#### Step B — Fix Documentation Consistency _(zero cost)_ ✓ IN PROGRESS 2026-06-05

- [x] `WORKFLOW_DESIGN.md` — gateway URL, auth, prompt reference, threshold scale, parse pattern
- [x] `TABLE_SCHEMA.md` — scoring scale 1–100, entity/status/service_type values, competitor_strength type
- [x] `docs/PROMPTS.md` — active prompt reference, version history, v2 plan
- [x] `docs/AGENT_CAPABILITIES.md` — created: v1 can/cannot, v2 plan, scoring, schema, risks, client explanation
- [ ] `README.md` — update current stage from "in design" to "infrastructure validated"
- [ ] `tools/TOOLS.md` — fix Google Sheets auth note; update GitHub status
- [ ] `core/warm/decisions.md` — add DEC-018, DEC-019, DEC-020, DEC-021

#### Step C — Write Marketing Agent Prompt v2 ✓ COMPLETED 2026-06-05

**Goal:** Write a prompt that reasons like a marketing analyst, not a data extractor.

- [x] `modules/marketing-scout-v0/MARKETING_AGENT_PROMPT_V2.md` — written (~12 KB)
- [x] Priority order encoded: lead signals first → competitors second → content ideas third
- [x] Confirmed ICP from `docs/BUSINESS_REQUIREMENTS.md` — Moscow car owner, bad credit, urgency
- [x] Region rules: MO leads eligible 60–100; out-of-region capped at 40
- [x] Product hierarchy: PTS/auto > real estate > refinancing > other
- [x] Competitor threat framework: regional overlap + USP + activity level
- [x] Lead urgency model: fit × urgency × readiness with calibration anchors
- [x] Content intelligence: offer_text for content_idea = proposed article title
- [x] Structured 3-sentence reason field with evidence citation requirement
- [x] Anti-hallucination additions, expanded skip rules
- [x] `modules/marketing-scout-v0/TEST_RECORDS_V2.md` — 7 synthetic test records with expected scores
- [x] `docs/N8N_WORKFLOW_02_V2_TEST_PLAN_RU.md` — step-by-step manual test guide (Russian)

> Schema unchanged — same 25 output fields as v1. New fields planned for v2.1+.

#### Step D0 — Project Cleanup ✓ PHASE 1 COMPLETE 2026-06-06

**Audit:** `docs/PROJECT_CLEANUP_AUDIT.md`

- [x] Phase 1 — Audit created (`docs/PROJECT_CLEANUP_AUDIT.md`)
- [x] Phase 2 — Operator approved deletion of 2 workflow JSON files
- [x] Phase 3 — Untracked files previously added to git; ghost files already absent at execution time
- [x] Phase 4 — Executed: `git rm` on 2 approved files; staged for commit
  - Deleted: `02_claude_api_single_record_v2_test_harness.json` (v2.5 MICRO, gateway 502)
  - Deleted: `02_claude_api_single_record_v2_baseline_short_test5.json` (Test 5 short variant)
  - All keep files confirmed present

**Deferred to phase 2** (after Resilient Output Layer is built and tested):
- `modules/marketing-scout-v0/MARKETING_AGENT_PROMPT_V2_PLAN.md`
- `modules/marketing-scout-v0/SYSTEM_PROMPT.md`
- `modules/marketing-scout-v0/TEST_DATA.md`
- `docs/MILESTONE_REVIEW_02.md`

**Remaining workflow JSON files (5 active):**
- `00_healthcheck_manual_test.json` — baseline
- `01_google_sheets_append_row_test.json` — baseline
- `02_claude_api_single_record_analysis.json` — production v1
- `02_claude_api_single_record_v2_baseline_raw_json.json` — d350069 reference (working)
- `02_claude_api_single_record_v2_extended_tests.json` — test evidence

> Full detail: `docs/PROJECT_CLEANUP_AUDIT.md`

---

#### Step D — Implement Resilient Output Layer in TEST HARNESS _(immediate next step)_

**Context:** Extended tests 8–12 ran. Tests 1 and 8 (hot PTS leads) passed strongly. Tests 9–12 and 5 failed with output-contract errors — Markdown blocks, no-text responses, invalid JSON. The model reasoned correctly; serialization failed. See `docs/WORKFLOW_02_V2_TEST_RESULTS.md` and DEC-033.

**Decision:** Stop prompt format experiments. Fix architecture with a two-pass Repair + multi-tab Router.
**Design spec:** `docs/WORKFLOW_02_RESILIENT_OUTPUT_LAYER.md`

**Phase 1 — Google Sheets setup (operator, no code):**
- [ ] Create 5 new tabs in "Marketing Scout Results": `review_queue`, `monitor_queue`, `content_queue`, `skipped_log`, `technical_errors`
- [ ] Add header row to each tab — 25 existing columns + 6 new technical columns: `processing_status`, `parse_method`, `parse_error`, `raw_response_preview`, `route`, `needs_manual_review`
- [ ] Update existing `results` tab header row to include the same 6 new columns

**Phase 2 — Build Resilient Output Layer in TEST HARNESS (Claude Code generates JSON) ✓ COMPLETE 2026-06-06:**
- [x] 21-node workflow JSON created: `n8n/workflows/02_claude_api_single_record_v2_resilient_router_test.json`
- [x] JSON Repair Formatter node added (Claude Repair API Request, same gateway, max_tokens=900, temp=0.0)
- [x] Parse Repaired JSON Code node added (forces technical_error for mock_unrepairable)
- [x] Switch by Route node (6 branches: results/review_queue/monitor_queue/content_queue/skipped_log/technical_errors)
- [x] 6 Append nodes (one per tab), credential placeholders only
- [x] Normalize + Route Code node: full routing logic with clamp, entity validation, test assertion fields
- [x] Mock modes: mock_markdown (Test D) and mock_unrepairable (Test E) — no real API for mocks
- [x] Russian test guide created: `docs/N8N_WORKFLOW_02_RESILIENT_ROUTER_TEST_RU.md`
- [x] Validated with `python3 -m json.tool` — VALID
- [x] DEC-034 added to `docs/DECISIONS.md`
- [x] **FIXED copy created:** `n8n/workflows/02_claude_api_single_record_v2_resilient_router_test_fixed.json`
  — Switch by Route rebuilt as typeVersion 1 (simple string-match, not rules-mode); positions adjusted; validated VALID
- [x] **DYNAMIC SHEET copy created:** `n8n/workflows/02_claude_api_single_record_v2_resilient_router_test_dynamic_sheet.json`
  — Switch by Route + 6 Append nodes removed; replaced with one Google Sheets node (Sheet Name = `={{ $json.route }}`); route-validation safety added to Normalize + Route; validated VALID (DEC-035)
  — **Use THIS file for import — cleanest architecture (15 nodes, 1 sheet node)**

**Phase 3 — Run Tests A–E (operator, next action):**
- [ ] **Delete** any old `RESILIENT ROUTER TEST` / `... FIXED` workflow from n8n if already imported
- [ ] Import `02_claude_api_single_record_v2_resilient_router_test_dynamic_sheet.json` into n8n
- [ ] Set credentials + Spreadsheet ID (see `docs/N8N_WORKFLOW_02_RESILIENT_ROUTER_TEST_RU.md`)
- [ ] Create 6 Sheets tabs with header rows (see guide, Step 4)
- [x] Run Test A (test_id=A): hot lead → `results`. PASS (`parse_method=primary_json`, lead=97, quality=98)
- [x] Run Test B (test_id=B): weak lead → `review_queue`. **Exposed routing-priority bug** — went to `content_queue`. Fixed in `Normalize + Route` (DEC-036). **Retest required to confirm live.**
- [x] Run Test C (test_id=C): competitor → `monitor_queue`. PASS. `company_name` was empty → descriptive fallback added (DEC-036).
- [x] Run Test D (test_id=D): mock_markdown → repair → `results`. PASS. Validates Repair Formatter. `service_type` free text → normalized to `pts_loan` (DEC-036).
- [x] Run Test E (test_id=E): mock_unrepairable → `technical_errors`. PASS. Validates technical_errors path.
- [x] **Retest Test B** (live) after DEC-036 patch → confirmed `route=review_queue` (`primary_json`, lead≈38).
- [x] All A–E pass live → full project review done.

> Patch applied 2026-06-06 (DEC-036): routing priority fixed (weak lead before content_queue), service_type enum normalization, company_name competitor fallback. JSON re-validated VALID. API cost for A–E run: $0.0750 (see `docs/COSTS_AND_LIMITS.md`).

#### Step D5 — Full Project Review (review-first gate) ✓ DONE 2026-06-06

**Read this before any implementation:** `docs/PROJECT_REVIEW_03_RESILIENT_ROUTER.md`

Review verdict: **GO for first scraper, conditional on hardening.** Architecture approved; productionization required first.

**Blockers before first scraper (from the review):**
- [x] Build a **production** resilient workflow with no test-harness columns → `02_claude_api_single_record_v2_resilient_router_production.json` (DEC-037). 33 output columns (25 core + 8 technical). ✓
- [x] Reconcile `TABLE_SCHEMA.md` — production 33-column header + six tab names documented. ✓
- [ ] Operator pre-creates all six tabs (dynamic node does not create missing tabs).
- [ ] Record Firecrawl credential + free-tier limits in `COSTS_AND_LIMITS.md`.

**Important fixes:** [x] `raw_response_preview` capped at 500 (code + docs aligned). [x] `recommended_action` normalized to route. [ ] dedup — `source_url` documented as v0.1 first key (full dedup later). [ ] append-node error handling (nice-to-have).

#### Step D6 — Production hardening + cleanup ✓ DONE 2026-06-06 (DEC-037)

- [x] Production workflow created (test/mock fields stripped); JSON validated VALID; routing logic-simulated for A/B/C/D/E + skip.
- [x] Obsolete Switch-based workflows removed via `git rm` (`..._test.json`, `..._test_fixed.json`).
- [x] Docs updated: TABLE_SCHEMA, RESILIENT_OUTPUT_LAYER, TEST_RESULTS, CLEANUP_AUDIT, CAPABILITIES, COSTS, ROADMAP, DECISIONS (DEC-037).

#### Step D7 — Production smoke test ⚠️ FIRST ATTEMPT FAILED (2026-06-06)

First manual smoke test failed: primary parse failed → **Repair API 502 Bad Gateway** → row went to `technical_errors` with primary diagnostics lost. Workflow patched (DEC-038): primary raw preserved, compact repair payload (max_tokens 700, smaller schema), dual Primary+Repair error diagnostics, primary prompt reminder, smoke `text_context` preset to the competitor example. **Retest required.**

#### Step D8 — Clean Sheets headers, re-import patched workflow, rerun smoke ← NEXT

1. [ ] **Clean the 6 Sheets tabs to exactly the 33-column header** (`docs/TABLE_SCHEMA.md`) — no test columns, internal English names only. Tabs: `results, review_queue, monitor_queue, content_queue, skipped_log, technical_errors`.
2. [ ] Re-import the **patched** `02_claude_api_single_record_v2_resilient_router_production.json` (active stays false).
3. [ ] Set Google Sheets credential + real **Spreadsheet ID** on `Append to Dynamic Route Sheet`; set Claude credential on both HTTP nodes.
4. [ ] `Set Source Record` already carries the competitor smoke record (`text_context` preset). Adjust only if needed.
5. [ ] Record Claude balance before, run once manually, record balance after (`docs/COSTS_AND_LIMITS.md`).
6. [ ] Verify expected: `route=monitor_queue`, `entity_type=competitor`, `recommended_action=monitor`, `processing_status=parsed_success`, `parse_method=primary_json` (or `repaired_json`). If it still lands in `technical_errors`, confirm `parse_error` now shows **both** `Primary:` and `Repair:` and `raw_response_preview` shows the primary raw response — then diagnose the 502 (gateway retry/backoff).
7. [ ] **Firecrawl remains BLOCKED until this smoke test passes** (DEC-038). Only then build `03_firecrawl_single_url_resilient.json`.

**First scraper recommendation:** Firecrawl on one public competitor website (lowest risk; `monitor_queue` path validated by Test C). Then Avito/Apify → Telegram → Instagram later.

**Next implementation prompt + smoke tests:** see `docs/PROJECT_REVIEW_03_RESILIENT_ROUTER.md` §10–11.

**Phase 4 — Migrate to production Workflow 02:**
- [ ] After operator approval: apply Resilient Output Layer to `02_claude_api_single_record_analysis.json`
- [ ] Re-run Tests 9, 10, 11, 12 on production workflow. Confirm routing (not just "pass/fail")

**Cleanup Phase 2 — after dynamic-sheet workflow passes Tests A–E:**
- [ ] **Do NOT delete** the Switch-based resilient workflows (`_fixed.json`, `_test.json`) until the dynamic-sheet workflow passes Tests A–E. They remain the only proven-importable copies and `_fixed.json` is the documented six-IF-node fallback source.
- [ ] **After A–E pass:** perform cleanup phase 2 — `git rm` the two superseded Switch-based iterations. See `docs/PROJECT_CLEANUP_AUDIT.md` → "Cleanup Phase 2 — after dynamic router tests".
  - Delete after pass: `02_claude_api_single_record_v2_resilient_router_test_fixed.json`
  - Delete after pass: `02_claude_api_single_record_v2_resilient_router_test.json`
  - Keep active candidate: `02_claude_api_single_record_v2_resilient_router_test_dynamic_sheet.json`
  - Keep reference: `02_claude_api_single_record_v2_baseline_raw_json.json`
  - Keep historical evidence: `02_claude_api_single_record_v2_extended_tests.json`

> Design spec: `docs/WORKFLOW_02_RESILIENT_OUTPUT_LAYER.md`. Results: `docs/WORKFLOW_02_V2_TEST_RESULTS.md`. Cleanup plan: `docs/PROJECT_CLEANUP_AUDIT.md`.

#### Step E — Firecrawl Single URL Test ✅ PASSED (2026-06-08)

**Result:** Two real single-URL competitor tests passed after DEC-043/044 hardening (DEC-045). Firecrawl single-URL competitor ingestion is **APPROVED** for manual controlled use.
- `https://mosinvestfinans.ru/` → `monitor_queue`, competitor, `МосИнвестФинанс`, `generic_lending`, strength/quality **78**, `monitor`, `parsed_success`, `primary_json`, `repair_used=false`.
- `https://www.lioncredit.ru/uslugi/kredit-pod-zalog-nedvizhimosti` → `monitor_queue`, competitor, `LionCredit`, `generic_lending`, strength/quality **75**, `monitor`, `parsed_success`, `primary_json`, `repair_used=false`.

**Operational note (DEC-046):** after every import, n8n requires manual credential rebinding (`Firecrawl Scrape API`→`Firecrawl API - Marketing Scout`; both Claude nodes→`Claude API - Marketing Scout`; `Append to Dynamic Route Sheet`→`Google Sheets - Marketing Scout Service Account` + real Spreadsheet ID). Expected — credential IDs are local.

> Still blocked (DEC-039/040): multi-page crawl, batch scrape, search, scheduled scraping, Firecrawl MCP/CLI, automated outreach.

#### Step F — Workflow 04: Firecrawl URL List Mini-Batch ✅ VALIDATED & APPROVED (manual ≤5 URLs, 2026-06-08)

**Workflow:** `n8n/workflows/04_firecrawl_url_list_resilient.json` (25 nodes; JSON valid; active=false; 35-field business schema + 10-field `url_registry`). **Plan/guide:** `docs/WORKFLOW_04_FIRECRAWL_URL_LIST_PLAN.md`, `docs/N8N_WORKFLOW_04_FIRECRAWL_URL_LIST_RU.md`.

**Validation:** 3-URL run (DEC-053) — Run 1 process / Run 2 all `skipped_log`, 0 cost. **5-URL run (DEC-054, `firecrawl_20260607_100715`)** — 2 duplicates skipped, 1 placeholder skipped, 2 competitors → `monitor_queue`; Claude Δ $0.0429, ~3 Firecrawl credits. **Mini-batch (≤5 URLs, manual) APPROVED.** Minor hardening (DEC-054): placeholder pre-filter before Claude + stronger PTS service-type override + readable node layout.

**Hard limits:** max 5 URLs · manual only · no crawl/batch/search/schedule · `text_context`≤3500 · continue-on-failure per URL. Duplicate → `skipped_log`/`dedup_source_url`, **0** Firecrawl/Claude cost.

**Next steps (in order):**
1. [ ] **Optional retest after this patch** with a representative 3-URL list: one **duplicate root URL** (already in `url_registry`), one **placeholder URL** (parked/Wix), one **PTS competitor URL** (e.g. a `/pledge-pts` page). Expect: duplicate → `skipped_log`/`dedup_source_url`; placeholder → `skipped_log`/`firecrawl_placeholder_prefilter`; PTS page → `monitor_queue`/`pts_loan`. Record before/after Firecrawl credits + Claude balance.
2. [ ] After import, confirm `Append url_registry` is set to **Sheet=`url_registry` (name, not dynamic), Mapping=Automatically, real Document ID, Google Sheets credential**.
3. [ ] Then move to **URL Discovery layer planning** (Stage 2.2) — **do not build discovery yet**; it needs its own plan + approval.
4. [ ] Later: **plan** the Telegram Control Bot layer (Stage 2.3).

> **Backfill note:** `url_registry` is the dedup source of truth. Rows analyzed before the registry existed re-process once until backfilled (optional maintenance) — see `TABLE_SCHEMA.md`.
> Still blocked: >5 URLs, scheduled runs, crawler, batch/search endpoints, URL-discovery agent, Telegram bot, Avito/Telegram/Instagram (DEC-050).

#### Step G — Stage 2.2: Apify Search Candidate Discovery (Workflow 05) 🔧 BUILT + candidate-quality patch, RETEST (2026-06-08)

**Status:** first real Apify test passed **technically** (10 candidates, 1 registry duplicate). Candidate-quality patch applied (DEC-061): fixed empty `domain`, added `candidate_type`, competitor-first confidence. **Retest required.** `n8n/workflows/05_apify_search_candidate_discovery.json` (13 nodes, active=false). Guide: `docs/N8N_WORKFLOW_05_APIFY_SEARCH_CANDIDATES_RU.md`. **0 Firecrawl/Claude.**

**Retest tasks (in order):**
1. [ ] **Add the `candidate_type` column** to the existing `url_candidates` sheet — insert it **after `domain`** so the header is the **26-column** order in `TABLE_SCHEMA.md` (`…normalized_source_url, domain, candidate_type, title, snippet, rank…`).
2. [ ] **Re-import the patched Workflow 05** (active stays false); rebind credentials (Apify + 3 Google Sheets nodes; real Spreadsheet ID).
3. [ ] **Rerun the same query** «займ под залог ПТС Москва».
4. [ ] **Expected:** `domain` filled for all rows; `candidate_type` classified (autolombards/lenders → `direct_competitor`; 2gis → `directory`; banki/vbr/finuslugi → `aggregator`; kp → `media_article`); direct competitors rank higher than aggregators/directories/media; the previously-seen duplicate preserved (`approval_status=duplicate`); 1 `discovery_requests` row; **0 Firecrawl/Claude**; no business-tab writes.
5. [ ] Manually approve **direct competitors first**; aggregators/directories/media → review manually (note already flags them). Record the Apify run cost.
6. [ ] **Do not process candidates yet** — hand-off to Workflow 04 (≤5) only after this retest is validated.

> **Do not** build the Approved Candidates Runner (Stage 2.2c), use Firecrawl `/v2/search` (parked), build SerpAPI/Google-CSE fallbacks, or build the Telegram bot (Stage 2.3) yet — each is gated (DEC-056/057/059).

#### Step H — Workflow 04 service_type patch (DEC-062) + next: Workflow 06 Approved Candidates Runner (2026-06-08)

**Done this session:** patched `Normalize + Route` so a **root homepage** gets a specific `service_type` when content is overwhelmingly PTS/auto-focused (deterministic signal counts), while multi-product roots stay `generic_lending`. Fixes the E2E finding (`carcapital.ru/` was `generic_lending`, now `pts_loan`). JSON valid; 35/10 field counts and dedup unchanged.

**Operator next steps:**
1. [ ] Re-import the patched **Workflow 04** (active stays false); rebind credentials (Firecrawl, both Claude, 4 Google Sheets nodes + real Spreadsheet ID).
2. [ ] *(Optional)* **Retest `https://carcapital.ru/`** via Workflow 04 (force_reprocess or a fresh registry) → expect `route=monitor_queue`, **`service_type=pts_loan`**, competitor.
3. [ ] *(Done — see Step I)* Build Workflow 06 — Approved Candidates Runner.

#### Step I — Workflow 06 Approved Candidates Runner BUILT + Workflow 04 contact sanitation (DEC-063/064, 2026-06-07)

**Done this session:**
- **Workflow 04 `contact_public` sanitation (DEC-063):** `Normalize + Route` now blanks partial/placeholder contacts (the E2E run had stored `"+7 (495) ... (номер указан на сайте, требуется извлечение)"`). A value is kept only if it matches a reliable pattern (phone `+7`/`8`/`7` with 10–11 digits, email, Telegram, or contact/profile URL); `...`/`…`/`требуется извлечение` → empty. 35/10 field counts and dedup unchanged. JSON valid.
- **Workflow 06 BUILT (DEC-064):** `n8n/workflows/06_approved_candidates_runner.json` (active=false). Reads `url_candidates` → filters `approved AND unique AND not_in_registry AND non-empty URL` (aggregators need `aggregator_approved` note) → prioritizes `direct_competitor` → confidence → rank → **hard cap 5/run** → emits WF04-shaped batch + Execution Summary + ready-to-paste `Set URL List` block. **v0.1 = manual hand-off** (no subworkflow call into WF04); disabled `Mark Candidates Processed` node flips `approval_status=processed`. No Apify/Firecrawl/Claude/Telegram. Guide: `docs/N8N_WORKFLOW_06_APPROVED_CANDIDATES_RUNNER_RU.md`.

**Operator next steps:**
1. [ ] Re-import the patched **Workflow 04** (active stays false); rebind credentials + real Spreadsheet ID. *(Optional)* retest `carcapital.ru/` → expect a clean (empty or exact) `contact_public`.
2. [ ] **Import Workflow 06** (active=false). Rebind the **Google Sheets** credential on both nodes (`Read url_candidates` + the disabled `Mark Candidates Processed`); paste the real Spreadsheet ID. No Apify/Firecrawl/Claude creds needed.
3. [ ] **Approve one candidate:** in `url_candidates` set `approval_status=approved` (+ `approved_by`/`approved_at`) on one `direct_competitor` row (`dedup_status=unique`, `registry_status=not_in_registry`).
4. [ ] **Run Workflow 06** once. In `Build Execution Summary & Handoff`: confirm `selected_count=1`, the URL in `selected_urls`, and the `Set URL List` block.
5. [ ] **Confirm candidate status update + monitor_queue output:** copy the ≤5 URLs into Workflow 04 → run it → expect `monitor_queue`. Then either enable the disabled `Mark Candidates Processed` node and re-run WF06, or set `approval_status=processed` manually. (Auto-call of WF04 from WF06 is deferred — v0.1 is manual hand-off.)

> Still deferred: Telegram bot (Stage 2.3), automated search fallbacks (SerpAPI/Google CSE), Firecrawl `/v2/search` (parked), lead-source connectors.

#### Step J — Workflow 06 registry-recheck patch (DEC-065) → RETEST ← NEXT (2026-06-07)

**Done this session:** patched `06_approved_candidates_runner.json` (active=false) so it **re-reads `url_registry` at runtime** and re-normalizes `candidate_url` (same rules as WF04/05) before selecting. Editable `dedup_status`/`registry_status` in `url_candidates` are now **advisory only** — a URL already in `url_registry` is skipped as `registry_recheck_duplicate`, even if the operator manually marked it `unique`/`not_in_registry`. Added `Read url_registry` node; relaxed the aggregator hard-block to a per-item `warning`; renamed `over_max_5_limit` → `over_limit`. JSON valid; no Apify/Firecrawl/Claude node. Guide/DECISIONS/TABLE_SCHEMA/COSTS/CAPABILITIES/ROADMAP updated.

**Operator next steps (in order):**
1. [ ] **Re-import the patched Workflow 06** (active stays false). Rebind the **Google Sheets** credential on all three nodes (`Read url_candidates`, `Read url_registry`, disabled `Mark Candidates Processed`) and paste the real **Spreadsheet ID**. No Apify/Firecrawl/Claude creds.
2. [ ] **Test with the approved old duplicate:** keep `https://www.autolombard-moskva.ru/pledge-pts/` marked `approval_status=approved` (+ `dedup_status=unique`/`registry_status=not_in_registry`). Run WF06 → expect it **skipped** with `reason_category=registry_recheck_duplicate`, **not** selected.
3. [ ] **Run Workflow 05 with a new query** to discover fresh candidates (0 Firecrawl/Claude).
4. [ ] **Approve one new `direct_competitor`** whose normalized URL is **not** in `url_registry` (`approval_status=approved` + `approved_by`/`approved_at`).
5. [ ] **Test Workflow 06 selection:** run WF06 → expect the new competitor in `selected[]`/`selected_urls`; the old duplicate still in `skipped[]` (`registry_recheck_duplicate`).
6. [ ] **Then manually run Workflow 04** with the selected ≤5 URLs → expect `monitor_queue` + a new `url_registry` row. After confirming, set `approval_status=processed` (manual or via the disabled node).

> Stage 2.2c (Workflow 06) **remains under test** until the registry recheck is validated.
> Still deferred: Telegram bot (Stage 2.3), automated search fallbacks (SerpAPI/Google CSE), Firecrawl `/v2/search` (parked), lead-source connectors.

#### Step E (legacy plan) — Workflow 03: Firecrawl Website Analysis _(superseded by the active Step E above)_

**Goal:** Take a real competitor URL, extract clean text via Firecrawl, pass to Claude v2, verify full chain.

- [x] Superseded by `03_firecrawl_single_url_resilient.json` (single-URL resilient build, DEC-039).
- [ ] After first run: measure actual cost per Firecrawl + Claude call; update `docs/COSTS_AND_LIMITS.md`

#### Workflow 03 — Firecrawl Website Analysis _(after uncle consultation)_

**Goal:** Take a real competitor URL, extract clean text via Firecrawl, pass to Claude for analysis, verify full chain with real scraped data.

**Pre-steps:**
- [ ] Get Firecrawl API key → create n8n credential: HTTP Header Auth, `Authorization: Bearer <token>`, name `Firecrawl - Marketing Scout`
- [ ] Check Firecrawl free tier limits and note them in `docs/COSTS_AND_LIMITS.md`
- [ ] Choose one real competitor URL to test (publicly visible page)

**Workflow tasks:**
- [ ] Guide: `docs/N8N_WORKFLOW_03_FIRECRAWL_RU.md`
- [ ] JSON: `n8n/workflows/03_firecrawl_website_analysis.json`
- [ ] Nodes: Manual Trigger → Set URL → Firecrawl HTTP Request → Extract text → Build Claude Request → Claude API → Parse Response → Quality Gate → Google Sheets

**Cost note:** each Firecrawl + Claude call will cost scraping credit + ~$0.01–0.03 AI scoring depending on page length.

#### Workflow 10 — Full Pipeline _(after credentials are set up)_

- [ ] Build workflow per `modules/marketing-scout-v0/WORKFLOW_DESIGN.md` (10 nodes)
- [ ] For first test: skip Nodes 3a–3c, inject test data via a Set node before Split Out
- [ ] Configure Claude API node with system prompt from `modules/marketing-scout-v0/SYSTEM_PROMPT.md`
- [ ] Set quality threshold to 1 for testing (passes all items through)

### Step 7 — Test with Sample Data

- [ ] Inject 3 test items from `modules/marketing-scout-v0/TEST_DATA.md` via Set node
- [ ] Run pipeline end-to-end
- [ ] Verify Google Sheets rows appear with correct column mapping
- [ ] Verify Telegram summary delivered with correct counts
- [ ] Check that skipped/boilerplate items return quality_score: 1

### Step 8 — First Real Run with Apify

- [ ] Re-enable Nodes 3a–3c (real Apify scrape)
- [ ] Choose real target: competitor site or Avito keyword
- [ ] Set quality threshold back to 6
- [ ] Run pipeline end-to-end
- [ ] Review results, adjust scoring thresholds if needed

---

## Blocked On

Not technically blocked. Deliberately paused on paid scraping (DEC-021).

**Next actions (in order):**
1. ~~Step A — consult uncle~~ ✓ Done — `docs/BUSINESS_REQUIREMENTS.md`
2. ~~Step C — write Prompt v2~~ ✓ Done — `MARKETING_AGENT_PROMPT_V2.md`
3. ~~Extended tests 8–12 run~~ ✓ Done — Tests 1 and 8 passed; Tests 9–12 failed with output-contract errors
4. ~~Step D0 — Project cleanup phase 1~~ ✓ Done — 2 experiment workflow JSONs deleted; ghost files absent
5. **Step D — Implement Resilient Output Layer** ← CURRENT (design spec: `docs/WORKFLOW_02_RESILIENT_OUTPUT_LAYER.md`, DEC-033)
   — Phase 1: operator creates 6 Sheets tabs; Phase 2: TEST HARNESS JSON built ✓; Phase 3: operator runs Tests A–E (NEXT); Phase 4: production migration
6. Step B — remaining minor doc fixes (`README.md`, `tools/TOOLS.md`, `core/warm/decisions.md`)
7. ~~Step E — Firecrawl Single URL Test~~ ✅ PASSED (2026-06-08; DEC-045) — two competitor URLs → `monitor_queue`. Firecrawl single-URL ingestion approved (manual).
8. **Step F — Workflow 04: Firecrawl URL List mini-batch** ✅ BUILT ← ACTIVE. Operator imports `04_firecrawl_url_list_resilient.json`, rebinds creds, runs **3 URLs**, verifies routes + dedup-on-rerun, records cost; then max 5. Dedup by `source_url` implemented (DEC-049); 35-col schema (DEC-048).
