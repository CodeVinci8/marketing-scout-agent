# Hot Memory — Recent Sessions

Most recent first. Keep last 3 sessions max. Archive older entries to `core/warm/decisions.md`.

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
