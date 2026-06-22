# STAGE3_SHEETS_BOOTSTRAP.md — Google Sheets Staging Bootstrap (Operations Guide)

A robust, idempotent system that brings a **staging** Google Sheets spreadsheet to the exact Marketing Scout
storage contract: the 40 contract tabs, in the contract order, with exact ordered headers, restrained formatting,
frozen header rows, basic filters, canonical dropdowns and boolean checkboxes — while **preserving** any extra
sheets (including the QA `__qa_connection` tab). It is safe to run repeatedly: a second correct run makes **zero**
changes.

This is a durable part of the project. New contract sheets, columns and enums are expected over time; Section 2
explains exactly how to add them without touching the engine.

---

## 1. Architecture and sources of truth

```
config/sheets_contracts.json      sheet_order (40) + ordered headers + identity/scope/retention/required   ← SINGLE SOURCE OF TRUTH for names + headers + order
config/sheets_ui_contracts.json   per-sheet dropdown/checkbox rules + canonical_enums (with provenance)     ← SINGLE SOURCE OF TRUTH for validations
config/taxonomy.json              canonical semantic enums (record_type/service/quality_status/…)            ← dropdown source for `taxonomy:<key>` refs
        │
        ▼
n8n/lib/sheets_contract_resolver.js   loads + validates the three files → one resolved snapshot + contract_hash
        │
        ▼
n8n/lib/sheets_bootstrap_planner.js   PURE planner: (resolved snapshot + current spreadsheet state) → batchUpdate requests + summary
        │
        ▼
tools/gen_sheets_bootstrap_workflow.js → ops/n8n/workflows/qa_stage3_sheets_bootstrap.json   (inactive QA workflow, embeds the snapshot + planner)
        │
        ▼
n8n (manual run)  →  spreadsheets.get + values.batchGet + spreadsheets.batchUpdate  →  the staging spreadsheet
```

Key properties:

- **Headers live only in `config/sheets_contracts.json`.** The UI file never redefines headers; it only points
  columns at validations. The planner has no header literals.
- The planner is **pure and embeddable**: it makes no API call, reads no file, and is inlined verbatim into the
  generated workflow so the workflow needs no repository access at runtime.
- A deterministic **`contract_hash`** (over headers + order + dropdown values/strictness + checkbox set +
  formatting/validation versions) drives idempotency.

---

## 2. How to add a new sheet, column, or enum in the future

This is normal, expected maintenance — the project is **not** frozen.

**Add a new contract sheet**
1. Add the tab object to `tabs` in `config/sheets_contracts.json` (`retention_class`, `writers`/`readers`,
   `required_columns`).
2. Append its name to `sheet_order` (its position = its visible order).
3. Add its ordered `headers` array and (optionally) `identity_columns`.
4. Add a `sheets.<name>` entry in `config/sheets_ui_contracts.json` (even if `{ "dropdowns": {}, "checkboxes": [] }`)
   and a `_provenance` line citing where the headers came from.
5. Update the `EXPECTED_TAB_COUNT` in `n8n/lib/sheets_contract_resolver.js` if the contract count changes from 40.
6. Regenerate: `node tools/gen_sheets_bootstrap_workflow.js`. Run the tests.

**Add a column to an existing sheet** — append it to that sheet's `headers` array (append to the *right*; never
reorder existing columns — n8n's Google Sheets `append` maps by header *name*). On the next apply against a
spreadsheet that already has the older columns, the bootstrap **appends** the new trailing headers without
overwriting existing cells.

**Add a dropdown / checkbox** — point the column at an enum in `config/sheets_ui_contracts.json`:
`"col": "taxonomy:service"` or `"col": "canonical:<name>"`, or add the column name to `checkboxes`. To introduce a
new enum, add it under `canonical_enums` with `values`, `strict`, and a `source` (the doc/lib/DEC it came from).

After any change, `contract_hash` changes automatically, so the **next** apply re-applies formatting/validations
once (a controlled, safe re-apply), then returns to zero-mutation idempotency.

---

## 3. How the contract resolver works

`node n8n/lib/sheets_contract_resolver.js` loads the three config files and returns a single resolved structure:
per sheet — `sheet_name`, `sheet_order`, `headers`, `identity_columns`, `scope_columns`, `retention_class`,
`required_columns`, and `ui_columns` (`dropdowns` with resolved enum values+strict+source, and `checkboxes`).

It **fails closed** (exits 1 / `resolve().ok === false`) if: the contract sheet count is not exactly 40; a sheet
has no headers; a header is empty; a sheet name is duplicated; a header is duplicated within a sheet; a
`required_columns` entry is missing from the headers; a UI rule references a missing sheet/column; or a dropdown
enum_ref cannot be resolved. On success it prints `DECLARED_TABS=40 / RESOLVED_HEADER_SETS=40 /
UNRESOLVED_HEADER_SETS=0` and a `CONTRACT_HASH`.

---

## 4. How dropdown values are sourced

Every dropdown resolves an `enum_ref`:

- `taxonomy:<key>` reads `config/taxonomy.json` (e.g. `taxonomy:service`, `taxonomy:quality_status`,
  `taxonomy:valid_routes`). This is the same taxonomy the analysis workflows enforce.
- `canonical:<name>` reads `canonical_enums` in `config/sheets_ui_contracts.json`. Each canonical enum records a
  `source` (the doc/lib/DEC the values came from) so no value is ever invented.

**Closed enums** (stable, normalized by the workflows — e.g. `data_mode`, `quality_status`, `send_status`,
`score_band`, `plan_source`) use **strict** validation (rejects off-list values). **Legacy/alias-bearing enums**
(e.g. `service`, `record_type`, `entity_type`, status sets that grew over time) use **non-strict** suggestions
(shows the list + a warning but accepts historical values), so the bootstrap never rejects pre-existing data.
**Booleans** use Google Sheets **checkboxes** (not a `true`/`false` text dropdown). **IDs, hashes, URLs,
timestamps, summaries, notes, evidence and free text receive no validation.**

If an enum were ever too large for a direct `ONE_OF_LIST`, the planner would create a hidden `__validation_lists`
helper sheet (positioned after the contract + extra sheets, generated from canonical enums, idempotent). Today no
enum needs it, so `HELPER_VALIDATION_SHEET_CREATED` is always `false`.

---

## 5–10. Operator runbook

### 5. Import the QA workflow
Import `ops/n8n/workflows/qa_stage3_sheets_bootstrap.json` into n8n. It is a single workflow with a Manual Trigger,
a config node, three planning Code nodes, and four HTTP Request nodes that call the Google Sheets API.

### 6. Keep it inactive
The workflow ships `active: false`. **Leave it inactive** — it is a manual QA tool, never a scheduled/production
flow. It is stored under `ops/` and is excluded from the production runtime manifest and validators.

### 7. Replace the spreadsheet ID placeholder
Open **Set Bootstrap Config** and set `spreadsheet_id` to your **staging** spreadsheet ID (the one that already
contains `__qa_connection`). The guard node refuses to run while it is still `PASTE_STAGING_SPREADSHEET_ID`.
**Never point this at a production spreadsheet** (Section 19).

### 8. Select the existing Service Account credential
On each of the four HTTP Request nodes, select the existing credential
**"Google Sheets - Marketing Scout Service Account"**. Do **not** create a new Google Cloud project or credential.

### 9. HTTP Request credential permission
Because formatting / ordering / filters / data-validation require the Sheets API `spreadsheets.batchUpdate` (which
the native Google Sheets node does not expose), this workflow uses HTTP Request nodes. On the existing Google
Service Account credential, enable **"Set up for use in HTTP Request node"** so it can authenticate HTTP Request
nodes. No new credential is needed.

### 10. Google API domain restriction
Restrict the credential's allowed domains to **`https://sheets.googleapis.com`**. The workflow only ever calls
that host (`spreadsheets.get`, `values.batchGet`, `spreadsheets.batchUpdate`). The Google **Drive** API is **not**
used — sheet creation/ordering/formatting/validation are all available through the Sheets API alone.

### 11. Run dry-run (default)
Leave `apply_changes = false` and run. The workflow only **reads** (metadata + header rows) and the **Report**
node returns the machine-readable plan. No write or batch-update request is sent in dry-run.

### 12. Review the mismatch output
In the Report item, inspect `CREATED_TABS`, `MATCHING_HEADERS`, `ORDER_MISMATCHES`, `EXTRA_PRESERVED_TABS`, and —
critically — `HEADER_MISMATCHES`. If a contract sheet has a **non-empty header row that conflicts** with the
contract, `blocked = true`, `RESULT = BLOCKED_HEADER_MISMATCH`, and `dangerous_mismatches` lists
`{ sheet, expected_headers, actual_headers }`. **Resolve the conflict manually first** (rename the offending sheet
or fix its header) — the bootstrap never overwrites a populated, mismatched header.

### 13. Run apply
Set `apply_changes = true` (keep `apply_formatting`/`apply_validations = true`) and run again. The planner emits a
**single** `spreadsheets.batchUpdate`: create missing sheets (with explicit ids), set order, initialise/append
headers, freeze row 1, format headers, set semantic column widths, add basic filters, add canonical dropdowns +
checkboxes (from row 2 down), and write a `developerMetadata` idempotency marker.

### 14. Inspect order, headers, formatting, dropdowns and checkboxes
Confirm in the spreadsheet: the 40 contract tabs occupy the first 40 positions in contract order; `__qa_connection`
and any other extra tab are preserved **after** them; row 1 is frozen, bold, shaded and wrapped; long-text columns
are clipped/top-aligned; status/enum columns show dropdowns; boolean columns show checkboxes; row 1 has none.

### 15. Run the second apply
Run once more with `apply_changes = true`.

### 16. Verify idempotency
The Report should show `mutations_planned = 0` and the second-run keys all zero
(`SECOND_RUN_CREATED/HEADERS_WRITTEN/REORDERED/FORMATTING_CHANGED/VALIDATIONS_CHANGED/HEADER_MISMATCHES = 0`,
`IDEMPOTENCY = PASS`). Formatting/validation are gated by the `developerMetadata` marker, and structure by the live
metadata/header reads, so a correct spreadsheet is left untouched.

### 17. Return to dry-run mode
Set `apply_changes = false` again so the workflow is read-only at rest.

---

## 18. Recovery and troubleshooting

- **`BLOCKED_HEADER_MISMATCH`** — a populated header conflicts with the contract. Inspect `dangerous_mismatches`,
  fix/rename the sheet by hand, re-run dry-run. The bootstrap will not touch it until the conflict is gone.
- **HTTP 401/403** — the credential is not selected on a node, lacks "Set up for use in HTTP Request node", or the
  Service Account does not have access to the staging spreadsheet. Share the spreadsheet with the Service Account
  email (Viewer is enough for dry-run; Editor for apply).
- **HTTP 400 on batchUpdate** — usually a stale generated workflow. Regenerate with
  `node tools/gen_sheets_bootstrap_workflow.js` and re-import.
- **A row count looks wrong** — the bootstrap never writes business rows, never clears cells, never converts blanks
  to `0`. Number formats only *format* numeric columns; blank cells stay blank.
- **Re-apply formats everything once after a contract change** — expected: `contract_hash` changed, so the marker
  is stale and the formatting/validation buckets re-apply once, then return to zero.

## 19. Why production spreadsheets must be tested separately and deliberately

This bootstrap is exercised **only** against a dedicated staging spreadsheet. Production data is irreplaceable: a
mistaken reorder, a header overwrite, or a validation applied to the wrong column on a live sheet could disrupt the
running workflows. The dry-run/apply/idempotency cycle, the dangerous-mismatch abort, and the "never overwrite a
populated header / never clear cells / never delete a sheet" guarantees are all validated on staging first. Only
after a clean staging run (apply → second apply = 0 mutations) should the same, separately reviewed, explicitly
authorised procedure ever be considered for a production spreadsheet — as its own deliberate operation, never as a
side effect of staging work.

---

## Files

| File | Role |
|------|------|
| `config/sheets_contracts.json` | sheet_order + ordered headers + identity/scope/retention/required (source of truth) |
| `config/sheets_ui_contracts.json` | dropdown/checkbox rules + canonical_enums with provenance |
| `config/taxonomy.json` | canonical semantic enums (`taxonomy:*` dropdown source) |
| `n8n/lib/sheets_contract_resolver.js` | loads + validates the contracts → resolved snapshot + `contract_hash` |
| `n8n/lib/sheets_bootstrap_planner.js` | pure planner → `spreadsheets.batchUpdate` requests + summary |
| `tools/gen_sheets_bootstrap_workflow.js` | deterministic generator (`--check` = drift guard) |
| `ops/n8n/workflows/qa_stage3_sheets_bootstrap.json` | generated inactive QA workflow |
| `tests/test_sheets_bootstrap.js` | offline regression (resolver + planner + generated workflow) |
