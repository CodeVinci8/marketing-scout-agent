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
