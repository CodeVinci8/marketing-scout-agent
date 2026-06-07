# AGENT_LOG.md — Session Log

One entry per session that produces tangible output.
Most recent first.

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
