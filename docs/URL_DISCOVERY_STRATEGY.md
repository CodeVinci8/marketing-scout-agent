# URL_DISCOVERY_STRATEGY.md — Stage 2.2 URL Discovery Layer (Planning)

**Status:** 📋 PLANNING ONLY — nothing built. No workflow JSON, no external calls.
**Selected architecture:** **Hybrid A + B + D** (manual intake first → search/API later → Telegram as interface), with C parked. See §5.
**Date:** 2026-06-08
**Related:** `docs/WORKFLOW_05_URL_DISCOVERY_PLAN.md`, `docs/WORKFLOW_04_FIRECRAWL_URL_LIST_PLAN.md`, `docs/TABLE_SCHEMA.md`, DEC-050/051/054/055/056/057/058

---

## 1. Why discovery is separate from analysis

Workflow 04 already **consumes** URLs: it takes ≤5 URLs, dedups against `url_registry`,
scrapes (Firecrawl), analyzes (Claude), and routes results. It is the **URL consumer**.

What is missing is the **URL supplier**: a controlled way to turn an operator's topic/query
(e.g. *«займ под залог ПТС Москва»*) into a vetted list of candidate URLs to feed Workflow 04.

Keeping the supplier separate from the consumer is deliberate:
- **Different cost profiles.** Discovery may use a search API/actor (its own cost + rate limits);
  analysis uses Firecrawl + Claude. Mixing them hides where money goes.
- **Different failure modes.** Bad SERP results, SEO spam, and regional mismatch are *discovery*
  problems; JSON parsing and routing are *analysis* problems. Isolating them keeps each workflow simple.
- **Human gate in the middle.** A candidate list must be **approved by a human** before any paid
  Firecrawl/Claude processing. A separate `url_candidates` sheet is that gate.
- **Reuse of dedup.** Discovery checks `url_registry` early, so already-processed URLs never reach
  approval or spend.

## 2. URL consumer vs URL supplier

| | URL Supplier (Stage 2.2, new) | URL Consumer (Workflow 04, done) |
|---|---|---|
| Input | topic/query or pasted candidate URLs | ≤5 approved URLs |
| Output | rows in `url_candidates` (status `new`) | rows in 6 business tabs + `url_registry` |
| Cost | 0 (manual) or search-API cost (later) | Firecrawl + Claude |
| Gate | human sets `approval_status=approved` | `url_registry` dedup + placeholder pre-filter |
| Built? | No (planning) | Yes (approved, ≤5 URLs manual) |

## 3. Safe staged rollout

1. **Stage 2.2a — Manual Candidate Intake (Option A).** Operator pastes candidate URLs; the workflow
   normalizes, checks `url_registry`, and writes `url_candidates` with `approval_status=new`. **0 cost.**
2. **Stage 2.2b — Search/API candidate discovery (Option B).** A small, measured test of a search
   provider / Apify actor that fills `url_candidates` from a query. Source must be evaluated first.
3. **Stage 2.2c — Approved Candidates Runner (hand-off).** A workflow that picks `approval_status=approved`
   candidates and feeds them to Workflow 04 in **controlled batches of 5** (Workflow 04's per-run limit).
   Until built, the hand-off is **manual** (operator copies approved URLs into Workflow 04, ≤5 at a time).
4. **Stage 2.3 — Telegram Control Bot.** Operator-facing interface (submit query → see candidates + cost →
   approve → launch). Not discovery itself; calls the workflows above, never duplicates their logic.

Each stage is gated: do not start the next until the previous one is approved.

## 4. Source options (A/B/C/D)

- **Option A — Manual URL Candidates.** Operator pastes URLs into the intake. Cheapest, safest, no
  search API. **Recommended first step.**
- **Option B — Search API / SERP actor.** A search provider or Apify actor returns URLs from a query.
  More automated, but carries cost + rate-limit risk and needs source evaluation (quality, ToS, region).
- **Option C — Firecrawl `/v2/search`.** Only if it proves appropriate *later*. **Currently blocked**
  until evaluated; do not assume it is the best option.
- **Option D — Telegram Control Bot.** An *interface*, not a discovery source: lets the operator submit
  queries, approve URLs, and launch Workflow 04. Comes after a candidate workflow exists.

## 5. Selected architecture — Hybrid A + B + D (C parked)

**Decision (DEC-058):** the discovery layer is a **hybrid** of Option A (manual), Option B (search/API),
and Option D (Telegram as interface), rolled out in that order. **Option C (Firecrawl `/v2/search`) is
parked.**

- **A is built first** (Workflow 05, manual intake) — proves the `url_candidates` + normalization +
  `url_registry` dedup + human-approval flow at **0 cost**, with no new external dependency.
- **B follows** once a search provider/actor is evaluated (gate G4). B reuses the *same* `url_candidates`
  sheet, normalization, dedup, and approval gate — it only changes the *source* of candidates.
- **D (Telegram) is last and is interface-only:** it submits discovery requests, shows candidates + cost
  estimates, asks for approval, and triggers the existing workflows. It performs **no scraping or analysis
  itself** and duplicates no discovery/processing logic.

**Why Firecrawl `/v2/search` (C) is parked:** it bundles search + scrape in one provider, which couples
discovery cost/quality to the scraping vendor and tempts a single search→scrape→analyze step. We
deliberately keep discovery, approval, and processing as **separate, independently testable** stages, and
do not combine search+scrape+analysis initially. C may be evaluated later as a *candidate-discovery-only*
source (write `url_candidates`, still require approval) — never as a combined pipeline.

**Why Telegram is interface, not core logic:** putting discovery/scraping/analysis inside the bot would
duplicate Workflow 04/05 logic, hide cost, and remove the human gate. The bot must call the workflows and
relay results, so the core logic stays in one place and remains usable without Telegram.

**Default volumes:** a discovery request **collects up to 10 candidates** by default (`requested_limit=10`).
Workflow 04 still **processes max 5 URLs per run**, so 10 approved candidates are processed as **two
controlled batches of 5**. **No candidate reaches Firecrawl/Claude until `approval_status=approved`.**

## 5a. Future expansion rules (new agents/features)

- **One responsibility per workflow.** Discovery supplies candidates; Workflow 04 consumes approved URLs;
  a runner does hand-off; the bot is an interface. New features slot into one of these roles, not across them.
- **Reuse the shared keys.** Any new source must write `url_candidates` and set `normalized_source_url`
  with Workflow 04's normalizer so it matches `url_registry` exactly.
- **Human gate stays.** No new agent/source may auto-process; `approval_status=approved` is always required
  before paid Firecrawl/Claude work.
- **Group by request.** New sources set `discovery_request_id` + `requested_by` + `requested_limit` so
  summaries and the future Telegram bot can group/report per request.
- **Estimate before spend.** Any new discovery source must populate the estimate columns before approval,
  and its own (search/API) cost must be measured separately from processing cost.
- **Gate each stage.** A new automated source requires source evaluation (G4) and an agreed cost ceiling (G5)
  before it runs.

## 6. Risks

- **Bad SERP results** — irrelevant pages returned for a query. Mitigation: human approval gate; `confidence_score`.
- **SEO spam / aggregators** — directories, lead-gen farms, doorways. Mitigation: domain allow/deny review at approval.
- **Duplicate domains** — many URLs from one domain. Mitigation: `url_registry` check + `dedup_status` + per-domain caps.
- **Regional mismatch** — non-Moscow results for a Moscow query. Mitigation: `region_hint`, manual review.
- **Cost creep** — automated discovery feeding large lists into paid processing. Mitigation: candidate caps, cost estimate before approval, Workflow 04's ≤5-URL limit stays.
- **Legal / compliance** — search provider ToS, scraping of disallowed sources, personal data. Mitigation: only public business pages; evaluate each source's ToS before Option B.
- **False competitors** — non-competitor pages (banks, news, marketplaces) labelled as targets. Mitigation: human approval + later Claude classification in Workflow 04, never auto-approve.

## 7. Decision gates before automation

- **G1 — Schema approval.** Operator approves the `url_candidates` **25-column** schema and `approval_status` values.
- **G2 — Manual intake (Option A) validated.** Workflow 05 normalizes + dedups + writes candidates correctly at 0 cost.
- **G3 — Approval flow proven.** A human can move `new → approved` and only approved URLs reach Workflow 04.
- **G4 — Source evaluation (Option B).** A named search provider/actor is evaluated for quality, ToS, cost, and rate limits **before** any automated discovery.
- **G5 — Cost ceiling agreed.** Per-intake and per-run cost ceilings are set before Option B or the Telegram bot.

Telegram Control Bot is deferred until G1–G3 are passed (candidate + approval flow exists).

---

## See also
- `docs/WORKFLOW_05_URL_DISCOVERY_PLAN.md` — the manual-intake workflow plan + `url_candidates` schema.
- `docs/WORKFLOW_04_FIRECRAWL_URL_LIST_PLAN.md` — the URL consumer (approved).
