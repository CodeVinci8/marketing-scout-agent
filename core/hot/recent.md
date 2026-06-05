# Hot Memory — Recent Sessions

Most recent first. Keep last 3 sessions max. Archive older entries to `core/warm/decisions.md`.

---

## Session: 2026-06-05 — Prompt v2.3 KEY=VALUE Line Protocol

**What was done:**
- v2.2 failed: gateway returned 502 Bad Gateway for tool_use. Also: broken connection bug — Select Test Record was pointing to non-existent node name, entire chain was disconnected.
- v2.3 fix: Claude returns 25 KEY=VALUE lines. No JSON. No tool_use. Parse node splits on `=`, no JSON.parse on Claude output. `parse_method=line_protocol` on success, `line_failed` on error.
- All workflow connections rebuilt from scratch in Python. Chain verified: Manual Start → Set Test Selector → Select Test Record → Build Claude Request v2.3 → Claude API Request → Parse Claude Line Response → Quality Gate → Google Sheets.
- Added DEC-026. Updated NEXT_ACTIONS.md, test plan (full rewrite), AGENT_LOG.md.
- JSON validated: 32,077 bytes, python3 -m json.tool exits 0.

**Key decisions:**
- DEC-026: KEY=VALUE line protocol chosen — gateway blocks tool_use, raw JSON is unstable for Russian text fields.
- Connection rebuilding done at Python script level (not by editing JSON by hand) to prevent stale-key bugs.

**What is next (in order):**
1. **Step D (immediate):** Delete old v2.2 harness in n8n; import updated harness; run Test 1 → Test 5 → Test 6 in that order; check `parse_method=line_protocol`; fill protocol table; measure cost.
2. Get operator approval → update Workflow 02 with v2.3 Build + Parse structure.
3. Step B: minor doc fixes (README.md, tools/TOOLS.md, core/warm/decisions.md DEC-018–026).
4. Step E: Workflow 03 Firecrawl (competitor website).

---

## Session: 2026-06-05 — Prompt v2.2 tool_use Architecture

**What was done:**
- Upgraded prompt to v2.2: removed all JSON-text output instructions, added tool_use output instruction. Business logic unchanged.
- Upgraded test harness: `Build Claude Request v2.2` now sends `tools` array with full JSON Schema for `return_marketing_analysis` + `tool_choice: {type:"tool", name:"return_marketing_analysis"}`. Claude fills schema fields directly; no text serialization.
- Parse node primary path: `content.find(type=tool_use && name=return_marketing_analysis).input`. Text parser retained as fallback. New `parse_method` output field shows which path ran.
- Added DEC-025: tool_use is preferred architecture for Claude API structured output.
- JSON revalidated: 33,540 bytes, python3 -m json.tool exits 0.
- Updated test plan, DECISIONS.md, NEXT_ACTIONS.md, AGENT_LOG.md.

**Key decisions:**
- DEC-025: raw JSON text from Claude is not production-safe for Russian-language fields; tool_use structured output eliminates the failure mode at the API level.
- Text fallback retained: if the gateway (aiprimetech.io) strips `tools`/`tool_choice`, `parse_method=text_fallback` will appear — escalate separately if that happens.

**What is next (in order):**
1. **Step D (immediate):** Import updated TEST HARNESS (delete old v2.1 version first); run Test 1 first → check `parse_method=tool_use`; then Test 5, Test 6; if all 3 pass, run Tests 2/3/4/7; fill protocol table; measure cost.
2. Get operator approval → update Workflow 02 Build Claude Request with v2.2 tool_use structure.
3. Step B: minor doc fixes (README.md, tools/TOOLS.md, core/warm/decisions.md DEC-018–025).
4. Step E: Workflow 03 Firecrawl (competitor website).

---

## Session: 2026-06-05 — Prompt v2.1 JSON Stability Patch

**What was done:**
- Upgraded `MARKETING_AGENT_PROMPT_V2.md` to v2.1: added JSON SAFETY RULES section (10 rules preventing parse failures), tightened `offer_text` for content_idea (plain text, max 180 chars, no quotes, no leading labels), added `detected_need` for content_idea (client fear/objection), updated schema descriptions, added v2.1 version note.
- Upgraded Parse node in `02_claude_api_single_record_v2_test_harness.json`: added brace extraction (strip text before `{` / after `}`) and smart quote normalization (curly quotes, guillemets) before JSON.parse. JSON re-validated: 33,834 bytes, python3 -m json.tool exits 0.
- Added DEC-024: zero JSON parse failures = hard blocker for v2 approval.
- Updated test plan, DECISIONS.md, NEXT_ACTIONS.md, AGENT_LOG.md.
- Root cause of Test 5 failure: Claude returned article title with internal quotes/colons in `offer_text`, producing invalid JSON.

**Key decisions:**
- DEC-024: parse failure on any expected-analyzed record blocks approval unconditionally.
- Parse node now has three defensive layers: fence removal → brace extraction → quote normalization.

**What is next (in order):**
1. **Step D (immediate):** Import updated TEST HARNESS; run Test 5 first to verify v2.1 fix; if pass, run tests 1–4, 6–7; fill protocol table; measure cost; present to operator.
2. Get operator approval → update Workflow 02 Build Claude Request with v2.1 prompt.
3. Step B: minor doc fixes (README.md, tools/TOOLS.md, core/warm/decisions.md DEC-018–024).
4. Step E: Workflow 03 Firecrawl (competitor website).

---

## Session: 2026-06-05 — TEST HARNESS Workflow Created

**What was done:**
- Created `n8n/workflows/02_claude_api_single_record_v2_test_harness.json` — importable n8n workflow with Prompt v2 and all 7 test records pre-embedded. Operator changes only `test_id` (1–7) in Set Test Selector node.
- Workflow: Manual Start → Set Test Selector → Select Test Record (7 records in code) → Build Claude Request v2 (prompt embedded, claude-sonnet-4-6, 1400 tokens, temp 0.2) → Claude API Request → Parse Claude JSON Response (adds test comparison fields) → Quality Gate → Append Row to Google Sheets
- JSON validated with python3 -m json.tool; active=false; no secrets; old Workflow 02 untouched
- DEC-023 added: TEST HARNESS approach preferred over manual node editing
- `N8N_WORKFLOW_02_V2_TEST_PLAN_RU.md` rewritten — import procedure, credential binding, test_id cycling, protocol table, cost measurement, Git restoration

**Key decisions:**
- TEST HARNESS is the testing method — not manual copy-paste
- Production Workflow 02 JSON unchanged until after test approval

**What is next (in order):**
1. **Step D (immediate):** Import TEST HARNESS into n8n; bind credentials; add Spreadsheet ID; run tests 1–7; fill protocol table; measure cost; present results to operator
2. Get operator approval → update Workflow 02 Build Claude Request with v2 prompt
3. Step B: minor doc fixes (README.md, tools/TOOLS.md, core/warm/decisions.md DEC-018–023)
4. Step E: Workflow 03 Firecrawl (competitor website)

---

## Session: 2026-06-05 — Prompt v2 Written

**What was done:**
- `MARKETING_AGENT_PROMPT_V2.md` written (~12 KB): analyst identity, priority order (leads → competitors → content), confirmed ICP, region scoring (MO leads 60–100; out-of-region cap 40), product hierarchy (PTS/auto first), competitor threat framework, lead urgency model (fit × urgency × readiness), content angle in offer_text, structured 3-sentence reason, evidence citation requirement, expanded skip/anti-hallucination rules
- `TEST_RECORDS_V2.md` created: 7 synthetic records with input JSON, expected scores, pass criteria
- `docs/N8N_WORKFLOW_02_V2_TEST_PLAN_RU.md` created: full Russian test guide for n8n manual testing
- DEC-022 added: no new JSON schema columns until v2 validated in production (same 25 fields as v1)
- `docs/PROMPTS.md`, `AGENT_CAPABILITIES.md`, `NEXT_ACTIONS.md`, `DECISIONS.md` updated

**Key decisions:**
- Schema unchanged: v2 prompt uses same 25 output fields — no new columns until production validation
- New fields (competitor_threat_summary, content_angle, urgency_indicator, icp_fit) planned for v2.1+
- Workflow 02 JSON NOT modified yet — only after test approval

**What is next (in order):**
1. **Step D (immediate):** Run 7 synthetic tests — follow `N8N_WORKFLOW_02_V2_TEST_PLAN_RU.md`; cost ~$0.10–0.20
2. Review test results with operator; get approval to embed v2 in Workflow 02
3. Step B: remaining minor doc fixes (README.md, tools/TOOLS.md, core/warm/decisions.md)
4. Step E: Workflow 03 Firecrawl (competitor website)

---

## Session: 2026-06-05 — Business Requirements (Uncle Consultation)

**What was done:**
- Step A complete: uncle's business priorities confirmed and documented
- Created `docs/BUSINESS_REQUIREMENTS.md` — full BRD with goal, priorities, source order, ICP, product scope, useful row definition, field mapping, open questions, implications for Prompt v2 and scraping
- Updated `NEXT_ACTIONS.md` — Step A marked done; Step C updated with confirmed facts
- Updated `AGENT_CAPABILITIES.md` — confirmed business requirements section added; v2 improvement list updated
- Updated `MARKETING_AGENT_PROMPT_V2_PLAN.md` — priority order section added; ICP rewritten with confirmed uncle facts; region scoring rule and product priority added
- Updated `TABLE_SCHEMA.md` — uncle field mapping table added (no schema changes)

**Key facts confirmed:**
- Priority: lead signals → competitors → content ideas
- Region: Moscow + Moscow Oblast (mandatory for high lead_signal_score)
- Products: PTS/auto first, real estate, refinancing, mortgage, business loans
- Business sources: Telegram, Instagram, Avito, competitor websites
- Technical start: competitor websites first (lower risk), then Avito, then Telegram, then Instagram

**What is next (in order):**
1. Step B: finish remaining doc fixes — README.md, tools/TOOLS.md, core/warm/decisions.md (DEC-018–021 + DEC-022)
2. Step C: write MARKETING_AGENT_PROMPT_V2.md (ICP now confirmed — ready)
3. Step D: test v2 on 5 synthetic records (~$0.10)
4. Step E: Workflow 03 Firecrawl (competitor website first)

---

## Session: 2026-06-05 (latest)

**What was done:**
- Milestone Review 02 completed — full audit of all project files
- Found: prompt v1 is extractor/classifier, not marketing analyst; 12 doc consistency issues; 7 risks before scraping
- Created `docs/MILESTONE_REVIEW_02.md` — comprehensive review with security checklist and 5 recommended actions
- Created `modules/marketing-scout-v0/MARKETING_AGENT_PROMPT_V2_PLAN.md` — 15-section plan for stronger agent prompt
- Added DEC-021: no paid scraping until Prompt v2 ready and uncle consulted
- Restructured NEXT_ACTIONS into 3 pre-steps before Workflow 03

**Baselines locked:**
- Workflow 00 / 01 / 02 — do not modify these files

**What is next (in order):**
1. **Step A:** Ask uncle — primary use case, target platforms, region, product types, what "useful output" means
2. **Step B:** Write MARKETING_AGENT_PROMPT_V2.md based on plan; test against 5 synthetic records; get approval
3. **Step C:** Fix 12 doc consistency issues (WORKFLOW_DESIGN.md, TABLE_SCHEMA.md, README.md, etc.)
4. Only then: Workflow 03 — Firecrawl

**Decisions since last hot memory update:** DEC-019, DEC-020, DEC-021

---

## Session: 2026-06-04

**What was done:**
- Reviewed Claude Code agent architecture course concepts (identity files, rules, hot/warm/cold memory, plan-before-code, decision logs, safety boundaries)
- Designed lightweight project-agent structure for Marketing Scout — no external frameworks
- Created full directory structure: `core/`, `docs/`, `modules/marketing-scout-v0/`, `tools/`, `n8n/`, `scripts/`, `backups/`
- Wrote all foundation documents: `CLAUDE.md`, `README.md`, `core/AGENTS.md`, `core/USER.md`, `core/rules.md`, `core/MEMORY.md`, `tools/TOOLS.md`, all `docs/` files, all `modules/marketing-scout-v0/` files

**What was decided:**
- Markdown-first, lightweight architecture — no heavy agent SDKs
- Plan-before-code workflow: always show plan, get approval, then create files
- Five future agents defined but not implemented: project-engineer, marketing-scout, workflow-designer, data-analyst, prompt-engineer
- Stack locked for v0.1: n8n + Apify/Firecrawl + Claude API + Google Sheets + Telegram

**What is next:**
- Review all created files and refine content if needed
- Begin actual n8n workflow design in detail
- Draft the first real system prompt version for Claude API analysis node
- Set up n8n on VPS and configure first workflow nodes
