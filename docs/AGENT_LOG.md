# AGENT_LOG.md — Session Log

One entry per session that produces tangible output.
Most recent first.

---

## 2026-06-08 — Stage 3.2 FINALIZED: MSK timestamps + LLM enrichment hardening + test matrix + Stage 3.3 source decision (DEC-083/084)

**Agent role:** project-engineer
**Session goal:** finalize Stage 3.2 — switch operational timestamps to Moscow time, harden the optional LLM-enrichment path and add a 4-record test config, complete the 3-test matrix + Test 4 template, and document the Stage 3.3 first-source decision (no connector built).

**Part A — Moscow-time timestamps (Workflows 04/05/06/07/08):** added `moscowIsoNow()` (→ `+03:00`) and `moscowStamp()` (compact Moscow `YYYYMMDD_HHmmss`) helpers and replaced every workflow-generated `new Date().toISOString()` / local stamp for `created_at`, `parsed_at`, `generated_at`, `first_seen_at`, `last_seen_at`, and `run_id` stamps (`touchpoint_/firecrawl_/approved_run_/disc_/agentreq_/rec_/cand_`). **`published_at` (source-provided) untouched; no Sheets rows rewritten; no schema change.** Verified: 0 bare `new Date().toISOString()` remain; helper produces `2026-06-08T18:55:43.425Z → 2026-06-08T21:55:43.425+03:00` exactly.

**Part B — Workflow 08 LLM enrichment hardening (optional mode):** default stays `deterministic_first` / `llm_enrichment=false`. Primary prompt now: use only `original_record` + `deterministic_classification`; cannot browse/fetch/verify URLs; no narration; one strict JSON object (first `{` last `}`); no markdown/prose/thinking/comments; scores 1–100; **never `market_signal` → `content_idea`**; **if uncertain, preserve deterministic route/action, enrich only reason**. Primary user message now carries `deterministic_classification`. Repair already builds from `original_record` + `deterministic_classification`. **Normalize safety floor:** entity set {lead_signal,competitor,content_idea,irrelevant}; `market_signal`→`content_idea`; route/action validated; scores clamp 1–100 (1–10 → ×10) with deterministic floor; **no `contact`/`results` without usable `contact_public`; irrelevant stays `skipped_log`; deterministic `competitor` cannot be downgraded to `irrelevant`; hot/question without contact stays `review_queue`.**

**Part C — LLM enrichment test config:** `Set Analyzer Config` adds `llm_enrichment_test_mode=false` + `llm_test_batch_indexes=[1,7,11,12]`; `Prepare Record` gate sends Claude **only** to those four fixtures when the flag is on (verified by simulation: batches 1,7,11,12 → call_claude=true, all others false; irrelevant excluded). Deterministic default still 0 Claude calls.

**Part D — Test matrix (`STAGE_3_2_TEST_RESULTS.md`):** Test 1 PARTIAL FAIL; Test 2 ROUTING PASS / LLM-stability FAIL / cost FAIL ($0.159/12); **Test 3 PASS — deterministic_first baseline APPROVED** (routes 6/3/1/2, `deterministic_pre_route=10`, `deterministic_irrelevant_skip=2`, Claude calls=0, repair_used=false, technical_errors=0); **Test 4 template** — 4-record enrichment retest (1,7,11,12) with targets technical_errors=0 / primary_json≥2/4 / repaired_json≤2/4 / det_fallback≤2/4 / routes unchanged / no contact without contact_public / record cost.

**Part E — `docs/STAGE_3_3_SOURCE_DECISION_PLAN.md` created (no connector built):** recommends **Avito/Classifieds Listing Connector** first (lowest complexity, matches web/URL data model, strong for competitors/offers/semantics; caveat — not audience/comment mining); Telegram public parsing (≠ Control Bot) second/separate feasibility; Instagram deferred; Dzen/VK follow. **DEC-084.**

**Validation (Part G):** all five workflows `python3 -m json.tool` VALID (`/tmp/04|05|06|07|08_validated.json`); every code node compiles (`new Function`); `active=false` preserved on all; no real API keys / no real Spreadsheet ID (PASTE placeholders); no schema change; no source connector created; no Apify/Firecrawl call; no tool_use / no KEY=VALUE; WF08 default remains `deterministic_first`; LLM gate present; MSK helper applied (moscowIsoNow refs: 04=13, 05=6, 06=4, 07=6, 08=8).

**Docs updated:** five workflow RU guides, `STAGE_3_2_TOUCHPOINT_ANALYZER_PLAN.md`, `STAGE_3_2_TEST_RESULTS.md`, new `STAGE_3_3_SOURCE_DECISION_PLAN.md`, `LEAD_DISCOVERY_ARCHITECTURE.md`, `LEAD_DATA_MODEL_PLAN.md`, `SOCIAL_CLASSIFIED_SOURCE_MATRIX.md`, `DECISIONS.md` (DEC-083/084), `NEXT_ACTIONS.md`, `COSTS_AND_LIMITS.md`, `AGENT_CAPABILITIES.md`, `ROADMAP.md`, `core/hot/recent.md`.

**Next operator action:** (A) timestamp smoke test on any workflow → confirm `+03:00` rows; (B) WF08 deterministic baseline sanity (Claude=0/$0); (C) optional WF08 4-record enrichment test via `llm_enrichment_test_mode=true` → fill Test 4. Then review Stage 3.3 plan (Avito first). No connector built; no scraping.

---

## 2026-06-08 — Stage 3.2 PATCHED v3: Workflow 08 deterministic-first + optional LLM enrichment (DEC-082)

**Agent role:** project-engineer
**Session goal:** Patch Workflow 08 for cost efficiency + primary stability after the second live test showed routing PASS but `primary_json=0` and ≈$0.159 Claude spend for 12 records. Make the analyzer deterministic-first; Claude becomes optional enrichment, OFF by default.

**Root cause:** the gateway returns prose/extended-thinking/signature for essentially every primary call (e.g. "Fetching the Dzen channel…", "Проверяю Avito-объявление…"), so `primary_json=0`, `repaired_json=2`, `deterministic_fallback_after_llm_fail=8`, `deterministic_irrelevant_skip=2`. v2 still **paid Claude on every non-irrelevant record** while the deterministic floor produced the routing → cost-efficiency + LLM-stability FAIL.

**Patch (v3, `08_touchpoint_analyzer.json`, JSON valid, `active=false`):**
- **`Set Analyzer Config`**: `analysis_mode='deterministic_first'`, `llm_enrichment=false`, `max_records=12`, `test_mode=true` (future: `analysis_mode='llm_enriched'` + `llm_enrichment=true`).
- **`Prepare Record`**: deterministic `det` with the exact DEC-082 scores/routes + `deterministic_needs_llm` flag + LLM gate `call_claude = (NOT irrelevant) AND (llm_enrichment=true OR deterministic_needs_llm=true)`.
- **`IF Irrelevant?` → `IF Call Claude?`**; false branch → **`Build Deterministic Row`** (renamed from Build Skip Row): irrelevant → `deterministic_irrelevant_skip`/`skipped_log`, obvious records → `deterministic_pre_route` with the `det` route (no Claude, $0). true branch → Claude primary → repair → deterministic fallback (unchanged). `technical_errors` still only for no-valid-route/Sheets-API failure.
- **Prompt hardening (future llm_enriched):** primary states it cannot browse/fetch URLs and must not narrate ("fetching/checking/analyzing"), one JSON object first `{` last `}`; repair builds JSON from `original_record` + `deterministic_classification`.
- **`Normalize + Route`:** `market_signal`→`content_idea`; scores scaled to 1–100 (1–10 → ×10) with a deterministic floor; `raw_response_preview` cap 500, thinking/signature-only → `non_json_non_text_or_thinking_response`. `Final Summary Output` now reports `analysis_mode`/`llm_enrichment` + `deterministic_pre_route`/`deterministic_irrelevant_skip` counts.
- **Verified (Task H):** `python3 -m json.tool` VALID → `/tmp/08_touchpoint_analyzer_validated.json`; `active=false`; no real keys; no real Spreadsheet ID; no Apify/Firecrawl/external source APIs (disclaimer text only; gated aiprimetech Claude HTTP ×2); no tool_use/KEY=VALUE; dynamic route sheet preserved; 35 business fields on every output path; `deterministic_pre_route` + `deterministic_irrelevant_skip` + LLM gate + `technical_errors` fallback all present. Workflows 04/05/06/07 untouched.
- **Expected deterministic_first retest:** `technical_errors=0`, Claude calls=0 (cost delta $0), `repair_used=false` ×12, `deterministic_pre_route=10`, `deterministic_irrelevant_skip=2`; 6 monitor_queue / 3 content_queue / 2 skipped_log / 1 review_queue.

**Docs updated:** `STAGE_3_2_TEST_RESULTS.md` (TEST 2 actual ROUTING PASS/LLM FAIL/COST FAIL + $0.159 + v3 patch + TEST 3 plan), `N8N_WORKFLOW_08_TOUCHPOINT_ANALYZER_RU.md`, `STAGE_3_2_TOUCHPOINT_ANALYZER_PLAN.md`, `LEAD_DISCOVERY_ARCHITECTURE.md`, `LEAD_DATA_MODEL_PLAN.md`, `DECISIONS.md` (**DEC-082**), `NEXT_ACTIONS.md`, `COSTS_AND_LIMITS.md`, `AGENT_CAPABILITIES.md`, `ROADMAP.md`, `core/hot/recent.md`.

**Next operator action:** re-import patched WF08 (deterministic_first default) → bind creds + Spreadsheet ID → record Claude balance → run once → fill `STAGE_3_2_TEST_RESULTS.md` TEST 3 (expect Claude calls=0, $0, technical_errors=0) → optionally enable llm_enriched later → then Stage 3.3. No source parser yet.

---

## 2026-06-08 — Stage 3.2 PATCHED v2: Workflow 08 deterministic fallback after failed live test (DEC-081)

**Agent role:** project-engineer
**Session goal:** Patch Workflow 08 after its first live test partially failed — make routing resilient to the gateway returning prose/thinking instead of JSON, so classifiable records stop landing in `technical_errors`.

**Root cause:** the gateway frequently returns extended-thinking/prose/signature content (often **no `text` item**), so primary+repair both failed and classifiable records (2,3,4,5,7,11,12) dropped to `technical_errors`; the forum positive-control (record 11) wrongly hit `technical_errors` instead of `review_queue`.

**Patch (v2, `08_touchpoint_analyzer.json`, still 20 nodes, JSON valid, `active=false`):**
- **`Prepare Record`** now computes a **deterministic classification `det`** for every record from the intake hints (record_type_hint, touchpoint_type, competitor_related, lead_temperature/intent/urgency, service_hint, competitor_name, contact_public, source_url/profile_name) — rules per DEC-081.
- **`Parse Repaired JSON`** now falls back to a `det`-based 35-field routed row (`parse_method=deterministic_fallback_after_llm_fail`, `repair_status=failed_fallback`) instead of `technical_errors`. `technical_errors` only when `det` has no valid route (or Sheets/API error).
- **Prompt hardening:** primary + repair demand strict JSON only ("Return exactly one JSON object. First char `{`, last `}`"); repair builds JSON from `original_record` when no usable JSON.
- **Parser hardening:** `joinText()` concatenates **all** `text` content items and ignores thinking/signature; preserves raw preview + original record on failure.
- New parse_method values: `deterministic_fallback_after_llm_fail` (+ documented `deterministic_pre_route`); repair_status `failed_fallback`. Final Summary adds `parse_method_counts` + `deterministic_fallback_after_llm_fail` count.
- Preserved: deterministic irrelevant skip (pre-Claude, $0), dynamic route append, **35-field output on all 3 paths**, primary→repair structure, Claude creds/url.
- **Verified:** JSON VALID; `active=false`; 0 real keys; 3× `PASTE_SPREADSHEET_ID_HERE` (2 GS nodes + sticky); apify/firecrawl only in sticky docs; 2 Claude HTTP; dynamic route append; deterministic_irrelevant_skip + deterministic_fallback_after_llm_fail + technical_errors all present; no tool_use/KEY=VALUE. **Logic dry-run on the 12 fixtures → 0 technical_errors**; record 11 → review_queue/lead_signal/investigate/score 75; 1–4,6,12→monitor_queue; 5,7,8→content_queue; 9–10→skipped_log. Workflows 04/05/06/07 untouched.

**Docs updated:** `STAGE_3_2_TEST_RESULTS.md` (TEST 1 PARTIAL FAIL + patch dry-run + TEST 2 retest plan), `N8N_WORKFLOW_08_TOUCHPOINT_ANALYZER_RU.md`, `STAGE_3_2_TOUCHPOINT_ANALYZER_PLAN.md`, `LEAD_DISCOVERY_ARCHITECTURE.md`, `LEAD_DATA_MODEL_PLAN.md`, `DECISIONS.md` (**DEC-081**), `NEXT_ACTIONS.md`, `COSTS_AND_LIMITS.md`, `AGENT_CAPABILITIES.md`, `ROADMAP.md`, `core/hot/recent.md`.

**Next operator action:** re-import patched WF08 → bind creds + Spreadsheet ID → record Claude balance → run once → fill `STAGE_3_2_TEST_RESULTS.md` TEST 2 (expect technical_errors=0; record 11→review_queue) → then Stage 3.3. No source parser yet.

---

## 2026-06-08 — Stage 3.2 BUILT: Workflow 08 Touchpoint Analyzer (DEC-080)

**Agent role:** project-engineer
**Session goal:** Build the source-agnostic Touchpoint Analyzer — read `raw_market_records`, analyze via Claude with the Stage 2 resilient JSON/repair pattern, route into the 6 business tabs (35 cols). Reuse, not redesign.

**Built:** `n8n/workflows/08_touchpoint_analyzer.json` — `08 - Touchpoint Analyzer`, `active=false`, **20 nodes**, JSON valid (`json.tool` PASS).
- Flow: Manual Start → Set Analyzer Config (test_mode=true, max_records=12, analyze_statuses=[approved,new], production_statuses=[approved] documented) → Read raw_market_records → Filter & Select (dedup_status=unique + approval_status allowed; test_mode includes irrelevant) → Loop Over Items (splitInBatches/1) → Prepare Record → **IF Irrelevant?** {true → Build Skip Row (deterministic skipped_log, **no Claude, $0**)} {false → Build Primary Claude Request → Claude Primary → Parse Primary JSON → **IF Primary Parse OK?** {true → Normalize+Route} {false → Build Repair Request → Claude Repair → Parse Repaired JSON (→ technical_errors fallback) → Normalize+Route}} → Append to Dynamic Route Sheet (`Sheet Name={{ $json.route }}`) → loop back; done branch → Final Summary Output.
- **Reused Stage 2 resilient pattern** verbatim (balanced-brace JSON extract, fence-strip, quote-normalize; `parse_method`/`repair_used`/`repair_status`/`processing_status`/`raw_response_preview`; route validation; `technical_errors` fallback). Claude HTTP nodes = same as Stage 2 (`https://aiprimetech.io/v1/messages`, header `anthropic-version`, credential `Claude API - Marketing Scout`); primary max_tokens=1200/temp=0.2, repair max_tokens=700/temp=0.
- **Touchpoint→35-schema mapping** (no header/sheet changes): hot_lead/warm→lead_signal; competitor_activity/audience→competitor→monitor_queue; pain/question/semantic/ad/content→content_idea(or market_signal)→content_queue; irrelevant→skipped_log. recommended_action (+add_to_semantics) drives route. **Encoded safeguard:** contact→results needs lead_signal+score≥70+usable contact (forum record 11 → review_queue, not auto-contact).
- **Verified:** JSON VALID; `active=false`; node types = manualTrigger/code(10)/googleSheets(2)/splitInBatches/if(2)/httpRequest(2)/stickyNote(2); 0 real key patterns; 3× `PASTE_SPREADSHEET_ID_HERE` (2 GS nodes + 1 sticky-note mention); apify/firecrawl only in sticky-note docs; 2 Claude HTTP urls; dynamic route append present; **35 business fields on all 3 output blocks** (Build Skip Row + both Normalize+Route returns); repair layer + technical_errors fallback present; no tool_use; no KEY=VALUE. Workflows 04/05/06/07 untouched.

**Docs created:** `docs/N8N_WORKFLOW_08_TOUCHPOINT_ANALYZER_RU.md`, `docs/STAGE_3_2_TOUCHPOINT_ANALYZER_PLAN.md`, `docs/STAGE_3_2_TEST_RESULTS.md` (empty template).
**Docs updated:** `LEAD_DISCOVERY_ARCHITECTURE.md`, `LEAD_DATA_MODEL_PLAN.md`, `TABLE_SCHEMA.md`, `DECISIONS.md` (**DEC-080**), `NEXT_ACTIONS.md`, `COSTS_AND_LIMITS.md`, `AGENT_CAPABILITIES.md`, `ROADMAP.md`, `core/hot/recent.md`.

**Next operator action:** import WF08 (don't activate) → bind Claude + Sheets credentials + Spreadsheet ID → record Claude balance → run once on the 12 WF07 records → verify routing (1→monitor_queue, 9–10→skipped_log $0, 11→review_queue) + fill `STAGE_3_2_TEST_RESULTS.md` → then Stage 3.3 scoring hardening. No source parser yet.

---

## 2026-06-08 — Stage 3.1 BUILT: Workflow 07 Manual Touchpoint Intake (DEC-079)

**Agent role:** project-engineer
**Session goal:** Build the first safe Stage 3 intake workflow — normalize manually-provided mixed-source examples into the operator-created agent sheets. **No LLM, no scraping, no external API.**

**Built:** `n8n/workflows/07_manual_touchpoint_intake.json` — `07 - Manual Touchpoint Intake`, `active=false`, **14 nodes**, JSON valid (`python3 -m json.tool` PASS).
- Flow: Manual Start → Set Manual Intake Request → Read market_record_registry → Set Manual Records (12 fixed examples) → Normalize Manual Records → Dedup Against Registry → Append raw_market_records (all 12, audit) → {Build Registry Rows → Append market_record_registry (unique only)} + {Build agent_requests Row → Append agent_requests → Final Summary Output}.
- **Deterministic normalization (no LLM):** `record_id`, composite non-URL `dedup_key` (post→source→profile+text_hash→text; never domain), `text_hash`, `region_hint`, `urgency_hint`, `lead_intent_hint`, `confidence_score` (80 competitor+url / 70 question/market / 40 source_candidate / 1 irrelevant), `lead_temperature`, `next_action`, `approval_status=new`, `estimated_analysis_cost_usd` (0.02 / 0). Record 11 (forum «отказали/просрочки/нужен кредит») = hot-lead positive control.
- **Writes exactly:** `raw_market_records` 40 fields (all 12 incl. duplicates+irrelevant = audit trail), `market_record_registry` 15 fields (unique only), `agent_requests` 21 fields (`status=needs_review`). **Does NOT write `agent_memory`.**
- **Verified:** JSON VALID; `active=false`; node types only manualTrigger/code/googleSheets/stickyNote (no Apify/Firecrawl/Claude/httpRequest nodes — the only apify/claude mentions are sticky-note docs); 0 real key patterns; 5× `PASTE_SPREADSHEET_ID_HERE`; field lists exact (raw=40, registry=15, agent_requests=21); no tool_use; no KEY=VALUE.

**Docs created:** `docs/N8N_WORKFLOW_07_MANUAL_TOUCHPOINT_INTAKE_RU.md` (setup/headers/import/test), `docs/STAGE_3_1_MANUAL_TOUCHPOINT_INTAKE_PLAN.md` (why manual intake before parsers).
**Docs updated:** `LEAD_DATA_MODEL_PLAN.md`, `LEAD_DISCOVERY_ARCHITECTURE.md` (Manual Intake = first source), `TABLE_SCHEMA.md` (4 tabs CREATED), `DECISIONS.md` (**DEC-079**), `NEXT_ACTIONS.md`, `COSTS_AND_LIMITS.md` (intake cost=0), `AGENT_CAPABILITIES.md` (under test), `ROADMAP.md`, `core/hot/recent.md`.

**Next operator action:** confirm headers → import Workflow 07 → bind credential + Spreadsheet ID → run once → verify (raw +12, registry +12 unique, agent_requests +1, irrelevant_count=2, record-11 hot) → optional re-run for dedup idempotency → then build the Stage 3.2 Touchpoint Analyzer. No source parser yet.

---

## 2026-06-08 — Product Reframe: Business Scout Agent (AI employee) + Stage 3 = Touchpoint Discovery (DEC-078)

**Agent role:** project-engineer / product-architect
**Session goal:** Capture the stakeholder interview and reframe the architecture from "Marketing Scout Bot" to the broader **Business Scout Agent** (tools + memory + analysis), with Marketing Scout as the first domain and Stage 3 reframed as Social/Classified Touchpoint Discovery. **Docs only — no build, no workflow JSON, no external calls, no credentials, no Sheets created.**

**Created (5 new docs):**
- `STAKEHOLDER_INTERVIEW_2026_06_08.md` — raw structured notes (Avito, Dzen, comments, brokers, Moscow, subscribers, competitors, semantics, ads, USP, outreach, calls, "agent as employee") + interpreted needs, product implications, risks/constraints, open questions.
- `BUSINESS_SCOUT_AGENT_VISION.md` — product vision; 5 layers (Control/Conversation, Tool/Automation, Data, Memory, Analysis).
- `MARKETING_AGENT_PRODUCT_VISION.md` — Marketing Scout as the first domain of the broader agent.
- `AGENT_TOOL_ARCHITECTURE.md` — 9 internal tools (web_competitor_discovery [built] + touchpoint discovery, competitor_audience_mining, comment_mining, semantic_ads_analysis, usp_positioning, outreach_draft [no send], report_summary, next_action_recommender); n8n workflows+prompts+schemas, not separate LLM agents at first.
- `AGENT_MEMORY_PLAN.md` — project-owned structured memory (9 memory types) + proposed `agent_memory` sheet + privacy/compliance rules.

**Updated:**
- `TABLE_SCHEMA.md` — section renamed "Proposed — Business Scout Agent Layer"; **`agent_requests`** (21 cols, `request_type`) generalizes/supersedes `lead_discovery_requests` (one request table, no duplicates); **`raw_market_records` expanded** (40 cols: `comment_text`, `contact_channel`, `touchpoint_type`, `interest_topic`, `probable_need`, `competitor_related/name`, `semantic_keywords`, `ad_channel_hint`, `lead_temperature`, `next_action`, `responsible`, `manager_note`, 12 record classes); `market_record_registry` FK → `agent_request_id`; added **`agent_memory`** (13 cols). All **PROPOSED, not created**.
- `STAGE_3_LEAD_SOURCE_EVALUATION.md` — touchpoint reframe (12 classes + examples) + §5a source matrix through touchpoint/agent lens (adds Yandex Dzen + competitor pages/commenters); weighted table relabeled hot-lead lens.
- `LEAD_DISCOVERY_ARCHITECTURE.md` — touchpoint reframe banner; analyzer = 12 classes + `lead_temperature`/`next_action`; `agent_requests`.
- `LEAD_SOURCE_CONNECTORS_PLAN.md` — reframe banner + new Yandex Dzen (5b) and Competitor Audience Mining (5c, public-only) connector sections.
- `SOCIAL_CLASSIFIED_SOURCE_MATRIX.md` — reframe banner + Dzen (5b) + competitor pages/commenters (5c) entries.
- `LEAD_DATA_MODEL_PLAN.md` — reframe pointer (agent_requests supersession; TABLE_SCHEMA authoritative).
- `DECISIONS.md` — **DEC-078** (reframe + touchpoint discovery + agent_requests + agent_memory + outreach deferred + control≠parser).
- `NEXT_ACTIONS.md` — current priority = choose Stage 3.1 path (A/B/C); recommended A+C.
- `COSTS_AND_LIMITS.md` — three cost axes (source-acquisition / analysis / outreach-deferred).
- `AGENT_CAPABILITIES.md` — Business Scout Agent planned/not-approved.
- `ROADMAP.md` — Stage 3 (3.0–3.5 touchpoint), Stage 4 Control Agent Interface (not slash commands), Stage 5 Reporting/Export, Stage 6 Advanced Business Automations (incl. auto-handoff, scheduling, market_profile, CRM, outreach after compliance).
- `core/hot/recent.md` — session entry.

**Verified:** no workflow JSON touched; no external calls; all new sheets PROPOSED; outreach/autocall/parsers explicitly not approved.
**Next operator action:** choose Stage 3.1 path (recommended A+C: document tool map [done], await uncle's full agent list, build Manual Records Intake first). Build no parser yet.

---

## 2026-06-08 — Stage 3.0 Lead Source Evaluation WRITTEN (evaluation only, nothing built — DEC-077)

**Agent role:** project-engineer
**Session goal:** Produce Stage 3.0 — Lead Source Evaluation and the Social/Classified Lead Discovery architecture/data-model design. **Docs only — no build, no workflow JSON, no external API call, no credentials, no Sheets created.**

**Created (3 new docs):**
- `docs/STAGE_3_LEAD_SOURCE_EVALUATION.md` — main evaluation: purpose; why Stage 3 is leads not competitor sites; why social/classified records differ from URL candidates; evaluation criteria; source-by-source (Avito, Telegram, VK, Instagram, Yandex/Search, Manual Intake); **weighted scoring table** (lead_intent/contactability/access/cost/risk[5=low]/implementation[5=easy]/total): Manual 27 > Avito 20 > Yandex 18 > VK 17 > Telegram 16 > Instagram 13; recommended path; no-build gate.
- `docs/LEAD_DATA_MODEL_PLAN.md` — data model for the 3 proposed sheets; justifies `raw_market_records` over `lead_candidates`; full `dedup_key` strategy (post_url → source_url+profile_url+published_at hash → platform+author/profile+text_hash; never domain); why URL-only registry is insufficient.
- `docs/SOCIAL_CLASSIFIED_SOURCE_MATRIX.md` — per-source matrix (use case, data, fields, connector approach, candidate APIs/actors to evaluate later, credentials, risks, MVP test, go/no-go). No source approved.

**Updated:**
- `LEAD_DISCOVERY_ARCHITECTURE.md` — added routing table (incl. `content_queue`) + the 5 lead scores to harden in 3.3 + Stage 3.0 pointer.
- `LEAD_SOURCE_CONNECTORS_PLAN.md` — Stage 3.0–3.4 sequencing table + source-specific notes.
- `TABLE_SCHEMA.md` — `lead_discovery_requests` now has `estimated_source_cost_usd` + `estimated_analysis_cost_usd` (18 cols); `market_record_registry` added `author_handle` + `text_hash` (15 cols); `dedup_key` strategy spelled out. Still **PROPOSED, not created**.
- `DECISIONS.md` — **DEC-077** (Stage 3.0 outcome: Manual Intake first, Avito first real connector, source-agnostic layer, parser≠control-bot, `raw_market_records` name) consolidating DEC-067/068/069/076.
- `NEXT_ACTIONS.md` — current priority = Stage 3.0 review + first-source decision (Option A Manual Intake / Option B Avito eval).
- `COSTS_AND_LIMITS.md` — source-collection cost vs Claude analysis cost tracked separately; Manual = 0 source cost; measure with small batches.
- `AGENT_CAPABILITIES.md` — Stage 3.0 written; Stage 3 explicit not-approved list.
- `ROADMAP.md` — Stage 3.0 (written) / 3.1 Data Model + Manual Intake / 3.2 First Connector / 3.3 Analyzer Hardening / 3.4 E2E; Stage 4 Bot / 5 Reporting / 6 Advanced.
- `core/hot/recent.md` — session entry.

**Verified:** no workflow JSON touched; no external calls; placeholders only; lead sheets remain PROPOSED.
**Next operator action:** review `STAGE_3_LEAD_SOURCE_EVALUATION.md`; decide whether to create the proposed sheets; choose first safe test (Manual Intake recommended, or Avito evaluation). Build nothing until approved.

---

## 2026-06-08 — Stage 2 FINALIZED (approved w/ limitations) + Auto-Handoff Evaluated & Deferred (DEC-073/074/075/076)

**Agent role:** project-engineer
**Session goal:** Finalize Stage 2, record real test results, evaluate safe auto-handoff (06→04), and set up Stage 3.0. **Docs/finalization only — no workflow logic changed.**

**Part A — final test results** (`docs/STAGE_2_FINAL_TEST_RESULTS.md`, new): recorded inputs/expected/actual/pass-fail/notes for Tests 1–6.
- T1 WF05 discovery ✅ PASS (9 candidates, classification, domain extraction, registry dedup, 0 spend).
- T4 WF06 runtime registry recheck ✅ PASS (re-approved processed URLs → `selected_count=0`, `skipped_count=18`: `registry_recheck_duplicate`/`already_processed`/`duplicate_status`/`approval_status_not_approved`).
- T5/T5b WF06 runner modes 🟡 implemented + **simulation-validated, not fully live-validated** (deep run respected registry recheck but selected 0 as all candidates already processed; fresh same-domain field test pending — watch item W1). Recorded honestly.
- T6 WF04 PTS override ✅ PASS (`autolombardn1.ru/` → `pts_loan`, `monitor_queue`, `repaired_json`); contact empty this run = acceptable (no reliable full contact). Contact blanking ✅; valid-contact preservation = watch item W2.
- Manual handoff ✅ PASS.

**Part B — auto-handoff evaluation** (`docs/WORKFLOW_06_AUTO_HANDOFF_PLAN.md`, new): inspected WF04 (25 nodes, branching/looped, **no `source_candidate_id` threading**, 35-field-locked output, no Execute Workflow Trigger) and WF06. Designed the safe path (WF04 callable Execute Workflow Trigger → existing analyzer; WF06 Execute Workflow node + confirm-then-mark; default stays manual). **DEFERRED to Stage 2.4** (DEC-075): non-trivial identity threading + the confirm-then-mark safety property cannot be live-tested here. Manual handoff remains approved.

**Part C — Stage 2 review finalized** (`docs/STAGE_2_WEB_PIPELINE_REVIEW.md` §10): **APPROVED WITH MINOR LIMITATIONS**; listed approved capabilities, manual limitations, watch items W1/W2.

**Part D — cleanup audit** (`docs/PROJECT_CLEANUP_AUDIT.md`): added Stage 2 section — KEEP (00/01/02-prod/03/04/05/06 + key docs); flagged the three `02_*` test/baseline variants as **archive candidates (move, not delete)**; **no deletions, no `git rm`**.

**Part E — Stage 3 planning:** affirmed **Stage 3.0 Lead Source Evaluation first, not the bot** (DEC-076; Avito first, Telegram second, parser ≠ control bot) in LEAD_DISCOVERY_ARCHITECTURE, LEAD_SOURCE_CONNECTORS_PLAN, ROADMAP (added Stage 2.4), NEXT_ACTIONS, AGENT_CAPABILITIES.

**Part F — decisions + docs:** DEC-073 (always re-check url_registry, reaffirmed), DEC-074 (Stage 2 approved w/ manual-handoff limitation; stays modular), DEC-075 (auto-handoff only if safe + no analyzer duplication; deferred), DEC-076 (Stage 3 starts with Lead Source Evaluation). Updated WF04/05/06 RU guides, URL_DISCOVERY_STRATEGY, WORKFLOW_04/05 plans, TABLE_SCHEMA, COSTS, AGENT_LOG, core/hot/recent.md.

**Verification:** all 3 workflows `python3 -m json.tool` VALID; active=false ×3; placeholders only; no schedule/tool_use/KEY=VALUE; WF04 35+10 fields; WF05 26+18; WF06 runner_mode + registry recheck + default domain diversity + deep mode all preserved; **manual handoff preserved (auto mode NOT implemented)**; no lead-connector or Telegram workflow created. `git status` clean before edits (prior work committed); this session adds docs only.

**Operator next steps:** commit the finalization (docs), optionally clear W1/W2 with live re-tests, then write/approve **Stage 3.0 Lead Source Evaluation**.

---

## 2026-06-07 — Stage 2 Final Hardening: WF06 Runner Modes + WF04 PTS/Contact + Review Doc (DEC-070/071/072)

**Agent role:** project-engineer
**Session goal:** Final Stage 2 hardening before approval — WF06 runner modes, WF04 service_type + contact hardening, WF05 quick review, and a technical review doc.

**Part A — Workflow 06 runner modes (DEC-072):**
- Added a **Set Runner Config** code node (Manual Start → Set Runner Config → Read url_candidates → Read url_registry → Select). `runner_mode` default = `first_pass_domain_diversity`.
- `first_pass_domain_diversity` (DEFAULT): max **1** selected URL per normalized domain/run; extra approved same-domain URLs → skipped `duplicate_domain_in_run` (reason: "Same domain already selected in this run; use deep_domain_analysis mode for multi-page domain analysis.").
- `deep_domain_analysis` (EXPLICIT): allow multiple URLs/domain, **cap 3/domain/run**; extras → `domain_deep_limit`; each selected item carries `warning="deep_domain_analysis mode: multiple URLs from same domain allowed intentionally."`
- Both modes keep: `max_per_run=5`, url_registry runtime recheck, exact normalized-URL dedup, `direct_competitor`→confidence→rank→root priority, manual handoff, no auto-call, no auto-mark-processed. **url_registry semantics unchanged (full URL, not domain).** Summary adds `runner_mode`, `domain_diversity`, `domain_selected_counts`.
- Simulated on the 4 E2E URLs: first_pass → 3 selected (1/domain) + 1 `duplicate_domain_in_run`; deep → 4 selected with deep warning. ✓

**Part B — Workflow 04 (DEC-070):**
- **Stronger PTS override (B3):** expanded strong-token set (added ЭПТС, займ под залог ПТС, автомобиль остаётся/машина остаётся, любая кредитная история). competitor + ≥3 distinct tokens ⇒ `pts_loan`, unless multi-product root or clearly real-estate-only.
- **Deterministic contact extraction (`extractContacts`/`bestContact(model,text,source_url)`):** keep valid full public contacts (RU phone 10–11 digits, email, `@handle`/`t.me`, `wa.me`, contact/profile/application URL ≠ source_url); blank partials (`+7 (495) ...`, `номер указан на сайте`, `телефон есть на сайте`, `требуется извлечение`). Prefer extracted over model partials. Fixed a bug where digits inside `wa.me/<digits>` were misread as a phone (phone/email/handle scan now runs on a URL-stripped copy). Applied to all 3 emitters.
- **Unchanged:** exactly **35** business fields (all 3 emitters) + **10** `url_registry` fields; dedup architecture. Unit-tested contacts + simulated PTS override. ✓

**Part C — Workflow 05 quick review (no patch):** confirmed no Firecrawl/Claude node (only Apify httpRequest to `api.apify.com/.../google-search-scraper`), `url_candidates`=26 fields, `discovery_requests`=18 fields, `candidate_type` + domain extraction + `duplicate_in_registry` present, no business-tab writes, active=false. No bug → no change.

**Part D — Review doc:** created `docs/STAGE_2_WEB_PIPELINE_REVIEW.md` (architecture, per-workflow roles, approved vs manual, why-not-monolith, runner modes, known limitations, **T1–T11 approval test matrix**, recommendation).

**Part E — docs:** DEC-070/071/072; updated WF04 + WF06 RU guides, URL_DISCOVERY_STRATEGY, WORKFLOW_04/05 plans, TABLE_SCHEMA (runner_mode is config not a column), NEXT_ACTIONS (T1–T11 + commit + Stage 3.0), COSTS (hardening cost-neutral), AGENT_CAPABILITIES, ROADMAP, AGENT_LOG, core/hot/recent.md.

**Verification:** all three `python3 -m json.tool` VALID; active=false ×3; placeholders only (no real keys/Spreadsheet ID); no schedule trigger; no tool_use / no KEY=VALUE; WF04 35+10 fields; WF05 26+18; WF06 runner_mode + registry recheck + default 1 URL/domain + deep mode multi/domain; manual handoff preserved.

**Not built / not approved:** Telegram Bot, lead-source connectors (Avito/Telegram/VK/Instagram/Yandex), auto-call of WF04, universal market_profile. No external API called; no real credentials/IDs; no workflow activated.

**Operator next steps:** re-import WF04/05/06 (active=false) → rebind creds + Spreadsheet ID → run T1–T11 (`STAGE_2_WEB_PIPELINE_REVIEW.md`) → commit Stage 2 → write/approve Stage 3.0 Lead Source Evaluation.

---

## 2026-06-07 — Web Pipeline E2E Passed; WF06 Domain Diversity + WF04 PTS/Contact Hardening; Lead Discovery Layer Designed (DEC-066/067/068/069)

**Agent role:** project-engineer
**Session goal:** Harden the current web workflows after a full manual E2E pass, and design (not build) the Lead Discovery Layer.

**Context — E2E (web competitor pipeline 05→06→04) PASSED.** Query «автоломбард Москва займ под ПТС без проверки кредитной истории»: WF05 found 4 direct competitors → WF06 read 18 candidates, selected 4, skipped 14 (`max_per_run=5`, `registry_recheck=enabled`, manual handoff) → WF04 processed all 4 → `monitor_queue`/competitor/`parsed_success`. Two issues: (a) WF06 selected **two URLs of the same domain** `autolombard-moskva.ru`; (b) WF04 left `service_type=generic_lending` on two clearly-PTS pages (`autolombardn1.ru`, `autolombard-moskva.ru/services/…`).

**Part A — workflow patches (DEC-066):**
- **WF06 domain diversity:** re-derive `domain` from `candidate_url` (hostname, lowercase, strip `www.`); **max 1 URL/domain/run** by default; second+ same-domain → `reason_category=duplicate_domain_in_run`; added **root-page-first** priority tiebreaker; reserved `mode=deep_domain_analysis` (not enabled). `url_registry` semantics, registry recheck, `max_per_run=5`, and `manual_handoff_to_workflow_04` all unchanged; no auto-call of WF04, no auto-`processed`. Summary now reports `selected_domains` + `domain_diversity`.
- **WF04 stronger PTS override (B3):** competitor + ≥3 distinct strong PTS tokens (`птс`,`залог птс`,`под птс`,`автоломбард`,`залог авто`,`залог автомобил(я)`,`авто остаётся`,`любая ки`,`без проверки кредитной истории`/`ки`) → `pts_loan`, unless multi-product root or clearly real-estate-only. Simulated PASS: autolombardn1→pts_loan, autolombard-moskva/services→pts_loan, mosinvestfinans root→generic_lending, lioncredit RE→secured_real_estate_loan.
- **WF04 contact extraction/sanitation:** new `bestContact(model,text)` = sanitized model value if valid, else deterministic `extractContactFromText()` (RU phone 10–11 digits, `t.me/`, `wa.me/`, email) from `text_context`; prefers a real extracted contact over a model partial. Valid full contacts kept; `"...\"/требуется извлечение/указан на сайте` partials blanked. Applied to all 3 emitters. **35 business + 10 registry fields unchanged; dedup unchanged.**
- **Verified:** both `python3 -m json.tool` VALID; WF06 reads `url_registry`, rechecks registry, enforces 1 URL/domain/run, `MAX=5`, manual handoff; WF04 has B3 (`ptsStrongHits`) + `bestContact`/`extractContactFromText`; both active=false; placeholders only; no Apify/Firecrawl/Claude node; no tool_use / no KEY=VALUE. Contact + PTS logic unit-tested in node against the E2E example strings — all expected.

**Part B — web pipeline status documented:** WF05 approved (web search candidate discovery, human approval); WF06 under test (manual handoff runner + domain diversity); WF04 approved URL consumer (PTS/contact hardening).

**Part C/D — Lead Discovery Layer designed (no build):**
- Created `docs/LEAD_DISCOVERY_ARCHITECTURE.md` (controller-vs-parser distinction, layer shape mirroring 05→06→04, source-agnostic analyzer with 5 classes, why URL-only dedup is insufficient, source evaluation, Stage 3.0 recommendation) and `docs/LEAD_SOURCE_CONNECTORS_PLAN.md` (per-source goal/data-model/approach/credentials/risk/cost/test/go-no-go for Avito, Telegram, VK, Instagram, Yandex, Manual Intake).
- `TABLE_SCHEMA.md`: added **proposed** `lead_discovery_requests`, `raw_market_records` (chosen over `lead_candidates`), `market_record_registry` — marked not created.
- DECISIONS: DEC-066 (E2E + patches), DEC-067 (bot=controller not parser; pipeline stays modular), DEC-068 (lead schema separate; non-URL dedup), DEC-069 (Avito likely first, pending Stage 3.0).
- Updated NEXT_ACTIONS (validate patches → commit → Stage 3.0), COSTS (lead source cost tracked separately from Claude), AGENT_CAPABILITIES (approved/under-test/planned/not-approved), ROADMAP (Stage 2 closing; Stage 3.0/3.1/3.2; Stage 4 Telegram Control Bot), both RU guides.

**Not built / not approved:** Avito scraping, Telegram parser, VK/Instagram/Yandex connectors, Telegram Control Bot. No external API called; no real credentials/IDs; no workflow activated.

**Operator next steps:** re-import WF04 + WF06 (active=false) → rebind Google Sheets creds + real Spreadsheet ID → run the two retests below → commit → write/approve Stage 3.0 Lead Source Evaluation.

---

## 2026-06-07 — Workflow 06 Runtime Registry Recheck Patch (DEC-065)

**Agent role:** project-engineer
**Session goal:** Patch Workflow 06 to re-check `url_registry` at runtime before selecting approved candidates, after the first test exposed a trust bug.

**Context — first test result:** `url_candidates` had 9 rows. The operator manually edited an **old duplicate** (`https://www.autolombard-moskva.ru/pledge-pts/`) to `dedup_status=unique`, `registry_status=not_in_registry`, `candidate_type=direct_competitor`, `approval_status=approved`. WF06 trusted those editable fields and selected it (`selected_count=1`, manual handoff) — but the URL **already exists in `url_registry`**, so handing it to WF04 would cause a duplicate Firecrawl/Claude spend.

**Patch (DEC-065, WF06 only):**
- Added a **`Read url_registry`** Google Sheets node (Manual Start → Read url_candidates → Read url_registry → Select).
- `Select, Prioritize & Annotate` now reads both tabs, **re-normalizes `candidate_url`** with the same `normalizeUrl()` rules as WF04/05 (lowercase scheme/host, drop fragment + utm/gclid/yclid/fbclid, strip trailing slash), and compares against the set of `normalized_source_url` in `url_registry`.
- Selection gate = `approval_status=approved` AND non-empty `candidate_url` AND re-normalized URL **NOT** in `url_registry`. `processed`/`duplicate`/`rejected`/`error` skipped. Editable `dedup_status`/`registry_status` are **ignored** for the decision (advisory only).
- A URL in the registry is skipped as **`registry_recheck_duplicate`** even if manually marked `unique`/`not_in_registry`.
- Skip categories: `approval_status_not_approved`, `already_processed`, `duplicate_status`, `registry_recheck_duplicate`, `missing_candidate_url`, `not_direct_competitor_optional_warning`, `over_limit` (renamed from `over_max_5_limit`).
- Aggregators/directories/media are **no longer hard-blocked** behind an `aggregator_approved` note — when approved they are selected with a per-item `warning`. Priority (`direct_competitor` → confidence → rank), hard cap 5/run, manual hand-off, and no auto-`processed` all unchanged.
- Output unchanged in shape + adds `registry_recheck`, per-item `warning`, and `reason_category` in `skipped[]`.

**Verified:** `python3 -m json.tool` VALID; node types = manualTrigger, **3×googleSheets** (2 read + disabled update), 2×code, if, 2×stickyNote — **no Apify/Firecrawl/Claude/httpRequest node**; `normalizeUrl` present; reads both `url_candidates` + `url_registry`; `registry_recheck_duplicate` present; hard cap 5; `manual_handoff_to_workflow_04` preserved; active=false; placeholders only (4× `PASTE_SPREADSHEET_ID_HERE`); no real Spreadsheet ID; no tool_use / no KEY=VALUE.

**Docs updated:** DEC-065; WF06 RU guide (test result §0, registry recheck §4.1, retest §8.1, skip categories, diagnostics); TABLE_SCHEMA (`dedup_status`/`registry_status` marked advisory); NEXT_ACTIONS (Step J); COSTS (recheck prevents duplicate spend); AGENT_CAPABILITIES + ROADMAP (2.2c still under test); core/hot/recent.md.

**Next operator action:** re-import WF06 → rebind Sheets cred + Spreadsheet ID on all 3 nodes → keep the approved old duplicate (expect `registry_recheck_duplicate` skip) → run WF05 with a new query → approve one new `direct_competitor` → run WF06 (expect it selected) → manually run WF04.

---

## 2026-06-07 — Workflow 06 Approved Candidates Runner BUILT + Workflow 04 contact_public Sanitation (DEC-063/064)

**Agent role:** project-engineer
**Session goal:** Build Workflow 06 (the approved-candidate bridge between discovery and the URL consumer) and patch Workflow 04 so partial/placeholder `contact_public` values are blanked. Context: the manual end-to-end chain passed (WF05 discovered `carcapital.ru/` → operator approved → WF04 → `monitor_queue`), but the run stored `contact_public = "+7 (495) ... (номер указан на сайте, требуется извлечение)"`.

**Part A — Workflow 04 `contact_public` sanitation (DEC-063):**
- Added `sanitizeContact()` in `Normalize + Route`; applied it to all 3 `contact_public` emitters (main analyzed return, technical_error pass-through, deterministic-fallback pass-through).
- Blanks the value unless it matches a reliable pattern: phone led by `+7`/`8`/`7` with **10–11 digits**, valid email, Telegram (`@handle` / `t.me/`), or a contact/profile URL. Blanks outright on `...`/`…` or `требуется извлечение`. Never invents or keeps a partial contact.
- **35 business + 10 registry field counts unchanged; dedup untouched.**

**Part B — Workflow 06 (DEC-064):** `n8n/workflows/06_approved_candidates_runner.json` (active=false).
- Nodes: Manual Start → Read url_candidates → Select, Prioritize & Annotate (filter `approved AND unique AND not_in_registry AND non-empty URL`; aggregators/directories/marketplaces/socials/media need `aggregator_approved` in notes; prioritize `direct_competitor` → confidence → rank; **hard cap 5/run**) → IF Selected? → disabled `Mark Candidates Processed` (update `approval_status=processed`, preserve `approved_by`/`approved_at`, append note) + Build Execution Summary & Handoff (run_id, counts, selected URLs, skip reasons, ready-to-paste `Set URL List` block).
- **Implementation choice: v0.1 manual hand-off** — WF06 does NOT call WF04 as a subworkflow (WF04 keeps its Manual Trigger + fixed `Set URL List`; subworkflow conversion is a risky trigger/input refactor, deferred). No Apify/Firecrawl/Claude/Telegram. Created guide `docs/N8N_WORKFLOW_06_APPROVED_CANDIDATES_RUNNER_RU.md`.

**Verified:** both files `python3 -m json.tool` VALID; WF06 node types = manualTrigger, 2×googleSheets (read + disabled update), 2×code, IF, 2×stickyNote — **no Apify/Firecrawl/Claude/httpRequest node**; both active=false; placeholders only (no Spreadsheet ID / credential ID / API keys); no tool_use / no KEY=VALUE; `sanitizeContact` present 4× (1 def + 3 calls).

**Docs updated:** DECISIONS (DEC-063/064), new WF06 RU guide, URL_DISCOVERY_STRATEGY, WORKFLOW_05 PLAN (E2E passed + WF06 next), WORKFLOW_04 PLAN (contact sanitation + E2E result), TABLE_SCHEMA (approval_status lifecycle), COSTS_AND_LIMITS, AGENT_CAPABILITIES, ROADMAP (Stage 2.2c under test), NEXT_ACTIONS (Step I), AGENT_LOG, `core/hot/recent.md`.

**Next operator action:** import Workflow 06 → rebind Google Sheets cred + Spreadsheet ID → approve one `direct_competitor` candidate → run Workflow 06 → copy ≤5 URLs into Workflow 04 → confirm `monitor_queue` → mark candidate `processed`.

---

## 2026-06-08 — Workflow 04 service_type Patch After Manual E2E Test (DEC-062)

**Agent role:** project-engineer
**Session goal:** Fix Workflow 04 `service_type` after the first manual end-to-end test (Workflow 05 discovered `carcapital.ru/` → operator approved → Workflow 04 → `monitor_queue`, competitor, strength 87, but `service_type=generic_lending` — wrong for a PTS/auto autolombard root page).

**What changed (patched `Normalize + Route` B2 only, in place — no architecture/dedup change):**
- The prior override (DEC-053/054) only fired on **non-root** URLs, so a single-product root homepage stayed `generic_lending`. Added **content-based deterministic signal scoring**: count distinct `pts_auto` / `real_estate` / `refinancing` tokens over `source_url + evidence`.
- Rules: multi-product root (`real_estate≥2 & refinancing≥1`) → stay `generic_lending`; else `pts_auto≥3 & real_estate≤1 & refinancing==0` → `pts_loan` (even for a root); else `pts_auto≥3 & url has pts|avto|car|zalog` → `pts_loan`; else `real_estate≥3 & pts_auto≤1 & refinancing==0` → `secured_real_estate_loan`. Non-root path-token overrides unchanged.

**Verified:** `python3 -m json.tool` VALID; active=false; 35 business + 10 registry fields unchanged; dedup nodes intact; no secrets/tool_use/KEY=VALUE; single-line jsCode diff. Simulation of all 6 documented cases PASS — `carcapital.ru/`→`pts_loan`, `cashmotor.ru/`→`pts_loan`, `autolombard-moskva.ru/pledge-pts/`→`pts_loan`, `mosinvestfinans.ru/`→`generic_lending`, `…/kredit/pod-zalog-avto/`→`pts_loan`, `lioncredit…/nedvizhimosti`→`secured_real_estate_loan`.

**Docs:** DEC-062; WF04 RU guide (§11d E2E + fix), WF04 plan, AGENT_CAPABILITIES, COSTS (E2E note), ROADMAP (Stage 2.2c = next build), NEXT_ACTIONS (Step H).

**Next:** re-import Workflow 04; optionally retest `carcapital.ru/` → `pts_loan`; then build Workflow 06 (Approved Candidates Runner).

---

## 2026-06-08 — Workflow 05 Candidate-Quality Patch: candidate_type, Domain Fix, Competitor-First Scoring (DEC-061)

**Agent role:** project-engineer
**Session goal:** Patch Workflow 05 candidate quality after the first real Apify run (passed technically: 10 candidates, 1 registry duplicate, `discovery_requests` row). No architecture change, no Firecrawl/Claude.

**Problems fixed:**
1. **`domain` empty for all rows** → authoritative extraction in `Classify Candidates` (`new URL().hostname` + regex fallback, lowercased, leading `www.` stripped). Also hardened `Normalize Apify Results` domain.
2. **`confidence_score` too high for aggregators/directories/media** → reworked scoring, competitor-first.
3. **No source-type signal** → added **`candidate_type`** (`direct_competitor`/`aggregator`/`directory`/`media_article`/`marketplace`/`social`/`unknown`), deterministic from domain allow-lists + keyword/path heuristics. `url_candidates` **25 → 26 columns** (`candidate_type` after `domain`; `domain` moved before `title`/`snippet`).
4. Fixed `looksLender` to match `займ` (not only `заим`/`заём`) — otherwise e.g. `carcapital.ru` mis-typed `unknown`.

**Scoring (clamp 1–100):** +30 direct_competitor; +20 залог; +20 ПТС/pts; +15 авто; +15 Москва; +10 кредит/займ; +10 ставка/сумма/одобрение; +10 lender-looking; −50 duplicate_in_registry; −35 directory; −25 aggregator; −20 media_article; −20 marketplace (unless query asks); −30 social. Approval: dup → `duplicate`; unique direct competitor → `new`; unique aggregator/directory/media → `new` + "review manually; not a direct competitor" note (no auto-reject).

**Verified:** `python3 -m json.tool` VALID; active=false; only the Apify HTTP node (0 Firecrawl/0 Claude); no `tool_use`/`KEY=VALUE`; placeholders only. Node simulation on the 10 real-test-like candidates: domains filled; 4 lenders + cashmotor → `direct_competitor` (cashmotor `duplicate`); 2gis → `directory`; finuslugi/vbr/banki → `aggregator`; kp → `media_article`; competitors 85–100 vs aggregators/directory/media 15–45; exact **26** url_candidates + **18** discovery_requests field counts.

**Docs updated:** `N8N_WORKFLOW_05_APIFY_SEARCH_CANDIDATES_RU.md` (test results + candidate_type), `WORKFLOW_05_URL_DISCOVERY_PLAN.md`, `URL_DISCOVERY_STRATEGY.md` (candidate types + source diversity), `TABLE_SCHEMA.md` (26-col), `DECISIONS.md` (DEC-061), `COSTS_AND_LIMITS.md`, `AGENT_CAPABILITIES.md`, `ROADMAP.md`, `NEXT_ACTIONS.md`.

**Next:** operator adds `candidate_type` to the `url_candidates` sheet (after `domain` → 26-col header), re-imports, reruns the same query, verifies domains + types + competitor-first ranking.

---

## 2026-06-08 — Workflow 05 BUILT: Apify Search Candidate Discovery (DEC-060)

**Agent role:** project-engineer
**Session goal:** Build Workflow 05 (URL supplier) — Apify Google Search → candidate URLs → `url_registry` dedup → `url_candidates` + `discovery_requests`. No Firecrawl/Claude, no auto-processing, no Apify call this session.

**Built `n8n/workflows/05_apify_search_candidate_discovery.json` (13 nodes, active=false):**
- Manual Start → Set Discovery Request (query/region/service_focus/requested_limit=10, `disc_<ts>`) → Build Apify Search Request (minimal actor input: 1 query, 1 page, ≤10 results, all extra search engines off) → **Apify Search API Request** (HTTP, sync endpoint `run-sync-get-dataset-items`, Header Auth `Apify API - Marketing Scout`, `onError=continueRegularOutput`) → Normalize Apify Results (robust shape handling, junk-URL filter, Workflow 04 URL normalizer, ≤10) → **Read url_registry** (read-only, `alwaysOutputData`) → Classify Candidates (dedup_status/registry_status, deterministic confidence + region/service hints, estimates) → **(Expand Candidate Rows → Append url_candidates)** + **(Build Discovery Request Summary → Append discovery_requests)**.
- Both append branches start from the always-1-item `Classify Candidates`, so the `discovery_requests` row is written even on 0 candidates / Apify error (`status=error`).
- Writes only `url_candidates` (25 cols) + `discovery_requests` (18 cols); reads `url_registry`; **no business-tab writes, no Firecrawl, no Claude**.
- Unique → `approval_status=new`; registry/batch dups → `duplicate` (0 estimates). New → `estimated_firecrawl_credits=1`, `estimated_claude_cost_usd=0.02`.
- Created RU guide `docs/N8N_WORKFLOW_05_APIFY_SEARCH_CANDIDATES_RU.md`. Decision DEC-060.

**Verified:** `python3 -m json.tool` VALID; active=false; only the Apify HTTP node (no Firecrawl/Claude/anthropic nodes); no `tool_use`/`KEY=VALUE`; placeholders only (no real token / Spreadsheet ID); Node simulation of the three code nodes confirmed exact **25** and **18** field names/order, dedup + batch-dup + registry classification, error path (`status=error`, 0 candidates), and confidence discrimination (autolombard 100 / cashmotor 90 / registry-dup 45 / batch-dup 10 / avito-junk 15).

**Next:** operator creates `discovery_requests` + `url_candidates` sheets, gets an Apify token, creates the `Apify API - Marketing Scout` credential, imports + rebinds, runs the first query, then approves/rejects candidates. Do not process candidates until validated.

---

## 2026-06-08 — Stage 2.2 PIVOT: Workflow 05 = Apify Search Candidate Discovery (DEC-059)

**Agent role:** project-architect
**Session goal:** Repoint Stage 2.2 from "manual candidate intake" to **Level 2 automated discovery** via Apify, since Workflow 04 already covers manual URL lists. **Planning/docs only — no JSON, no Apify call, no external calls.**

**What changed:**
- **Workflow 05 is now `05 - Apify Search Candidate Discovery`** (DEC-059): query → **Apify Google Search Results Scraper** actor → normalize → check `url_registry` → deterministic confidence score + `service_hint`/`region_hint` → write `url_candidates` + a `discovery_requests` row. **0 Firecrawl / 0 Claude** (Apify search cost only); no auto-processing; human approval before Workflow 04.
- **Manual URL entry demoted** to an optional fallback input mode (manual lists already handled by Workflow 04).
- **Primary API = Apify**; credential (create later in n8n, no token in repo): `Apify API - Marketing Scout`, Header Auth, `Authorization: Bearer <token>`, domain `api.apify.com`. Fallbacks later: Google CSE, SerpAPI. Firecrawl `/v2/search` parked.
- **New sheet `discovery_requests` (18 cols)** added (groups candidates per request, lifecycle `status`); `url_candidates` confirmed 25 cols. Existing 6 business tabs (35) + `url_registry` (10) kept — nothing removed.
- **Source connectors vs core analyzers** documented: connectors (Web Search / Website Scrape / Classifieds / Social) acquire records; analyzers (Market Record / Lead Signal / Content Insight / Report) classify competitor/lead_signal/content_idea/market_signal/irrelevant **independent of source**. Don't over-split agents by platform.
- **Telegram** = control interface later (orchestrates `discovery_requests` + `url_candidates` + Workflow 04, no duplicated logic).
- **Default volumes:** collect 10 candidates; Workflow 04 processes ≤5/run → two batches of 5; nothing processed until `approval_status=approved`.
- **Updated docs:** `WORKFLOW_05_URL_DISCOVERY_PLAN.md` (full rewrite as Apify discovery + node plan + scoring + credential), `URL_DISCOVERY_STRATEGY.md` (Level 2 Apify selected, connectors vs analyzers, Telegram flow, gates G1–G5), `TABLE_SCHEMA.md` (added `discovery_requests` 18-col; counts 35/10/25/18), `DECISIONS.md` (DEC-059), `COSTS_AND_LIMITS.md` (Apify cost tracking; Workflow 05 spends 0 Firecrawl/Claude), `AGENT_CAPABILITIES.md`, `ROADMAP.md`, `NEXT_ACTIONS.md` (Step G).

**Next operator decision:** approve the `discovery_requests` (18) + `url_candidates` (25) schemas → create both sheets → get an Apify token → create the `Apify API - Marketing Scout` credential → authorize building Workflow 05.

---

## 2026-06-08 — Stage 2.2 URL Discovery REFINED: Hybrid A+B+D + 25-col `url_candidates` (DEC-058)

**Agent role:** project-architect
**Session goal:** Refine the Stage 2.2 architecture before building Workflow 05. **Planning/docs only — no JSON, no external calls.**

**What changed:**
- **Selected architecture = Hybrid A + B + D** (DEC-058): Option A manual intake **first** → Option B search/API later → Stage 2.2c Approved Candidates Runner → Option D Telegram **as interface only** (calls workflows, no scraping/analysis, duplicates no logic). Option C (Firecrawl `/v2/search`) **parked** — do not combine search+scrape+analysis in one step.
- **`url_candidates` schema 22 → 25 columns:** added request-level grouping fields `discovery_request_id`, `requested_by`, `requested_limit` (with `query`/`created_at`) so a future Telegram bot and per-request summaries are easy.
- **Default volumes:** collect up to **10** candidates/request (`requested_limit=10`); Workflow 04 still processes **≤5/run** → 10 approved run as **two batches of 5**; nothing processed until `approval_status=approved`.
- **Added Stage 2.2c Approved Candidates Runner** as the named hand-off layer (approved → Workflow 04 in batches of 5); manual for now.
- **Updated docs:** `URL_DISCOVERY_STRATEGY.md` (hybrid selected, why C parked, why Telegram is interface, future-expansion rules, default volumes), `WORKFLOW_05_URL_DISCOVERY_PLAN.md` (25-col schema, structure Manual Start → Set Candidate URLs + Query → Normalize → Check url_registry → Build Candidate Rows → Append url_candidates; dups → `approval_status=duplicate`), `TABLE_SCHEMA.md` (added `url_candidates` 25-col tab; counts 35/10/25), `DECISIONS.md` (DEC-058; DEC-055 noted superseded), `ROADMAP.md` (2.2/2.2a/2.2b/2.2c/2.3), `NEXT_ACTIONS.md` (Step G updated), `COSTS_AND_LIMITS.md` (volumes + estimate-before-spend), `AGENT_CAPABILITIES.md`.

**Next operator decision:** approve the `url_candidates` **25-column** schema (gate G1) + confirm Option A first → create the sheet → authorize building Workflow 05. Telegram/search stay deferred.

---

## 2026-06-08 — Stage 2.2 URL Discovery Layer PLANNED (DEC-055/056/057)

**Agent role:** project-architect
**Session goal:** Plan the URL Discovery Layer (the URL *supplier*) that feeds Workflow 04 (the URL *consumer*). **Planning only — no workflow JSON, no external calls.**

**What was produced:**
- **New `docs/URL_DISCOVERY_STRATEGY.md`** — why discovery is separate from analysis; consumer vs supplier; staged rollout (2.2a manual → 2.2b search → 2.3 Telegram); source options A (manual, recommended first), B (search API/SERP actor), C (Firecrawl `/v2/search`, parked), D (Telegram interface, later); risks (bad SERP, SEO spam, duplicate domains, regional mismatch, cost creep, legal/compliance, false competitors); decision gates G1–G5.
- **New `docs/WORKFLOW_05_URL_DISCOVERY_PLAN.md`** — `05 - URL Candidates Manual Intake` plan: `url_candidates` 22-column schema, `approval_status` values (`new`/`approved`/`rejected`/`processed`/`duplicate`/`error`), `source` values (`manual`/`search_api`/`apify_search`/`serp_actor`/`telegram_operator`/`unknown`), `dedup_status`/`registry_status` value sets; structure (Manual Start → Set Candidate URLs/Query → Normalize → Registry Lookup → Scoring/Classification → Append url_candidates); normalization reuses Workflow 04 rules; human approval gate; cost estimation; ≤20 candidates/intake; **no Firecrawl/Claude**; test plan; not building yet.
- **Decisions:** DEC-055 (discovery is a separate layer; Workflow 04 stays URL consumer), DEC-056 (manual candidate intake before automated search; Option C blocked until evaluated), DEC-057 (Telegram bot deferred until candidate + approval flow exists).
- **Updated:** ROADMAP (Stage 2.2 + 2.2a + 2.2b + 2.3), AGENT_CAPABILITIES (URL consumer approved; discovery/manual-intake planned; auto-search/Telegram/auto-processing not approved), COSTS (discovery cost estimated before processing; manual intake 0 cost; search sources measured separately), NEXT_ACTIONS (Step G — schema approval → create sheet → Option A → build Workflow 05).

**Key principle:** no candidate reaches Firecrawl/Claude without human `approval_status=approved`. `url_candidates.normalized_source_url` reuses Workflow 04's normalizer so it matches `url_registry` exactly.

**Next operator decision:** approve the `url_candidates` 22-column schema (gate G1) and confirm Option A (manual intake) first; then create the sheet and authorize building Workflow 05.

---

## 2026-06-08 — Workflow 04: 5-URL Test Passed + Placeholder Pre-Filter + Stronger PTS Override (DEC-054)

**Agent role:** project-engineer
**Session goal:** Finalize Workflow 04 after a successful 5-URL mini-batch test and apply minor hardening — no architecture/dedup change, no prompt tuning.

**5-URL validation** (`firecrawl_20260607_100715`): 2 duplicates → `skipped_log`/`dedup_source_url` (0 cost); 1 placeholder (`zalogpts.ru`, Wix not-connected) → `skipped_log`/`irrelevant` (but had cost a Claude call — `primary_json`); 2 competitors → `monitor_queue` (`cashmotor.ru` → `pts_loan`; `autolombard-moskva.ru/pledge-pts/` → competitor but mislabelled `generic_lending`). Claude Δ **$0.0429**, Firecrawl ~3 credits.

**What changed (patched `04_firecrawl_url_list_resilient.json` in place; 25 nodes, active=false):**
- **Placeholder pre-filter (A)** in `Normalize Firecrawl Output` — after markdown cleaning, obvious placeholder/parking/domain-not-connected pages (`domain not connected`, `wix domain not connected`, `parking page`, `сайт/домен не подключен`, `заглушка сайта`, bare `coming soon` with no commercial terms) → 35-field `skipped_log` row (`parse_method=firecrawl_placeholder_prefilter`, `business_skip`, scores 1, `ignore`) **before any Claude call**. Routes via the existing IF-false branch → `Append to Dynamic Route Sheet` → `Build Registry Row` → `Append url_registry` (still recorded, no repeat processing).
- **Stronger PTS/path service-type override (B)** in `Normalize + Route` — explicit tokens force `pts_loan` (`pledge-pts`, `zalog-pts`, `залог птс`, `под залог птс`, `птс автомобиля`, `займ под залог птс`, bare `птс`/`pts`); `secured_auto_loan` for auto-collateral without PTS; `secured_real_estate_loan` for real-estate tokens; root homepage / multi-product stays `generic_lending`.
- **Layout (D):** lifted the primary lane (`Build Primary Claude Request`, `Claude Primary API Request`, `Parse Primary JSON`, `IF Primary Parse OK?`) to y=140 so the `IF Firecrawl Normalized OK?` → technical-error arrow at y=300 reads cleanly. No logic change.
- Dedup architecture untouched; 35 business + 10 registry fields preserved; `text_context` cap 3500 unchanged.
- **Docs:** DEC-054 added; RU guide §11c (5-URL results) + `Append url_registry` setup detail; PLAN (5-URL passed + hardening); TABLE_SCHEMA (`firecrawl_placeholder_prefilter` + placeholder note); COSTS (5-URL cost Δ $0.0429); AGENT_CAPABILITIES (placeholder skip approved, /v2/search added to blocked); NEXT_ACTIONS (optional post-patch retest); ROADMAP (Stage 2.1 done, next 2.2 discovery planning).

**Decisions:** Workflow 04 **approved for manual ≤5-URL mini-batches**. Placeholder pages skipped before Claude. PTS path/text overrides `generic_lending` → `pts_loan` on specific pages.

**Verified:** `python3 -m json.tool` VALID; 25 nodes; active=false; 35/10 field counts intact; no secrets / no real Spreadsheet ID / no `tool_use` / no `KEY=VALUE` / no crawl-batch-search; `Set URL List` uses only `example.com`. Node sim: `pledge-pts`→`pts_loan`, `pod-zalog-avto`→`secured_auto_loan`, `…nedvizhimosti`→`secured_real_estate_loan`, root→`generic_lending`; Wix-not-connected + bare coming-soon → skip, coming-soon-with-offer + real page → process.

**Next:** optional post-patch 3-URL retest (duplicate + placeholder + PTS); then **plan** URL Discovery (Stage 2.2) — do not build yet.

---

## 2026-06-08 — Workflow 04 VALIDATED & APPROVED: Language Guard + Service-Type Override (DEC-053)

**Agent role:** project-engineer
**Session goal:** Finalize Workflow 04 validation after the `url_registry` patch and apply small quality hardening — no architecture/dedup change, no heavy prompt tuning.

**Validation (operator, 2 runs of the same 3 URLs):**
- **Run 1** (`firecrawl_20260607_094000`, empty registry) → all 3 → `monitor_queue` competitors (МосИнвестФинанс 78/80; 78/82; LionCredit 75/75). 3 `url_registry` rows written.
- **Run 2** (`firecrawl_20260607_094303`, same 3 URLs) → all 3 → `skipped_log`/`business_skip`/`dedup_source_url`, **0 Firecrawl / 0 Claude**. Dedup confirmed.
- Two quality issues found: `…/kredit/pod-zalog-avto/` labelled `generic_lending` (should be PTS/auto); repaired LionCredit `reason` came back in English.

**What changed (patched `04_firecrawl_url_list_resilient.json` in place, `Normalize + Route` only; still 25 nodes, active=false):**
- **Output language guard (A):** Cyrillic source but mostly-English / CJK / foreign `reason` → deterministic Russian fallback by `entity_type` (competitor uses the exact DEC-053 text). Same guard added for `offer_text` (short Russian offer from company/service/terms).
- **URL/path service-type override (B):** specific service page beats multi-product `generic_lending` — `pod-zalog-avto`/`залог ПТС`/`ПТС` → `pts_loan` (or `secured_auto_loan` without PTS); `pod-zalog-nedvizhimosti`/`залог недвижимости`/`квартир`/`коммерческ` → `secured_real_estate_loan`; root homepage stays `generic_lending`.
- Dedup architecture untouched; 35 business fields + 10 registry fields preserved; `text_context` cap 3500 unchanged. Genericized one real domain in the retest sticky note to `example.com`.
- **Docs:** DEC-053 added; RU guide §11b (validation results + backfill note); PLAN (approved); TABLE_SCHEMA (source-of-truth + backfill); COSTS (Run 1/2 validated); AGENT_CAPABILITIES (moved mini-batch + dedup + fallback to APPROVED); NEXT_ACTIONS (next: optional 5-URL run, then plan discovery/Telegram); ROADMAP (Stage 2.1 completed, added 2.2 discovery + 2.3 Telegram planning).

**Decisions:** Workflow 04 **approved for manual ≤5-URL mini-batch**; larger automation still blocked. `url_registry` is the dedup **source of truth** — old rows re-process once unless backfilled (optional maintenance).

**Verified:** `python3 -m json.tool` VALID; 25 nodes; active=false; 35/10 field counts intact; no secrets / no real Spreadsheet ID / no `tool_use` / no `KEY=VALUE` / no crawl-batch-search; `Set URL List` uses only `example.com`. (Pre-existing brand-keyword heuristics `mosinvest`/`lioncredit` in `Parse Repaired JSON` are company-name detection strings, not URLs — left unchanged.)

**Next:** optional 5-URL run (record before/after balances); then **plan** URL discovery (Stage 2.2) — do not build yet.

---

## 2026-06-08 — Workflow 04 Hardened: `url_registry` Dedup + Deterministic Fallback (DEC-051/052)

**Agent role:** project-engineer
**Session goal:** Harden Workflow 04 dedup — move from the fragile 4-tab business-sheet scan to a dedicated `url_registry` tab keyed on the normalized full URL (with path), add a deterministic competitor fallback after primary+repair JSON failure, and tighten cost.

**What changed (patched `04_firecrawl_url_list_resilient.json` in place, still 25 nodes, active=false):**
- **Dedup → `url_registry` (DEC-051).** `Registry Lookup` (Google Sheets read on `url_registry`) replaces the 4× business-tab `Dedup Lookup`. `Normalize URL for Dedup` produces `normalized_source_url` = full URL **with path** (lowercase scheme/host only, drop `#fragment` + `utm_*`/`gclid`/`yclid`/`fbclid`, strip trailing slash on non-root paths). Root variants collapse to one key; service pages on the same domain stay distinct. `Evaluate Dedup` → duplicate (`force_reprocess=false`) → 35-field `skipped_log` (`parse_method=dedup_source_url`, 0 cost); else → Firecrawl.
- **Registry write-back.** `Build Registry Row` (10 fields) + `Append url_registry` after every non-duplicate attempt, including `technical_errors`.
- **Deterministic competitor fallback (DEC-052).** `Parse Repaired JSON` emits a structured `competitor`/`monitor_queue` row (`needs_manual_review=true`, `parse_method=deterministic_competitor_fallback`) on primary+repair failure instead of dropping straight to `technical_errors`; `Normalize + Route` passes it through.
- **Cost:** `text_context` cap lowered to **3500**. Node layout cleaned (left-to-right, no overlaps).
- **Docs:** `TABLE_SCHEMA.md` (url_registry 10-col section, old four-tab dedup removed), `DECISIONS.md` (DEC-051/052), RU guide (registry setup, 10-col header, normalization rules + dedup examples, retest, credential rebind, Loop Over Items), PLAN (selected architecture + under-test), `NEXT_ACTIONS.md`/`COSTS_AND_LIMITS.md`/`AGENT_CAPABILITIES.md`/`ROADMAP.md`.

**Verified:** `python3 -m json.tool` VALID; 25 nodes; connections — duplicate branch never reaches Firecrawl/Claude; non-duplicate + technical-error paths both append `url_registry`; no secrets / no real Spreadsheet ID / no `tool_use` / no `KEY=VALUE` / no crawl-batch-search; only `example.com` placeholders (Claude endpoint uses the project's `aiprimetech.io` gateway placeholder, unchanged).

**Next:** operator creates `url_registry` tab (10 cols), reimports, rebinds credentials, runs first pass (3 URLs) + second pass (same 3 → all `skipped_log`, 0 cost). Workflow 04 not approved until that retest passes.

---

## 2026-06-08 — Workflow 04 Built: Firecrawl URL List Mini-Batch with source_url Dedup (DEC-048/049/050)

**Agent role:** project-engineer
**Session goal:** Build the mini-batch workflow (3–5 URLs, manual) with `source_url` dedup before spend, reusing the hardened Workflow 03 analyzer; 35-column schema (`run_id`, `batch_index`).

**What was done:**
- Created `n8n/workflows/04_firecrawl_url_list_resilient.json` (**25 nodes**, active=false) by copying Workflow 03 and adding a dedup front-end + per-URL loop:
  - `Set URL List` (Code, run-once) — emits one item per URL, 3 `example.com` placeholders, **hard cap 5**, generates `run_id` (`firecrawl_YYYYMMDD_HHmmss`) + 1-based `batch_index`.
  - `Loop Over Items` (Split In Batches v3, batchSize default) — processes one URL per iteration; `Append` loops back.
  - `Normalize URL for Dedup` — lowercases scheme/host, strips `#fragment` + `utm_*`/`gclid`/`yclid`/`fbclid`, removes trailing slash (except root) → `normalized_source_url`.
  - 4× `Dedup Lookup — results/review_queue/monitor_queue/content_queue` (Google Sheets read, filter `source_url`, `alwaysOutputData`, `onError=continue`).
  - `Evaluate Dedup` — aggregates `$('node').all()`; duplicate → 35-field `skipped_log` row (`parse_method=dedup_source_url`, no Firecrawl/Claude); else → source record for Firecrawl.
  - `IF Duplicate?` (parse_method == dedup_source_url) → Append / Build Firecrawl Request.
  - Reused analyzer (Build Firecrawl Request, Firecrawl Scrape API, Normalize Firecrawl Output, Build Primary, Claude Primary, Parse Primary, IF Primary Parse OK?, Build Repair, Claude Repair, Parse Repaired, Normalize + Route, Append) — kept `.first()`/run-once semantics (valid inside the batchSize-1 loop). Adapted: Build FC Request drops the `Set Firecrawl URL` ref; Normalize FC Output takes context from `Evaluate Dedup` and adds `run_id`/`batch_index`; Normalize + Route adds `run_id`/`batch_index` to both 35-field returns.
- **Dedup: IMPLEMENTED (best-effort)** with documented fallback in the RU guide. Duplicate URLs cost 0 Firecrawl/Claude.
- Firecrawl-error path, dedup path, and analyzer paths all emit **exactly 35 fields** with `run_id`/`batch_index` (verified by Node simulation). `text_context`≤6000. Competitor hardening + language guard preserved.

**Verification:** `python3 -m json.tool` VALID (→ `/tmp/04_firecrawl_url_list_resilient_validated.json`); 25 nodes; connection integrity OK; all 8 credential refs correct by name (placeholder IDs); active=false; only `example.com`/gateway/Firecrawl endpoints (no real URLs/secrets/Spreadsheet ID); no test fields / tool_use / KEY=VALUE; dynamic sheet node present; `Set URL List` caps at 5; dedup runs before Firecrawl. Simulation: 3 URLs → batch_index 1,2,3 + shared run_id; dup → skipped_log/dedup_source_url (35); firecrawl error → technical_errors (35); competitor → monitor_queue/generic_lending/strength 75 (35); tech-error passthrough (35).

**Files created:** `n8n/workflows/04_firecrawl_url_list_resilient.json`, `docs/N8N_WORKFLOW_04_FIRECRAWL_URL_LIST_RU.md`
**Files updated:** `docs/WORKFLOW_04_FIRECRAWL_URL_LIST_PLAN.md` (built), `docs/TABLE_SCHEMA.md` (35 cols), `docs/NEXT_ACTIONS.md`, `docs/DECISIONS.md` (DEC-048/049/050), `docs/COSTS_AND_LIMITS.md`, `docs/AGENT_CAPABILITIES.md`, `docs/ROADMAP.md`, `docs/AGENT_LOG.md`, `core/hot/recent.md`

**Next:** operator imports WF04, rebinds credentials + Spreadsheet ID on all 5 Sheets nodes, runs 3 URLs, verifies routes + dedup-on-rerun (0 cost) + `run_id`/`batch_index`, records cost; then max 5. Crawl/batch/schedule/URL-discovery remain blocked.

---

## 2026-06-08 — Workflow 03 Firecrawl Single URL PASSED; Workflow 04 Mini-Batch Planned (DEC-045/046/047)

**Agent role:** project-engineer
**Session goal:** Document the two successful Firecrawl single-URL tests, mark competitor-website single-URL ingestion as approved, and prepare a careful plan for Workflow 04 (URL list mini-batch). Documentation/planning only — no workflow JSON edited.

**Successful tests (after DEC-043/044 hardening):**
- `https://mosinvestfinans.ru/` → `monitor_queue`, competitor, `МосИнвестФинанс`, `Москва`, `generic_lending`, strength/quality **78**, `monitor`, `parsed_success`, `primary_json`, `repair_used=false` (multi-product homepage correctly routed after competitor consistency hardening).
- `https://www.lioncredit.ru/uslugi/kredit-pod-zalog-nedvizhimosti` → `monitor_queue`, competitor, `LionCredit`, `generic_lending`, strength/quality **75**, `monitor`, `parsed_success`, `primary_json`, `repair_used=false` (specific real-estate page; `service_type` may later refine to `secured_real_estate_loan`).

**Operational note:** after import n8n required manual credential rebinding of all four credential-bearing nodes (IDs are local) — recorded as a standing requirement (DEC-046).

**Decisions added:** DEC-045 (Firecrawl single-URL competitor websites approved, manual), DEC-046 (credential rebinding after import is operational), DEC-047 (Workflow 04 may process a manual 3–5 URL list, max 5, no schedule).

**What was done (docs only):**
- Created `docs/WORKFLOW_04_FIRECRAWL_URL_LIST_PLAN.md` — purpose, architecture (Manual Start → Set URL List → Split In Batches → per-URL scrape/normalize/analyze → dynamic Sheets), hard limits (≤5 URLs, manual, no crawl/schedule, ≤6000 chars, continue-on-failure), dedup as first-class requirement, cost tracking, expected outputs, 3-then-5 test plan, build gate (no JSON until approved).
- Marked Workflow 03 single-URL as PASSED / approved across NEXT_ACTIONS (Step E ✅, new Step F active), ROADMAP (Stage 2 ✅, new Stage 2.1 next), AGENT_CAPABILITIES (moved to approved + kept crawl/batch/schedule/Avito/TG/IG blocked), FIRECRAWL_SETUP (validated status + page-selection guidance), COSTS (both tests logged + mini-batch note), RU guide (success table + approval status + rebinding checklist).

**Files updated:** `docs/N8N_WORKFLOW_03_FIRECRAWL_SINGLE_URL_RU.md`, `docs/FIRECRAWL_SETUP.md`, `docs/COSTS_AND_LIMITS.md`, `docs/AGENT_CAPABILITIES.md`, `docs/NEXT_ACTIONS.md`, `docs/DECISIONS.md` (DEC-045/046/047), `docs/ROADMAP.md`, `docs/AGENT_LOG.md`, `core/hot/recent.md`
**Files created:** `docs/WORKFLOW_04_FIRECRAWL_URL_LIST_PLAN.md`
**No workflow JSON changed.**

**Next:** operator reviews/approves `docs/WORKFLOW_04_FIRECRAWL_URL_LIST_PLAN.md`; on approval the build session creates Workflow 04 (3 URLs first, then 5). Crawl/batch/schedule remain blocked.

---

## 2026-06-08 — Workflow 03 Patch: Post-Repair Business-Consistency Hardening (DEC-043/044)

**Agent role:** project-engineer
**Session goal:** Patch `Normalize + Route` in Workflow 03 after the first real Firecrawl test produced a structurally-valid-but-contradictory repaired row.

**First real test:** Firecrawl on `https://mosinvestfinans.ru/` — success, 1 credit; Claude today delta **$0.0229** ($0.0136→$0.0365), total delta $0.0228 ($0.4983→$0.5211). Primary parse failed → repair succeeded (`repaired_json`, `repair_used=true`). Problem row went to `review_queue` with `entity_type=competitor` but `competitor_strength=1`, `quality_score=6`, `recommended_action=investigate`, `service_type=pts_loan`, and a **Chinese `reason`**.

**What was done (Normalize + Route only — no new copy, no prompt change, no new fields):**
- **A. Language guard** — Cyrillic source + CJK/foreign `reason` → Russian fallback (fixed competitor sentence, or templated sentence for non-competitors).
- **B. Competitor consistency rule** — count Russian secured-lending signals; ≥3 → `competitor_strength`/`quality_score` floor 65, `recommended_action=monitor`, `route=monitor_queue`, `needs_manual_review=false` unless `parse_error`; ≥5 → floor 75.
- **C. Repaired-JSON trust rule** — `repair_used=true` + competitor → never `competitor_strength<45` (unless text unusable); rich competitor websites never `review_queue`.
- **D. Multi-product service_type** — scraped website with ≥2 product categories → `generic_lending` (don't let "ПТС" force `pts_loan`); single-product pages keep their enum.
- **E. recommended_action** normalized to route (competitor→monitor, lead→contact, weak→investigate, errors/skip→ignore).
- **F. Routing priority** — rich competitor placed before weak-lead so a competitor page can't fall into `review_queue`.
- **G. raw_response_preview** — 200 chars on `parsed_success` (500 on technical_error).
- **H. Credentials** — verified all four nodes reference the correct credential by name (placeholder IDs only); documented manual re-binding after import in the RU guide.

**Verification:** `python3 -m json.tool` VALID. Node simulation of the mosinvest repaired output → `monitor_queue`, competitor, `company_name=МосИнвестФинанс`, `service_type=generic_lending`, strength 75, quality 75, action monitor, Russian reason, `needs_manual_review=false`, 33 fields. Regression (hot lead→results, weak lead→review_queue, skip→skipped_log, technical_error passthrough, auto/PTS-only competitor→monitor_queue keeping `pts_loan`) all pass, 33 fields each. No tool_use / KEY=VALUE; active=false; placeholders only.

**Files updated:** `n8n/workflows/03_firecrawl_single_url_resilient.json`, `docs/N8N_WORKFLOW_03_FIRECRAWL_SINGLE_URL_RU.md`, `docs/FIRECRAWL_SETUP.md`, `docs/WORKFLOW_02_RESILIENT_OUTPUT_LAYER.md`, `docs/NEXT_ACTIONS.md`, `docs/DECISIONS.md` (DEC-043/044), `docs/COSTS_AND_LIMITS.md`, `docs/AGENT_CAPABILITIES.md`, `docs/AGENT_LOG.md`, `core/hot/recent.md`

**Next:** operator re-imports, re-binds credentials, retests `mosinvestfinans.ru/` (expect `monitor_queue`), then a specific service page. Batch/crawl/schedule stay blocked.

---

## 2026-06-07 — Workflow 03: Firecrawl Single URL → Resilient Analyzer (DEC-039–042)

**Agent role:** project-engineer
**Session goal:** Build the first real-source workflow — Firecrawl single-URL scrape fronting the production resilient analyzer — now that the Workflow 02 production smoke test passed.

**What was done:**
- Created `n8n/workflows/03_firecrawl_single_url_resilient.json` (name `03 - Firecrawl Single URL to Resilient Analyzer`, **17 nodes**, active=false) by copying the production resilient analyzer and prepending a Firecrawl front-end:
  - `Set Firecrawl URL` (target_url=`https://example.com`, source_type=scraped_web, platform=website, parsed_at=`{{ $now.toISO() }}`, source_note=single_url_firecrawl_test) — the only place the operator changes the URL.
  - `Build Firecrawl Request` (Code) → body `{url, formats:["markdown"], onlyMainContent:true, onlyCleanContent:false, removeBase64Images:true, blockAds:true, timeout:60000, storeInCache:true}`.
  - `Firecrawl Scrape API` (HTTP, POST `https://api.firecrawl.dev/v2/scrape`, Header Auth cred `Firecrawl API - Marketing Scout`, `onError=continueRegularOutput`, body `={{ JSON.stringify($json) }}`).
  - `Normalize Firecrawl Output` (Code) — on Firecrawl error OR empty/<80-meaningful-char markdown → 33-field `technical_errors` row (`parse_method=firecrawl_error`); on success → source record (markdown cleaned, `text_context`≤6000, resolved source_url/title/description), `route=''`.
  - `IF Firecrawl Normalized OK?` — route empty → Build Primary Claude Request; route set → Append (bypass Claude).
  - Copied analyzer nodes unchanged except the three `$('Set Source Record')` lookups → `$('Normalize Firecrawl Output')`. Dynamic Google Sheets append (`Sheet Name = {{ $json.route }}`) reused.
- No sub-workflow call yet — analyzer nodes copied in so the file is standalone/importable (DEC-039).
- Firecrawl failure → `technical_errors` without a Claude call (DEC-041); `text_context` capped 6000 (DEC-042); MCP/CLI deferred (DEC-040).

**Verification:** `python3 -m json.tool` → VALID (also written to `/tmp/03_firecrawl_single_url_resilient_validated.json`); node count 17; active=false; placeholders only (`PASTE_SPREADSHEET_ID_HERE`, `PASTE_CREDENTIAL_ID_HERE`); no API keys; no test-only fields; no tool_use; no KEY=VALUE; dynamic sheet node present; **all three 33-field output paths (Firecrawl error row + both Normalize+Route returns) emit exactly 33 fields**; 0 stale `Set Source Record` refs; 3 `Normalize Firecrawl Output` lookups.

**Files created:** `n8n/workflows/03_firecrawl_single_url_resilient.json`, `docs/N8N_WORKFLOW_03_FIRECRAWL_SINGLE_URL_RU.md`, `docs/FIRECRAWL_SETUP.md`
**Files updated:** `docs/DECISIONS.md` (DEC-039–042), `docs/ROADMAP.md`, `docs/COSTS_AND_LIMITS.md`, `docs/AGENT_CAPABILITIES.md`, `docs/WORKFLOW_02_RESILIENT_OUTPUT_LAYER.md`, `docs/TABLE_SCHEMA.md`, `docs/NEXT_ACTIONS.md`, `docs/AGENT_LOG.md`, `core/hot/recent.md`

**Next:** operator creates the Firecrawl credential, sets one competitor URL, runs once, verifies `monitor_queue` (or `technical_errors`), records cost delta. Multi-URL/crawl/batch/schedule stay deferred until this passes.

---

## 2026-06-06 — Production Smoke-Test Patch (DEC-038)

**Agent role:** project-engineer
**Session goal:** Patch the production resilient workflow after the first manual smoke test failed (competitor record → primary parse failed → Repair API 502 Bad Gateway → technical_errors with lost primary diagnostics).

**Root cause:** (1) `Parse Repaired JSON` overwrote `raw_response_preview` with only the repair error, discarding the primary raw response; (2) the repair payload was large (full schema, max_tokens 900), raising 502 risk.

**What was done (patched in place — no new copy):**
- `Parse Primary JSON`: every failure branch now emits `primary_parse_error`, `primary_raw_response_preview` (≤500), `content_summary`, `original_record`; distinct messages for no-content-array, "no text item", and "Primary JSON parse failed:".
- `Build Repair Request`: compact payload — trimmed `original_record` (essential fields, `text_context`≤500), `primary_raw_response_preview`≤500, `primary_parse_error`≤300, compact schema+enum summary, `max_tokens=700`, `temperature=0`; system prompt opens "You are a JSON repair formatter, not a market analyst… If raw response is unusable, return an object that can be routed to technical_errors."
- `Parse Repaired JSON`: reads back `$('Parse Primary JSON')`; on any repair failure emits `parse_method=technical_error`, `parse_error="Primary: … | Repair: …"`, and a `raw_response_preview` that keeps the primary raw response first; route=technical_errors, needs_manual_review=true, repair_used=true, repair_status=failed.
- `Normalize + Route`: `parse_error` capped to 800, `raw_response_preview` to 500; technical_error pass-through preserves diagnostics; service_type + company_name normalization unchanged.
- `Build Primary Claude Request`: appended a short reminder (JSON-only; classify competitor-website records as competitor when offering secured lending/rates/speed/contact/Moscow-MO). Prompt ~4.1 KB, no methodology bloat.
- `Set Source Record`: preset `text_context` to the competitor smoke example so the retest is ready-to-run.
- Output stays at the **33 production columns**; no test-only fields; no tool_use; no KEY=VALUE.

**Verification:** `python3 -m json.tool` VALID; schema = exactly 33 fields; leakage scan clean; logic simulation of primary-fail + repair-502 chain → `technical_errors` row carrying both Primary+Repair errors and the primary raw preview, 33 fields.

**Files updated:**
- `n8n/workflows/02_claude_api_single_record_v2_resilient_router_production.json` (patched)
- `docs/TABLE_SCHEMA.md`, `docs/WORKFLOW_02_RESILIENT_OUTPUT_LAYER.md`, `docs/PROJECT_REVIEW_03_RESILIENT_ROUTER.md`, `docs/NEXT_ACTIONS.md`, `docs/DECISIONS.md` (DEC-038), `docs/COSTS_AND_LIMITS.md`, `docs/AGENT_CAPABILITIES.md`, `docs/AGENT_LOG.md`, `core/hot/recent.md`

**Next:** operator cleans Sheets headers to 33 columns, re-imports patched workflow, reruns the manual smoke test. Firecrawl stays blocked until it passes.

---

## 2026-06-06 — Production Hardening + Cleanup (DEC-037)

**Agent role:** project-engineer
**Session goal:** Create a production-ready single-record resilient analyzer (no test/mock fields) and remove obsolete Switch-based workflows.

**What was done:**
- Created `n8n/workflows/02_claude_api_single_record_v2_resilient_router_production.json` (name `... RESILIENT ROUTER PRODUCTION`), based on the dynamic-sheet test harness:
  - Removed `Set Test Selector`, `Select Test Record`, `IF Skip Primary API?`, all mock-mode logic, and every test-only field.
  - Added `Set Source Record` (placeholder: `source_type=scraped_web`, `platform=website`, `source_url=https://example.com/source`, `parsed_at={{ $today }}`, `text_context=PLACEHOLDER_TEXT_REPLACE_BEFORE_RUN`).
  - Chain: Manual Start → Set Source Record → Build Primary → Claude Primary → Parse Primary → IF Primary Parse OK? → [true] Normalize+Route / [false] Build Repair → Claude Repair → Parse Repaired → Normalize+Route → Append to Dynamic Route Sheet.
  - Production `Normalize + Route` emits exactly 33 fields (25 core + 8 technical); added `recommended_action` route-normalization; `raw_response_preview` capped at 500; route validation retained; service_type + company_name normalization retained.
  - Kept one dynamic Google Sheets node (`Sheet Name = {{ $json.route }}`), credentials by name, `PASTE_SPREADSHEET_ID_HERE`. active=false. No tool_use, no KEY=VALUE.
- Verified: `python3 -m json.tool` VALID; leakage scan shows 0 test/mock/tool_use/KEY=VALUE tokens; logic simulation of `Normalize + Route` → A=results/contact/pts_loan, B=review_queue/investigate/secured_auto_loan, C=monitor_queue/monitor/`МФО / частный кредитор`, D=results/contact/pts_loan, E=technical_errors/ignore, skip=skipped_log/ignore; all 33 fields.
- `git rm` removed obsolete `..._resilient_router_test.json` and `..._resilient_router_test_fixed.json` (staged).
- Added DEC-037. Updated TABLE_SCHEMA (6 tabs + 33 cols + test-only marked non-production), RESILIENT_OUTPUT_LAYER (status + impl note), TEST_RESULTS (productionization section), CLEANUP_AUDIT (Phase 2 executed), CAPABILITIES (approved/not-approved), COSTS (production cost model), ROADMAP (Stage 1.5 done, Stage 2 Firecrawl, renumbered), NEXT_ACTIONS (Step D6/D7), PROJECT_REVIEW_03 (hardening status).

**Files created:** `n8n/workflows/02_claude_api_single_record_v2_resilient_router_production.json`
**Files deleted (git rm, staged):** `..._resilient_router_test.json`, `..._resilient_router_test_fixed.json`
**Files updated:** TABLE_SCHEMA, WORKFLOW_02_RESILIENT_OUTPUT_LAYER, WORKFLOW_02_V2_TEST_RESULTS, PROJECT_CLEANUP_AUDIT, PROJECT_REVIEW_03_RESILIENT_ROUTER, AGENT_CAPABILITIES, NEXT_ACTIONS, DECISIONS (DEC-037), COSTS_AND_LIMITS, ROADMAP, AGENT_LOG, core/hot/recent.md

**Active workflow candidate:** `02_claude_api_single_record_v2_resilient_router_production.json`
**Next:** operator imports production workflow, sets credential + Spreadsheet ID, creates 6 tabs, runs one manual smoke test → then Firecrawl single-URL scraper.

---

## 2026-06-06 — Full Project Review After Resilient Router A–E (Review 03)

**Agent role:** project-engineer
**Session goal:** Full project review after Tests A–E passed on the dynamic-sheet resilient router. Review only — no workflow/code/file deletions.

**What was done (inspection):**
- Verified active workflow `02_..._resilient_router_test_dynamic_sheet.json`: active=false; no real secrets (1× PASTE_SPREADSHEET_ID_HERE, 3× PASTE_CREDENTIAL_ID_HERE; credential names only); no tool_use/tool_choice/tools; no KEY=VALUE; dynamic Sheet Name `={{ $json.route }}`; route validation present; all 47 emitted fields match the RU guide header exactly; all required schema fields present; explicit readable connections (15 nodes, two-pass + single dynamic sheet).
- Prompt review: primary 3922 chars (sonnet-4-6, max_tokens 1400, temp 0.2, JSON-only constraints, no stale experiment formats); repair 1187 chars (max_tokens 900, temp 0.0, "Do not add new facts/invent", "Extract only", "Return JSON only"). No conflicting instructions.
- Schema/security review: secrets scan clean; deployment + disk constraints documented.
- Found drift: `TABLE_SCHEMA.md` documents only 25 core columns (no 6 technical columns / 6 tabs); test harness writes 16 test-only columns into tabs (must be stripped for production); `raw_response_preview` truncates at 1200 in code vs 300 in design doc.

**Output created:** `docs/PROJECT_REVIEW_03_RESILIENT_ROUTER.md` — executive summary; approved / not-approved; blockers; important & nice-to-have fixes; cleanup candidates; security/ops; first-scraper readiness; exact next implementation prompt + smoke tests; final GO (conditional on hardening).

**Verdict:** Architecture GO. First scraper conditional-GO after productionization. Recommended first source: Firecrawl single competitor website.

**Files updated:**
- `docs/PROJECT_REVIEW_03_RESILIENT_ROUTER.md` (created)
- `docs/WORKFLOW_02_V2_TEST_RESULTS.md` (B live pass, A–E all green)
- `docs/AGENT_CAPABILITIES.md` (approved-capabilities section)
- `docs/NEXT_ACTIONS.md` (Step D5 review-first gate + blockers)
- `docs/AGENT_LOG.md`, `core/hot/recent.md`

**No workflow JSON modified, no files deleted, no git rm, no external calls.**

---

## 2026-06-06 — Resilient Router Patch After Tests A–E (DEC-036)

**Agent role:** project-engineer
**Session goal:** Patch the dynamic-sheet resilient router after Tests A–E. A, C, D, E passed; B exposed a routing-priority bug. Fix `Normalize + Route` only — no prompt, model, architecture, or new-copy changes.

**Test results (operator run):**
- A hot Telegram PTS lead → results, parsed_success, primary_json, lead=97, quality=98, contact — PASS
- B weak/review lead → **content_queue** (entity=content_idea via repair), repaired_json, lead=35, content=55 — technically passed but business routing WRONG (should be review_queue)
- C competitor → monitor_queue, comp=88, monitor — PASS, but `company_name` empty for an MFO/private lender
- D forced Markdown → repair → results, mock_markdown_repair, lead=88, contact — PASS; repair returned `service_type="займ под залог ПТС"` (free text, not enum)
- E unrepairable → technical_errors, repair_status=failed, needs_manual_review=true — PASS
- API cost: $0.1145 → $0.1895, delta **$0.0750**

**What was done (patch — `Normalize + Route` node only):**
- Rewrote routing priority: technical_errors → business-skip/irrelevant → hot lead (results) → **weak/potential lead (review_queue)** → competitor (monitor_queue) → pure content idea (content_queue) → fallback review_queue. Weak-lead rule now runs before content_queue (fixes B).
- Added weak/potential-lead rule (entity=lead_signal score 30–69; OR action=investigate; OR score≥30 + social/classified + product-term mention; OR content_idea + score≥30 + social/classified + service_type≠unknown).
- content_queue only when weak-lead rule did not match.
- Added `normalizeServiceType()` — maps free text (птс/авто+залог/недвиж/рефинанс/ипотек/бизнес) to the 7-value enum; valid enums pass through. Fixes D's `pts_loan`.
- Added `companyNameFallback()` — descriptive label for empty competitor names (`МФО / частный кредитор`, `Частный инвестор`, `Автоломбард`, `Брокер`, `Конкурент без бренда`); never invents a brand. Fixes C.
- Updated test-pass logic: for expected_route=review_queue, pass = route=review_queue AND needs_manual_review=true AND lead_signal_score≥30 (route-focused; entity may differ after repair).
- Kept dynamic-sheet routing, repair architecture, prompts, model, credentials, placeholders, active=false.
- Verified via Node logic simulation: A→results, B→review_queue, C→monitor_queue (company=`МФО / частный кредитор`), D→results (service=`pts_loan`); all test_pass_basic=true.
- Re-validated JSON: `python3 -m json.tool` → VALID (`/tmp/v2_resilient_router_dynamic_validated.json`). versionId bumped to `...dynamic-patched-20260606`.
- Added DEC-036. Updated TEST_RESULTS, AGENT_CAPABILITIES, TABLE_SCHEMA, COSTS_AND_LIMITS, RESILIENT_OUTPUT_LAYER, RU guide, NEXT_ACTIONS.

**Files updated:**
- `n8n/workflows/02_claude_api_single_record_v2_resilient_router_test_dynamic_sheet.json` (Normalize + Route node)
- `docs/N8N_WORKFLOW_02_RESILIENT_ROUTER_TEST_RU.md`
- `docs/WORKFLOW_02_RESILIENT_OUTPUT_LAYER.md`
- `docs/WORKFLOW_02_V2_TEST_RESULTS.md`
- `docs/AGENT_CAPABILITIES.md`
- `docs/TABLE_SCHEMA.md`
- `docs/COSTS_AND_LIMITS.md`
- `docs/NEXT_ACTIONS.md`
- `docs/DECISIONS.md` (DEC-036)
- `docs/AGENT_LOG.md`
- `core/hot/recent.md`

**Retest required:** Test B (live), then optional A/D smoke. C/E unchanged. No production workflow touched.

---

## 2026-06-06 — Cleanup Phase 2 Plan Prepared (Blocked on Tests A–E)

**Agent role:** project-engineer
**Session goal:** Prepare cleanup phase 2 plan after the dynamic-sheet resilient router was created. Plan only — no deletions, no git rm, no workflow JSON edits.

**Context:** The dynamic-sheet workflow (`..._dynamic_sheet.json`, DEC-035) is now the active resilient router test candidate. The two earlier Switch-based iterations (`_test.json`, `_fixed.json`) become cleanup candidates — but only after Tests A–E pass.

**What was done:**
- Updated `docs/PROJECT_CLEANUP_AUDIT.md`:
  - Status header updated to note Phase 2 planned + blocked on Tests A–E.
  - Added section "Cleanup Phase 2 — after dynamic router tests" with: background on the 3 router iterations, a workflow classification table (keep active candidate / keep reference / keep historical evidence / delete after A–E pass / keep baseline), deferred carry-overs from Phase 1, proposed `git rm` commands marked NOT TO RUN YET, and an explicit Phase 2 gate (blocker = Tests A–E pass).
- Updated `docs/NEXT_ACTIONS.md`: added a Cleanup Phase 2 block under Step D — do not delete Switch-based workflows until A–E pass; after pass, run cleanup phase 2; classification list included.
- Updated `docs/AGENT_LOG.md` (this entry) and `core/hot/recent.md`.

**Classification recorded:**
- Keep active candidate: `02_claude_api_single_record_v2_resilient_router_test_dynamic_sheet.json`
- Keep reference: `02_claude_api_single_record_v2_baseline_raw_json.json`
- Keep historical evidence: `02_claude_api_single_record_v2_extended_tests.json`
- Delete after A–E pass: `..._resilient_router_test_fixed.json`, `..._resilient_router_test.json`
- Keep baselines: `00_healthcheck_manual_test.json`, `01_google_sheets_append_row_test.json`, `02_claude_api_single_record_analysis.json`

**Blocker before any deletion:** Tests A–E must pass on the dynamic-sheet workflow.

**Files updated:**
- `docs/PROJECT_CLEANUP_AUDIT.md`
- `docs/NEXT_ACTIONS.md`
- `docs/AGENT_LOG.md`
- `core/hot/recent.md`

**No files deleted. No git rm run. No workflow JSON edited.**

---

## 2026-06-06 — Resilient Router DYNAMIC SHEET Copy (Switch Removed)

**Agent role:** project-engineer
**Session goal:** Refactor the Resilient Router TEST HARNESS to use one dynamic Google Sheets append node instead of Switch by Route + 6 per-tab Append nodes, removing visual/import complexity.

**Context:** The FIXED copy imported but left a messy canvas — shifted append nodes, unclear lines, redundant six-node fan-out. Since `route` already holds the exact target tab name, a single Google Sheets node with Sheet Name = `={{ $json.route }}` is cleaner.

**What was done:**
- Created `n8n/workflows/02_claude_api_single_record_v2_resilient_router_test_dynamic_sheet.json` by patching the FIXED copy with Python:
  - Workflow name → `...RESILIENT ROUTER TEST DYNAMIC SHEET`; versionId `...v003-dynamic-20260606`
  - Removed `Switch by Route` node + 6 Append nodes (results, review_queue, monitor_queue, content_queue, skipped_log, technical_errors)
  - Added one `Append to Dynamic Route Sheet` node (googleSheets v4): operation=append, documentId=PASTE_SPREADSHEET_ID_HERE, sheetName expression `={{ $json.route }}` (mode=name), autoMapInputData, credential by name only
  - Connection: `Normalize + Route` → `Append to Dynamic Route Sheet` (Switch connections entry deleted)
  - Position: dynamic node at [2620, 200]; upstream nodes unchanged
- Added route-validation safety to `Normalize + Route` jsCode: if `route` not in the six valid values → `route=technical_errors`, `processing_status=technical_error`, `needs_manual_review=true`, `parse_error += 'invalid_route'`. Wired `parseError` into the returned `parse_error` field.
- Validated JSON: `python3 -m json.tool` → VALID (`/tmp/v2_resilient_router_dynamic_validated.json`). 15 nodes total.
- active=false; no real credentials, API keys, or Spreadsheet ID.
- Added DEC-035 to `docs/DECISIONS.md`.
- Updated `docs/N8N_WORKFLOW_02_RESILIENT_ROUTER_TEST_RU.md` (import DYNAMIC file, dynamic-routing explanation, IF-node fallback), `docs/WORKFLOW_02_RESILIENT_OUTPUT_LAYER.md` (routing now dynamic-sheet), `docs/NEXT_ACTIONS.md`, `core/hot/recent.md`.

**Source files not modified:** `_test.json` and `_fixed.json` — untouched (kept as history).

**Files created:**
- `n8n/workflows/02_claude_api_single_record_v2_resilient_router_test_dynamic_sheet.json`

**Files updated:**
- `docs/N8N_WORKFLOW_02_RESILIENT_ROUTER_TEST_RU.md`
- `docs/WORKFLOW_02_RESILIENT_OUTPUT_LAYER.md`
- `docs/DECISIONS.md` (DEC-035 added)
- `docs/NEXT_ACTIONS.md`
- `docs/AGENT_LOG.md`
- `core/hot/recent.md`

**Next:** Operator deletes old imports, imports the DYNAMIC SHEET file, sets credential + Spreadsheet ID (Sheet Name stays as expression), creates 6 tabs, runs Tests A–E.

---

## 2026-06-06 — Resilient Router TEST HARNESS FIXED Copy Created

**Agent role:** project-engineer
**Session goal:** Create a fixed copy of the Resilient Router TEST HARNESS with Switch by Route rebuilt using typeVersion 1 (simple string-match) to eliminate the visual missing-lines issue on n8n import.

**Context:** After import of the original `_test.json`, n8n UI showed no visible connection lines from Switch by Route to the six Append nodes. Previous audit confirmed the JSON connections were structurally present but the typeVersion 3 rules-mode Switch node may not render reliably in all n8n builds. Fix: rebuild Switch with typeVersion 1 (simpler, battle-tested string-match format).

**What was done:**
- Created `n8n/workflows/02_claude_api_single_record_v2_resilient_router_test_fixed.json` by patching the source with Python json module:
  - Workflow name changed to `...RESILIENT ROUTER TEST FIXED`
  - versionId: `rr000000-resilient-router-v002-fixed-20260606`
  - Switch by Route node rebuilt: typeVersion 1, dataType=string, value1=`$json.route`, 6 explicit value2/output rules (results=0, review_queue=1, monitor_queue=2, content_queue=3, skipped_log=4, technical_errors=5), fallbackOutput=5
  - Switch by Route position: [1700, 300]
  - 6 Append node positions moved to x=2000: results y=-100, review_queue y=100, monitor_queue y=300, content_queue y=500, skipped_log y=700, technical_errors y=900
  - Connections entry for Switch by Route hard-deleted and rebuilt: outputs 0–5 → respective Append nodes
  - active=false preserved; all credentials remain placeholder references; Spreadsheet ID = PASTE_SPREADSHEET_ID_HERE
- Validated JSON: `python3 -m json.tool` → VALID. Output written to `/tmp/v2_resilient_router_fixed_validated.json`.
- Updated `docs/N8N_WORKFLOW_02_RESILIENT_ROUTER_TEST_RU.md` — Step 1 now instructs operator to use the FIXED file, delete old workflow before import.
- Updated `docs/AGENT_LOG.md`, `docs/NEXT_ACTIONS.md`, `core/hot/recent.md`.

**Source workflow not modified:** `n8n/workflows/02_claude_api_single_record_v2_resilient_router_test.json` — untouched.

**Files created:**
- `n8n/workflows/02_claude_api_single_record_v2_resilient_router_test_fixed.json`

**Files updated:**
- `docs/N8N_WORKFLOW_02_RESILIENT_ROUTER_TEST_RU.md`
- `docs/AGENT_LOG.md`
- `docs/NEXT_ACTIONS.md`
- `core/hot/recent.md`

**Next:** Operator deletes old import in n8n, imports the FIXED file, sets credentials + Spreadsheet ID, runs Tests A–E.

---

## 2026-06-06 — Resilient Router Switch Connections Audit and JSON Validation

**Agent role:** project-engineer
**Session goal:** Verify and confirm Switch by Route → 6 Append node connections in the Resilient Router TEST HARNESS; add troubleshooting note to RU guide.

**Context:** Operator reported that after importing the workflow into n8n, visual inspection showed no lines from Switch by Route to the six Google Sheets append nodes. This is a known n8n import-rendering artifact — the connections were already correct in the JSON from the previous build session.

**What was done:**
- Inspected `n8n/workflows/02_claude_api_single_record_v2_resilient_router_test.json` — confirmed all 6 Switch by Route connections present in `connections` map:
  - output 0 (route=results) → Append to results
  - output 1 (route=review_queue) → Append to review_queue
  - output 2 (route=monitor_queue) → Append to monitor_queue
  - output 3 (route=content_queue) → Append to content_queue
  - output 4 (route=skipped_log) → Append to skipped_log
  - output 5 (route=technical_errors) → Append to technical_errors
- Confirmed Switch by Route has 6 explicit routing rules (outputKey 0–5) matching the 6 routes.
- Confirmed fallbackOutput = 5 (technical_errors).
- Validated JSON: `python3 -m json.tool` → VALID. Output written to `/tmp/v2_resilient_router_validated.json`.
- Added troubleshooting note to `docs/N8N_WORKFLOW_02_RESILIENT_ROUTER_TEST_RU.md`: if lines are missing after import, delete workflow and re-import the patched JSON.
- Updated `docs/NEXT_ACTIONS.md` — Phase 3 import note updated.
- Updated `docs/AGENT_LOG.md` and `core/hot/recent.md`.

**Files updated:**
- `docs/N8N_WORKFLOW_02_RESILIENT_ROUTER_TEST_RU.md` — troubleshooting note added
- `docs/AGENT_LOG.md`
- `docs/NEXT_ACTIONS.md`
- `core/hot/recent.md`

**No workflow JSON changes were needed** — connections were already correct.

---

## 2026-06-06 — Resilient Router TEST HARNESS Build

**Agent role:** project-engineer
**Session goal:** Build the Resilient Output Layer TEST HARNESS — 21-node n8n workflow JSON + Russian test guide + doc updates.

**Context:** Context recovery session after two consecutive output-token-limit failures in the same conversation. All file writes done via Write tool (not printed to chat) to stay within limits. Baseline for node types confirmed from `02_claude_api_single_record_v2_baseline_raw_json.json`.

**What was done:**
- Created `n8n/workflows/02_claude_api_single_record_v2_resilient_router_test.json` — 21-node workflow, active=false, no real credentials.
- Validated JSON with `python3 -m json.tool` — VALID.
- Created `docs/N8N_WORKFLOW_02_RESILIENT_ROUTER_TEST_RU.md` — Russian import and test guide covering 5 tests A–E, credential setup, Sheets tab creation, column headers, cost tracking, troubleshooting.
- Updated `docs/NEXT_ACTIONS.md` — Step D Phase 2 marked complete; Phase 3 (operator runs Tests A–E) listed as next action.
- Added DEC-034 to `docs/DECISIONS.md` — mock mode architecture, IF skip logic, credential pattern.
- Updated `docs/AGENT_LOG.md` and `core/hot/recent.md`.

**Files created:**
- `n8n/workflows/02_claude_api_single_record_v2_resilient_router_test.json`
- `docs/N8N_WORKFLOW_02_RESILIENT_ROUTER_TEST_RU.md`

**Files updated:**
- `docs/NEXT_ACTIONS.md`
- `docs/DECISIONS.md` (DEC-034 added)
- `docs/AGENT_LOG.md`
- `core/hot/recent.md`

**Workflow structure (21 nodes):**
- Описание Resilient Router (stickyNote) + Инструкции по тестированию (stickyNote)
- Manual Start → Set Test Selector → Select Test Record → Build Primary Claude Request
- IF Skip Primary API? → [True: Build Repair Request] [False: Claude Primary API Request → Parse Primary JSON → IF Primary Parse OK? → [True: Normalize + Route] [False: Build Repair Request]]
- Build Repair Request → Claude Repair API Request → Parse Repaired JSON → Normalize + Route
- Switch by Route (6 outputs) → 6 Append to [results / review_queue / monitor_queue / content_queue / skipped_log / technical_errors]

**Next:** Operator imports workflow, sets credentials + Spreadsheet ID, creates 6 Sheets tabs, runs Tests A–E.

---

## 2026-06-06 — Cleanup Phase 1 Execution

**Agent role:** project-engineer
**Session goal:** Execute operator-approved cleanup — delete 2 experiment workflow JSONs, remove ghost files, update docs.

**Context:**
- Cleanup audit completed in prior session (`docs/PROJECT_CLEANUP_AUDIT.md`).
- Operator approved deletion of: `02_claude_api_single_record_v2_test_harness.json` and `02_claude_api_single_record_v2_baseline_short_test5.json`.
- Ghost files (`=70`, `Append`, `Build`, `Claude`, `Parse`, `Quality`, `Select`, `Set`) were confirmed absent from the filesystem — already removed prior to this session. No `rm` action needed.
- Working tree was clean at start (all prior session changes committed in c8a3f08, 9008d9b).

**What was done:**
- Verified all keep files present and all delete candidates still tracked in git.
- `git rm n8n/workflows/02_claude_api_single_record_v2_test_harness.json` — staged for deletion.
- `git rm n8n/workflows/02_claude_api_single_record_v2_baseline_short_test5.json` — staged for deletion.
- Confirmed 5 keep workflow JSONs still present on disk after removal.
- Updated `docs/PROJECT_CLEANUP_AUDIT.md`: Phase 1 execution summary added (deleted files, kept files, deferred files).
- Updated `docs/NEXT_ACTIONS.md`: Step D0 marked complete; Step D (Resilient Output Layer) marked CURRENT.
- Updated `docs/AGENT_LOG.md` and `core/hot/recent.md`.

**Files deleted (git rm, staged):**
- `n8n/workflows/02_claude_api_single_record_v2_test_harness.json` (28,139 bytes)
- `n8n/workflows/02_claude_api_single_record_v2_baseline_short_test5.json` (33,018 bytes)

**Files updated:**
- `docs/PROJECT_CLEANUP_AUDIT.md`
- `docs/NEXT_ACTIONS.md`
- `docs/AGENT_LOG.md`
- `core/hot/recent.md`

**Remaining workflow JSONs (5):**
- `00_healthcheck_manual_test.json` — baseline
- `01_google_sheets_append_row_test.json` — baseline
- `02_claude_api_single_record_analysis.json` — production v1
- `02_claude_api_single_record_v2_baseline_raw_json.json` — d350069 reference
- `02_claude_api_single_record_v2_extended_tests.json` — test evidence

**Deferred to phase 2:** `MARKETING_AGENT_PROMPT_V2_PLAN.md`, `SYSTEM_PROMPT.md`, `TEST_DATA.md`, `MILESTONE_REVIEW_02.md`.

**Next action:** Commit staged deletions + doc updates. Then proceed to Resilient Output Layer (Step D).

---

## 2026-06-06 — Project Cleanup Audit

**Agent role:** project-engineer
**Session goal:** Audit accumulated experiment files before implementing Resilient Output Layer.

**Context:**
- Workflow 02 v2 experiment phase generated: baseline raw JSON, TEST HARNESS, short test 5, extended tests, plus multiple planning and prompt docs.
- 8 zero-byte ghost files found at project root (untracked artifacts: `=70`, `Append`, `Build`, `Claude`, `Parse`, `Quality`, `Select`, `Set`).
- `02_claude_api_single_record_v2_baseline_raw_json.json` (33,250 bytes, d350069) is untracked — must be added to git before any cleanup.
- No files deleted. Audit only.

**What was done:**
- Inspected `n8n/workflows/` (7 JSON files), `modules/marketing-scout-v0/` (9 files), `docs/` (20 files).
- Ran `git status` to identify tracked vs. untracked state of all files.
- Created `docs/PROJECT_CLEANUP_AUDIT.md`:
  - Section 1: cleanup objective
  - Section 2: active/keep file list (all foundation docs, 3 baseline workflows, 2 active module files)
  - Section 3: workflow JSON inventory (7 files classified)
  - Section 4: ghost file identification (8 zero-byte untracked files at root)
  - Section 5: module file audit (3 archive candidates: V2_PLAN.md, SYSTEM_PROMPT.md, TEST_DATA.md)
  - Section 6: docs audit (MILESTONE_REVIEW_02.md archive candidate; N8N test plan needs update)
  - Section 7: proposed cleanup commands (NOT TO RUN YET)
  - Section 8: risk controls
  - Section 9: 6-phase cleanup plan
  - Section 10: decision table for operator (9 items to approve or deny)
- Updated `docs/NEXT_ACTIONS.md`: added Step D0 (cleanup) before Step D (Resilient Output Layer).
- Updated `docs/AGENT_LOG.md` and `core/hot/recent.md`.

**Files created:**
- `docs/PROJECT_CLEANUP_AUDIT.md`

**Files updated:**
- `docs/NEXT_ACTIONS.md`
- `docs/AGENT_LOG.md`
- `core/hot/recent.md`

**No files were deleted or moved in this session.**

**Delete candidates identified (pending operator approval):**
- Root ghost files: `=70`, `Append`, `Build`, `Claude`, `Parse`, `Quality`, `Select`, `Set` (untracked, zero-byte)
- `n8n/workflows/02_claude_api_single_record_v2_test_harness.json` (v2.5 MICRO, gateway 502)
- `n8n/workflows/02_claude_api_single_record_v2_baseline_short_test5.json` (Test 5 only, superseded)
- `modules/marketing-scout-v0/MARKETING_AGENT_PROMPT_V2_PLAN.md` (plan executed, now redundant)
- `modules/marketing-scout-v0/SYSTEM_PROMPT.md` (v1.0 draft, superseded)
- `modules/marketing-scout-v0/TEST_DATA.md` (v1 test data, superseded by TEST_RECORDS_V2.md)
- `docs/MILESTONE_REVIEW_02.md` (historical audit, lower priority)

**Add to git (untracked files that must be preserved):**
- `n8n/workflows/02_claude_api_single_record_v2_baseline_raw_json.json` — d350069 working baseline
- `docs/WORKFLOW_02_RESILIENT_OUTPUT_LAYER.md` — Resilient Output Layer design spec

---

## 2026-06-06 — Resilient Output Layer Design (DEC-033)

**Agent role:** project-engineer
**Session goal:** Diagnose output-contract failures from extended tests 8–12 and design a structural fix.

**Context:**
- Extended tests 8–12 were run by operator. Results confirmed: Tests 1 and 8 (hot PTS leads) passed strongly.
- Tests 9 (Instagram competitor), 10 (Avito refinancing), 11 (weak website competitor), 12 (out-of-region SPb) all failed with output-contract errors: no `text` item, Markdown analysis blocks, invalid JSON.
- Test 5 (content_idea, short) remains unstable. Reasoning appears correct in all cases.
- Five prompt-format experiments (v2.0–v2.5) did not resolve the failure mode. Prompt-level fixes insufficient.

**What was done:**
- Created `docs/WORKFLOW_02_RESILIENT_OUTPUT_LAYER.md` — full design spec for two-pass architecture:
  - Problem statement: single-step output contract is structurally unstable for non-obvious inputs.
  - Three-state classification: `parsed_success`, `technical_error`, `business_skip`.
  - Two-pass architecture: Primary Parse → (on failure) Repair Formatter → Router.
  - JSON Repair Formatter: second Claude call (Haiku, ~400-char schema-only prompt, temp=0.0).
  - Multi-tab Router: replaces binary Quality Gate; routes to 6 Sheets tabs.
  - 6 new technical fields: `processing_status`, `parse_method`, `parse_error`, `raw_response_preview`, `route`, `needs_manual_review`.
  - 5 Tests A–E for validation before production migration.
  - Rollout plan: 6 phases from Sheets setup to production re-test.
- Added DEC-033 to `docs/DECISIONS.md`.
- Updated `docs/WORKFLOW_02_V2_TEST_RESULTS.md`: filled actual test results 8–12; updated approval gate (Tests A–E replace old 4/5 gate).
- Updated `docs/AGENT_CAPABILITIES.md`: status header, not-approved list, risks table.
- Updated `docs/ROADMAP.md`: Stage 1 status to "in progress"; added Stage 1.5 (Resilient Output Layer).
- Updated `docs/NEXT_ACTIONS.md`: Step D rewritten — now tracks 4 implementation phases for Resilient Output Layer.

**Files created:**
- `docs/WORKFLOW_02_RESILIENT_OUTPUT_LAYER.md`

**Files updated:**
- `docs/DECISIONS.md` (DEC-033 added)
- `docs/WORKFLOW_02_V2_TEST_RESULTS.md`
- `docs/AGENT_CAPABILITIES.md`
- `docs/ROADMAP.md`
- `docs/NEXT_ACTIONS.md`
- `docs/AGENT_LOG.md`
- `core/hot/recent.md`

**Key decisions:** DEC-033 — stop prompt format experiments; fix with two-pass repair + routing.

---

## 2026-06-05 — Extended Tests 8–12 + Final Test Documentation

**Agent role:** project-engineer
**Session goal:** Create 5 new business-priority tests (Telegram, Instagram, Avito, website, out-of-region) and finalize Workflow 02 v2 documentation.

**Context:**
- Baseline d350069 raw JSON works (Test 1: quality=97, lead_signal=98, action=contact).
- v2.1–v2.5 experiments all failed (JSON.parse, gateway 502). Deferred.
- Test 5 (content_idea) deferred to Stage 3 (Content Agent). Not included in extended tests.
- Extended tests cover uncle's actual business sources: Telegram, Instagram, Avito, website.

**What was done:**
- Created `02_claude_api_single_record_v2_extended_tests.json` from d350069 baseline:
  - Workflow name: `02 - Claude API Single Record Analysis v2 EXTENDED TESTS`
  - Select Test Record: replaced with tests 8–12 only
  - Set Test Selector: default test_id=8
  - Build node: identical to baseline (max_tokens=1400, temp=0.2, raw JSON, no tools, no tool_choice)
  - Parse node: identical to baseline (JSON.parse, markdown fence strip)
  - Quality Gate, Google Sheets: unchanged
  - JSON validated: 30,879 bytes, python3 -m json.tool exits 0
- Created `modules/marketing-scout-v0/TEST_RECORDS_V2_EXTENDED.md`:
  - 5 tests with full input JSON, expected outputs, pass/fail criteria, rationale
  - Tests: Telegram hot lead (8), Instagram competitor (9), Avito refinancing MO (10), weak website competitor (11), out-of-region SPb lead (12)
- Created `docs/WORKFLOW_02_V2_TEST_RESULTS.md`:
  - Protocol table for tests 8–12 (unfilled, ready for operator)
  - Confirmed results table (Test 1 done, others pending)
  - Known limitation section: content_idea deferred to Stage 3
  - v2.1–v2.5 experiment archive table
- Rewrote `docs/N8N_WORKFLOW_02_V2_TEST_PLAN_RU.md`: three-phase plan (Test 5 → 8–12 → close stage)
- Updated `docs/AGENT_CAPABILITIES.md`: current approved capabilities, not-approved list (content_idea, bot), gateway stability note
- Updated `docs/ROADMAP.md`: added Stage 2.5 (Telegram Control Bot) with full description
- Updated `docs/DECISIONS.md`: DEC-030 (content deferred), DEC-031 (no repeat tests), DEC-032 (bot future)
- Updated `docs/COSTS_AND_LIMITS.md`: extended test cost estimate table
- Updated `docs/NEXT_ACTIONS.md`: Test 5 + 8–12 sequence, close stage, move to Firecrawl

**Note on TABLE_SCHEMA.md:** The task requested adding a company_name rule but TABLE_SCHEMA.md was not in the authorized edit list. Skipped — should be added in Step B (doc fixes).

**Files created:**
- `n8n/workflows/02_claude_api_single_record_v2_extended_tests.json` (30,879 bytes)
- `modules/marketing-scout-v0/TEST_RECORDS_V2_EXTENDED.md`
- `docs/WORKFLOW_02_V2_TEST_RESULTS.md`

**Files updated:**
- `docs/N8N_WORKFLOW_02_V2_TEST_PLAN_RU.md`
- `docs/AGENT_CAPABILITIES.md`
- `docs/ROADMAP.md`
- `docs/DECISIONS.md` (DEC-030, DEC-031, DEC-032)
- `docs/COSTS_AND_LIMITS.md`
- `docs/NEXT_ACTIONS.md`
- `docs/AGENT_LOG.md` — this entry
- `core/hot/recent.md`

**Files NOT modified (confirmed):**
- `n8n/workflows/02_claude_api_single_record_analysis.json` — production, untouched ✓
- `n8n/workflows/02_claude_api_single_record_v2_test_harness.json` — v2.5 harness, untouched ✓

---

## 2026-06-05 — Baseline Raw JSON SHORT TEST 5

**Agent role:** project-engineer
**Session goal:** Create a safe importable harness based on the d350069 baseline, with Test 5 text_context shortened to eliminate the JSON.parse failure root cause.

**Context:**
- d350069 baseline raw JSON harness works: Test 1 passed (entity_type=lead_signal, action=contact, quality=97, lead_signal=98).
- v2.1–v2.5 experiments all failed or were unstable (JSON.parse, gateway 502 at all prompt sizes).
- Test 5 (content_idea) failed JSON.parse in the baseline due to long multi-sentence Russian text that caused Claude to embed problematic characters in JSON string values.

**What was done:**
- Read d350069 baseline from git history (`git show d350069:n8n/workflows/...`).
- Created `02_claude_api_single_record_v2_baseline_short_test5.json`:
  - Workflow name updated to `02 - Claude API Single Record Analysis v2 BASELINE SHORT TEST 5`.
  - Test 5 text_context replaced: 252 chars → 139 chars. New text is a short fear-based VK question (no multi-sentence prose, no em-dash, no complex punctuation that triggers JSON escape issues).
  - All other nodes, prompts, parsers, and connections identical to d350069 baseline.
  - Sticky note updated to describe the file's purpose.
  - versionId and instanceId updated.
- JSON validated: `python3 -m json.tool` exits 0; **33,018 bytes**.
- Verified: active=false, no real credentials, no real Spreadsheet ID, v2.5 harness untouched.
- Added DEC-029: baseline raw JSON is the working fallback; v2.1–v2.5 experiments deferred.
- Rewrote `docs/N8N_WORKFLOW_02_V2_TEST_PLAN_RU.md`: status table (baseline vs experiments), Test 5 change explanation, 2-test retest order, stale v2.5 sections replaced.
- Updated `docs/NEXT_ACTIONS.md` Step D to point to the new baseline_short_test5 harness.
- Updated `docs/DECISIONS.md` (DEC-029), AGENT_LOG.md, core/hot/recent.md.

**Files created/updated:**
- `n8n/workflows/02_claude_api_single_record_v2_baseline_short_test5.json` — **CREATED** (33,018 bytes)
- `docs/N8N_WORKFLOW_02_V2_TEST_PLAN_RU.md` — full rewrite
- `docs/DECISIONS.md` — DEC-029 added
- `docs/NEXT_ACTIONS.md` — Step D updated
- `docs/AGENT_LOG.md` — this entry
- `core/hot/recent.md` — updated

**Files NOT modified (confirmed):**
- `n8n/workflows/02_claude_api_single_record_analysis.json` — production, untouched ✓
- `n8n/workflows/02_claude_api_single_record_v2_test_harness.json` — v2.5 harness, untouched ✓

---

## 2026-06-05 — Prompt v2.5 MICRO

**Agent role:** project-engineer / prompt-engineer
**Session goal:** Fix 502 by reducing prompt to micro size. v2.4 (5.3 KB compact) still returned 502 upstream_error. Minimal curl with small prompt works. Diagnosis: gateway threshold is well below 5 KB.

**Root cause of v2.4 502:** System prompt was 5343 chars. Even compacted to 5.3 KB, the gateway returned 502 upstream_error. Minimal curl (very short system + short user message) succeeds every time. The gateway cannot handle moderately sized prompts — micro-sized runtime is required.

**What was done:**
- Rewrote `MARKETING_AGENT_PROMPT_V2.md` to v2.5 MICRO: stripped all verbose methodology from runtime prompt. Kept only: priority, products, target, region rules, one-liner scoring anchors, actions, skip trigger, field limits, enums, anti-hallucination one-liner, output format. Result: **1997 chars runtime prompt** (target 1500–2200). ✓
- Preserved full methodology in new "Full Methodology Reference" section within the same file (not sent at runtime).
- Renamed `Build Claude Request v2.4` → `Build Claude Request v2.5 MICRO`. Updated jsCode: max_tokens 700→450, embedded v2.5 MICRO prompt, removed `profile_url` from user message, no tools, no tool_choice.
- `Parse Claude Line Response` parse logic unchanged from v2.3/v2.4.
- Rebuilt all connections from scratch (canonical Python dict). Verified: Select Test Record → Build Claude Request v2.5 MICRO. ✓
- JSON validated: python3 -m json.tool exits 0; **24,138 bytes** (was 28,139 bytes in v2.4).
- Added DEC-028: micro-sized runtime prompts required; detailed methodology stays in docs only.
- Updated COSTS_AND_LIMITS.md: v2.5 row added to stability table; note on prompt size + cost + gateway routing.
- Rewrote `docs/N8N_WORKFLOW_02_V2_TEST_PLAN_RU.md` for v2.5: v2.4 502 added to history table, Step 0 curl-test added, updated cost estimate, updated approval section with note on MICRO scoring quality.
- Updated NEXT_ACTIONS.md, DECISIONS.md, AGENT_LOG.md, core/hot/recent.md.

**Prompt size change:** 5343 chars (v2.4) → 1997 chars (v2.5 MICRO) = −63%.
**max_tokens change:** 700 → 450 = −36%.
**File size change:** 28,139 bytes (v2.4 harness) → 24,138 bytes (v2.5 harness).

**Files updated:**
- `modules/marketing-scout-v0/MARKETING_AGENT_PROMPT_V2.md` — v2.5 MICRO
- `n8n/workflows/02_claude_api_single_record_v2_test_harness.json` — Build v2.5 MICRO, connections rebuilt (24,138 bytes)
- `docs/N8N_WORKFLOW_02_V2_TEST_PLAN_RU.md` — full rewrite for v2.5
- `docs/DECISIONS.md` — DEC-028 added
- `docs/COSTS_AND_LIMITS.md` — v2.5 row added, prompt size guidance tightened to <2.5 KB
- `docs/NEXT_ACTIONS.md` — Step D updated to v2.5 MICRO
- `docs/AGENT_LOG.md` — this entry
- `core/hot/recent.md` — updated

---

## 2026-06-05 — Prompt v2.4 Compact KEY=VALUE

**Agent role:** project-engineer / prompt-engineer
**Session goal:** Fix 502 Bad Gateway by reducing prompt size. v2.3 (9.2 KB) returned 502 on Test 1. Minimal curl to gateway with small prompt works. Conclusion: gateway has request-size or processing constraint.

**Root cause of v2.3 502:** System prompt was 9.2 KB. With max_tokens=1100 and the record JSON, total request payload was large enough to exceed gateway processing capacity. A small curl works fine — gateway is alive and key is valid.

**What was done:**
- Rewrote `MARKETING_AGENT_PROMPT_V2.md` to v2.4: same business logic (priority order, ICP, region rules, scoring calibration, anti-hallucination, skip rules), all sections rewritten compactly. Result: 5.3 KB / 5431 bytes (target 4–6 KB). ✓
- Renamed `Build Claude Request v2.3` → `Build Claude Request v2.4`; updated jsCode: max_tokens 1100→700, user message reminder "Return exactly 25 KEY=VALUE lines. No extra text.", same KEY=VALUE protocol, no tools, no tool_choice.
- `Parse Claude Line Response` parse logic unchanged from v2.3.
- Rebuilt all connections from scratch (canonical Python dict); verified Select Test Record → Build Claude Request v2.4. ✓
- JSON validated: python3 -m json.tool exits 0; 28,139 bytes.
- Added DEC-027: compact prompts required for this gateway (≤6 KB system prompt, max_tokens ≤700).
- Updated COSTS_AND_LIMITS.md: prompt size vs. cost/stability table added.
- Updated test plan (full rewrite for v2.4): history table, 502 diagnostic section, "502 column" in protocol table.
- Updated NEXT_ACTIONS.md, AGENT_LOG.md, core/hot/recent.md.

**Prompt size change:** 9241 chars (v2.3) → 5343 chars (v2.4) = −42%.
**max_tokens change:** 1100 → 700 = −36%.
**File size change:** 32,077 bytes (v2.3) → 28,139 bytes (v2.4).

**Files updated:**
- `modules/marketing-scout-v0/MARKETING_AGENT_PROMPT_V2.md` — v2.4
- `n8n/workflows/02_claude_api_single_record_v2_test_harness.json` — Build v2.4, connections rebuilt (28,139 bytes)
- `docs/N8N_WORKFLOW_02_V2_TEST_PLAN_RU.md` — full rewrite for v2.4
- `docs/DECISIONS.md` — DEC-027 added
- `docs/COSTS_AND_LIMITS.md` — gateway stability / prompt size section added
- `docs/NEXT_ACTIONS.md` — Step D updated to v2.4
- `docs/AGENT_LOG.md` — this entry
- `core/hot/recent.md` — updated

---

## 2026-06-05 — Prompt v2.3 KEY=VALUE Line Protocol

**Agent role:** project-engineer / prompt-engineer
**Session goal:** Fix test harness after v2.2 502 Bad Gateway failure and broken node connection. Replace tool_use with KEY=VALUE line protocol.

**Root cause of v2.2 failures:**
1. Gateway (aiprimetech.io) returned 502 Bad Gateway for requests containing `tools`/`tool_choice`. Gateway does not support Anthropic tool_use.
2. Broken connection bug: `Select Test Record` was still pointing to `Build Claude Request v2` (stale key from previous node rename). The chain was broken — test record never reached Claude.

**What was done:**
- Upgraded `MARKETING_AGENT_PROMPT_V2.md` to v2.3: replaced OUTPUT INSTRUCTION (tool call) with KEY=VALUE OUTPUT FORMAT section listing all 25 fields in order. Prompt instructs Claude to return exactly 25 `field_name=value` lines with no JSON, no Markdown, no blank lines. max_tokens 1100, temperature 0.1. Business logic unchanged.
- Renamed `Build Claude Request v2.2` → `Build Claude Request v2.3` in test harness; removed `tools` and `tool_choice`; updated system prompt; user message appended with `"\n\nReturn KEY=VALUE lines only."`.
- Renamed `Parse Claude JSON Response` → `Parse Claude Line Response`; rewrote parsing: find text block, strip fences, split on newlines, extract key/value by first `=`, build JS object, clampInt for scores, pickEnum for categorical fields. Output includes `parse_method=line_protocol` or `line_failed`. All test comparison fields preserved.
- **Rebuilt all connections from scratch** in Python to eliminate the stale-key bug: explicit canonical dict covers all 7 links; verified by connection dump.
- Added DEC-026: KEY=VALUE line protocol chosen because gateway blocks tool_use and raw JSON is unstable.
- JSON validated: `python3 -m json.tool` exits 0; 32,077 bytes.
- Rewrote `docs/N8N_WORKFLOW_02_V2_TEST_PLAN_RU.md` for v2.3: failure history, new test order, parse_method column, updated criteria.
- Updated DECISIONS.md (DEC-026), NEXT_ACTIONS.md (Step D v2.3), AGENT_LOG.md, core/hot/recent.md.

**Files updated:**
- `modules/marketing-scout-v0/MARKETING_AGENT_PROMPT_V2.md` — v2.3 (KEY=VALUE output, all connections rebuilt)
- `n8n/workflows/02_claude_api_single_record_v2_test_harness.json` — Build v2.3, Parse Line Response, connections fixed (32,077 bytes, valid)
- `docs/N8N_WORKFLOW_02_V2_TEST_PLAN_RU.md` — full rewrite for v2.3
- `docs/DECISIONS.md` — DEC-026 added
- `docs/NEXT_ACTIONS.md` — Step D updated to v2.3
- `docs/AGENT_LOG.md` — this entry
- `core/hot/recent.md` — updated

---

## 2026-06-05 — Prompt v2.2 tool_use Structured Output Architecture

**Agent role:** project-engineer / prompt-engineer
**Session goal:** Eliminate JSON parse failures permanently by switching from raw text JSON output to Anthropic tool_use structured output.

**Root cause confirmed:** Raw JSON text from Claude failed in two versions:
- v2.0: Test 5 (content_idea) — unescaped quotes/colons in `offer_text` broke JSON.parse.
- v2.1: Test 1 (strong lead) — similar failure in `reason` or `detected_need`.
Text-based JSON output is inherently brittle for Russian-language fields. Prompt instructions are insufficient.

**What was done:**
- Upgraded `MARKETING_AGENT_PROMPT_V2.md` to v2.2: removed JSON SAFETY RULES, OUTPUT FORMAT, REQUIRED JSON SCHEMA sections. Added FIELD CONSTRAINTS and OUTPUT INSTRUCTION ("call return_marketing_analysis tool exactly once"). Added Tool Definition table. Added v2.2 version note explaining architecture change. Business logic unchanged.
- Upgraded `Build Claude Request v2` → `Build Claude Request v2.2` Code node in test harness:
  - Added `toolDefinition` object with full JSON Schema (25 fields, `type: "object"`, `additionalProperties: false`, integer constraints for scores, enums for categorical fields, `required` array).
  - Added `tools: [toolDefinition]` and `tool_choice: { type: "tool", name: "return_marketing_analysis" }` to API request body.
  - Updated connection keys accordingly.
- Upgraded `Parse Claude JSON Response` Code node:
  - Primary path: find `{ type: "tool_use", name: "return_marketing_analysis" }` block; use `block.input` directly.
  - Fallback: existing text parser with brace extraction and smart-quote normalization.
  - New output field: `parse_method` = "tool_use" | "text_fallback" | "text_failed" | "none".
  - All test comparison fields preserved.
- Added DEC-025: tool_use is the preferred architecture; text fallback retained for gateway compatibility.
- Updated test plan: explains v2.0/v2.1 failure history; test order = Test 1, Test 5, Test 6, then 2/3/4/7; `parse_method` column added to protocol table; approval criteria split into blockers and logical tests.
- JSON validated: `python3 -m json.tool` exits 0; 33,540 bytes.
- Updated NEXT_ACTIONS.md — Step D reflects v2.2 and test order.

**Files updated:**
- `modules/marketing-scout-v0/MARKETING_AGENT_PROMPT_V2.md` — v2.2 (tool_use architecture, clean prompt)
- `n8n/workflows/02_claude_api_single_record_v2_test_harness.json` — Build node renamed v2.2, tool_use added, Parse node upgraded
- `docs/N8N_WORKFLOW_02_V2_TEST_PLAN_RU.md` — v2.2 header, failure history, test order, parse_method column, updated criteria
- `docs/DECISIONS.md` — DEC-025 added
- `docs/NEXT_ACTIONS.md` — Step D updated to v2.2
- `docs/AGENT_LOG.md` — this entry
- `core/hot/recent.md` — updated

---

## 2026-06-05 — Prompt v2.1 JSON Stability Patch and TEST HARNESS Parser Upgrade

**Agent role:** project-engineer / prompt-engineer
**Session goal:** Fix JSON parse failures triggered by Test 5 (content_idea). Upgrade prompt to v2.1 with JSON safety rules. Upgrade Parse node in test harness with multi-step cleanup.

**What was done:**
- Updated `MARKETING_AGENT_PROMPT_V2.md` header from v2.0 → v2.1 (status: JSON stability fix, retest Test 5 before final approval).
- Updated CONTENT INTELLIGENCE section: offer_text for content_idea = short plain-text angle, no quotation marks, no labels, no colons at start, max 180 chars. detected_need for content_idea = client fear/objection (no longer empty).
- Added **JSON SAFETY RULES** section between REASON FIELD and OUTPUT FORMAT: 10 explicit rules covering no unescaped quotes, no markdown, no trailing commas, integer scores, max character limits for offer_text/detected_need/reason, citation-without-quotes rule for reason.
- Updated schema descriptions for `offer_text` (max 180 chars, no quotation marks for content_idea) and `detected_need` (content_idea → client fear/objection; others → empty string).
- Added v2.1 version note to Version Notes section.
- Upgraded Parse Claude JSON Response node in test harness: added Step 2 (brace extraction) and Step 3 (smart quote normalization — curly quotes, guillemets) before JSON.parse.
- Regenerated test harness JSON using Python json.dump(ensure_ascii=False); validated: python3 -m json.tool exits 0; new size 33,834 bytes.
- Added DEC-024: zero JSON parse failures required — a parse failure on any expected-analyzed record blocks approval.
- Updated test plan: v2.1 header, banner explaining the patch, "run Test 5 first" instruction, updated Test 5 pass criteria, added no-parse-failure criterion to approval list, added offer_text format check.
- Updated NEXT_ACTIONS.md: Step D now says v2.1, run Test 5 first.

**Files updated:**
- `modules/marketing-scout-v0/MARKETING_AGENT_PROMPT_V2.md` — v2.1 patch (JSON SAFETY RULES, content_idea rules, schema descriptions, version note)
- `n8n/workflows/02_claude_api_single_record_v2_test_harness.json` — Parse node upgraded (brace extraction + smart quote normalization)
- `docs/N8N_WORKFLOW_02_V2_TEST_PLAN_RU.md` — v2.1 note, Test 5 first instruction, updated criteria
- `docs/DECISIONS.md` — DEC-024 added
- `docs/NEXT_ACTIONS.md` — Step D updated to v2.1, Test 5 first
- `docs/AGENT_LOG.md` — this entry
- `core/hot/recent.md` — updated

---

## 2026-06-05 — TEST HARNESS Workflow Created for Prompt v2 Testing

**Agent role:** project-engineer
**Session goal:** Create an importable n8n workflow that allows testing Prompt v2 without manual code editing.

**What was done:**
- Generated `n8n/workflows/02_claude_api_single_record_v2_test_harness.json` using Python/json.dumps for correct escaping.
  Workflow contains: 2 Sticky Notes (RU), Manual Start, Set Test Selector (single `test_id` field 1–7), Select Test Record (Code node — all 7 test records embedded), Build Claude Request v2 (Code node — Prompt v2 embedded, model claude-sonnet-4-6, max_tokens 1400, temperature 0.2), Claude API Request (HTTP Request, POST aiprimetech.io/v1/messages, Header Auth), Parse Claude JSON Response (Code node — strips fences, adds test_pass_basic/test_notes comparison fields), Quality Gate (IF — status=analyzed AND quality_score≥60), Append Row to Google Sheets.
- Workflow: active=false, no real secrets, Spreadsheet ID = PASTE_SPREADSHEET_ID_HERE, credentials by name only.
- JSON validated: `python3 -m json.tool` returns exit 0; all 7 test records confirmed present; Cyrillic correct; prompt embedding confirmed; old Workflow 02 unchanged.
- Added DEC-023: use TEST HARNESS, not manual node editing.
- Rewrote `docs/N8N_WORKFLOW_02_V2_TEST_PLAN_RU.md` — now explains import procedure, credential binding, test_id cycling, protocol table, cost measurement, restoration from Git if workflow breaks in UI.

**Files created:**
- `n8n/workflows/02_claude_api_single_record_v2_test_harness.json`

**Files updated:**
- `docs/N8N_WORKFLOW_02_V2_TEST_PLAN_RU.md` — full rewrite for TEST HARNESS procedure
- `docs/NEXT_ACTIONS.md` — Step D updated with TEST HARNESS import steps
- `docs/DECISIONS.md` — DEC-023 added
- `docs/AGENT_LOG.md` — this entry
- `core/hot/recent.md` — updated

**Not changed:**
- `n8n/workflows/02_claude_api_single_record_analysis.json` — untouched (production baseline)
- `modules/marketing-scout-v0/MARKETING_AGENT_PROMPT_V2.md` — untouched
- `modules/marketing-scout-v0/TEST_RECORDS_V2.md` — untouched

**Next session should start with:** `core/hot/recent.md` → `docs/NEXT_ACTIONS.md`
**Next action:** Step D — import TEST HARNESS into n8n, bind credentials, add Spreadsheet ID, run tests 1–7, record results

---

## 2026-06-05 — Prompt v2 Written; Test Records and Test Plan Created

**Agent role:** project-engineer / prompt-engineer
**Session goal:** Write Marketing Agent Prompt v2 based on confirmed business requirements; create test infrastructure.

**What was done:**
- Wrote `MARKETING_AGENT_PROMPT_V2.md` (~12 KB): full analyst-identity prompt with priority order (leads → competitors → content), confirmed ICP, region scoring rules, competitor threat framework, lead urgency model, content angle framing, 3-sentence structured reason field, evidence citation requirement, anti-hallucination additions, expanded skip rules. Schema unchanged (25 fields).
- Created `TEST_RECORDS_V2.md`: 7 synthetic records covering strong lead, weak lead, active competitor, RE landing page, content idea, SEO boilerplate, and refinancing edge case. Each record includes input JSON, expected entity_type, expected action, expected score ranges, pass criteria, and "why it matters" explanation.
- Created `docs/N8N_WORKFLOW_02_V2_TEST_PLAN_RU.md`: full Russian-language test guide — how to duplicate Workflow 02, swap the prompt, run 7 records, fill the protocol table, check costs, and decide whether v2 is approved.
- Added DEC-022 to `docs/DECISIONS.md`: no new JSON schema fields until v2 is validated in production.

**Files created:**
- `modules/marketing-scout-v0/MARKETING_AGENT_PROMPT_V2.md`
- `modules/marketing-scout-v0/TEST_RECORDS_V2.md`
- `docs/N8N_WORKFLOW_02_V2_TEST_PLAN_RU.md`

**Files updated:**
- `docs/PROMPTS.md` — v2 status updated; version history updated; token budget note updated
- `docs/AGENT_CAPABILITIES.md` — v2 improvements updated; risks table updated
- `docs/NEXT_ACTIONS.md` — Step C marked complete; Step D updated with 7-record procedure
- `docs/DECISIONS.md` — DEC-022 added
- `docs/AGENT_LOG.md` — this entry
- `core/hot/recent.md` — updated

**Not changed:**
- `n8n/workflows/02_claude_api_single_record_analysis.json` — not touched (awaiting test approval)

**Next session should start with:** `core/hot/recent.md` → `docs/NEXT_ACTIONS.md`
**Next action:** Step D — run 7 synthetic tests in n8n; follow `N8N_WORKFLOW_02_V2_TEST_PLAN_RU.md`; cost ~$0.10–0.20

---

## 2026-06-05 — Business Requirements Recorded After Uncle Consultation

**Agent role:** project-engineer
**Session goal:** Document uncle's business priorities and update all dependent files.

**Business requirements confirmed:**
- Priority order: lead signals → competitors → content ideas
- Region: Moscow + Moscow Oblast
- Products: PTS, auto collateral, real estate, refinancing, mortgage, business loans
- Source priority (business): Telegram, Instagram, Avito, Yandex / competitor websites
- Technical start sequence: competitor websites → Avito → Telegram → Instagram
- Useful row: helps identify/contact a lead, monitor a competitor, or extract a content insight

**Files created:**
- `docs/BUSINESS_REQUIREMENTS.md` — full BRD: business goal, priorities, source order, region, product scope, useful row definition, recommended actions, field mapping, open questions, Prompt v2 implications, Firecrawl/Apify implications, what not to build yet

**Files updated:**
- `docs/NEXT_ACTIONS.md` — Step A marked complete; Step C updated with confirmed ICP and priority order
- `docs/AGENT_CAPABILITIES.md` — confirmed business requirements section added; v2 improvements list updated with priority order and region filter
- `modules/marketing-scout-v0/MARKETING_AGENT_PROMPT_V2_PLAN.md` — priority order section added at top; ICP section rewritten with confirmed facts; region scoring rule added; product priority list added
- `docs/TABLE_SCHEMA.md` — uncle field mapping table added (no schema changes)
- `docs/AGENT_LOG.md` — this entry
- `core/hot/recent.md` — updated

**Next session should start with:** `core/hot/recent.md` → `docs/NEXT_ACTIONS.md`
**Next action:** Step B remaining fixes (README.md, tools/TOOLS.md, core/warm/decisions.md), then Step C — write Prompt v2

---

## 2026-06-05 — Documentation Consistency Fixes After Milestone Review 02

**Agent role:** project-engineer
**Session goal:** Fix all documentation drift identified in Milestone Review 02.

**Issues fixed:**
- `WORKFLOW_DESIGN.md`: gateway URL (anthropic.com → aiprimetech.io), auth format (x-api-key → Authorization Bearer), prompt reference (SYSTEM_PROMPT.md → MARKETING_AGENT_PROMPT_V1.md), parse pattern (content[0].text → find type=text), quality threshold (6 → 60), Google Sheets auth note (OAuth2 → Service Account)
- `TABLE_SCHEMA.md`: complete rewrite — scoring scale corrected to 1–100, competitor_strength changed from string to integer, entity_type values updated to match v1 prompt enums, status values corrected to analyzed/skipped, service_type values added, freshness_status corrected (stale → old), recommended_action values updated
- `docs/PROMPTS.md`: active prompt updated to MARKETING_AGENT_PROMPT_V1.md, version history added, v2 plan referenced, SYSTEM_PROMPT.md marked superseded, token and calibration guidance updated
- `docs/NEXT_ACTIONS.md`: restructured as Step A–E with explicit gates

**Files created:**
- `docs/AGENT_CAPABILITIES.md` — v1 can/cannot, v2 requirements, model/gateway facts, workflow chain, scoring fields, schema, risks, non-technical client explanation

**Files updated:**
- `modules/marketing-scout-v0/WORKFLOW_DESIGN.md` — 6 consistency fixes
- `docs/TABLE_SCHEMA.md` — complete rewrite (12 value/type corrections)
- `docs/PROMPTS.md` — active prompt, history, v2 plan, guidance updates
- `docs/NEXT_ACTIONS.md` — Step A/B/C/D/E structure with gates
- `docs/AGENT_LOG.md` — this entry
- `core/hot/recent.md` — updated

**Remaining doc fixes (deferred to operator):**
- `README.md` — update current stage
- `tools/TOOLS.md` — Google Sheets auth note; GitHub status
- `core/warm/decisions.md` — add DEC-018 through DEC-021

**Next session should start with:** `core/hot/recent.md` → `docs/NEXT_ACTIONS.md`

---

## 2026-06-05 — Milestone Review 02; Prompt v2 Plan Created

**Agent role:** project-engineer
**Session goal:** Full milestone review after Workflow 02; assess prompt quality; plan next steps.

**Review findings (see `docs/MILESTONE_REVIEW_02.md`):**
- 3 baselines proven: Workflow 00, 01, 02 ✓
- Core AI loop proven: n8n → Claude → parse → Quality Gate → Google Sheets ✓
- 7 risks identified before real scraping — prompt quality and unknown business requirements are top risks
- 12 documentation consistency issues identified
- Current prompt v1 assessed as extractor/classifier, not a marketing analyst
- Cost model baseline exists but needs real-page measurement

**Files created:**
- `docs/MILESTONE_REVIEW_02.md` — full review: proven, unproven, risks, docs issues, prompt assessment, cost assessment, security checklist, 5 recommended actions
- `modules/marketing-scout-v0/MARKETING_AGENT_PROMPT_V2_PLAN.md` — 15-section design plan for stronger agent prompt: ICP, competitive threat logic, lead urgency model, content angle framework, new JSON fields, test strategy

**Files updated:**
- `docs/AGENT_LOG.md` — this entry
- `docs/DECISIONS.md` — added DEC-021: no paid scraping until Prompt v2 ready and uncle consulted
- `docs/NEXT_ACTIONS.md` — restructured: Step A (uncle consult), Step B (Prompt v2), Step C (doc fixes); Blocked On updated
- `core/hot/recent.md` — updated

**Decisions recorded:** DEC-021

**Next session should start with:** `core/hot/recent.md` → `docs/NEXT_ACTIONS.md`

---

## 2026-06-05 — Workflow 02 Executed Successfully; Claude API + Google Sheets Confirmed

**Agent role:** project-engineer
**Session goal:** Record successful Workflow 02 execution and document measured API cost.

**Execution confirmed:**
- Workflow: `02 - Claude API Single Record Analysis`
- Credential: `Claude API - Marketing Scout` (HTTP Header Auth)
- Gateway: `https://aiprimetech.io/v1/messages`, model `claude-sonnet-4-6`
- Test input: Russian secured lending competitor record (займ под залог авто, Москва)
- Result: Claude returned valid JSON, Quality Gate passed, row appended to Google Sheets

**Google Sheets row confirmed:**
- `service_type` = `pts_loan`
- `quality_score` = 72
- `lead_signal_score` = 75
- `content_idea_score` = 80
- `competitor_strength` = 68
- `status` = `analyzed`
- `recommended_action` = `monitor`

**Path proven:** n8n → Claude API gateway → parse JSON → Quality Gate → Google Sheets ✓

**API cost measured:**
- Before: $0.0007 | After: $0.0122 | Delta: **$0.0115 per short scoring**
- ≈ 0.84 RUB per scoring at 73.41 RUB/USD
- 100 scorings ≈ $1.15 / 84 RUB; 1000 scorings ≈ $11.50 / 844 RUB
- See `docs/COSTS_AND_LIMITS.md` for full cost table

**Prompt duplication note recorded:**
- Active prompt is embedded in Build Claude Request node AND stored in `MARKETING_AGENT_PROMPT_V1.md`
- MARKETING_AGENT_PROMPT_V1.md is the canonical source — update both on any prompt change
- See DEC-020

**Files updated:**
- `docs/AGENT_LOG.md` — this entry
- `docs/NEXT_ACTIONS.md` — Workflow 02 marked complete; Workflow 03 / pre-filter added; uncle consultation step added
- `docs/DECISIONS.md` — added DEC-020: prompt duplication in v0.1
- `docs/N8N_WORKFLOW_02_CLAUDE_API_RU.md` — status updated to completed; execution result added
- `modules/marketing-scout-v0/MARKETING_AGENT_PROMPT_V1.md` — confirmed active; duplication warning added
- `tools/TOOLS.md` — Claude API and Google Sheets status updated; cost reference added
- `docs/COSTS_AND_LIMITS.md` — created: cost baseline, estimates, formula, caveats

**Decisions recorded:** DEC-020

**Baselines locked:**
- Workflow 02 (`02_claude_api_single_record_analysis.json`) — Claude API + Google Sheets baseline

**Next session should start with:** `core/hot/recent.md` → `docs/NEXT_ACTIONS.md`

---

## 2026-06-05 — Workflow 02 Created: Claude API Single Record Analysis

**Agent role:** project-engineer
**Session goal:** Create Workflow 02 — first real AI-agent workflow using Claude API as Marketing Scout Agent.

**Files created:**
- `modules/marketing-scout-v0/MARKETING_AGENT_PROMPT_V1.md` — production system prompt (~8 KB): secured lending domain, 1–100 scoring, skip conditions, entity/service type enums, full output JSON schema
- `n8n/workflows/02_claude_api_single_record_analysis.json` — importable n8n workflow JSON: 9 nodes, valid, active=false, no real credentials
- `docs/N8N_WORKFLOW_02_CLAUDE_API_RU.md` — Russian operator guide: setup, run, expected output, 6 error cases, client explanation, pointer to Workflow 03

**Workflow structure:**
- Manual Start → Set Test Competitor Data → Build Claude Request (Code) → Claude API Request (HTTP) → Parse Claude JSON Response (Code) → Quality Gate (IF, quality_score >= 60) → Append Row to Google Sheets
- Gateway: `https://aiprimetech.io/v1/messages`, auth: HTTP Header Auth (`Claude API - Marketing Scout`)
- Model: `claude-sonnet-4-6`
- Parse node: finds content item by `type === 'text'`; strips markdown fences; safe error fallback
- Quality Gate: passes if `status === 'analyzed'` AND `quality_score >= 60`

**Validation:** JSON parsed successfully — 9 nodes, all names correct, active=false

**Decisions recorded:** DEC-019

**Next session should start with:** `core/hot/recent.md` → `docs/NEXT_ACTIONS.md`

---

## 2026-06-05 — Claude-Compatible API Gateway Tested Successfully

**Agent role:** project-engineer
**Session goal:** Record successful Claude-compatible API gateway compatibility test and update all related documentation.

**Test confirmed:**
- Base URL: `https://aiprimetech.io`
- Endpoint: `/v1/messages`
- Auth format: `Authorization: Bearer <token>` (HTTP Header Auth)
- Working model ID: `claude-sonnet-4-6`
- Non-working model ID: `claude-sonnet-4.6` — returned "No available accounts" (dot notation rejected)
- Test request succeeded — response included a valid content array with a message response

**Parsing requirements identified:**
- Response may include a `thinking` content item before the text item
- n8n Code node must select `content` item where `type == "text"` — do not blindly use `content[0].text`
- System prompt must explicitly forbid markdown/code fences — otherwise Claude may wrap JSON in backtick blocks

**Credential configuration for n8n:**
- Credential name: `Claude API - Marketing Scout`
- Type: HTTP Header Auth
- Header: `Authorization`, value: `Bearer <token>`
- API key stored only in n8n credential manager — never committed to Git

**Files updated:**
- `docs/AGENT_LOG.md` — this entry
- `docs/DECISIONS.md` — added DEC-018: Claude-compatible gateway auth and model ID format
- `docs/NEXT_ACTIONS.md` — Workflow 02 pre-steps updated with gateway test results and parsing warnings
- `tools/TOOLS.md` — Claude API entry updated with gateway URL, model ID, auth format, and parsing notes
- `modules/marketing-scout-v0/SYSTEM_PROMPT.md` — added gateway compatibility note and updated parsing code snippet

**Decisions recorded:** DEC-018

**Next session should start with:** `core/hot/recent.md` → `docs/NEXT_ACTIONS.md`

---

## 2026-06-04 — Workflow 01 Executed Successfully; Google Sheets Integration Confirmed

**Agent role:** project-engineer
**Session goal:** Record successful Workflow 01 execution and document the header fix discovered during testing.

**Execution confirmed:**
- Workflow: `01 - Google Sheets Append Row Test`
- Credential: `Google Sheets - Marketing Scout Service Account` (Service Account)
- Sheet: `Marketing Scout Results` → tab `results`
- Result: row appended — `status=analyzed`, `quality_score=75`, `source_type=manual_test`, `platform=test`
- Path proven: n8n → Google Service Account → Google Sheets Append Row

**Issue discovered and resolved:**
- Table initially had field names entered vertically in column A (rows 1–25) instead of horizontally in row 1
- Fix: deleted rows 2–25, kept only row 1 as the single horizontal header row
- Decision recorded as DEC-017

**Files updated:**
- `docs/AGENT_LOG.md` — this entry
- `docs/NEXT_ACTIONS.md` — Workflow 01 marked complete with note on header fix; Workflow 02 (Claude API) added as next action with concrete pre-steps
- `docs/DECISIONS.md` — added DEC-017: single horizontal header row required in Google Sheets
- `docs/N8N_WORKFLOW_01_GOOGLE_SHEETS_RU.md` — status updated to completed; do-not-modify note added; section on header layout and Git commit warning added

**Decisions recorded:** DEC-017

**Baselines locked:**
- Workflow 00 (`00_healthcheck_manual_test.json`) — platform healthcheck
- Workflow 01 (`01_google_sheets_append_row_test.json`) — Google Sheets baseline

**Next session should start with:** `core/hot/recent.md` → `docs/NEXT_ACTIONS.md`

---

## 2026-06-04 — Workflow 01 Google Sheets JSON Generated and Validated

**Agent role:** project-engineer
**Session goal:** Generate importable n8n workflow JSON for Workflow 01 and write the Russian operator guide.

**Files created:**
- `n8n/workflows/01_google_sheets_append_row_test.json` — importable n8n workflow JSON:
  6 nodes (2 Sticky Notes, Manual Trigger, Set/Edit Fields, Code, Google Sheets append),
  no real credentials (placeholder `PASTE_CREDENTIAL_ID_HERE`),
  no real Spreadsheet ID (placeholder `PASTE_SPREADSHEET_ID_HERE`),
  `active: false`, explicit positions, connections Manual Start → Set → Code → Google Sheets.
  Google Sheets node: `n8n-nodes-base.googleSheets v4`, operation `append`,
  `autoMapInputData` mode, sheet name `results`.
  Validated: 9/9 checks passed.
- `docs/N8N_WORKFLOW_01_GOOGLE_SHEETS_RU.md` — Russian guide: purpose, pre-import steps,
  import instructions, 3 manual config items (credential, Spreadsheet ID, sheet name),
  expected n8n output, expected Google Sheet row (25 fields), error table (6 errors),
  non-technical client explanation, pointer to Workflow 02

**Files updated:**
- `docs/NEXT_ACTIONS.md` — Workflow 01 expanded with pre-import, import, configure, and run steps;
  JSON filename corrected; "Blocked On" updated
- `docs/DECISIONS.md` — added DEC-016: Service Account chosen over OAuth2 for Google Sheets
- `docs/AGENT_LOG.md` — this entry

**Decisions recorded:** DEC-016

**Next session should start with:** `core/hot/recent.md` → `docs/NEXT_ACTIONS.md`

---

## 2026-06-04 — Workflow 00 Executed Successfully; JSON Delivery Method Confirmed

**Agent role:** project-engineer
**Session goal:** Record successful Workflow 00 execution and lock the JSON delivery method as standard practice.

**Execution confirmed:**
- Workflow: `00 - Healthcheck Manual Test`
- Import source: `n8n/workflows/00_healthcheck_manual_test.json` (via GitHub / file copy)
- Result: succeeded — `status=analyzed`, `quality_score=75`, no red nodes
- Full path proven: Claude Code → JSON → GitHub → n8n import → execution

**Files updated:**
- `docs/AGENT_LOG.md` — this entry
- `docs/NEXT_ACTIONS.md` — Workflow 00 marked complete; Workflow 01 (Google Sheets Append Row Test) added as next action with concrete tasks
- `docs/N8N_WORKFLOW_00_HEALTHCHECK_RU.md` — status updated to completed; do-not-modify note added
- `docs/DECISIONS.md` — added DEC-015: JSON workflow delivery confirmed as standard method; Workflow 00 locked as healthcheck baseline

**Decisions recorded:** DEC-015

**Next session should start with:** `core/hot/recent.md` → `docs/NEXT_ACTIONS.md`

---

## 2026-06-04 — Workflow 00 Healthcheck JSON Generated and Validated

**Agent role:** project-engineer
**Session goal:** Generate an importable n8n workflow JSON for Workflow 00 and add import instructions to the Russian guide.

**Files created:**
- `n8n/workflows/00_healthcheck_manual_test.json` — importable n8n workflow JSON:
  5 nodes (2 Sticky Notes, Manual Trigger, Set/Edit Fields, Code), no credentials,
  `active: false`, explicit positions, connections Manual Start → Set → Code.
  Validated: valid JSON, `nodes` array, `connections` object, no credentials,
  inactive by default, all positions present, all required node names present.

**Files updated:**
- `docs/N8N_WORKFLOW_00_HEALTHCHECK_RU.md` — added "Импорт через JSON" section:
  import from file, import from clipboard with `cat` command, how to run Manual Trigger,
  expected output JSON, troubleshooting table; status line updated to reflect JSON ready
- `docs/NEXT_ACTIONS.md` — Workflow 00 tasks updated: manual node-by-node build replaced
  with single import step; clipboard command added; "Blocked On" updated
- `docs/AGENT_LOG.md` — this entry

**Validation results:** 9/9 checks passed (valid JSON, nodes array, connections object,
no credentials, active=false, all positions, all required names, connection integrity)

**Next session should start with:** `core/hot/recent.md` → `docs/NEXT_ACTIONS.md`

---

## 2026-06-04 — Workflow 00 Healthcheck Guide Created (Russian)

**Agent role:** project-engineer
**Session goal:** Write a Russian step-by-step guide for the first n8n workflow — no external APIs.

**Files created:**
- `docs/N8N_WORKFLOW_00_HEALTHCHECK_RU.md` — full Russian guide for `00 - Healthcheck Manual Test`:
  5-node workflow (Sticky Note × 2, Manual Trigger, Edit Fields/Set, Code),
  exact node configuration, both Sticky Note texts in Russian,
  test data JSON, Code node JavaScript, expected output JSON,
  client-facing explanation, error diagnostics table, pointer to next workflow

**Files updated:**
- `docs/NEXT_ACTIONS.md` — Step 6 restructured as incremental workflow ladder
  (Workflow 00 → 01 → 10); Workflow 00 tasks listed; "Blocked On" updated
- `docs/AGENT_LOG.md` — this entry

**Next session should start with:** `core/hot/recent.md` → `docs/NEXT_ACTIONS.md`

---

## 2026-06-04 — n8n Successfully Deployed on VPS

**Agent role:** project-engineer
**Session goal:** Record confirmed n8n deployment and update all related documentation.

**Deployment confirmed:**
- Container `n8n-n8n-1` running — port binding `127.0.0.1:5678->5678/tcp`
- Access verified via SSH tunnel → `http://localhost:5678` in local browser
- Execution pruning added to `n8n.env`:
  - `EXECUTIONS_DATA_PRUNE=true`
  - `EXECUTIONS_DATA_MAX_AGE=168`
  - `EXECUTIONS_DATA_PRUNE_MAX_COUNT=1000`
- Disk after launch: ~1.4G free, 86% used — acceptable for MVP, upgrade deferred

**Files updated:**
- `docs/AGENT_LOG.md` — this entry
- `docs/NEXT_ACTIONS.md` — Step 3 marked complete; Step 6 updated with first workflow action
- `docs/DECISIONS.md` — added DEC-013 (disk constraint), DEC-014 (execution pruning)
- `tools/TOOLS.md` — n8n status updated to Active with deployment details
- `docs/N8N_DEPLOYMENT.md` — added Deployment Status section and disk warning

**Decisions recorded:** DEC-013, DEC-014

**Next session should start with:** `core/hot/recent.md` → `docs/NEXT_ACTIONS.md`

---

## 2026-06-04 — n8n Deployment Templates Created

**Agent role:** project-engineer
**Session goal:** Prepare n8n deployment templates for v0.1 — localhost-only, SSH tunnel access, no real secrets.

**Files created:**
- `scripts/docker-compose.n8n.example` — minimal Docker Compose for n8n: localhost port binding, n8n_data volume, env_file reference, commented
- `scripts/n8n.env.example` — all required env vars with MVP-safe values; placeholder for N8N_ENCRYPTION_KEY with generation instruction
- `docs/N8N_DEPLOYMENT.md` — full deployment guide: SSH tunnel rationale, copy steps, key generation, start/logs/update commands, what not to commit, future HTTPS path

**Files updated:**
- `docs/DECISIONS.md` — added DEC-010 (localhost binding + SSH tunnel), DEC-011 (no public domain/HTTPS for v0.1), DEC-012 (real credentials outside Git)
- `docs/NEXT_ACTIONS.md` — Step 2 marked complete with deploy commands summary
- `docs/AGENT_LOG.md` — this entry

**Decisions recorded:** DEC-010, DEC-011, DEC-012

**Next session should start with:** `core/hot/recent.md` → `docs/NEXT_ACTIONS.md`

---

## 2026-06-04 — Docker Compose Installation State Documented

**Agent role:** project-engineer
**Session goal:** Record Docker Engine and Docker Compose installation state discovered on VPS.

**Context recorded:**
- Docker Engine v29.1.3 — active, 3 containers running, 39 images, overlayfs storage driver
- Docker Compose v5.1.2 — installed manually at `/usr/local/lib/docker/cli-plugins/docker-compose`
- `apt install docker-compose-plugin` failed (package not found); manual binary install used instead
- Existing containers are running — no destructive Docker cleanup without explicit approval

**Files edited:**
- `tools/TOOLS.md` — added Docker Engine and Docker Compose entries under Infrastructure with version, install method, and migration warning
- `docs/DECISIONS.md` — added DEC-009 documenting manual install decision and safety note
- `docs/NEXT_ACTIONS.md` — marked Docker/Compose checks complete; added note referencing DEC-009
- `docs/AGENT_LOG.md` — this entry

**Next session should start with:** `core/hot/recent.md` → `docs/NEXT_ACTIONS.md`

---

## 2026-06-04 — Pre-Commit Fix: Claude API Response Format

**Agent role:** project-engineer
**Session goal:** Fix broken instruction found during pre-commit review.

**Files edited:**
- `modules/marketing-scout-v0/WORKFLOW_DESIGN.md` — corrected Node 6 Output description: replaced incorrect OpenAI response format (`choices[0].message.content`) with correct Anthropic Claude API format (`content[0].text`)
- `docs/AGENT_LOG.md` — this entry

**Next session should start with:** `core/hot/recent.md` → `docs/NEXT_ACTIONS.md`

---

## 2026-06-04 — Autonomy Rules Update in CLAUDE.md

**Agent role:** project-engineer
**Session goal:** Reduce friction in CLAUDE.md while preserving server safety.

**Files edited:**
- `CLAUDE.md` — four targeted changes to operating and safety rules; new Autonomy Levels section added
- `docs/AGENT_LOG.md` — this entry

**Changes made:**
- **Operating Rules:** Replaced generic "ask before creating or editing files" with a precise rule:
  Markdown docs inside the project are autonomous; scripts, configs, Docker files, workflow exports,
  secrets, system commands, external API calls, deployment, deletion, and anything outside the project
  directory require explicit approval.
- **Forbidden list:** Replaced blanket prohibition on `scripts/`, `n8n/workflows/`, `backups/` with
  a targeted rule: real scripts/exports/backups require approval; `.example` templates are autonomous.
- **Forbidden list:** Replaced "Connecting to external APIs" with "Calling real external APIs or
  using real credentials" — tighter scope.
- **New section — Autonomy Levels:** Three-tier model (Green / Yellow / Red) with explicit item lists,
  replacing ambiguous prose with a scannable reference.

**Next session should start with:** `core/hot/recent.md` → `docs/NEXT_ACTIONS.md`

---

## 2026-06-04 — Documentation Review and Fixes

**Agent role:** project-engineer
**Session goal:** Review all foundation documents for consistency, specificity, and safety; apply approved fixes.

**Files edited:**
- `modules/marketing-scout-v0/WORKFLOW_DESIGN.md` — rewrote Node 3 as 3a/3b/3c (start actor, wait, fetch dataset); added Node 4 (Split Out) with explanation; removed invalid `{{ $credentials.x.y }}` syntax; replaced Node 5 credential note; added Node 9 (Aggregate Code node) with real JavaScript; renumbered Telegram node to 10; added response parsing note after Claude API node
- `docs/ARCHITECTURE.md` — updated pipeline diagram to 10 nodes including Split Out and Aggregate; added Key Implementation Notes section explaining Split Out, Apify v0.1 approach, credential rule, and SSH tunnel access
- `CLAUDE.md` — scoped the external API safety rule to distinguish documentation sessions (no calls) from implementation sessions (calls allowed only with explicit per-service approval)
- `modules/marketing-scout-v0/SYSTEM_PROMPT.md` — added full fallback behavior block for low-quality/boilerplate input (returns quality_score: 1, status: "skipped"); added explicit no-hallucination instruction; added `status` field to both normal and skipped JSON schemas; added response parsing code snippet for n8n
- `docs/NEXT_ACTIONS.md` — added Step 2 (prepare docker-compose.yml before running Docker); added SSH tunnel access instructions; added note that public HTTPS is deferred; renumbered steps; added docker-compose.n8n.example as next concrete action
- `docs/ROADMAP.md` — added module directory path to all 6 stages
- `docs/AGENT_LOG.md` — added this entry
- `docs/DECISIONS.md` — added DEC-006, DEC-007, DEC-008

**Issues resolved:**
- Apify polling ambiguity → simple start/wait/fetch pattern for v0.1
- Invalid n8n credential expression syntax → removed, replaced with UI credential picker instructions
- Missing loop/split node in architecture → Split Out node added at Node 4
- Telegram summary unresolved placeholders → Aggregate Code node (Node 9) computes all values
- External API rule too broad → scoped by session type
- No fallback for boilerplate input in system prompt → explicit skipped JSON block added
- NEXT_ACTIONS Step 2 missing docker-compose reference → added with SSH tunnel instructions
- Roadmap missing module directory names → added to all 6 stages

**Next session should start with:** `core/hot/recent.md` → `docs/NEXT_ACTIONS.md`

---

## 2026-06-04 — Project Structure Bootstrap

**Agent role:** project-engineer
**Session goal:** Create lightweight project-agent structure for Marketing Scout

**Files created:**
- `CLAUDE.md` — main agent instruction file
- `README.md` — project root orientation
- `core/AGENTS.md` — five future agent role definitions
- `core/USER.md` — operator profile (Nik)
- `core/rules.md` — green zone / red zone operating boundaries
- `core/MEMORY.md` — long-term memory index
- `core/hot/recent.md` — hot memory, first entry
- `core/warm/decisions.md` — five stable design decisions
- `tools/TOOLS.md` — full stack inventory with availability matrix
- `docs/PROJECT_BRIEF.md` — business goal and MVP definition
- `docs/ROADMAP.md` — six-stage roadmap
- `docs/ARCHITECTURE.md` — pipeline diagram and component roles
- `docs/AGENT_LOG.md` — this file
- `docs/DECISIONS.md` — decision register
- `docs/NEXT_ACTIONS.md` — immediate next steps
- `docs/TABLE_SCHEMA.md` — full 23-column output schema
- `docs/PROMPTS.md` — prompt version register
- `modules/marketing-scout-v0/README.md` — module overview
- `modules/marketing-scout-v0/WORKFLOW_DESIGN.md` — 8-node n8n workflow spec
- `modules/marketing-scout-v0/SYSTEM_PROMPT.md` — Claude API system prompt v1
- `modules/marketing-scout-v0/TEST_DATA.md` — 3 sample records
- `n8n/README.md` — n8n directory guide
- `scripts/backup.sh.example` — example backup script
- `scripts/restore.sh.example` — example restore script
- `backups/README.md` — backup directory guide

**Decisions made:** DEC-001 through DEC-005 (see `docs/DECISIONS.md`)

**Next session should start with:** `core/hot/recent.md` → `docs/NEXT_ACTIONS.md`
