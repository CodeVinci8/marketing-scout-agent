# STAGE_2_WEB_PIPELINE_REVIEW.md — Stage 2 Web Competitor Pipeline (Pre-Approval Technical Review)

**Status:** 🔎 REVIEW for final Stage 2 approval. Date: 2026-06-07.
**Scope:** the manual, human-approval-gated **web competitor discovery** pipeline (Workflows 05 → 06 → 04).
**Verdict:** ready for **final retest → commit → Stage 3.0**. See §8 test matrix and §9 recommendation.

---

## 1. Current architecture

```
Operator query
   │
   ▼
Workflow 05 — Apify Search Candidate Discovery
   │  writes url_candidates (26 cols) + discovery_requests (18 cols); 0 Firecrawl / 0 Claude
   ▼
url_candidates  ──►  HUMAN APPROVAL (operator sets approval_status=approved)  [SPEND GATE]
   │
   ▼
Workflow 06 — Approved Candidates Runner
   │  re-reads url_registry, re-normalizes, applies runner_mode + priority + max 5
   │  emits a ready-to-paste Set URL List block (≤5 URLs)
   ▼  MANUAL HANDOFF (operator pastes URLs into Workflow 04)
Workflow 04 — Firecrawl URL List Resilient Analyzer
   │  per-URL: url_registry dedup → Firecrawl → Claude (+repair/fallback) → route
   ▼
monitor_queue / skipped_log / technical_errors  (+ url_registry row per processed URL)
```

All three workflows are `active=false` and run manually. The chain is **modular** (see §5).

---

## 2. What each workflow does

### Workflow 05 — Apify Search Candidate Discovery (URL **supplier**)
- Query → Apify Google Search actor (sync endpoint) → normalize → **read `url_registry`** → classify
  `candidate_type` → deterministic competitor-first `confidence_score` → write **`url_candidates` (26 fields)**
  and one **`discovery_requests` (18 fields)** row.
- **No Firecrawl, no Claude.** Only cost is the Apify search call. No business-tab writes. No auto-processing.
- Marks registry duplicates (`dedup_status=duplicate_in_registry`, `approval_status=duplicate`).

### Workflow 06 — Approved Candidates Runner (approval **bridge**)
- Reads `url_candidates`, **re-reads `url_registry` at runtime**, re-normalizes each `candidate_url` (same
  rules as 04/05), and selects only `approval_status=approved` + non-empty URL + **URL not in `url_registry`**.
- Editable `dedup_status`/`registry_status` are **advisory only** (ignored for the decision).
- Priority: `direct_competitor` → `confidence_score` desc → `rank` asc → root-page-first.
- **runner_mode** (see §6) controls per-domain selection. Hard cap **max_per_run=5**.
- Emits an Execution Summary + a ready-to-paste `Set URL List` block. **No Apify/Firecrawl/Claude/Telegram.**

### Workflow 04 — Firecrawl URL List Resilient Analyzer (URL **consumer**)
- Manual list ≤5 URLs. Per URL: normalize → **`url_registry` dedup before any spend** → Firecrawl scrape →
  resilient Claude analyze (primary → repair → deterministic competitor fallback) → normalize → route to one
  of six business tabs → append a 10-field `url_registry` row.
- **35-field business schema** on all six tabs. Duplicate URL → `skipped_log`/`dedup_source_url`, **0 cost**.
- Output hardening: language guard, placeholder pre-filter, **stronger PTS `service_type` override**, and
  **contact extraction/sanitation** (see §3 below / DEC-070).

---

## 3. Hardening applied this pass (DEC-070)

- **Workflow 06 runner modes** — explicit `first_pass_domain_diversity` (default) vs `deep_domain_analysis`
  (§6).
- **Workflow 04 stronger PTS override** — competitor + ≥3 of the strong PTS/autolombard tokens (ПТС, ЭПТС,
  под ПТС, залог ПТС, займ под залог ПТС, автоломбард, залог авто, залог автомобиля, автомобиль остаётся,
  машина остаётся, без проверки КИ, любая кредитная история) ⇒ `service_type=pts_loan`, unless multi-product
  root or clearly real-estate-only.
- **Workflow 04 contact extraction/sanitation** — deterministic extraction of RU phone (10–11 digits,
  +7/7/8/8-800), email, Telegram (`@handle`/`t.me/`), WhatsApp (`wa.me/`), and contact/profile/application
  URLs (excluding the page `source_url`). Valid full contacts are kept; partial/hallucinated values
  (`"+7 (495) ..."`, `"номер указан на сайте"`, `"требуется извлечение"`, `"телефон есть на сайте"`) are
  blanked. Deterministic extraction is preferred over a model partial; phones inside `wa.me/<digits>` are not
  misread as separate numbers.

---

## 4. What is approved vs what remains manual

**Approved (this pass, pending final retest):**
- Workflow 05 as the **web search candidate discovery** connector (human approval before any spend).
- Workflow 04 as the **URL consumer** (manual ≤5 URLs), with PTS + contact hardening.
- `url_registry` URL-level dedup (full normalized URL, **not** domain).

**Deliberately manual in v0.1 (by design, not a gap):**
- **Approval** — operator sets `approval_status=approved` in `url_candidates`. This is the spend gate.
- **Workflow 06 → Workflow 04 handoff** — operator pastes the `Set URL List` block into Workflow 04 and runs
  it. Workflow 06 does **not** call Workflow 04 as a subworkflow (WF04 keeps its Manual Trigger; subworkflow
  conversion is a risky trigger/input refactor, deferred).
- **Marking candidates processed** — after the operator confirms `monitor_queue` output, they enable the
  disabled `Mark Candidates Processed` node (or set `approval_status=processed` manually). No auto-marking.

---

## 5. Why the workflows are NOT merged into one monolith

- **Separation of concerns / auditability:** discovery (05), approval+selection (06), and analysis (04) each
  have a single responsibility and a clear, inspectable boundary (sheets between stages). A monolith would be
  far harder to test, debug, and reason about.
- **Spend safety:** the human-approval gate sits **between** 05 and 06; collapsing the stages would make it
  easy to accidentally remove the gate and spend on unapproved URLs.
- **Independent failure & reuse:** Workflow 04 is a proven, standalone consumer reused by manual lists and by
  the discovery chain; the resilient analyzer is shared. Merging would couple unrelated failure modes.
- **Incremental change:** each workflow can be patched and re-imported without destabilizing the others (as
  this hardening pass demonstrates).
- **Future fit:** the upcoming Lead Discovery Layer adds **peer** workflows of the same shape (connector →
  approval → analyzer); a monolith would not generalize. **Decision: keep modular (DEC-067/071).**

---

## 6. Workflow 06 runner modes

Configured in the **Set Runner Config** node (`runner_mode`). Default = `first_pass_domain_diversity`.
Both modes always keep: `max_per_run=5`, `url_registry` runtime recheck, exact normalized-URL dedup,
manual handoff, no auto-call, no auto-mark-processed, and the priority order
(`direct_competitor` → confidence desc → rank asc → root-first). **`url_registry` semantics are unchanged**
(full normalized URL, never domain-based) in both modes.

| Mode | Per-domain rule | Extra same-domain URLs | Selected-item warning |
|------|-----------------|------------------------|-----------------------|
| `first_pass_domain_diversity` (DEFAULT) | **max 1** URL per normalized domain per run | skipped, `reason_category=duplicate_domain_in_run`, reason "Same domain already selected in this run; use deep_domain_analysis mode for multi-page domain analysis." | — |
| `deep_domain_analysis` (EXPLICIT) | **max 3** URLs per domain per run | beyond 3 skipped, `reason_category=domain_deep_limit` | `warning="deep_domain_analysis mode: multiple URLs from same domain allowed intentionally."` |

**Rationale:** a first pass should survey **diverse** competitors (one page per domain); deep multi-page
analysis of a single competitor is sometimes useful but must be **opt-in**, never the default
(DEC-070/072). Summary output adds `runner_mode`, `domain_diversity`, and `domain_selected_counts`.

---

## 7. Known limitations (acceptable for Stage 2; tracked)

- **No auto-call of Workflow 04 yet** — handoff is a manual paste (v0.1). Subworkflow conversion deferred.
- **No Telegram Control Bot yet** — control interface is a later stage (Stage 4); it is a controller, not a
  parser.
- **No lead-source connectors yet** — Avito/Telegram/VK/Instagram/Yandex are design-only (Stage 3.x).
- **No universal `market_profile` yet** — the analyzer routes to the six business tabs; a unified
  cross-source market/lead profile schema is part of the future Lead Discovery Layer, not Stage 2.
- **Dedup is URL-level** — correct for the web pipeline; social/classified leads will need the separate
  non-URL `market_record_registry` (designed, not built).

---

## 8. Test matrix for final Stage 2 approval

All tests are manual, `active=false`, human-approved, bounded (≤5 URLs/run). Record Apify run cost, Firecrawl
credits, and Claude balance deltas where applicable.

| # | Workflow | Scenario | Expected result |
|---|----------|----------|-----------------|
| T1 | 05 | Query «автоломбард Москва займ под ПТС без проверки кредитной истории» | `url_candidates` rows (26 cols) with `candidate_type`, `domain`, competitor-first scores; one `discovery_requests` row (18 cols); registry duplicates marked; **0 Firecrawl/0 Claude**; no business-tab writes |
| T2 | 06 (first_pass) | Approve the 4 E2E URLs incl. **both** `autolombard-moskva.ru` URLs | **3 selected** (one per domain: `autolombard-moskva.ru` root, `zalog24h.ru`, `autolombardn1.ru`); 2nd `autolombard-moskva.ru` → `skipped` `duplicate_domain_in_run`; `max_per_run=5`; `registry_recheck=enabled`; `manual_handoff_to_workflow_04` |
| T3 | 06 (deep_domain_analysis) | Same approvals, `runner_mode=deep_domain_analysis` | **4 selected** (both `autolombard-moskva.ru` URLs allowed, domain count 2 ≤ 3); each selected item carries the deep-mode `warning`; a hypothetical 4th same-domain URL → `domain_deep_limit` |
| T4 | 06 | Approved URL already present in `url_registry` (operator marked `unique` by hand) | skipped `registry_recheck_duplicate` — editable dedup fields ignored |
| T5 | 04 | `autolombardn1.ru/` (root) | `monitor_queue`, competitor, **`service_type=pts_loan`**, valid `contact_public` kept (e.g. `+7 495 740-01-01, https://t.me/autolombardvip, https://wa.me/79857375386`), `parsed_success` |
| T6 | 04 | `autolombard-moskva.ru/services/.../dmitrovskoe-shosse/` | `monitor_queue`, competitor, **`service_type=pts_loan`** |
| T7 | 04 | `mosinvestfinans.ru/` (multi-product root) | `monitor_queue`, **`service_type=generic_lending`** preserved |
| T8 | 04 | lioncredit real-estate page (`.../kredit-pod-zalog-nedvizhimosti`) | **`service_type=secured_real_estate_loan`** preserved |
| T9 | 04 | A page whose model contact is partial (`"+7 (495) ..."` / `"номер указан на сайте"`) | `contact_public` **blanked** (or replaced by a deterministic contact extracted from text) — never a partial |
| T10 | 04 | Re-run any already-processed URL | `skipped_log`/`dedup_source_url`, **0 Firecrawl/0 Claude** (url_registry dedup) |
| T11 | all | Field-count guard | WF04 = 35 business fields + 10 `url_registry` fields; WF05 = 26 `url_candidates` + 18 `discovery_requests` |

---

## 9. Recommendation

1. Re-import WF04 + WF05 + WF06 (all `active=false`); rebind Google Sheets / Apify credentials + real
   Spreadsheet ID (placeholders only in repo).
2. Run the **T1–T11** matrix above; record costs.
3. On green, **commit the Stage 2 web pipeline** and mark Stage 2 approved/closed.
4. Move to **Stage 3.0 — Lead Source Evaluation** (Avito vs Telegram vs VK), design-only, before building any
   connector. Keep the pipeline modular; do not merge into a monolith.
