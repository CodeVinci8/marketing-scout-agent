# Stage F — Evidence-Bound LLM Analysis (Claude Analyst)

> **Status:** CONTRACT ONLY — Stage F is **NOT implemented** and **NOT authorized to start**.
> This document is the canonical input/output/failure contract the future Stage-F build must satisfy.
> Until Stage F is explicitly approved, every LLM flag stays `false` and no call to Claude / `aiprimetech.io`
> is made. All current reports are 100% deterministic (Stage A–E).

Related: [`DISCOVERY_LLM_ENRICHMENT_STAGE_F.md`](DISCOVERY_LLM_ENRICHMENT_STAGE_F.md) (discovery-side LLM enrichment flag,
already gated OFF), [`STAGE_E_PERSISTENCE_CONTRACT_MAP.md`](STAGE_E_PERSISTENCE_CONTRACT_MAP.md),
[`SOURCE_LINEAGE_CONTRACT.md`](SOURCE_LINEAGE_CONTRACT.md), [`CONTACT_AND_OUTREACH_POLICY.md`](CONTACT_AND_OUTREACH_POLICY.md).

## 0. Purpose and boundary

Stage F adds **one** capability on top of the deterministic pipeline: turn an already-collected, already-scored,
already-persisted **evidence package** into a structured, Russian, stakeholder-grade competitive analysis using
Claude — **without inventing facts**. Claude is an *interpreter of evidence we already hold*, never a collector and
never a source of new "facts".

Hard invariants (inherited from `core/rules.md` + CLAUDE.md, restated so Stage F cannot weaken them):

- **Deterministic-first.** The deterministic report (Stage A–E) is always produced first and is complete on its own.
  Claude output is an *enrichment layer* rendered in a clearly separated section. If Claude is disabled, over
  budget, errors, or returns invalid JSON, the user still gets the full deterministic report.
- **No invented facts.** Every Claude assertion must cite one or more `evidence_id`s that exist in the input
  package. An assertion with no evidence reference is dropped by the parser.
- **Facts vs inference vs recommendation are separated** in both the prompt and the output schema.
- **Budget-gated.** A per-run hard cost cap is computed before the call (see [`STAGE_F_COST`](#5-costtoken-accounting)).
  If the estimate exceeds the cap, the call never happens.
- **Russian user-facing output.** All stakeholder text is Russian; internal ids/enums never surface.
- **No new collection, no outreach.** Stage F reads persisted evidence only; it proposes actions but never executes
  external mutations without the existing approval gate.
- **Single approved model + endpoint.** `claude-sonnet` via the project endpoint, behind
  `MS_ENABLE_CLAUDE=true` + `MS_CLAUDE_API_KEY` + an explicit per-report approval token.

## 1. Input evidence package (WF20/WF21 → Stage-F node)

The Stage-F node receives ONE JSON object assembled from persisted Stage-D/E rows. It is **self-contained** — the
LLM sees only this object, never the raw web. For each collected source (website / Telegram channel / VK community):

```jsonc
{
  "request": {
    "agent_request_id": "req_...",           // lineage root
    "owner_user_id": "...", "chat_id": "...",
    "niche_id": "credit_brokerage", "region": "Москва/МО",
    "requested_sources": [ {"kind":"website","ref":"autolombardn1.ru"} ],  // what the USER asked for (scope)
    "data_mode": "live", "collected_at": "2026-07-14T11:00:00+03:00",
    "time_window_days": 30
  },
  "sources": [
    {
      "source_id": "autolombardn1.ru",
      "kind": "website",                      // website | telegram | vk
      "source_run_id": "firecrawl_20260714_120000",
      "collection_time": "2026-07-14T11:00:00+03:00",
      "current_run_scope": true,              // true = collected THIS request; false = historical context
      "quality_status": "healthy",            // healthy | degraded | quarantined
      "deterministic_scores": { "confidence": 45, "relevance": 70 },
      "normalized_facts": {                   // deterministic extraction — the ground truth Claude may interpret
        "company_name": "Автоломбард №1",
        "positioning": "...", "offer_summary": "...", "prices_terms": "...",
        "guarantees": "...", "cta_text": "...", "service_types": ["pts_loan","auto_pawn"],
        "page_type": "landing"
      },
      "evidence": [                           // atomic, id-addressable evidence items
        { "evidence_id": "ev_autolombardn1_offer_1",
          "evidence_url": "https://autolombardn1.ru/",
          "excerpt": "Займы под залог автомобилей, ПТС... до 90% стоимости залога",
          "field": "offer" }
      ],
      "known_limitations": ["prices behind a form","single page scraped"]
    }
  ],
  "historical_context": [                     // NEVER mixed into current findings; separated by contract (B1)
    { "source_id": "mkbkfin.ru", "kind": "website", "last_checked": "2026-07-01", "note": "saved snapshot, not this run" }
  ],
  "deterministic_report_ref": { "report_id": "report_...", "report_bundle": { /* the Stage-E bundle */ } }
}
```

Contract rules for the package:
- `current_run_scope` distinguishes **current facts** from **historical context** — Stage F must keep them apart in
  the output exactly as the deterministic report does (see B1 single-source scoping).
- Every `evidence[].evidence_id` is unique within the package and is the ONLY thing Claude may cite.
- `normalized_facts` is authoritative; Claude may summarize/interpret but must not contradict a normalized fact
  without flagging it as `unknowns`/`risks`.
- No private/contact data enters the package (redaction happens upstream, unchanged).

## 2. Structured Claude output (strict JSON)

Claude MUST return exactly this shape (no prose outside JSON). Every insight array element carries
`supporting_evidence_ids` (≥1) and an explicit `type`:

```jsonc
{
  "competitor_summary": "…",                  // 1–3 sentences, Russian
  "positioning": { "text": "…", "supporting_evidence_ids": ["ev_..."] },
  "products_services": [ { "name":"…", "supporting_evidence_ids":["ev_..."] } ],
  "offers":            [ { "text":"…", "supporting_evidence_ids":["ev_..."] } ],
  "prices":            [ { "text":"…", "supporting_evidence_ids":["ev_..."] } ],
  "cta":               [ { "text":"…", "supporting_evidence_ids":["ev_..."] } ],
  "target_audience":   [ { "text":"…", "type":"inference", "supporting_evidence_ids":["ev_..."] } ],
  "pains":             [ { "text":"…", "type":"inference", "supporting_evidence_ids":["ev_..."] } ],
  "objections":        [ { "text":"…", "type":"inference", "supporting_evidence_ids":["ev_..."] } ],
  "advertising_angles":[ { "text":"…", "type":"inference", "supporting_evidence_ids":["ev_..."] } ],
  "content_angles":    [ { "text":"…", "type":"recommendation", "supporting_evidence_ids":["ev_..."] } ],
  "strengths":         [ { "text":"…", "supporting_evidence_ids":["ev_..."] } ],
  "weaknesses":        [ { "text":"…", "supporting_evidence_ids":["ev_..."] } ],
  "touchpoints":       [ { "text":"…", "supporting_evidence_ids":["ev_..."] } ],
  "market_gaps":       [ { "text":"…", "type":"inference", "supporting_evidence_ids":["ev_..."] } ],
  "risks":             [ { "text":"…" } ],
  "recommended_actions":[ { "text":"…", "type":"recommendation", "priority":"high|medium|low",
                            "supporting_evidence_ids":["ev_..."] } ],
  "confidence": 0.0,                          // 0..1 self-assessed on the evidence
  "supporting_evidence_ids": ["ev_..."],      // global set actually used
  "unknowns": ["prices not extractable from the page"]
}
```

Every element is tagged `type ∈ {fact, inference, recommendation}` (default `fact` when omitted for
offer/price/CTA that quote evidence). The renderer groups them into three visually separated report zones:
**Факты → Выводы → Рекомендации**. An element whose `supporting_evidence_ids` do not all resolve in the package is
**dropped** (never rendered).

## 3. Prompt construction

- System prompt fixes the role ("аналитик-исследователь конкурентов", Russian output, evidence-bound, no
  invention, strict JSON only) and restates the fact/inference/recommendation separation.
- User prompt = the evidence package (section 1), hard-capped at `MS_LLM_MAX_INPUT_CHARS` (budget guard). If the
  package exceeds the cap, sources are dropped **lowest-quality-first** and the omission is recorded in `unknowns`.
- `max_tokens` is capped; `temperature` low (≤0.3) for determinism.
- The historical_context block is included but explicitly labeled "контекст, не результат текущего сбора" so Claude
  cannot fold it into current findings.

## 4. Repair / failure policy (fail closed)

1. **Strict parse.** Response must be a single JSON object matching section 2. Extra prose → parse the first
   balanced JSON object; if none → repair path.
2. **One bounded repair attempt.** On invalid JSON or a schema violation, send exactly ONE repair message
   ("верни строго валидный JSON по схеме, без пояснений"). No more than one repair round-trip (cost-bounded).
3. **Fail closed.** If the repair still fails, OR any hard invariant is violated (invented evidence id, non-Russian,
   over budget), Stage F is **skipped**: `llm_status = failed_fell_back`, the deterministic report is delivered
   unchanged, and the failure reason is logged to `execution_summaries` (never shown raw to the user).
4. **No invented facts.** Post-parse validation drops any insight citing an unknown `evidence_id`; if that empties a
   required section, the section renders "ИИ-анализ недоступен для этого раздела".
5. **Provider error containment.** HTTP/network/timeout/5xx from the provider → same fail-closed path; the run is
   still `completed` (deterministic), annotated `llm_status = provider_error`.
6. **Cost/token accounting** persisted regardless of success (section 5).

## 5. Cost/token accounting

Before the call, compute a deterministic estimate (mirrors [`STAGE_F_COST` in the cost model](../n8n/lib/cost_model.js)):

```
est_input_tokens  ≈ ceil(input_chars / 4) + fixed_prompt_tokens
est_output_tokens ≈ min(max_tokens, expected_output_tokens)
est_cost_usd      = est_input_tokens/1e6 * input_price + est_output_tokens/1e6 * output_price
hard_cap_usd      = MS_LLM_BUDGET_USD (default small; per-report)
```

If `est_cost_usd > hard_cap_usd` → skip (no call). After the call, persist to `report_bundles` /
`execution_summaries`: `llm_status`, `llm_model`, `llm_input_tokens`, `llm_output_tokens`, `llm_cost_usd`,
`llm_estimated_cost_usd`, `llm_cost_delta` (actual − estimate), `llm_repair_used`.

## 6. Contextual analyst agent (how the future agent uses Stage F)

The Stage-F analyst answers ordinary follow-ups conversationally (no rigid commands) grounded in what is already
stored — it does **not** re-collect on every question:

| Context source | Use |
|---|---|
| latest report (`market_intelligence_reports`) | default subject of a follow-up ("а какие у них слабые места?") |
| stored `report_bundles` | structured facts/evidence to quote |
| selected competitors | narrow the analysis to one competitor on request |
| conversation memory (bounded) | resolve "они", "этот", "прошлый отчёт" |
| user preferences (`agent_config`) | region/niche defaults, LLM on/off |
| `tracked_sources` | "что нового у отслеживаемых?" → monitoring, not fresh scrape |
| `public_lead_signals` | aggregate lead answers (never contacts) |
| evidence retrieval tool | fetch an `evidence_id`'s excerpt+url to justify an answer |
| approval-gated actions | any NEW collection / source change / export is a tool call behind the existing gate |

Rules: the agent may **answer** freely from stored evidence; it may **act** (collect, add/remove source, export,
deep-dive) **only** via an explicit, approval-gated tool call. No autonomous outreach, ever.

## 7. Acceptance for Stage F (when it is eventually built)

- Deterministic report unchanged when LLM disabled (regression parity test).
- Valid-JSON happy path renders Факты/Выводы/Рекомендации with resolvable evidence ids.
- Invalid JSON → exactly one repair → still invalid → deterministic fallback, run `completed`, `llm_status`
  recorded (fail-closed test).
- Invented `evidence_id` dropped (no-invention test).
- Over-budget estimate → no call (budget test).
- Non-Russian output → rejected (language guard, extends `test_llm_ru_guard.js`).
- Cost/token/delta persisted on both success and failure.
- Live acceptance: one real bounded website analysis end-to-end with a real (small) Claude cost, evidence ids all
  resolvable, honest cost delta.

**Do not start Stage F without explicit operator approval.**
