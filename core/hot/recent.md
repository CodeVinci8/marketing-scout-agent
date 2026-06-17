# Hot Memory — Recent Sessions

Most recent first. Keep last 3 sessions max. Archive older entries to `core/warm/decisions.md`.

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

---

## Session: 2026-06-17 (session 9) — Stage 2 EXCELLENCE CONSOLIDATION implemented (WF04/05/06/07/09/14) (DEC-137)

**Status (exact):** real implementation patch (not docs-only). All workflows `active=false`, placeholder-safe,
**no external calls made** (no Firecrawl/Apify/VK/Telegram/Claude), no activation, no real keys/Spreadsheet IDs,
no auto-outreach, no MTProto/member extraction. Stage 3 stays CLOSED (DEC-136); this patch closes Stage 2 code.

**Implemented (code):**
- **WF06:** removed `Mark Candidates Processed (DISABLED)` → enabled **confirmation-based idempotent** marker.
  `Select` emits `_confirm_processed` only for approved candidates now present in `url_registry`; `IF Confirmed
  Processed?` → update sets `approval_status=processed` + audit notes. Never marks skipped/failed; never re-marks.
- **WF04:** new per-URL branch writes **baseline `competitor_site_snapshots`** (22 cols, gated, change_type=baseline,
  Sheets-safe contact); loop **done** output appends one **`live_source_runs`** (23) + one **`agent_requests`** (21)
  per run via `$input.all()` (DEC-134). technical_errors path unchanged. Phase B (prompt-rich guarantees/CTA/title)
  + Phase C (snapshot diff) deferred.
- **WF05/WF07/WF09:** automatic **`live_source_runs`** append per run (manual WF15 now fallback only).
- **WF14:** read-once/cap/dedup **self-test** in Final Summary (`read_once_ok`/`append_cap_ok`/`self_test_passed`).

**Validation:** JSON valid for all 6 edited workflows; all Code nodes `node --check` OK; active=false; no real
keys; Spreadsheet IDs are placeholders; user-facing "allowlist" only as internal `source_allowlist` column; no
`DISABLED` node remains in WF06.

**Stage 2 status:** WF04–WF07 **code-complete / ready for controlled snapshot collection**; full populated-closure
= **BLOCKED_BY_OPERATOR_ACTION** (operator must create new tabs + bind credential/Spreadsheet ID + run the
controlled Firecrawl runbook — out of patch scope). Then **Stage 4.1** after external audit.

**Next operator action:** create `competitor_site_snapshots` (22) tab + confirm `live_source_runs`(23)/`agent_requests`(21);
bind credential + real Spreadsheet ID on the new nodes; run WF05→approve→WF06→WF04 on 3–5 top domains; verify the
expected Sheets deltas; re-run WF06 to confirm idempotent `processed` marking. Then hand repo + audit brief to the
external agent.
