# AGENT_CAPABILITIES.md — Marketing Scout Agent Capabilities Reference

**Last updated:** 2026-06-11 (**Stage 3.3 live relevance filter + Stage 3.4 architecture pack** — DEC-095: live retest #2 (`avito_req_20260611_001222`) proved the Apify transport (10/10 valid items) but both unique rows were **legal-address false positives** → WF09 v005 adds a **business relevance filter**: relevance from title/description/decoded-URL-slug/category only (the search query never makes a listing relevant); strong credit/broker phrases → `competitor_activity`; hard negatives (юр. адрес, регистрация ООО/ИП, бухгалтерия, эквайринг, POS-терминал, касса, печать, ЭЦП, аренда офиса…) without strong credit evidence → `hard_skipped` (not written to raw/registry; filtered **before** `pipeline_limit=10`, which now applies only to accepted business-relevant records); 8-count `result_summary`; canonical listing URLs; fixture path unchanged (simulation 31 checks PASS). Live retest #3 pending — Stage 3.3 closes only after a clean live run. **Architecture pack (docs only, nothing built):** `CONTACT_AND_OUTREACH_POLICY.md` (DEC-097/098 — **binding**: public contacts only with `contact_source_url` evidence; `contact_use_policy` manager_allowed/manual_review/no_outreach/aggregate_only; leads without public contact → `review_queue`; **no auto-outreach by default**), `STAGE_3_4_SOCIAL_SOURCE_PARSING_STRATEGY.md` (DEC-096 — one source at a time: Avito → Telegram public → VK API → reviews/maps → Dzen → Instagram after risk review), `WF10_COMPETITOR_AUDIENCE_INTELLIGENCE_AGGREGATOR_PLAN.md` (DEC-099 — WF10 planned, build gated on a stable live source; competitor_profiles/market_angles/audience_activity_signals/content_positioning_plan), `NICHE_PACK_SYSTEM_PLAN.md` (DEC-100 — niche packs to replace hardcoded credit-broker rules), `COMPETITOR_AD_INTELLIGENCE_PLAN.md` (DEC-101 — first-class capability).) — (prior: 2026-06-10 **Stage 3.3 Competitor Ad Intelligence quality patch** — DEC-092: WF09 fixture-count clarity (`max_items=6` = total fixture records incl. the irrelevant control; `requested_limit` matches actual output) + richer `service_hint` (credit_broker/business_credit/credit_after_refusals/mortgage_refinance/unknown) + concrete `semantic_keywords` + Apify live node wired for HTTP Header Auth (no secrets, runs only when `fixture_mode=false`). WF08 deterministically enriches Avito/classified competitor rows (gated to WF09-origin rows): `offer_text`=listing title, `terms`=price+conditions, preserved specific `service_type`, `content_idea_score` 35–55, `competitor_strength` 75–85, competitor-ad `reason` — **no Claude, routing & Stage 3.2 baseline unchanged**. **Fixture + WF08 handoff PASS (monitor 5 / skipped 1 / technical_errors 0 / Claude 0); live Avito scrape NOT tested** (`fixture_mode=true`, `live_mode=false`, source cost $0, Apify node did not run). See `docs/STAGE_3_3_TEST_RESULTS.md`.) — (prior: **Stage 3.3 BUILT — Avito/Classifieds Listing Connector** — DEC-090: `Workflow 09` (`active=false`, **fixture mode by default, $0, no Apify call, no LLM**) is the first real source connector after manual intake. It transforms Avito/classified listings into `raw_market_records` (deterministic normalize + `market_record_registry` dedup + one `agent_requests` row), supporting **Competitor Ad Intelligence / Semantic Intelligence** (offers, prices/terms, ad wording, positioning, semantic keywords, ad channels). Writes only `agent_requests`/`raw_market_records`/`market_record_registry`; **never** business tabs; **no auto-handoff** to Workflow 08. Live Apify mode documented + disabled by default. Build-sim: fixture run → 6 raw / 6 unique / 1 agent_requests, predicted `monitor_queue=5`/`skipped_log=1`. See `docs/N8N_WORKFLOW_09_AVITO_CLASSIFIEDS_CONNECTOR_RU.md`, `docs/STAGE_3_3_AVITO_CLASSIFIEDS_CONNECTOR_PLAN.md`, `docs/STAGE_3_3_TEST_RESULTS.md`.) — (prior: **Stage 3.2 CLOSED — Test C4 PASS** — DEC-089: the v7 specialized-schema retest passed — 4 fixtures, `technical_errors=0`, **`primary_json=3/4`**, `repaired_json=0/4`, **`deterministic_fallback_after_llm_fail=1/4`** (the Banki/forum lead-pattern, safe), `repair_used=false` for the 3 `primary_json` rows, MSK `+03:00` OK, routes preserved, **Telegram `source_candidate` fixed** (`primary_json` → `content_queue`/`content_idea`/`create_content`). **Verdict:** deterministic_first baseline APPROVED + **compact LLM enrichment APPROVED WITH WATCH ITEM** for optional / test use; **default stays `deterministic_first` unless the operator explicitly enables `llm_enrichment`**; watch item = the Banki/forum lead-pattern still falls back (safe). C4 cost delta: TODO_OPERATOR_FILL. **Stage 3.3 (Avito/Classifieds Listing Connector, DEC-084) unblocked — proceed after commit.** See `docs/STAGE_3_2_TEST_RESULTS.md`.) — (prior: **Workflow 08 specialized source_candidate schema v7** — DEC-088: Test C3 was a PARTIAL PASS (4 fixtures processed, `technical_errors=0`, routes preserved, quality improved for Avito/Banki/Zoon, but `primary_json=2/4` because the **Telegram `source_candidate` still fell back**). v7 gives source_candidate / `source_type=social_channel` / Telegram a **specialized ultra-short 7-key enrichment schema** (`profile_name, service_type, offer_text, detected_need, reason, content_idea_score, quality_score`) with a minimal payload; repair uses the same 7-key schema; a **post-merge safety assertion** keeps route/entity/action/contact/lead/competitor deterministic; specialized `max_tokens` 500/400 (no cost increase). Avito/Banki/Zoon untouched.) — (prior: **Workflow 08 enrichment-quality patch v6** — DEC-087: Test C2 attempt #2 PARTIAL PASS; shorter compact prompt + deterministic HINTS for source_candidate/review_source; review directories are competitors only when a `competitor_name` is named (Zoon generic → `content_idea`/`content_queue`, competitor_strength ≤45); deterministic sanitizers strip no-contact outreach phrases and unsupported trend claims.) — (prior: **Workflow 08 C2 filter fix** — DEC-086: C2 attempt #1 wrote only record 1 because the test filter used `return []` inside `Build Deterministic Row` (stalls the Split-in-Batches loop); v5 moves C2 filtering pre-loop into `Filter & Select Records`.) — (prior: **Workflow 08 C2 filter fix** — DEC-086: C2 attempt #1 wrote only record 1 because the test filter used `return []` inside `Build Deterministic Row` (stalls the Split-in-Batches loop); v5 moves C2 filtering pre-loop into `Filter & Select Records` (loop gets exactly the 4 fixtures), removes the empty return, and `Final Summary` now reports `selected_count` + test flags.) — (prior: **Workflow 08 LLM enrichment v4** — DEC-085: enrichment-only compact JSON merged into the deterministic row; Claude no longer generates the full row; `thinking` disabled; first enrichment run (Test C, full-row) was PARTIAL PASS/NOT APPROVED at $0.0967/4.) — (prior: **Stage 3.2 FINALIZED** — deterministic_first baseline APPROVED (Test 3), LLM enrichment optional/test-gated, all workflow timestamps now Moscow `+03:00`; Stage 3.3 first source recommended = Avito/Classifieds, no connector built — DEC-083/084. See `docs/STAGE_3_3_SOURCE_DECISION_PLAN.md`.) — (prior: **Stage 3.0 Lead Source Evaluation WRITTEN** — evaluation only, nothing built — DEC-077. See `docs/STAGE_3_LEAD_SOURCE_EVALUATION.md`.) — (prior: **Stage 2 FINALIZED — APPROVED with minor limitations** — DEC-074. Real results: `docs/STAGE_2_FINAL_TEST_RESULTS.md`. Auto-handoff 06→04 evaluated and **deferred** to Stage 2.4 — DEC-075, `docs/WORKFLOW_06_AUTO_HANDOFF_PLAN.md`. Stage 3 starts with Lead Source Evaluation, not the bot — DEC-076. No workflow logic changed this pass.)

## Web Pipeline Status (2026-06-07) — ✅ APPROVED WITH MINOR LIMITATIONS

- ✅ **APPROVED — Web competitor discovery pipeline `05 → 06 → 04`** (manual, human-approval-gated, **modular — not a monolith**, DEC-071/074). Real-run results: WF05 discovery PASS, WF06 runtime registry recheck PASS (Test 4: 0 selected / 18 skipped on already-processed URLs), WF04 PTS override PASS (Test 6: `autolombardn1.ru`→`pts_loan`), manual handoff PASS. See `docs/STAGE_2_FINAL_TEST_RESULTS.md`.
  - **Workflow 05** — APPROVED **web search candidate discovery** (Apify search; human approval before spend). No Firecrawl/Claude node; 26-col `url_candidates` + 18-col `discovery_requests`; `candidate_type` + domain extraction + `duplicate_in_registry`; no business-tab writes.
  - **Workflow 06** — APPROVED approved-candidate runner; **always re-checks `url_registry` at runtime** (DEC-073); runner modes (below).
  - **Workflow 04** — APPROVED **URL consumer** + resilient parse/repair + placeholder prefilter + **stronger PTS `service_type` override** (≥3 of expanded strong-token set incl. ЭПТС/займ под залог ПТС/автомобиль остаётся/машина остаётся/любая кредитная история) + **deterministic contact extraction/sanitation** (DEC-070): valid full contacts kept (phone/email/`@handle`/`t.me`/`wa.me`/contact-URL), partials blanked, `wa.me/<digits>` not misread as a phone.
- ✅ **Workflow 06 runner modes (DEC-072)** — implemented + simulation-validated (live re-test recommended, watch item W1): **`first_pass_domain_diversity`** (DEFAULT) = max 1 URL/domain/run (second+ → `duplicate_domain_in_run`); **`deep_domain_analysis`** (EXPLICIT) = up to 3 URLs/domain/run (extras → `domain_deep_limit`, deep-mode warning). Set via **Set Runner Config**. Registry recheck + `max_per_run=5` + `manual_handoff_to_workflow_04` + root-first priority preserved; `url_registry` semantics unchanged.
- 🟥 **DEFERRED — Auto-handoff 06→04 (Stage 2.4, DEC-075):** evaluated, not built; manual handoff remains. Plan + blockers in `docs/WORKFLOW_06_AUTO_HANDOFF_PLAN.md`.
- ⚠️ **Manual limitations (accepted):** human approval required; manual 06→04 handoff; candidates marked `processed` manually after WF04 confirmation; Telegram bot / lead connectors / universal `market_profile` not built.
- 📐 **PLANNED — Lead Discovery Layer (design only, DEC-067/068/069/076):** source connectors + source-agnostic analyzer + separate `raw_market_records`/`lead_discovery_requests`/`market_record_registry` schema. **Nothing built.** Next gate: **Stage 3.0 Lead Source Evaluation** (Avito first, Telegram second; not the bot). See `docs/LEAD_DISCOVERY_ARCHITECTURE.md`, `docs/LEAD_SOURCE_CONNECTORS_PLAN.md`.
- ❌ **NOT APPROVED / NOT BUILT:** Avito scraping, Telegram parsing, VK/Instagram/Yandex connectors, **Telegram Control Bot** (control interface ≠ parser — DEC-067), auto-handoff 06→04, universal `market_profile` schema.
**Active agent version:** Marketing Scout Agent v2 (`MARKETING_AGENT_PROMPT_V2.md`, baseline d350069)
**Active workflow candidate:** `n8n/workflows/02_claude_api_single_record_v2_resilient_router_production.json`
**Test status:** Resilient Router Tests A–E **all pass**. Production workflow built (33 columns). **First manual production smoke test FAILED** (repair API 502 → technical_errors with lost diagnostics); workflow **patched** (DEC-038): primary raw preserved, compact repair payload, dual Primary+Repair diagnostics, primary prompt reminder. **Production workflow is NOT approved for Firecrawl until the patched manual smoke test passes.**

## Currently Approved Capabilities (Production-hardened, 2026-06-06, DEC-037)

- **Hot lead detection** → `results` tab (lead_signal, score ≥ 70, action `contact`).
- **Weak/potential lead review routing** → `review_queue` (score 30–69 / investigate / social-classified product mention), normalized action `investigate`.
- **Competitor monitor routing** → `monitor_queue` (competitor_strength ≥ 45), with descriptive `company_name` fallback.
- **Repair Formatter fallback** — second Claude call reformats unparseable output without re-analysis or invented facts.
- **Technical-error visibility** → `technical_errors` tab with `needs_manual_review=true`.
- **Dynamic-sheet routing** — one Google Sheets node, `Sheet Name = {{ $json.route }}`, route validation enforces a valid tab.
- **Production workflow** `02_claude_api_single_record_v2_resilient_router_production.json` — no test/mock fields, 33 output columns, `raw_response_preview` capped at 500, `recommended_action` normalized to route.
- **Firecrawl single-URL competitor website ingestion** ✅ APPROVED (manual, controlled — DEC-045). `03_firecrawl_single_url_resilient.json` scrapes one public URL via `POST /v2/scrape` (markdown only), normalizes (`text_context`≤6000), feeds the copied resilient analyzer with post-repair consistency hardening (DEC-043/044); Firecrawl failures → `technical_errors` without a Claude call. Two passing real tests (2026-06-08): `mosinvestfinans.ru/` and `lioncredit.ru/…/kredit-pod-zalog-nedvizhimosti`.
- **Competitor website → `monitor_queue` routing** ✅ APPROVED — competitor pages with offer/rates/region/contact route to `monitor_queue` with `recommended_action=monitor`.
- **Firecrawl URL list mini-batch (≤5 URLs, manual)** ✅ APPROVED (2026-06-08, DEC-053/054/062) — `04_firecrawl_url_list_resilient.json`. 3–5 URLs/run, manual trigger only, per-URL loop, 35-field business schema (`run_id`+`batch_index`). Validated on 3-URL + 5-URL runs **and a manual end-to-end test with Workflow 05** (`carcapital.ru/` discovered → approved → `monitor_queue`). Output hardened: URL/path service-type override + **content-based service_type override for focused root pages (DEC-062)** + Russian output-language guard + **`contact_public` sanitation (DEC-063): partial/placeholder contacts blanked unless an exact phone/email/Telegram/contact-URL is present**. 25 nodes; JSON valid; active=false.
- **Placeholder / parking-page skip** ✅ APPROVED (2026-06-08, DEC-054) — `Normalize Firecrawl Output` detects obvious placeholder/domain-not-connected pages (Wix not-connected, parking page, `сайт/домен не подключен`, bare "coming soon" with no business content) and routes them to `skipped_log` (`parse_method=firecrawl_placeholder_prefilter`) **before** any Claude call; still appended to `url_registry`.
- **URL `url_registry` dedup** ✅ APPROVED (2026-06-08, DEC-051/053) — dedup keyed on `normalized_source_url` (full URL **with path**, not domain) in a dedicated `url_registry` tab, checked before Firecrawl/Claude; duplicate → `skipped_log`/`dedup_source_url`, **zero cost**. Registry appended after every non-duplicate attempt and is the **source of truth** (old rows dedup only if backfilled — optional).
- **Deterministic competitor fallback** ✅ APPROVED (2026-06-08, DEC-052) — after primary+repair JSON failure, emits a structured `competitor`/`monitor_queue` row (`needs_manual_review=true`) instead of dropping to `technical_errors`.
- **Workflow 04 as URL consumer** ✅ APPROVED (DEC-055) — Workflow 04 is the URL **consumer** (≤5 approved URLs → dedup → Firecrawl → Claude → routing). The URL **supplier** (discovery) is a separate, planned layer.

**Under test (built, awaiting operator manual test):**
- **Avito/Classifieds Listing Connector — Competitor Ad / Semantic Intelligence (Workflow 09, Stage 3.3 — DEC-090)** 🔧 BUILT, UNDER TEST — `09_avito_classifieds_listing_connector.json` (JSON valid, `active=false`, **fixture mode default, $0**). First real source connector after manual intake. **Competitor Ad Intelligence capability:**
  - **classify competitor listings** (`record_type_hint=competitor_activity` / `touchpoint_type=competitor_listing`; vs `market_signal`/`classified_offer` vs `irrelevant`), from title+description+category (not the search query);
  - **extract offer_text** — Workflow 08 (DEC-092) sets `offer_text` = the actual listing title (not the query);
  - **extract terms/price** — Workflow 08 sets `terms` = price + explicit conditions (без предоплаты, оплата за результат, работа по договору, после отказов, с просрочками, плохая КИ, банковские гарантии, рефинансирование, снижение ставки…);
  - **extract `semantic_keywords`** — concrete ad/semantic phrases from the listing (DEC-092), deduplicated;
  - **classify service theme** — `service_type` ∈ credit_broker / business_credit / credit_after_refusals / mortgage_refinance / unknown (preserved through to the business row);
  - **score for intelligence** — `competitor_strength` 75–85, `content_idea_score` 35–55, `quality_score` 70–85, `lead_signal_score`=1 (competitor ad, not client demand);
  - **identify `ad_channel_hint`** (`classifieds`) and `competitor_name` (seller);
  - **create monitoring/content inputs** — predicts `monitor_queue` (competitor) / `content_queue` (semantic/content) / `skipped_log` (irrelevant) for the registry, but **routing is finalized by Workflow 08** (deterministic, $0).
  Writes only `agent_requests`/`raw_market_records`/`market_record_registry` (unique only); **never** business tabs; **no auto-handoff**; **no Claude/Firecrawl**, **no real Apify call by default**. Live Apify mode documented + disabled by default (gated behind a chosen actor + explicit approval; no direct Avito scraping). MSK `+03:00` timestamps; 40/15/21-column outputs match Workflow 07. Guide: `docs/N8N_WORKFLOW_09_AVITO_CLASSIFIEDS_CONNECTOR_RU.md`.
- **Touchpoint Analyzer (Workflow 08, Stage 3.2 — DEC-080/082/083/085/086/087/088/089)** ✅ **STAGE 3.2 CLOSED (DEC-089):** DETERMINISTIC-FIRST BASELINE APPROVED (Test 3) **and** compact LLM enrichment **APPROVED WITH WATCH ITEM** for optional / test use (Test C4 PASS — `primary_json=3/4`, `technical_errors=0`, fallback 1/4 safe, Telegram fixed). **Default stays `deterministic_first` unless the operator explicitly enables `llm_enrichment`; watch item = the Banki/forum lead-pattern still falls back (safe).** — `08_touchpoint_analyzer.json` (JSON valid, `active=false`). **C2 filter fix (DEC-086):** attempt #1 wrote only record 1 (test filter used `return []` inside `Build Deterministic Row`, stalling the Split-in-Batches loop); v5 moves C2 filtering **pre-loop** into `Filter & Select Records` (loop gets exactly the 4 fixtures), `Build Deterministic Row` never returns `[]`, and `Final Summary` reports `selected_count` + test flags. **Source-agnostic, DETERMINISTIC-FIRST** analyzer: reads approved/unique `raw_market_records`, classifies each record **deterministically from intake hints** and appends to the 6 business tabs (existing **35-column** schema) via dynamic `Sheet Name = {{ $json.route }}`. **Test 3 PASS (deterministic_first):** Claude calls=0 / cost $0, `repair_used=false` ×12, `deterministic_pre_route=10`, `deterministic_irrelevant_skip=2`, routes 6 monitor / 3 content / 1 review / 2 skipped, `technical_errors=0` → **approved baseline**. `Set Analyzer Config`: `analysis_mode='deterministic_first'`, `llm_enrichment=false`, plus `llm_enrichment_test_mode`/`llm_test_batch_indexes=[1,7,11,12]` for the 4-record enrichment test. **LLM enrichment v4 (DEC-085) — enrichment-only merge:** the first enrichment run (Test C, full-row) was PARTIAL PASS/NOT APPROVED ($0.0967/4, too many fallbacks); Claude now returns a **compact 15-key enrichment JSON** (`thinking` disabled, `temperature=0`, `max_tokens` 700/600) that **`Merge LLM Enrichment With Deterministic Row`** overlays onto the deterministic 35-field row — **route/recommended_action/entity_type/contact stay deterministic** (Claude can't change routing, downgrade a competitor to irrelevant, or set a contact absent from intake); `market_signal`→`content_idea`; scores 1–10→×10 floored at det. Re-test = Test C2 (target `primary_json≥3/4`, cost ≤$0.04). **Timestamps Moscow `+03:00`.** **No scraping, no Apify/Firecrawl; writes only business tabs.** Guide: `docs/N8N_WORKFLOW_08_TOUCHPOINT_ANALYZER_RU.md`; plan: `docs/STAGE_3_2_TOUCHPOINT_ANALYZER_PLAN.md`; test log: `docs/STAGE_3_2_TEST_RESULTS.md`.
- **Stage 3.3 first-source decision** 📐 **DECISION ONLY (DEC-084, 2026-06-08):** recommended first real connector = **Avito/Classifieds Listing Connector** (lowest complexity, matches the web/URL data model, strong for competitors/offers/semantics; caveat — not for comments/audience mining). Telegram public parsing (≠ Control Bot) and Instagram comment/audience mining **deferred to feasibility stages**. **No connector built.** Plan: `docs/STAGE_3_3_SOURCE_DECISION_PLAN.md`.
- **Moscow-time operational timestamps (Workflows 04/05/06/07/08 — DEC-083)** ✅ applied: workflow-generated `created_at`/`parsed_at`/`generated_at`/`first_seen_at`/`last_seen_at` + `run_id` stamps use explicit **`+03:00`**; source `published_at` untouched; historical UTC-`Z` rows left as-is.
- **Manual Touchpoint Intake (Workflow 07, Stage 3.1 — DEC-079)** 🔧 BUILT, UNDER TEST — `07_manual_touchpoint_intake.json` (14 nodes, JSON valid, `active=false`). Normalizes 12 manually-provided mixed-source examples (Avito/Dzen/VK/Telegram/competitor/forum/reviews + 2 irrelevant + a forum hot-lead control) into **`raw_market_records` (40)**, dedups via **`market_record_registry` (15)** by composite non-URL `dedup_key`, and logs one **`agent_requests` (21)** row (`status=needs_review`). Deterministic hints only (`dedup_key`, `text_hash`, `region/urgency/lead_intent` hints, `confidence_score`, `lead_temperature`, `next_action`). **No Apify/Firecrawl/Claude, no scraping, no external API; `agent_memory` not written.** Guide: `docs/N8N_WORKFLOW_07_MANUAL_TOUCHPOINT_INTAKE_RU.md`; plan: `docs/STAGE_3_1_MANUAL_TOUCHPOINT_INTAKE_PLAN.md`.
- **Apify Search Candidate Discovery (Workflow 05, Stage 2.2 — Level 2)** 🔧 BUILT, UNDER TEST (DEC-059/060/061) — `05_apify_search_candidate_discovery.json` (13 nodes, JSON valid, active=false). Query → **Apify Google Search actor** (sync endpoint) → normalize → check `url_registry` → classify `candidate_type` → deterministic competitor-first score → write `url_candidates` (**26 cols**) + `discovery_requests` (18 cols). **0 Firecrawl / 0 Claude** (Apify search cost only); no auto-processing; human approval before Workflow 04. First real test passed **technically**; **candidate-quality patch (DEC-061) applied — remains under test until the `candidate_type` retest passes** (add `candidate_type` to the sheet, re-import, rerun the same query). Guide: `docs/N8N_WORKFLOW_05_APIFY_SEARCH_CANDIDATES_RU.md`.
- **Approved Candidates Runner (Workflow 06, Stage 2.2c)** 🔧 BUILT + registry-recheck patch, **remains UNDER TEST until the registry recheck is validated** (DEC-064/065) — `06_approved_candidates_runner.json` (manualTrigger, **3× Google Sheets** read×2 + disabled-update, 2× code, IF, sticky notes; JSON valid; active=false). Reads `url_candidates` **and re-reads `url_registry` at runtime**; re-normalizes each `candidate_url` (same rules as WF04/05) and selects only `approval_status=approved` + non-empty URL + **URL not in `url_registry`**. The editable `dedup_status`/`registry_status` are **advisory only** — a URL already in the registry is skipped as `registry_recheck_duplicate` even if manually marked `unique`/`not_in_registry`. Prioritizes `direct_competitor` → confidence → rank → **root-page-first**, **hard cap 5/run**, and (DEC-066) **default domain diversity — max 1 URL per domain per run** (second+ same-domain URL skipped as `duplicate_domain_in_run`; `mode=deep_domain_analysis` reserved, not enabled; `url_registry` semantics unchanged). Aggregators/directories/media may be selected when approved but carry a `warning` (no longer a hard block). Emits a WF04-shaped batch + Execution Summary + ready-to-paste `Set URL List` block. **No Apify/Firecrawl/Claude/Telegram.** v0.1 = **manual hand-off** to Workflow 04 (no subworkflow call); disabled `Mark Candidates Processed` node sets `approval_status=processed` after the operator confirms `monitor_queue`. Guide: `docs/N8N_WORKFLOW_06_APPROVED_CANDIDATES_RUNNER_RU.md`.

**Planned (designed, NOT built — planning only):**
- **Manual URL candidate entry** 📋 optional fallback input mode of Workflow 05 (manual URL *lists* are already handled by Workflow 04).
- **Lead Discovery Layer** 📐 designed (DEC-067/068/069/077): source-specific connectors (Avito/Classifieds, Telegram public channels/chats parser, VK/Social, Instagram, Yandex/Search, Manual Records Intake), a **source-agnostic** Market/Lead Analyzer (classes: `lead_signal`/`competitor`/`content_idea`/`market_signal`/`irrelevant`), and a **separate** record schema (`raw_market_records` + `lead_discovery_requests` + `market_record_registry`, non-URL composite dedup). **Build gate: Stage 3.0 Lead Source Evaluation must be approved first.** Telegram **Control Bot** is a controller, not a parser (Stage 4). Docs: `docs/LEAD_DISCOVERY_ARCHITECTURE.md`, `docs/LEAD_SOURCE_CONNECTORS_PLAN.md`.
- **Stage 3.0 Lead Source Evaluation** ✅ **WRITTEN 2026-06-08 (evaluation only, nothing built — DEC-077):** `docs/STAGE_3_LEAD_SOURCE_EVALUATION.md` (weighted scoring: Manual 27 > Avito 20 > Yandex 18 > VK 17 > Telegram 16 > Instagram 13), `docs/LEAD_DATA_MODEL_PLAN.md` (3 proposed sheets), `docs/SOCIAL_CLASSIFIED_SOURCE_MATRIX.md` (per-source matrix + go/no-go). Approved next: Manual Records Intake first; Avito/Classifieds preliminary first real connector. **Sheets remain PROPOSED, not created.**
- **Business Scout Agent reframe** 📐 **DESIGN 2026-06-08 (DEC-078):** product = agentic business automation system ("AI employee") with internal tools + memory + analysis; Marketing Scout is its first domain; Stage 3 = Social/Classified Touchpoint Discovery (leads are a subset). Docs: `BUSINESS_SCOUT_AGENT_VISION.md`, `MARKETING_AGENT_PRODUCT_VISION.md`, `AGENT_TOOL_ARCHITECTURE.md` (9 tools), `AGENT_MEMORY_PLAN.md`. **Planned (design only):** `agent_requests` (generalizes `lead_discovery_requests`), `agent_memory`, Social/Classified Touchpoint Discovery, Manual Records Intake, Avito/Dzen/VK/Telegram feasibility, Semantic/Ads Analysis, USP/Positioning Assistant, Outreach Draft Assistant (drafts only). **Not approved:** mass outreach, autocall, automated messaging, Telegram parser, Avito parser, VK/Instagram/Dzen parser, scheduled scraping, CRM integration.

**Still NOT approved:**
- More than 5 URLs per run.
- Multi-page crawl (`/v2/crawl`).
- Batch scraping over large URL lists (`/v2/batch/scrape`).
- Firecrawl search endpoint (`/v2/search`).
- Scheduled scraping (cron trigger).
- **Apify search calls (Workflow 05)** — workflow **built but not yet run**: needs an Apify token + the `Apify API - Marketing Scout` credential, then a manual test (DEC-060). No Apify call until then.
- **Lead-source connectors** (Avito / social / classified discovery) — future, not built (Workflow 05 is the Web Search connector only).
- **Firecrawl `/v2/search`** — parked, evaluation only (DEC-056/059).
- **Telegram Control** / NL query interface — deferred until discovery + approval flow exists (DEC-057/059).
- **Auto-triggered processing** — no candidate may reach Firecrawl/Claude without human `approval_status=approved` (DEC-055).
- URL-discovery agent / Telegram Control Bot (DEC-050).
- **Social / classified ingestion** (Avito / Telegram / Instagram) — future Apify connectors, not approved.
- Automated lead outreach.
- Firecrawl MCP/CLI (deferred — DEC-040).
- Deduplication at scale (Workflow 04 dedups a small manual list via `url_registry` by `normalized_source_url`; large-scale/automated dedup is not approved).
- Fully autonomous multi-source agent.
- `content_idea` production handling (content_queue exists; review process deferred to Stage 4).
- **Stage 3 explicit not-approved (DEC-077):** Avito scraping, Telegram parsing, VK/Instagram parsing, Telegram Control Bot, automated outreach, scheduled scraping.
- **Business Scout Agent not-approved (DEC-078):** mass outreach, autocall, automated messaging, Telegram/Avito/VK/Instagram/Dzen parsers, scheduled scraping, CRM integration. Competitor audience/commenter mining is **public data only** and not yet built.

See `docs/PROJECT_REVIEW_03_RESILIENT_ROUTER.md` and DEC-037.
**Business requirements:** `docs/BUSINESS_REQUIREMENTS.md`

---

## Confirmed Business Requirements (2026-06-05)

These facts were confirmed with the operator's uncle and must shape Prompt v2 and all scraping configuration:

| Dimension | Confirmed Value |
|-----------|----------------|
| Priority order | Lead signals → Competitors → Content ideas |
| Primary region | Moscow + Moscow Oblast |
| Core products | PTS loans, auto collateral, real estate collateral, refinancing |
| Top business sources | Telegram, Instagram, Avito, Yandex / competitor websites |
| Technical start sequence | Competitor websites → Avito → Telegram → Instagram |
| Action on strong lead | Contact / write to the person |
| Action on active competitor | Monitor |
| Useful row definition | Helps identify/contact a lead, monitor a competitor, or extract a content insight |

Full details: `docs/BUSINESS_REQUIREMENTS.md`.

---

## Current Infrastructure

| Component | Value |
|-----------|-------|
| Orchestration | n8n (self-hosted on VPS, accessed via SSH tunnel) |
| Claude gateway | `https://aiprimetech.io/v1/messages` |
| Model | `claude-sonnet-4-6` |
| Auth | HTTP Header Auth — `Authorization: Bearer <token>` |
| n8n credential name | `Claude API - Marketing Scout` |
| Storage | Google Sheets — `Marketing Scout Results`, sheet `results` |
| Google Sheets auth | Service Account — `Google Sheets - Marketing Scout Service Account` |

No API keys, tokens, or Spreadsheet IDs are stored in project files.

---

## Current Workflow Chain

```
Manual Trigger
    ↓
Set Test Competitor Data  (hardcoded test record for Workflow 02)
    ↓
Build Claude Request      (Code node — assembles /v1/messages body with system prompt)
    ↓
Claude API Request        (HTTP Request — POST to https://aiprimetech.io/v1/messages)
    ↓
Parse Claude JSON Response (Code node — finds type=text item, strips fences, JSON.parse)
    ↓
Quality Gate              (IF — status == "analyzed" AND quality_score >= 60)
    ↓ (true branch)
Append Row to Google Sheets
```

The false branch of Quality Gate currently ends silently. No Telegram notification exists yet.

---

## What Marketing Scout Agent v1 Can Do

- **Classify a market record** into one of five entity types: `competitor`, `lead_signal`, `market_signal`, `content_idea`, `irrelevant`
- **Identify the service type** from seven categories in the Russian secured lending market (PTS loans, auto loans, real estate loans, refinancing, etc.)
- **Extract structured fields** from unstructured Russian text: company name, region, offer text, terms, public contact info
- **Assess freshness** of the record based on `published_at` relative to `parsed_at`
- **Assign 1–100 scores** for quality, lead signal strength, content idea value, and competitor strength
- **Skip boilerplate** and low-quality records automatically (returns `status: skipped`, `quality_score: 1`)
- **Refuse to invent data** — returns empty string for fields that cannot be determined from the text
- **Return strict JSON** — the Parse node handles occasional markdown fence wrapping
- **Feed directly into Google Sheets** via the quality-gated append node

**Proven in Workflow 02 v2 (baseline d350069):**
- Test 1 (Авито, сильный лид, ПТС, Москва): `entity_type=lead_signal`, `recommended_action=contact`, `quality_score=97`, `lead_signal_score=98`. ✓
- Hot lead detection: confirmed working for urgent Moscow PTS/car collateral cases.
- Weak lead filtering, competitor classification, SEO skipping: confirmed in earlier baseline runs.
- Cautious edge-case handling: refinancing with uncertainty → investigate (not contact).
- Source/result traceability via `source_url` field.

**Current approved capabilities:**
1. **Hot lead detection** — identifies urgent, contactable, Moscow/MO PTS/auto leads with high scores.
2. **Weak lead filtering** — does not promote vague or low-urgency queries as hot leads.
3. **Competitor monitoring** — classifies active competitors with explicit offers; calibrates strength.
4. **SEO/navigation junk skipping** — returns `status=skipped`, `quality_score=1` for boilerplate.
5. **Cautious edge-case handling** — uses `investigate` for ambiguous signals rather than false-positive contact.
6. **Source/result traceability** — `source_url` written to Sheets for every analyzed record.

**Not production-approved yet:**
- `content_idea` classification: deferred to Stage 3 (Content Agent). Current Sheets schema has no content review process. See DEC-030.
- Telegram Control Bot: future roadmap stage. Not in current MVP. See ROADMAP.md.
- Workflow not connected to real scraping: all tests use synthetic records.
- Gateway stability: tool_use, KEY=VALUE line protocol, and compact prompts all returned 502 from current gateway. Baseline raw JSON is the only stable format.
- Output contract reliability: Tests 9–12 and 5 failed with JSON serialization errors (Markdown blocks, no-text responses, invalid JSON). Resilient Output Layer (two-pass repair + multi-tab routing) designed to fix this. See DEC-033 and `docs/WORKFLOW_02_RESILIENT_OUTPUT_LAYER.md`.

---

## What v1 Cannot Do Well

- **Reason like a marketing analyst.** v1 extracts and classifies; it does not reason about competitive positioning, client urgency fit, or what the operator should actually do next.
- **Assess competitive threat.** `competitor_strength` reflects brand quality, not threat to the specific operator. A weak competitor in the same micro-region can be more dangerous than a strong brand in another city.
- **Evaluate lead urgency with precision.** v1 notes urgency words but does not score a lead based on the three-axis model (product fit + urgency + readiness) needed for meaningful lead prioritization.
- **Propose content angles.** v1 can tag a record as `content_idea` but cannot propose the specific article title or content brief that would actually work for the target audience.
- **Handle ambiguous or adversarial records.** v1 has not been tested on genuinely messy real-world scraped data (duplicate listings, partial pages, multi-topic posts).
- **Know who the operator's target client is.** v1 has no ICP (Ideal Customer Profile) definition. It cannot distinguish a high-fit lead from a low-fit lead within the same product category.
- **Cite evidence for its scores.** The `reason` field is unstructured and often generic.
- **Process multiple items.** Workflow 02 is a single-record test. Multi-item pipeline behavior is unproven.

---

## What v2 Must Improve

Based on `docs/MILESTONE_REVIEW_02.md` Section 7, `MARKETING_AGENT_PROMPT_V2_PLAN.md`, and `docs/BUSINESS_REQUIREMENTS.md`:

1. **Priority order in reasoning** — lead signals first, competitors second, content ideas third (confirmed by uncle)
2. **Agent identity** — market intelligence analyst who reasons from business context, not a form-filler
3. **ICP definition** — car owner with PTS, Moscow / MO, bad credit likely, urgency is key; fast cash need
4. **Region filter** — Moscow / MO records score higher; out-of-region records are lower priority
5. **Product fit scoring** — PTS/auto > real estate > refinancing > other products
6. **Competitive threat model** — regional overlap + tactical USP + activity level → threat assessment sentence
7. **Lead urgency model** — fit × urgency × readiness → precise lead_signal_score with named urgency phrases
8. **Content angle output** — proposed article title or topic brief, not just a "content_idea" tag
9. **Structured `reason` field** — evidence sentence + score rationale + action rationale
10. **New fields** — `competitor_threat_summary`, `content_angle`, `urgency_indicator`, `icp_fit`
11. **Evidence requirement** — every score above 60 must cite a specific phrase from the source text

**Gate:** v2 must not be embedded in any workflow until it passes all 7 synthetic test criteria defined in `docs/N8N_WORKFLOW_02_V2_TEST_PLAN_RU.md` and is approved by the operator.

**v2 is written.** See `modules/marketing-scout-v0/MARKETING_AGENT_PROMPT_V2.md`.
**Test records ready.** See `modules/marketing-scout-v0/TEST_RECORDS_V2.md`.
**Test guide ready.** See `docs/N8N_WORKFLOW_02_V2_TEST_PLAN_RU.md`.

---

## Current Scoring Fields

All scores are integers on a **1–100 scale**.

| Field | What it measures | High (80–100) | Medium (40–59) | Low (1–19) |
|-------|-----------------|---------------|----------------|-----------|
| `quality_score` | Overall value and actionability | Rich data, clear signals, directly actionable | Partial data, incomplete context | Noise or boilerplate |
| `lead_signal_score` | Likelihood this is a potential client | Explicit need + urgency + product fit | Possible intent, ambiguous signals | No lead signal |
| `content_idea_score` | Value as content marketing inspiration | Specific, emotionally resonant pain point | Usable topic, needs development | No content value |
| `competitor_strength` | Assessed strength in the secured lending market | Strong brand, active marketing, clear pricing | Moderate presence, some activity | Not a competitor (set to 1) |

Quality gate threshold: `quality_score >= 60` to pass to Google Sheets.

---

## Current Output Schema

Fields written to Google Sheets on each successful analysis (25 columns):

```
created_at, source_type, platform, source_url, parsed_at, published_at,
freshness_status, entity_type, company_name, profile_name, profile_url,
region, service_type, offer_text, terms, contact_public, text_context,
detected_need, competitor_strength, lead_signal_score, content_idea_score,
quality_score, reason, recommended_action, status
```

Full schema: `docs/TABLE_SCHEMA.md`

`recommended_action` values: `monitor` / `contact` / `create_content` / `ignore` / `investigate`

`status` values: `analyzed` (processed normally) / `skipped` (boilerplate or low quality)

---

## Current Known Risks

| Risk | Severity | Status |
|------|----------|--------|
| content_idea not production-approved in Workflow 02 | Medium | Deferred to Stage 3 (Content Agent). DEC-030. |
| Gateway unstable for tool_use, KEY=VALUE, compact prompts | High | Baseline raw JSON is the only stable format. DEC-026–028. |
| Output contract unstable for non-obvious records | Medium | Resilient Output Layer (two-pass repair + dynamic-sheet routing) implemented and tested A–E. Repair validated by Test D, technical_errors by Test E. DEC-033/035/036. Production migration pending. |
| Business routing drift (weak lead misclassified as content) | Medium | Found in Test B; fixed in `Normalize + Route` with strict routing priority (DEC-036). Weak/potential leads now route to review_queue before content_queue. B retest pending. |
| Workflow not connected to real scraping | High | Extended tests use synthetic records. Real source test is Step E. |
| Telegram Control Bot not implemented | Low | Future roadmap (Stage 2.5). DEC-032. |
| No pre-filter node — all records hit Claude API | Medium | Design in progress. |
| Prompt duplication (Code node vs. file) | Medium | DEC-020 procedure documented. |
| Real page cost unknown (only short-record baseline) | Medium | Measure after first Firecrawl test. |
| Multi-item pipeline unproven | Medium | Will be tested in Workflow 03+. |
| .gitignore not audited before GitHub push | Low | Audit required before next push. |

---

## How to Explain Agent Capabilities to a Non-Technical Client

**What it does today:**

The system reads a description of a competitor or a potential client and asks an AI (Claude) to analyze it. The AI categorizes the record, scores how useful it is, and writes the result to a Google Sheets table. This takes about 2–3 seconds per record and costs less than 1 ruble each.

**What it can detect:**

- This is a competitor — here is what they offer, how strong they are, and whether you should watch them
- This person is looking for a loan — here is how urgent their need is and whether you should reach out
- This is a topic idea — here is what your audience is worried about and what you could write about

**What it cannot do yet:**

- It cannot search the internet on its own — you need to tell it where to look (Avito, VK, a competitor website)
- It cannot send you a message automatically yet — Telegram notifications are coming in a later version
- It is not yet tuned to the confirmed business priorities — a smarter v2 prompt is in design and will prioritize lead signals first, then competitors, then content ideas

**What makes it useful:**

Instead of reading hundreds of listings manually, the system reads them and gives you a prioritized table. You only review rows that scored above 60 — everything else is filtered out. Over time, as the prompt is improved, the quality of those rows will increase.

**Planned improvements:**

The current AI prompt is good but basic. We are designing a smarter version that understands your specific clients — who they are, what they need, and what makes a competitor dangerous to your business. That version will produce more useful scores and better action recommendations.
