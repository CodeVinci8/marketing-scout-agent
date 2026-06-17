# STAGE_3_SOURCE_AND_INTELLIGENCE_FOUNDATION.md — Stage 3 Definition

**Status:** ✅ **STAGE 3 MVP SOURCE/INTELLIGENCE FOUNDATION: CLOSED / PASS (2026-06-17, DEC-135 + final
two-channel acceptance run).** Telegram public-channel source CLOSED for the MVP tracked-channel public preview.
VK live + Telegram groups/MTProto/member extraction = expansion/future, **not** MVP blockers. Perfect semantic
classification = Stage 4.1 enrichment task, not a Stage 3 blocker. **Next active build = Stage 3.5 Lead Scout
Foundation (LOCKED A/B/C/D model, DEC-138)** — Stage 4 (Claude Intelligence Layer) starts only after Stage 3.5 +
the Stage C Acceptance Pack, **not** immediately after this closure. · **Decisions:**
DEC-113, DEC-119–123, DEC-124–134, **DEC-135 (WF11 v0.4.2 final quality gate: 5-class post-level relevance +
adjacent_real_estate_signal skip + gate-based transport + tracked-channel wording)**, **DEC-136 (Stage 3 MVP closure)**,
**DEC-138 (LOCKED A/B/C/D stage model; Stage 3.5 next)**

> **[HISTORICAL — superseded by the CLOSED/PASS status above] 2026-06-16 update:** WF14 public-lead-signal
> triage quota fix (DEC-130/131) **passed operator retest** (TEST B `+4`, TEST C repeat `+0`/dup=6, TEST E
> full-history no quota error) — **WF14 no longer blocks** the deterministic source/intelligence chain. WF12
> deterministic report ingests `public_lead_signals` (PASS). The "Stage 3 stays open until live connectors are
> armed/tested" wording in this dated note is **no longer current**: Stage 3 MVP is CLOSED/PASS (DEC-136).

## 1. What Stage 3 is

Stage 3 builds the **source and intelligence foundation** of the market-intelligence MVP:

```
source connectors (WF09 Avito · WF11 Telegram · WF13 VK)
  → raw_market_records (40 cols) + market_record_registry (15 cols) + agent_requests (21 cols)
  → WF08 one-record Touchpoint Analyzer (deterministic-first, llm_enabled=false by default)
  → business queues (results / review_queue / monitor_queue / content_queue / skipped_log)
  → WF10 Competitor & Audience Intelligence Aggregator (deterministic fact core)
```

Stage 3 is **not** an infinite parser collection. The deliverable is: a small set of guarded,
fixture-first source connectors that all speak the same record contract, one analyzer, one aggregator,
and hardened scoring/confidence rules. Everything downstream (reports, Claude, Telegram) is Stage 4/5.

## 2. Scope (in)

- **Source connectors**, one source at a time (DEC-096): Avito/classifieds (WF09, CLOSED/APPROVED live),
  Telegram public-channel preview (WF11, fixture PASS; guarded inert live path v0.2 — DEC-120),
  VK public groups/posts/comments (WF13, fixture foundation — DEC-121).
- **Record contract**: every connector writes only `agent_requests` / `raw_market_records` /
  `market_record_registry`; hard-negative filtering before registry; registry dedup; MSK timestamps.
- **WF08** analyzer: deterministic-first; `llm_enabled=false` master kill switch (DEC-119) — uncertain
  records go to `review_queue` as `deterministic_uncertain_no_llm`, $0.
- **WF10** aggregator: deterministic fact core (DEC-112) — competitor_profiles, market_angles,
  audience_activity_signals, content_positioning_plan, source_confidence_rules.
- **Source/scoring hardening**: relevance vocabularies, confidence rules, validation_lists,
  contact policy enforcement (CONTACT_AND_OUTREACH_POLICY — binding).

## 3. Scope (out — deferred to later stages or backlog)

- Report building, Claude summaries, cost-tracked LLM usage → **Stage 4**.
- Telegram Business Agent, commands, approval gates, delivery → **Stage 5**.
- Niche Pack System, Market Graph Engine, Competitor Ad Intelligence expansion, Source/Budget Planner,
  Contact/Manager Handoff Layer → `FUTURE_CAPABILITIES_BACKLOG.md`.
- Additional sources (reviews/maps Zoon/Yandex/2GIS, Dzen, Instagram) — only after the three current
  foundations are live-proven; one at a time, each with its own approval.

## 4. Source roster and status (2026-06-12)

| WF | Source | Value | Status |
|----|--------|-------|--------|
| 09 | Avito / classifieds | competitor ads, offers, prices, semantics | ✅ CLOSED / APPROVED (live) |
| 11 | Telegram public channels (t.me/s preview) | competitor ad copy, market signals | ✅ **LIVE-READY** (DEC-120/126): token gate `I_APPROVE_LIVE_TELEGRAM_PREVIEW` + allowlist + disabled HTTP node; run logging built in |
| 13 | VK public groups/posts/comments | **audience signals**: questions, objections, pains, author aggregates | ✅ fixture PASS; **LIVE-READY** (DEC-125/126): token gate `I_APPROVE_LIVE_VK_PUBLIC_DISCUSSION` + allowlist + disabled official-API HTTP node; phone `#ERROR!` fixed; comments = `public_comment` |
| 14 | Public lead signal triage (layer over 09/11/13 output) | manager-readable lead signals: pains, intents, scores | ✅ BUILT deterministic v0.1 (DEC-130) |
| 02–06 | Competitor websites (Firecrawl pipeline) | offers, prices, guarantees, CTA, page changes | 🔁 **REINTEGRATED** (DEC-129): `competitor_site_snapshots` tab + WF12 block; WF04 snapshot-append = Phase B |

**Run observability (DEC-126):** every live-capable run writes one `live_source_runs` row
(WF11/WF12/WF13 automatically; WF15 manual logger for WF09/WF04/blocked attempts).

WF13 was chosen over reviews/maps and Dzen because the pipeline's weakest WF10 input is
`audience_activity_signals` — Avito and Telegram both feed competitor data; VK public discussions feed
audience pains, buying intent and active/repeat author counts. Reviews/maps (reputation evidence) is the
recommended 4th source; Dzen (content/SEO semantics) follows.

## 5. Exit criteria for Stage 3

1. WF13 fixture tests PASS (counters in `N8N_WORKFLOW_13_PUBLIC_DISCUSSION_OR_REVIEWS_CONNECTOR_RU.md`).
2. WF08 cost-control retest PASS (uncertain record → `deterministic_uncertain_no_llm`, Claude calls=0).
3. WF11 → WF08 → WF10 and WF13 → WF08 → WF10 handoffs produce expected queue rows + WF10 snapshots.
4. WF11 live preview executed once **only after explicit operator approval** (token + enabled HTTP node).

## 6. Safety invariants (apply to every Stage 3 connector)

No private chats/groups/MTProto/login scraping · no member extraction · no hidden contacts ·
contacts only verbatim from public text with evidence URL, default `manual_review` · no auto-outreach ·
no auto-handoff to WF08 · `active=false`, manual trigger, fixture-first, $0 by default ·
each live transport and each external API call requires its own explicit operator approval.

## 7. Session-4 additions (2026-06-12)

Stage 3 now explicitly includes: **Avito live (approved)** · **Telegram live-ready** (WF11 gated path) ·
**VK live-ready** (WF13 gated official-API path) · **public lead signal layer** (WF14 →
`public_lead_signals`) · **website source reintegration** (`competitor_site_snapshots`, DEC-129) ·
**run ledger** (`live_source_runs`, WF15). Exit criteria extended:
5. WF14 triage produces expected VK lead signals (see N8N_WORKFLOW_14 RU doc) and repeat-run dedup holds.
6. First approved live runs (WF11 Telegram, WF13 VK) each log a `live_source_runs` row with real counters/cost.

---

## 2026-06-16 — First WF11 live smoke: contaminated diagnostic runs (Stage 3 NOT closed)

The first gated WF11 Telegram live smoke proved transport (Firecrawl), parser (real `t.me/s` posts), dedup, and
the cost/empty-token/private-invite guards. **Business relevance was too loose** (channel-level relevance), so
these runs are **contaminated diagnostics, not stage-closing evidence**:

| Run | What passed | Verdict |
|-----|-------------|---------|
| `wf11_req_20260616_054733` `brokershakurova` | transport / parser / dedup | relevance **PARTIAL FAIL** (1231/1233/1240 false positives) |
| `wf11_req_20260616_055318` `brokershakurova` repeat | dedup (unique=0, dup=9) | false-positive relevance still present |
| `wf11_req_20260616_055705` `ipotekapro` | transport / parser / write | holiday 4106 false positive + record_type inflation; relevance **PARTIAL FAIL** |
| `touchpoint_20260616_060227` (WF08) | routing / queue writes | diagnostic on dirty upstream; surfaced summary accounting bug (DEC-134) |
| `wf10_20260616_061138` (WF10) | technical pass (113→108, 22 profiles, 9 angles, 8 signals, 1 plan, 0 errors) | consumed dirty WF11/WF08 data — **not** closure evidence |

**Fix applied:** WF11 v0.4.1 post-level relevance (DEC-133) + WF08 v0.10 summary accounting (DEC-134). **Stage 3
remains open** — re-run the live smoke + WF08 handoff on clean data, and live VK + Claude summary are still gated.

---

## [HISTORICAL — SUPERSEDED by the STAGE 3 MVP CLOSURE / PASS section below (DEC-136)] 2026-06-17 — WF11 v0.4.2 final quality gate → Stage 3 closure PENDING one short acceptance run (DEC-135)

> **This subsection is historical.** Its "closure PENDING one final acceptance run" and "next active stage =
> Stage 4" wording is **no longer current**. The final two-channel acceptance run was completed and Stage 3 MVP
> is **CLOSED / PASS** (DEC-136, section below); the next active build is **Stage 3.5** (DEC-138), not Stage 4.
> Kept for traceability of the v0.4.1 → v0.4.2 path.

After v0.4.1, the diagnostic run `wf11_req_20260617_032817` (`ipotekapro`) is a **useful diagnostic, NOT closure
evidence**: post-level relevance had fixed greetings/personal posts, but **adjacent real-estate posts** still
leaked in — object/lot/ЖК promos and real-estate agent recruitment were written as `competitor_activity`. The
v0.4.2 patch (DEC-135) closes this with a 5-class post-level gate (`competitor_activity` · `market_signal` ·
`adjacent_real_estate_signal` (skip) · `irrelevant_live_false_positive` (skip) · `hard_negative` (skip)) and
moves the transport to **gate-based safety** (nodes enabled but unreachable unless the approval gate passes).
Local sim: 16/16 representative snippets correct; fixture regression unchanged (6/5/1/4/1, false_positives=0).

**Stage 3 status after this patch:**
- **Stage 3 source pipeline:** OPERATIONAL (deterministic/fixture chain PASS).
- **Stage 3 Telegram public-channel source:** **closure PENDING one final acceptance run** (≤5 operator tests in
  the WF11 RU doc) after this patch.
- **VK live:** moved to **Stage 3 expansion**, not an MVP closure blocker (see FUTURE_CAPABILITIES_BACKLOG §VK).
- **Telegram groups / MTProto / member extraction:** **future high-risk extension**, not an MVP blocker
  (FUTURE_CAPABILITIES_BACKLOG §"Future Telegram Discussion/Group Connector").
- **Stage 2 web snapshot / WF06 manual config:** backlog / Stage 2 cleanup, **not** a Stage 3 blocker.
- **Next after the final acceptance run:** **Stage 4 — Claude enrichment + executive report** (now the next
  active stage; see `STAGE_4_REPORT_AND_CLAUDE_LAYER.md`).

> Wording: operator-facing text now uses **"tracked Telegram channels" / "список отслеживаемых каналов"**, not
> "allowlist" (internal config name `live_channel_allowlist` kept for compatibility).

---

## 2026-06-17 — STAGE 3 MVP CLOSURE / PASS (DEC-136)

Stage 3 MVP source/intelligence foundation is **closed at MVP level**. Closure framing (exact):

- **Stage 3 MVP source/intelligence foundation: CLOSED / PASS.**
- **Telegram public-channel source: CLOSED for MVP tracked-channel public preview.**
- **Guard / parser / dedup / relevance gate: PASS** (WF11 v0.4.2, DEC-135).
- **WF08 deterministic handoff / accounting: PASS** (v0.10, DEC-134; duplicate-only handoff correctly stops at
  Filter & Select when a WF11 run had unique=0 — acceptable).
- **WF10 deterministic aggregation: PASS** (rows_considered=115 → rows_after_filters=110, 22 competitor_profiles,
  9 market_angles, 8 audience_signals, 1 plan, source_mix=mixed, telegram present, technical_errors=0).
- **WF12 deterministic downstream report: PASS** (market_intelligence_reports +1, agent_requests +1,
  live_source_runs +1, rows_after_filters=110, llm_status=disabled, llm_cost_usd=0, telegram_send=false,
  delivered_to=none, public_lead_signals block present, no outreach, technical_errors=0).
- **VK live: Stage 3 expansion, NOT an MVP blocker.**
- **Telegram groups / MTProto / member extraction: future high-risk extension, NOT an MVP blocker.**
- **Perfect semantic classification: Stage 4.1 enrichment task, NOT a Stage 3 blocker.**

### Final live two-channel acceptance run (closure evidence)

`brokershakurova` + `ipotekapro`, WF11 v0.4.2:
posts_received=20 · structurally_valid_items=19 · invalid_items=1 · business_relevant_items=8 ·
hard_skipped_items=11 (irrelevant_false_positives=4, adjacent_real_estate_skips=6, hard_negative_skips=1) ·
unique=0 · duplicates=8 · registry_rows_written=0 · external_calls=2 · technical_errors=0.
False positives and adjacent real-estate posts are correctly skipped; this is the clean run that the v0.4.2
quality gate was built for.

### Diagnostic / contaminated runs (NOT closure evidence — kept, not deleted)

These earlier runs were the diagnostics that led to v0.4.1 → v0.4.2; they used looser (channel-level / pre-adjacent)
relevance and **must not be cited as closure evidence**:

- `wf11_req_20260616_054733`
- `wf11_req_20260616_055318`
- `wf11_req_20260616_055705`
- `touchpoint_20260616_060227`
- `wf10_20260616_061138`
- `wf11_req_20260617_032817`

### Known remaining semantic debt → Stage 4.1 (do NOT reopen Stage 3)

Some deterministic record-type classifications are imperfect and are deferred to Stage 4.1 Claude
enrichment/classification improvement:
- `brokershakurova/1237` likely `competitor_activity`, may currently be `market_signal`.
- `brokershakurova/1245` likely competitor/pricing positioning, may currently be `market_signal`.
- `ipotekapro/4090` likely `market_signal`, may currently be `competitor_activity`.

These are interpretation refinements, not source/guard/pipeline failures, and do not block Stage 3 closure.
