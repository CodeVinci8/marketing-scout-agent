# STAGE_C_1_TEST_RESULTS.md — Stage C.1 Consolidated Patch (local validation + operator retest runbook)

**Status:** 🔧 PATCH APPLIED — local deterministic validation **PASS ($0, no network)**. Operator runtime
retest in n8n is **REQUIRED** before Stage C.1 can be marked passed. **Do NOT mark Stage C.1/Stage C passed
until the operator completes the retest below.**
**Date:** 2026-06-19 · **Decisions:** DEC-141 (Stage C.1). **Workflows touched:** WF12, WF13, WF14 (all
`active=false`). **Cost:** $0. **No live VK/Apify/Firecrawl/Telegram/Claude calls.**

---

## 1. What this patch fixed (root causes, from real operator runtime evidence)

| Defect | Root cause | Fix (where) |
|--------|-----------|-------------|
| **A** report printed `@synthetic_lead_1` / `+7 000 000-00-01` while claiming contacts hidden | WF12 printed `evidence_excerpt`/`evidence_text` verbatim; no redaction | WF12 deterministic `redact()` before truncation + final pass over every printed field |
| **B** PTS lead → `service_type=unknown` | WF14 used `str(c.service_need)||svc`; WF13 hint `"unknown"` shadowed the correct `svcType()→pts_loan` | WF14 deterministic-first (`svc` wins unless `unknown`); WF13 also emits `pts_loan` |
| **C** business-credit lead got false "after refusals" hint | WF13 hardcoded `probable_need` for any question | WF13 evidence-based `probableNeed()`; refusal hint only with refusal evidence |
| **D** WF13 told operator to run WF08 as the mandatory next step | stale next_action/plan strings | canonical path → **WF14**; WF08 = optional Stage 3 analysis |
| **E** zero-write run suggested lowering thresholds when the real reason was successful dedup | hardcoded next_action | WF14 `diagnoseZeroWrite()` (8 reasons) + `below_threshold_skipped` |
| **F** `active_author_count=7` counted a broker + an editor as "audience" | counted all unique authors | WF13 counts **audience authors only** (`question_objection`) → `audience_author_count` (=5) |
| **G** old `review_queue` rows could contaminate a clean WF13→WF14 acceptance test | no run scope | WF14 `include_review_queue` + `source_agent_request_id` (defaults unchanged) |
| **H** doc/sticky contradictions (WF08, 20-col report, 28-col leads, monitored-vs-smoke) | stale strings | resolved across active docs/stickies |

Plus new scope: **monitored VK groups** (group → recent posts → relevant posts → public comments) — engine +
deterministic simulation implemented; **live two-stage transport staged/disabled** (BLOCKED until operator arms it).

## 2. Local deterministic validation (reproducible, $0)

```
node n8n/fixtures/lead_scout/run_all.js
```

Runs the **actual workflow Code-node logic** (extracted from the JSON, run under n8n shims) against the fixtures.

| Suite | Checks | Result |
|-------|-------:|--------|
| WF14 triage — vector A (standalone F1–F10) + vector B (WF13→WF14) + repeat dedup | 42 | **PASS** |
| WF13 fixture path (Defects C/D/F) + monitored Mode-2 simulation (20 §6.4 cases) | 51 | **PASS** |
| WF12 report redaction (Defect A) | 39 | **PASS** |
| **Total** | **132** | **PASS** |

Key proofs: vector A → 7 written, H/M/L **3/2/2**, contacts 2, blank 1; vector B → 5 written, H/M/L **2/2/1**,
**PTS service_type=`pts_loan`**; repeat → 0 written, dup 5, diagnosis=`all_eligible_already_exist`; WF13 fixture →
9/hard1/unique7/dup1/raw8/registry7, **audience_author_count=5**; monitored sim → 8 emitted (2 posts+6 comments),
supplier/admin/spam skipped, deleted/error/rate-limit/comments-disabled counted; WF12 → contacts absent from every
field, amounts/percent/post-URL preserved, contact counts correct. `outreach_allowed=false` everywhere.

## 3. Operator retest runbook (run after importing the patched workflows)

Operator has a **backup workbook** and tests on the **original** workbook. **Do NOT clear the whole workbook.**

1. **Re-import** patched **WF12, WF13, WF14**. **WF15 unchanged** — re-import NOT required.
2. **Rebind the Google Sheets credential** + replace `PASTE_SPREADSHEET_ID` on every Sheets node
   (WF13: 1 read + 4 append · WF14: 3 read + 2 append · WF12: 6 read + 3 append). Keep all workflows **inactive**.
3. **Clear ONLY these test-output tabs** (Stage-3.5 Lead Scout scope): `raw_market_records`,
   `market_record_registry`, `public_lead_signals`, `market_intelligence_reports`. **Do NOT clear**
   `review_queue` Stage-2/3 aggregate tabs (`competitor_profiles`, `market_angles`, `audience_activity_signals`,
   `content_positioning_plan`, `competitor_site_snapshots`) or `agent_requests`/`live_source_runs` history.
   - If old `review_queue` rows exist, EITHER clear the WF13/WF14 test rows from it, OR (preferred) in WF14
     `Set Triage Config` set **`include_review_queue:false`** (and/or `source_agent_request_id` = the WF13 run's
     id) to isolate this source run cleanly (Defect G).
4. **Run WF13** (fixture, Execute once). **Expect deltas:** `raw_market_records` **+8**, `market_record_registry`
   **+7**, `agent_requests` **+1**, `live_source_runs` **+1**. Summary: `items_received=9`, `hard_skipped=1`,
   `unique=7`, `duplicate=1`, **`audience_author_count=5`**, `next_action` → **run WF14** (NOT WF08).
5. **Inspect `raw_market_records`**: the PTS comment row has `service_hint=pts_loan`; the business-credit row's
   `probable_need` is business-financing (NOT "после отказов").
6. **Run WF14** (Execute once). **Expect:** `public_lead_signals` **+5** (H/M/L **2/2/1**), `agent_requests` **+1**.
   The PTS lead row has **`service_type=pts_loan`** (NOT `unknown`). Every row `outreach_allowed=FALSE`.
   `self_test_passed=true`.
7. **Run WF14 again** (repeat). **Expect:** `public_lead_signals` **+0**, `duplicates_skipped=5`,
   `agent_requests` **+1**, `status=completed_no_data`, and `next_action`/`zero_write_reason` stating
   **all eligible signals already exist (dedup succeeded) — collect NEW source data; no threshold change** (it must
   NOT suggest lowering `min_lead_score`).
8. **Run WF12** (Execute once). **Expect:** `market_intelligence_reports` **+1**, `agent_requests` **+1**,
   `live_source_runs` **+1**; lead block shows `public_lead_signals: 5`, H/M/L `2/2/1`, contact-evidence count;
   `llm_status=disabled`, `delivered_to=none`.
9. **Verify report redaction** in the `market_intelligence_reports.notes` cell: the following strings must be
   **ABSENT** anywhere in the report: `@synthetic_lead_1`, `+7 000 000-00-01`, `https://vk.com/id_...` profile URLs,
   `t.me/...`, email addresses. `[PUBLIC CONTACT REDACTED]` appears where a contact was removed; business amounts/%
   and `vk.com/wall-...` post URLs remain.

**PASS/FAIL:** all deltas + counters + the `pts_loan`, dedup-diagnosis and redaction checks above must hold, with
`outreach_allowed=FALSE` on every lead and every workflow still `active=false`. Any contact string visible in the
report = **FAIL**.

## 4. Evidence the operator should return

WF13 Final Summary JSON · WF14 first-run + repeat Final Summary JSON (with `zero_write_reason`) · the PTS
`public_lead_signals` row's `service_type` · the `market_intelligence_reports.notes` cell text (to confirm no
contact strings) · the four Sheet delta counts. (See also `n8n/fixtures/lead_scout/README.md` for the standalone
fixture proof.)

## 5. Still blocked (operator-only, not part of this patch)
C1 Stage 2 paid website snapshot · C4 live VK public source run · monitored VK live two-stage transport —
all `BLOCKED_BY_OPERATOR_CREDENTIALS_OR_LIVE_RUN`. See `docs/VK_MONITORED_SOURCE_RUNBOOK.md`. Stage 4 (Claude) not started.
