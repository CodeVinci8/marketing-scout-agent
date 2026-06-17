# STAGE_2_WEB_COMPETITOR_PIPELINE_REVIEW.md — Stage 2 Website Pipeline Reintegration

**Status:** REINTEGRATION PLAN ACTIVE (2026-06-12) · **Decision:** DEC-129
**Supersedes nothing:** `STAGE_2_WEB_PIPELINE_REVIEW.md` (2026-06-07 approval review) stays the historical
record; this doc defines how the approved web pipeline becomes a **first-class source in the current
market-intelligence flow** instead of a parked side branch.

---

## 1. Verified current state (unchanged, still approved)

- **WF03/WF04** analyze competitor websites via Firecrawl (resilient router, 35-col business tabs) —
  approved with minor limitations 2026-06-07.
- **WF05** discovers candidate URLs (Apify search → `url_candidates` / `discovery_requests`).
- **WF06** prepares approved candidates for WF04 (registry-recheck, runner modes, E2E passed).
- **Known limitation (DEC-075):** WF06→WF04 handoff is manual; auto-handoff deferred.

## 2. Why reintegration

WF10/WF12 aggregate Avito + Telegram + VK + manual rows, but the deepest first-party evidence —
**competitor websites** (offers, prices, guarantees, CTAs, page changes) — was not represented in the
intelligence/report layer. Stage 2 output stayed in the 35-col business tabs and never reached
`competitor_profiles` or the stakeholder report.

## 3. Reintegration design (DEC-129)

### 3.1 New tab: `competitor_site_snapshots` (22 columns — schema in `TABLE_SCHEMA.md`)

One row per analyzed competitor page per run: identity (`domain`, `company_name`, `page_type`, `title`),
business content (`offer_summary`, `prices_terms`, `guarantees`, `service_types`, `detected_pains`,
`cta_text`), public contact (verbatim only, `contact_public`/`contact_channel`, Sheets-safe per DEC-124),
and **change tracking**: `content_hash`, `change_type` (`baseline`/`unchanged`/`changed`/`new_offer`/
`price_change`), `previous_snapshot_id`.

### 3.2 Population path (incremental, WF04 untouched today)

1. **Phase A (now):** the tab + WF12 report block exist; the operator may backfill snapshots manually
   from existing WF04 business-tab rows (one-time, ≤10 rows).
2. **Phase B (next WF04 session, own approval):** WF04 gets an additional append step mapping its
   existing per-URL analysis output to `competitor_site_snapshots` (pure addition after the current
   route-append; current tabs and behavior unchanged — this is the no-break constraint).
3. **Phase C:** scheduled re-scan of known domains with `content_hash` diff → `change_type`, feeding the
   report's "изменения на сайтах" line. Requires its own cost approval (Firecrawl per-URL pricing).

### 3.3 WF06→WF04 auto-handoff (still deferred — deliberately)

Auto-handoff remains **deferred** (DEC-075 stands). Rationale re-checked 2026-06-12: each WF04 run spends
Firecrawl credits; the approval gate between candidate discovery and paid scraping is a cost/safety
feature, not a gap. The guarded plan (unchanged, in `WORKFLOW_06_AUTO_HANDOFF_PLAN.md`) activates only
after live volume justifies it: WF06 writes an `agent_requests` row with `approval_required=true`; an
operator `/approve` (Stage 5 bot or manual) flips it; WF04 picks up approved batches only. No silent
URL-list execution, ever.

### 3.4 Report representation (built this session, WF12 v0.3)

- WF12 reads `competitor_site_snapshots` (tolerant of a missing/empty tab) and renders
  **"Сайты конкурентов (competitor_websites)"**: latest snapshot per domain — offer, prices, guarantees,
  CTA, change marker; plus the count of changed domains in the executive digest.
- WF10 profiles whose platforms/ad_channels look web-derived are listed under the same block.
- "Source collection actions" tells the operator when snapshots are missing or stale.

## 4. Invariants

- WF04/WF06 behavior is unchanged this session (verified: files untouched).
- Website snapshots follow the same contact policy as every source (verbatim public contacts only).
- Each Firecrawl run remains individually approved and logged (`live_source_runs` via WF15 until WF04
  integrates its own logging in Phase B).

---

## 5. Stage 2 cleanup checklist (2026-06-17 — pre-Stage-4 hardening)

This session inspected WF04/05/06/07. Findings + the exact, bounded cleanup steps so Stage 2 does not look raw
next to Stage 3/4. No risky rewrites were made; small safe changes were applied where obvious, the rest is a
scoped checklist with blockers and acceptance criteria.

### 5.1 What is already correct (no change needed)

- **WF06 already reads candidates from sheets** — `Read url_candidates` + a runtime **re-read of
  `url_registry`**, re-normalizing each `candidate_url` and ignoring advisory `dedup_status`/`registry_status`.
  It does **not** require hardcoded websites. `Set Runner Config` only selects a *mode*
  (`first_pass_domain_diversity` default / `deep_domain_analysis`), not URLs. The "too manual" concern was
  stale.
- **WF06 selection is correct & capped** — direct-competitor priority, per-domain cap (1 shallow / 3 deep),
  hard `max_per_run=5`, registry recheck. Output includes a copy-paste `Set URL List` block for WF04.
- **WF07** already writes an `agent_requests` row (observability present).
- **WF06 "Mark Candidates Processed" is wired safely** — fed only by the `IF Selected?` **true** branch, so it
  can never mark skipped candidates; `operation=update` on `candidate_id` setting `approval_status=processed`
  is idempotent (a re-run re-classifies already-processed rows as `already_processed` and skips them).

### 5.2 Small safe change applied this session

- **WF06 `Build Execution Summary & Handoff` operator_note** rewritten with explicit acceptance criteria:
  marking processed is a **separate confirmation step**; only set `processed` for candidates whose
  `normalized_source_url` has actually landed in `url_registry` (+ its route row in results/monitor/review);
  never mark skipped/failed; the step is idempotent. (WF12 wording fix is in WF12, not here.)

### 5.3 WF06 "Mark Candidates Processed" — blocker + acceptance criteria (kept DISABLED on purpose)

- **Blocker (architectural, not a bug):** WF06→WF04 is a **manual handoff**, so WF06 has **no success signal**
  from WF04 at its own run time. Auto-marking inside WF06 would mark candidates `processed` before WF04 has
  scraped/written them — unsafe. Therefore the node stays disabled by default.
- **Safe path to enable (acceptance criteria):** after WF04 runs, re-run WF06; a candidate may be marked
  `processed` **only if** its `normalized_source_url` now exists in `url_registry` **and** its route row landed
  in `results/monitor/review`. The clean future implementation is a **separate confirmation pass**: read
  `url_registry`, mark `processed` only the candidates now present there (idempotent, never touches skipped).
  Until that pass is built, the operator enables the node / edits `url_candidates` manually per the operator_note.

### 5.4 Observability alignment (WF04/05/06)

- WF04/05/06 do **not** add their own `live_source_runs`/`agent_requests` rows. The current standard for
  non-WF11/12/13 runs is the **WF15 manual logger** (DEC-126) — operator logs each Firecrawl/Apify run via WF15
  with mode/cost/counters. **Decision:** keep WF15 logging for Stage 2 (do not bolt fragile append nodes onto
  three working workflows before the external audit). Adding native `live_source_runs` append to WF04 is folded
  into **Phase B** (§3.2), where WF04 is reopened with approval and tested end-to-end.
- Acceptance for "observability done": every Firecrawl (WF04) and Apify (WF05) run has a matching
  `live_source_runs` row (via WF15 now, native in Phase B) with mode, cost note, item counts, `technical_errors`.

### 5.5 Deep vs no-deep (shallow) analysis policy

- **Two distinct axes — do not conflate:**
  1. **WF06 candidate breadth** — `first_pass_domain_diversity` (default, 1 URL/domain) vs `deep_domain_analysis`
     (≤3 URLs/domain). Controls *how many pages per competitor* enter WF04.
  2. **WF04 page depth** — currently **shallow by design**: single-page Firecrawl
     (`onlyMainContent:true`, markdown). No site crawl. "Deep" page crawling is **not** built.
- **Default MVP mode: shallow** — first-pass domain diversity + single-page WF04. Reason: cost. Each WF04 URL is
  a Firecrawl call + a Claude call; breadth and depth both multiply spend.
- **When to go deep:** only for a small set of priority direct competitors where the homepage alone misses
  offers/prices (use WF06 `deep_domain_analysis`, ≤3 key pages: landing + services/prices). Keep `max_per_run=5`.
- **Caps / cost:** ≤5 URLs/run, ≤3 pages/domain (deep). Firecrawl per-URL + Claude per-URL — budget per
  `COSTS_AND_LIMITS.md`. Claude depth (primary→repair) stays bounded (1 repair max).

### 5.6 `competitor_site_snapshots` population (top 3–5 competitors) — controlled runbook

- **Schema mapping:** matches `TABLE_SCHEMA.md` §E (22 cols). WF04's per-URL analysis already produces
  offer/prices/guarantees/CTA/contact fields; Phase B maps them into the snapshot row (pure addition).
- **Operator runbook (do NOT run websites now):**
  1. Pick 3–5 top competitor domains (from `competitor_profiles` / `url_candidates`, direct_competitor only).
  2. In WF06, select them (approved candidates) → copy the `Set URL List` block.
  3. Paste into WF04 `Set URL List` (≤5), run WF04 (Firecrawl + Claude — **paid**, own approval).
  4. Confirm route rows + `url_registry`; log the run via WF15 (`mode=live`, cost, counts).
  5. Backfill/append the resulting analysis into `competitor_site_snapshots` (Phase A manual, or Phase B native
     append once built) — one latest row per domain, `change_type=baseline` on first capture.
  6. Re-run WF12 → the "Сайты конкурентов" block populates; the empty-tab notice disappears.
- **Until populated:** WF12 now states the empty tab means *"Stage 2 web snapshots not yet populated, not a
  system fault"* and points to the controlled run above (wording fixed this session).

---

## 6. Stage 2 EXCELLENCE CONSOLIDATION — IMPLEMENTED (2026-06-17, DEC-137)

This supersedes the "stays disabled / manual backfill / scoped checklist" framing in §5. The Stage 2 work was
**implemented in code**, not just documented. All workflows remain `active=false`, fixture/placeholder-safe,
no external calls made by this patch.

### 6.1 WF06 — processed marking SOLVED (IMPLEMENTED)
- The old `Mark Candidates Processed (DISABLED)` node is **gone**. It is now **enabled** and renamed
  `Mark Candidates Processed (confirmed in url_registry)`.
- **Safe, confirmation-based, idempotent:** `Select, Prioritize & Annotate` re-reads `url_registry` and emits
  `_confirm_processed=true` only for candidates that were `approval_status=approved` **and whose
  `normalized_source_url` is now present in `url_registry`** (i.e. WF04 actually wrote them). The renamed IF node
  `IF Confirmed Processed?` routes only those to the update node, which sets `approval_status=processed` and
  appends a `notes` audit line (`run_id` + timestamp).
- **Never marks skipped/failed** (they never enter `url_registry`). **Never re-marks** already-processed rows
  (they classify as `already_processed`, not `registry_recheck_duplicate`, so `_confirm_processed=false`).
- **Confirmation criterion (exact):** processed ⇔ approved candidate's normalized URL appears in `url_registry`.
  Freshly handed-off candidates stay `approved` until the next WF06 run confirms them. Flow:
  approve → WF06 (handoff) → run WF04 → re-run WF06 (auto-confirm + mark).

### 6.2 WF04 — competitor_site_snapshots writer + run ledger (IMPLEMENTED)
- **`competitor_site_snapshots` is now written by the workflow** (no longer "manual backfill / Phase B not
  built"). New per-URL branch `Normalize + Route → Build competitor_site_snapshots Row → Append
  competitor_site_snapshots` maps the 22-col schema (TABLE_SCHEMA §E): `offer_summary←offer_text`,
  `prices_terms←terms`, `service_types←service_type`, `detected_pains←detected_need`, `company_name`,
  `domain`/`page_type` derived from URL, `contact_public` (Sheets-safe, DEC-124) + `contact_channel`,
  `content_hash` of page text, `change_type=baseline`, `source_confidence=80`.
  - **Gated:** technical-error and placeholder/skip rows write **no** snapshot.
  - `guarantees`/`cta_text` are heuristic from page text; `title` empty — richer extraction needs a WF04
    Claude-prompt extension = **Phase B prompt work (DEFERRED_BY_EXPLICIT_SCOPE)**.
  - **Change detection (diff vs previous snapshot per domain)** = `change_type` beyond `baseline` =
    **Phase C (DEFERRED_BY_EXPLICIT_SCOPE)**; needs a previous-snapshot read + own cost approval.
- **Run ledger:** `Loop Over Items` **done** output (output 0) now feeds `Build live_source_runs Row` +
  `Build agent_requests Row` (each aggregates the looped items via `$input.all()` per DEC-134, **not**
  `$('node').all()`), then their appends. One `live_source_runs` (23-col) + one `agent_requests` (21-col) row
  per run; `external_calls`/`items_written_raw` = non-duplicate `url_registry` rows; duplicates skip Firecrawl.
- **technical_errors:** unchanged existing behavior — failed scrape/parse routes to the `technical_errors`
  sheet via `route` (verified).

### 6.3 WF05/WF07/WF09 — automatic live_source_runs ledger (IMPLEMENTED)
- Each now appends one `live_source_runs` row per run automatically (no reliance on manual WF15):
  - **WF05** (Apify discovery): from `Append discovery_requests → Build → Append`; `mode=live`,
    `platform=apify_search`, `external_calls=1`, writes `url_candidates` (not raw).
  - **WF07** (manual intake): parallel from `Append agent_requests`; `mode=deterministic`, `external_calls=0`.
  - **WF09** (Avito): parallel from `Build agent_requests Row`; `mode=fixture|live`, counts mirror the
    agent_requests result_summary.
- WF15 manual logger remains available as a fallback/secondary path, but Stage 2/3 source workflows no longer
  depend on "manual logging optional."

### 6.4 Stage 2 closure status (honest)
- **WF04–WF07 are CODE-COMPLETE and READY for controlled website snapshot collection.** The pipeline
  WF05 → approve in `url_candidates` → WF06 → WF04 → `competitor_site_snapshots` is fully wired, with dedup,
  domain diversity, idempotent processed-marking, ledger, and technical_errors handling.
- **Remaining for full "verified-populated" closure = BLOCKED_BY_OPERATOR_ACTION (no code blocker):**
  - **Reason:** populating `competitor_site_snapshots` requires a real Firecrawl/Apify run, which this patch must
    not perform (no external calls).
  - **Operator action:** create the `competitor_site_snapshots` tab (22 cols) + confirm `live_source_runs`
    (23)/`agent_requests` (21) tabs; bind the Google Sheets credential + real Spreadsheet ID on the new nodes;
    run the controlled runbook (§5.6) for 3–5 top competitor domains.
  - **Acceptance:** after the run — `competitor_site_snapshots` gains ≥1 baseline row per scraped domain;
    `live_source_runs` +1 (mode=live, external_calls=non-duplicates); `agent_requests` +1; WF12 "Сайты
    конкурентов" block populates; re-running WF06 flips those candidates to `processed` idempotently.
