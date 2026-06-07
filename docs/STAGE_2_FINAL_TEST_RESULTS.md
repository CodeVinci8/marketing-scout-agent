# STAGE_2_FINAL_TEST_RESULTS.md — Stage 2 Web Competitor Pipeline, Final Test Results

**Date:** 2026-06-07
**Scope:** the manual, human-approval-gated web competitor pipeline — Workflow 05 → url_candidates → human
approval → Workflow 06 → manual handoff → Workflow 04 → monitor_queue / skipped_log / technical_errors.
**Companion:** `docs/STAGE_2_WEB_PIPELINE_REVIEW.md` (architecture + approval matrix),
`docs/WORKFLOW_06_AUTO_HANDOFF_PLAN.md` (auto-handoff evaluation).

> Honesty note: results below are **real operator runs** except where marked
> "implemented + simulation-validated, not fully live-validated" — those features exist in code and were
> verified by deterministic simulation/unit checks, but a clean live field test with the exact fresh inputs
> was blocked (mostly by url_registry already containing the candidate URLs). Recorded transparently.

---

## Summary verdict

| Capability | Verdict |
|------------|---------|
| Workflow 05 — Apify search candidate discovery | ✅ PASS (live) |
| Workflow 06 — runtime url_registry recheck | ✅ PASS (live) |
| Workflow 06 — `first_pass_domain_diversity` (default) | 🟡 Implemented + simulation-validated; **not** fully live-validated with fresh same-domain unprocessed candidates |
| Workflow 06 — `deep_domain_analysis` (explicit) | 🟡 Implemented + simulation-validated; live run respected registry recheck but selected 0 (all candidates already in registry/processed) |
| Workflow 04 — stronger PTS `service_type` override | ✅ PASS (live) |
| Workflow 04 — contact sanitation (blank partials) | ✅ PASS (live, blanking); valid-contact preservation = ⚠️ watch item |
| Manual handoff 06 → 04 | ✅ PASS (live) |
| Auto handoff 06 → 04 | ⛔ NOT approved / **deferred** to Stage 2.4 (see auto-handoff plan) |

**Overall:** Stage 2 is **approved with minor limitations** (manual handoff + manual approval + manual
"mark processed"). Two runner-mode behaviors carry a documented "live re-test recommended" watch item.

---

## Test 1 — Workflow 05 discovery — ✅ PASS

- **Input (query):** `автоломбард Москва займ под ПТС без проверки кредитной истории`
- **Expected:** url_candidates rows with classification + domain extraction; registry-based duplicate
  detection; **0 Firecrawl / 0 Claude** spend; one discovery_requests row; no business-tab writes.
- **Actual:** 9 candidate rows. Direct competitors included
  `https://www.autolombard-moskva.ru/`, `https://zalog24h.ru/`, `https://autolombardn1.ru/`,
  `https://www.autolombard-moskva.ru/services/vyezdnoe-obsluzhivanie/ulicy/dmitrovskoe-shosse/`.
  Classification produced `direct_competitor`, `aggregator`, `directory`, `media_article`. Domain extraction
  worked. Duplicate detection via `url_registry` worked. No Firecrawl/Claude spend.
- **Pass/fail:** ✅ PASS.
- **Notes:** url_candidates = 26 fields, discovery_requests = 18 fields (unchanged).

## Test 2 — Workflow 06 runner (pre-hardening) — ✅ PASS

- **Input:** 4 approved `direct_competitor` candidates.
- **Expected:** a clean ≤5-URL Workflow 04 `Set URL List` block.
- **Actual:** selected 4 and generated the block for the 4 URLs above.
- **Pass/fail:** ✅ PASS (baseline behavior before domain-diversity/runner-mode hardening).

## Test 3 — Workflow 04 processing — ✅ PASS

- **Input:** the 4 URLs from Test 2.
- **Expected:** each routed to `monitor_queue`, `entity_type=competitor`.
- **Actual:** all 4 → `monitor_queue`: `autolombard-moskva.ru` → competitor/`pts_loan`;
  `zalog24h.ru` → competitor/`pts_loan`; `autolombardn1.ru` → competitor; services page → competitor.
- **Pass/fail:** ✅ PASS.

## Test 4 — Workflow 06 registry recheck (post-hardening) — ✅ PASS

- **Input:** operator re-set already-processed URLs back to `approval_status=approved`, then ran WF06.
- **Expected:** WF06 ignores the editable dedup fields and re-reads `url_registry`, skipping URLs already
  present; nothing selected.
- **Actual:** `selected_count=0`, `skipped_count=18`. Skip reasons observed:
  `registry_recheck_duplicate` (URLs already in `url_registry`), `already_processed`,
  `duplicate_status`, `approval_status_not_approved`.
- **Pass/fail:** ✅ PASS.
- **Notes:** Confirms WF06 does **not** blindly trust editable `url_candidates`
  `dedup_status`/`registry_status`; it re-reads `url_registry` at runtime and prevents duplicate spend.

## Test 5 — Workflow 06 `deep_domain_analysis` mode — 🟡 IMPLEMENTED, NOT FULLY LIVE-VALIDATED

- **Input:** operator set `runner_mode=deep_domain_analysis`, but all approved candidates were already in
  `url_registry` or processed.
- **Expected (ideal field test):** multiple unprocessed same-domain URLs selected (cap 3/domain/run).
- **Actual:** `selected_count=0` — deep mode still respected the registry recheck and did **not** bypass
  dedup. The multi-URL same-domain selection path was **not** exercised with fresh inputs.
- **Pass/fail:** 🟡 Implemented + simulation-validated (deterministic check: deep mode selects up to 3
  same-domain URLs, extras → `domain_deep_limit`); **not** fully live-validated. Safety (registry recheck not
  bypassed) was confirmed live.
- **Notes / re-test:** see watch item W1 below.

## Test 5b — Workflow 06 `first_pass_domain_diversity` (default) — 🟡 IMPLEMENTED, NOT FULLY LIVE-VALIDATED

- **Status:** the default mode's "max 1 URL per domain per run → second+ → `duplicate_domain_in_run`"
  behavior was verified by simulation against the 4 E2E URLs (the two `autolombard-moskva.ru` URLs collapse to
  one selected + one `duplicate_domain_in_run`). A clean live run with fresh same-domain unprocessed
  candidates was blocked by registry duplicates. Marked implemented + simulation-validated.
- **Re-test:** see watch item W1.

## Test 6 — Workflow 04 PTS override — ✅ PASS

- **Input:** operator deleted `autolombardn1.ru` from `url_registry`, then ran Workflow 04 on it.
- **Expected:** competitor, `service_type=pts_loan`, `monitor_queue`.
- **Actual:** `source_url=https://autolombardn1.ru/`, `entity_type=competitor`, `service_type=pts_loan`,
  `route=monitor_queue`, `processing_status=parsed_success`, `parse_method=repaired_json`, `repair_used=true`.
- **Pass/fail:** ✅ PASS — the stronger PTS override works (even via the repaired-JSON path).
- **Contact result:** `contact_public` was **empty** in this run — acceptable, because no full reliable
  contact was extracted from the scraped text. Partial contacts must remain blank.

## Contact sanitation — ✅ PASS (blanking) / ⚠️ WATCH (preservation)

- **Blanking partials:** confirmed — partial/placeholder contacts (`+7 (495) ...`, `номер указан на сайте`,
  `требуется извлечение`, `телефон есть на сайте`) are blanked. ✅
- **Preserving valid full contacts:** seen in earlier runs (autolombardn1 / cashmotor-style contacts:
  `+7 495 740-01-01`, `8 800 777-95-67`, `t.me/…`, `wa.me/…`, `@handle`, email) and unit-tested. The latest
  Test 6 run yielded an empty contact (none reliably present in text). **Watch item W2:** confirm valid-contact
  preservation again on a page that clearly exposes a full public contact.

---

## Watch items (recommended live re-tests, not blockers for Stage 2 approval)

- **W1 — runner modes with fresh inputs:** run Workflow 05 with a *new* query to obtain fresh, unprocessed
  same-domain candidates (≥2 URLs on one domain). Approve them. Then:
  - `first_pass_domain_diversity` → expect 1 selected for that domain, the rest → `duplicate_domain_in_run`.
  - `deep_domain_analysis` → expect up to 3 selected for that domain, the 4th+ → `domain_deep_limit`, with the
    deep-mode `warning` on selected items.
- **W2 — valid contact preservation:** process a competitor page with a clearly published phone/Telegram/
  WhatsApp and confirm `contact_public` is populated with the full reliable contact (not blanked).

---

## Field-count guardrails (unchanged)

- Workflow 04: **35** business fields per emitter; `url_registry` append = **10** fields.
- Workflow 05: `url_candidates` = **26** fields; `discovery_requests` = **18** fields.
- All workflows `active=false`; no real keys / Spreadsheet ID committed; no schedule trigger.
