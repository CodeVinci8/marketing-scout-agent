# Hot Memory — Recent Sessions

Most recent first. Keep last 3 sessions max. Archive older entries to `core/warm/decisions.md`.

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
