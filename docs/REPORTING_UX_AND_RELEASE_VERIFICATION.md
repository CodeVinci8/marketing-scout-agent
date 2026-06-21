# Reporting UX & Release Verification Phase

Branch: `feat/reporting-ux-and-release-verification` · baseline `main` @ `b7a95c1`.
All work is local, fixture/replay-based and offline: **$0, 0 external calls, every workflow `active=false`.**
Not pushed, not merged, not imported into production, no credentials accessed, no live API/Telegram/Sheets writes.

## What shipped

### Reporting outputs (operate on a STORED report bundle; never recollect)
- **Scoped exports** — `report_export.js` (CSV, formula-injection-neutralized, BOM) + `report_package.js` +
  `xlsx_writer.js` (real OOXML XLSX via Node `zlib`, 8 sheets, zero deps). Every export re-asserts the
  `(owner_user_id, agent_request_id, report_id)` scope; no other request's rows can leak in.
- **Deterministic charts** — `report_charts.js` (SVG, honest `insufficient_data`).
- **Evidence mode** — `evidence.js` (facts vs. unavailable, recommendation anchoring: подтверждено vs гипотеза).
- **Compare mode** — `report_compare.js` (owner/niche/region-guarded baseline selection; added/removed/changed).
- **NL filter/sort** — `report_filter.js` (RU free text, strict schema, one clarification on ambiguity).
- **Smart refresh** — `refresh_policy.js` (reuse vs refresh; `keep_previous_report` on failure; 0 calls to plan).

### Conversation UX
- **Scope/cost preview** — `scope_preview.js`, wired into WF19's approval message. Shows goal, niche/region,
  competitors, available vs setup_required sources, reuse/refresh/skip, max items/calls, expected LLM calls,
  budget ceilings, expected outputs, duration. **Cost is never fabricated**: known ceiling / contract estimate /
  honest `unknown`.
- **Progress UX** — `progress_tracker.js`, wired into WF20 (parallel branch off the gate). One message,
  create-then-edit, throttled, no backwards transition, cancellation/failure naming, edit-failure fallback to one
  replacement, retry never duplicates. Final report stays a **separate idempotent** outbox delivery.
- **Weekly digest** — `weekly_digest.js` (WF25). One per owner per ISO week from stored data only; deterministic
  id + idempotency key; empty-week suppression; schedule disabled by default; enable/disable needs confirmation.

### Sources
- **VK public community collector** — `vk_collector.js` (WF26). Canonical identity (URL/screen/numeric/owner id,
  dedup by community identity), configurable+validated `VK_API_VERSION`, official `groups.getById`/`wall.get`/
  `wall.getComments` (comments off by default), error mapping over HTTP-200 bodies, canonical records with edit-
  aware versions, bounded pagination + cross-page dedup, monitoring (baseline/new/edited, deterministic dedup),
  backoff + cursor retention, missing-credential → `setup_required`. Token only in the n8n credential store.
  Integrated into WF23 monitoring. **Status: structurally implemented, offline-tested, live-unverified.**
- **Telegram channel** — `telegram_channel.js`. Bot-update mode (future posts only, edit versions, dedup,
  tracked-source match, quality/monitoring eligibility); external history → `setup_required` with the exact
  missing prerequisite. Never claims it can read arbitrary history.
- **URL/prompt-injection safety** — `url_safety.js`. SSRF blocking (loopback/private/link-local/metadata/file/
  creds/ports), URL normalization, untrusted-content wrapping + injection detection/neutralization (EN+RU).

### Storage & release verification
- **`config/sheets_contracts.json`** — machine-readable contract for 40 tabs (scope columns, retention class +
  days, protections, writers/readers).
- **`tools/validate_sheet_contracts.js`** — static validator: every Sheets node targets a declared tab; no
  writer/reader drift (363 checks).
- **`sheet_audit.js`** — runtime content auditor (required columns, scope, owner isolation, injection) +
  before/after request verifier (wrote my rows, touched no other request/owner).
- **`retention_policy.js`** — retention with a GLOBAL safety floor (active requests + retained-report rows never
  deletable); dry-run by default, deletion only on explicit `enable_delete`.
- **`config/workflow_manifest.json`** — regenerated (31 workflows; 9 archive-safe candidates, all RETAINED) +
  `docs/AUDIT_FINDINGS_RESOLUTION.md`.

## New/changed workflows (all `active=false`)
- **WF24** `24_report_export_delivery.json` — export/filter/compare/refresh/evidence + sendDocument/sendPhoto +
  attachment_outbox dedup + scope preview + progress. Manual + callable.
- **WF25** `25_weekly_digest.json` — weekly digest. Schedule (inactive) + manual + callable.
- **WF26** `26_vk_public_community_collector.json` — VK resolve + wall + detect; credential-gated HTTP. Manual + callable.
- **WF19/WF20/WF23** — scope preview (19), progress (20), VK monitoring edge (23). WF18/21 re-synced for the
  charter/router capability additions (drift-proof embeds).

## New Sheets tabs (headers in `config/sheets_contracts.json`)
`report_bundles`, `attachment_outbox`, `weekly_digests`, `vk_posts`, `vk_post_state`.

## Tests (offline, $0)
New focused suites: `scope-preview` (27), `progress-tracker` (38), `weekly-digest` (31),
`reporting-workflows` (74), `vk-collector` (84), `sheets-contracts` (32), `url-safety` (62), `reporting-e2e` (37).
Full `make test` / `node tests/run_all.js`: ALL SUITES PASS, external calls=0, live cost=$0.

## Known limitations / live-unverified
- VK collector + Telegram bot-update path are offline-tested only — require a credentialed staging test before
  being marked production-live.
- XLSX export uses Node `zlib` inside the Code node — the n8n instance must allow it
  (`NODE_FUNCTION_ALLOW_BUILTIN=zlib`, or `*`). Documented for deployment.
- All `PASTE_WORKFLOW_ID` / `PASTE_SPREADSHEET_ID` bindings are post-import operator steps (n8n CLI absent here,
  so import remains unproven). Telegram document/photo upload nodes are configured but never executed offline.
