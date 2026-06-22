# Stage 3C — Google Sheets Operations Acceptance (QA harness)

**Status:** built, inactive, never auto-run. **Cost:** $0 to build/test (every check is offline).
**Scope:** this is an **acceptance harness for the existing persistence layer**, *not* a product feature.

It proves — against a **separate staging spreadsheet** — that the project can correctly:
read, append, filtered read-back, insert-style upsert, update-style upsert, dedup-idempotently,
isolate by owner and by request, neutralize formula injection, preserve negative numbers, and touch
**nothing** outside its own generated QA run.

| Artifact | Path |
|----------|------|
| Pure engine (planning + verification, embeddable) | `n8n/lib/sheets_operations_qa.js` |
| Deterministic generator | `tools/gen_sheets_operations_qa_workflow.js` |
| Generated workflow (inactive, manual-only) | `ops/n8n/workflows/qa_stage3_sheets_operations_acceptance.json` |
| Offline test suite (98 checks) | `tests/test_sheets_operations_qa.js` |

The workflow lives under `ops/` so it is **excluded** from the production runtime manifest
(`config/workflow_manifest.json`), the Python workflow validator, and the Sheets-contract validator
(all of which scan only `n8n/workflows/`).

---

## What it reuses (no parallel implementations)

The engine mirrors — and the test suite asserts behavioural equality with — the canonical project libs:

| Concern | Canonical source | Reused as |
|---------|------------------|-----------|
| Formula-injection neutralization (`'`-prefix `= + - @ \t \r`; finite numbers exempt) | `n8n/lib/report_export.js` → `neutralize` / `isFiniteNumber` | identical functions |
| Un-neutralized formula detector | `n8n/lib/sheet_audit.js` → `isUnsafeCell` | identical function |
| Outbox delivery id + dedup key (`dlv_<req>_<rep>_<djb2(payload)>`) | `n8n/lib/telegram_io.js` → `makeDelivery` / `payloadHash` | identical id format |
| Sheet contract (ordered headers, identity columns, scope, dropdown enums) | `config/sheets_contracts.json` + `config/sheets_ui_contracts.json` via `n8n/lib/sheets_contract_resolver.js` | frozen snapshot, baked into the workflow |
| Contract-hash marker (`marketing_scout_bootstrap` developerMetadata) | written by `tools/gen_sheets_bootstrap_workflow.js` | read at preflight |

Header arrays are **never** duplicated by hand. Generation **fails closed** if any field, identity key,
owner/request column, or marker field used by the QA plan is not a declared header in the relevant sheet
contract (or if any dropdown-bound value is not a member of the resolved enum).

---

## Operation matrix

| # | Sheet | Operation proven | Matching / identity key | Marker field |
|---|-------|------------------|--------------------------|--------------|
| A | `agent_requests` | append + filtered read-back (request A carries the formula + negative tests; request B is the isolation control) | `agent_request_id` | `notes` |
| B | `agent_request_events` | append an event linked to request A | `agent_request_id` + `idempotency_key` | `reason` |
| C | `conversation_state` | insert-style upsert (base row) | `conversation_id` | `pending_clarification` |
| D | `conversation_state` | update-style upsert (same key, changed `current_state`; **no second row**) | `conversation_id` | `pending_clarification` |
| E | `tracked_sources` | lifecycle upsert (`status` active→paused) for an RFC-2606 example domain; **no collector runs** | `source_id` | `label` |
| F | `telegram_outbox` | idempotency record (DB row only; **no Telegram send**) | `delivery_id` | `last_error` |

Every QA row is tagged in a declared free-text field as
`[MSQA data_mode=manual_test qa_run_id=… owner=… role=…]`. The tag starts with `[`, which is not a
formula-lead character, so it is never altered by neutralization.

**Insert-vs-update semantics.** A fresh live run reaches the *final* (updated) state in one write. The
insert→update transition is proven by a two-phase in-memory upsert over the live before-snapshot
(`UPSERT_INSERT`, `UPSERT_UPDATE`), and true idempotency is proven by re-planning against the
projected-after state, which yields **zero** new inserts (`IDEMPOTENCY`).

---

## Running it against the staging spreadsheet

> **Prerequisite:** run the Stage 3 bootstrap workflow (`docs/STAGE3_SHEETS_BOOTSTRAP.md`) against the
> same staging spreadsheet first, so all 40 contract tabs and the contract-hash marker exist.

### 1. Import
In n8n: *Workflows → Import from File* → select
`ops/n8n/workflows/qa_stage3_sheets_operations_acceptance.json`. It imports **inactive**. Keep it inactive.

### 2. Select the credential (no new credential)
On each of the 4 HTTP Request nodes (*Get Spreadsheet Metadata*, *Get Header Rows*, *Get Before Snapshot*,
*Apply Writes*, *Get After Snapshot*), select the existing
**“Google Sheets - Marketing Scout Service Account”** credential. On that Google Service Account
credential, enable *“Set up for use in HTTP Request node”* and restrict allowed domains to
`https://sheets.googleapis.com`. The workflow contains **no credential id** — selection is manual.

### 3. Replace the placeholder
In *Set QA Config*, set `spreadsheet_id` to your **staging** spreadsheet ID (the file ships with
`PASTE_STAGING_SPREADSHEET_ID`; the Init node throws if you forget). Never point it at a production sheet.

### 4. Dry-run first (default, no mutation)
Leave `execute_writes = false` **and** `confirm_staging_spreadsheet = false`. Execute the workflow.
It reads metadata + the before-snapshot, plans every operation, verifies against an in-memory projection,
and **sends nothing**. The *Verify & Report* item shows `CHANGES_APPLIED = false` and a full marker set.

### 5. Confirm staging, then the first live write
Set **both** `execute_writes = true` **and** `confirm_staging_spreadsheet = true`, then run again.
Writes require *both* flags **and** a clean preflight (40 tabs present, matching contract hash, required
test columns present). The single `values:batchUpdate` (USER_ENTERED) appends/updates only this run’s
clearly-tagged rows; the header row (row 1) is never written, and only the 5 test sheets are targeted.

### 6. Locate the QA rows
In each test sheet, filter the marker column (e.g. `agent_requests.notes`) for your `QA_RUN_ID`
(copy it from the Report item). Every row you find is tagged `data_mode=manual_test` and is traceable to
that run id, owner, and role.

### 7. Repeat-run (idempotency)
Copy `QA_RUN_ID` from the Report into `reuse_qa_run_id`, keep both write flags true, and run again.
The Report must show every `DUPLICATE_*_CREATED = 0`, `UPSERT_ROW_COUNT_STABLE = PASS`, and
`IDEMPOTENCY = PASS`. The repeat run rewrites its own rows in place (and suppresses the outbox delivery by
`delivery_id`); it never creates a duplicate.

### 8. Verify formula-injection + isolation
- **Formula injection:** open request A’s row. The cells `query / plan_summary / result_summary / next_action`
  show the literal text `=1+1`, `+SUM(1,1)`, `@IMPORTXML(...)`, `-CMD|' /C calc'!A0` — **not** evaluated
  results. `estimated_source_cost_usd = -5` and `estimated_analysis_cost_usd = -4.5` remain real negative
  numbers (not text). Markers: `FORMULA_INJECTION_NEUTRALIZATION = PASS`, `NEGATIVE_NUMBER_PRESERVATION = PASS`.
- **Isolation:** the harness filters `conversation_state` to owner A and `agent_requests` to request A and
  asserts nothing foreign is returned. Google Sheets has no server-side row ACL, so this is enforced by a
  **strict post-read assertion** (the limitation is explicit). Markers: `OWNER_ISOLATION = PASS`,
  `REQUEST_ISOLATION = PASS`, `FOREIGN_ROWS_RETURNED = 0`.

---

## Reading the markers (Section 9 summary)

The Report node returns one machine-readable item. `RESULT` is **derived** from the sub-markers — it is
never hard-coded.

| Marker | Meaning |
|--------|---------|
| `PREFLIGHT` | `PASS` only if all 40 tabs present, contract hash matches the bootstrap marker, and every required test column exists. |
| `CONTRACT_TABS_PRESENT` | how many declared tabs were found in the staging spreadsheet. |
| `SHEETS_READ` | metadata + before-snapshot reads succeeded. |
| `APPEND_AGENT_REQUEST` / `READ_BACK_AGENT_REQUEST` | request A was appended and read back field-for-field (formula cells as literal text, negatives numeric). |
| `APPEND_REQUEST_EVENT` | an event row linked to request A was appended with a valid state transition. |
| `UPSERT_INSERT` / `UPSERT_UPDATE` / `UPSERT_ROW_COUNT_STABLE` | conversation_state inserted once, updated in place (key stable, `current_state` changed), still exactly one row. |
| `TRACKED_SOURCE_UPSERT` | tracked_sources inserted once then lifecycle-updated (`status` active→paused), one row. |
| `OUTBOX_IDEMPOTENCY` | exactly one outbox row for the deterministic `delivery_id`; re-enqueue adds nothing. |
| `OWNER_ISOLATION` / `REQUEST_ISOLATION` / `FOREIGN_ROWS_RETURNED` | owner A’s view excludes owner B; request A’s view excludes request B; zero foreign rows leaked. |
| `FORMULA_INJECTION_NEUTRALIZATION` / `NEGATIVE_NUMBER_PRESERVATION` | formula strings stored as text; finite negatives stay numeric. (`SKIPPED` if `formula_tests_enabled = false`.) |
| `BEFORE_AFTER_SCOPE` | only this run’s expected rows were added/updated. |
| `EXPECTED_ROWS_WRITTEN` / `UNEXPECTED_ROWS_WRITTEN` | rows this run added vs. any it should not have (`0`). |
| `FOREIGN_ROWS_MODIFIED` / `HEADERS_MODIFIED` / `UNDECLARED_TABS_MODIFIED` | other owners/requests untouched (`0`); header row unchanged (`0`); no tab outside the 5 test sheets written (`0`). |
| `DUPLICATE_AGENT_REQUESTS_CREATED` / `_CONVERSATION_STATES_` / `_TRACKED_SOURCES_` / `_OUTBOX_DELIVERIES_` | duplicates a repeat run would create (`0`). |
| `IDEMPOTENCY` | re-planning against the projected-after state yields zero new inserts. |
| `EXTERNAL_NON_GOOGLE_CALLS` | always `0` — no Telegram/Apify/Firecrawl/VK/Claude call is made. |
| `CHANGES_APPLIED` | `true` only after a confirmed live write; `false` on a dry-run. |
| `QA_RUN_ID` / `DATA_MODE` | the generated run id; always `manual_test`. |
| `RESULT` | `PASS` (all green), `FAIL` (a marker tripped), or `BLOCKED_PREFLIGHT` (a preflight gate failed → no write happened). |

---

## Why rows are retained (no cleanup here)

This harness **does not delete or clear** anything. Created QA rows are intentionally **retained** so they
can serve as fixtures for the separate **retention / archival** acceptance work — that step verifies how
the persistence layer ages and prunes rows by retention class, and it needs real manual_test rows to act
on. Cleanup is therefore out of scope here and handled by retention testing. Because every QA row is tagged
`data_mode=manual_test` with its `qa_run_id`, it is trivially filterable and removable later.

---

## Safety confirmations

- **No external collectors / messaging:** tracked_sources uses an RFC-2606 example domain and **no**
  collector runs; telegram_outbox writes a DB row only and **no** Telegram message is sent. The summary’s
  `EXTERNAL_NON_GOOGLE_CALLS` is always `0`. The only external host is `https://sheets.googleapis.com`.
- **No destructive operations:** every write is a single `values:batchUpdate` (USER_ENTERED) to explicit
  data-row ranges (row ≥ 2). There is no `spreadsheets:batchUpdate` structural request, no `deleteSheet` /
  `deleteRange` / `deleteDimension`, and no `values:clear`.
- **Inactive, manual-only, no secrets:** the workflow is `active: false`, has exactly one Manual Trigger,
  no webhook, no credential id, and no real spreadsheet id (placeholder only). It is excluded from the
  production manifest and validators.
- **Drift-proof:** the contract snapshot + engine are embedded by the generator. Edit the contract or the
  engine and **regenerate** (`node tools/gen_sheets_operations_qa_workflow.js`); never hand-edit the JSON.
  `tests/run_all.js` fails on any drift.
