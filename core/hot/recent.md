# Hot Memory — Recent Sessions

Most recent first. Keep last 3 sessions max. Archive older entries to `core/warm/decisions.md`.

---

## Session: 2026-06-11 (session 2) — WF09 live business relevance filter (DEC-095) + Stage 3.4 architecture pack (DEC-096…101)

**What was done (relevance filter after live false positives; fixture/baseline preserved; docs pack; no external calls):**
- **Live retest #2 diagnosis:** `avito_req_20260611_001222`, actor `fatihtahta~avito-russia-scraper` — **transport
  PASS** (`actor_items_received=10; valid_items=10; invalid_items=0; unique=2; duplicates=1; over_pipeline_limit=7`),
  but both unique rows were **false positives**: `yuridicheskiy_adres_dlya_ooo_ot_sobstvennika` +
  `ne_massovyy_yuridicheskiy_adres_ot_sobstvennika` (legal-address services, not credit brokerage); the relevant
  broker row was a duplicate. → transport works, **business relevance filtering was insufficient**.
- **WF09 patch (`…v005-live-relevance-filter-20260611`, DEC-095):** relevance evidence = **title + description +
  decoded URL slug + category only** (the search query NEVER makes a listing relevant; Cyrillic + translit terms);
  strong phrases (кредитный брокер, помощь в получении кредита, кредит после отказов, ипотечный брокер,
  рефинансирование ипотеки, кредит для бизнеса, банковские гарантии) → `competitor_activity`; weak finance evidence →
  `market_signal`; **hard negatives** (юр. адрес / адрес для ООО / регистрация ООО-ИП / бухгалтерия / эквайринг /
  POS-терминал / касса / печать / штамп / ЭЦП / аренда офиса / коворкинг / юридические услуги / оборудование +
  translit) without strong credit evidence → live `irrelevant_live_false_positive` / `dedup_status=hard_skipped` —
  **not written to raw (default; `hard_skip_debug_audit=false` opt-in) or registry**, counted in `hard_skipped_items`;
  query-only items also hard-skipped. **Order:** score all → filter hard negatives → `pipeline_limit` (**10**) only on
  accepted business-relevant records. 8-count `result_summary` (`actor_items_received / structurally_valid_items /
  invalid_items / business_relevant_items / hard_skipped_items / unique / duplicates / over_pipeline_limit`).
  Canonical listing URLs (tracking params stripped when path has listing id); dedup_key unchanged. Fixture path
  unchanged (6 records, POS control → skipped_log).
- **Verified (Node simulation harness, 31 checks PASS):** fixture run 6/6 + monitor 5/skipped 1; duplicate run reg +0;
  modeled live batch incl. both real legal-address items + POS + query-only cleaning + legal-services → all 5
  hard_skipped (0 raw/0 registry), known broker → duplicate_in_registry, 2 strong brokers unique, weak-finance →
  market_signal, search URL → invalid (counts 10/9/1/4/5/3/1/0); pipeline_limit=3 + 4 leading hard negatives → 3
  brokers + 2 over_pipeline_limit (junk doesn't consume the cap). JSON valid; active=false; no real keys/Spreadsheet
  ID; MSK preserved; no tool_use/KEY=VALUE. WF04/05/06/07/08 untouched.
- **New docs (nothing built):** `CONTACT_AND_OUTREACH_POLICY.md` (DEC-097/098 — public contacts only +
  `contact_source_url` evidence; contact_use_policy manager_allowed/manual_review/no_outreach/aggregate_only; **no
  auto-outreach by default**; lead without public contact → review_queue), `STAGE_3_4_SOCIAL_SOURCE_PARSING_STRATEGY.md`
  (DEC-096 — **one source at a time**: Avito stabilize → Telegram public → VK API → reviews/maps → Dzen → Instagram
  after risk review), `WF10_COMPETITOR_AUDIENCE_INTELLIGENCE_AGGREGATOR_PLAN.md` (DEC-099 — competitor_profiles /
  market_angles / audience_activity_signals / content_positioning_plan / source_confidence_rules; build gated on a
  stable live source), `NICHE_PACK_SYSTEM_PLAN.md` (DEC-100 — niches/*.yaml to replace hardcoded broker rules),
  `COMPETITOR_AD_INTELLIGENCE_PLAN.md` (DEC-101 — first-class capability).
- **Decisions:** DEC-095…101. Docs: STAGE_3_3_TEST_RESULTS (retest #2 + Test 3b), STAGE_3_3 plan, source decision,
  WF09 RU, LEAD_DISCOVERY_ARCHITECTURE, LEAD_DATA_MODEL_PLAN, SOCIAL_CLASSIFIED_SOURCE_MATRIX, DECISIONS,
  NEXT_ACTIONS, COSTS, AGENT_CAPABILITIES, ROADMAP, AGENT_LOG, core/hot/recent.

**Next operator action:** commit → re-import WF09 v005 → (optional) clean the 2 false-positive registry rows from
attempt #2 → approved LIVE retest #3 (`fixture_mode=false`/`live_mode=true`; expect legal-address/POS hard_skipped, 0
written) → if `unique>0`, WF08 handoff with `agent_request_id_filter=<run id>`. Stage 3.3 closes on a clean live run.

---

## Session: 2026-06-11 — Workflow 09 live valid-listing guard after failed live smoke #1 (DEC-093/094)

**What was done (live extraction validation; fixture/baseline preserved):**
- **Live smoke #1 diagnosis:** actor `fatihtahta~avito-russia-scraper` (`avito_req_20260610_234404`) — the live Apify
  call ran but returned 1 empty/search-only item; pre-patch WF09 wrongly registered it as unique (raw + registry
  polluted). **LIVE SCRAPE PARTIAL FAIL / NORMALIZATION GUARD FAIL** (call worked; extraction/validation didn't). Actor
  `limit` min ≈10.
- **WF09 patch (`…v004-live-valid-guard`):** (A) config `actor_limit=10` (→Apify) + `pipeline_limit=3` (valid writes);
  (B) Apify body `{ "limit": actor_limit||10, "startUrls" }`; (C) Normalize broad field aliases
  (url/sourceUrl/listingUrl/adUrl/link, name/heading, priceText/price_text, sellerName/userName, text, address,
  parentSourceUrl); (D) **strict valid-listing guard** — valid only if avito.ru listing URL (not start/search, has
  listing id) + title|price|description; invalid/over-cap items **not written to raw or registry**, not unique;
  (E/F) summary `actor_items_received/valid_items/invalid_items/unique/duplicates/skipped` + debug note + ≤300-char
  preview, `next_action`="Do NOT run WF08 (valid_items=0)…".
- **Verified (sim):** failed-smoke item → invalid, 0 raw/0 registry, summary `actor_items_received=1; valid_items=0;
  invalid_items=1; unique=0; duplicates=0; skipped=0`; fixture first run unchanged (6/6, monitor 5/skipped 1); fixture
  duplicate unchanged (reg +0); 5 valid live + pipeline_limit=3 → 3 written + 2 over_pipeline_limit; body limit+startUrls
  only; header-auth no token; no real keys/Spreadsheet ID; MSK preserved; 40/15/21 cols; no tool_use/KEY=VALUE.
  WF04/05/06/07/08 untouched. (Fixed in sim: invalid/over-cap pushes now `{json:…}`-wrapped.)
- **Important:** a real Apify call already happened (attempt #1 cost incurred — record it). Valid live extraction
  **still not achieved** — retest; if actor keeps returning empty/search items, evaluate alternative actor.
- **Decisions:** DEC-094 (validation guard + actor_limit/pipeline_limit + counts), DEC-093 (actor selection, recorded).
  Docs: WF09 RU, STAGE_3_3_TEST_RESULTS, STAGE_3_3 plan, COSTS, NEXT_ACTIONS, DECISIONS, AGENT_LOG, core/hot/recent.

**Next operator action:** re-import WF09 → LIVE retest (bind Apify header cred, fixture_mode=false/live_mode=true,
inspect Apify JSON output). valid_items=0 → don't run WF08; valid_items>0 → WF08 with `agent_request_id_filter=<live id>`.
**Update (session 2):** the live retest happened (`avito_req_20260611_001222`) — transport PASS but business relevance
FAIL → see the session above (DEC-095).

---

## Session: 2026-06-10 — Workflow 09 prepared for FIRST live Apify smoke (actor fatihtahta~avito-russia-scraper)

**What was done (wire WF09 for first live Avito smoke; fixture-safe defaults; not run):**
- **WF09** (`…v003-live-smoke-fatihtahta`): `apify_actor_id='fatihtahta~avito-russia-scraper'` (tilde, not slash);
  added `live_max_items=3` + `start_urls` (Moscow «кредитный брокер» search). Apify body now exactly
  `{ "limit": live_max_items||max_items, "startUrls": JSON.stringify(start_urls) }` — removed queries/maxItems/region.
  Auth unchanged (genericCredentialType + httpHeaderAuth, placeholder; `Authorization: Bearer <APIFY_TOKEN>`), no token
  in file/URL. Normalize now maps fatihtahta fields: url||sourceUrl, validFrom, priceText||price, sellerName||seller,
  parentSourceUrl→query, listing_id from URL trailing digits; missing description omitted (not invented).
- **Defaults stay fixture-safe:** `fixture_mode=true`/`live_mode=false` → Apify node does not run; fixture path
  re-simulated unchanged (6 emitted). Live run = `fixture_mode=false`/`live_mode=true`/`include_irrelevant_control_fixture=false`/
  `live_max_items=3` + bound Apify credential.
- **Verified (sim):** JSON VALID; active=false; actor tilde-format; body limit+startUrls only; no real keys/Spreadsheet
  ID; 40/15/21 cols preserved; Apify only on IF false branch; mock actor items map correctly + stable
  `avito_listing_<id>` dedup; no tool_use/KEY=VALUE. WF04/05/06/07/08 untouched.
- **Important:** live smoke **prepared but NOT run** — real Avito scrape still untested (source cost $0). 0 items on a
  live run = source/input issue, not pipeline failure.
- Docs: WF09 RU, STAGE_3_3_TEST_RESULTS (Test 3 first live smoke), STAGE_3_3 plan, COSTS, NEXT_ACTIONS, AGENT_LOG,
  core/hot/recent. (No DECISIONS.md edit this task — referenced as live-smoke prep, 2026-06-10.)

**Next operator action:** (A) WF08 handoff retest → (B) optional WF09 duplicate → (C) FIRST live Apify smoke after
approval (bind Apify header cred, fixture_mode=false/live_mode=true/live_max_items=3, run once, record Apify cost) →
WF08 with `agent_request_id_filter=<live run id>`.
