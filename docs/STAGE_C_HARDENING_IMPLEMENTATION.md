# Stage C Hardening — Implementation

Production-hardening patch over the Marketing Scout Agent. **No live external calls; $0.** All workflows remain
`active=false`. The systemic fix is a shared, versioned semantic engine + canonical taxonomy + a run-level
quality gate (WF16), not a set of local keyword crutches.

## New / shared components

| Path | Purpose |
|---|---|
| `config/taxonomy.json` | Canonical `semantic-v2` taxonomy — single source of truth (record/entity/activity/service enums, aliases, route map, confidence caps, quality flags). |
| `n8n/lib/semantic_core.js` | Shared semantic engine: taxonomy normalization, Stage A pre-gate (system-event/placeholder/search-card/evidence completeness), owned-media/affiliate/direct-offer/negation detectors, explainable confidence, Stage D validator, deterministic route mapper, `classifyOffline()` (free offline/fixture classifier = LLM fallback). |
| `n8n/lib/quality_gate.js` | WF16 run-health scoring engine (`computeRunHealth`). |
| `n8n/workflows/16_source_quality_gate_health_score.json` | WF16 — full, importable, no external API. |
| `scripts/validate_workflows.py` | Offline workflow validator + secret-leak scanner + taxonomy consistency. |
| `tests/` | Offline regression harness (`make test`). |

n8n Code nodes cannot `require()` local files, so the workflow nodes **embed mirrors** of the engine functions;
`tests/wf_harness.js` runs the **real** node `jsCode` and asserts equivalence with the tested library
(`tests/test_wf16_node.js` proves WF16's embedded scoring is byte-equal to `quality_gate.js`).

## Architecture decisions

### WF08 — `llm_primary`

WF08 now **declares** `analysis_mode: 'llm_primary'`: Claude is the **primary semantic classifier** for
substantive live records and may **override** WF09/WF11 hints from post evidence. The Claude request
(`Build Primary Claude Request`) sends three explicitly separated blocks — `POST_EVIDENCE`, `SOURCE_METADATA`,
`UPSTREAM_HINTS` (labelled *weak priors only*) — canonical `ALLOWED_ENUMS`, and the strict `semantic-v2`
`OUTPUT_SCHEMA`. The prompt forbids inferring an offer from a channel title/search query alone, marks
quoted/negated scam claims, and caps confidence by evidence (placeholder ≤20, missing description ≤45,
metadata-only ≤30). **Deterministic logic is retained only** as: Stage A pre-gate (system-event hard-skip,
dedup, hard-negative, freshness, evidence completeness), the route mapper (code maps `record_type → queue`; the
model never names a sheet), the fallback after LLM failure, and the free fixture/offline classifier.

The runtime LLM gate (`llm_enabled`) stays **false** by default (master kill switch, DEC-119) because live
Claude requires operator approval; when enabled it runs the `llm_primary` contract. The offline deterministic
classifier (`semantic_core.classifyOffline`) is evidence-based and taxonomy-correct, so the system produces
correct `semantic-v2` rows even before Claude is switched on. Telegram **system events are hard-skipped to
`skipped_log` before any Claude call** ($0), and service is never derived from a changed channel title.

### `semantic-v2` Claude schema

```json
{ "schema_version":"semantic-v2", "record_type":"competitor_activity", "entity_type":"competitor",
  "activity_subtype":"direct_offer", "competitor_related":true, "competitor_name":"…",
  "service_primary":"pts_loan", "service_secondary":["auto_lease_refinance"],
  "market_signal_subtype":null, "content_topics":[], "pain_tags":[], "offer_text":"…",
  "offer_terms":{"amount_min":null,"amount_max":15000000,"currency":"RUB","price_text":null,"rate_text":null,
                 "speed_text":"same day","conditions":[],"documents_not_required":["income_certificate"]},
  "cta":{"type":"channel_message","text":"…"}, "quoted_claims":[], "negated_claims":[],
  "hard_skip":false, "skip_reason":null, "confidence_score":90, "confidence_reasons":[…],
  "semantic_flags":[], "evidence":[{"field":"offer_terms.amount_max","quote":"До 15 000 000 ₽","source":"post_text"}] }
```

### Route mapper

Deterministic `record_type → physical queue` (see `docs/SEMANTIC_TAXONOMY.md`). The model returns a semantic
class; code assigns the route. A contact-safety override demotes the lead `results` route to `review_queue`
when there is no usable public contact.

### WF16 quality gate

Run-level + source-level health (`docs/SOURCE_QUALITY_GATE.md`). Gates WF10/WF12: fixture/manual_test/
quarantined/no-data runs are never report-eligible; degraded runs are excluded unless explicitly opted in (with
a visible warning).

### Avito detail strategy (WF09)

An Apify `isDetail=false` card or an `Ещё N фото` placeholder is **search discovery, not a listing**:
`record_type=source_candidate`, `detail_fetch_required=true`, `llm_eligible=false`, `report_eligible=false`,
`quality_status=degraded`, and **no fabricated** `Оффер конкурента: Ещё4 фото`. `search_query` (human phrase)
and `source_search_url` (encoded URL) are separated — the encoded URL never lands in `interest_topic`/
`probable_need`/`semantic_keywords`/offer text. The paid live path is staged/disabled; a real detail-enrichment
transport requires operator approval (no live call in this patch).

### Paid-path safety (WF09)

`LIVE Apify Safety Gate` blocks the paid actor unless **all** of: `fixture_mode=false`, `live_mode=true`,
`approval_token === expected_approval_token`, `live_max_items > 0`, `max_budget_usd > 0`. The token **value is
never logged or propagated** — only `approval_token_used=yes/no`. If `live_mode=false`, no Apify call can
happen.

### WF11 Telegram semantics

System-event gate (rename/photo/pin → `system_event`, hard-skip, `skipped_log`); affiliate/referral programs →
`competitor_activity` + `activity_subtype=affiliate_program`; direct offers override broad market keywords;
owned-media expertise funnels → `educational_offer`/`owned_media_content`; negation/quotation captured as
`quoted_claims` (a quoted scam is never an author offer); per-post freshness (`age_days`, `freshness_bucket`,
`within_default_window`); `data_mode` + `report_eligible`/`llm_eligible`.

### Report eligibility & pending review (§2.4, §13)

`data_mode ∈ {live, fixture, manual_test}` on every record. Fixture/manual_test default `report_eligible=false`.
A `review_status=pending` / `deterministic_uncertain_no_llm` record stays `entity_type=unknown` +
`candidate_entity_type` + `report_eligible=false` and must not be treated as a market fact.

## Files changed

See `git diff --stat` and the final report. Workflow JSON patched: WF08, WF09, WF11. New: WF16,
`config/taxonomy.json`, `n8n/lib/*`, `scripts/validate_workflows.py`, `tests/*`, this doc set.

## What is NOT done in this patch (honest scope)

- No live Claude/Apify/Firecrawl/VK calls were made; the `llm_primary` prompt is validated by structure, not by
  a live Claude response (operator runs the controlled batch — see retest checklist).
- WF10/WF12 report-builder cosmetic items are addressed systemically via WF16 gating + the taxonomy; remaining
  localized formatting items are tracked in the defect register with explicit status.
- The Avito detail-enrichment transport is staged/disabled pending approval.
