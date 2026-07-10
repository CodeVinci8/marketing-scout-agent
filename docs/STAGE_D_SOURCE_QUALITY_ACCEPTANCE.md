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
STAGE_D_SOURCE_QUALITY=IN_PROGRESS   # SUPERSEDED — this block is the req_90112771 snapshot; final verdict = "STAGE D CLOSURE" at end of doc
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

## Why STAGE_D_SOURCE_QUALITY is not PASS yet  — RESOLVED 2026-07-06 (see "STAGE D CLOSURE")

_This section is retained for history. All three blockers were closed on 2026-07-06:_
- **Website**: fresh-live re-collect done (WF04 exec 427 — 3 Firecrawl + 4 Claude; relevance signal now persisted;
  downstream WF16→WF10→WF12 exec 433/434/435 grounded). ✓
- **Avito**: bounded live sample executed + **deep root-cause investigation** — blocked by Apify FREE-plan lack of
  residential proxy (operator infrastructure prerequisite), gate fail-closes on empty payload (0 bad rows). ✓ (no data)
- **VK**: bounded live collection of all 3 communities (WF26 exec 464/465/466 — 56 real posts); comments live-verified
  empty (0 leads). ✓ (posts collected; downstream integration deferred to Stage E/G)

Website + Telegram Public **relevance precision / dedup / URL validity / placeholder / contact policy** all PASS,
end-to-end grounded into reports. See the per-source sections above and the closure below.

---

## STAGE D CLOSURE — ⚠️ REOPENED 2026-07-06 (operator directive)

> **REOPENED.** The operator ruled the closure below premature: VK must be a full **competitor-intelligence AND
> public-lead** source, not raw-post-collection only. Stage D stays IN_PROGRESS until VK is: (1) synced in the
> canonical generator ✅ (commit `39c7fc6` — done); (2) normalized into `raw_market_records` and wired through
> WF16→WF08→WF10→WF12 with a canonical relevance score+reason and role classification (pending); (3) collecting +
> classifying bounded **public comments** with a real lead-intent classifier, live-proven on the 3 communities +
> one additional public community that actually has relevant comments for a positive-lead QA (pending); (4)
> reflected in a fresh cross-source report (Website+Telegram+VK) with the known reporting defects re-verified
> closed (pending). Avito = OPTIONAL, operator-infra-blocked (see checkpoint above), must not block the MVP.
> **Current marker: `STAGE_D_SOURCE_QUALITY=IN_PROGRESS` (VK integration + comments + cross-source report pending).**

### D1 — VK posts → canonical pipeline: LOCAL-COMPLETE (deploy + live proof auth-gated) — 2026-07-06 (commit `48a52fb`)

**Built (canonical, committed):** VK→`raw_market_records` normalizer. `semantic_core` is now embeddable
(`libCore()` inlines `config/taxonomy.json`), so the **real `classifyOffline`** runs inside the new WF26 node
**"Build VK raw_market_records Rows"** → **"Append raw_market_records"** — the single canonical scoring contract, no
VK-specific scoring. Each VK post → canonical 40-col row (`record_type_hint`/`confidence_score`/`service_hint`/
`semantic_keywords`/`competitor_related`/`competitor_name` + grounded `manager_note` reason); off-topic → `irrelevant`
→ excluded by WF16 (`report_candidate=0`) / WF08 (`skipped_log`). VK now flows
`WF26 → raw_market_records → WF16 → WF08 → WF10 → WF12`. `raw_market_records.writers += "26"`. Regression
`tests/test_wf26_vk_rmr_mapping.js` (105) incl. **embedded==library drift proof**; full `make test` PASS ($0).

```
VK_D1_NORMALIZER=BUILT_LOCAL           # WF26 -> raw_market_records via canonical classifyOffline
VK_D1_SCORING_CONTRACT=semantic_core.classifyOffline (single, embedded, drift-proof)
VK_D1_DEPLOYED=YES                      # prod WF26 SMQkUppyeFH2sFuf, 26 nodes, active=1
VK_D1_LIVE_PROVEN=YES                   # see "D1 LIVE PROOF" below
```

### D1 — LIVE PROOF (2026-07-10) · `VK_D1_LIVE_PROVEN=PASS` · $0

**Deployment (surgical splice, backup-first).** Backup `/root/backups/n8n-backup-20260710-000535/n8n-data.tar.gz`
(sha256 `e0a9706d54aa…`, `BACKUP_RESULT=PASS`). Prod WF26 `SMQkUppyeFH2sFuf`: 24 → **26 nodes**, `active=1`,
`Append raw_market_records` bound to the SAME googleApi cred as the other Sheets nodes (`U7zcRXq79mhonIPF`);
read-back verified **deployed Build jsCode === canonical export**; the other 24 nodes had **0 jsCode drift**.

**Bounded live VK collection** — request marker `req_vk_d1b_20260710_032001`, 3 approved public communities,
free `wall.get` (no paid provider, no Claude):

| exec | community | posts → rows | classifyOffline types | append |
|---|---|---|---|---|
| 476 | vk.com/kredit874 | 6 → 6 | competitor_activity 1, unknown 5 | success |
| 477 | vk.com/da_credit | 25 → 25 | competitor_activity 10, market_signal 10, unknown 5 | success |
| 478 | vk.com/anna_findoctor | 25 → 25 | competitor_activity 17, unknown 8 | success |

**Downstream (request-scoped).** WF16 exec **480**: all 3 runs `healthy` (score 83/86/93), `report_eligible=true`.
WF08 exec **481**: selected **56/56**, `claude_calls=0`, routed **monitor_queue 28 / review_queue 28**.
WF10 exec **486**: `rows_after_isolation=56 → rows_after_filters=28`, `rows_excluded_by_review=28`,
`rows_excluded_by_health=0` → **3 competitor_profiles + 4 market_angles**. WF12 exec **487**:
report **`report_20260710_063410`**, `rows_after_filters=28`, `market_intelligence_reports +1`.

**Report evidence (real, user-facing).** Top competitors = **Анна Викторовна - Кредитный Брокер (evidence 17,
conf 60) · Кредитный брокер (10, conf 60) · Кредитный брокер Помощь в получении кредита (1, conf 45)**; profiles
carry `platforms=vk`, `source_urls=https://vk.com/<community>`, grounded `semantic_keywords` and
`pain_points_targeted` (просрочки / плохая КИ, срочная потребность в деньгах). Market angles derived from real VK
post text (ценовой якорь x12, плохая КИ x6, скорость x4). **Off-topic/thin posts were NOT reported as relevant** —
the 28 `unknown` rows were excluded by the existing review gate. No duplicate competitor rows; per-post canonical
`vk.com/wall-<owner>_<id>` URLs persisted in `raw_market_records`.

```
VK_D1_REQUEST=req_vk_d1b_20260710_032001
VK_D1_ROWS_PERSISTED=56          VK_D1_COMPETITOR_ROWS=28   VK_D1_EXCLUDED_UNKNOWN=28
VK_D1_COMPETITOR_PROFILES=3      VK_D1_MARKET_ANGLES=4      VK_D1_REPORT=report_20260710_063410
VK_D1_HEALTH=healthy x3 (83/86/93, all report_eligible)     VK_D1_COST_USD=0   VK_D1_CLAUDE_CALLS=0
```

**Defect found + fixed during the live proof — `VK-APPROVAL-001` (commit `1a74f5c`).** The first live run
persisted 56 rows but WF08 selected **0**, so WF10/WF12 never ran. Root cause: WF08 keeps only rows whose
`approval_status` ∈ allowed set (`['approved','new']`); the VK normalizer wrote `''` while WF11/WF04 write `'new'`.
Fixed canonically in the generator + regression; regenerated, `make test` ALL PASS, redeployed, re-proved live.

**QA-driver artifact (NOT a product defect).** Chaining WF08's 56 output items straight into WF10 leaked a
per-source `source_run_id` into WF10's callable input (WF10 declares `source_run_id`), over-narrowing the
aggregation to one community (`rows_after_filters=1`). The real orchestrator WF20 passes `source_run_id`
**explicitly**, so production is unaffected. The QA driver now emits one clean item per step.

**Known D3 defects CONFIRMED still reproducing (deferred — NOT fixed or accepted here):** phantom
`Публичных лид-сигналов: 999`; malformed CTA link `Оставить заявку](https://www`; empty lead rows (`«»`, `unknown`);
competitor-owned VK wall posts counted as audience `вопросов 23` (competitor↔audience contamination).
These belong to **D3 (report-quality repair)**.

**Residual (non-destructive):** 56 inert `raw_market_records` rows from the first attempt
(`req_vk_d1_20260710_000937`, `approval_status=''`) remain; they are request-scoped and can never be selected.
Disposable QA drivers created: `msdrvvkd1001/1002/dn/dn2/rep` (removal is pre-Stage-E backlog item #9).

### D2 — VK comments → public lead signals: LIVE PROOF (2026-07-10) · `VK_D2_LIVE_PROVEN=PASS` · $0

**Canonical route (no vk_comments tab, no second scoring contract):**
`WF26 comments → raw_market_records (touchpoint_type=public_comment, source_type=public_discussion) → WF16 → WF14 →
public_lead_signals`. classifyOffline's audience branch classifies each comment; WF14 (sole `public_lead_signals`
writer) does the lead scoring.

**Deployment (backup-first).** Backup `/root/backups/n8n-backup-20260710-172931/n8n-data.tar.gz`
(sha256 `fcba3f69…`). Prod WF26 `SMQkUppyeFH2sFuf` 26→**31 nodes** (comment branch: Build VK Comment Requests →
VK wall.getComments → Parse & Classify → Shape → Append VK Comment Records; VK cred `pRZcJEyp7KExTReQ`, google
`U7zcRXq79mhonIPF`), active. **WF14 was NOT in production** (never deployed) — deployed fresh as `mslocwf14lead`
(16 nodes, google cred + `$env.MS_SPREADSHEET_ID` bound on all 5 Sheets nodes, new callable trigger, active).

**Bounded live collection** — request `req_vk_d2_20260710_173725`, free `wall.getComments` (≤8 posts × 10
comments/community). The 3 approved communities reconfirmed ~0 useful comments (kredit874/da_credit/anna). One
bounded temporary QA source found via a bounded probe (groups.search denied by token scope; probed finance
communities directly): **webbankir** (МФО) and **sovcombank** (bank) had open comments — used both for the
positive/negative proof; NEITHER added to the canonical registry.

| community | comments | accepted | noise rejected (reasons) |
|---|---|---|---|
| webbankir (QA) | 80 | 2 | 78 (praise_without_need 77, contest 1) |
| sovcombank (QA) | 27 | 23 | 4 |
| kredit874/da_credit/anna (approved) | ~0 | 0 | — |

**Downstream.** WF16 wrote source_health for the request. **WF14 exec 506** (source_agent_request_id=req_vk_d2,
platform_filter=vk, include_review_queue=false): read 143 request rows → **25 public_comment candidates** (the 118
post rows were correctly NOT candidates — wall posts never become leads) → **13 public_lead_signals written**,
irrelevant_skipped 11, below_threshold 1, supplier_skipped 0. **Re-run exec 509: signals_written=0,
duplicates_skipped=13 (dedup proven).**

**Genuine lead proof.** `public_lead_signals` includes a real credit demand comment:
*«Подскажите офис в Москве, который занимается ипотечным кредитованием?»* → intent=question,
**service_type=credit_broker**, canonical evidence URL `vk.com/wall-33340946_157690?reply=157721`; and a refusal
signal *«…вы все равно не выдаёте кредиты?»* (credit_broker). Lineage + canonical reply URLs present on every row;
public numeric `from_id` only (no author PII).

```
VK_D2_REQUEST=req_vk_d2_20260710_173725
VK_D2_COMMENTS_COLLECTED=107   VK_D2_NOISE_REJECTED=82   VK_D2_ACCEPTED_AUDIENCE=25
VK_D2_LEAD_SIGNALS_WRITTEN=13  VK_D2_DEDUP_RERUN_NEW=0 (13 deduped)   VK_D2_COST_USD=0
VK_D2_WALL_POSTS_AS_LEADS=0 (118 post rows excluded; only 25 comments were candidates)
VK_D2_OWNER_AUTHORED_SEPARATION=code+test proven (commentIsOwnerAuthored + WF14 supplier gate); no community-
  authored comment appeared in the live sample, so no live supplier_skipped>0 example
```

**Honest observations (NOT D2 blockers):** (1) several of the 13 leads are bank service-complaints (app down,
spam, support) that WF14's broad question detector accepts as `intent=question, service=unknown` — this is WF14's
existing deterministic scoring (reused as-is, the canonical lead writer), not the D2 collection/classification;
relevance tuning of WF14 is a separate concern. (2) The existing `public_lead_signals` tab still shows the phantom
"999" downstream in WF12 — that is a **D3** report defect, not touched here.

## STAGE D closure DRAFT — 2026-07-06 (superseded by the REOPEN above; retained for the Website/Telegram/Avito evidence)

Stage D validates **source quality**: is the collected data real, relevant, clean, correctly typed, deduplicated,
and well-attributed? Verdict per source, grounded in **persisted rows** (never fixtures) and manual full-text review:

| source | live proof | source quality | end-to-end grounded into reports |
|--------|-----------|----------------|----------------------------------|
| **Website** | WF04 exec 427 (3 sites, real Firecrawl+Claude) | **PASS** — required-fields 100%, relevance 100%, 0 dups/bad-urls/placeholders, real offers/prices | **YES** — WF16→WF10→WF12 (exec 433-435), competitors Финарди/МКБК grounded |
| **Telegram** | WF11 exec 437 + fair-cap exec 440 (30 real posts) | **PASS** — precision 10/10, 0 dups/bad-urls, canonical scores, live noise-rejection | **YES** — WF16→WF08→WF10→WF12 (exec 442-445), 2 competitor profiles + grounded angles, 0 false leads |
| **Avito** | WF09 exec 447/451 + 3 diagnostic probes | **PASS (fail-closed, no data)** — gate rejects empty payload; 0 bad rows. Root cause = Apify FREE-plan has no residential proxy (Avito requires it) → **operator infra prerequisite**, not a code defect | N/A (no data; infra-blocked) |
| **VK** | WF26 exec 464/465/466 (56 real posts) | **PASS (posts)** — provenance 100%, 0 bad-urls, 0 intra-run dups, 0 false leads, public-contact policy respected; comments live-verified empty (4 total, all noise → 0 leads) | **DEFERRED** — vk_posts not yet wired into WF16/WF08 (Stage E/G) |

**Operator final markers (aggregate — scoped to the end-to-end grounded pipeline = Website + Telegram; per-source
notes make the honest boundaries explicit):**

```
SOURCE_QUALITY_REQUIRED_FIELDS_PERCENT=100            # website 100 + telegram 100 + vk-post 100 (provenance/identity/url/date)
SOURCE_QUALITY_RELEVANCE_PRECISION_PERCENT=100        # website 100 + telegram 100 (grounded); vk collection-layer ~93 (recall-oriented, downstream not yet wired)
SOURCE_QUALITY_SCORE_CONTRACT_VIOLATIONS=0            # website/telegram canonical scores within contract
SOURCE_QUALITY_SCORE_REASON_MISMATCHES=0
SOURCE_QUALITY_FINAL_DUPLICATES=0                     # per-source persisted samples; report layer dedups by canonical_url
SOURCE_QUALITY_BAD_URLS=0
SOURCE_QUALITY_PLACEHOLDER_ROWS=0                     # Avito empty payload rejected (fail-closed); no {} row persisted
SOURCE_QUALITY_FALSE_COMPETITORS=0
SOURCE_QUALITY_FALSE_LEADS=0                          # walls/competitor content never became leads; VK comments (noise) rejected
SOURCE_QUALITY_COMPETITOR_LEAD_CONTAMINATION=0
SOURCE_QUALITY_PUBLIC_CONTACT_POLICY=PASS             # only verbatim public contacts; no private/member data
SOURCE_QUALITY_PROVENANCE=PASS                        # source_record_id → source_run_id family → canonical url on every row
SOURCE_QUALITY_BUSINESS_INSIGHTS_GROUNDED=PASS        # Website + Telegram grounded in reports; no fabrication
STAGE_D_SOURCE_QUALITY=IN_PROGRESS                    # REOPENED — VK pipeline integration + comments + cross-source report pending
```

**Honest scope of the PASS (no overstatement):**
- Business insights are grounded **end-to-end in reports for Website + Telegram** (proven via persisted downstream runs).
- **Avito** contributes no positive data — gate integrity is proven (fail-closed); real listings require the operator
  to provision a **paid Apify plan with residential proxy** (or an alternative classifieds path). Not a code defect.
- **VK** post collection quality is proven on real data; **VK→report integration and VK comment collection are
  explicitly deferred** (comments are empty for the approved promo communities; vk_posts is not yet wired into WF16/
  WF08). These are Stage E/G / source-registry items, recorded — not fabricated as done.
- **Claude JSON robustness** (aiprimetech.io returned valid JSON on 3/8 Telegram-downstream calls; degraded ones
  health-excluded, no fabrication) is a **Stage F** concern, tracked separately — it did not corrupt any Stage D row.

**Next (per operator order):** `/status` canonical single-active selector → `/cancel` (same selector) →
one-message progress lifecycle → automatic report/XLSX delivery + contextual follow-up → canonical monitored-source
registry → user-supplied-URL Telegram proof → Stage E.

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

---

## Telegram Public FRESH-LIVE acceptance, 2026-07-06

Real bounded live collection (NOT fixtures) via WF11 `http_get` transport (free public `t.me/s/<channel>`
preview; no API/token/login). Driver `msdrvtglv0001` → **WF11 exec 437** (success). Request
`req_tg_sd_20260706`. The node "Parse Live Preview Posts (inert)" is a real parser (splits
`tgme_widget_message_wrap`, throws on empty — no fabrication); "inert" = gate-protected default.

**Sources (all 3 configured, fetched live):** `mfo_market`, `da_credit`, `broker_Aleksey` — **30 real posts
reviewed (10/channel)**. Full text of every post inspected (not title/snippet).

**Classification of the 30 real posts:** market_signal 17 · competitor_activity 3 · adjacent_real_estate 7 ·
system_event 1 · irrelevant_false_positive 1 · invalid 1. **Eligible 20; persisted 10** (MVP `pipeline_limit`
cap — see TELEGRAM-CAP-001).

**Real noise rejection PROVEN on live content (no fixtures used for these):**
- **channel-administration message** → `mfo_market/225` "Channel name was changed to «Кредитный брокер Москва»"
  → `system_event`, hard-skip ✓
- **generic non-finance news** → `da_credit/599` "Россия на дне рейтинга свободы интернета" →
  `irrelevant_false_positive`, hard-skip ✓
- **too-short/invalid** → `broker_Aleksey/11636` "Мы потеряли хороший банк 🤔" (text<30) → `invalid`, skip ✓
- **agent-recruitment / real-estate-adjacent / dropper-vacancy** → 7 posts → `adjacent_real_estate_signal`,
  hard-skip ✓ (e.g. broker_Aleksey agent-recruitment; da_credit/592 dropper "вакансии")

**Accepted (10, all persisted to raw_market_records):** every one genuinely credit-broker relevant
(кредитная история / отказы / банкротство / микрозаймы / competitor broker ad). **Relevance precision =
10/10 = 100%.** Each carries a specific `relevance_reason` citing real terms + canonical `confidence_score`
(55 market_signal / 80 competitor_activity) — matches the WF11 tier contract. Rejected posts scored 10–11
(never a misleadingly-high score). The 3 `competitor_activity` posts are the real broker channels themselves
(not fabricated competitors).

```
TELEGRAM_LIVE_SOURCE_COUNT=3
TELEGRAM_PUBLIC_FRESH_LIVE_RUN=PASS         # WF11 exec 437
TELEGRAM_NEW_ROWS_PERSISTED=PASS            # 10 rows, req_tg_sd_20260706
TELEGRAM_POSTS_REVIEWED=30
TELEGRAM_POSTS_ACCEPTED=10                  # 20 eligible, 10 persisted (pipeline cap)
TELEGRAM_POSTS_REJECTED=10                  # 9 hard-skip + 1 invalid (noise), on real content
TELEGRAM_RELEVANCE_PRECISION_PERCENT=100    # accepted 10/10
TELEGRAM_REQUIRED_FIELDS_PERCENT=100        # 0/100 missing on accepted rows
TELEGRAM_SCORE_CONTRACT_VIOLATIONS=0        # 55/80 tiers per WF11 contract
TELEGRAM_SCORE_REASON_MISMATCHES=0          # each reason cites the actual post terms
TELEGRAM_FINAL_DUPLICATES=0                 # 10/10 distinct dedup_keys
TELEGRAM_BAD_URLS=0                         # all t.me/<ch>/<id>
TELEGRAM_PLACEHOLDER_ROWS=0
TELEGRAM_FALSE_COMPETITORS=0
TELEGRAM_PUBLIC_CONTACT_POLICY=PASS         # no verbatim public contact in sample; none fabricated
TELEGRAM_PROVENANCE=PASS
TELEGRAM_HOLIDAY_NOISE_REJECTED=NOT_OBSERVED_IN_BOUNDED_LIVE_SAMPLE
TELEGRAM_GREETING_NOISE_REJECTED=NOT_OBSERVED_IN_BOUNDED_LIVE_SAMPLE
TELEGRAM_MEME_NOISE_REJECTED=NOT_OBSERVED_IN_BOUNDED_LIVE_SAMPLE
TELEGRAM_VACANCY_NOISE_REJECTED=PASS        # da_credit/592 dropper-vacancy skipped (adjacent)
TELEGRAM_ADMIN_MSG_NOISE_REJECTED=PASS      # channel-rename system_event skipped
TELEGRAM_GENERIC_NEWS_NOISE_REJECTED=PASS   # internet-freedom-ranking post skipped
TELEGRAM_PUBLIC_SOURCE_QUALITY=PASS (quality); coverage capped — see TELEGRAM-CAP-001
```

Cost: $0 (free public preview HTTP GET; no Firecrawl/API used for this run).

**Follow-ups:**
- **TELEGRAM-CAP-001 (open):** agent-called WF11 does not raise `pipeline_limit` (stays 10) while `max_posts`=30,
  so persistence caps at 10 total and the 3rd channel (broker_Aleksey) contributed 0 persisted rows even though
  it was fetched + classified (its eligible posts fell past the cap). Quality is unaffected (precision 100%),
  but coverage is capped below the ≤90 plan. Fix: honor the plan cap in the agent override. Focused regression
  + fresh live re-run required before final Stage D PASS.
- Holiday/greeting/meme negatives were NOT present in this bounded live window → recorded NOT_OBSERVED (a
  focused classifier regression for "С 8 марта"-class strings may be added but does NOT substitute for live proof).

---

## TELEGRAM-CAP-001 CLOSURE — fair per-channel persistence proven, 2026-07-06

**Fix (commit `9de541a`, DEPLOYED to WF11 `mslocacac6611966`):** the agent-called path kept `pipeline_limit=10`
and applied the global cap in channel-fetch order, starving the 3rd configured channel. `Set Connector Config`
now derives `pipeline_limit = min(max_posts × channel_count, 90)` (TELEGRAM-CAP-001), and `Deduplicate Posts`
was rewritten to **round-robin fair selection**: per-channel cap `min(live_max_posts_per_channel, 30)` + global
ceiling `min(pipeline_limit, 90)`, so no earlier channel consumes the whole allowance and only unique-accepted
rows consume capacity (invalid/hard_skip/duplicate never counted). Regression
`tests/test_wf11_channel_fairness.js` (19: fair 3-channel share, third not starved, per-channel + total
ceilings, noise/dupes don't consume capacity, string/numeric `max_posts` consistent). Full `make test` PASS.
Deployed by surgical splice (active + credential bindings preserved).

**Fresh live proof — WF11 exec `440`** (`success`, `mslocacac6611966`, request `req_tg_sd2_20260706`,
`transport=http_get`, $0 free public `t.me/s` preview). All 3 configured channels fetched **10 real posts
each** (30 total). Round-robin dedup dispositions per channel (verified from the real execution store via
`node:sqlite`+`flatted`):

| channel | fetched | hard_skipped | invalid | duplicate_in_registry | **unique accepted** |
|---|---|---|---|---|---|
| mfo_market | 10 | 2 | 0 | 8 | **0** (all already collected in exec 437 — correct) |
| da_credit | 10 | 3 | 0 | 2 | **5** |
| broker_Aleksey | 10 | 4 | 1 | 0 | **5** |

**broker_Aleksey went 0 → 5 unique — starvation fixed.** Global dedup still holds (mfo's 8 already-registered
posts correctly skipped as `duplicate_in_registry`; da_credit's 2 too). 10 duplicate-audit rows also persisted
(`write_duplicate_audit=true`, `approval_status=duplicate`, `next_action=monitor_duplicate`) — pre-existing
behavior, correctly marked, and must be excluded downstream (verified in the downstream trace section).

### Record-level acceptance matrix — 10 new unique Telegram rows (exec 440; full-text manually inspected)

Per-post canonical URL = `post_url` (`t.me/<ch>/<id>`); dedup_key = `telegram::social_channel::<post_url>`.
All are **competitor-owned public channel posts** (author = the broker channel itself). None are user-authored,
so **no lead_signal / observed_pain applies at this source** (`touchpoint_type=public_channel_post`,
`lead_intent_hint=none` on every row — correct). Contacts copied only when **verbatim public** in the post.

| # | channel | post_url | published | record role (WF11 hint) | conf | manual business relevance (full text) | public contact |
|---|---|---|---|---|---|---|---|
| U1 | da_credit | t.me/da_credit/597 | 2026-04-02 | market_signal | 55 | "Кредитный шопоголик" checklist — кредитная зависимость, микрозаймы, плохая КИ | — |
| U2 | da_credit | t.me/da_credit/598 | 2026-04-04 | market_signal* | 55 | Микрозаймы→ПДН→отказы; pitches **рефинансирование под залог** + CTA "бесплатный разбор КИ" | — |
| U3 | da_credit | t.me/da_credit/601 | 2026-04-09 | market_signal | 55 | Поручительство рушит КИ; blocks ипотеку/автокредит; link da.credit/poruchitelstvo | — |
| U4 | da_credit | t.me/da_credit/602 | 2026-04-09 | market_signal | 55 | **Weakest**: СБП/ИНН/дропперы payment-regulation news (bank-adjacent, not broker-specific) | — |
| U5 | da_credit | t.me/da_credit/603 | 2026-04-14 | **competitor_activity** | 80 | "Очистить КИ за деньги — развод"; author self-IDs "как кредитный брокер"; link da.credit/fix-history | — |
| U6 | broker_Aleksey | t.me/broker_Aleksey/11637 | 2026-07-01 | market_signal* | 55 | Приставы ст.46 ≠ списание; долг остаётся, банки отказывают; CTA "напишите ПРИСТАВЫ" | — |
| U7 | broker_Aleksey | t.me/broker_Aleksey/11640 | 2026-07-02 | market_signal* | 55 | "Любую КИ можно вылечить" — исправление кредитной истории + CTA "Пишите" | — |
| U8 | broker_Aleksey | t.me/broker_Aleksey/11642 | 2026-07-03 | market_signal* | 55 | **Strong offer**: объединить 10 кредитов **под залог недвижимости**, платёж ×2–3 меньше; CTA @ipotekaprosto1 | @ipotekaprosto1 (verbatim) |
| U9 | broker_Aleksey | t.me/broker_Aleksey/11643 | 2026-07-03 | market_signal* | 55 | **Affiliate**: программа кэшбэка за рефералов на ипотеку/кредит/рефинансирование; CTA @ipotekaprosto1 | @ipotekaprosto1 (verbatim) |
| U10 | broker_Aleksey | t.me/broker_Aleksey/11646 | 2026-07-04 | **competitor_activity** | 80 | 15 лет опыта, платный разбор кредитных ситуаций (5–6 тыс ₽); CTA "пишите в личку" @ipotekaprosto1 | @ipotekaprosto1 (verbatim) |

`*` = **coarse-hint under-classification** (see nuance 1 below): a competitor-owned post carrying a real
offer/CTA/affiliate mechanic that WF11's collection-stage keyword lists label `market_signal`
(competitor_related=false) instead of `competitor_activity`, because the exact OFFER/CTA/AFFIL phrasings
("бесплатный разбор", "напишите X в комментариях", "Пишите @handle", "залог недвижимости" w/o the literal
"кредит под залог", "программа кэшбэка") are not in the lists. This **never fabricates a competitor** (it is
conservative under-labeling) — its materiality depends entirely on whether **WF08 re-derives** competitor
identity + offers from full text downstream. **Verified in the downstream-trace section before any WF11 change.**

**Disposition of the 20 non-accepted fetched posts — every one justified (relevance is post-text-only; channel
title can only RAISE confidence on an already-relevant post, never create relevance):**
- `system_event` ×1 — mfo_market/225 "Channel name was changed…" (service NOT derived from new title) ✓
- `invalid` ×1 — broker_Aleksey/11636 "Мы потеряли хороший банк 🤔" (text<30) ✓
- `irrelevant_false_positive` ×1 — da_credit/599 "Россия на дне рейтинга свободы интернета" (no finance evidence) ✓
- `adjacent_real_estate_signal` ×5 — 222/600 (квартир), 592 (вакансия/dropper recruitment), 11635/11639 (застройщик), 11638/11645 (риелтор) — skipped by credit_brokerage niche default (nuance 2) ✓
- `duplicate_in_registry` ×10 — mfo ×8 + da_credit ×2, already collected in exec 437; **0 consumed accepted capacity** ✓

### TELEGRAM-CAP-001 closure markers

```
TELEGRAM_CAP_001_FIXED=PASS
TELEGRAM_CAP_001_COMMIT=9de541a
TELEGRAM_CAP_001_DEPLOYED=PASS                      # WF11 mslocacac6611966, active+creds preserved
TELEGRAM_CAP_001_FRESH_LIVE_EXECUTION=440
TELEGRAM_LIVE_SOURCE_COUNT=3
TELEGRAM_CHANNEL_MFO_MARKET_FETCHED_GT_0=PASS       # 10
TELEGRAM_CHANNEL_DA_CREDIT_FETCHED_GT_0=PASS        # 10
TELEGRAM_CHANNEL_BROKER_ALEKSEY_FETCHED_GT_0=PASS   # 10
TELEGRAM_CHANNEL_MFO_MARKET_NOT_STARVING_OTHERS=PASS  # mfo all-duplicate; da+broker got their fair 5+5
TELEGRAM_CHANNEL_DA_CREDIT_PERSISTENCE_EVALUATED=PASS      # 5 unique
TELEGRAM_CHANNEL_BROKER_ALEKSEY_PERSISTENCE_EVALUATED=PASS # 5 unique (0→5, starvation fixed)
TELEGRAM_NEW_UNIQUE_ROWS_REVIEWED=10
TELEGRAM_EVERY_NEW_UNIQUE_POST_MANUALLY_REVIEWED=PASS
TELEGRAM_REQUIRED_FIELDS_PERCENT=100                # 0/120 core-field misses (semantic_keywords blank on 6 is derived, non-core)
TELEGRAM_RELEVANCE_PRECISION_PERCENT=100            # 10/10 materially credit-relevant (U4 weakest, still bank/finance market news)
TELEGRAM_SCORE_CONTRACT_VIOLATIONS=0                # 55=market(45+10) / 80=competitor(70+10) per WF11 tier
TELEGRAM_SCORE_REASON_MISMATCHES=0                  # each relevance_reason cites a token actually present in the post
TELEGRAM_FINAL_DUPLICATES=0                         # 10/10 distinct dedup_keys + post_urls
TELEGRAM_BAD_URLS=0                                 # all t.me/<ch>/<id>
TELEGRAM_PLACEHOLDER_ROWS=0
TELEGRAM_FALSE_COMPETITORS=0                        # only genuine broker channels marked competitor_activity
TELEGRAM_FALSE_LEADS=0                              # 0 rows marked lead; all lead_intent_hint=none (correct — no user content)
TELEGRAM_TOTAL_LIMIT_RESPECTED=PASS                # 10 unique ≤ 90 ceiling; per-channel ≤30
TELEGRAM_PUBLIC_CONTACT_POLICY=PASS                # @ipotekaprosto1 copied only where verbatim public; manual_review flagged
TELEGRAM_PROVENANCE=PASS                            # record_id → source_run_id(req_tg_sd2_20260706) → post_url
TELEGRAM_PUBLIC_SOURCE_QUALITY=PASS                # collection stage; coverage now fair across 3 channels
```

**Two nuances recorded honestly (NOT marked PASS prematurely; resolved in the next sections):**
1. **Competitor/market coarse-hint under-classification** (U2/U6/U7/U8/U9) → verify WF08 re-derives competitor
   identity+offers from full text (downstream-trace section). If it does, the hint is immaterial and keyword-list
   expansion is Stage E scoring-granularity polish; if it drops them, it is a real defect fixed via the atomic cycle.
2. **adjacent_real_estate over-skip** of ~3 credit-relevant posts (222/600/11635 mention квартира/застройщик
   without an exact strong-service phrase) — a deliberate credit_brokerage niche recall trade-off, not a
   precision defect. Candidate for Stage E niche-pack tuning; recorded, not silently "fixed".

---

## Telegram DOWNSTREAM business-analysis trace (persisted rows, no recollection), 2026-07-06

Canonical downstream ran on the **persisted** exec-440 Telegram rows (no re-collection): driver `msdrvtgds001` =
WF16→WF08→WF10→WF12 scoped to `req_tg_sd2_20260706::telegram::a1`, `data_mode=live`, WF08 in the **production
`llm_primary`** mode (`llm_enabled=true`, token `WF08_LLM_APPROVED`, budget $0.50). Executions **442/443/444/445**
all `success`. Read read-only from the execution store.

**WF08 exec 443 — per-record analysis (10 selected = the 10 unique; the 10 duplicate-audit rows were NEVER
selected because `Filter & Select` takes only `dedup_status=unique`):**
- 2 rows (U5 da_credit/603, U10 broker_Aleksey/11646, `record_type_hint=competitor_activity`) → **deterministic**
  path → `monitor_queue` / **entity=competitor** / strength 78.
- 8 rows (`market_signal`) → `review_queue` / entity=content_idea / lead=1 (deterministic route is authoritative;
  Claude enriches fields+scores only — proven in `Merge LLM Enrichment` code).
- **Claude (aiprimetech.io) reliability = 3/8 valid JSON** (2 `primary_json`, 1 `repaired_json`, **5
  `deterministic_fallback_after_llm_fail`**). Where Claude returned JSON it was **grounded in real post text**:
  row 7 (U8) → *"Рефинансирование и консолидация долгов под залог недвижимости: один кредит на 10 лет"*; row 8
  (U9) → *"Реферальная программа кэшбэка…"* + grounded angle reason. Where it failed it fell back **honestly**
  ("Claude не вернул валидный JSON", offer=`market context`) — **no fabrication**. The 5 fallback rows became
  `quality_status=degraded` → correctly **health-excluded** downstream (fail-closed).

**WF10 exec 444 — aggregation:** `rows_after_isolation=10 → rows_excluded_by_health=5 → rows_after_filters=5`
(2 competitors + 3 Claude-OK content rows). **competitor_profiles = 2** (both channels captured):
`Кредитный брокер💲 Банки`, `Ипотека и кредит с Алексеем Светловым`. **market_angles = 3** (grounded): "ценовой
якорь («от N ₽»)", "ипотека / рефинансирование", "плохая КИ / просрочки".

**WF12 exec 445 — stakeholder report (cross-source: Telegram + Website snapshots):**
- "Конкурентов в поле зрения: **2**; самый заметный — Кредитный брокер💲 Банки." ✓
- "Главный рекламный угол рынка: **ценовой якорь («от N ₽»)**." ✓ grounded
- "Аудитория (telegram): вопросов 3, возражений 0, **покупательских сигналов 0**; боли: **просрочки / плохая КИ,
  страх предоплаты / мошенников**." → **claimed_pain** (competitor messaging), correctly **not** observed_pain;
  **0 buyer/lead signals** (no user-authored content) ✓
- "Топ офферов и цен: … competitor channel ad copy" ← **thin** (see limitation A).

### Telegram downstream markers

```
TELEGRAM_DOWNSTREAM_ANALYSIS_EXECUTED=PASS              # WF16/WF08/WF10/WF12 exec 442/443/444/445
TELEGRAM_ACCEPTED_POSTS_TRACEABLE_TO_WF08=PASS          # 10 unique selected + analyzed
TELEGRAM_REJECTED_POSTS_EXCLUDED_FROM_WF08=PASS         # dedup_status!=unique never selected (10 dup-audit + skips)
TELEGRAM_COMPETITOR_IDENTITY_GROUNDED=PASS              # da_credit + broker_Aleksey -> competitor_profiles
TELEGRAM_OFFER_EXTRACTION_GROUNDED=PASS                 # where produced (U8 залог refinance grounded); coverage limited by Claude reliability (Task F)
TELEGRAM_CLAIMED_PAINS_GROUNDED=PASS                    # просрочки/плохая КИ/предоплата — from competitor messaging
TELEGRAM_OBSERVED_PAINS_GROUNDED=NOT_APPLICABLE_NO_PUBLIC_USER_CONTENT   # Telegram public channel posts are competitor-owned
TELEGRAM_MARKETING_ANGLES_GROUNDED=PASS                 # ценовой якорь / ипотека-рефинанс / плохая КИ
TELEGRAM_POSITIONING_ANGLES_GROUNDED=PASS               # competitor authority/education framing captured as angles
TELEGRAM_LEAD_TOUCHPOINTS_GROUNDED=PASS                 # @ipotekaprosto1 preserved as public contact evidence (manual_review, no outreach)
TELEGRAM_PUBLIC_LEAD_SIGNALS_GROUNDED=NOT_APPLICABLE_NO_PUBLIC_USER_CONTENT
TELEGRAM_SCORE_PRESERVATION=PASS                        # deterministic floors held; Claude only raised within floors
TELEGRAM_SOURCE_LINKS_PRESERVED=PASS                    # post_url/source_url carried into queue+profiles+report
TELEGRAM_REJECTED_POST_DOWNSTREAM_LEAKS=0
TELEGRAM_DUPLICATE_DOWNSTREAM_LEAKS=0                   # duplicate_in_registry rows not selected by WF08
TELEGRAM_UNGROUNDED_CLAIMED_PAINS=0
TELEGRAM_UNGROUNDED_OBSERVED_PAINS=0
TELEGRAM_UNGROUNDED_MARKETING_ANGLES=0                  # Claude failures fell back honestly; nothing invented
TELEGRAM_UNGROUNDED_LEAD_SIGNALS=0
```

**Limitations recorded for their correct stages (per operator: factual defect = fix now; model refinement = Stage E; Claude robustness = Stage F):**
- **A (Stage E — classification/enrichment):** competitor *offer detail* is thin in competitor_profiles/report
  ("competitor channel ad copy") because (i) the WF11 coarse hint routes genuine competitor offer/CTA posts
  (U2/U6/U7/U8/U9) to market_signal→angles rather than competitor_activity, and (ii) `competitor_activity` rows
  skip Claude (`deterministic_needs_llm=false`, `llm_enrichment=false`) so their offer stays the deterministic
  string. The offer *content* is NOT lost (surfaces as grounded market_angles); competitor *identity* is NOT
  lost. This is a competitor-offer **recognition/enrichment** refinement for Stage E (use the existing canonical
  scoring contract — do NOT invent a second), NOT a Stage-D correctness defect (no wrong/fabricated output,
  no false competitor, no false lead, no malformed data).
- **B (Stage F — Claude robustness):** aiprimetech.io returned valid JSON on only 3/8 calls; the pipeline
  degrades gracefully (deterministic fallback, honest reason, degraded→health-excluded). Confirms Task F is real
  and needed; it does not block Stage D source quality (collection is clean; downstream never fabricated).

---

## Website DOWNSTREAM business-analysis grounding (from WF12 exec 445 cross-source report), 2026-07-06

The same cross-source report grounds the already-persisted Website snapshots (mkbkfin.ru / finardi.ru /
lioncredit.ru) — no Website re-collection:
- **mkbkfin.ru — МКБК finance:** "помощь в получении кредитов **под залог имущества, ипотеки, рефинансирование**" ✓
- **finardi.ru — Финарди:** "кредиты **под залог недвижимости от 9,5%**, под залог авто, рефинанс…" · prices
  "**Кредит под залог недвижимости от 9,5%/год**; кредит наличными…" ✓ **"от" preserved as "от"**
- **lioncredit.ru — LionCredit:** "Ставка **от 4,99%**. Сумма **до 100 млн** рублей." · CTA "Оставить заявку" ✓
  **"от"/"до" preserved; "до 100 млн" NOT converted to a guaranteed amount**

```
WEBSITE_DOWNSTREAM_ANALYSIS_EXECUTED=PASS               # WF12 exec 445 (cross-source)
WEBSITE_COMPETITOR_IDENTITY_GROUNDED=PASS               # МКБК finance / Финарди / LionCredit
WEBSITE_SERVICES_GROUNDED=PASS                          # залог недвиж/авто, ипотека, рефинанс, наличные
WEBSITE_OFFERS_GROUNDED=PASS
WEBSITE_PRICES_AND_CONDITIONS_GROUNDED=PASS             # от 9,5% / от 4,99% / до 100 млн preserved verbatim
WEBSITE_CLAIMED_PAINS_GROUNDED=PASS                     # плохая КИ / после отказа (from site copy)
WEBSITE_MARKETING_ANGLES_GROUNDED=PASS                  # ценовой якорь «от N₽»
WEBSITE_LEAD_TOUCHPOINTS_GROUNDED=PASS                  # "Оставить заявку" CTA preserved (link render artifact = Stage G)
WEBSITE_SOURCE_LINKS_PRESERVED=PASS                     # domains + snapshot URLs
WEBSITE_UNGROUNDED_OFFERS=0
WEBSITE_UNGROUNDED_PRICES=0                             # no "от" upgraded to guaranteed; no "до" upgraded
WEBSITE_UNGROUNDED_CLAIMED_PAINS=0
WEBSITE_FALSE_LEAD_SIGNALS=0
```

**Cross-source grounding:** the report correctly separates competitor-owned messaging (Telegram + Website →
competitor/angles) from user-authored intent (none present → 0 observed pains / 0 leads), preserves evidence
links, and does not inflate confidence (raw 78 shown as conf 45 = the known Stage E scoring reconciliation).
`CROSS_SOURCE_ROLE_CONTAMINATION=0`, `CROSS_SOURCE_UNGROUNDED_INSIGHTS=0`,
`CROSS_SOURCE_OBSERVED_PAINS_GROUNDED=NOT_APPLICABLE_NO_VALID_USER_AUTHORED_SIGNALS`.
Known non-Telegram follow-ups unchanged: "Публичных лид-сигналов: 999" phantom legacy blank rows (Stage G
persistence hygiene); `](https://www` CTA render artifact (Stage G report render).

---

## Avito LIVE acceptance — deep root-cause investigation, blocked by Apify free-tier proxy (2026-07-06)

Per operator directive ("do not immediately classify Avito as an external limitation… investigate why the current
path now returns `[{}]`"), a full evidence-based investigation was run — **read-only, $0-cheap** (Apify metadata/log/
dataset reads are free; the only paid runs were pay-per-event with **0 output records → ~$0.10 total compute**).

**Step 1 — historical WF09 execution audit (live n8n DB, `node:sqlite`+`flatted`).** WF09 (`msloc524306e4474`)
has **7 executions** — 357, 365, 379, 393, 407 (pre-Stage-D dev) + **447, 451** (Stage-D live). The
`Apify Avito Classifieds Actor Request` node returned **`{ json: {} }` in every single one** — no WF09 run has
*ever* returned a real listing in this instance. (So "the actor previously returned real listings here" is not
borne out by the persisted record; see Step 2 for where it *did* work.)

**Step 2 — the actor IS structurally functional (proven).** Direct free Apify API inspection of the actor's run
history found run `lf084750doGbs2z6w` (2026-06-20) whose dataset `FQgm8HLd8Zh3jdalN` holds **10 real Avito
listings** (real `url`/`priceText`/`location`/`image`; titles were photo-count placeholders "Ещё N фото", but the
URLs/prices are genuine). That run used the actor's **default input** (base услуги catalogue, default session
warming) and finished in 11 s. So the actor can return real data — the recent 0-item runs are a *runtime* failure,
not a broken actor.

**Step 3 — the `[{}]` is a genuine 0-listing fetch, not a code/mapping defect (proven).** Run logs for the
Stage-D runs (447/451) and two fresh direct diagnostic probes show the fetch layer failing:
`Request blocked - received 403 status code` (Avito anti-bot) **and** `Proxy responded with 590 UPSTREAM504`
(Apify residential proxy upstream failure) — `0 succeeded, N failed`, `We saved 0 listings from 0 catalogue pages`.
Verified on our side there is **no code defect**: the request body is schema-correct for the actor
(`startUrls` array of strings + `limit`≥10 + `proxyConfiguration`, confirmed against the actor's published input
schema, build v0.0.20); n8n's HTTP node maps an empty-array actor response to a single `{ json:{} }` item which the
normalizer's valid-listing guard correctly rejects (0 rows), and would split a *populated* array into per-listing
items that `const items=$input.all().map(i=>i.json)` consumes correctly. AVITO-PROXY-001 (residential proxy) was
the *correct* fix and moved exec 451 from instant datacenter-403 to the residential path — which then hit 590
UPSTREAM504 (see Step 5).

**Step 4 — replacement actor tested, per operator directive (fails identically).** Evaluated the Apify store for
alternatives and probed the purpose-built **`abotapi/avito-ru-scraper`** (2 117 runs, actively maintained, native
Avito.ru `query`/`urls`/region support). Run `h4VsxjaheondddQVD` on our exact search URL returned **0 listings**
with an explicit self-diagnosed error item: *"No listings found for the given input"* and the log line
**`Detected free-tier limitation — switching to backup pool. Recommend upgrading to a paid Apify plan with
RESIDENTIAL proxy for higher reliability`** → `Could not connect after 15 tries`. A second, independent, purpose-
built Avito.ru actor failing the same way — **for an explicitly stated proxy/plan reason** — isolates the cause to
the account, not the actor.

**Step 5 — DEFINITIVE ROOT CAUSE (proven): Apify account is FREE-tier without residential proxy entitlement.**
`GET /v2/users/me` → `plan.id: FREE`; `plan.availableProxyGroups = { BUYPROXIES94952: 5 }` — the **only** usable
group is a datacenter pool (quota 5). `RESIDENTIAL` is listed as a platform *feature flag* but is **not granted**
to the free plan, so every actor that requests `apifyProxyGroups:['RESIDENTIAL']` gets **590 UPSTREAM504**, and
datacenter requests get Avito **403**. Avito rejects datacenter/unverified IPs and *requires* residential — which
this account does not have. **This is an operator infrastructure prerequisite (a paid Apify plan with residential
proxy), NOT a Marketing Scout defect, and NOT fixable in workflow/generator/library code.**

**Decision — no WF09 actor swap.** Switching actors gains nothing while the account lacks residential proxy (proven
by the identical `abotapi` failure); it would be churn requiring re-proof. WF09 is left unchanged: its input is
schema-correct, its mapping/normalizer are correct, and its source-quality gate **positively fail-closes** on the
empty provider payload (0 placeholder rows, 0 bad URLs, 0 fabrication). When the operator provisions a paid Apify
residential plan (or supplies residential proxy credentials / an alternative classifieds path), the *same* bounded
WF09 run should yield real listings with no code change — a clean bounded follow-up, recorded honestly, **not**
substituted with fixtures.

**Provider accounting (this investigation):** actor runs consumed = **5** (WF09 447/451 + 3 direct diagnostic
probes: fatihtahta search+base, abotapi url), all **0 output records**; monetary spend ≈ **$0.10** (Apify month
cumulative **$0.329 / $5 free cap**), within the $10 Stage-D ceiling and the ≤5-run limit. Actor run IDs:
`wX1WlThgmpRqS6POS` (447), `w90S5bo8J63HjeHvI` (451), plus 2 fatihtahta + 1 abotapi (`h4VsxjaheondddQVD`) probes.

```
AVITO_LIVE_SAMPLE_EXECUTED=PASS                 # 5 bounded authorized actor runs (447,451 + 3 probes), $ within budget
AVITO_ROOT_CAUSE_INVESTIGATED=PASS              # historical execs + run logs + datasets + schema + account plan inspected
AVITO_ACTOR_PROXY_HARDENED=PASS                 # AVITO-PROXY-001 residential proxyConfiguration deployed (correct fix)
AVITO_ACTOR_STRUCTURALLY_FUNCTIONAL=TRUE        # run lf084750doGbs2z6w / dataset FQgm8HLd8Zh3jdalN = 10 real listings (2026-06-20)
AVITO_CODE_OR_MAPPING_DEFECT=NONE               # input schema-correct; n8n array->items mapping correct; normalizer correct
AVITO_REPLACEMENT_ACTOR_TESTED=PASS             # abotapi/avito-ru-scraper probed — fails identically (free-tier proxy)
AVITO_ROOT_CAUSE=APIFY_FREE_PLAN_NO_RESIDENTIAL_PROXY   # plan.id=FREE; only datacenter group BUYPROXIES94952; Avito 403 dc / 590 residential
AVITO_BLOCKER_CLASS=OPERATOR_INFRASTRUCTURE_PREREQUISITE # paid Apify residential plan required; not a code defect
AVITO_PROVIDER_RETURNED_USABLE_LISTINGS=FALSE   # 0 listings across every 2026-07 run (all actors, all proxy attempts)
AVITO_NEW_ROWS_PERSISTED=NOT_APPLICABLE_PROVIDER_RETURNED_NO_LISTINGS
AVITO_SOURCE_QUALITY_GATE_FAIL_CLOSED=PASS      # empty/error provider payload -> valid=false -> 0 rows persisted
AVITO_PLACEHOLDER_ROWS=0
AVITO_BAD_URLS=0
AVITO_FINAL_DUPLICATES=0
AVITO_EVERY_REVIEWED_LISTING_MANUALLY_CLASSIFIED=PASS   # every returned item classified provider_empty / provider_error
AVITO_COMPETITOR_SIGNALS_GROUNDED=NOT_APPLICABLE_NO_VALID_LISTINGS
AVITO_PUBLIC_LEAD_SIGNALS_GROUNDED=NOT_APPLICABLE_NO_VALID_LEAD_SIGNALS
AVITO_CLAIMED_PAINS_GROUNDED=NOT_APPLICABLE_NO_VALID_LISTINGS
AVITO_OBSERVED_PAINS_GROUNDED=NOT_APPLICABLE_NO_VALID_LEAD_SIGNALS
AVITO_MARKETING_ANGLES_GROUNDED=NOT_APPLICABLE_NO_VALID_LISTINGS
AVITO_DOWNSTREAM_ANALYSIS=NOT_APPLICABLE_NO_VALID_LISTINGS
AVITO_COMPETITOR_LEAD_CONTAMINATION=0
AVITO_SOURCE_QUALITY=BLOCKED_OPTIONAL_OPERATOR_INFRA_PREREQUISITE   # NOT acceptance — gate integrity only; 0 real listings obtained
```

### Avito — OPERATOR CHECKPOINT (residential proxy required; re-verified 2026-07-06)

Fail-closed no-data is **not** Avito source acceptance — it only proves the gate rejects bad payloads. Avito
cannot yield real listings on this account. Re-checked `GET /v2/users/me`:

- **Apify plan = `FREE`**; granted proxy groups = **`{ BUYPROXIES94952: 5 }`** only (a datacenter pool).
- **`RESIDENTIAL` is NOT granted** (it appears in the platform feature *flags* but not in
  `plan.availableProxyGroups`), so any actor requesting `apifyProxyGroups:['RESIDENTIAL']` gets `590 UPSTREAM504`,
  and datacenter requests get Avito **403**. Confirmed identically on two independent actors (fatihtahta, abotapi).

**What the operator must do to unblock Avito (no secret in chat):**
1. **Requirement:** an Apify plan that includes **Residential proxy** (Avito rejects datacenter/unverified IPs).
   Apify Residential proxy is a paid add-on — available on the **Starter** plan and above (or as a proxy add-on),
   not on Free.
2. **Where to enable/purchase:** Apify Console → **Billing → Subscription** (upgrade to a paid plan) and/or
   **Proxy → Residential** (enable the Residential add-on) at `https://console.apify.com/billing` and
   `https://console.apify.com/proxy`.
3. **How to verify RESIDENTIAL is actually granted** (no secret needed here; run with the operator's own token):
   `curl -s -H "Authorization: Bearer <APIFY_TOKEN>" https://api.apify.com/v2/users/me | jq '.data.plan.availableProxyGroups'`
   → must list a `RESIDENTIAL` entry (not only `BUYPROXIES94952`). When it does, re-run the **existing** bounded
   WF09 live path (no code change) and inspect real listings.
4. **No more actor swapping** while the account lacks residential (proven futile).
5. **Avito is an OPTIONAL blocked source** — if the operator elects not to provision residential proxy, the MVP
   proceeds without Avito. It must not block the rest of the MVP.

## VK LIVE acceptance — 3 public communities, real wall posts collected + comment reality proven (2026-07-06)

Bounded, authorized live VK collection (free VK API, `$0`) of the three approved PUBLIC communities via WF26
(`SMQkUppyeFH2sFuf`, VK-ENABLE-001 + VK-PARSE-001 deployed), driven by disposable `msdrvvklv002`
(request `req_vk_sd2_20260706`, `mode=collect`, `data_mode=live`, `vk_enable_approval=VK_LIVE_APPROVED`). Token
read from `/root/.secrets/marketing-scout-vk.token` and used **only** in the query-auth header — never printed,
never persisted. WF26 calls only `groups.getById` (public metadata) + `wall.get` (public wall). No member lists,
no private profiles/groups/messages, no hidden contact data.

**Fresh-live post executions (all `success`, VK-PARSE-001 in effect):**

| community | VK exec | community_id | wall total | fetched | persisted vk_posts | intra-run dups | empty-text |
|-----------|---------|--------------|-----------:|--------:|-------------------:|---------------:|-----------:|
| vk.com/kredit874 | 464 | 236140557 | 6 | 6 | **6** | 0 (6/6 hashes) | 1 (_302 photo-only) |
| vk.com/da_credit | 465 | 226298905 | 605 | 25 | **25** | 0 (25/25 hashes) | 0 |
| vk.com/anna_findoctor | 466 | 225516714 | 263 | 25 | **25** | 0 (24/25 hashes*) | 0 |

*anna_findoctor: 24 distinct content_hash / 25 rows — one testimonial CTA text ("💭Новый отзыв…") is reposted on
two different days (posts _510 and _504); they are **distinct posts** (distinct post_id + canonical_url) correctly
kept as two rows — NOT a duplicate (dedup key is post identity, not text).

**VK-PARSE-001 proven end-to-end.** Before the fix, execs 457/458/459 fetched real walls (`wall.count`=6/605/261)
but persisted **0** posts because the parse node read `$json` (a `source_change_events` row) instead of the wall
response; after the fix (`$('VK wall.get')`), execs 464/465/466 persist real posts. Every persisted row carries
full provenance (agent_request_id, source_run_id, workflow_run_id, owner_user_id, platform, source_type,
community_id, owner_id, post_id, post_version, canonical_url, published_at, collected_at, content_hash, data_mode).

**Manual full-text classification of the persisted sample (56 posts):** every wall post is **competitor-owned
content** authored by the community itself — three genuine Moscow/МО credit-broker communities:
- **kredit874** — микрозайм CTAs ("До 100.000₽ · Без проверок · С любой КИ · за 5 минут", "Даём деньги в день
  обращения", public contact `vk.me/club236140557`). Role = **competitor_signal** (offer/CTA).
- **da_credit** — "Кредитный доктор" expert/educational positioning (как проверить кредитную историю, разбор схем
  «спишем долги», ЦБ ключевая ставка). Role = **competitor_signal + market_signal** (thought-leadership).
- **anna_findoctor** — broker promo (🚨 pain-hook CTAs "ОТКАЗЫ ПО ВСЕМ ФРОНТАМ?", daily "✔ N ОДОБРЕНО" results,
  testimonials, public contact `vk.me/anna_findoctor`). Role = **competitor_signal**.

Because a community **wall** is authored by the community owner, **every** wall post is competitor/market content
and **none** is a user-authored lead — **0 false leads, 0 competitor↔lead contamination** (correct by design).
Public contacts (`vk.me/club236140557`, `vk.me/anna_findoctor`) are verbatim business links in the post text →
allowed; no private contact data extracted.

**Relevance (collection layer, honest):** ~52/56 posts are on-topic (credit / loans / credit history / broker
services). A few da_credit posts are generic finance-news or off-topic reposts (e.g. _686 "рейтинг свободы
интернета" is off-topic; several ЦБ key-rate items are market-adjacent). WF26 is a **raw wall collector** and does
**not** hard-skip at collection (unlike WF11 Telegram); it persists all wall posts with `quality_status=pending`
and defers relevance/competitor scoring to the downstream analyzer. Collection-layer relevance ≈ **93%** on this
sample; authoritative precision is a downstream concern (see integration gap below).

**VK COMMENTS — live-verified reality: near-zero public comments → 0 lead signals (evidence-backed).** Bounded live
`wall.getComments` probes (free) across the fetched sample found **4 public comments total** on 3 da_credit posts
(kredit874 = 0, anna_findoctor = 0), and **every one is noise**: `👍` (emoji-only), `Привет` (generic greeting),
and 2 stickers (empty text). Per the canonical lead threshold (real service intent / real problem / real request
for help), **0** qualify as leads — correctly rejected. These promotional broker communities keep comments
disabled/empty, so **VK yields competitor intelligence, not public leads**, for the approved sample. This is a
**data reality**, honestly recorded — not fabricated and not padded with fixtures.

**Decision — no speculative comment-collection wiring.** The lib exposes `commentsRequest` (wall.getComments,
disabled-by-default flag), but a full comment-collection + persistence path is intentionally **not** wired into
WF26 now: the bounded live sample proves the approved communities have ~0 public comments, so it would harvest only
noise and cannot be live-proven with real lead data. Wiring bounded public-comment collection + a lead-intent
classifier is a scoped enhancement to enable when a monitored community with active public discussion is added
(via the future source registry) — recorded, not built against zero data.

**Known VK integration gaps (deferred to Stage E/G, honestly flagged — NOT Stage-D source-quality failures):**
1. **vk_posts is not yet wired into the analysis pipeline** — `vk_posts` is written by WF26 but currently has **no
   downstream reader** (WF16/WF08/WF10 do not consume it), so VK competitor content does not yet appear in reports.
   Website + Telegram ARE fully wired and grounded (proven elsewhere in this doc). VK→WF16/WF08 normalization is a
   Stage E/G integration task.
2. **vk_posts carries no collection-time relevance score** (`quality_status=pending`; no `confidence_score`/
   `relevance_reason`), mirroring pre-fix Website — authoritative VK scoring belongs to WF08 once wired.
3. **cross-run snapshot semantics** — WF26 persists a full per-request wall snapshot tagged by `source_run_id`
   (correct for request-scoped isolated analysis); the incremental dedup lives in `source_change_events` (proven:
   the re-run emitted **0** new change events for kredit874) and the report layer dedups by canonical_url. The one
   observed double-persist of kredit874 (execs 461 + 464 under the *same* source_run_id) is a QA re-run artifact
   (partial-crash 461 + full 464), not a production path — production mints a fresh source_run_id per request.

**Provider accounting:** VK API is free ($0). Actor/paid spend this VK cycle = $0. Communities: 3/3 resolved & real.

```
VK_LIVE_SAMPLE_EXECUTED=PASS                    # WF26 execs 464/465/466, 3 communities, $0 (free VK API)
VK_PARSE_001_PROVEN=PASS                        # pre-fix 0 persisted -> post-fix 6/25/25 real posts persisted
VK_TOKEN_HANDLING=PASS                          # token header-only, never printed/persisted; wall.get + groups.getById only
VK_PUBLIC_ONLY=PASS                             # no member lists, no private groups/profiles/messages/contacts
VK_POSTS_PERSISTED=56                           # kredit874=6, da_credit=25, anna_findoctor=25
VK_POST_REQUIRED_FIELDS_PERCENT=100             # full provenance + identity + canonical_url + date on every row
VK_POST_BAD_URLS=0                              # all canonical vk.com/wall-<owner>_<postid>
VK_POST_INTRARUN_DUPLICATES=0                   # 6/6, 25/25 distinct; anna 24/25 = legit reposted-text distinct posts
VK_POST_RELEVANCE_PERCENT=93                    # collection layer (recall-oriented); a few da_credit off-topic news posts
VK_POST_ROLE=COMPETITOR_OR_MARKET_SIGNAL        # walls are competitor-owned by definition
VK_FALSE_LEADS=0                                # no user-authored content on a community wall
VK_COMPETITOR_LEAD_CONTAMINATION=0
VK_PUBLIC_CONTACT_POLICY=PASS                   # only verbatim public vk.me business links; no private data
VK_COMMENTS_IN_BOUNDED_SAMPLE=4                 # kredit874=0, anna=0, da_credit=4 (on 3 posts)
VK_COMMENT_LEAD_SIGNALS=0                        # all 4 = noise (👍 / Привет / 2 stickers) -> correctly rejected
VK_COMMENTS_AVAILABILITY=NEAR_ZERO_PROMO_COMMUNITIES_COMMENTS_EMPTY   # data reality, live-verified
VK_COMMENT_COLLECTION_WIRED=DEFERRED_NO_DATA_TO_COLLECT   # capability in lib; enable when a community has active comments
VK_DOWNSTREAM_INTEGRATION=DEFERRED_STAGE_E_G    # vk_posts has no WF16/WF08 reader yet (Website+Telegram ARE wired)
VK_SOURCE_QUALITY=PASS_POSTS_COLLECTED_COMMENTS_EMPTY_INTEGRATION_DEFERRED
```
