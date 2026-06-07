# COSTS_AND_LIMITS.md — Cost Baseline and Estimates

Tracks known costs, measured API spend, and forward estimates for the Marketing Scout project.
Updated after each session that incurs or measures real costs.

---

## Monthly Fixed Costs (as of 2026-06-05)

| Service | Cost | Notes |
|---------|------|-------|
| VPS (Ubuntu 24.04) | ~240 RUB/month | Hosts n8n and all containers |
| n8n (self-hosted) | 0 RUB | Free software, runs on VPS |
| Google Sheets | 0 RUB | Free tier |
| GitHub | 0 RUB | Free tier |
| Claude subscription (manual use) | ~1 300 RUB/month | Only if operator uses claude.ai manually; not required for pipeline API calls |
| Claude API test budget | ~319 RUB / $5 | One-time prepaid balance for pipeline testing |
| Apify | pending | Free tier available; limits TBD |
| Firecrawl | pending | Free tier available; limits TBD |
| Telegram Bot | 0 RUB | Free |

**Total known fixed cost (pipeline only, no manual Claude):** ~240 RUB/month

---

## Measured API Cost — Workflow 02 (2026-06-05)

**Test record:** one short Russian secured lending competitor entry (~200 chars text_context)
**Model:** `claude-sonnet-4-6` via `https://aiprimetech.io/v1/messages`

| Measurement | Value |
|-------------|-------|
| Balance before | $0.0007 |
| Balance after | $0.0122 |
| **Cost per short AI scoring** | **$0.0115** |
| Exchange rate used | 73.41 RUB/USD |
| **Cost per short AI scoring (RUB)** | **~0.84 RUB** |

> This is a single data point for a short test record. Real scraped pages may be significantly longer, which will increase cost.

---

## Estimate Table

| Volume | USD cost | RUB cost (at 73.41) |
|--------|----------|----------------------|
| 10 scorings | ~$0.12 | ~8 RUB |
| 100 scorings | ~$1.15 | ~84 RUB |
| 500 scorings | ~$5.75 | ~422 RUB |
| 1 000 scorings | ~$11.50 | ~844 RUB |
| 5 000 scorings | ~$57.50 | ~4 218 RUB |
| 10 000 scorings | ~$115.00 | ~8 435 RUB |

These estimates assume the same short text_context as the Workflow 02 test. Real data will vary.

---

## Cost Formula

```
cost_per_ai_scoring   = balance_after - balance_before   (measure per run)
estimated_ai_cost     = cost_per_ai_scoring * number_of_records
total_cost_per_row    = scraping_cost_per_item + ai_scoring_cost_per_item
monthly_estimate      = total_cost_per_row * records_per_month
```

**Example:** 500 records/month with $0.02 Firecrawl cost + $0.015 Claude cost per item:
`500 * ($0.02 + $0.015) = $17.50/month ≈ 1 284 RUB/month`

---

## Cost Caveats

**Longer pages cost more.**
The Workflow 02 test used ~200 chars of text_context. Real scraped competitor pages may be 1 000–5 000 tokens long. Cost can increase 3–10× per record. Always truncate text_context before sending to Claude (max ~500 chars for MVP).

**Retries cost money.**
If the Claude API returns an error and n8n retries, you pay for each attempt. Set retry count to 0 or 1 in HTTP Request node for cost control during testing.

**Failed parse attempts cost money.**
If Claude returns an unparseable response and the workflow restarts, you pay again. Pre-filtering before Claude is required to avoid sending junk inputs.

**Pre-filtering is required before Claude.**
Short boilerplate records, navigation pages, and empty text_context should be filtered out BEFORE the Claude API node — not after. This avoids paying for scorings that will always be skipped.

**Balance monitoring.**
Check gateway account balance before each scraping session. Low balance causes 402 errors mid-run and may corrupt a partial dataset in Google Sheets.

**Exchange rate risk.**
RUB estimates are approximate and depend on current USD/RUB rate. The $5 test budget (~319 RUB at time of writing) covers approximately 430 short scorings.

---

## Apify / Firecrawl Cost Placeholders

These services have not yet been tested. Cost data will be added after Workflow 03.

| Service | Free tier | Estimated per-page cost | Status |
|---------|-----------|------------------------|--------|
| Apify | ~$5 free credit / month | $0.001–0.010 per actor run item | Not yet tested |
| Firecrawl | ~500 pages free/month | $0.001–0.005 per page | Not yet tested |

Update this table after Workflow 03 is run with real URLs.

---

## Firecrawl Single-URL First Test (Workflow 03, 2026-06-07, DEC-039–042)

**Workflow:** `n8n/workflows/03_firecrawl_single_url_resilient.json`

Cost-control rules baked into the first Firecrawl test:

- **One URL only.** No crawl, no batch, no schedule (DEC-039). One Firecrawl scrape + at most two Claude calls (primary, plus repair only on parse failure) per run.
- **`text_context` capped at 6000 chars** before Claude (DEC-042) — bounds token cost on long real pages.
- **Firecrawl failure → `technical_errors` without a Claude call** (DEC-041) — a failed/empty scrape costs no AI spend.
- **Repair call fires only on a primary parse failure** — clean records cost ~1× baseline.
- **Record balance before/after.** Log Firecrawl credits (if visible) and the Claude balance delta below.
- **No scheduled scraping** until the per-URL cost profile is known.

| Run | Firecrawl credits | Claude today delta | Outcome |
|-----|-------------------|--------------------|---------|
| Firecrawl single-URL #1 (`mosinvestfinans.ru/`) | **1** | **$0.0229** ($0.0136→$0.0365; total $0.4983→$0.5211) | Pre-patch: primary parse failed → repair OK → `review_queue` with bad scores. **Post-patch (DEC-043/044): PASSED → `monitor_queue`**, competitor, `generic_lending`, strength/quality 78, `primary_json`, `repair_used=false`. |
| Firecrawl single-URL #2 (`lioncredit.ru/…/kredit-pod-zalog-nedvizhimosti`) | _record_ | _record_ | **PASSED → `monitor_queue`**, competitor `LionCredit`, `generic_lending`, strength/quality 75, `primary_json`, `repair_used=false`. |

**Notes (DEC-043/044/045):**
- **1 Firecrawl credit** per single-URL scrape (observed on `mosinvestfinans.ru/`).
- Single-URL Firecrawl + Claude cost appears **manageable** (~$0.01–0.023 per URL; the $0.0229 homepage figure included a one-off repair call before hardening). After hardening both tests parsed on the **primary** pass (`repair_used=false`), so steady-state per-URL cost trends toward the ~$0.0115 baseline plus page length.
- **Homepages are longer and more expensive** than specific service pages, and more likely to trigger the (paid) repair call. Prefer specific service pages.
- The post-repair hardening adds **no extra API calls** — pure n8n Code-node logic.
- **Mini-batch (Workflow 04) must start at 3–5 URLs max** (DEC-047). Per-URL cost ≈ single-URL cost; budget = (URLs × per-URL) + repair headroom. Record Firecrawl credits + Claude balance before/after each mini-batch run; pre-run balance buffer ≥ $0.20 for a 5-URL run.

> Real competitor pages are longer than the ~200-char test record, so per-record Claude cost is **higher** than the $0.0115 baseline (≈$0.01–0.023 measured on single URLs). Specific service pages cost less than multi-product homepages.

---

## Firecrawl URL List Mini-Batch (Workflow 04, DEC-048/049/051)

**Workflow:** `n8n/workflows/04_firecrawl_url_list_resilient.json` — 3–5 URLs/run, manual, `url_registry` dedup before spend (DEC-051).

**Cost model:** `run_cost ≈ (non_duplicate_URLs) × per_URL_cost`, where `per_URL_cost ≈ 1 Firecrawl credit + ~$0.01–0.023 Claude` (repair adds a second Claude call only on parse failure). **Duplicates cost 0** Firecrawl/Claude — a `url_registry` hit skips before any spend. Long pages are capped at **`text_context` ≤ 3500 chars** (DEC-051) to bound Claude input tokens. Pre-run Claude balance buffer ≥ $0.20 for a 5-URL run.

**Per-run log template (fill one row per run, keyed by `run_id`):**

| run_id | URL count | duplicates | Firecrawl credits before | Firecrawl credits after | Claude before | Claude after | technical_errors | repair_used count | cost per successful row |
|--------|-----------|------------|--------------------------|-------------------------|---------------|--------------|------------------|-------------------|-------------------------|
| _record_ | _3_ | _record_ | _record_ | _record_ | _record_ | _record_ | _record_ | _record_ | _record_ |

> Verify dedup: a **re-run of the same list** should show `duplicates = URL count`, `Firecrawl credits delta = 0`, `Claude delta = 0`, and all rows in `skipped_log` with `parse_method=dedup_source_url`.

**Validated 2026-06-08 (DEC-053):** Run 1 (`firecrawl_20260607_094000`, empty registry) processed 3 URLs → 3 `monitor_queue` rows + 3 `url_registry` rows. Run 2 (`firecrawl_20260607_094303`, same 3 URLs) → all 3 `skipped_log`/`dedup_source_url`, **0 Firecrawl credits, 0 Claude tokens**. The `url_registry` prevents repeated spend on URLs already seen.

**5-URL test 2026-06-08 (DEC-054, `firecrawl_20260607_100715`):** 5 URLs = 2 duplicates (`skipped_log`, 0 cost) + 1 placeholder (`skipped_log`) + 2 competitors (`monitor_queue`). **Claude Today before $0.2773 → after $0.3202 = Δ $0.0429.** Firecrawl expected **~3 credits** (1 per non-duplicate; the 2 duplicates spent 0). The **placeholder pre-filter** (`firecrawl_placeholder_prefilter`) now skips parked/not-connected domains **before** the Claude call, reducing future spend on dead domains (the `zalogpts.ru` Wix placeholder previously cost one Claude call). **Future tests must still record before/after Firecrawl credits + Claude balance.**

---

## URL Discovery Layer (Stage 2.2, planning — DEC-055/056/057/058)

Selected architecture: **Hybrid A+B+D** (manual → search/API → Telegram interface), C parked. `url_candidates` = 25 columns.

- **Cost must be estimated before processing.** Workflow 05 writes `estimated_firecrawl_credits` and `estimated_claude_cost_usd` per candidate so the operator sees the total *before* approving anything. The approval gate is the spend gate: **no candidate is processed until `approval_status=approved`.**
- **Manual candidate intake (Option A / Workflow 05) costs 0 Firecrawl / 0 Claude** — it only normalizes, dedups, and classifies; no scraping/analysis.
- Per unique, not-in-registry candidate the *processing* estimate ≈ **1 Firecrawl credit + ~$0.01–0.023 Claude** (same per-URL model as Workflow 04). Duplicates (registry or batch) estimate 0/0.
- **Default volumes:** collect up to **10** candidates/request; processing stays **≤5/run** in Workflow 04, so 10 approved candidates cost **two batches of 5** — a worst-case ≈ 10 Firecrawl credits + ~$0.10–0.23 Claude, only after explicit approval.
- **Automated search sources (Option B/C) must be measured separately** — search-API / Apify-actor / Firecrawl `/v2/search` cost and rate limits are evaluated on their own before any automated discovery (gate G4). **Discovery cost ≠ processing cost.**
- Workflow 04's ≤5-URL processing limit and the approval gate together cap spend — discovery cannot trigger large spend on its own.

---

## Gateway Stability and Prompt Size (2026-06-05, updated v2.5 MICRO)

**Observed:** Requests with large system prompts (9+ KB) returned 502 Bad Gateway on the current gateway (aiprimetech.io). Minimal curl with short prompt works correctly. This indicates a request-size or processing constraint on the gateway side.

**Rule: keep system prompts compact for this gateway.**

| Prompt version | System prompt size | max_tokens | Result |
|---------------|-------------------|------------|--------|
| v2.0/v2.1 | ~12 KB | 1400 | JSON.parse failures |
| v2.2 | ~15 KB (tool schema) | 1400 | 502 (tool_use not supported) |
| v2.3 | ~9.2 KB | 1100 | 502 on Test 1 (prompt too large) |
| v2.4 | ~5.3 KB | 700 | 502 upstream_error (still too large) |
| v2.5 MICRO | **~2 KB (1997 chars)** | **450** | Pending test |

**Core finding:** Long prompts increase cost AND can break gateway routing.
The gateway returned 502 at 9.2 KB (v2.3) and again at 5.3 KB (v2.4).
Micro-sized prompts (~2 KB) are the production direction for this gateway.

**Cost impact of micro prompt (v2.5):**
- Fewer input tokens → lower cost per call than any prior version.
- v2.5 estimated cost: $0.003–0.008 per call (vs. $0.006–0.015 for v2.4).
- At 1000 scorings: ~$3–8 vs. ~$6–15 (v2.4). Micro prompt is lowest-cost option.

**Prompts waste money in three ways:**
1. Higher input token count on every call.
2. If 502 causes n8n retry, you pay for the failed call too.
3. Debugging and reimporting the harness takes operator time with no output.

**Recommendation:** Keep system prompts under 2.5 KB for this gateway. Detailed methodology
stays in the canonical prompt file for reference only — not in the runtime prompt.
If a larger prompt is needed, test on official Anthropic API first (api.anthropic.com).

---

## Extended Test Cost Estimate (Tests 8–12)

**Workflow:** `02_claude_api_single_record_v2_extended_tests.json`
**Baseline:** d350069 raw JSON, max_tokens=1400, temperature=0.2

Each test record uses ~150–200 chars of text_context. Similar to the baseline Test 1 that cost $0.0115.

| Scenario | Estimated cost |
|----------|---------------|
| 5 extended tests (8–12) | ~$0.04–0.08 total |
| Per test | ~$0.008–0.016 |
| Balance recommended before run | ≥ $0.20 (buffer for retries) |

Record actual cost in `docs/WORKFLOW_02_V2_TEST_RESULTS.md` after the run.

---

## Measured Cost — Resilient Router Tests A–E (2026-06-06)

**Workflow:** `02_claude_api_single_record_v2_resilient_router_test_dynamic_sheet.json`

| | Balance |
|---|---|
| Before today | $0.1145 |
| After today | $0.1895 |
| **Delta (5 tests A–E)** | **$0.0750** |

Covers ~5 primary Claude calls plus repair calls triggered by Test D (mock_markdown) and Test E (mock_unrepairable). ≈ $0.015/test including repair overhead — consistent with the ~$0.0115 baseline plus the second (repair) call on D and E. Repair pass roughly doubles per-record cost when triggered; it only fires on parse failure, so steady-state cost stays near baseline for clean records.

### Production cost model (resilient router)

- **Clean record (primary parse OK):** 1 Claude call ≈ baseline (~$0.0115).
- **Failed parse (repair fires):** 2 Claude calls ≈ ~2× baseline for that record. The repair call only happens on parse failure, so total cost depends on the **primary failure rate**.
- **Estimate:** `cost ≈ N × baseline × (1 + failure_rate)`. At a 20–30% failure rate, ~1.2–1.3× baseline overall.
- **Before any scraper run, the operator must record the Claude balance before and after** the run and log the delta here. Real scraped pages are longer than test records, so per-record cost will be higher than the $0.0115 short-record baseline — measure on the first Firecrawl run.

### Production smoke test #1 — FAILED (2026-06-06, DEC-038)

The first manual production smoke test consumed a **primary call + a repair attempt**. The repair returned **502 Bad Gateway**, so it produced no usable output but **may still have cost or counted against the gateway depending on its billing behavior** — a 502 can occur before or after token processing. The compact-repair patch (max_tokens 700, smaller payload) lowers both the 502 risk and the worst-case repair cost.

**Retest cost discipline:** record the Claude balance **before and after** the patched smoke run, and log the delta here. If the row still hits `technical_errors`, the `parse_error` now shows whether the cost was a primary failure, a repair 502, or both.

| Run | Balance before | Balance after | Delta | Outcome |
|-----|----------------|---------------|-------|---------|
| Smoke #1 (pre-patch) | _record_ | _record_ | _record_ | FAILED — repair 502 |
| Smoke #2 (post-patch) | _record_ | _record_ | _record_ | _pending_ |

---

## Budget Alerts

| Threshold | Action |
|-----------|--------|
| Claude API balance < $0.50 | Top up before next scraping run |
| Monthly AI cost > $20 | Review record volume and pre-filter effectiveness |
| Cost per record > $0.05 | Investigate — pages may be too long or retries too frequent |
| VPS disk > 90% used | Upgrade VPS before next high-volume run (see DEC-013) |
