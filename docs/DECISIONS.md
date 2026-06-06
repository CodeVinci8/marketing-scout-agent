# DECISIONS.md — Decision Register

Non-obvious architectural and design choices with reasoning.
Most recent first.

---

## DEC-038 — Production Smoke-Test Patch: Diagnostics Preservation, Compact Repair, 33 English Columns

**Date:** 2026-06-06
**Context:** First manual production smoke test (competitor website record) failed: primary parse failed, the Repair API returned **502 Bad Gateway / upstream_error**, the row went to `technical_errors`, and `raw_response_preview` showed only the repair error — the primary raw response was lost, making diagnosis impossible.

**Decisions:**
1. **`technical_errors` rows must preserve both failure stages.** `parse_error` = `Primary: <primary error> | Repair: <repair error>` (≤800). `raw_response_preview` keeps the **primary** raw response first (≤500), appending the repair error only if space remains. The primary raw response is never overwritten by the repair error alone. `Parse Primary JSON` now always emits `primary_parse_error`, `primary_raw_response_preview`, `content_summary`, `original_record`; `Parse Repaired JSON` reads them back via `$('Parse Primary JSON')`.
2. **Compact repair payload to reduce gateway 502 risk.** Repair request: trimmed `original_record` (essential fields, `text_context`≤500), `primary_raw_response_preview`≤500, `primary_parse_error`≤300, compact schema + enum summary, `max_tokens=700`, `temperature=0`. System prompt opens "You are a JSON repair formatter, not a market analyst…". No tool_use, no KEY=VALUE.
3. **Production schema is 33 English machine columns** (25 core + 8 technical). Every Sheets tab uses exactly this header. **Russian/human display names are deferred to the Telegram/reporting layer** — they are not part of the internal schema, and the Sheets headers must stay English.
4. **`parse_method=technical_error`** is used when repair fails (distinct from `primary_json` / `repaired_json` success values).
5. **Primary prompt reminder** added (short): JSON-only output, and classify competitor-website records as `competitor` when they offer secured lending services/rates/speed/contact/Moscow-MO coverage. No methodology bloat, no format experiment.
6. **No new workflow copy** — patched in place (validation passed). Firecrawl stays blocked until the patched production smoke test passes.

**Verification:** `python3 -m json.tool` VALID; output schema still exactly 33 fields; leakage scan shows no test/mock/tool_use/KEY=VALUE; logic simulation of primary-fail + repair-502 chain produces a `technical_errors` row carrying both errors and the primary raw preview (33 fields).

**File:** `n8n/workflows/02_claude_api_single_record_v2_resilient_router_production.json` (patched).

---

## DEC-037 — Production Resilient Workflow Strips Test Fields; Test Harness Retained as Evidence

**Date:** 2026-06-06
**Context:** Tests A–E passed on the dynamic-sheet test harness. The harness writes 14 test-only columns (`test_id`, `expected_*`, `actual_*`, `test_pass_basic`, `test_notes`, `source_record_type`) plus mock-mode logic — correct for testing, wrong for production tabs.

**Decision:**
1. **Create a separate production workflow** `02_claude_api_single_record_v2_resilient_router_production.json` (name: `... RESILIENT ROUTER PRODUCTION`). It removes `Set Test Selector`, `Select Test Record`, `IF Skip Primary API?`, all mock-mode logic (`mock_markdown`, `mock_unrepairable`), and every test-only output field. Production emits exactly **33 fields = 25 core + 8 technical**.
2. **Production input** is a single `Set Source Record` node with a safe placeholder (`source_url=https://example.com/source`, `text_context=PLACEHOLDER_TEXT_REPLACE_BEFORE_RUN`, `parsed_at={{ $today }}`) until a scraper is connected.
3. **Test harness retained** (`..._resilient_router_test_dynamic_sheet.json`) as A–E evidence — not the production artifact.
4. **Obsolete Switch-based workflows removed** via `git rm`: `..._resilient_router_test.json` (Switch v3) and `..._resilient_router_test_fixed.json` (Switch v1). Superseded by dynamic-sheet routing (DEC-035).
5. **`repair_used` and `repair_status` retained** as production technical fields — they tell the operator whether the JSON Repair Formatter ran and whether it succeeded, which is operationally important for trust and cost.
6. **`raw_response_preview` capped at 500 chars** in production (was 1200 in the harness) — enough for debugging, not too wide for Sheets, reduces noise/leakage.
7. **`recommended_action` normalized to the route** in `Normalize + Route`: results→contact (lead), review_queue→investigate (unless lead contact & score≥70), monitor_queue→monitor (competitor), technical_errors/skipped_log→ignore, content_queue→create_content (unless a stronger action is justified).
8. **`source_url` is the first v0.1 dedup key.** No dedup column yet; a future scraper workflow should check existing `source_url` before append. Any future `dedup_key` column requires a documented justification and a matching schema/header update.

**Verification:** logic simulation of production `Normalize + Route` — A→results/contact/pts_loan, B→review_queue/investigate/secured_auto_loan, C→monitor_queue/monitor/`МФО / частный кредитор`, D→results/contact/pts_loan, E→technical_errors/ignore, skip→skipped_log/ignore; all emit exactly 33 fields. `python3 -m json.tool` VALID. No test/mock/tool_use/KEY=VALUE leakage.

**Files:** `n8n/workflows/02_claude_api_single_record_v2_resilient_router_production.json` (created); two Switch workflows removed. active=false, placeholders only, no real secrets.

---

## DEC-036 — Routing Priority Fix + service_type/company_name Normalization (Post Tests A–E)

**Date:** 2026-06-06
**Context:** Dynamic-sheet resilient router Tests A–E were run. A, C, D, E passed. **Test B failed business intent:** a weak/potential lead with clear product fit was classified (via repair) as `content_idea` and routed to `content_queue`. Two secondary gaps surfaced: Test C had empty `company_name` for a competitor MFO, and Test D's repaired `service_type` came back as free text (`"займ под залог ПТС"`) instead of an enum.

**Decision:** Patch `Normalize + Route` only (no prompt change, no architecture change, no new workflow copy):

1. **Routing priority** (strict order): technical_errors → business-skip/irrelevant → hot lead (`results`) → **weak/potential lead (`review_queue`)** → competitor (`monitor_queue`) → pure content idea (`content_queue`) → fallback `review_queue`. The weak-lead rule runs **before** content_queue.

2. **Weak/potential lead rule** → `review_queue` if ANY: entity=lead_signal with lead_signal_score 30–69; OR recommended_action=investigate; OR (lead_signal_score≥30 AND source_type in [social, classified] AND text mentions loan/collateral/PTS/auto/real-estate/refinancing); OR (entity=content_idea AND lead_signal_score≥30 AND source_type in [social, classified] AND service_type≠unknown).

3. **content_queue** only if entity=content_idea AND content_idea_score≥50 AND the weak-lead rule did not match.

4. **service_type normalization** to enum: птс/pts→`pts_loan`; авто/машин + collateral→`secured_auto_loan`; недвиж/квартир/дом/земл→`secured_real_estate_loan`; рефинанс→`refinancing`; ипотек→`mortgage_adjacent`; бизнес→`generic_lending` (or `secured_real_estate_loan` only if real-estate collateral explicit); else `unknown`. Already-valid enums pass through unchanged.

5. **company_name descriptive fallback** (competitor, when empty): МФО/микрофинанс/mfo→`МФО / частный кредитор`; частный инвестор→`Частный инвестор`; автоломбард→`Автоломбард`; брокер→`Брокер`; otherwise `Конкурент без бренда`. Never invents a brand.

6. **Test-pass logic:** for `expected_route=review_queue`, pass = (route=review_queue AND needs_manual_review=true AND lead_signal_score≥30) — route-focused, since entity may legitimately differ after repair. Other routes keep strict entity match.

**Verification:** logic simulation confirmed A→results, B→review_queue, C→monitor_queue (company_name=`МФО / частный кредитор`), D→results (service_type=`pts_loan`); all `test_pass_basic=true`.

**Retest required:** Test B (live), then optional A/D smoke. C/E paths unchanged.

**File:** `n8n/workflows/02_claude_api_single_record_v2_resilient_router_test_dynamic_sheet.json` (Normalize + Route node only). active=false, no real secrets.

---

## DEC-035 — Dynamic Google Sheets Routing Replaces Switch by Route

**Date:** 2026-06-06
**Context:** The Switch by Route node (6 outputs → 6 separate Google Sheets Append nodes) caused recurring visual/import problems in the n8n UI: append nodes shifted position, connection lines from Switch did not render reliably, and the six near-identical Append nodes were redundant. Two prior attempts (`_test.json` typeVersion 3 rules-mode, `_fixed.json` typeVersion 1 string-match) both imported but left a cluttered, hard-to-read canvas.

**Decision:** Replace the Switch by Route node and the six per-tab Append nodes with a **single dynamic Google Sheets Append Row node**. The `route` field already contains the exact target tab name (`results`, `review_queue`, `monitor_queue`, `content_queue`, `skipped_log`, `technical_errors`), so the node uses Sheet Name expression `={{ $json.route }}` with Map Automatically. `Normalize + Route` connects directly to this one node.

**Routing logic unchanged.** All thresholds and priority ordering stay in `Normalize + Route`. Only the n8n destination implementation changed: 7 nodes (1 Switch + 6 Append) → 1 node.

**Route-validation safety added to `Normalize + Route`:** if `route` is missing or not one of the six valid values, the node forces `route = technical_errors`, `processing_status = technical_error`, `needs_manual_review = true`, and appends `invalid_route` to `parse_error`. No record can be lost to a bad/empty tab name.

**Fallback:** if a given n8n build rejects an expression in the Google Sheets Sheet Name resourceLocator, revert to branch-based routing — six IF nodes (one per `route` value), each feeding a fixed-tab Append node — using `_fixed.json` as the base. Documented in `docs/N8N_WORKFLOW_02_RESILIENT_ROUTER_TEST_RU.md`.

**Credential/secret pattern unchanged:** `PASTE_CREDENTIAL_ID_HERE`, `PASTE_SPREADSHEET_ID_HERE`, credentials by name only. active=false.

**File:** `n8n/workflows/02_claude_api_single_record_v2_resilient_router_test_dynamic_sheet.json`
**Supersedes (for testing):** `_test.json` and `_fixed.json` (kept as history, not deleted).

---

## DEC-034 — Resilient Router TEST HARNESS: 21-Node Workflow with Mock Modes

**Date:** 2026-06-06
**Context:** Building a testable harness for the Resilient Output Layer (DEC-033) without requiring real scraped data or live API calls for negative tests.
**Decision:** The TEST HARNESS uses three mock modes in Select Test Record:
- `none` — real Primary Claude API call (Tests A, B, C)
- `mock_markdown` — bypasses primary API; feeds a simulated Markdown response to Repair Formatter (Test D)
- `mock_unrepairable` — bypasses primary API; feeds an unreadable response; Parse Repaired JSON checks `mock_mode` and forces `processing_status=technical_error`, `route=technical_errors` regardless of repair output (Test E)

Repair API is still called for Test E (unavoidable — the mock bypass is in Parse Repaired JSON, not before the HTTP node). One extra API call for Test E is acceptable — costs ~$0.001.

IF Skip Primary API? checks `skip_primary_api === true` and routes True → Build Repair Request, False → Claude Primary API Request. The HTTP body strips `skip_primary_api` via explicit field selection in body expression so Anthropic API does not receive unknown parameters.

Normalize + Route passes through confirmed `technical_error` records without re-routing. For all others it validates entity_type and recommended_action against allowed enum sets, clamps scores 1–100, and applies routing thresholds. Test assertion fields (`test_pass_basic`, `test_notes`, `expected_route`) are output alongside business fields for easy review in Sheets.

**Credential pattern:** `PASTE_CREDENTIAL_ID_HERE` for both httpHeaderAuth and googleApi in all relevant nodes. `PASTE_SPREADSHEET_ID_HERE` for all 6 Append nodes. No real secrets in file.

**File:** `n8n/workflows/02_claude_api_single_record_v2_resilient_router_test.json`
**Guide:** `docs/N8N_WORKFLOW_02_RESILIENT_ROUTER_TEST_RU.md`

---

## DEC-033 — Resilient Output Layer: Two-Pass Parse + Repair + Multi-Tab Router

**Date:** 2026-06-06
**Context:** Extended tests 9–12 confirmed that the single-step Claude JSON output is structurally unstable for non-obvious records:
- Test 9 (Instagram competitor): no `text` item in content array — thinking-only response.
- Test 10 (Avito refinancing): Claude returned Markdown analysis block instead of JSON.
- Test 11 (weak website competitor): Claude returned Markdown analysis block instead of JSON.
- Test 12 (out-of-region SPb lead): invalid JSON structure.
- Test 5 (content_idea): JSON.parse failure from unescaped characters in string fields.

In all cases, Claude's reasoning was sound. The failures were output serialization failures, not reasoning failures.

Five output strategy experiments (v2.0 raw JSON, v2.1 safety rules, v2.2 tool_use, v2.3–v2.5 KEY=VALUE) all failed — either from gateway 502 constraints or from parsing edge cases. Further prompt-level format experiments are not expected to eliminate the failure mode.

**Decision:** Replace the single-step output architecture with a Resilient Output Layer:
1. **Primary parse:** attempt JSON.parse on Claude's natural output (baseline behavior unchanged).
2. **Repair pass:** on parse failure, send the raw response to a dedicated JSON Repair Formatter (a second Claude call, Haiku model, ~400-char strict schema-only prompt). Reformats without re-analyzing. Does not add new facts.
3. **Multi-tab Router:** replaces the binary Quality Gate. Routes to 6 Google Sheets tabs: `results`, `review_queue`, `monitor_queue`, `content_queue`, `skipped_log`, `technical_errors`.

**Three output states defined:**
- `parsed_success`: machine-parseable on first attempt.
- `technical_error`: unparseable even after repair.
- `business_skip`: correctly parsed; Claude determined record is not actionable.

**tool_use status:** Deferred — gateway returns 502 for `tools`/`tool_choice` parameters.
**KEY=VALUE status:** Deferred — v2.3–v2.5 all returned 502 from gateway at various prompt sizes.

**Applies to:** Workflow 02 TEST HARNESS (Phase 1). After Tests A–E pass, migrate to production Workflow 02. All future output layers in this project should use the two-pass pattern.

**Design spec:** `docs/WORKFLOW_02_RESILIENT_OUTPUT_LAYER.md`

---

## DEC-032 — Telegram Control Bot Is Future Roadmap, Not Current MVP

**Date:** 2026-06-05
**Decision:** An operator Telegram Control Bot (Stage 2.5 in ROADMAP.md) is added to the project plan but is not part of the current MVP scope. It requires: (1) at least one stable real scraping source, (2) Workflow 02 approved for production, (3) Telegram Webhook configured in n8n. Building the bot before the data pipeline is stable would create an interface with nothing to interface. Prioritize real source testing first.
**Applies to:** All session planning. Do not start bot implementation until Step E (Firecrawl) is complete and approved.

---

## DEC-031 — Do Not Repeat Proven Tests; Extend with Business-Priority Scenarios

**Date:** 2026-06-05
**Decision:** Tests 1–7 were designed to cover basic classification correctness. Test 1 confirmed the baseline works strongly. Rather than re-running all 7 tests (which would cost ~$0.10 and mostly repeat confirmed behavior), the extended test set (8–12) covers the uncle's actual business priorities: Telegram hot leads, Instagram competitors, Avito refinancing, website weak signal, and out-of-region cap. These scenarios are more representative of real scraping output and cover edge cases not exercised in the original 7-test set.
**Applies to:** Workflow 02 v2 testing. After extended tests pass, close this testing stage.

---

## DEC-030 — Content Automation Deferred to Stage 3 (Content Agent)

**Date:** 2026-06-05
**Decision:** `content_idea` records are not production-approved for Workflow 02. The current Quality Gate (status=analyzed AND quality_score≥60) passes content_idea records to Google Sheets, but the schema has no dedicated column or review process for them. They create noise in the leads/competitors table. Content intelligence is deferred to Stage 3 (Content Agent) with a separate Sheets tab, separate Quality Gate, and separate n8n branch. Extended tests 8–12 do not include content_idea scenarios.
**Applies to:** Workflow 02 configuration and all future Quality Gate decisions until Stage 3 is designed.

---

## DEC-029 — Baseline Raw JSON Is the Working Fallback; v2.1–v2.5 Experiments Deferred

**Date:** 2026-06-05
**Context:** The d350069 baseline raw JSON harness works: Test 1 passed (entity_type=lead_signal, recommended_action=contact, quality_score=97, lead_signal_score=98). The v2.1–v2.5 experiments all failed or were unstable:
- v2.1: JSON.parse failures on Test 1 and Test 5.
- v2.2: Gateway 502 on tool_use.
- v2.3: Gateway 502 at 9.2 KB.
- v2.4: Gateway 502 at 5.3 KB.
- v2.5 MICRO: curl still returned 502 at ~2 KB.
All 502 failures happened after Test 1 passed on the baseline — the gateway can handle the baseline payload.
**Decision:** The baseline raw JSON harness (d350069) is the current working approach. The v2.1–v2.5 experiment files are preserved in the repository but are not the active test path. The immediate task is to fix the only known baseline failure point: Test 5 (`content_idea` with long text that produced JSON.parse errors). A shortened Test 5 is the smallest possible change to validate before approving the baseline.
**Rationale:** Incrementally fixing the baseline is lower-risk than chasing gateway compatibility with experimental output formats that all returned 502. The gateway clearly handles the baseline payload — the only remaining question is whether Claude produces valid JSON for the shortened Test 5 text.
**Next step:** Run `02_claude_api_single_record_v2_baseline_short_test5.json` with test_id=5 first. If it passes, run test_id=1 to confirm baseline is unaffected. Then decide whether to approve the baseline for production.
**Applies to:** Prompt v2 test strategy until gateway constraints are resolved or a direct Anthropic API endpoint is available.

---

## DEC-028 — Micro-Sized Runtime Prompts Required; Detailed Methodology Stays in Docs Only

**Date:** 2026-06-05
**Context:** v2.4 compact prompt (5.3 KB / 5343 chars) still returned 502 upstream_error from the gateway. Minimal curl with a very small prompt continues to work. Conclusion: the gateway cannot reliably handle even moderately sized prompts — the threshold is well below 5 KB.
**Decision:** Strip runtime prompts to the absolute minimum — essential rules, enums, field limits, and output format only. Target: 1500–2200 chars (~1.5–2 KB). All detailed methodology (ICP description, evidence rules, anti-hallucination prose, full skip rules) is preserved in the canonical prompt file (`MARKETING_AGENT_PROMPT_V2.md`) for reference and debugging, but is NOT included in the runtime prompt sent to Claude.
**v2.5 MICRO changes:**
- System prompt: 5343 chars (v2.4) → 1997 chars (v2.5). −63%.
- max_tokens: 700 → 450. Sufficient for 25 KEY=VALUE lines.
- User message: removed profile_url (not needed for core analysis).
- Field limits tightened: offer_text 140→80, text_context 220→100, detected_need 160→100, reason 220→120.
**Long-term posture:** Detailed agent prompts and tool_use are deferred until an official Anthropic API endpoint or a verified-stable gateway is confirmed. Micro prompt is the production approach for this gateway. If scoring quality is insufficient, restore sections one at a time and retest.
**If 502 persists with v2.5 MICRO:** The issue is NOT prompt size. Check gateway balance (402 masks as 502), per-minute rate limits, or account-level routing. Run raw curl from VPS with the full v2.5 payload to isolate n8n from gateway.
**Applies to:** All Claude API calls via aiprimetech.io until gateway constraints are resolved or a different gateway is adopted.

---

## DEC-027 — Compact Prompts Required for Stable Gateway Execution

**Date:** 2026-06-05
**Context:** v2.3 used the correct KEY=VALUE line protocol (resolves JSON parsing failures) but still returned 502 Bad Gateway on Test 1. The prompt was 9.2 KB. A minimal curl with a short prompt to the same gateway and same model works correctly. Conclusion: the gateway has request-size or processing-time constraints that cause 502 for large payloads. The failure is not network-level or credential-level.
**Decision:** Use compact prompts for all Claude API calls via this gateway. Target: ≤6 KB system prompt. Specific reductions in v2.4:
- System prompt: 9.2 KB → 5.3 KB (same business logic, rewrote all sections for brevity).
- max_tokens: 1100 → 700 (line protocol responses are short; 700 is sufficient for 25 KEY=VALUE lines plus field content).
- temperature: kept at 0.1.
- Field char limits tightened: offer_text 180→140, detected_need 220→160, text_context 300→220, reason 350→220.
**If 502 persists with v2.4 compact prompt:** the issue is not prompt size. Check gateway balance (402 can be masked as 502), model routing, or per-minute rate limits. Do a raw curl from the VPS to isolate n8n vs. gateway.
**Long-term:** If an official Anthropic API endpoint or a verified-compatible gateway becomes available, restore full prompt length and re-evaluate tool_use (DEC-025). Compact prompt is a workaround for the current gateway constraint.
**Applies to:** All Claude API calls via aiprimetech.io until gateway constraints are clarified.

---

## DEC-026 — KEY=VALUE Line Protocol for Claude Output (Gateway Does Not Support tool_use)

**Date:** 2026-06-05
**Context:** Three output strategies failed or were unavailable:
1. v2.0/v2.1: Raw JSON text. Claude put unescaped quotes or colons inside field values (`offer_text`, `reason`, `detected_need`), breaking `JSON.parse`. Prompt-level rules and Parse-node cleanup reduced but did not eliminate failures.
2. v2.2: Anthropic tool_use structured output. The gateway (aiprimetech.io) returned 502 Bad Gateway for all requests containing `tools` and `tool_choice` parameters. tool_use is not supported by this gateway.
   Also discovered: Select Test Record node was not connected to Build Claude Request v2.2 in the generated workflow JSON (stale connection key from node rename). Entire test chain was broken.
**Decision:** Use plain text KEY=VALUE line protocol. Claude returns exactly 25 lines in order: `field_name=value`. The n8n Parse node (`Parse Claude Line Response`) splits each line on the first `=` character and assembles a JS object. No `JSON.parse` is called on Claude's output. Integer fields are parsed with `parseInt` and clamped to 1–100. Enum fields are validated; invalid values fall back to safe defaults. Parse failures are caught deterministically: if fewer than 5 fields are found, `parse_method=line_failed` is returned.
**Workflow fix:** All connections rebuilt from scratch in the Python generation script. The broken connection bug is resolved. The connection chain is now explicit and verified at build time.
**Build parameters changed:** `max_tokens` 1400 → 1100; `temperature` 0.2 → 0.1; no `tools`; no `tool_choice`. User message appended with `\n\nReturn KEY=VALUE lines only.` for reinforcement.
**Known edge case:** If Claude returns a value containing `=` (e.g. in `terms` field), the parser takes everything before the first `=` as the key and everything after as the value. The prompt instructs Claude to avoid `=` inside values. This is acceptable for MVP.
**Applies to:** TEST HARNESS v2.3. If a gateway supporting tool_use becomes available, DEC-025 strategy is preferred and should be re-evaluated at that point.

---

## DEC-025 — tool_use Structured Output Is the Preferred Architecture for Claude API Integration

**Date:** 2026-06-05
**Context:** Raw JSON text output from Claude failed JSON.parse in production twice across two prompt versions:
- v2.0: Test 5 (content_idea) — Claude put colons and quotes inside `offer_text` string value.
- v2.1: Test 1 (strong lead) — Claude put unescaped content inside `reason` or `detected_need` string value.
Prompt-level instructions (JSON SAFETY RULES) and Parse-node-level cleanup (brace extraction, smart-quote normalization) reduced but did not eliminate the failure mode. The root cause is that any Russian text field containing a period, quote, or colon adjacent to other JSON syntax will break `JSON.parse` if Claude serializes incorrectly.
**Decision:** Use Anthropic Messages API `tool_use` structured output instead of asking Claude to write JSON text. The API request includes:
1. `tools`: array with one tool definition `return_marketing_analysis` containing a full JSON Schema (25 fields, `additionalProperties: false`).
2. `tool_choice: { type: "tool", name: "return_marketing_analysis" }` to force the call.
Claude fills schema fields directly. The API serializes the result — Claude never writes raw JSON string values containing quotes or escape sequences. The Parse node reads `content.find(c => c.type === "tool_use" && c.name === "return_marketing_analysis").input` directly as a plain JS object.
**Text fallback retained:** The old text parser remains as a fallback path (`parse_method=text_fallback`) in case the gateway (aiprimetech.io) strips `tools`/`tool_choice` parameters before passing to Claude. If all 7 tests return `text_fallback`, the gateway does not support tool_use and a different solution is needed.
**Parse method field:** The Parse node now outputs `parse_method` = "tool_use" | "text_fallback" | "text_failed" | "none" for observability.
**Prompt changes:** Removed JSON SAFETY RULES, OUTPUT FORMAT, and REQUIRED JSON SCHEMA sections. Added FIELD CONSTRAINTS and OUTPUT INSTRUCTION sections. Business logic unchanged.
**Applies to:** All Claude API integrations in this project from v2.2 onward. If the gateway supports tool_use, prefer it over raw text output for all structured data extraction.

---

## DEC-024 — Prompt v2 Cannot Be Approved If Any Expected-Analyzed Record Fails JSON Parsing

**Date:** 2026-06-05
**Context:** Test 5 (content_idea record) failed with a JSON.parse error in the Parse node during the first full test run. Tests 1, 2, 3, 4, 6, 7 passed. The failure was caused by Claude returning unescaped double quotes or colons inside the `offer_text` string value — a well-formed reasoning response but invalid JSON output.
**Decision:** A JSON parse failure on any record that is expected to return `status=analyzed` is an automatic blocker for Prompt v2 approval. Prompt must be patched and the failing test rerun before the full suite can be approved.
**Rationale:** A parse failure means the output cannot be written to Google Sheets and cannot be used by any downstream system. A prompt that passes 6/7 tests on reasoning quality but produces unparseable output on the 7th is not production-ready. Parse errors are not acceptable in a data pipeline.
**Fix applied in v2.1:** JSON SAFETY RULES section added to prompt; offer_text and detected_need field instructions tightened; Parse node upgraded with brace extraction and smart-quote normalization as a defensive backstop.
**Trigger to unblock:** Rerun Test 5 after v2.1 patch; confirm JSON.parse succeeds and `offer_text` is a plain-text angle (no leading labels, no internal quotation marks, ≤180 chars).

---

## DEC-023 — Prompt v2 Testing: Use TEST HARNESS Workflow, Not Manual Node Editing

**Date:** 2026-06-05
**Context:** The original plan for testing Prompt v2 was to duplicate Workflow 02, manually paste the new prompt into the Build Claude Request Code node, and manually change the Set node fields for each of the 7 test records. This requires 7 manual Set-node edits per run and risks introduction of copy-paste errors.
**Decision:** Use a dedicated importable test harness workflow (`02_claude_api_single_record_v2_test_harness.json`) that has Prompt v2 and all 7 test records pre-embedded. The operator changes only a single `test_id` integer (1–7) to select each record. No manual prompt pasting or code editing required.
**Benefits:** Reproducible, error-resistant, keeps the production Workflow 02 untouched, the harness can be re-imported from Git if accidentally broken in n8n UI.
**Gate unchanged:** The production Workflow 02 is still updated only after all test criteria pass and the operator gives explicit approval.

---

## DEC-022 — Prompt v2 Schema: No New Columns Until v2 Is Validated in Production

**Date:** 2026-06-05
**Context:** The Prompt v2 plan (`MARKETING_AGENT_PROMPT_V2_PLAN.md`) defines four new output fields: `competitor_threat_summary`, `content_angle`, `urgency_indicator`, `icp_fit`. These would provide richer intelligence but require Google Sheets schema changes (new columns), updated n8n output mapping, and re-import of the workflow JSON.
**Decision:** Prompt v2 will use the same 25-field schema as Prompt v1. No new columns are added until v2 passes the 7-record synthetic test, is approved by the operator, runs successfully on real scraped data, and the operator confirms the additional fields are worth the added complexity.
**The new fields are documented as planned** in `MARKETING_AGENT_PROMPT_V2.md` (Planned Future Fields section) and will be implemented in schema v2.1+ after production validation.
**Rationale:** Adding columns before the schema is stable is technical debt. The priority is getting v2 reasoning quality validated, not expanding the output surface area.
**Trigger to add new fields:** v2 is in stable production use (≥ 20 real scraped records analyzed); operator reviews output and confirms new fields are needed.

---

## DEC-021 — No Paid Scraping Until Prompt v2 Is Ready and Business Requirements Are Clarified

**Date:** 2026-06-05
**Context:** Milestone Review 02 identified that Marketing Agent Prompt v1 is an extractor/classifier, not a marketing analyst. It also confirmed that the operator's uncle's specific business requirements (which platforms, which outputs, which actions matter) have not been discussed. Starting paid Apify or Firecrawl scraping before these two things are resolved will produce low-value outputs and waste the limited test budget.
**Decision:** Do not start any paid web scraping (Apify, Firecrawl) until BOTH of the following are done:
1. Marketing Agent Prompt v2 is written, tested against synthetic records, and approved by the operator
2. The operator's uncle has confirmed what business outputs and target platforms he actually needs
**Rationale:** The $5 Claude API test budget and unknown Firecrawl/Apify free tier limits are finite. Burning them on v1 prompt + wrong targets is waste. The infrastructure is now proven. The next investment is in prompt and requirements quality.
**Trigger to unblock:** Operator confirms uncle's requirements in writing (even a brief bullet list) AND v2 prompt passes the 5-record synthetic test described in `MARKETING_AGENT_PROMPT_V2_PLAN.md`.
**Alternatives considered:** Proceed with scraping immediately to generate real data for prompt improvement (rejected — real data costs money; synthetic test records are sufficient for prompt iteration).

---

## DEC-020 — Prompt Duplication in v0.1: Embedded + File Source

**Date:** 2026-06-05
**Context:** The active Marketing Scout Agent system prompt exists in two places simultaneously: embedded as a JavaScript string inside the `Build Claude Request` Code node in `02_claude_api_single_record_analysis.json`, and as the canonical source file `modules/marketing-scout-v0/MARKETING_AGENT_PROMPT_V1.md`. These can diverge silently if one is updated without the other.
**Decision:** For v0.1 this duplication is acceptable — it avoids the complexity of runtime prompt loading (from a file, n8n variable, or external service). `MARKETING_AGENT_PROMPT_V1.md` is the **canonical source**. When the prompt changes, both the file and the Code node must be updated in the same session. The Code node text takes precedence at runtime.
**Future:** v0.2+ will move prompt loading to an n8n variable, a static file served locally, or an n8n credential field, so the workflow JSON contains only a reference, not the full text.
**Alternatives considered:** Storing prompt in n8n environment variable (deferred — requires n8n config change and a code node read pattern not yet tested).

---

## DEC-019 — Marketing Scout Agent: Scoring Scale Changed to 1–100

**Date:** 2026-06-05
**Context:** The original SYSTEM_PROMPT.md used a 0–10 scoring scale for quality_score, lead_signal_score, content_idea_score, and competitor_strength. For Workflow 02, the scoring scale was upgraded to 1–100 to provide finer granularity and enable more precise quality gating. The Quality Gate IF node uses threshold >= 60 (equivalent to ~6/10 in the old scale).
**Decision:** All scores in MARKETING_AGENT_PROMPT_V1.md and Workflow 02 use integers 1–100. The old SYSTEM_PROMPT.md retains the 0–10 scale as a legacy draft; MARKETING_AGENT_PROMPT_V1.md is the active prompt for all workflows from v02 onward.
**Quality gate threshold:** quality_score >= 60 passes to Google Sheets; below 60 discarded.
**Alternatives considered:** Keep 0–10 scale (rejected — too coarse for differentiated filtering at scale).

---

## DEC-018 — Claude API Gateway: Auth Format, Model ID, and Response Parsing

**Date:** 2026-06-05
**Context:** The project uses a Claude-compatible API gateway at `https://aiprimetech.io` rather than the official Anthropic endpoint. A compatibility test was run from the VPS to confirm auth format, model ID naming, and response structure.
**Decision:**
- Base URL: `https://aiprimetech.io`, endpoint `/v1/messages`
- Auth: `Authorization: Bearer <token>` (HTTP Header Auth in n8n)
- Working model ID: `claude-sonnet-4-6` (hyphen-dot notation — `claude-sonnet-4.6` with a literal dot returns "No available accounts")
- n8n credential name: `Claude API - Marketing Scout`
- Response parsing: do NOT use `content[0].text` — the response may include a `thinking` block before the text block. Always select the content item where `type == "text"`:
  ```javascript
  const content = $json.content.find(c => c.type === 'text');
  const parsed = JSON.parse(content.text);
  ```
- System prompt must include an explicit instruction to return raw JSON only — no markdown, no code fences. Without this, Claude may wrap output in triple-backtick blocks that break `JSON.parse`.
- API key must remain only in the n8n credential manager — never committed to any project file.
**Alternatives considered:** Official Anthropic endpoint (available as fallback — same auth format, same model IDs).

---

## DEC-017 — Google Sheets Headers: Single Row 1, Horizontal Only

**Date:** 2026-06-04
**Context:** During Workflow 01 testing, the Google Sheet was initially created with field names
entered vertically in column A (rows 1–25) instead of horizontally in row 1 (columns A–Y).
n8n's `autoMapInputData` mode matches fields by column header name in row 1 — it does not read
vertical headers. The rows 2–25 had to be deleted, leaving only the horizontal header row 1.
**Decision:** The Google Sheet `results` must have exactly one header row: row 1, columns A–Y,
with field names matching the output of the Code/Claude node exactly (case-sensitive).
All data rows start at row 2. No vertical layouts, no merged cells in the header.
**How to fix if broken:** Delete rows 2–25 in Google Sheets if they contain field names in column A;
keep only row 1 with horizontal headers.
**Alternatives considered:** Using `defineBelow` column mapping in n8n (deferred — adds maintenance burden when schema changes).

---

## DEC-016 — Google Sheets Integration: Service Account, Not OAuth2

**Date:** 2026-06-04
**Context:** n8n supports two authentication methods for Google Sheets: OAuth2 (browser-based)
and Service Account (key file). OAuth2 requires a browser redirect during credential setup,
which is cumbersome via SSH tunnel. Service Account credentials are created once using a JSON key
file and do not require interactive browser flow.
**Decision:** Use Google Service Account (`googleApi` credential type in n8n) for Google Sheets
in all v0.1 workflows. The service account email must be added as Editor to the target spreadsheet.
**Credential name convention:** `Google Sheets - Marketing Scout Service Account`
**Alternatives considered:** OAuth2 (deferred — requires browser redirect, adds setup friction in SSH-only environment).

---

## DEC-015 — n8n Workflow Delivery via Generated JSON (Confirmed)

**Date:** 2026-06-04
**Context:** Workflow 00 (Healthcheck Manual Test) was generated as a JSON file by Claude Code,
committed to the project repo, and imported into n8n by the operator. The workflow executed
successfully on first import with no manual node editing required.
**Decision:** All future n8n workflows will be delivered as importable JSON files committed
to `n8n/workflows/`. The operator imports via **Workflows → ⋮ → Import from File** or clipboard.
Manual node-by-node construction in the UI is the fallback only if JSON import fails.
**Confirmed path:** Claude Code → `n8n/workflows/*.json` → GitHub → n8n Import → execution.
**Workflow 00 baseline:** `n8n/workflows/00_healthcheck_manual_test.json` must not be modified —
it serves as the healthcheck reference to verify the platform is functioning.
**Alternatives considered:** Manual UI construction (retained as fallback); n8n API push (deferred — requires additional credentials).

---

## DEC-014 — Execution Pruning Enabled at Launch

**Date:** 2026-06-04
**Context:** VPS disk is tight (~1.4G free, 86% used after n8n launch). n8n stores execution
history in its SQLite database by default, which grows unboundedly.
**Decision:** Execution pruning configured in `n8n.env` at deployment time:
`EXECUTIONS_DATA_PRUNE=true`, `EXECUTIONS_DATA_MAX_AGE=168` (7 days), `EXECUTIONS_DATA_PRUNE_MAX_COUNT=1000`.
This caps history to the last 7 days or 1000 executions, whichever is hit first.
**Alternatives considered:** Disable pruning and rely on manual cleanup (rejected — too easy to forget on a constrained disk).

---

## DEC-013 — VPS Disk Constraint Acknowledged; Upgrade Deferred

**Date:** 2026-06-04
**Context:** After n8n launch, VPS disk is at ~86% used with ~1.4G free.
This is sufficient for MVP (no high-volume scraping yet), but leaves little headroom.
**Decision:** Proceed with current VPS for v0.1 MVP. Plan a disk upgrade or VPS tier change
before running high-volume Apify scrape jobs or accumulating significant execution history.
Do not run large scrapes without checking free disk first.
**Trigger for upgrade:** Disk usage exceeds 90%, or before any run expected to produce >500 items.
**Alternatives considered:** Immediate upgrade (deferred — no pressing need before first workflow test).

---

## DEC-012 — Real Credentials Stay Outside Git

**Date:** 2026-06-04
**Context:** n8n requires an encryption key and may later hold API tokens via env file.
**Decision:** `n8n.env` and any `docker-compose.yml` containing real values are never committed
to Git. Only `.example` template files are versioned. The encryption key is generated once on
the VPS and stored only in the live `n8n.env` file outside the project directory.
**Alternatives considered:** `.env` in repo with `.gitignore` (rejected — risk of accidental commit).

---

## DEC-011 — No Public Domain or HTTPS for v0.1

**Date:** 2026-06-04
**Context:** v0.1 is a manual, operator-only pipeline. Public access is not required.
Setting up a reverse proxy and TLS certificate adds setup time before the pipeline is proven.
**Decision:** n8n has no public domain or HTTPS in v0.1. All access is via SSH tunnel.
Public HTTPS will be added when a specific technical requirement arises: Apify/Telegram webhooks,
Google OAuth redirect URI, or remote monitoring.
**Alternatives considered:** Caddy with auto-TLS from day one (rejected — unnecessary complexity for v0.1).

---

## DEC-010 — n8n Bound to localhost, Accessed via SSH Tunnel

**Date:** 2026-06-04
**Context:** n8n must not be exposed to the public internet in v0.1. The operator is the only user.
**Decision:** n8n is bound to `127.0.0.1:5678` in the Docker Compose port mapping.
Access is via SSH tunnel: `ssh -L 5678:127.0.0.1:5678 root@SERVER_IP`.
This eliminates the need for firewall rules, TLS, or authentication hardening for v0.1.
**Alternatives considered:** Bind to `0.0.0.0:5678` with firewall rule (rejected — accidental exposure risk if firewall misconfigured).

---

## DEC-009 — Docker Compose Installed Manually (Not via apt)

**Date:** 2026-06-04
**Context:** `apt install docker-compose-plugin` failed — package not found on this VPS.
Docker Engine (v29.1.3) was already present with 3 running containers and 39 images.
**Decision:** Docker Compose v5.1.2 was installed manually as a CLI plugin:
`/usr/local/lib/docker/cli-plugins/docker-compose`
Used as `docker compose` (plugin syntax).
**Impact:** On any server migration, rebuild, or fresh OS install, Docker Compose must be
reinstalled manually from the official Docker GitHub releases page. It will not be present
after a standard apt Docker install.
**Safety note:** Do not run `docker system prune` or destructive Docker cleanup without
explicit operator approval — existing containers are actively running.
**Alternatives considered:** `docker-compose` standalone binary (rejected — plugin syntax preferred; standalone is deprecated).

---

## DEC-008 — v0.1 Apify Integration: Simple Start + Wait + Fetch

**Date:** 2026-06-04
**Context:** Apify actor runs are asynchronous. A proper polling loop or webhook callback
requires additional n8n nodes and error handling logic — too complex for the first working version.
**Decision:** v0.1 uses a simple three-step pattern: POST to start the actor run → Wait node
(30–60 sec fixed delay) → GET dataset items. If the dataset is empty, the operator waits
and manually re-triggers the fetch node. No automated retry logic in v0.1.
**Future:** v0.2 will implement a polling loop (check run status → loop until SUCCEEDED)
or an Apify webhook that triggers n8n on completion.
**Alternatives considered:** Polling loop in v0.1 (rejected — adds complexity before basic pipeline is proven).

---

## DEC-007 — Public HTTPS/Domain Deferred Until Required

**Date:** 2026-06-04
**Context:** n8n does not need inbound public access for a manual, operator-run pipeline.
Setting up a reverse proxy (nginx/Caddy) and TLS certificate adds setup time and
introduces attack surface before the pipeline even works.
**Decision:** Public HTTPS and a domain name are deferred until they become technically required —
specifically when Apify/Telegram webhooks need to call n8n, or when Google OAuth requires
a verified redirect URI. Until then, all n8n access is via SSH tunnel.
**Alternatives considered:** Set up nginx + Let's Encrypt from day one (rejected — unnecessary for v0.1).

---

## DEC-006 — n8n Accessed via SSH Tunnel in v0.1 (No Public Domain)

**Date:** 2026-06-04
**Context:** The VPS is a production machine. Exposing n8n on a public port without
authentication hardening and HTTPS creates unnecessary security risk for a tool still under development.
**Decision:** n8n UI is accessed exclusively via SSH port forwarding during v0.1:
`ssh -L 5678:localhost:5678 user@vps-ip` → open `http://localhost:5678` locally.
No public port, no domain, no reverse proxy required for MVP.
**Alternatives considered:** Direct public port exposure (rejected — security risk); VPN (deferred as overkill for one operator).

---

## DEC-005 — English for Technical Files

**Date:** 2026-06-04
**Context:** Project files may be reviewed by tools, collaborators, or future agents.
**Decision:** All technical documentation files are written in English.
Russian permitted in informal operator notes only.
**Alternatives considered:** Russian-first (rejected — limits tool compatibility and future sharing).

---

## DEC-004 — Secrets Stay Out of Project Files

**Date:** 2026-06-04
**Context:** Project files will eventually be version-controlled on GitHub.
**Decision:** No real API keys, tokens, or passwords in any project file.
All example/config files use placeholder strings (`YOUR_API_KEY_HERE`).
Credentials live only in n8n's built-in credential manager.
**Alternatives considered:** `.env` files with `.gitignore` (rejected for v0.1 — adds complexity before Git is set up).

---

## DEC-003 — Stack Locked for v0.1

**Date:** 2026-06-04
**Context:** Risk of scope creep before first working pipeline.
**Decision:** v0.1 stack is fixed: n8n + Apify/Firecrawl + Claude API + Google Sheets + Telegram.
No new tools without explicit operator approval.
**Alternatives considered:** Adding Notion, Airtable, or Slack (deferred to later stages).

---

## DEC-002 — Plan-Before-Code Workflow

**Date:** 2026-06-04
**Context:** Operator is iterative and wants control over all changes.
**Decision:** Engineering agent always shows a plan and gets explicit approval before
creating or editing any file. No silent file creation.
**Alternatives considered:** Auto-create files (rejected — removes operator oversight).

---

## DEC-001 — Lightweight Architecture (No External Agent Frameworks)

**Date:** 2026-06-04
**Context:** Operator is learning. External frameworks (LangChain, CrewAI, AutoGen) add
complexity, hide mechanics, and are harder to debug on a VPS.
**Decision:** Custom lightweight structure using only Markdown files and Claude Code.
Agents are roles defined in docs, not running processes or SDK objects.
**Alternatives considered:** LangChain, CrewAI (rejected — too heavy for learning context and VPS resources).
