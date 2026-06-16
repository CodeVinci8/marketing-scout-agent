# STAGE_3_SOURCE_AND_INTELLIGENCE_FOUNDATION.md — Stage 3 Definition

**Status:** ACTIVE — **deterministic/fixture/tested chain OPERATIONAL (PASS) after the WF14 retest (2026-06-16);
NOT closed (live Telegram WF11 + live VK WF13 remain gated).** · **Decisions:** DEC-113, DEC-119, DEC-120, DEC-121, DEC-123, **DEC-124–127, DEC-129–130 · DEC-131 (single-read/capped triage) · DEC-132 (WF11 v0.4 gated Telegram live preview)**

> **2026-06-16 update:** WF14 public-lead-signal triage quota fix (DEC-130/131) **passed operator retest**
> (TEST B `+4`, TEST C repeat `+0`/dup=6, TEST E full-history no quota error) — **WF14 no longer blocks** the
> deterministic source/intelligence chain. WF12 deterministic report ingests `public_lead_signals` (PASS).
> Live Telegram (WF11 v0.4, DEC-132) is **built but gated/inert** — first live smoke is the next operator step;
> live VK (WF13) is the step after. Stage 3 stays open until live connectors are armed/tested.

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
