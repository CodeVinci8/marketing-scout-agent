# Hot Memory — Recent Sessions

Most recent first. Keep last 3 sessions max. Archive older entries to `core/warm/decisions.md`.

---

## Session: 2026-06-05 — Extended Tests 8–12 + Final Test Docs

**What was done:**
- Created `02_claude_api_single_record_v2_extended_tests.json` (30,879 bytes): d350069 baseline + tests 8–12 (Telegram hot lead, Instagram competitor, Avito refinancing MO, weak website competitor, out-of-region SPb). JSON valid.
- Created `TEST_RECORDS_V2_EXTENDED.md`: full test specs with input JSON, expected outputs, pass/fail criteria.
- Created `WORKFLOW_02_V2_TEST_RESULTS.md`: empty protocol table ready for operator to fill.
- Updated test plan, AGENT_CAPABILITIES.md, ROADMAP.md (added Stage 2.5 Telegram Control Bot), DECISIONS.md (DEC-030 content deferred, DEC-031 no repeat tests, DEC-032 bot future), COSTS_AND_LIMITS.md, NEXT_ACTIONS.md.

**Key decisions:**
- DEC-030: content_idea deferred to Stage 3 (Content Agent). Not in extended tests.
- DEC-031: no repeat tests. Extended 8–12 cover uncle's priorities.
- DEC-032: Telegram Control Bot is future roadmap (Stage 2.5), not current MVP.

**What is next (in order):**
1. **Step D (immediate):** Run Test 5 (short) on baseline_short_test5 harness. Then run Tests 8–12 on extended_tests harness. Record all results in WORKFLOW_02_V2_TEST_RESULTS.md.
2. Get operator approval → close Workflow 02 v2 testing stage → update production Workflow 02.
3. Step B: doc fixes (README.md, tools/TOOLS.md, core/warm/decisions.md, TABLE_SCHEMA.md company_name rule).
4. Step E: Workflow 03 Firecrawl (first real source).

---

## Session: 2026-06-05 — Baseline Raw JSON SHORT TEST 5

**What was done:**
- d350069 baseline works (Test 1: quality=97, lead_signal=98, action=contact). v2.1–v2.5 all failed (JSON.parse, 502). DEC-029.
- Created `02_claude_api_single_record_v2_baseline_short_test5.json`: exact baseline clone, only Test 5 text_context shortened (252→139 chars). New text is short VK question. No other changes.
- JSON validated: 33,018 bytes. active=false. No real creds. v2.5 harness untouched.
- Rewrote test plan: status table, Test 5 change rationale, 2-test retest order. Updated NEXT_ACTIONS.md, DECISIONS.md (DEC-029), AGENT_LOG.md.

**Key decisions:**
- DEC-029: baseline raw JSON is the working fallback. v2.1–v2.5 experiments deferred.
- Incremental fix: shortest possible change to the baseline (one field, one record).

**What is next (in order):**
1. **Step D (immediate):** Import `02_claude_api_single_record_v2_baseline_short_test5.json`. Run test_id=5 first. If passes: run test_id=1. If both pass: discuss with operator whether to approve baseline.
2. Get operator approval → update production Workflow 02.
3. Step B: doc fixes (README.md, tools/TOOLS.md, core/warm/decisions.md).
4. Step E: Workflow 03 Firecrawl.

---

## Session: 2026-06-05 — Prompt v2.5 MICRO

**What was done:**
- v2.4 (5.3 KB compact) returned 502 upstream_error. Minimal curl works. Diagnosis: gateway threshold is well below 5 KB — micro-sized runtime prompt required. DEC-028.
- v2.5 MICRO: runtime prompt stripped to 1997 chars (~2 KB). Essential rules only; full methodology preserved in the canonical file (Full Methodology Reference section, not sent at runtime).
- max_tokens 700 → 450. User message: profile_url removed. Field limits tightened: offer_text 80, text_context 100, detected_need 100, reason 120.
- Build node renamed to `Build Claude Request v2.5 MICRO`. Connections rebuilt from scratch. JSON validated: 24,138 bytes.
- Test plan rewritten: Step 0 curl-test added (must curl before n8n). Updated cost estimates.
- Added DEC-028. Updated COSTS_AND_LIMITS.md (v2.5 row, <2.5 KB guidance). Updated NEXT_ACTIONS.md, AGENT_LOG.md.

**Key decisions:**
- DEC-028: gateway requires micro-sized runtime prompts. Detailed methodology lives in docs only, not in runtime prompt.
- If 502 persists with v2.5 MICRO (~2 KB): problem is NOT prompt size — check balance, rate limits, routing.

**What is next (in order):**
1. **Step D (immediate):** curl-test first (Step 0 in test plan). Then delete old harness, import v2.5 harness. Run Test 1 → Test 5 → Test 6. If all pass, run Tests 2/3/4/7. Fill protocol table.
2. Get operator approval → update production Workflow 02 with v2.5 MICRO structure.
3. Step B: doc fixes (README.md, tools/TOOLS.md, core/warm/decisions.md DEC-018–028).
4. Step E: Workflow 03 Firecrawl.

---

## Session: 2026-06-05 — Prompt v2.4 Compact KEY=VALUE

**What was done:**
- v2.3 (9.2 KB prompt) returned 502 on Test 1. Minimal curl to gateway works → gateway alive, key valid. Diagnosis: request too large for gateway. DEC-027.
- v2.4 compact: prompt rewritten to 5.3 KB (same business logic, compressed). max_tokens 1100→700. Estimated 42% smaller request.
- `Build Claude Request v2.4` updated. `Parse Claude Line Response` logic unchanged. Connections rebuilt from scratch. JSON validated: 28,139 bytes.
- COSTS_AND_LIMITS.md: added gateway stability / prompt size guidance table.
- Added DEC-027. Updated test plan, NEXT_ACTIONS.md, AGENT_LOG.md.

**Key decisions:**
- DEC-027: compact prompts ≤6 KB required for this gateway. Verified: small curl works; 9 KB prompt causes 502.
- If 502 persists with v2.4 compact → problem is NOT prompt size. Check balance, rate limits, gateway routing.

**What is next (in order):**
1. **Step D (immediate):** Delete old harness from n8n. Import v2.4 harness. Run Test 1 first — watch for 502. If 502: diagnose gateway (check balance, raw curl from VPS). If OK: run Test 5, Test 6, then 2/3/4/7.
2. Get operator approval → update production Workflow 02 with v2.4 Build + Parse nodes.
3. Step B: doc fixes (README.md, tools/TOOLS.md, core/warm/decisions.md DEC-018–027).
4. Step E: Workflow 03 Firecrawl.

---

<!-- Sessions older than 3 archived below for reference only -->

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
