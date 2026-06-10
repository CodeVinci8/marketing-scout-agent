# STAGE_3_3_TEST_RESULTS.md — Avito/Classifieds Listing Connector Test Results

**Workflow:** `n8n/workflows/09_avito_classifieds_listing_connector.json` (`09 - Avito Classifieds Listing Connector`, `active=false`)
**Stage:** 3.3 · **Related:** `docs/STAGE_3_3_AVITO_CLASSIFIEDS_CONNECTOR_PLAN.md`, `docs/N8N_WORKFLOW_09_AVITO_CLASSIFIEDS_CONNECTOR_RU.md`, DEC-090, DEC-092.

> Templates below are filled by the operator after each run. Logic was **simulation-verified** at build time
> (see "Build-time simulation" notes); live Google Sheets writes still need an operator run to confirm.

---

## RESULTS SO FAR (recorded 2026-06-10) — fixture + handoff PASS; live scrape NOT tested

> **Fixture-mode only — no real Avito scrape happened.** `fixture_mode=true`, `live_mode=false`, source cost $0, the
> Apify HTTP node did not run. These runs prove the **pipeline shape** (Avito-like listing → `raw_market_records` →
> `market_record_registry` → Workflow 08 → monitor/skipped), **not** real Avito scraping.

- **Test 1 — fixture first run: ✅ PASS** — `agent_requests +1`, `raw_market_records +6`, `market_record_registry +6`;
  `platform=avito`, `source_type=classified`; 5 competitor listings + 1 irrelevant POS-terminal control;
  `dedup_status=unique`, `approval_status=new`; MSK `+03:00` OK; `semantic_keywords`/`ad_channel_hint`/`competitor_related`
  populated; `estimated_analysis_cost_usd=0`. Example `agent_request_id=avito_req_20260610_214709`.
- **Test 2 — fixture duplicate run: ✅ PASS** — `agent_requests +1`, `market_record_registry +0`, all
  `duplicate_in_registry`; `raw_market_records +6` audit (write_duplicate_audit=true).
- **Test 3 (handoff) — Workflow 08 deterministic handoff: ✅ PASS** — `agent_request_id_filter` set to the latest
  `avito_req`, `max_records=6` → `monitor_queue=5`, `skipped_log=1`, `technical_errors=0`, Claude calls=0.
- **Issue found:** Competitor Ad Intelligence business fields were weak — `offer_text` held the query (not the listing
  title), `terms` empty, `content_idea_score=1`, specific service themes lost. **Fixed by DEC-092** (WF09 service_hint/
  keywords + WF08 deterministic Avito enrichment). **Retest after the patch — see "RETEST TARGET (post-DEC-092)" below.**
- **Live Avito scrape: NOT tested** — requires `fixture_mode=false`, `live_mode=true`, a real Apify actor id, and a
  bound Apify HTTP Header credential. Until then status = **fixture + handoff approved; live scrape not tested**.

### RETEST TARGET (post-DEC-092) — WF08 handoff still 5/1, now with rich ad intelligence
Re-run the handoff (same filter, `max_records=6`) and confirm routing is unchanged **and** the business fields improved:
- `monitor_queue=5`, `skipped_log=1`, `technical_errors=0`, Claude calls=0 (unchanged).
- `offer_text` = actual listing title (e.g. «Помощь в получении кредита. Кредитный брокер»), **not** the query.
- `terms` = price + explicit conditions (e.g. «от 30 000 ₽; оплата за результат; работа по договору»).
- `content_idea_score` = 35–55 for competitor listings (50–55 for strong-pain/semantics; 1 stays only for irrelevant).
- `service_type` preserves the specific theme (credit_broker / business_credit / credit_after_refusals / mortgage_refinance).
- `reason` mentions offer/price/semantic angle + Avito/classifieds + monitor.

Build-time simulation (post-DEC-092, filtered handoff): monitor_queue=5 / skipped_log=1; `deterministic_pre_route×5 +
deterministic_irrelevant_skip×1`; competitor_strength 78–85; lead_signal_score=1; content_idea_score 50–55;
quality_score 78–82; offer_text=title; terms=price+conditions; service_type themes preserved; irrelevant control all-1.

---

## TEST 1 — fixture first run (empty / fresh registry) — ⏳ AWAITING OPERATOR RUN

### How to run
1. Import WF09 (do **NOT** activate). Rebind the Google Sheets credential on the 4 sheet nodes; set the real
   Spreadsheet ID. (Apify is **not** needed for fixture mode.)
2. `Set Avito Connector Config`: keep `fixture_mode=true`, `live_mode=false`, `max_items=10`,
   `write_duplicate_audit=true`.
3. **Execute Workflow once.**

### Acceptance (Test 1 target)
- `raw_market_records` **+6**; `market_record_registry` **+6 unique**; `agent_requests` **+1** (`status=completed`).
- `Final Summary Output`: `total_items=6`, `unique_count=6`, `duplicate_count=0`, `skipped_count=1`,
  `predicted_route_counts = { monitor_queue: 5, skipped_log: 1 }`, `raw_market_records_written=6`,
  `registry_rows_written=6`.
- 5 competitor listings → `record_type_hint=competitor_activity`, predicted `monitor_queue`; 1 irrelevant
  (POS-terminal) → `record_type_hint=irrelevant`, predicted `skipped_log`.
- `semantic_keywords` populated for competitors; `manager_note` = "Семантика/оффер конкурента: …"; `contact_public`
  empty (none invented). Cost **$0** (no Apify, no Claude).

### Build-time simulation (expected)
| # | record_type_hint | predicted_route | service_hint | next_action | dedup_status |
|---|------------------|-----------------|--------------|-------------|--------------|
| 1 | competitor_activity | monitor_queue | business_credit | monitor | unique |
| 2 | competitor_activity | monitor_queue | credit_broker | monitor | unique |
| 3 | competitor_activity | monitor_queue | business_credit | monitor | unique |
| 4 | competitor_activity | monitor_queue | credit_broker | monitor | unique |
| 5 | competitor_activity | monitor_queue | mortgage_refinance | monitor | unique |
| 6 | irrelevant | skipped_log | unknown | ignore | unique |

### Observed (operator fills)
| metric | target | observed |
|--------|--------|----------|
| raw_market_records written | 6 | |
| registry rows written | 6 | |
| agent_requests written | 1 (completed) | |
| predicted monitor_queue | 5 | |
| predicted skipped_log | 1 | |
| skipped_count | 1 | |
| cost | $0 | |

- [ ] **PASS / FAIL:** ____

---

## TEST 2 — fixture duplicate run (registry already populated) — ⏳ AWAITING OPERATOR RUN

### How to run
1. Immediately after Test 1 (registry now holds the 6 dedup_keys), **Execute Workflow once again** (same config).

### Acceptance (Test 2 target)
- All 6 → `dedup_status=duplicate_in_registry`, `approval_status=duplicate`.
- `raw_market_records` **+6** (audit, because `write_duplicate_audit=true`); `market_record_registry` **+0**.
- `agent_requests` **+1** with `result_summary` `total_items=6; unique=0; duplicates=6; skipped=1`.
- Duplicate **competitor** `next_action=monitor_duplicate`; duplicate **irrelevant** `next_action=ignore`.

### Observed (operator fills)
| metric | target | observed |
|--------|--------|----------|
| dedup_status all | duplicate_in_registry | |
| raw written (audit) | 6 | |
| registry written | 0 | |
| competitor dup next_action | monitor_duplicate | |
| irrelevant dup next_action | ignore | |

- [ ] **PASS / FAIL:** ____

> To re-test as a fresh first run, clear the 6 Avito rows from `market_record_registry` (or use a clean sheet).

---

## TEST 3 — optional live Apify smoke test (`max_items=5`) — ⏳ OPTIONAL / NOT RUN

> **Gated:** run only after an Apify Avito actor is chosen and explicitly approved. No direct Avito scraping.

### How to run
1. `Set Avito Connector Config`: `fixture_mode=false`, `live_mode=true`, `apify_actor_id=<chosen actor>`,
   `max_items=5`. Bind the Apify credential (HTTP Header Auth) in n8n (no token in the file).
2. Record any Apify balance/credits **before** → **Execute once** → **after**.

### Acceptance (Test 3 target)
- ≤5 normalized listings → `raw_market_records` (+ unique → registry); routes predicted as in Test 1 logic.
- `technical_errors`/business tabs **not** written (WF09 never writes them). **0 Firecrawl / 0 Claude.**
- Record the Apify actor cost (source cost). Analysis cost = $0 in WF09.

### Observed (operator fills)
| metric | target | observed |
|--------|--------|----------|
| listings collected | ≤5 | |
| raw written | = collected | |
| registry written | unique only | |
| Apify source cost | record | |
| Firecrawl / Claude | 0 / 0 | |

- [ ] **PASS / FAIL / SKIPPED:** ____

---

## TEST 4 — Workflow 08 handoff (manual, source-handoff filter REQUIRED) — ⏳ AWAITING OPERATOR RUN

> **REQUIRES the WF08 source-handoff filter (DEC-091).** Workflow 08 reads **all** `raw_market_records`, so without a
> filter it would also process old Stage 3.1/3.2 rows. For the Stage 3.3 handoff test you **must** set
> `agent_request_id_filter` to this connector run's `agent_request_id` (and optionally `platform_filter` /
> `source_type_filter`). **Do NOT** use `llm_test_batch_indexes` for source handoff — that selects positions for the
> LLM 4-record test, not a source.

### How to run
1. After Test 1 (fixture) or Test 3 (live), open `raw_market_records` and note the connector run's `agent_request_id`
   (fixture first run from WF09 build context = `avito_req_20260610_214709`; your actual run id may differ — copy it
   from `agent_requests` / `raw_market_records`).
2. In WF08 `Set Analyzer Config` set:
   ```
   agent_request_id_filter  = "avito_req_20260610_214709"   // <- this run's id
   platform_filter          = "avito"
   source_type_filter       = "classified"
   max_records              = 6
   analysis_mode            = "deterministic_first"
   llm_enrichment           = false
   llm_enrichment_test_mode = false
   ```
3. **Manually run Workflow 08** (WF09 does **not** auto-run WF08).
4. **After the test, clear the three filters** (set back to `""`) to restore default behavior.

### Acceptance (Test 4 target — expected counts)
- Only the **6 rows of this `agent_request_id`** are processed (old rows excluded; filter applies before `max_records`).
- `monitor_queue = 5`, `skipped_log = 1`, `content_queue = 0`, `review_queue = 0`, `technical_errors = 0`.
- `parse_method`: `deterministic_pre_route` ×5 (competitor listings), `deterministic_irrelevant_skip` ×1 (irrelevant
  POS-terminal).
- **Claude calls = 0** / $0 (deterministic_first default). No `results`/`contact` without `contact_public`.
- (Optional) competitor offer/semantic enrichment only if the operator explicitly enables `llm_enrichment` (Stage 3.2
  watch item still applies).

### Observed (operator fills)
| # | platform | entity_type | route (WF08) | parse_method | note |
|---|----------|-------------|--------------|--------------|------|
| 1 | avito | | | | competitor → monitor_queue |
| 2 | avito | | | | competitor → monitor_queue |
| 3 | avito | | | | competitor → monitor_queue |
| 4 | avito | | | | competitor → monitor_queue |
| 5 | avito | | | | competitor → monitor_queue |
| 6 | avito | | | | irrelevant → skipped_log |

| metric | target | observed |
|--------|--------|----------|
| rows processed (this agent_request_id only) | 6 | |
| monitor_queue | 5 | |
| skipped_log | 1 | |
| content_queue / review_queue | 0 / 0 | |
| technical_errors | 0 | |
| Claude calls | 0 | |

- [ ] **PASS / FAIL:** ____

> **Filter behavior (DEC-091, simulation-verified):** with empty filters WF08 default behavior is unchanged; with the
> filters set, only matching rows flow, and the filter is applied **before** `max_records` and before per-record
> processing. `llm_enrichment_test_mode` is independent and still works.

---

> **Note:** WF09 default mode is fixture ($0). Live Apify and the WF08 handoff are operator-controlled. WF09 never
> writes the business route tabs and never auto-runs WF08. The WF08 source-handoff filter (DEC-091) is what scopes the
> handoff to one connector run.
