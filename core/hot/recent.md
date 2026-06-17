# Hot Memory — Recent Sessions

Most recent first. Keep last 3 sessions max. Archive older entries to `core/warm/decisions.md`.

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

## Session: 2026-06-16 (session 6) — WF11 v0.4.1 post-level relevance fix + WF08 loop-summary accounting fix (DEC-133/134)

**Status (exact):** first gated WF11 live smoke ran end-to-end (transport/parser/dedup PASS) but **live relevance
was too loose** — holiday/personal posts written as business-relevant, market news inflated to competitor. This
session is a **focused correction patch only** (no new sources, no VK/groups/MTProto/Claude/Stage 5). The live
runs `wf11_req_…054733/055318/055705`, `touchpoint_…060227`, `wf10_…061138` are **contaminated diagnostics — NOT
Stage 3 closure evidence.** Stage 3 is NOT closed.

**WF11 v0.4.1 (DEC-133; $0, fixture default, inert live):**
- Relevance now decided by **post text only**; channel title/username/allowlist = confidence/metadata, never
  relevance. `OFFER`→competitor_activity, `MARKET`/`POSITIVE`→market_signal, no post-level finance evidence →
  `irrelevant_live_false_positive`→hard_skip (counted in `hard_skipped_items`/`irrelevant_false_positives`; not
  written to raw/registry by default; `live_debug_audit=false` gates optional audit). Short tokens use Cyrillic
  word boundaries; no hardcoded post IDs. market/news on a competitor channel stays market_signal.
- LIVE `agent_requests` now logs the **actual live allowlist** + `source=live_preview` + `transport=…` (was
  fixture allowlist). next_action gated on `unique>0 && business_relevant>0`; suggests allowlist/relevance
  change when false positives dominate; no auto-handoff.

**WF08 v0.10 (DEC-134; summary accounting only — routing untouched):**
- `Final Summary` aggregates the loop **done** output (`$input.all()`) instead of last-iteration in-loop `.all()`
  → `total_processed`/`deterministic_rows`/`route_counts` were 1, now correct (sim: selected=8 → processed=8).
  `processed_accounting_ok` added. `llm_enabled=false` ⇒ claude_calls=0, cost=0 preserved.

**Validation:** JSON valid; 7 Code nodes pass `node --check`; relevance sim 11/11; WF08 summary sim coherent;
active=false; transports DISABLED; fixture_mode=true/live_mode=false defaults; no keys/Spreadsheet ID/Bot
API/MTProto-usage.

**Next operator action:** (1) commit; (2) re-import WF11 + WF08; (3) **WF11 fixture retest** (expect unchanged:
6/1/5/4/1, false_positives=0); (4) **WF11 live retest** on `brokershakurova` + `ipotekapro` — expect
1231/1233/1240/4106 skipped as false positives, real service posts kept, market digests = market_signal; (5)
WF08 handoff on a **clean** WF11 live run and confirm summary counters match queue rows. Live VK + Claude summary
remain gated. Stage 3/4 NOT closed.

