# Hot Memory — Recent Sessions

Most recent first. Keep last 3 sessions max. Archive older entries to `core/warm/decisions.md`.

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

---

## Session: 2026-06-17 (session 8) — Stage 3 MVP CLOSED + Stage 2 scoped + WF12 wording + Stage 4/Lead Scout/audit docs (DEC-136)

**Status (exact):** stage-closure + cleanup patch (no Stage 4 build, no Stage 5, no new sources, no external
calls/Firecrawl/Telegram/VK/Claude, no activation, no real keys/Spreadsheet ID). On the clean two-channel WF11
v0.4.2 acceptance run, **Stage 3 MVP source/intelligence foundation is CLOSED / PASS** (DEC-136). Telegram
tracked-channel public preview closed; WF08/WF10/WF12 deterministic chain PASS. VK live + Telegram
groups/MTProto/member extraction = expansion/future; semantic-classification debt → Stage 4.1. Dirty diagnostic
runs (`wf11_req_…054733/055318/055705`, `touchpoint_…060227`, `wf10_…061138`, `wf11_req_20260617_032817`) kept
but **never** closure evidence.

**Code (only WF12 + WF06; JSON valid; all Code nodes `node --check` OK; active=false; no keys/Spreadsheet ID):**
- **WF12 (Task B):** `source_collection_actions` + empty-snapshot notice rewritten to human wording — Telegram =
  "публичный превью по отслеживаемым каналам протестирован … добавить/одобрить", **no "allowlist"/"enable HTTP
  node"** in operator-facing text; VK = future expansion; empty snapshots = "Stage 2 not yet populated, not a
  fault". Full Markdown **not** shortened. (Internal `source_allowlist` column kept.)
- **WF06 (Task D):** `Build Execution Summary & Handoff` operator_note rewritten with explicit, idempotent
  acceptance criteria for marking candidates processed (separate confirmation step; only when in url_registry;
  never skipped). WF06 already auto-reads `url_candidates`+`url_registry` — "too manual" concern was stale.
  "Mark Processed" stays disabled (manual WF04 handoff = no success signal).

**Docs:** Stage 3 closure section (exact framing + diagnostic-run ledger); `STAGE_2_WEB_COMPETITOR_PIPELINE_REVIEW.md`
§5 cleanup checklist (WF06 already-correct, Mark-Processed blocker/criteria, observability via WF15, shallow=MVP
default deep policy, snapshot runbook); GOOGLE_SHEETS_VALIDATION_PLAN + report schema formatting (Clip/top-align,
keep full markdown); **new** `LEAD_SCOUT_LAYER_PLAN.md` + `PRE_STAGE_4_EXTERNAL_AUDIT_BRIEF.md`; Stage 4 split
into 4.1/4.2/4.3; DEC-136 in DECISIONS + warm; ROADMAP/NEXT_ACTIONS updated.

**Next operator action:** run the ≤5 acceptance checks (below in this file / final report), then hand the repo +
`PRE_STAGE_4_EXTERNAL_AUDIT_BRIEF.md` to the external ChatGPT-agent audit. After audit → **Stage 4.1 Claude
Enrichment Core** (its own approval + budget guard; never call Claude before that).

---

## Session: 2026-06-17 (session 7) — WF11 v0.4.2 FINAL Stage 3 quality gate: adjacent-RE skip + gate-based transport (DEC-135)

**Status (exact):** final Stage 3 closure patch — **WF11 only** (WF08 untouched; no VK live, no Telegram
groups/MTProto/member extraction, no Stage 5, no Claude enrichment, no external calls). After v0.4.1 fixed
greeting/personal false positives, the diagnostic `wf11_req_20260617_032817` (`ipotekapro`) still leaked
**adjacent real-estate** posts (object/lot/ЖК promos + agent recruitment) as `competitor_activity` and a holiday
post as `market_signal` (TEST 6: 10/10 business-relevant — too broad). That run + the 2026-06-16 runs remain
**diagnostic/contaminated, NOT closure evidence.**

**WF11 v0.4.2 (DEC-135; $0, fixture default, inert live via gate):**
- `Normalize Telegram Posts`: **post-text-only** relevance, **5 classes** — `competitor_activity` (post-level
  service evidence) · `market_signal` (news/program/rate) · `adjacent_real_estate_signal` (object/lot/recruitment
  → **skip** by default; override to competitor only on STRONG_SERVICE) · `irrelevant_live_false_positive`
  (greeting/holiday/personal → skip) · `hard_negative` (skip). Cleaned OFFER vocab so bare `комисси`/`ставк` no
  longer trigger competitor; added STRONG_SERVICE / RE_OBJECT / RE_RECRUIT / GREETING term sets. Strong service CTA
  wins over market context (4101 → competitor). `adjacent_real_estate_skips` counter added.
- **Task B — gate-based transport:** nodes renamed `… (LIVE gated transport)` / `… (HTTP fallback, LIVE gated)` and
  **enabled**; safety = approval gate + tracked-channel validation + caps (not manual disabling); `Route Live
  Transport` runs only the selected transport; fixture/empty-token → `external_calls=0` by graph. `active=false`.
- Wording: operator-facing strings → "tracked channels / список отслеживаемых каналов" (internal
  `live_channel_allowlist` kept).

**Validation:** JSON valid; 11 Code nodes `node --check` OK; local sim **16/16** snippets correct; fixture
regression unchanged (6/5/1/4/1, false_positives=0, adjacent=0, unique=4, dup=1, raw +5, registry +4). No real
keys/Spreadsheet ID; no Bot API/MTProto/member/outreach code.

**Next operator action:** run the **≤5-test final acceptance plan** (WF11 RU doc / NEXT_ACTIONS): fixture →
live `ipotekapro` (4106 skip / 4092+4098 adjacent skip / 4091/4093/4099 competitor / 4090/4097 market) → live
`brokershakurova` no-regression → WF08 handoff on clean run → WF10 clean. Then **close the Telegram source** and
start **Stage 4 (Claude enrichment + report)**. VK live + Telegram groups = expansion/future.

---
