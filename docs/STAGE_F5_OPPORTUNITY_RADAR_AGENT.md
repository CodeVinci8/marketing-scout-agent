# Stage F.5 — Opportunity Radar + Analyst Agent

> **Status:** FUTURE CONTRACT ONLY — not implemented, not authorized. Comes **after** Stage F
> ([`STAGE_F_EVIDENCE_BOUND_LLM_ANALYSIS.md`](STAGE_F_EVIDENCE_BOUND_LLM_ANALYSIS.md)). Documented now so the current
> collectors and persistence contracts are built to extend into it without a rewrite.

Stage F.5 turns "here is what competitors do" (Stage A–F) into "here is where the opportunity is, and what to do
next" — plus a conversational analyst that can be asked ordinary questions. It adds **no new collectors**; it is a
reasoning + presentation layer over persisted evidence, deterministic scores, and (when enabled) Stage-F insights.

## Design principle — strict data separation

Every downstream module reads from clearly separated layers so a change in one never corrupts another:

| Layer | Source of truth | Mutability |
|---|---|---|
| **Immutable evidence / facts** | `raw_market_records`, `competitor_site_snapshots`, `evidence[]` | append-only |
| **Deterministic scores** | `source_health`, confidence/relevance/quality | recomputed per run |
| **LLM insights** (Stage F) | `report_bundles.llm_*` | per report, versioned |
| **Opportunity signals** (F.5) | new `opportunity_signals` tab | append-only, references evidence_ids |
| **Recommended actions** (F.5) | new `action_candidates` tab | append-only, status-tracked |
| **Conversation context** | `conversation_state`, bounded memory | rolling |
| **Execution / approval state** | `execution_plans`, `execution_summaries` | state machine |

Rule: opportunity signals and actions **reference** evidence/insight ids; they never copy or restate facts, so a
correction upstream is reflected everywhere.

## Module 1 — Opportunity Radar

Deterministic-first scan (LLM optional) that emits typed `opportunity_signals`, each citing evidence:

- **competitor_weaknesses** — gaps in a competitor's offer/positioning vs the niche norm.
- **market_gaps** — services/segments no tracked competitor addresses.
- **unaddressed_pains** — pains in `public_lead_signals` / audience signals with no competitor answer.
- **missing_offers** — offer types present in the niche but absent for a competitor.
- **pricing_opportunities** — price/term outliers (cheaper/faster/clearer) worth matching or beating.
- **content_gaps** — advertising/content angles under-served relative to demand.
- **trust_cta_gaps** — weak guarantees / unclear CTA / missing social proof.
- **customer_touchpoints** — where the audience actually engages (site form, TG, VK, comments).
- **lead_opportunities** — aggregated public lead demand (counts only, never contacts).

Each signal row: `{ signal_id, type, subject (competitor/niche), severity/score, rationale,
supporting_evidence_ids[], current_run_scope, owner/request lineage }`. Deterministic scoring first; Stage-F LLM may
add nuance but cannot create a signal with no evidence.

## Module 2 — Touchpoint Map

A per-competitor (and per-niche) map of where and how prospects can be reached, built from collected facts:

- website, landing pages, forms;
- Telegram channel, VK community;
- public comments / reviews;
- CTA(s) and their target (call / form / messenger / application);
- consultation / application paths.

Output: a structured touchpoint list + a simple readiness note ("сайт: форма заявки; TG: канал без бота; VK: —").
Public data only; no private/DM channels; no contact harvesting.

## Module 3 — Action Candidates

Typed, approval-gated **suggestions** (never auto-executed) written to `action_candidates`:

- offer experiments (match/beat a pricing or guarantee gap);
- content ideas (fill a content_gap; grounded in a real angle);
- landing-page improvements (from trust_cta_gaps);
- monitoring actions (add a competitor/source to `tracked_sources`);
- competitor deep dives (trigger Stage-F deep analysis on one competitor);
- lead review (open the N public lead signals for manual review — no outreach);
- source expansion (run discovery for a gap segment).

Each candidate: `{ action_id, type, title_ru, rationale, linked_signal_ids[], linked_evidence_ids[], priority,
estimated_cost (if it triggers collection), status: proposed|approved|done|dismissed }`. Executing a candidate is a
tool call behind the existing approval gate.

## Module 4 — Analyst Agent

A conversational layer (built on the Stage-F contextual analyst) that:

- answers **grounded follow-up questions** in Russian, citing stored evidence ("почему ты считаешь их слабым местом
  цены?" → quotes the evidence excerpt/url);
- is **report-context aware** (knows the latest report, selected competitors, the last N turns);
- retrieves **sources/results** on demand (evidence lookup, bundle lookup);
- is **memory-aware** (resolves "они/этот/прошлый" from bounded conversation memory without dropping charter/state/
  safety);
- performs **explicit tool execution** only through approval gates;
- has **no autonomous outreach** and cannot mutate external state without approval.

Interaction contract: **answer freely, act only via gated tools.** Ordinary questions never require a slash command;
any action that spends money, collects data, or changes sources/config is an approval-gated tool call.

## Extensibility guarantee

New sources (e.g., Avito when unblocked, YouTube, maps/reviews) and new analyses plug in by:
1. adding a collector that writes `raw_market_records` + `source_health` with the standard lineage;
2. the Radar/Touchpoint/Action/Agent modules pick them up automatically via the shared layers above —
   **no change to the current collectors or to Stage A–F is required.**

## Sequencing

Stage F (evidence-bound LLM analysis) must land and be accepted first. Stage F.5 is then additive: Radar → Touchpoint
Map → Action Candidates → Analyst Agent, each behind its own acceptance and each defaulting OFF until approved.

**Do not implement Stage F.5 before Stage F is complete and approved.**
