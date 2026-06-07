# Hot Memory — Recent Sessions

Most recent first. Keep last 3 sessions max. Archive older entries to `core/warm/decisions.md`.

---

## Session: 2026-06-08 — Workflow 05 Candidate-Quality Patch: candidate_type + domain fix + competitor-first scoring (DEC-061)

**What was done (no architecture change; 0 Firecrawl/Claude):**
- First real Apify run passed technically (10 candidates, 1 registry dup, `discovery_requests` row). Patched 3 quality issues in `05_apify_search_candidate_discovery.json` (active=false):
  1. **`domain` was empty** → robust extraction (hostname + regex fallback, lowercase, strip `www.`) in `Classify Candidates`.
  2. Added **`candidate_type`** (`direct_competitor`/`aggregator`/`directory`/`media_article`/`marketplace`/`social`/`unknown`) — `url_candidates` **25 → 26 cols** (after `domain`).
  3. **Competitor-first confidence** (+30 direct_competitor; −35 directory / −25 aggregator / −20 media/marketplace / −30 social / −50 registry-dup). Also fixed `looksLender` to match `займ`.
- Approval: dup → `duplicate`; unique competitor → `new`; unique aggregator/directory/media → `new` + "review manually; not a direct competitor". No auto-reject.
- **Verified by simulation:** lenders 85–100 `direct_competitor`, 2gis directory, banki/vbr/finuslugi aggregator, kp media_article, cashmotor duplicate; exact 26/18 field counts; JSON VALID; only Apify HTTP node.
- Docs updated: RU guide, PLAN, STRATEGY, TABLE_SCHEMA (26-col + enum + sheet-change note), DECISIONS (DEC-061), COSTS, AGENT_CAPABILITIES, ROADMAP, NEXT_ACTIONS.

**Next operator action:** add `candidate_type` to `url_candidates` (after `domain` → 26-col header) → re-import Workflow 05 → rebind creds → rerun «займ под залог ПТС Москва» → verify domains filled, types correct, competitors ranked first. Do not process candidates yet.

---

## Session: 2026-06-08 — Workflow 05 BUILT: Apify Search Candidate Discovery (DEC-060)

**What was done:**
- Built `n8n/workflows/05_apify_search_candidate_discovery.json` (**13 nodes, active=false**). URL **supplier**: query → Apify Google Search (sync endpoint, Header Auth `Apify API - Marketing Scout`) → normalize (WF04 rules) → read `url_registry` → classify (dedup/registry/confidence/hints) → write **url_candidates (25 cols)** + **discovery_requests (18 cols)**.
- **0 Firecrawl / 0 Claude**, no business-tab writes, no auto-processing, manual approval gate. Unique → `new`; dups → `duplicate`. Both append branches start from always-1-item `Classify Candidates` so `discovery_requests` is written even on 0 candidates / Apify error (`status=error`). Apify HTTP node `onError=continueRegularOutput`.
- Created RU guide `docs/N8N_WORKFLOW_05_APIFY_SEARCH_CANDIDATES_RU.md`. DEC-060.
- **Verified:** JSON VALID; only Apify HTTP node; no tool_use/KEY=VALUE; placeholders only (no token/Spreadsheet ID); simulated code nodes → exact 25/18 field names, dedup + batch-dup + error path, confidence discrimination.

**Next operator action:** create `discovery_requests` + `url_candidates` sheets → get Apify token → create `Apify API - Marketing Scout` credential → import + rebind (3 Sheets nodes + Apify) → run query «займ под залог ПТС Москва» → approve/reject. Do not process candidates yet. **No Apify call made this session.**

---

## Session: 2026-06-08 — Stage 2.2 PIVOT: Workflow 05 = Apify Search Candidate Discovery (DEC-059)

**What was done (planning/docs only — no JSON, no Apify/external calls):**
- **Workflow 05 repointed to `05 - Apify Search Candidate Discovery`** (Level 2 automated): query → **Apify Google Search actor** → normalize → check `url_registry` → deterministic score → write `url_candidates` + `discovery_requests`. **0 Firecrawl/Claude** (Apify search cost only); human approval before Workflow 04. Manual URL entry demoted to optional fallback (Workflow 04 already does manual lists).
- **Primary API = Apify.** Credential (later, no token in repo): `Apify API - Marketing Scout`, Header Auth, `Authorization: Bearer <token>`, domain `api.apify.com`. Fallbacks later: Google CSE, SerpAPI. Firecrawl `/v2/search` parked.
- **New sheet `discovery_requests` (18 cols)**; `url_candidates` confirmed 25 cols. Counts now 35 (business ×6) / 10 (url_registry) / 25 (url_candidates) / 18 (discovery_requests). Nothing removed.
- **Source connectors vs core analyzers** documented (don't split agents per platform; analyzers are source-agnostic). Telegram = interface only, later.
- Decisions: **DEC-059** (refines DEC-058). Updated STRATEGY, WORKFLOW_05 PLAN (full rewrite), TABLE_SCHEMA, COSTS, AGENT_CAPABILITIES, ROADMAP, NEXT_ACTIONS (Step G).

**Next operator decision:** approve schemas (discovery_requests 18 + url_candidates 25) → create both sheets → get Apify token → create `Apify API - Marketing Scout` credential → authorize building Workflow 05. **Do not call Apify / build Telegram yet.**

---

## Session: 2026-06-08 — Stage 2.2 URL Discovery REFINED: Hybrid A+B+D + 25-col `url_candidates` (DEC-058)

**What was done (planning/docs only — no JSON, no external calls):**
- **Selected architecture = Hybrid A+B+D** (DEC-058): manual intake (A) first → search/API (B) later → Approved Candidates Runner (Stage 2.2c) → Telegram (D) **interface only**. Firecrawl `/v2/search` (C) **parked** (don't combine search+scrape+analysis).
- **`url_candidates` 22 → 25 columns:** added `discovery_request_id`, `requested_by`, `requested_limit` (request-level grouping for future bot/summaries).
- **Default volumes:** collect **10** candidates/request; Workflow 04 processes **≤5/run** → 10 approved = two batches of 5. No spend until `approval_status=approved`.
- Telegram must **call** workflows, never duplicate discovery/processing logic.
- Updated: `URL_DISCOVERY_STRATEGY.md`, `WORKFLOW_05_URL_DISCOVERY_PLAN.md` (25-col + Build Candidate Rows structure), `TABLE_SCHEMA.md` (counts 35/10/25), `DECISIONS.md` (DEC-058), `ROADMAP.md` (2.2a/b/c + 2.3), `NEXT_ACTIONS.md` (Step G), `COSTS_AND_LIMITS.md`, `AGENT_CAPABILITIES.md`.

**Next operator decision:** approve the `url_candidates` **25-column** schema (G1) + confirm Option A first → create sheet → authorize building Workflow 05. Search/Telegram deferred.

---

## Session: 2026-06-08 — Stage 2.2 URL Discovery Layer PLANNED (DEC-055/056/057)

**What was done (planning only — no JSON, no external calls):**
- Created **`docs/URL_DISCOVERY_STRATEGY.md`** (consumer vs supplier; options A/B/C/D; risks; gates G1–G5) and **`docs/WORKFLOW_05_URL_DISCOVERY_PLAN.md`** (`05 - URL Candidates Manual Intake`: `url_candidates` 22-col schema, approval/source/dedup value sets, manual intake structure, ≤20/intake, **no Firecrawl/Claude**, test plan).
- **Architecture:** URL discovery is a **separate layer** (the *supplier*); Workflow 04 stays the *consumer* (unchanged). New `url_candidates` sheet holds candidates with `approval_status` (`new`/`approved`/`rejected`/`processed`/`duplicate`/`error`); discovery checks `url_registry` early; **human approval required before any Firecrawl/Claude spend**. Normalizer reused from Workflow 04 so `normalized_source_url` matches `url_registry`.
- **Recommended path:** Option A (manual intake) → Option B (search API/actor, measured, gate G4) → Telegram bot (Stage 2.3, deferred). Option C (Firecrawl `/v2/search`) parked.
- **Decisions:** DEC-055 (separate layer / Workflow 04 = consumer), DEC-056 (manual before automated search), DEC-057 (Telegram deferred until candidate+approval flow exists).
- Updated ROADMAP (2.2/2.2a/2.2b/2.3), AGENT_CAPABILITIES, COSTS, NEXT_ACTIONS (Step G).

**Next operator decision:** approve the `url_candidates` 22-column schema (G1) + confirm Option A first → create the sheet → authorize building Workflow 05. **Do not build Telegram/search yet.**

---

## Session: 2026-06-08 — Workflow 04: 5-URL Test Passed + Placeholder Pre-Filter + Stronger PTS Override (DEC-054)

**What was done:**
- **5-URL test passed** (`firecrawl_20260607_100715`): 2 duplicates → `skipped_log` (0 cost), 1 placeholder (Wix not-connected) → `skipped_log`, 2 competitors → `monitor_queue`. Claude Δ **$0.0429**, ~3 Firecrawl credits. → **Workflow 04 APPROVED for manual ≤5-URL mini-batches.**
- Patched `04_firecrawl_url_list_resilient.json` **in place** (25 nodes, active=false):
  - **(A) Placeholder pre-filter** in `Normalize Firecrawl Output` — parked/domain-not-connected pages → 35-field `skipped_log` (`parse_method=firecrawl_placeholder_prefilter`) **before** Claude; still appends to `url_registry` (via IF-false → Append → Build Registry Row → Append url_registry). Saves Claude spend on dead domains.
  - **(B) Stronger PTS/path `service_type` override** in `Normalize + Route` — `pledge-pts`/`zalog-pts`/`залог птс`/`pts` → `pts_loan`; auto without PTS → `secured_auto_loan`; real-estate → `secured_real_estate_loan`; root/multi-product stays `generic_lending`. Fixes `autolombard-moskva.ru/pledge-pts/` → `pts_loan`.
  - **(D) Layout** — primary lane lifted to y=140 so the technical-error arrow reads cleanly. No logic change.
- Dedup architecture untouched; 35 business + 10 registry fields intact; cap 3500 unchanged.
- Docs: DEC-054; RU §11c + `Append url_registry` setup (Sheet=`url_registry` name mode, Mapping=Automatically — NOT dynamic); PLAN/ROADMAP/TABLE_SCHEMA/COSTS/AGENT_CAPABILITIES/NEXT_ACTIONS updated.

**Key facts:** `Append url_registry` must be set manually after import (Sheet=`url_registry`, name mode, Mapping=Automatically, real Doc ID, GSheets cred). Only `Append to Dynamic Route Sheet` uses `{{ $json.route }}`. JSON VALID; no secrets/tool_use/KEY=VALUE/crawl-batch-search; `Set URL List` only example.com.

**Next:** optional 3-URL retest (duplicate + placeholder + PTS) → then **plan** URL Discovery (Stage 2.2, do not build yet).

---

## Session: 2026-06-08 — Workflow 04 VALIDATED & APPROVED: Language Guard + Service-Type Override (DEC-053)

**What was done:**
- Operator ran the 2-run validation. **Run 1** (empty `url_registry`, 3 URLs) → all `monitor_queue` competitors + 3 registry rows. **Run 2** (same 3 URLs) → all `skipped_log`/`dedup_source_url`, **0 Firecrawl/Claude**. Dedup confirmed → **Workflow 04 APPROVED for manual ≤5-URL mini-batch.**
- Patched `04_firecrawl_url_list_resilient.json` **in place** (`Normalize + Route` only; 25 nodes, active=false): **(A)** output language guard — Cyrillic source but English/CJK `reason`/`offer_text` → deterministic Russian fallback; **(B)** URL/path service-type override — `pod-zalog-avto`/ПТС → `pts_loan`/`secured_auto_loan`, `pod-zalog-nedvizhimosti`/недвижимость → `secured_real_estate_loan`, root homepage stays `generic_lending`.
- No architecture/dedup change; 35 business + 10 registry fields intact; cap 3500 unchanged. Genericized one real domain in the retest sticky note → `example.com`.
- Docs: DEC-053; RU §11b (validation + backfill); PLAN/ROADMAP (approved, Stage 2.1 done + 2.2 discovery / 2.3 Telegram planning); TABLE_SCHEMA (source-of-truth + backfill); COSTS (validated); AGENT_CAPABILITIES (moved to APPROVED); NEXT_ACTIONS (next steps).

**Key facts:** `url_registry` is the dedup **source of truth** — old rows re-process once unless backfilled (optional). JSON VALID; no secrets/tool_use/KEY=VALUE/crawl-batch-search; `Set URL List` uses only example.com.

**Next:** optional 5-URL run (record before/after balances) → then **plan** URL discovery (Stage 2.2, do not build yet).

---

## Session: 2026-06-08 — Workflow 04 HARDENED: `url_registry` Dedup + Deterministic Fallback (DEC-051/052)

**What was done:**
- Patched `04_firecrawl_url_list_resilient.json` **in place** (25 nodes, active=false). Dedup moved from the fragile 4× business-tab scan to a dedicated **`url_registry`** tab keyed on `normalized_source_url` = full URL **with path** (NOT domain). `Registry Lookup` runs before Firecrawl/Claude; duplicate → `skipped_log`/`dedup_source_url`, **0 cost**. After every non-duplicate attempt (incl. `technical_errors`) → `Build Registry Row` (10 fields) → `Append url_registry`.
- Normalization: lowercase scheme/host only, drop `#fragment` + `utm_*`/`gclid`/`yclid`/`fbclid`, strip trailing slash on non-root paths. Root variants → one key; service pages on same domain → distinct keys.
- **Deterministic competitor fallback (DEC-052)** in `Parse Repaired JSON` after primary+repair failure (→ `monitor_queue`, `needs_manual_review=true`). `text_context` cap → **3500**. Layout cleaned.
- Docs: TABLE_SCHEMA (url_registry section, old four-tab removed), DECISIONS (DEC-051/052), RU guide (registry setup + 10-col header + normalization/dedup examples + retest + cred rebind + Loop), PLAN, NEXT_ACTIONS, COSTS_AND_LIMITS, AGENT_CAPABILITIES, ROADMAP, AGENT_LOG.

**Verified:** JSON VALID; duplicate branch never touches Firecrawl/Claude; both non-dup + technical-error paths append `url_registry`; no secrets/Spreadsheet ID/`tool_use`/`KEY=VALUE`/crawl-batch-search; only `example.com` placeholders.

**Next:** operator creates `url_registry` tab (10 cols) → reimport → rebind creds → first pass (3 URLs) + second pass (same 3 → all `skipped_log`, 0 cost). Workflow 04 NOT approved until retest passes.

---

## Session: 2026-06-08 — Workflow 04 BUILT: Firecrawl URL List Mini-Batch + source_url Dedup (DEC-048/049/050)

**What was done:**
- Built `n8n/workflows/04_firecrawl_url_list_resilient.json` (**25 nodes**, active=false). Mini-batch of 3–5 competitor URLs, manual, per-URL loop (Split In Batches), `source_url` dedup BEFORE Firecrawl/Claude spend, reusing hardened Workflow 03 analyzer.
- Front-end: Set URL List (cap 5, run_id+batch_index) → Loop Over Items → Normalize URL for Dedup (lowercase host, strip #frag + utm, trailing slash) → 4× Dedup Lookup (results/review/monitor/content, Sheets read by source_url) → Evaluate Dedup → IF Duplicate? → dup→skipped_log(`dedup_source_url`, 0 cost) / new→Firecrawl→analyzer→Normalize+Route → Append → loop.
- **Schema now 35 cols** (DEC-048): +`run_id` +`batch_index` on every output path. Operator already extended all 6 tabs to 35.
- **Dedup implemented best-effort** (DEC-049): Google Sheets read+filter, `.all()` aggregation, fallback documented in RU guide. Duplicate URLs cost 0.
- DEC-050: future Telegram/URL-discovery may feed URL lists into WF04; deferred.
- Verified: JSON VALID; 25 nodes; connection integrity OK; 8 creds correct by name (placeholders); only example.com/gateway URLs; no secrets/test fields/tool_use/KEY=VALUE; dynamic sheet node; cap 5; dedup before Firecrawl. Simulation: all output paths = exactly 35 fields with run_id/batch_index; competitor→monitor_queue/generic_lending/75; dup→skipped_log; firecrawl error→technical_errors.
- Docs: created RU guide; updated PLAN (built), TABLE_SCHEMA (35), NEXT_ACTIONS, DECISIONS, COSTS, CAPABILITIES, ROADMAP (Stage 2.1 built + Stage 2.5 future), AGENT_LOG.

**Active candidate:** `04_firecrawl_url_list_resilient.json` (built, active=false). WF03 remains approved single-URL.

**What is next (in order):**
1. **Operator: commit** WF04 + new/updated docs.
2. **Operator (NEXT_ACTIONS Step F):** import WF04; rebind 8 credential nodes + real Spreadsheet ID on all 5 Sheets nodes; confirm 6 tabs have 35-col header.
3. Run **3 URLs** → verify competitors→monitor_queue, broken→technical_errors, run_id/batch_index present.
4. **Re-run same 3 URLs** → verify dedup → skipped_log/`dedup_source_url`, 0 Firecrawl/Claude cost. Record cost.
5. If clean → max 5 URLs. Crawl/batch/schedule/URL-discovery stay blocked.

---

## Session: 2026-06-08 — Firecrawl Single URL PASSED; Workflow 04 Mini-Batch Planned (DEC-045/046/047)

**What was done (docs/planning only — no workflow JSON edited):**
- **Two real single-URL tests PASSED** after DEC-043/044 hardening:
  - `mosinvestfinans.ru/` → `monitor_queue`, competitor `МосИнвестФинанс`, `generic_lending`, strength/quality **78**, `primary_json`, `repair_used=false`.
  - `lioncredit.ru/…/kredit-pod-zalog-nedvizhimosti` → `monitor_queue`, competitor `LionCredit`, `generic_lending`, strength/quality **75**, `primary_json`, `repair_used=false`.
- **DEC-045:** Firecrawl single-URL competitor website ingestion + competitor → `monitor_queue` **APPROVED** (manual, controlled).
- **DEC-046:** manual credential rebinding after every import is an operational requirement (credential IDs are local).
- **DEC-047:** Workflow 04 may process a manual 3–5 URL list (max 5, no schedule, no crawl); dedup by `source_url` first-class.
- Created **`docs/WORKFLOW_04_FIRECRAWL_URL_LIST_PLAN.md`** (plan only, build gated on operator approval).
- Updated RU guide (success table + approval status + rebinding checklist), FIRECRAWL_SETUP (validated + page-selection), COSTS (both tests + mini-batch note), CAPABILITIES (moved to approved; crawl/batch/schedule/Avito/TG/IG still blocked), NEXT_ACTIONS (Step E ✅, Step F active), ROADMAP (Stage 2 ✅, Stage 2.1 next), AGENT_LOG.

**Active candidate:** `03_firecrawl_single_url_resilient.json` (passed, approved, active=false). Workflow 04 = plan only.

**What is next (in order):**
1. **Operator: commit** doc updates + new Workflow 04 plan.
2. **Operator: review/approve** `docs/WORKFLOW_04_FIRECRAWL_URL_LIST_PLAN.md`.
3. On approval → build session creates `04_firecrawl_url_list_resilient.json` + RU guide (3 URLs first, then 5; dedup by `source_url`).
4. Crawl/batch/schedule remain blocked.

---

## Session: 2026-06-08 — Workflow 03 Patch: Post-Repair Consistency Hardening (DEC-043/044)

**What was done:**
- First real Firecrawl test on `https://mosinvestfinans.ru/`: success, **1 credit**, Claude delta **$0.0229**. Primary parse failed → **repair succeeded** → but row was contradictory and landed in `review_queue`: `entity_type=competitor` yet `competitor_strength=1`, `quality_score=6`, Chinese `reason`, `service_type=pts_loan`.
- Patched **`Normalize + Route` only** (no new copy, no prompt change, still 33 fields):
  - Language guard (Cyrillic source + CJK reason → Russian fallback).
  - Competitor signal-count floors (≥3→65, ≥5→75) + rich competitor → `monitor_queue`/`monitor`, never `review_queue`.
  - Repaired-JSON trust rule (competitor strength never <45 unless text unusable).
  - Multi-product website → `service_type=generic_lending` (don't let "ПТС" force `pts_loan`).
  - `raw_response_preview` 200 chars on `parsed_success`.
  - Verified all 4 credential references by name (placeholder IDs).
- Decisions DEC-043 (consistency hardening) + DEC-044 (multi-product → generic_lending).
- Verified: JSON VALID; mosinvest simulation → `monitor_queue`, competitor, `generic_lending`, strength/quality 75, monitor, Russian reason, 33 fields; regression (results/review_queue/skipped_log/technical_errors/auto-competitor) all pass.

**Active workflow candidate:** `03_firecrawl_single_url_resilient.json` (patched, active=false).

**What is next (in order):**
1. **Operator: commit** patch + doc updates.
2. **Operator (NEXT_ACTIONS Step E):** re-import WF03; **re-bind credentials** (import drops them) + real Spreadsheet ID; confirm 6 tabs / 33-col header.
3. **Retest `https://mosinvestfinans.ru/`** → expect `route=monitor_queue`, competitor, monitor, strength/quality ~70–90, `generic_lending`, Russian reason.
4. Then test a **specific service page** (`…/kredit/pod-zalog-avto/`) for lower cost/clearer analysis. Record both cost deltas.
5. Batch/crawl/schedule stay blocked.

---

## Session: 2026-06-07 — Workflow 03: Firecrawl Single URL → Resilient Analyzer (DEC-039–042)

**What was done:**
- Built the first real-source workflow `n8n/workflows/03_firecrawl_single_url_resilient.json` (**17 nodes**, active=false) — Firecrawl single-URL scrape fronting a **copy** of the production resilient analyzer (no sub-workflow call yet; standalone/importable).
- Front-end nodes: `Set Firecrawl URL` (only place to change target_url) → `Build Firecrawl Request` → `Firecrawl Scrape API` (POST `api.firecrawl.dev/v2/scrape`, Header Auth, onError=continue) → `Normalize Firecrawl Output` → `IF Firecrawl Normalized OK?`.
- `Normalize Firecrawl Output`: Firecrawl error OR empty/<80-char markdown → 33-field `technical_errors` row (`firecrawl_error`), **bypasses Claude** (DEC-041); success → source record, `text_context`≤6000 (DEC-042). Analyzer's three `$('Set Source Record')` lookups → `$('Normalize Firecrawl Output')`.
- Decisions: DEC-039 (Firecrawl single URL first, not crawl/batch/search), DEC-040 (MCP/CLI deferred), DEC-041 (Firecrawl fail → technical_errors w/o Claude), DEC-042 (text_context≤6000).
- Verified: JSON VALID; 17 nodes; active=false; placeholders only; no keys/test fields/tool_use/KEY=VALUE; dynamic sheet node present; all 3 output paths emit exactly 33 fields.
- Docs: created N8N_WORKFLOW_03_FIRECRAWL_SINGLE_URL_RU.md + FIRECRAWL_SETUP.md; updated DECISIONS, ROADMAP, COSTS, CAPABILITIES, RESILIENT_OUTPUT_LAYER, TABLE_SCHEMA, NEXT_ACTIONS, AGENT_LOG.

**Active workflow candidate:** `03_firecrawl_single_url_resilient.json` (Firecrawl front-end + reused resilient layer).

**What is next (in order):**
1. **Operator: commit** Workflow 03 + new/updated docs.
2. **Operator (NEXT_ACTIONS Step E):** create Firecrawl credential (`Firecrawl API - Marketing Scout`, Header Auth, `Authorization: Bearer <key>`, domain api.firecrawl.dev); import WF03; set creds + real Spreadsheet ID; confirm 6 tabs / 33-col header.
3. Set ONE public competitor URL → run once → verify `monitor_queue` (or `technical_errors`) → record Firecrawl + Claude cost delta in COSTS.
4. Multi-URL/crawl/batch/schedule stay deferred until this single-URL test passes (DEC-039).

---

## Session: 2026-06-06 — Production Smoke-Test Patch (DEC-038)

**What was done:**
- First manual production smoke test FAILED: competitor record → primary parse failed → **Repair API 502 Bad Gateway** → technical_errors, and `raw_response_preview` showed only the repair error (primary raw lost).
- Patched production workflow in place (no new copy):
  - `Parse Primary JSON`: preserves `primary_parse_error` + `primary_raw_response_preview` (≤500) + `content_summary` + `original_record` on all failure branches.
  - `Build Repair Request`: compact payload (trimmed original_record, previews capped, compact schema/enums, max_tokens 700, temp 0); prompt "JSON repair formatter, not a market analyst".
  - `Parse Repaired JSON`: reads back Parse Primary; on failure emits `parse_method=technical_error` + `parse_error="Primary: … | Repair: …"` + raw preview that keeps primary first.
  - `Normalize + Route`: parse_error≤800, raw_response_preview≤500.
  - Primary prompt: short JSON-only + competitor-classification reminder.
  - `Set Source Record`: competitor smoke text preset for ready retest.
- Output stays 33 columns; no test fields; no tool_use/KEY=VALUE. JSON VALID; failure-chain simulation preserves both errors + primary preview (33 fields).
- Docs updated: TABLE_SCHEMA (33-col header rule, Russian names deferred, diagnostics), RESILIENT_OUTPUT_LAYER, PROJECT_REVIEW_03 (GO → conditional/NO-GO until smoke passes), NEXT_ACTIONS (Step D8), DECISIONS (DEC-038), COSTS, CAPABILITIES.

**Active workflow candidate:** `02_claude_api_single_record_v2_resilient_router_production.json` (patched).

**What is next (in order):**
1. **Operator: commit** patch + doc updates.
2. **Operator (NEXT_ACTIONS Step D8):** clean 6 Sheets tabs to exactly the 33-column English header; re-import patched workflow; set Claude + Sheets creds + real Spreadsheet ID; record balance; run smoke once.
3. Verify `route=monitor_queue`, `entity_type=competitor`, `processing_status=parsed_success`. If still technical_errors, `parse_error` now shows Primary+Repair → diagnose the 502.
4. **Firecrawl blocked until smoke passes** (DEC-038). Then build `03_firecrawl_single_url_resilient.json`.

---

## Session: 2026-06-06 — Production Hardening + Cleanup (DEC-037)

**What was done:**
- Created **production** workflow `02_claude_api_single_record_v2_resilient_router_production.json` from the dynamic-sheet test harness:
  - Stripped test harness: removed Set Test Selector, Select Test Record, IF Skip Primary API?, all mock logic, and all test-only fields.
  - Added `Set Source Record` placeholder node (`text_context=PLACEHOLDER_TEXT_REPLACE_BEFORE_RUN`, `parsed_at={{ $today }}`).
  - Production `Normalize + Route`: 33 output fields (25 core + 8 technical), `recommended_action` normalized to route, `raw_response_preview` capped 500, route validation + service_type/company_name normalization kept.
  - One dynamic Google Sheets node (`Sheet Name = {{ $json.route }}`), placeholders only, active=false, no tool_use/KEY=VALUE.
- Verified VALID + leakage-clean + logic simulation A/B/C/D/E + skip all route correctly with 33 fields.
- `git rm` removed obsolete Switch workflows `..._test.json` + `..._test_fixed.json` (staged). Test harness dynamic_sheet retained as evidence.
- Added DEC-037; updated TABLE_SCHEMA, RESILIENT_OUTPUT_LAYER, TEST_RESULTS, CLEANUP_AUDIT, CAPABILITIES, COSTS, ROADMAP, NEXT_ACTIONS, PROJECT_REVIEW_03.

**Active workflow candidate:** `02_claude_api_single_record_v2_resilient_router_production.json`

**What is next (in order):**
1. **Operator: commit** (new production workflow + 2 staged deletions + doc updates) — suggested message: "Add production resilient router; remove obsolete Switch-based workflows (DEC-037)".
2. **Operator smoke test (NEXT_ACTIONS Step D7):** import production workflow, set Claude + Sheets credentials + real Spreadsheet ID, create 6 tabs (33-col header), replace placeholder text, run once, verify one row in correct tab with no test columns.
3. If smoke passes → **Firecrawl single-URL scraper** (`03_firecrawl_single_url_resilient.json`) fronting the production resilient layer; check `source_url` before append.

---

## Session: 2026-06-06 — Full Project Review After A–E (Review 03)

**What was done:**
- Full review-only pass before the first scraper. Created `docs/PROJECT_REVIEW_03_RESILIENT_ROUTER.md`.
- Verified active workflow `..._dynamic_sheet.json`: active=false, no secrets, no tool_use, no KEY=VALUE, dynamic Sheet Name `={{ $json.route }}`, route validation present, 47 emitted fields == RU guide header, two-pass + single dynamic sheet, connections explicit.
- Prompts OK: primary 3922 chars (sonnet-4-6, 1400/0.2, JSON-only); repair 1187 chars (900/0.0, no invent / extract only / JSON only).
- A–E all pass live (B confirmed: review_queue, primary_json, lead≈38). Cost A–E ≈ $0.075.

**Top findings:**
1. Workflow still a **test harness** — writes 16 test-only columns into tabs; must be stripped for production.
2. `TABLE_SCHEMA.md` drift — only 25 core columns documented; missing 6 technical columns + 6 tab names (blocker for operator tab setup).
3. `raw_response_preview` truncation mismatch (code 1200 vs design doc 300).
4. No dedup key — real scrapes will create duplicate rows.
5. Dynamic node won't create missing tabs — all 6 must pre-exist or run errors.

**Verdict:** Architecture GO. First scraper conditional-GO after hardening. Recommended first source: **Firecrawl single competitor website** (monitor_queue path proven by Test C).

**What is next (in order):**
1. **Operator: commit** review docs.
2. Implement production resilient Workflow 02/03 (no test fields) + Firecrawl single-URL scraper — see review §10.
3. Reconcile TABLE_SCHEMA (31-col production header + 6 tabs); add dedup key; reconcile raw_response_preview length.
4. Run smoke tests (review §11). Then Cleanup Phase 2 (git rm the 2 Switch-based workflows).

---

## Session: 2026-06-06 — Resilient Router Patch After Tests A–E (DEC-036)

**What was done:**
- Tests A–E run on dynamic-sheet workflow. A, C, D, E passed. **B exposed routing-priority bug**: weak/potential lead (classified content_idea via repair) went to `content_queue` instead of `review_queue`.
- Patched `Normalize + Route` only (no prompt/model/architecture/new-copy change):
  1. Routing priority: technical_errors → skip/irrelevant → hot lead (results) → **weak lead (review_queue)** → competitor (monitor_queue) → content idea (content_queue) → fallback review_queue.
  2. Weak/potential-lead rule runs before content_queue.
  3. `service_type` free-text → enum normalization (e.g. "займ под залог ПТС" → `pts_loan`, fixes D).
  4. `company_name` descriptive fallback for empty competitors (e.g. `МФО / частный кредитор`, fixes C). Never invents a brand.
  5. Test-pass for review_queue is route-focused (route + needs_manual_review + lead≥30).
- Verified by Node simulation: A→results, B→review_queue, C→monitor_queue (company=МФО / частный кредитор), D→results (service=pts_loan), all pass. JSON re-validated VALID.
- API cost A–E: $0.1145 → $0.1895, delta **$0.0750**. Repair validated by D, technical_errors by E.
- Added DEC-036. Updated TEST_RESULTS, CAPABILITIES, TABLE_SCHEMA, COSTS, RESILIENT_OUTPUT_LAYER, RU guide, NEXT_ACTIONS.

**What is next (in order):**
1. **Operator: commit** patch + doc updates.
2. **Operator: retest Test B** (live) → confirm route=review_queue, needs_manual_review=true. Optional A/D smoke.
3. If B passes: approve → Cleanup Phase 2 (git rm the 2 Switch-based workflows) + Phase 4 production migration.

---

## Session: 2026-06-06 — Cleanup Phase 2 Plan Prepared (Blocked on Tests A–E)

**What was done:**
- Prepared cleanup phase 2 plan (docs only — no deletions, no git rm, no workflow edits).
- Dynamic-sheet workflow (`..._dynamic_sheet.json`, DEC-035) recorded as the **current active resilient router candidate**.
- Added "Cleanup Phase 2 — after dynamic router tests" to `docs/PROJECT_CLEANUP_AUDIT.md`: classification table + proposed `git rm` commands marked NOT TO RUN YET + Phase 2 gate.
- Updated NEXT_ACTIONS.md with the Cleanup Phase 2 block.

**Classification:**
- Keep active candidate: `..._resilient_router_test_dynamic_sheet.json`
- Keep reference: `..._v2_baseline_raw_json.json`
- Keep historical evidence: `..._v2_extended_tests.json`
- Delete after A–E pass: `..._resilient_router_test_fixed.json`, `..._resilient_router_test.json`
- Keep baselines: `00_healthcheck`, `01_google_sheets_append_row`, `02_claude_api_single_record_analysis`

**Blocker before any deletion:** Tests A–E must pass on the dynamic-sheet workflow. Cleanup phase 2 is prepared but blocked.

**What is next (in order):**
1. **Operator: commit** the doc updates from this session.
2. **Operator Phase 1**: Create 6 Sheets tabs (names = route values) with 47-column headers.
3. **Operator Phase 3**: Import `_dynamic_sheet.json`, set credential + Spreadsheet ID, run Tests A–E.
4. If all 5 pass: execute Cleanup Phase 2 (`git rm` the 2 Switch-based workflows) + Phase 4 production migration.

---

## Session: 2026-06-06 — Resilient Router DYNAMIC SHEET Copy (Switch Removed)

**What was done:**
- Created `n8n/workflows/02_claude_api_single_record_v2_resilient_router_test_dynamic_sheet.json` (DEC-035).
- Removed Switch by Route + 6 per-tab Append nodes. Added ONE `Append to Dynamic Route Sheet` node: googleSheets v4, Sheet Name = `={{ $json.route }}`, documentId=PASTE_SPREADSHEET_ID_HERE, autoMap, credential by name. Connected `Normalize + Route` → dynamic node.
- `route` already holds the exact tab name (results/review_queue/monitor_queue/content_queue/skipped_log/technical_errors), so one node routes dynamically. 15 nodes total.
- Added route-validation safety to Normalize + Route: invalid/missing route → technical_errors + processing_status=technical_error + needs_manual_review=true + parse_error includes 'invalid_route'.
- JSON validated VALID. `_test.json` and `_fixed.json` untouched (history).
- Updated RU guide (import DYNAMIC file + IF-node fallback), RESILIENT_OUTPUT_LAYER.md (routing now dynamic-sheet), DECISIONS.md (DEC-035), NEXT_ACTIONS.md.

**What is next (in order):**
1. **Operator: commit** (new dynamic_sheet workflow + doc updates).
2. **Operator**: Delete old `RESILIENT ROUTER TEST` / `... FIXED` imports in n8n.
3. **Operator Phase 1**: Create 6 Sheets tabs (names must match route values exactly) with 47-column headers.
4. **Operator Phase 3**: Import `_dynamic_sheet.json`, set credential + Spreadsheet ID (keep Sheet Name as expression), run Tests A–E.
5. If all 5 pass: Phase 4 — production migration.
6. Fallback if Sheet Name expression unsupported: six IF nodes from `_fixed.json` base.

---

## Session: 2026-06-06 — Resilient Router TEST HARNESS FIXED Copy

**What was done:**
- Created `n8n/workflows/02_claude_api_single_record_v2_resilient_router_test_fixed.json`.
- Switch by Route rebuilt as typeVersion 1 (simple string-match: dataType=string, value1=`$json.route`, 6 value2/output rules). Previous typeVersion 3 rules-mode caused visual rendering failure in n8n UI after import.
- Switch position: [1700, 300]. Append nodes: x=2000, y=-100 to y=900.
- Connections for Switch by Route hard-deleted and rebuilt: outputs 0–5 → results/review_queue/monitor_queue/content_queue/skipped_log/technical_errors.
- JSON validated VALID. Source `_test.json` unchanged.
- Updated `N8N_WORKFLOW_02_RESILIENT_ROUTER_TEST_RU.md` Step 1: delete old workflow, import FIXED file.
- Updated NEXT_ACTIONS.md: Phase 2 complete with FIXED file note; Phase 3 import step updated.

**What is next (in order):**
1. **Operator: commit** (new fixed workflow JSON + doc updates).
2. **Operator**: Delete old `RESILIENT ROUTER TEST` import in n8n (if present).
3. **Operator Phase 1**: Create 6 Sheets tabs with 47-column headers (see guide Step 4).
4. **Operator Phase 3**: Import `_fixed.json`, set credentials + Spreadsheet ID, run Tests A–E.
5. If all 5 pass: Phase 4 — production migration.

---

## Session: 2026-06-06 — Resilient Router Switch Connections Audit

**What was done:**
- Audited `02_claude_api_single_record_v2_resilient_router_test.json` — all 6 Switch by Route → Append node connections confirmed present and correct in `connections` map (outputs 0–5, routes results/review_queue/monitor_queue/content_queue/skipped_log/technical_errors).
- No workflow JSON changes needed — connections were already correct from the prior build session.
- JSON validated with python3 — VALID.
- Added troubleshooting note to `docs/N8N_WORKFLOW_02_RESILIENT_ROUTER_TEST_RU.md`: visual missing lines after import = n8n rendering artifact; fix by re-importing the JSON.
- Updated NEXT_ACTIONS.md Phase 3 import step with the re-import note.

**What is next (in order):**
1. **Operator: commit** current changes (troubleshooting note + doc updates).
2. **Operator Phase 1**: Create 6 Sheets tabs with 47-column header rows (see guide Step 4).
3. **Operator Phase 3**: Import workflow, set credentials + Spreadsheet ID, run Tests A–E. If Switch by Route lines not visible → delete and re-import.
4. If all 5 pass: approve for Phase 4 — production migration.

---

## Session: 2026-06-06 — Resilient Router TEST HARNESS Build

**What was done:**
- Built `n8n/workflows/02_claude_api_single_record_v2_resilient_router_test.json` — 21-node workflow, active=false, no real credentials, validated VALID with python3.
- Architecture: Build Primary Claude Request → IF Skip Primary API? → (mock path: Build Repair Request) / (real path: Claude Primary API Request → Parse Primary JSON → IF Primary Parse OK? → [ok: Normalize+Route] [fail: Build Repair Request]) → Claude Repair API Request → Parse Repaired JSON → Normalize + Route → Switch by Route → 6 Append nodes.
- Mock modes: `none` (Tests A/B/C — real primary API), `mock_markdown` (Test D — bypass primary, repair runs), `mock_unrepairable` (Test E — repair forced to technical_error in Parse Repaired JSON code).
- Built `docs/N8N_WORKFLOW_02_RESILIENT_ROUTER_TEST_RU.md` — Russian test guide.
- Added DEC-034 to DECISIONS.md. Updated NEXT_ACTIONS.md (Phase 2 complete, Phase 3 next), AGENT_LOG.md.

**What is next (in order):**
1. **Operator: commit** staged changes (2 deletions from cleanup + new harness files + doc updates).
2. **Operator Phase 1**: Create 6 Sheets tabs with 47-column header rows (see guide Step 4).
3. **Operator Phase 3**: Import workflow, set credentials + Spreadsheet ID, run Tests A–E.
4. If all 5 pass: approve for Phase 4 — production migration.
5. Deferred: TABLE_SCHEMA.md 6-tab update, COSTS_AND_LIMITS.md repair cost note, AGENT_CAPABILITIES.md repair formatter entry, cleanup phase 2.

---

## Session: 2026-06-06 — Cleanup Phase 1 Execution

**What was done:**
- Ghost files (`=70`, `Append`, etc.) confirmed already absent — no rm needed.
- `git rm` executed on 2 approved experiment workflow JSONs:
  - Deleted: `02_claude_api_single_record_v2_test_harness.json` (v2.5 MICRO harness, gateway 502)
  - Deleted: `02_claude_api_single_record_v2_baseline_short_test5.json` (Test 5 short variant)
- All 5 keep workflow JSONs confirmed present after deletion.
- Working tree before: clean (c8a3f08, 9008d9b committed). After: 2 deletions staged + 4 doc updates.
- Updated PROJECT_CLEANUP_AUDIT.md (phase 1 execution summary), NEXT_ACTIONS.md (Step D0 done, Step D current), AGENT_LOG.md, recent.md.
- Phase 2 cleanup (PROMPT_V2_PLAN, SYSTEM_PROMPT, TEST_DATA, MILESTONE_REVIEW_02) deferred.

**What is next (in order):**
1. **Operator commits staged changes** (`git commit` — 2 deletions + 4 doc updates).
2. **Step D Phase 1 (operator):** Create 6 Sheets tabs in "Marketing Scout Results" + add 6 technical columns to all tab headers.
3. **Step D Phase 2 (Claude Code):** Build Resilient Output Layer TEST HARNESS JSON.
4. **Step D Phase 3 (operator):** Run Tests A–E; confirm all 5 pass.
5. Step D Phase 4: migrate to production Workflow 02. Then Step E: Firecrawl.

---

## Session: 2026-06-06 — Project Cleanup Audit

**What was done:**
- Inspected all files: 7 workflow JSONs, 9 module files, 20 docs, full git status.
- Found 8 zero-byte ghost files at project root (untracked). Found d350069 baseline untracked.
- Created `docs/PROJECT_CLEANUP_AUDIT.md` — keep list, archive candidates, ghost files, proposed commands, 6-phase plan, 9-item operator decision table.
- Updated NEXT_ACTIONS.md (added Step D0 — cleanup before Resilient Output Layer build).
- No files deleted in that session.

**What is next (in order):**
1. ~~Operator approves deletions~~ → Done. See Phase 1 Execution session above.
2. Commit staged changes. Then Step D: build Resilient Output Layer TEST HARNESS.

---

## Session: 2026-06-06 — Resilient Output Layer Design

**What was done:**
- Extended tests 8–12 run by operator. Tests 1 and 8 (hot PTS leads) passed strongly. Tests 9–12 failed: no text item (9), Markdown analysis blocks (10, 11), invalid JSON (12).
- Diagnosis: serialization layer failures, not business logic failures. Claude reasons correctly.
- Created `docs/WORKFLOW_02_RESILIENT_OUTPUT_LAYER.md`: two-pass architecture (Primary Parse → Repair Formatter → Router), 6 Sheets tabs, 6 technical fields, 5 Tests A–E, 6-phase rollout.
- Added DEC-033. Updated TEST_RESULTS, CAPABILITIES, ROADMAP, NEXT_ACTIONS, AGENT_LOG.

**Key decisions:**
- DEC-033: stop prompt format experiments; two-pass repair + routing is the fix.
- JSON Repair Formatter: Haiku model, temp=0.0, ~400-char schema-only prompt.

**What is next (in order):**
1. ~~Cleanup audit and phase 1~~ → Done. See sessions above.
2. Commit. Step D: Sheets tabs (operator) → TEST HARNESS build (Claude Code) → Tests A–E → production.

---

<!-- Sessions older than 3 archived in core/warm/decisions.md -->
<!-- Removed: 2026-06-05 Extended Tests + Final Docs, Baseline Raw JSON Short Test 5, Prompt v2.5 MICRO, v2.4 Compact KEY=VALUE, v2.3 KEY=VALUE, v2.2 tool_use, v2.1 JSON Stability, TEST HARNESS, Prompt v2 Written, Business Requirements, Milestone Review 02, 2026-06-04 Foundation -->
