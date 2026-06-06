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

---

## Budget Alerts

| Threshold | Action |
|-----------|--------|
| Claude API balance < $0.50 | Top up before next scraping run |
| Monthly AI cost > $20 | Review record volume and pre-filter effectiveness |
| Cost per record > $0.05 | Investigate — pages may be too long or retries too frequent |
| VPS disk > 90% used | Upgrade VPS before next high-volume run (see DEC-013) |
