# STAGE_3_SOURCE_AND_INTELLIGENCE_FOUNDATION.md — Stage 3 Definition

**Status:** ACTIVE (2026-06-12) · **Decisions:** DEC-113 (MVP shape), DEC-119 (WF08 cost-control), DEC-120 (WF11 live path), DEC-121 (WF13 VK), DEC-123 (stage boundaries)

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
| 11 | Telegram public channels (t.me/s preview) | competitor ad copy, market signals | ✅ fixture PASS; live path guarded & inert (DEC-120) |
| 13 | VK public groups/posts/comments | **audience signals**: questions, objections, pains, author aggregates | 🔧 fixture foundation built (DEC-121) |

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
