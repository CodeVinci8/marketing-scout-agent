# Stage D — Source-Quality Validation (FILE 1 master plan)

Owner-run acceptance of the **persisted** controlled sample. Zero new provider calls, $0.
Evidence read directly from the live n8n execution store (WF08 exec **410**, WF10 exec **414**,
final `report_bundle` for `report_20260705_125958`) via read-only `node:sqlite` + `flatted`.

Request family under review: **`req_90112771`** (Website + Telegram Public; no Avito/VK in this plan).

## Method / evidence classification

| Evidence type | Used for |
|---|---|
| static contract proof | raw_market_records schema (canonical relevance field = `confidence_score`, 0–100; no `relevance_reason` column) |
| offline fixture proof | WF09 Avito parser suites; WF11 Telegram normalizer (`wf11_tme_s_preview_sample.html`) |
| workflow topology proof | WF04→WF16→WF08→WF10→WF12 callable chain (active) |
| provider HTTP proof | website records = real Firecrawl extraction text; Telegram = t.me/s preview parse |
| persisted-row proof | 12 selected records for req_90112771 (WF08 "Filter & Select Records") |
| manual relevance proof | full-text inspection of every accepted record (below) |
| end-to-end delivery proof | report_bundle (competitors/offers/source_quality) |

## Controlled-sample acceptance matrix (sanitized; public business data only)

**Website (WF04 / Firecrawl) — 3 collected, 2 accepted, 1 correctly excluded**

| # | source_url | quality | relevant? | dedup_key | disposition | reason |
|---|---|---|---|---|---|---|
| W1 | https://mkbkfin.ru/ | healthy | YES (кредитный брокер: залог/ипотека/рефинанс/потреб, плохая КИ) | website::scraped_web::mkbkfin.ru | accepted→competitor | operator competitor domain, real services |
| W2 | https://www.lioncredit.ru/ | healthy | YES (залог ПТС/авто/недвиж, рефинанс, ипотека) | website::scraped_web::lioncredit.ru | accepted→competitor | operator competitor domain, real services |
| W3 | https://finardi.ru/ | degraded | YES (broker) | website::scraped_web::finardi.ru | **excluded_by_health** | degraded extraction — correctly held out of the report |

**Telegram Public (WF11) — 10 selected, 10 accepted (all materially relevant on full-text read)**

All per-post canonical URLs are `t.me/<channel>/<postId>`; dedup_key `telegram::social_channel::<canonPostUrl>`.
Channels: `mfo_market` (title "Кредитный брокер Москва") ×8, `da_credit` ×2 — both configured channels.

| # | post_url | class | relevant credit-broker angle |
|---|---|---|---|
| T1 | t.me/mfo_market/223 | market_signal | 115-ФЗ freeze harming кредитную историю of ИП/бизнес |
| T2 | t.me/mfo_market/224 | market_signal | поручительство → "убитая кредитная история" |
| T3 | t.me/mfo_market/226 | market_signal | «спишем долги без банкротства» scam warning (долги/банкрот) |
| T4 | t.me/mfo_market/227 | market_signal | «Кредитный доктор» credit-repair program (плохая КИ) |
| T5 | t.me/mfo_market/228 | market_signal | credit history costing a job offer (просрочка/банкрот) |
| T6 | t.me/mfo_market/229 | competitor_activity | автокредит без взноса — author self-IDs as кредитный брокер |
| T7 | t.me/mfo_market/230 | market_signal | mass applications damaging кредитную историю |
| T8 | t.me/mfo_market/231 | market_signal | how to check your кредитную историю |
| T9 | t.me/da_credit/593 | market_signal | ПДН / «белая» зарплата lending-rule change |
| T10 | t.me/da_credit/595 | market_signal | 10 refusals / bank stop-list (loans after refusals) |

> Correction logged: T5 ("Проверка СБ при приёме на работу…") looks like HR noise in its first line
> but its full text pivots to credit history — genuinely in scope (poor-credit-history area). No false
> positive. Manual full-text inspection (not keyword truncation) confirmed **relevance precision = 12/12 = 100%**.

## Evidence markers (this sample)

```
SOURCE_QUALITY_WEBSITE_SAMPLE_SIZE=3
SOURCE_QUALITY_WEBSITE_ACCEPTED=2
SOURCE_QUALITY_WEBSITE_REJECTED=1        # finardi.ru degraded → excluded_by_health (correct)
SOURCE_QUALITY_AVITO_SAMPLE_SIZE=0       # no Avito records persisted for req_90112771 (not in plan)
SOURCE_QUALITY_AVITO_ACCEPTED=0
SOURCE_QUALITY_AVITO_REJECTED=0
SOURCE_QUALITY_TELEGRAM_SAMPLE_SIZE=10
SOURCE_QUALITY_TELEGRAM_ACCEPTED=10
SOURCE_QUALITY_TELEGRAM_REJECTED=0       # upstream collection rejects; this persisted set is post-filter
SOURCE_QUALITY_VK_POST_SAMPLE_SIZE=0     # VK tested last (per FILE 1); not collected for this request
SOURCE_QUALITY_VK_COMMENT_SAMPLE_SIZE=0
SOURCE_QUALITY_RELEVANCE_PRECISION_PERCENT=100   # manual full-text, 12/12
SOURCE_QUALITY_FINAL_DUPLICATES=0                # 12 distinct post_urls/domains; stable dedup_key
SOURCE_QUALITY_BAD_URLS=0                         # all canonical https; per-post t.me links
SOURCE_QUALITY_PLACEHOLDER_ROWS=0                # no {} / empty / provider-error rows accepted
SOURCE_QUALITY_PUBLIC_CONTACT_POLICY=respected   # contact only if verbatim public; none in sample
SOURCE_QUALITY_PROVENANCE=traceable              # source_record_id → source_run_id family → url
SOURCE_QUALITY_REQUIRED_FIELDS_PERCENT=telegram:100 website:fixed_pending_repersist
STAGE_D_SOURCE_QUALITY=IN_PROGRESS
```

## Defect found + fixed this session

**RELEV-WEB-001 (commit `aaee541`, DEPLOYED to WF04):** website records were persisted with an EMPTY
relevance signal (`confidence_score=''`, `semantic_keywords=''`, no rationale) while Telegram records carry
`confidence_score` (45/70) + a specific reason — failing Stage D "required fields 100%" / "specific
relevance explanation". Root cause: WF04 `Build Canonical Raw Record` never emitted those fields. Fixed with
an evidence-grounded confidence tier (healthy competitor 70 +5/service ≤90; degraded 50; quarantined 10;
market page 45) + content-derived `semantic_keywords` + Russian `relevance_reason`. Regression:
`tests/test_wf04_relevance_score.js` (27). Deployed via surgical splice (id `k4ob2TaXvCx6IDrm`, active
preserved, 11 credentials intact). **Live re-persist of the historical website rows is deferred to the next
Stage F/G live run** (re-running WF04 now = paid Firecrawl recollection, disallowed for a test-only replay).

## Why STAGE_D_SOURCE_QUALITY is not PASS yet

- Website field-completeness fix is deployed but the **persisted** historical website rows still show the
  empty relevance field until one live re-collect (bundled into Stage F/G).
- **Avito**: zero persisted sample → a bounded live Avito acceptance sample is required (≤3 queries,
  operator budget-gated) OR offline WF09-fixture acceptance recorded as interim.
- **VK**: tested last (FILE 1) — pending, using the protected token, public communities only.

Website + Telegram Public **relevance precision / dedup / URL validity / placeholder / contact policy** all
PASS on the persisted sample.

---

## Website FRESH-LIVE closure (RELEV-WEB-001 + FORCE-REPROCESS-001), 2026-07-06

Per the operator's fresh-live acceptance policy, RELEV-WEB-001 was re-verified on NEW production data
(not the historical req_90112771 rows). A second defect surfaced and was fixed first:

**FORCE-REPROCESS-001 (commit `70c90a6`, deployed):** WF04 `Set URL List` only honored boolean
`force_reprocess`, but the callable trigger types it as a string — so agent-driven re-collection of an
already-registered domain was always dedup-skipped (no fresh rows possible). Fixed to accept `'true'`;
regression `tests/test_wf04_force_reprocess.js` (5). Full `make test` PASS; deployed by surgical splice.

**Fresh live run:** new request `req_web_sd_20260706`, URLs mkbkfin.ru / lioncredit.ru / finardi.ru,
`force_reprocess=true`, `data_mode=live`. **WF04 exec 427** — 3 live Firecrawl `/v2/scrape` + 3 Claude
primary (+1 repair) calls; **3 new rows appended to raw_market_records**. Downstream **WF16→WF10→WF12**
(exec 433/434/435) — the real orchestrator order (WF16 first; WF10 correctly fail-closes without
source_health, which is why an interim WF08→WF10→WF12 chain read NO DATA — not a code defect).

**New persisted rows (all 3, exec 427):**
| url | quality | confidence_score | offer/prices extracted | report_eligible |
|---|---|---|---|---|
| mkbkfin.ru | healthy | 90 | залог имущества, ипотека, рефинансирование, плохая КИ | true |
| finardi.ru | healthy | 90 | залог недвижимости **от 9,5%**, залог авто, рефинанс, без предоплаты, комиссия 0–10% | true |
| lioncredit.ru | degraded | 75 | **ставка от 4,99%, до 100 млн**, наличные, рефинанс, залог, ипотека | false (degraded) |

All carry a specific Russian `relevance_reason` + content-derived `semantic_keywords`. Required-field
check: **0/27 missing**. **WF12 exec 435** report `rows_after_filters=2`, competitors Финарди + МКБК finance,
and "Сайты конкурентов" lists all 3 domains with real content + prices — traceable to the supplied URLs.

```
RELEV_WEB_001_FRESH_LIVE_RUN=PASS        # WF04 exec 427
WEBSITE_NEW_ROWS_PERSISTED=PASS          # 3 rows, req_web_sd_20260706
WEBSITE_RELEVANCE_SIGNAL_PERSISTED=PASS  # confidence_score 90/90/75 + relevance_reason + semantic_keywords
WEBSITE_REQUIRED_FIELDS_PERCENT=100      # 0/27 missing
WEBSITE_FINAL_DUPLICATES=0               # 3 distinct dedup_keys
WEBSITE_BAD_URLS=0                       # all canonical https
WEBSITE_REPORT_TRACEABILITY=PASS         # WF12 exec 435: 2 competitors + 3 sites w/ prices traceable
```

Provider cost (best-available; cost telemetry `unknown`): Firecrawl 3 scrapes + Claude 4 calls, projected
<$0.10; cumulative live cost this cycle well under the $10 ceiling.

**Follow-ups noted (NOT Website source-quality; deferred to their stages):** (1) WF10 competitor "conf" shows
45 vs the raw `confidence_score` 90 — Stage E scoring reconciliation; (2) "Публичных лид-сигналов: 999" =
phantom rows from ~999 legacy blank raw_market_records rows — Stage G/persistence hygiene; (3) a minor
`](https://www` markdown artifact in the lioncredit CTA line — Stage G report render.
