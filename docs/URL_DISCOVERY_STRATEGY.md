# URL_DISCOVERY_STRATEGY.md — Stage 2.2 URL Discovery Layer (Planning)

**Status:** 📋 PLANNING ONLY — nothing built. No workflow JSON, no external calls.
**Selected architecture (DEC-059):** **Level 2 — Apify Search Candidate Discovery** (Workflow 05). **BUILT (DEC-060, under test)** at `n8n/workflows/05_apify_search_candidate_discovery.json` (active=false, awaiting Apify token + credential). Manual URL entry is only an optional input mode (manual *lists* are already covered by Workflow 04). Telegram is a deferred interface layer; Firecrawl `/v2/search` parked. See §5.
**Date:** 2026-06-08
**Related:** `docs/WORKFLOW_05_URL_DISCOVERY_PLAN.md`, `docs/WORKFLOW_04_FIRECRAWL_URL_LIST_PLAN.md`, `docs/TABLE_SCHEMA.md`, DEC-050/051/054/055/056/057/058/059

---

## 1. Why discovery is separate from analysis

Workflow 04 already **consumes** URLs: it takes ≤5 URLs, dedups against `url_registry`,
scrapes (Firecrawl), analyzes (Claude), and routes results. It is the **URL consumer**.

What is missing is the **URL supplier**: a controlled way to turn an operator's topic/query
(e.g. *«займ под залог ПТС Москва»*) into a vetted list of candidate URLs to feed Workflow 04.
**Level 2** of this layer is *automated* discovery — `05 - Apify Search Candidate Discovery` runs an
Apify Google-Search actor against a query and writes scored, deduped candidates for human approval.
(A manual URL *list* is already handled by Workflow 04, so Workflow 05 is not "manual intake"; manual
entry survives only as an optional fallback input mode.)

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

| | URL Supplier — Workflow 05 (Stage 2.2, new) | URL Consumer — Workflow 04 (done) |
|---|---|---|
| Input | search topic/query (Apify) — or pasted URLs (fallback mode) | ≤5 approved URLs |
| Output | rows in `url_candidates` + a `discovery_requests` row | rows in 6 business tabs + `url_registry` |
| Cost | **Apify search call only** (0 Firecrawl / 0 Claude) | Firecrawl + Claude |
| Gate | human sets `approval_status=approved` | `url_registry` dedup + placeholder pre-filter |
| Built? | No (planning) | Yes (approved, ≤5 URLs) |

## 3. Safe staged rollout

1. **Stage 2.2 — Apify Search Candidate Discovery (Workflow 05, next build).** Given a query, an Apify
   Google-Search actor returns candidate URLs; the workflow normalizes, checks `url_registry`, scores and
   marks duplicates, writes `url_candidates` (`approval_status=new`/`duplicate`) and a `discovery_requests`
   row. **Apify search cost only — 0 Firecrawl / 0 Claude.** Manual URL entry is an optional fallback mode.
2. **Stage 2.2c — Approved Candidates Runner (Workflow 06, BUILT, under test — DEC-064).** The
   **approval-to-processing bridge**: `n8n/workflows/06_approved_candidates_runner.json` (active=false) reads
   `url_candidates`, filters `approval_status=approved AND dedup_status=unique AND registry_status=not_in_registry
   AND non-empty URL` (aggregators/directories/marketplaces/socials/media skipped unless the row's `notes`
   contains `aggregator_approved`), prioritizes `direct_competitor` → higher `confidence_score` → lower `rank`,
   **hard-caps at 5/run**, and emits a Workflow-04-shaped batch + Execution Summary + a ready-to-paste
   `Set URL List` block. **v0.1 = manual hand-off**: it does **not** call Workflow 04 as a subworkflow (WF04 keeps
   its Manual Trigger + fixed `Set URL List`; subworkflow conversion is a deferred, risky trigger refactor). A
   disabled `Mark Candidates Processed` node flips `approval_status` to `processed` (preserving
   `approved_by`/`approved_at`) only after the operator confirms `monitor_queue`. No Apify/Firecrawl/Claude/Telegram.
   Guide: `docs/N8N_WORKFLOW_06_APPROVED_CANDIDATES_RUNNER_RU.md`.
3. **Stage 2.3 — Telegram Control Bot.** Operator-facing interface (submit request → see candidates + cost →
   approve → launch). Not discovery itself; calls the workflows above, never duplicates their logic.

Each stage is gated: do not start the next until the previous one is approved.

## 4. Source options (A/B/C/D)

- **Option A — Manual URL Candidates.** Operator pastes URLs. Already covered by Workflow 04's manual list;
  survives only as an optional fallback input mode of Workflow 05. **Not the main next step.**
- **Option B — Search API / SERP actor (SELECTED for Level 2).** A search provider / **Apify Google Search
  Results Scraper** actor returns URLs+title+snippet from a query. Automated; carries cost + rate-limit risk;
  source evaluated before scale. **This is Workflow 05.**
- **Option C — Firecrawl `/v2/search`.** **Parked** — evaluation only; do not use yet. If ever tested, use
  for candidate discovery only, never as a combined search+scrape+analyze step.
- **Option D — Telegram Control Bot.** An *interface*, not a discovery source: lets the operator submit
  requests, approve URLs, and launch processing. Deferred until the candidate + approval flow exists.

## 5. Selected architecture — Level 2 Apify Search (Option B), then runner, then Telegram

**Decision (DEC-059, refines DEC-058):** Stage 2.2 is **Level 2 automated discovery via Apify** (Option B),
not manual intake. Manual lists are already Workflow 04's job, so Workflow 05 leads with the Apify Google
Search actor. Order: **Workflow 05 (Apify search) → Stage 2.2c Approved Candidates Runner → Telegram
(interface)**. Manual entry stays as an optional Workflow 05 input mode; Option C (Firecrawl `/v2/search`)
stays parked.

- **Primary API: Apify** with the **Google Search Results Scraper** actor. Apify is already in the planned
  stack for future Avito/social/classified actors, and Apify actors suit search-result candidate discovery.
  **Firecrawl stays the content-extraction layer for known approved URLs** (Workflow 04), not for discovery.
- **Fallbacks (later, not now):** Google Custom Search JSON API (low-cost), SerpAPI (paid, stable). Firecrawl
  `/v2/search` parked.
- **B reuses the shared spine:** the *same* `url_candidates` sheet, the Workflow 04 normalizer, `url_registry`
  dedup, and the human approval gate. Only the candidate *source* differs.
- **Runner (2.2c)** is hand-off only — approved candidates → Workflow 04 in batches of 5; no new analysis.
- **D (Telegram) is interface-only:** submits discovery requests, shows candidates + cost, asks approval,
  triggers the existing workflows; **no scraping/analysis, no duplicated logic.**

**Credential (create later in n8n — never put a token in any file):** `Apify API - Marketing Scout`, Header
Auth, header `Authorization` = `Bearer <APIFY_API_TOKEN>`, allowed domain `api.apify.com`.

**Why Firecrawl `/v2/search` (C) is parked:** it bundles search + scrape in one provider, coupling discovery
cost/quality to the scraping vendor and tempting a single search→scrape→analyze step. We keep discovery,
approval, and processing as **separate, independently testable** stages.

**Why Telegram is interface, not core logic:** putting discovery/scraping/analysis inside the bot would
duplicate Workflow 04/05 logic, hide cost, and remove the human gate. The bot calls the workflows and relays
results, so core logic stays in one place and remains usable without Telegram.

**Default volumes:** a discovery request **collects up to 10 candidates** (`requested_limit=10`). Workflow 04
still **processes max 5 URLs per run**, so 10 approved candidates are processed as **two controlled batches
of 5**. **No candidate reaches Firecrawl/Claude until `approval_status=approved`.**

## 5c. Candidate types & source diversity (DEC-061)

Web search returns a **mix** of source types, not just competitors. Workflow 05 tags each candidate with a
deterministic `candidate_type`: `direct_competitor`, `aggregator`, `directory`, `media_article`,
`marketplace`, `social`, `unknown`. This matters because:

- **Web search is mostly competitor + content discovery.** Direct competitor sites (autolombards, MFOs,
  brokers) and content/FAQ/market pages dominate organic results for a query like «займ под залог ПТС Москва».
  Direct competitors are prioritized for approval and rank highest in `confidence_score`.
- **Aggregators/directories/media are optional intelligence, not competitors.** banki.ru, 2gis, kp.ru etc.
  can surface *new* competitor names to chase manually, but they are not themselves targets — lower confidence,
  flagged "review manually". Never auto-treated as a direct competitor.
- **Hot lead discovery needs other connectors.** Real lead signals (people asking for a loan, client pain)
  live on **Telegram / Avito / social / classified** sources, not Google web search. Those require future
  lead-source connectors (§5b), feeding the same source-agnostic analyzers. Do not expect web search to
  produce hot leads.

## 5b. Source connectors vs core analyzers

Do **not** over-split agents by platform name (one per Avito/VK/Instagram). Instead, separate **source
connectors** (acquire raw records/URLs) from **core analyzers** (classify content), so a website, a
classified, and a social post all flow into the same analyzers:

- **Source connectors:** *Web Search Connector* (Workflow 05 / Apify search — discovery), *Website Scrape
  Connector* (Workflow 04 / Firecrawl), *Classifieds Connector* (future, Apify), *Social Connector* (future, Apify).
- **Core analyzers:** *Market Record Analyzer*, *Lead Signal Analyzer*, *Content Insight Analyzer*,
  *Report/Summary Agent* — these classify a record as **competitor / lead_signal / content_idea /
  market_signal / irrelevant independent of source** (today this is the Workflow 04 Claude analyzer + routing).

**Source ≠ meaning.** Websites yield competitor intelligence, offers/conditions, SEO/content ideas, FAQs and
pain points; social/classified sources are stronger for lead signals and client pain but also show competitor
activity. New platforms add a *connector*, not a new analyzer; analyzers stay source-agnostic.

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

- **G1 — Schema approval.** Operator approves the `discovery_requests` (18-col) + `url_candidates` (25-col) schemas and the status/value sets.
- **G2 — Apify source + credential ready.** Apify API token obtained and the `Apify API - Marketing Scout` Header Auth credential created in n8n; actor evaluated for quality, ToS, cost, and rate limits.
- **G3 — Discovery validated.** Workflow 05 returns ≤10 candidates, normalizes + dedups + scores correctly, writes `url_candidates` + `discovery_requests`, at **0 Firecrawl / 0 Claude**.
- **G4 — Approval flow proven.** A human can move `new → approved` and only approved URLs reach Workflow 04 (≤5/run).
- **G5 — Cost ceiling agreed.** Per-request Apify cost and per-run processing ceilings are set before scaling or before the Telegram bot.

Telegram Control Bot is deferred until G1–G4 are passed (discovery + approval flow exists).

## 6a. Future Telegram Control Bot flow (deferred)

1. operator sends request text (e.g. «найди конкурентов по займам под ПТС в Москве»);
2. bot creates a `discovery_requests` row (`requested_by=telegram_operator`);
3. **Workflow 05** collects candidates into `url_candidates`;
4. bot shows the candidate list + estimated cost;
5. operator approves (sets `approval_status=approved`);
6. approved candidates are processed by **Workflow 04** (via the Approved Candidates Runner / manual);
7. bot returns a summary.

The bot orchestrates and reports only — it **must not** duplicate scraping or analyzer logic.

---

## See also
- `docs/WORKFLOW_05_URL_DISCOVERY_PLAN.md` — the Apify Search Candidate Discovery plan + schemas.
- `docs/WORKFLOW_04_FIRECRAWL_URL_LIST_PLAN.md` — the URL consumer (approved).

---

## Stage 2 final hardening note (2026-06-07, DEC-070/071/072)

The discovery → approval → consume chain (05 → 06 → 04) is **modular and stays modular** (not a monolith,
DEC-071). Workflow 06 now exposes two **runner modes** (Set Runner Config → `runner_mode`):
`first_pass_domain_diversity` (DEFAULT — one URL per domain per run, for breadth) and `deep_domain_analysis`
(EXPLICIT — up to 3 URLs/domain/run, for depth). `url_registry` dedup stays **URL-level** (full normalized
URL) in both modes; domain diversity is a per-run *selection* rule only. Workflow 04 hardened: stronger PTS
`service_type` override + deterministic `contact_public` extraction. Full pre-approval review +
test matrix: `docs/STAGE_2_WEB_PIPELINE_REVIEW.md`.
