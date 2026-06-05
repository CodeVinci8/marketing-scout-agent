# AGENT_LOG.md — Session Log

One entry per session that produces tangible output.
Most recent first.

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
