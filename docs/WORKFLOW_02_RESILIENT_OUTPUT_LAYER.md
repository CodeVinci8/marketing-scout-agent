# WORKFLOW_02_RESILIENT_OUTPUT_LAYER.md — Resilient Output Layer Design

**Version:** v1.0
**Date:** 2026-06-06
**Status:** Design — approved for implementation
**Related decision:** DEC-033

---

## 1. Problem Statement

The current Workflow 02 uses a single-step Claude analysis node that returns raw JSON text.
This architecture is unstable on non-obvious records.

**Observed failures in Tests 9–12 and Test 5:**

| Test | Scenario | Failure Mode |
|------|----------|-------------|
| 5 | VK content idea | JSON.parse error — quotes inside `offer_text` |
| 9 | Instagram competitor | No `text` item in response — thinking-only or empty content array |
| 10 | Avito refinancing MO | Claude returned Markdown analysis block instead of JSON |
| 11 | Weak website competitor | Claude returned Markdown analysis block instead of JSON |
| 12 | Out-of-region SPb lead | Invalid JSON — malformed structure |

**Root cause:** Claude reasons correctly in all of these cases. The business logic (classification, scoring, skip decisions) is sound. The failure is at the output serialization layer — Claude does not reliably produce machine-parseable JSON for non-standard inputs (long text, ambiguous signals, Russian-language edge cases).

**Why more prompt experiments will not solve this:**
All five output strategies tried (raw JSON v2.0, JSON+safety rules v2.1, tool_use v2.2, KEY=VALUE v2.3–v2.5) either failed due to gateway constraints (502) or produced parsing failures for edge-case inputs. The failure mode is not in the prompt reasoning — it is structural: a single serialization point has no recovery path.

---

## 2. Output State Classification

All Claude responses must be classified into exactly three states before routing:

| State | Definition | Examples |
|-------|-----------|---------|
| `parsed_success` | Claude response was machine-parseable JSON on the first attempt (primary parse) | Tests 1, 8 — hot PTS leads |
| `technical_error` | Response could not be parsed into the required schema even after repair attempt | No text item, gateway error, missing required fields after repair |
| `business_skip` | Parsed successfully; Claude determined the record is not actionable | `status=skipped`, `entity_type=irrelevant`, `recommended_action=ignore` |

These three states are **mutually exclusive** and **collectively exhaustive** for any record processed by the pipeline.

**Critical distinction:** A `business_skip` is a correct analytical decision by the model. A `technical_error` is a pipeline failure that does not reflect model reasoning. Do not conflate them in logs or reporting.

---

## 3. Proposed Architecture

### 3.1 Node Flow Diagram

```
Manual/Test Source
        ↓
Claude Primary Analysis
  (same prompt as baseline d350069)
        ↓
Parse Primary JSON
  (JSON.parse with fence strip, brace extraction, quote normalization)
        ↓
    parse_ok?
   /         \
true          false
  ↓               ↓
Router    Claude JSON Repair Formatter
            (separate Claude call — strict schema-only prompt)
                  ↓
          Parse Repaired JSON
            (same parse logic as primary)
                  ↓
              repair_ok?
             /           \
           true           false
             ↓                ↓
           Router      technical_errors tab
```

### 3.2 Node Descriptions

**Claude Primary Analysis**
- Identical to baseline d350069.
- System prompt: MARKETING_AGENT_PROMPT_V2.md (micro-sized, max ~2 KB for gateway compatibility).
- Returns raw JSON text.
- No changes to existing working behavior.

**Parse Primary JSON**
- Existing parse logic: markdown fence strip → brace extraction → quote normalization → JSON.parse.
- Adds: check for presence of `text` item in content array (catches Test 9 failure mode).
- Outputs: `parse_ok=true` + parsed object, or `parse_ok=false` + `parse_error` string + `raw_response_preview`.

**Claude JSON Repair Formatter** _(new node)_
- Triggered only on `parse_ok=false`.
- Receives: `raw_response_preview` (first 500 chars of raw Claude response).
- System prompt: strict schema-only instruction (see Section 4).
- Returns: JSON conforming to the 25-field schema, with best-effort field population from the primary response.
- Does NOT re-analyze the original source record. Does NOT add new facts.

**Parse Repaired JSON**
- Same parse logic as primary.
- If successful: routes to Router with `parse_method=json_repaired`, `processing_status=parsed_repaired`.
- If failed: routes to `technical_errors` tab with `processing_status=technical_error`.

**Router** _(implemented in the `Normalize + Route` Code node — replaces current Quality Gate)_
- Reads parsed fields and assigns a `route` value.
- The `route` value names the target Google Sheets tab directly.
- A single dynamic Google Sheets node (`Append to Dynamic Route Sheet`, Sheet Name = `={{ $json.route }}`) appends to that tab (DEC-035 — no Switch node, no per-tab Append nodes).
- See Section 5 for routing logic.

---

## 4. JSON Repair Formatter

### 4.1 Purpose

The Repair Formatter is a second Claude call that receives the raw primary response (which may be Markdown analysis, partial JSON, or a field-value dump) and converts it into strict JSON schema format.

### 4.2 Input to Repair Formatter

```
raw_response: <first 500 characters of Claude primary response>
```

The raw response is passed as user message content — not as a system prompt. The system prompt is the repair instruction only.

### 4.3 Repair Formatter System Prompt (compact — ~400 chars)

```
You are a JSON formatter. Convert the input text into this exact JSON schema.
Do not add facts. Do not reinterpret scores. Extract only what is explicitly stated.
If a field cannot be determined from the input, use: "" for strings, 1 for integers,
"unknown" for enums. If the input has no analyzable content, set status="error".
Return only valid JSON. No markdown. No explanation.

Schema: {entity_type, service_type, company_name, profile_name, region,
offer_text, terms, contact_public, text_context, detected_need,
competitor_strength, lead_signal_score, content_idea_score, quality_score,
reason, recommended_action, status, freshness_status, source_type,
platform, source_url, parsed_at, published_at, created_at, profile_url}
```

### 4.4 Repair Formatter Rules

| Rule | Description |
|------|-------------|
| Do not add new facts | Only extract what is in the primary response |
| Do not re-score | Use scores found in primary response; do not recalculate |
| Do not reinterpret | If primary response says "competitor", keep entity_type=competitor |
| Safe defaults | Missing string → `""`, missing integer → `1`, missing enum → safest valid value |
| Unrecoverable input | If no analyzable content found, set `status="error"` and all scores to `1` |
| Max tokens | 600 (sufficient for 25-field JSON output) |
| Temperature | 0.0 (deterministic — no creative interpretation) |

### 4.5 What the Repair Formatter is NOT

- It is not a re-analysis of the original source record.
- It is not a fact-checker.
- It does not decide business logic (whether to contact, monitor, or skip).
- It does not override the primary model's reasoning — it only restructures its output.

---

> **Routing implementation update (2026-06-06, DEC-035):** The routing destination is now
> implemented as **dynamic Google Sheets routing**, not a Switch by Route node. The
> `Normalize + Route` Code node computes the `route` value, and a single Google Sheets
> "Append to Dynamic Route Sheet" node writes to the tab named by `={{ $json.route }}`.
> The Switch by Route node and the six per-tab Append nodes are removed. The routing
> *logic* in Section 5 is unchanged — only the n8n implementation of the destination changed.
> See `n8n/workflows/02_claude_api_single_record_v2_resilient_router_test_dynamic_sheet.json`.

## 5. Router Logic

The routing logic below is computed in the `Normalize + Route` Code node. The resulting
`route` value drives a single dynamic Google Sheets append (DEC-035) — it no longer feeds
a Switch by Route node.

### 5.1 Routing Rules (evaluated in priority order)

| Priority | Route | Condition | Sheets Tab |
|----------|-------|-----------|-----------|
| 1 | `technical_errors` | `parse_ok=false` AND `repair_ok=false` | `technical_errors` |
| 1 | `technical_errors` | Any required field missing after parse | `technical_errors` |
| 1 | `technical_errors` | `status="error"` (repair formatter could not extract) | `technical_errors` |
| 2 | `skipped_log` | `status=skipped` OR `recommended_action=ignore` | `skipped_log` |
| 3 | `results` | `lead_signal_score >= 70` AND `recommended_action=contact` | `results` |
| 4 | `review_queue` | `lead_signal_score` between 40–69 OR `recommended_action=investigate` | `review_queue` |
| 5 | `monitor_queue` | `competitor_strength >= 45` | `monitor_queue` |
| 6 | `content_queue` | `content_idea_score >= 50` | `content_queue` |
| 7 | `skipped_log` | Does not meet any threshold above | `skipped_log` (low-signal) |

**Notes:**
- A record can match multiple conditions. Priority order resolves conflicts (higher priority wins).
- A strong lead with competitor signals goes to `results` (lead priority is highest).
- A competitor with `competitor_strength < 45` that is not a lead goes to `skipped_log`.
- The old `Quality Gate` node (quality_score >= 60 binary gate) is removed in this architecture.

### 5.2 Routing Decision Table for Known Test Cases

| Test | Scenario | Expected Route | Reason |
|------|----------|---------------|--------|
| 1 | Avito hot PTS Москва | `results` | lead_signal=98, action=contact |
| 8 | Telegram hot PTS Москва | `results` | lead_signal≥80, action=contact |
| 9 | Instagram competitor МО | `monitor_queue` | competitor_strength≥45 (once repaired) |
| 10 | Avito refinancing МО | `review_queue` | lead_signal 50–70, action=investigate |
| 11 | Weak website competitor | `monitor_queue` or `skipped_log` | competitor_strength<45 → skipped_log |
| 12 | Out-of-region SPb lead | `review_queue` | lead_signal≤40 (region cap), action=investigate |
| 5 | VK content idea | `content_queue` | content_idea_score≥50 (once repaired) |

---

## 6. Google Sheets Tabs

| Tab Name | Purpose | Columns Added vs. Current |
|----------|---------|--------------------------|
| `results` | Hot leads (lead_signal≥70, action=contact). Operator reviews and contacts. | + technical fields (6) |
| `review_queue` | Moderate leads (40–69) or investigate signals. Operator reviews when time permits. | + technical fields (6) |
| `monitor_queue` | Active competitors (competitor_strength≥45). Track over time. | + technical fields (6) |
| `content_queue` | Content idea signals (content_idea_score≥50). Feed to content planning. | + technical fields (6) |
| `skipped_log` | Valid business skips and low-signal records. Archive only, no action needed. | + technical fields (6) |
| `technical_errors` | Parse failures, no-text responses, gateway errors. Requires engineering review. | + technical fields (6) + raw_response_preview |

All tabs share the 25 existing schema columns plus the 6 new technical fields.

---

## 7. New Technical Fields

These 6 fields are added to **every record** before routing. They are written to all Sheets tabs.

| Field | Type | Values | Purpose |
|-------|------|--------|---------|
| `processing_status` | string | `parsed_primary` \| `parsed_repaired` \| `technical_error` | Which parse path succeeded |
| `parse_method` | string | `json_primary` \| `json_repaired` \| `failed` | Which parse attempt succeeded |
| `parse_error` | string | Error message or `""` | What went wrong during parse |
| `raw_response_preview` | string | First 300 chars of raw Claude response | Debugging — especially for technical_errors tab |
| `route` | string | `results` \| `review_queue` \| `monitor_queue` \| `content_queue` \| `skipped_log` \| `technical_errors` | Final routing decision |
| `needs_manual_review` | boolean | `true` \| `false` | True for `technical_errors` and `repair_ok=true` records (repaired output may have degraded accuracy) |

**Total schema width:** 25 existing fields + 6 technical fields = **31 columns**.

**`needs_manual_review` logic:**
- `true`: any record that went through the Repair Formatter (even if repair succeeded), or any `technical_error`.
- `false`: all records that parsed successfully on the first attempt (`parse_method=json_primary`).

---

## 8. Testing Plan

### Test A — Hot Lead, Primary Parse Success

**Input:** Test 1 (Avito hot PTS Москва) or Test 8 (Telegram hot PTS Москва)
**Expected path:** Primary Analysis → Parse Primary JSON (parse_ok=true) → Router → `results`
**Verify:**
- `processing_status=parsed_primary`
- `parse_method=json_primary`
- `parse_error=""`
- `route=results`
- `needs_manual_review=false`
- Row appears in `results` tab

### Test B — Weak Lead, Review Queue

**Input:** Record with lead_signal_score 40–69 or action=investigate (Test 10: Avito refinancing)
**Expected path:** Primary Analysis → Parse → (parse_ok=true or repair) → Router → `review_queue`
**Verify:**
- `route=review_queue`
- `lead_signal_score` between 40–69 or `recommended_action=investigate`
- Row appears in `review_queue` tab

### Test C — Competitor, Monitor Queue

**Input:** Test 9 (Instagram competitor МО)
**Expected path:** Primary Analysis → Parse → Router (if parse_ok) or Repair → Router → `monitor_queue`
**Verify:**
- `route=monitor_queue`
- `competitor_strength >= 45`
- Row appears in `monitor_queue` tab

### Test D — Forced Markdown Raw Response → Repair → Parsed JSON

**Input:** Manually inject a raw Markdown analysis block (simulating Test 10 or 11 failure mode)
**Expected path:** Primary Analysis → Parse (parse_ok=false) → Repair Formatter → Parse Repaired → Router
**Verify:**
- `processing_status=parsed_repaired`
- `parse_method=json_repaired`
- `needs_manual_review=true`
- `parse_error` contains original error description
- `raw_response_preview` contains first 300 chars of Markdown input
- Row appears in the appropriate business tab (not `technical_errors`)

### Test E — Unrepairable Response → Technical Errors

**Input:** Inject a completely malformed or empty response (simulating Test 9 failure mode: no text item)
**Expected path:** Primary Analysis → Parse (parse_ok=false) → Repair Formatter → Parse Repaired (repair_ok=false) → `technical_errors`
**Verify:**
- `processing_status=technical_error`
- `parse_method=failed`
- `needs_manual_review=true`
- `route=technical_errors`
- Row appears in `technical_errors` tab
- No row appears in other tabs

---

## 9. Design Decisions

### DEC-033: Stop Prompt Format Experiments — Fix Architecture with Repair + Routing

**Decision:** The output contract instability observed in Tests 9–12 and Test 5 is not a prompt problem — it is an architectural problem. Adding more prompt formatting rules or trying a new output format (v2.6, v2.7, etc.) will not eliminate the failure mode; it will only shift it to different edge cases.

**The fix:** A two-pass architecture:
1. Primary parse: attempt JSON.parse on Claude's natural output.
2. Repair pass: if primary fails, send the raw response to a dedicated JSON Repair Formatter (separate Claude call with a strict schema-only prompt). This reformats without re-analyzing.
3. Router: replace the binary Quality Gate with a multi-branch router that routes to 6 Sheets tabs based on business signal type and strength.

**tool_use status:** Deferred. The gateway (aiprimetech.io) returns 502 for tool_use parameters. Will be re-evaluated if a stable direct Anthropic API endpoint becomes available.

**KEY=VALUE line protocol status:** Deferred. v2.3–v2.5 all failed with 502 at the gateway level. The baseline raw JSON approach continues.

**Applies to:** Workflow 02 v2. All future workflow output layers should use this two-pass pattern until a reliable structured output mechanism is available via the gateway.

---

## 10. Implementation Notes

### What Changes in n8n

| Change | Type |
|--------|------|
| Add `Claude JSON Repair Formatter` node | New HTTP Request node (Claude API call) |
| Add `Parse Repaired JSON` Code node | New Code node (same logic as primary parse) |
| Add `Router` IF/Switch node | Replaces current `Quality Gate` IF node |
| Add 5 new `Append Row` Google Sheets nodes | One per tab (review_queue, monitor_queue, content_queue, skipped_log, technical_errors) |
| Update existing `Append Row` node | Rename to `Append → results`, add 6 new technical fields |
| Add `processing_status`, `parse_method`, `parse_error`, `raw_response_preview`, `route`, `needs_manual_review` to parse output | Code node changes |

**Existing nodes that do NOT change:**
- Manual Trigger
- Set Test Selector
- Select Test Record
- Build Claude Request (primary analysis)
- Claude API Request (primary)

### What Changes in Google Sheets

- Create 5 new tabs: `review_queue`, `monitor_queue`, `content_queue`, `skipped_log`, `technical_errors`
- Add 6 new columns to header row of all tabs: `processing_status`, `parse_method`, `parse_error`, `raw_response_preview`, `route`, `needs_manual_review`
- Existing `results` tab: add same 6 columns

### Repair Formatter — n8n Build

The Repair Formatter is a standard HTTP Request node to the same gateway endpoint:
- `POST https://aiprimetech.io/v1/messages`
- Model: `claude-haiku-4-5-20251001` (cheaper — repair is a formatting task, not analysis)
- max_tokens: 600
- temperature: 0.0
- System prompt: repair instruction (~400 chars, well within gateway limits)
- User message: `raw_response_preview` field from Parse Primary node

**Cost note:** Repair calls are only triggered on parse failures (estimated 20–40% of edge-case records). Using Haiku instead of Sonnet for repair reduces cost per repair call by ~80%.

---

## 11. Rollout Plan

| Phase | Description |
|-------|-------------|
| Phase 1 | Create 6 Sheets tabs + add technical field columns |
| Phase 2 | Build Repair Formatter node in TEST HARNESS workflow |
| Phase 3 | Build Router node (replace Quality Gate) in TEST HARNESS |
| Phase 4 | Run Tests A–E (see Section 8). Confirm all 5 pass |
| Phase 5 | Operator approves. Migrate Resilient Output Layer to production Workflow 02 |
| Phase 6 | Re-run original failing tests (9, 10, 11, 12) on production workflow. Confirm routing |

Do not implement in production Workflow 02 until TEST HARNESS Tests A–E all pass.

---

## 12. What This Does NOT Change

- The primary Claude analysis prompt (MARKETING_AGENT_PROMPT_V2.md) is not modified.
- The baseline raw JSON output format is not changed.
- No new facts are introduced by the Repair Formatter.
- Business logic (ICP, region scoring, product priority) lives entirely in the primary analysis prompt.
- The 25 existing schema fields are unchanged.
- Real credentials, API keys, and Spreadsheet IDs are never stored in project files.
