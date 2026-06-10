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

## Stage 3 — Business Scout Agent: Three Separate Cost Axes (PLANNED, DEC-078)

Three cost axes with different drivers and spend gates — tracked **separately** (mirrored in `agent_requests`:
`estimated_source_cost_usd` vs `estimated_analysis_cost_usd`; outreach tracked separately and deferred).

| Cost axis | Driver | When spent | Tracked in |
|-----------|--------|------------|------------|
| **Source-acquisition cost** | Apify actor / VK·Telegram·Dzen API / Instagram actor / search actor — per N records | at collection (before approval) | `agent_requests.estimated_source_cost_usd` |
| **Analysis cost** | per-record Claude analysis (≈ Stage 2 per-record cost) | only **after** operator approval | `agent_requests.estimated_analysis_cost_usd` |
| **Outreach cost** | messaging / calling / auto-calling fees + compliance risk | **DEFERRED** — not until compliance/platform review | (separate, future) |

- **Manual Records Intake = 0 source-acquisition cost** (recommended first) — only analysis cost after approval.
- **Avito / Dzen / VK / Telegram / Instagram** each carry **their own** source cost and **separate rate limits**
  — measured per source when (if) approved.
- **Analysis cost** must be **measured with small bounded batches first** (≤10 records) before any larger run;
  no scheduled/automated collection in Stage 3.
- **Outreach / autocall / mass-messaging cost and risk are tracked separately and DEFERRED** until a dedicated
  compliance/platform review — no budget committed near-term.

### Stage 3.1 — Manual Touchpoint Intake (Workflow 07) actual cost
- **Source-acquisition cost = 0** — no scraping, no Apify/Firecrawl/Claude, no external API. Records are pasted
  manually.
- **Analysis cost = 0 so far** — Workflow 07 does **no** Claude/LLM analysis (that is Stage 3.2). The
  `estimated_analysis_cost_usd` it writes (0.02/record non-irrelevant, 0 for irrelevant; ~0.20 for the 12-record
  batch) is **planning-only** — a forward estimate for the future Touchpoint Analyzer, **not** money spent.
- Net spend of a Workflow 07 run: **0**.

### Stage 3.2 — Touchpoint Analyzer (Workflow 08) cost
- **First Claude spend in Stage 3.** Each **non-irrelevant** record = one primary Claude call (`max_tokens=1200`,
  `temperature=0.2`); a **repair** call (`max_tokens=700`, `temperature=0`) happens **only** on a primary
  parse failure. **Irrelevant records cost $0** — they are skipped deterministically before any Claude call.
- Bounded by `max_records=12`. For the 12 Workflow-07 fixtures: ~10 non-irrelevant analyzed, 2 irrelevant free.
  Using the Stage 2 measured ~$0.0115 per short record as a rough anchor, a full 12-record run is on the order of
  **~$0.10–0.20** (record texts are short); **measure exactly** (balance before/after) and log in
  `docs/STAGE_3_2_TEST_RESULTS.md`.
- **Source-acquisition cost stays 0** at this stage (records came from manual intake; no scraping/Apify/Firecrawl).
- No scheduling/automation — manual, bounded runs only.

### Stage 3.2 patch v2 (DEC-081) — cost impact
- **No extra Claude cost from the deterministic fallback** — the fallback runs **only after** the primary (and
  repair) calls already happened; it adds **zero** new API calls. It changes only *where the record routes*
  (a hint-based business tab instead of `technical_errors`).
- A failed-LLM record still costs the primary call (and the repair call if reached) — same as before; the patch
  recovers the *routing*, not the spend.
- Irrelevant records remain $0 (skipped before Claude). Cost ceiling unchanged: ≤12 records/run, ≈10 incurring
  a primary call for the fixtures.

### Stage 3.2 TEST 2 measured + patch v3 deterministic-first (DEC-082) — cost impact
- **TEST 2 (v2) measured Claude cost delta ≈ $0.159 for 12 records** — but `primary_json=0` and only
  `repaired_json=2`; the deterministic floor did all the real classification. Paying per-record for an LLM that
  returns prose/thinking is **cost-efficiency FAIL**.
- **Patch v3 makes the analyzer deterministic-first** (`analysis_mode='deterministic_first'`,
  `llm_enrichment=false` by default). Obvious records route **without any Claude call** (`deterministic_pre_route`
  / `deterministic_irrelevant_skip`). Claude is called only when `deterministic_needs_llm=true` (uncertain
  default class) or enrichment is switched on.
- **Default-mode cost for the 12-record fixture: $0** — `Claude Primary API Request` and `Claude Repair API
  Request` do not run; `repair_used=false` for all 12. Verify with balance before/after in
  `docs/STAGE_3_2_TEST_RESULTS.md` (TEST 3).
- **Future `llm_enriched` mode** (opt-in): primary call per non-irrelevant record (≈10), repair only on parse
  failure — same ceiling as the v2 estimate; enable **only after** Claude JSON stability is proven.

### Stage 3.2 finalization (DEC-083) — cost impact
- **TEST 3 confirmed $0** — deterministic_first baseline ran with **Claude calls=0** (balance unchanged). Approved.
- **Moscow-time timestamp patch costs nothing** — `moscowIsoNow()`/`moscowStamp()` are pure n8n Code-node logic
  (a `+03:00` offset), no API calls, no schema change, applied across Workflows 04/05/06/07/08.
- **LLM enrichment small test (TEST 4) is bounded to 4 Claude primary calls** via `llm_enrichment_test_mode=true`
  + `llm_test_batch_indexes=[1,7,11,12]` (≈$0.04–0.06 plus any ≤2 repairs); record the exact delta. Full
  `llm_enriched` mode stays opt-in and is not approved until TEST 4 passes.

### LLM enrichment Test C (measured) + v4 compact enrichment (DEC-085) — cost impact
- **Test C (v3 full-row enrichment, 4 records) measured cost delta = $0.0967** (Today $0.3393→$0.4360,
  Total $1.3054→$1.4021) — for near-zero usable LLM output (too many `deterministic_fallback_after_llm_fail`).
  **LLM enrichment NOT approved.**
- **v4 makes enrichment compact (DEC-085):** Claude returns a small 15-key enrichment object only (not the full
  row), `max_tokens` 700/600, `temperature=0`, `thinking` disabled. This should sharply cut output tokens and
  the fallback rate. **Test C2 target cost delta ≤ $0.04 for 4 records** (vs $0.0967) — record the exact delta.
- **Default mode cost is still $0** (deterministic_first, all LLM flags `false`). The v4 patch and MSK timestamps
  add no API calls.

### C2 attempt #1 (v4) + v5 filter fix (DEC-086) — cost impact
- **C2 attempt #1 stalled after record 1** (loop-continuation bug), so only **~1 Claude call** was billed and the
  run was INCOMPLETE — the single record (`primary_json`, no repair) was cheap and clean but not a valid test.
- **v5 (DEC-086) is pure n8n logic** (moved the test filter into `Filter & Select Records`; removed the empty
  return) — **no extra API calls, no cost change.** The corrected C2 attempt #2 will make **4 primary calls**
  (+ ≤1 repair); **target cost delta ≤ $0.04** — record the exact delta. Default mode remains **$0**.

### C2 attempt #2 result + v6 enrichment-quality patch (DEC-087) — cost impact
- **C2 attempt #2 (actual):** processed the intended 4 fixtures, `technical_errors=0`, routes preserved, but
  `primary_json=2/4` (target ≥3/4), `repaired_json=1/4`, `fallback=1/4` → **PARTIAL PASS, LLM enrichment NOT
  APPROVED**.
- **v6 (DEC-087) does NOT change cost:** `max_tokens` unchanged (primary 700 / repair 600), thinking still disabled,
  schema still compact; it only shortens the source/review prompt and adds deterministic HINTS + reason sanitizers.
  **Test C3 keeps the same cost target ≤ $0.04 for 4 records** — record the exact delta. Default mode remains **$0**.
  Better JSON reliability should reduce repair calls, which only **lowers** cost.

### C3 result + v7 specialized source_candidate schema (DEC-088) — cost impact
- **C3 (actual):** 4 fixtures, `technical_errors=0`, routes preserved, quality improved, but `primary_json=2/4`
  (Telegram `source_candidate` still fell back) → **PARTIAL PASS, LLM enrichment NOT APPROVED**.
- **v7 (DEC-088) does NOT raise cost — it lowers it for the source_candidate family:** the specialized path uses a
  **smaller** prompt + 7-key schema with `max_tokens=500` (primary) / `400` (repair), vs the general `700`/`600`.
  General Avito/Banki/Zoon paths are unchanged. **Test C4 keeps the cost target ≤ $0.04 for 4 records** — record the
  exact delta; removing the Telegram repair/fallback round-trip should reduce spend. Default mode remains **$0**.

### C4 result — Stage 3.2 CLOSED, LLM enrichment APPROVED WITH WATCH ITEM (DEC-089) — cost impact
- **C4 (actual):** 4 fixtures processed, `technical_errors=0`, **`primary_json=3/4`**, `repaired_json=0/4`,
  **`deterministic_fallback_after_llm_fail=1/4`** (the Banki/forum lead-pattern), `repair_used=false` for the 3
  `primary_json` rows / `true` only for the fallback row, routes preserved, MSK `+03:00` OK. **Telegram fixed**
  (`primary_json`). → **PASS, LLM enrichment APPROVED WITH WATCH ITEM** for optional / test use.
- **C4 cost delta: TODO_OPERATOR_FILL** (target ≤ $0.04 for 4 records). Only 1 repair round-trip (the single fallback
  row), so the delta should sit at or below target. **Operator: fill the measured Claude balance before/after here and
  in `docs/STAGE_3_2_TEST_RESULTS.md`.**
- **Default production mode is still $0** — `deterministic_first` with all LLM flags `false`. Compact LLM enrichment is
  **opt-in only** (`analysis_mode='llm_enriched'` + `llm_enrichment=true`); the default does **not** change unless the
  operator explicitly enables it.

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

**Manual E2E test 2026-06-08 (DEC-062):** Workflow 05 discovered `carcapital.ru/` → operator approved 1 URL → Workflow 04 processed it = **1 Firecrawl credit + 1 Claude call** (one URL, `primary_json`, no repair) → `monitor_queue`. Confirms the discovery→approval→consume chain spends only on approved URLs. The `service_type` patch (DEC-062) costs nothing extra (deterministic post-model override).

**Workflow 06 runtime registry recheck (DEC-065):** Workflow 06 itself costs **0** (no Apify/Firecrawl/Claude). Its runtime re-read of `url_registry` (re-normalizing each `candidate_url` and skipping any URL already in the registry as `registry_recheck_duplicate`) **prevents accidental duplicate Firecrawl/Claude spend** in Workflow 04 — including when an operator has manually (or mistakenly) marked an already-registered URL as `unique`/`not_in_registry`/`approved` in `url_candidates`. The candidate-table dedup fields are advisory; the registry is the spend-safety gate.

---

## URL Discovery Layer (Stage 2.2 — Workflow 05 BUILT/under test — DEC-055/056/057/058/059/060)

Selected: **Level 2 — Apify Search Candidate Discovery** (`n8n/workflows/05_apify_search_candidate_discovery.json`, active=false). `url_candidates` = 25 cols; `discovery_requests` = 18 cols. Manual entry is an optional fallback mode.

- **Workflow 05 must NOT spend Firecrawl or Claude.** Verified in the built + patched workflow: only one Apify HTTP node, no Firecrawl/Claude nodes. It normalizes, dedups, classifies (`candidate_type`), scores, and writes sheets. Its only cost is the **Apify search call**.
- **First real run** («займ под залог ПТС Москва»): 10 candidates, 1 registry duplicate, `estimated_firecrawl_credits=9`, `estimated_claude_cost_usd=0.18` (downstream estimates only — **nothing spent** in Workflow 05). Record the Apify run cost on the next run.
- **Candidate-quality patch (DEC-061) reduces downstream spend:** `candidate_type` + competitor-first confidence steer the operator toward approving `direct_competitor` rows and away from low-value aggregators/directories/media, so fewer wasted Firecrawl/Claude calls in Workflow 04.
- **Apify Search cost tracking (placeholder — fill on first run):** record per `discovery_request_id`: query, `requested_limit`, candidates returned, Apify cost (USD), unique, duplicates.
- **Cost must be estimated before processing.** Workflow 05 writes `estimated_firecrawl_credits` (=1/unique candidate) and `estimated_claude_cost_usd` (configurable rough **$0.01–0.03/URL** until measured) per candidate and sums them onto the `discovery_requests` row, so the operator sees the total *before* approving. The approval gate is the spend gate: **no candidate is processed until `approval_status=approved`.**
- Per unique, not-in-registry candidate the *processing* estimate ≈ **1 Firecrawl credit + ~$0.01–0.023 Claude** (same per-URL model as Workflow 04). Duplicates (registry or batch) estimate 0/0.
- **Default volumes:** collect up to **10** candidates/request; processing stays **≤5/run** in Workflow 04, so 10 approved candidates cost **two batches of 5** — a worst-case ≈ 10 Firecrawl credits + ~$0.10–0.23 Claude, only after explicit approval.
- **Processing cost stays controlled by Workflow 04 after approval.** Default collect **10** candidates → if all approved, processed as **two batches of 5** (≤5/run) ≈ worst-case 10 Firecrawl credits + ~$0.10–0.30 Claude. Duplicates (registry/batch) estimate 0/0.
- **Fallback sources measured separately (later):** Google CSE (low-cost), SerpAPI (paid). Firecrawl `/v2/search` parked. **Discovery cost ≠ processing cost** — track in separate columns.
- Workflow 04's ≤5-URL processing limit and the approval gate together cap spend — discovery cannot trigger large spend on its own.

---

## Approved Candidates Runner (Stage 2.2c — Workflow 06, DEC-064)

`n8n/workflows/06_approved_candidates_runner.json` (active=false) — the bridge that releases approved candidates into Workflow 04.

- **Workflow 06 itself adds NO search/processing cost.** It only reads `url_candidates` and (optionally, via a disabled node) updates `approval_status`. No Apify, no Firecrawl, no Claude — verified: node types are manualTrigger, Google Sheets (read + disabled update), code, IF, sticky notes.
- **Processing cost comes from Workflow 04 only** — Workflow 06 hands ≤5 approved URLs to the existing consumer; spend is whatever those ≤5 URLs cost in Workflow 04 (≈ 1 Firecrawl credit + ~$0.01–0.023 Claude per unique, not-in-registry URL).
- **Max 5 approved URLs per run controls spend.** The hard cap mirrors Workflow 04's ≤5/run; eligible candidates beyond 5 are deferred (`over_max_5_limit`) to a later run. 10 approved candidates → two runs of 5.
- The only Google Sheets API calls are 1 read + (if the disabled update node is enabled) ≤5 row updates — negligible quota, no model/scrape spend.

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

---

## Lead Discovery Layer — Cost Model (PROPOSED, design only — DEC-069)

> Nothing here is spent yet. These rules apply when Stage 3.0 (Lead Source Evaluation) and any connector are
> built. See `docs/LEAD_DISCOVERY_ARCHITECTURE.md` and `docs/LEAD_SOURCE_CONNECTORS_PLAN.md`.

- **Source cost is tracked SEPARATELY from Claude analysis cost.** A lead run has two distinct cost lines:
  (1) **source acquisition** (Apify actor run, search API quota, Telegram/VK API usage, browser-automation
  minutes) and (2) **Claude analysis** (per approved record, same per-record model as the web pipeline).
  Never fold source cost into the Claude line — they scale and fail independently.
- **Stage 3.0 must estimate source cost per source** (cost per N records) before any connector is chosen,
  alongside data availability, risk, lead quality, and implementation complexity.
- **Telegram / Avito / VK / Instagram connectors require their own cost + rate-limit tracking** (per-actor or
  per-API quotas, session/account limits). Add a per-source cost row here when each is evaluated.
- **Human approval stays the spend gate:** no record reaches Claude until `approval_status=approved`, so
  discovery volume can be large while analysis spend stays bounded by what the operator approves.
- **Estimated-before-approval:** like `discovery_requests`, `lead_discovery_requests` carries
  `estimated_cost_usd` (downstream analysis estimate) so the operator sees cost before approving.

---

## Stage 2 final hardening — cost impact (DEC-070/072, 2026-06-07)

- **Zero added API cost.** The WF06 runner modes (`first_pass_domain_diversity` / `deep_domain_analysis`) and
  the WF04 stronger PTS override + deterministic contact extraction are **pure n8n Code-node logic** — no extra
  Apify/Firecrawl/Claude calls.
- **Domain diversity bounds spend further.** `first_pass_domain_diversity` (default) selects at most 1 URL per
  domain per run, so a single competitor's many pages cannot consume a 5-URL run; `deep_domain_analysis` caps a
  domain at 3 URLs/run. The hard `max_per_run=5` still bounds Workflow 04 spend per handoff.
- **Contact extraction is free** and reduces wasted manual review (no partial/hallucinated contacts stored).
- Per-URL Workflow 04 cost is unchanged (~1 Firecrawl credit + ~$0.01–0.023 Claude per non-duplicate URL;
  duplicates 0). See the Workflow 04 mini-batch cost model above.

---

## Stage 2 finalization — cost posture (2026-06-08, DEC-074/075)

- **No new spend this finalization pass** — docs only; no workflow logic changed; no external API called.
- **Stage 2 spend model is unchanged and bounded:** WF05 = Apify search cost only (0 Firecrawl/0 Claude);
  WF06 = 0 (pure selection logic); WF04 ≈ 1 Firecrawl credit + ~$0.01–0.023 Claude per **non-duplicate** URL,
  hard-capped at 5 URLs/run; duplicates cost 0 (url_registry recheck + dedup before spend).
- **Auto-handoff deferral (Stage 2.4) has no cost impact now.** When built, auto mode would run the **same**
  WF04 analyzer per selected URL — same per-URL cost, still gated by human approval and `max_per_run=5`; it
  removes a manual copy step, not a cost. The confirm-then-mark path adds only Google Sheets writes (no AI).
- **Stage 3 reminder:** lead-source acquisition cost (Apify actors / APIs / sessions) must be tracked
  **separately** from Claude analysis cost, and estimated per source during Stage 3.0 before any connector is
  built.
