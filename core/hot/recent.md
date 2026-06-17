# Hot Memory — Recent Sessions

Most recent first. Keep last 3 sessions max. Archive older entries to `core/warm/decisions.md`.

---

## Session: 2026-06-17 (session 12) — Stage 3.5 audit alignment + live-readiness hardening (DEC-140)

**Status (exact):** post-audit hardening patch before Stage C. **No new features, no Stage 4/Claude, no external
calls** (no VK/Telegram/Firecrawl/Apify/Claude/OpenAI), no activation, no real keys/Spreadsheet IDs, no
auto-outreach, no member/private extraction. External audit found **no P0 blockers**; this patch closes its 4
pre-Stage-C items. All workflows `active=false`.

**Code fixes (WF14 only — verified safe via local harness):**
- **`review_priority` → 4-value enum.** `priorityOf` now faithfully mirrors `score_band` over {high, medium, low,
  **ignore**} (was collapsing ignore→low). Default `min_lead_score=25` still filters ignore-band before write, so
  emitted set stays {high,medium,low} unless lowered. No behaviour change on fixtures.
- **`splitCmt()` comment-URL contract fix.** WF13 (fixture+live) folds the comment anchor into `post_url`
  (`…_201#reply2011`) and can't add a `comment_url` column (raw_market_records is fixed 40-col). WF14 now derives
  `source_comment_url` from a reply-anchored `post_url` and cleans `source_post_url` to the base post → **fixture
  and live rows share dedup keys + `lead_signal_id`**, and `source_comment_url` is populated. Harness: WF13-path
  `signals_written=5` (H/M/L 2/2/1) with **byte-identical lead_signal_ids** to baseline; repeat run 0/dup 5.

**Canonical decisions (docs):**
- **Timestamps:** `created_at` (write/append) / `updated_at` / `extracted_at`; **no `append_timestamp`/
  `timestamp_appended` column exists** under either name (phantom). Documented in TABLE_SCHEMA §G + validation plan.
- **Pinned Stage C fixture outcomes (harness-derived, not invented):** standalone 10-scenario → **7 written**, H/M/L
  **3/2/2**, contacts_found=2, **contacts_blank=1 (F10)**, dup=1 (F8), irrelevant=1 (F7), F6 competitor excluded;
  WF13 9-item fixture → **5 written**, H/M/L **2/2/1**, repeat 0/dup 5; `outreach_allowed=FALSE` everywhere.
- **VK live readiness = `IMPLEMENTED_READY_FOR_STAGE_C`** (token gate + allowlist-only wall.get/wall.getComments
  v5.199 + disabled HTTP placeholder-token node + inert throwing parser + caps + ledger). Only runtime API =
  `BLOCKED_BY_OPERATOR_CREDENTIALS_OR_LIVE_RUN`. Exact operator setup in LEAD_SCOUT_LAYER_PLAN §12.
- **WF12 unchanged** — already audit-compliant (anonymized lead block, schema-tolerant, no raw contacts, no Claude).

**Docs edited (md):** TABLE_SCHEMA §G, GOOGLE_SHEETS_VALIDATION_PLAN (list 28 + §3.6 explicit enums),
PUBLIC_LEAD_SIGNAL_LAYER, LEAD_SCOUT_LAYER_PLAN (§3a/§12), STAGE_C_ACCEPTANCE_PACK (C3/C5), fixtures README,
DECISIONS (DEC-140), warm decisions, NEXT_ACTIONS, AGENT_LOG.

**Next:** **Stage C acceptance** unchanged — C3/C5/C6/C7 fixture-runnable now ($0); C1 (Stage 2 paid) + C4 (live VK)
= `BLOCKED_BY_OPERATOR_CREDENTIALS_OR_LIVE_RUN`. Then Phase D / Stage 4 Claude (own approval). Stage 4 NOT started.

---

## Session: 2026-06-17 (session 11) — Stage 3.5 Lead Scout Foundation BUILT (DEC-139)

**Status (exact):** real build patch (Phase B of the LOCKED A/B/C/D model). Deterministic, **all `active=false`,
$0, NO external calls** (no VK/Telegram/Apify/Firecrawl/Claude), no activation, no real keys/Spreadsheet IDs, no
auto-outreach, no member/private extraction. Fixture/harness-validated only.

**Architecture (DEC-139):** Option A refined — **no new WF16**. WF13 = VK public lead source, WF14 = central Lead
Scout engine, WF12 = lead report block; competitor branch (WF08/WF10) untouched (no pollution).

**Built (code, fixture-validated):**
- **WF14 v0.3 Lead Scout Triage & Scoring engine:** reads `raw_market_records` audience rows (PRIMARY, decoupled
  from WF08) + `review_queue`; deterministic 0–100 scoring (intent25+urgency15+pain20+niche15+contact8+region7+
  freshness10 − penalties) → `lead_score`/`score_band`/`review_priority`/`recommended_action`/`score_reasons`;
  public-contact extraction (verbatim only, `contact_source_url` mandatory, blank+`do_not_use` if unprovable);
  multi-key dedup; supplier/competitor-ad exclusion; writes `public_lead_signals` v0.3 (47 cols) + `agent_requests`;
  self-test (read_once/cap/dedup/policy). **61/61 fixture checks; repeat-run dedup PASS.**
- **WF13 v0.3 VK public lead source:** consumer-demand detection → audience lead rows; gated live `wall.get` +
  `wall.getComments` (inert; runtime = PENDING_STAGE_C); lead-rich synthetic fixtures (+7 000 phones).
  **Routing harness: 6 audience rows incl dedup + competitor separate + 1 hard-skip PASS.**
- **WF12 lead block:** priority H/M/L + public-contact-evidence counts + top-N **anonymized** summaries (no
  contacts in report). **12/12 incl. no-leak checks.**
- **WF15:** source_family += public_lead_source/lead_triage.
- **Schema/docs:** `public_lead_signals` v0.3 (47 cols, TABLE_SCHEMA §G + migration); validation lists 27–33 +
  §3.6; LEAD_SCOUT_LAYER_PLAN BUILT; PUBLIC_LEAD_SIGNAL_LAYER v0.3; **new STAGE_C_ACCEPTANCE_PACK** (max 7 checks);
  COSTS note; fixtures `n8n/fixtures/lead_scout/`.

**Policy:** public evidence only; contact = evidence not permission; `outreach_allowed=false` always;
recommended_action ∈ {manual_review, content_idea, monitor, ignore}; no hidden/inferred contacts, no member
extraction, no private groups, no MTProto.

**Next:** **Stage C acceptance** (`STAGE_C_ACCEPTANCE_PACK.md`) — C3/C5/C6/C7 fixture-runnable now ($0); C1 Stage 2
paid snapshot + C4 live VK run = `BLOCKED_BY_OPERATOR_CREDENTIALS_OR_LIVE_RUN`. Then **Phase D / Stage 4 Claude** (own approval). Stage 4 NOT started.

---

## Session: 2026-06-17 (session 10) — Stage A Cleanup Lock: A/B/C/D stage model LOCKED (DEC-138)

**Status (exact):** documentation/stage-model cleanup-lock patch only. **No build, no Stage 3.5 build, no Stage 4,
no code/workflow edits, no external calls** (no Firecrawl/Apify/VK/Telegram/Claude), no activation, no real
keys/Spreadsheet IDs, no deletions.

**What was locked (DEC-138):**
- **Stage model A/B/C/D:** A = Cleanup Lock · B = **Stage 3.5 Lead Scout Foundation + paid/live readiness (NEXT
  ACTIVE BUILD)** · C = Acceptance Pack · D = Stage 4 Claude Intelligence Layer.
- **Locked status:** Stage 1 CLOSED · Stage 2 CODE-COMPLETE / READY FOR CONTROLLED PAID-LIVE ACCEPTANCE ·
  Stage 3 MVP CLOSED/PASS · **Stage 3.5 NEXT ACTIVE BUILD** · Stage 4 after Stage 3.5 + Acceptance Pack ·
  Stage 5 after the Stage 4 contract.
- Stage 2 paid/live acceptance **postponed to Stage C**; Stage 4 starts **only after** Stage 3.5 + Acceptance Pack;
  testing happens **after full builds**, not micro-tests per node.

**Docs edited (Markdown only):** ROADMAP (LOCKED block + session-7/8 historical), NEXT_ACTIONS (Stage 3.5 priority),
LEAD_SCOUT_LAYER_PLAN (reframed Stage 3.5 NEXT ACTIVE BUILD + source priority/fields/status/testing),
STAGE_3 doc (v0.4.2 closure-PENDING marked historical/superseded; current = MVP CLOSED/PASS), STAGE_4 doc
(Stage 4 = Claude Intelligence Layer, does NOT start now; Stage 3.5 + Acceptance Pack first; 4.1/4.2/4.3 kept),
PRE_STAGE_4_EXTERNAL_AUDIT_BRIEF (audit v2 response appended), AGENT_LOG (session 10 + session-7 historical),
DECISIONS + warm decisions (DEC-138).

**Next:** start **Stage 3.5 Lead Scout Foundation** (its own approval per step); Stage 2 paid/live acceptance and
Stage 4 wait for Stage C / Stage D respectively.
