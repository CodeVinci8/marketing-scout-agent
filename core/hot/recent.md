# Hot Memory — Recent Sessions

Most recent first. Keep last 3 sessions max. Archive older entries to `core/warm/decisions.md`.

---

## Session: 2026-07-11 (session 42) — Stage D · D3 report-quality repair DEPLOYED + LIVE-PROVEN → STAGE D = PASS

**Canonical FILE 1 stage:** **D — source quality = PASS** (D1+D2+D3 all live-proven; Avito optional-blocked).
Branch `fix/stage4-live-final-acceptance`. Commits this session: `aee19bb` (WF12+WF10 fixes), `d6175b4` (WF14
fixes), + this docs commit. NOT pushed. **$0, 0 paid calls** (VK free API; deterministic report, claude_calls=0).

**D3 fixes (canonical hand-authored WF10/WF12/WF14; deployed backup-first, sha256 backups 13bdb8a9/… on record):**
- **WF12 REPORT-LEADS-001**: public_lead_signals read was unscoped → the tab holds ~999 BLANK rows (only row_number
  set) that rowsOf() kept → phantom "лид-сигналов: 999" + empty «» rows. Now filtered by __leadValid (real id OR
  evidence OR intent OR score) + __leadInReq (labelled leads scoped to the report request family; unlabelled kept).
- **WF12 markdown/CTA sanitize (stripMd)**: collapses [label](url)→label, strips dangling "](https…"; applied to
  site-snapshot offer/prices/guarantees/cta → no more "Оставить заявку](https://www".
- **WF10 AUD-COUNT-001**: audience counters (questions/objections/complaints/buying) count ONLY audience-voice rows
  (source_type=public_discussion/social_comment, touchpoint=public_comment). Competitor/market/unknown posts with
  "?" no longer inflate "вопросов N".
- **WF14 LEAD-AUD-001**: review_queue candidates gated to genuine audience rows → telegram MARKET/competitor posts
  can never become public leads. **WF14 LEAD-STRONG-001**: a comment with no credit pain and no buying intent is
  capped to 'low' band → bank service complaints never pollute the strong (high/medium) section.

**Live proof (fresh, deterministic reports; all rendering defects verified GONE):**
- **report_20260711_025451** (req_vk_d3, 4 communities posts+comments): 999=false, "](http"=false, empty «»=false,
  internal-leakage=false, **audience вопросов=0 (was 23)**; 4 VK competitors grounded, angles from real post text.
- **report_20260711_031651** (req_vk_d4, fresh untriaged **vtb** bank comments): **21 fresh comment leads, ALL
  band='low'** (dup=0 on the untriaged source) → LEAD-STRONG-001 proven: bank service complaints do NOT enter the
  strong section; report body correctly `no_data` (a bank's posts aren't broker competitors). Rendering clean.
- **WF14(fixed) candidate pool over req_vk_d3** = 23 VK comments, **0 telegram market posts** → LEAD-AUD-001 proven
  live. Focused test_stage_d3_report_quality.js (15) + lead_scout + full make test PASS ($0).

**AI/Claude enrichment:** WF12 enable_llm_summary=false by default; Claude is behind budget+approval gates (the
separate Stage F aiprimetech.io work). Canonical MVP Stage-D report mode is **deterministic** — D3 proven in that
mode; Claude enrichment NOT force-enabled (would need budget approval; deferred to Stage F).

**Honest constraint (not a defect):** a SINGLE report combining broker competitors + fresh clean non-empty leads
isn't achievable in one artifact — broker communities have competitors but ~0 comments, banks have comments but
aren't broker competitors — plus cross-request lead dedup means already-triaged QA comments can't be re-triaged
into a new request. Each element is independently live-proven. Residual: req_vk_d3's first report (pre-WF14-fix)
had 25 leads incl. telegram pollution; those historical rows remain but the fix excludes them for future runs.

**EXACT NEXT (post-Stage-D backlog, per operator order — NOT started; needs explicit authorization):** /status →
/cancel → one-message progress lifecycle → auto report/XLSX delivery → contextual follow-up → monitored-source
registry → user-supplied-URL proof → remove disposable drivers → then Stage E. Disposable drivers to remove:
msdrvvkd1*, msdrvvkd2*, msdrvd2*, msdrvd3*, msdrvd4*, msdrvd3b. Prod deployed: WF26(31n)/WF14(mslocwf14lead)/
WF10/WF12 all carry the D1-D3 fixes.

---

## Session: 2026-07-10 (session 41) — Stage D · D2 DEPLOYED + LIVE-PROVEN (VK comments → public lead signals)

**Canonical FILE 1 stage:** **D — source quality (IN_PROGRESS).** D1 done (session 40). **D2 = DONE, live-proven.**
D3 (report-quality repair) is next. Branch `fix/stage4-live-final-acceptance`. Commits this session: `e9c2ecc`
(D2 code: WF26 comment branch + WF14 trigger + lib + 74-test), then this docs commit. NOT pushed. **$0, 0 paid calls.**

**D2 route (no vk_comments tab — reuses canonical):** `WF26 comments → raw_market_records (touchpoint=public_comment,
source_type=public_discussion) → WF16 → WF14 → public_lead_signals`. classifyOffline audience branch classifies;
WF14 (sole lead writer) scores. Lib additions in `n8n/lib/vk_collector.js`: parseComments, commentNoiseClass
(deterministic noise gate), commentIsOwnerAuthored (from_id<0/==owner → never a lead), buildCommentRecord.
WF26 gate honors separate `vk_comments_approval=VK_COMMENTS_APPROVED` (comments INERT/0 calls unless approved),
bounded per-post `wall.getComments` loop.

**Deployed (backup-first):** backup `/root/backups/n8n-backup-20260710-172931` (sha256 `fcba3f69…`). Prod WF26
`SMQkUppyeFH2sFuf` 26→**31 nodes** (comment branch; VK cred `pRZcJEyp7KExTReQ`, google `U7zcRXq79mhonIPF`), active.
**KEY FINDING: WF14 (and WF13) were NEVER in prod** — deployed WF14 fresh as **`mslocwf14lead`** (google cred +
`$env.MS_SPREADSHEET_ID` bound on 5 Sheets nodes, new callable trigger, **active=1 required for executeWorkflow**).

**Live proof — req `req_vk_d2_20260710_173725`:** 3 approved communities reconfirmed ~0 comments. Bounded QA sources
(groups.search denied by token scope → probed finance communities directly): **webbankir** (80 comments: 2 accepted,
78 noise=praise/contest) + **sovcombank** (27: 23 accepted, 4 noise) — neither added to canonical registry. WF14
exec **506**: 25 public_comment candidates (118 post rows correctly NOT candidates — posts never leads) → **13
public_lead_signals written**; re-run **509**: 0 new, **13 deduped**. Genuine lead: «Подскажите офис в Москве…
ипотечным кредитованием?» → service=credit_broker, url `vk.com/wall-33340946_157690?reply=157721`. Public from_id
only (no PII).

**Honest gaps (NOT blockers):** several of 13 leads are bank service-complaints WF14 accepts as question/unknown
(WF14's existing scorer, reused as-is — relevance tuning separate). Owner-authored (from_id=community) separation is
code+test proven but no community-authored comment appeared live (supplier_skipped=0). n8n gotchas: executeWorkflow
"run once for all items" passes ALL items to `.first()` → use per-community drivers; a 0-item sub-return skips
downstream code nodes (barriers don't help) → separate `n8n execute` per community; sub-workflow must be ACTIVE.

**D3 defects still reproduce (unchanged, deferred):** phantom `Публичных лид-сигналов: 999`, malformed CTA
`](https://www`, empty `«»` lead rows, competitor wall posts as `вопросов N`. **EXACT NEXT: D3** — fresh bounded
cross-source report (Website+Telegram+VK posts+VK comments) + fix+freshly-prove those report-level defects; own
atomic increment. Disposable drivers to remove later (backlog #9): `msdrvvkd1*`, `msdrvvkd2`, `msdrvd2web/kre/dac/ann/sov`, `msdrvd2dn`.

---

## Session: 2026-07-10 (session 40) — Stage D · D1 DEPLOYED + LIVE-PROVEN (VK posts reach a real report)

**Canonical FILE 1 stage:** **D — source quality (IN_PROGRESS).** D1 = **DONE, live-proven**. D2 (VK comments →
public-lead classification) is the next atomic increment; D3 (report-quality repair) after it. Branch
`fix/stage4-live-final-acceptance`. Commits this session: `1a74f5c` (VK-APPROVAL-001 fix) + this docs commit.
NOT pushed. **$0, 0 paid calls** (VK `wall.get` is free; `claude_calls=0`).

**Deployed (backup-first surgical splice).** Backup `/root/backups/n8n-backup-20260710-000535/n8n-data.tar.gz`
(sha256 `e0a9706d…`). Prod WF26 `SMQkUppyeFH2sFuf` 24→**26 nodes**, `active=1`, `Append raw_market_records` bound to
googleApi `U7zcRXq79mhonIPF`; read-back proved **deployed Build jsCode === canonical**, 0 drift on the other 24 nodes.
Mechanism: `n8n export:workflow` → splice → `docker cp` → `import:workflow` → `update:workflow --active=true`
(import always deactivates). `n8n execute` needs `N8N_RUNNERS_TASK_BROKER_PORT=5690`.

**Live proof — request `req_vk_d1b_20260710_032001`:** WF26 execs **476/477/478** = kredit874 6, da_credit 25,
anna_findoctor 25 → **56 raw_market_records rows** (competitor_activity 28, market_signal 10, unknown 18).
WF16 **480**: 3 runs healthy 83/86/93, all `report_eligible`. WF08 **481**: selected 56/56, `claude_calls=0`,
monitor_queue 28 / review_queue 28. WF10 **486**: isolation 56 → after_filters **28**, excluded_by_review 28,
excluded_by_health 0 → **3 competitor_profiles + 4 market_angles**. WF12 **487**: report
**`report_20260710_063410`** with the 3 VK competitors (evidence 17/10/1, conf 60/60/45), `source_urls=vk.com/<community>`,
grounded keywords + pains; angles from real post text. Off-topic/thin posts NOT reported (28 unknown excluded).

**Defect fixed live: VK-APPROVAL-001 (`1a74f5c`).** First run persisted 56 rows but WF08 selected **0** → chain
stopped (n8n skips downstream on empty output). Cause: WF08 keeps only `approval_status ∈ {approved,new}`; VK wrote
`''` while WF11/WF04 write `'new'`. Fixed in the generator + regression (test 107), regenerated, `make test` ALL PASS,
redeployed, re-proved. **QA-driver artifact (not product):** chaining WF08's 56 items into WF10 leaked a per-source
`source_run_id` into WF10's callable input → over-narrowed to 1 community; WF20 passes it explicitly, so prod is safe.

**D3 defects CONFIRMED still reproducing (do NOT claim fixed):** phantom `Публичных лид-сигналов: 999`; malformed CTA
`Оставить заявку](https://www`; empty `«»`/unknown lead rows; competitor wall posts counted as audience `вопросов 23`.

**EXACT NEXT: D2 (VK comments → public lead signals).** Preconditions inspected 2026-07-10:

**ARCHITECTURE DECISION (verified against the contract — do NOT create a `vk_comments` tab).** `vk_comments` is
**absent** from `config/sheets_contracts.json` (no `tabs` entry, no `headers`, not in `sheet_order`). The canonical
comment→lead path already exists and must be reused, not duplicated:
`WF26 comments → raw_market_records (touchpoint_type=public_comment, source_type=public_discussion)
→ WF16 → WF08 → WF14 → public_lead_signals (47 cols; sole writer WF14, reader WF12)`.
WF13 already implements this exact pattern for VK public comments. A new `vk_comments` tab would be a parallel store
+ a second lead contract, which the operator brief forbids ("preserve the current canonical contract if it differs").

**What exists:** `vk_collector.commentsRequest(identity, post, cfg)` → `wall.getComments`, **gated** by
`cfg.vk_enable_comments===true` (`comments_enabled`, `max_comments_per_post` default 10). **No comment parser, no
noise gate, no lead classifier yet.** `semantic_core.classifyOffline` already has an **audience branch** that triggers
when `source_type==='public_discussion'` (or touchpoint/record hints contain question/audience) and yields
`audience_question | audience_objection | audience_complaint | buying_intent` — reuse it (ONE scoring contract).

**D2 build order:** (1) lib: `parseComments` + a deterministic **noise gate** (reject emoji-only/stickers/greetings/
praise/contest/spam/too-short) + `buildCommentRecord` (owner scope, parent post id, comment id, canonical
`vk.com/wall-<owner>_<post>?reply=<cid>`, published_at, public author only, dedup_key `vk::comment::<owner>_<post>_<cid>`);
(2) **competitor-owned separation**: a comment whose `from_id` is the community itself (negative owner id) can NEVER
be a lead; wall posts are never leads; (3) WF26 nodes: bounded per-post `wall.getComments` loop (cap posts × comments),
classify, emit raw_market_records audience rows → existing append; (4) ≤1 lead per valid signal (dedup by comment id);
(5) tests + `make test`; (6) deploy (surgical splice, backup first); (7) live proof. The 3 approved communities have
~0 useful comments (live-verified: 4 total, all noise) → find **ONE** bounded temporary public QA community with real
comments for positive+negative proof; stop at the first lawful source; do **NOT** add it to the canonical registry.
Public data only. Then D3 (report-quality repair). Disposable drivers to remove later: `msdrvvkd1001/1002/dn/dn2/rep`.

---

## Session: 2026-07-06 (session 39) — Stage D · D1 BUILT (VK posts → canonical pipeline), local-complete, deploy auth-gated

**Canonical FILE 1 stage:** **D — source quality (IN_PROGRESS).** Continuation brief re-scoped Stage D into D1 (VK
posts → pipeline), D2 (VK comments → lead signals), D3 (fresh cross-source report + reporting-defect repair). This
session did **D1 local implementation only** and STOPPED at the authorization boundary (no production write, no
live/paid call this session — the brief instructs: if no active prod/live auth, finish local + prepare exact deploy
commands + stop; do not misrepresent deployment-ready as live-proven). Branch `fix/stage4-live-final-acceptance`,
HEAD **`48a52fb`**. 1 commit this session (`48a52fb`). NOT pushed. **$0, 0 external calls.**

**D1 BUILT (canonical, committed `48a52fb`):** VK→`raw_market_records` normalizer. Key move: made
`n8n/lib/semantic_core.js` **embeddable** — `libCore()` in the generator now inlines `config/taxonomy.json` and
strips the `fs`/`path`/`readFileSync` load, so the REAL `classifyOffline` runs inside the WF26 Code node = the
SINGLE canonical scoring contract (no VK-specific scoring, no 2nd contract). New WF26 nodes **"Build VK
raw_market_records Rows"** (embeds `semantic_core`) + **"Append raw_market_records"**, wired `Parse Wall & Detect
Changes → Build → Append`. Each VK post → canonical 40-col row with `record_type_hint` + `confidence_score` +
`service_hint` + `semantic_keywords` + `competitor_related`/`competitor_name` + grounded `manager_note` reason;
off-topic → `irrelevant` (WF16 `report_candidate=0` / WF08 → `skipped_log`). VK now flows
WF26→raw_market_records→WF16→WF08→WF10→WF12 like Website/Telegram. WF26 regenerated 24→26 nodes (only WF26 changed;
generator was already source-of-truth). `config/sheets_contracts.json` `raw_market_records.writers += "26"` (drift
validator green). New `tests/test_wf26_vk_rmr_mapping.js` (105): topology; 42 collector columns ⊆ real 68-col
contract (derived from WF11, no parallel fields); **embedded classifier == library (drift-proof)**; VK semantics
(promo→competitor, market→market_signal, greeting→NOT-competitor). **Full `make test` ALL SUITES PASS ($0).**

**NOT done (auth-gated):** production splice of the 2 new WF26 nodes into prod WF26 (`SMQkUppyeFH2sFuf`) + bounded
live VK run (3 communities, `vk_enable_approval=VK_LIVE_APPROVED`) + downstream WF16→WF08→WF10→WF12 over the VK
request + inspect real report. Exact sequence: **`docs/STAGE_D_VK_D1_DEPLOY_RUNBOOK.md`** (backup → surgical splice
binding googleApi cred on Append raw_market_records → live run with unique `req_vk_d1_*` → downstream → verify VK
competitors in a real report). D1 is complete only when fresh evidence shows VK competitors in a WF12 report.

**EXACT NEXT COMMAND (needs operator auth):** deploy per the D1 runbook → bounded live VK run → downstream → inspect;
then D2 (VK comments path). Apify/VK tokens `/root/.secrets/*.token` (header-only, never print). Avito unchanged =
`AVITO_SOURCE_QUALITY=BLOCKED_OPTIONAL_OPERATOR_INFRA_PREREQUISITE` (residential proxy on a paid Apify plan).

---

## Session: 2026-07-06 (session 38) — STAGE D REOPENED by operator: VK must be full competitor+lead source

**Operator reopened Stage D** (session-37 PASS was premature): VK must be a full **competitor-intelligence AND
public-lead** source, not raw-post-collection only. `STAGE_D_SOURCE_QUALITY=IN_PROGRESS`. Paid live calls
authorized (do NOT optimize for min spend; bounded public-data-only; no fixtures for acceptance). Branch
`fix/stage4-live-final-acceptance`, HEAD **`a1bbcda`**. Commits this session: `39c7fc6` (VK canonical sync),
`a1bbcda` (Avito checkpoint + reopen docs). NOT pushed.

**AVITO — OPERATOR CHECKPOINT (terminal for me; needs operator action).** Re-verified `GET /v2/users/me`:
plan=`FREE`, `availableProxyGroups={BUYPROXIES94952:5}` (datacenter only), **RESIDENTIAL NOT granted**. Avito
requires residential → operator must upgrade Apify to a paid plan w/ Residential proxy (Console→Billing→
Subscription + Proxy→Residential; verify via `.data.plan.availableProxyGroups` listing `RESIDENTIAL`), then re-run
existing WF09 (no code change). **NO more actor swaps.** Avito = OPTIONAL blocked source, must NOT block MVP.
Marker reframed `AVITO_SOURCE_QUALITY=BLOCKED_OPTIONAL_OPERATOR_INFRA_PREREQUISITE` (NOT acceptance).

**VK #1 DONE — canonical generator sync (`39c7fc6`).** VK-ENABLE-001 + VK-PARSE-001 were only in committed WF26
JSON; generator was stale (a plain regen reverted them — I reproduced this). Moved both into
`tools/gen_stage4_workflows.js` (gate trigger-merge + approval; parse reads `$('VK wall.get')`; trigger exposes
`vk_enable_approval`). Regenerated WF26 (byte-identical VK nodes + trailing newline). New drift-proof
`tests/test_wf26_generator_sync.js` (9) asserts generator emits both fixes == committed. **make test ALL PASS $0.**

**VK REMAINING (exact plan, all live-proven, no fixtures as acceptance):**
- **#2 VK posts → pipeline** (NOT started): build canonical VK→`raw_market_records` normalizer reusing
  `n8n/lib/semantic_core.js` `classifyOffline(rec)` (ONE scoring contract — do NOT invent a 2nd). Map each vk_post
  to the 40-col raw_market_records shape (same as WF11 "Build raw_market_records Rows"): confidence_score +
  record_type_hint + service_hint + semantic_keywords + competitor_related + competitor_name + relevance reason in
  manager_note/notes; off-topic posts → classifyOffline returns `irrelevant` → health-excluded by WF16. Add nodes
  "Build VK raw_market_records Rows" (embed `semantic_core`) + "Append raw_market_records" in the GENERATOR, wire
  after Shape VK Posts (`['Append vk_posts','Build VK raw_market_records Rows']`,`[…,'Append raw_market_records']`),
  regenerate, focused test, deploy (surgical: add 2 nodes+edges), live WF26 run → then WF16→WF08→WF10→WF12 over the
  request's raw_market_records → inspect VK competitors in a real report. raw_market_records tab: writers
  04/07/09/11/13/14/16, readers 08/14/16 (request_scoped). classifyOffline in semantic_core exports:
  `classifyOffline, computeConfidence, hitTerms, deriveServiceFromText, detectDirectOffer, detectMarketSignal`.
- **#3 VK comments path** (NOT started): wire `wall.getComments` (lib has `commentsRequest`, gated
  `vk_enable_comments`; NO parser/classifier yet) → parse → normalize → persist (new `vk_comments` tab) → dedup →
  relevance + PUBLIC-LEAD classifier (real service need/credit problem/objection/request → exactly one lead;
  reject emoji/sticker/greeting/praise/contest) → into pipeline. Commit `feat(wf26): collect and classify bounded
  public VK comments`. The 3 approved communities have ~0 comments (live-verified: 4 total, all noise) → find ONE
  additional PUBLIC VK credit community/post WITH active relevant comments for a positive-lead QA (do NOT add to
  canonical registry). Prove: real credit-help request → 1 lead; question/objection classified; no competitor
  contamination; no duplicate leads. ALL live.
- **#4 final cross-source report** (NOT started): fresh stored-data WF16→WF08→WF10→WF12 over Website+Telegram+VK
  posts+VK comments; inspect real report + XLSX; VK competitors/offers/angles grounded, claimed-vs-observed pains
  separated, public questions/objections, leads only when threshold met, empty sections omitted, evidence URLs, no
  internal names/IDs/enums/DEC/diagnostics. Re-verify (fresh live user-facing report, don't assume) the reporting
  defects: phantom "Публичных лид-сигналов: 999", malformed CTA "](https://www", empty summary,
  telegram_send=false, WF10/WF16/DEC/rows_after_filters/report-ID leakage.
- **#5** update Stage D closure → PASS only after #2-#4 live-proven.

**THEN post-Stage-D (operator order):** /status(#13) → /cancel(#14) → progress lifecycle(#12) → auto report → auto
XLSX → contextual follow-up → monitored-source registry → user-URL Telegram proof → remove disposable drivers.
**Do NOT start Stage E until all live-proven or operator-infra-blocked.** VK live so far: WF26 execs 464/465/466
(6/25/25 real posts persisted); comments verified empty on the 3 communities. Apify token
`/root/.secrets/marketing-scout-apify.token`, VK token `/root/.secrets/marketing-scout-vk.token` (header-only,
never print). WF26 id `SMQkUppyeFH2sFuf`; driver `msdrvvklv002` (req `req_vk_sd2_20260706`).

**EXACT NEXT COMMAND:** build the VK→raw_market_records normalizer (VK #2) — add `classifyOffline`-based
"Build VK raw_market_records Rows" + "Append raw_market_records" to the generator, regenerate, test, deploy, live-run.

---

## Session: 2026-07-06 (session 37) — STAGE D (prematurely) CLOSED then REOPENED: Avito root-caused + VK posts live

**Canonical FILE 1 stage:** **D — Validate source quality = CLOSED (PASS).** Branch `fix/stage4-live-final-acceptance`,
HEAD **`aceb25a`**. 3 docs commits this session (`a15c80b` Avito root cause, `1b9d882` VK acceptance, `aceb25a` Stage D
closure). NOT pushed. **$0 net (Avito ~$0.10 Apify compute on 0-record runs; VK free API $0).** No code changed this
session (all prior fixes RELEV-WEB-001/FORCE-REPROCESS-001/TELEGRAM-CAP-001/AVITO-PROXY-001/VK-ENABLE-001/VK-PARSE-001
already deployed+committed). Tree clean.

**AVITO — deep root cause (operator rejected the prior "external limitation" hand-wave; I investigated).** Inspected
all 7 WF09 execs via `node:sqlite` (357..451 ALL returned `{}` — no persisted success ever), then FREE Apify API
metadata/log/dataset reads: the actor `fatihtahta~avito-russia-scraper` IS functional (run `lf084750doGbs2z6w` /
dataset `FQgm8HLd8Zh3jdalN` = **10 real listings 2026-06-20**). Recent 0-item runs = Avito **403** (datacenter
blocked) + **590 UPSTREAM504** (residential proxy not entitled). Verified **no WF09 code/mapping/normalizer defect**
(input schema-correct vs actor build v0.0.20; n8n empty-array→`{}` handled/rejected; normalizer `$input.all()` correct).
Tested replacement `abotapi/avito-ru-scraper` per operator directive → fails identically with explicit *"free-tier
limitation — upgrade to paid RESIDENTIAL"*. **DEFINITIVE:** account `plan.id=FREE`, only datacenter group
`BUYPROXIES94952`; Avito requires residential → **operator infrastructure prerequisite (paid Apify plan), NOT a
Marketing Scout defect.** No actor swap (won't help on free plan). Gate fail-closes: 0 bad rows. `AVITO_SOURCE_QUALITY=
PASS_FAIL_CLOSED_NO_DATA`. Actor run IDs: 447=`wX1WlThgmpRqS6POS`, 451=`w90S5bo8J63HjeHvI`, +3 probes (abotapi=
`h4VsxjaheondddQVD`). Apify month cumulative **$0.329/$5**.

**VK — live accepted (last, per FILE 1).** Deployed WF26 (`SMQkUppyeFH2sFuf`) confirmed carries VK-PARSE-001
(`$('VK wall.get')`). Re-ran driver `msdrvvklv002` (req `req_vk_sd2_20260706`) — the prior session's 460/462 "crashed"
= session-kill interruptions (no node error), NOT code bugs. **Fresh WF26 execs 464/465/466 (all success, $0 free VK
API):** kredit874=**6**, da_credit=**25**, anna_findoctor=**25** real wall posts persisted w/ full provenance +
canonical `vk.com/wall-<owner>_<id>` URLs. VK-PARSE-001 PROVEN (pre-fix execs 457/458/459 persisted 0 despite walls
of 6/605/261). Manual classification: ALL wall posts competitor/market-owned (kredit874 микрозайм CTAs; da_credit
"Кредитный доктор" expert content; anna_findoctor promo/CTA/testimonials) → **0 false leads, 0 contamination**;
public `vk.me/...` contacts verbatim only. Relevance ~93% at collection (a few da_credit off-topic finance-news;
WF26 is a raw collector, precision deferred downstream). **Comments live-verified via free `wall.getComments`: 4
total across 56 posts (kredit874=0, anna=0, da_credit=4), ALL noise (👍 / Привет / 2 stickers) → 0 leads.** Promo
communities keep comments empty → VK = competitor intel, not leads. **Did NOT build comment-collection wiring** (would
harvest only noise, can't live-prove leads) — recorded as scoped enhancement. **Honest deferred gaps:** vk_posts has
**no downstream reader** (not wired into WF16/WF08 → VK not in reports yet; Stage E/G); no collection-time relevance
score; per-request snapshot semantics (source_change_events dedups incrementally — 0 new events on re-run; the
kredit874 461+464 double-persist = same-source_run_id QA re-run artifact, prod mints fresh id per request).

**STAGE D VERDICT (grounded in persisted rows, not fixtures):** Website + Telegram = source quality PASS + end-to-end
grounded into reports (WF16→WF08→WF10→WF12, execs 433-435 / 442-445). Avito = PASS fail-closed no-data (infra
prerequisite). VK = PASS posts + comments-empty + integration-deferred. `STAGE_D_SOURCE_QUALITY=PASS` (see closure
table + markers in `docs/STAGE_D_SOURCE_QUALITY_ACCEPTANCE.md`). Task board #5 (D) = completed.

**EXACT NEXT (operator order, all post-Stage-D):** (1) `/status` canonical single-active selector (owner+chat scoped;
newest non-terminal; TTL-expire stale awaiting-approval; hide QA/test rows; no internal IDs) — fix+regression+deploy+
fresh REAL Telegram proof; (2) `/cancel` same selector (idempotent, one request); (3) one-message progress lifecycle
(persist message_id, editMessageText through stages, throttle, fallback); (4) auto report+XLSX delivery + contextual
follow-up; (5) canonical monitored-source registry (Google Sheets, NL Telegram UX, migrate 9 sources, no PostgreSQL);
(6) user-supplied-URL Telegram proof; (7) Stage E (existing canonical scoring contract — do NOT invent a second).
Disposable drivers to DB-delete in a window: msdrvvklv001/002, msdrvavitolv001, msdrvtg*, msdrvweb*.

---

## Session: 2026-07-05 (session 35) — FILE 1 Stage D (source quality): RELEV-WEB-001 fixed+deployed

**Canonical FILE 1 stage:** **D — Validate source quality** (IN_PROGRESS). Order confirmed by operator:
finish Stage D (**VK last**) → `/status` lifecycle → `/cancel` (same selector) → one-message progress
lifecycle → then resume **Stage E**. Do NOT redo completed collection/acceptance; no PostgreSQL.

**Status (exact):** branch `fix/stage4-live-final-acceptance`, HEAD **`aaee541`**. 2 commits this session
(`bbf364e` docs-only session-34 closure; `aaee541` RELEV-WEB-001) + a docs commit for the Stage D matrix.
NOT pushed. **$0, 0 provider calls this session** (all Stage D evidence read from the LIVE execution store
read-only). Best-available cumulative live cost: unchanged (no new provider spend); $10 test budget untouched.

**Recovery (reconciled against real repo + n8n DB, not summaries):** container `n8n-n8n-1` Up (image pinned
2.23.3); DB 191MB. **No execution running** (the `finished=0` rows are all errored+stopped, newest 01:13).
Executions 405 (WF20)/410 (WF08)/412 (WF12)/414 (WF10) all `success`. Active set = WF04/08/10/12/16 pipeline +
WF09/11/26 collectors + WF19/20/21/22/24 agent + **secure WF18 (`mslocf50ab8007ca`) active**; **legacy WF18
(`Iz1kWo…`) / WF23 / WF25 inactive** ✓. Latest report = `report_20260705_125958` (req_90112771).

**Stage D — persisted controlled sample (req_90112771), traced provider→normalize→WF16→WF08→WF10→WF12→bundle
via `node:sqlite`+`flatted` on exec 410/414 (zero cost):** 12 selected records = 2 website (mkbkfin.ru healthy,
lioncredit.ru healthy) + 1 website excluded (finardi.ru **degraded**→excluded_by_health, correct) + 10 Telegram
Public (mfo_market×8, da_credit×2). **Relevance precision = 12/12 = 100%** by manual FULL-TEXT read (T5
"Проверка СБ" is in-scope — pivots to кредитная история, NOT HR noise; I verified before judging). **Dedup=0
final duplicates** (12 distinct per-post `t.me/<ch>/<id>` URLs + domains; stable dedup_key). **BAD_URLS=0,
PLACEHOLDER_ROWS=0, contact policy respected, provenance traceable.** Full matrix + markers in
`docs/STAGE_D_SOURCE_QUALITY_ACCEPTANCE.md`. `STAGE_D_SOURCE_QUALITY=IN_PROGRESS`.

**Defect fixed (full cycle): RELEV-WEB-001** — website (WF04) records persisted with an EMPTY relevance signal
(`confidence_score=''`, `semantic_keywords=''`, no reason) while Telegram carries `confidence_score` 45/70.
Root cause: WF04 `Build Canonical Raw Record` never emitted them. Patched canonically (evidence-based 0-100
confidence: healthy competitor 70 +5/service ≤90; degraded 50; quarantined 10; market 45 + content-derived
`semantic_keywords` + Russian `relevance_reason`). Regression `tests/test_wf04_relevance_score.js` (27) +
run_all wired. Focused suites, compile gate (252 nodes), validator 308, **full `make test` ALL PASS** ($0).
**Deployed** via surgical splice (WF04 id `k4ob2TaXvCx6IDrm`, active preserved, 11 creds intact, RELEV-WEB-001
verified in DB). **Rollback:** `scratchpad/backup/wf04_prod_20260705_235439.json`. **Step-7 replay deferred:**
re-persisting historical website rows needs a live Firecrawl recollect — bundled into the Stage F/G live run
(NOT a test-only paid call).

**Remaining Stage D (exact next):** (a) **Avito** — 0 persisted rows → insufficient → needs a bounded live
Apify/Avito sample (≤3 queries, ≤30/query, budget-gated) OR record WF09-fixture acceptance as interim; (b) **VK
last** — protected token `/root/.secrets/marketing-scout-vk.token` (never print), public communities
kredit874/da_credit/anna_findoctor, posts+comments separately, tolerant-empty. Then the 3 Telegram defects
(`/status` canonical single-active selector, `/cancel` same selector, one-message progress editMessageText
proof — all need canonical patch + regression + safe deploy + one controlled live proof), then Stage E
(inspect the existing canonical scoring contract first — do NOT invent a second scoring system).

**UPDATE (same session, fresh-live acceptance policy):** operator superseded "defer live replay to save cost"
— every canonical fix now needs a FRESH bounded live run of the affected path + new-row inspection before close.
New commits: **`70c90a6`** FORCE-REPROCESS-001 (WF04 `Set URL List` only honored boolean `force_reprocess`;
callable passes strings → agent re-collection of a known domain was always dedup-skipped; fixed to accept
`'true'`, test_wf04_force_reprocess.js 5) — deployed. **HEAD now `70c90a6`** (+ pending docs commit).
**WEBSITE FRESH-LIVE CLOSURE DONE + PROVEN:** new request `req_web_sd_20260706`, WF04 **exec 427** (3 live
Firecrawl + 4 Claude calls, 3 new raw_market_records rows: mkbkfin conf=90 healthy, finardi conf=90 healthy,
lioncredit conf=75 degraded — all with relevance_reason + semantic_keywords; required-fields 0/27 missing;
0 dups; 0 bad URLs; real offers/prices extracted). Downstream **WF16→WF10→WF12 exec 433/434/435** → WF12
report rows_after_filters=2, competitors Финарди+МКБК, all 3 sites traceable w/ prices. RELEV_WEB_001_FRESH_
LIVE_RUN/WEBSITE_NEW_ROWS_PERSISTED/RELEVANCE_SIGNAL_PERSISTED/REQUIRED_FIELDS_100/DUPS_0/BAD_URLS_0/REPORT_
TRACEABILITY all PASS (see `docs/STAGE_D_SOURCE_QUALITY_ACCEPTANCE.md`). Gotcha: WF10 fail-closes without a
source_health row → downstream driver MUST run WF16 first (real WF20 order); NOT a code bug. n8n exec via
`docker exec -e N8N_RUNNERS_TASK_BROKER_PORT=5690 n8n execute --id=<driver>`; drivers msdrvweblv0001 (WF04),
msdrvwebds002 (WF16→WF10→WF12), msdrvavitolv001 (Avito, imported, NOT yet run). Cost this cycle <$0.10, well
under $10 ceiling. Follow-ups (NOT Website source-quality): WF10 competitor conf=45 vs raw 90 (Stage E);
"Публичных лид-сигналов: 999" phantom legacy blank rows (Stage G hygiene); minor `](https://www` md artifact.

**Exact next (operator-confirmed order):** (1) **Telegram Public fresh live** — WF11 for exactly mfo_market /
da_credit / broker_Aleksey (check WF11 live-fetch capability vs fixture-only; t.me/s preview is free public
web), inspect new rows + prove noise rejection (holiday/greeting/meme/vacancy — canonical regression fixtures
allowed for negatives not present live, but the real collector path must run); (2) **Avito** run msdrvavitolv001
(driver ready; approval_token=AVITO_LIVE_APPROVED, ≤3 queries×30); (3) **VK last** (token `pRZcJEyp7KExTReQ`
`HTTP Query Auth - VK Access Token` exists in prod; WF26; kredit874/da_credit/anna_findoctor; posts+comments
separate); (4) close Stage D; (5) `/status`→`/cancel`→progress lifecycle (each fresh Telegram live proof);
(6) user-supplied URL end-to-end Telegram proof; (7) Stage E (existing canonical scoring contract).
Apify cred `zPAwUY66Ae5ZcQW1`, Firecrawl `Dykz5MKZ5RoDmslr`, Claude `OEen8Vl1tdWtv7v4` all bound in prod.

**UPDATE-2 — TELEGRAM PUBLIC FRESH-LIVE DONE + PROVEN (HEAD `f8221f1`).** WF11 live `http_get` (free public
t.me/s; no token) driver `msdrvtglv0001` → **WF11 exec 437**, request `req_tg_sd_20260706`. 3 configured
channels fetched (mfo_market/da_credit/broker_Aleksey), **30 real posts reviewed**, precision **10/10=100%** on
accepted, required-fields 100% (0/100), 0 dups, 0 bad URLs, canonical scores 55/80. LIVE noise rejection PROVEN:
channel-rename `system_event`, generic-news `irrelevant`, `invalid`(<30), recruitment/RE-adjacent, dropper-
vacancy — all hard-skipped on real content. Holiday/greeting/meme = NOT_OBSERVED (recorded honestly). WF11
"Parse Live Preview Posts (inert)" is a REAL parser (inert=gate-protected). Gate token
`I_APPROVE_LIVE_TELEGRAM_PREVIEW`; agent inputs channels/max_posts/data_mode=live/transport/approval_token.
Evidence: `docs/STAGE_D_SOURCE_QUALITY_ACCEPTANCE.md`. Commits this session: `aaee541`,`6420a63`,`70c90a6`,
`c93389b`,`f8221f1` (+bbf364e docs). **$0 this run.**

**Open defect TELEGRAM-CAP-001:** agent-called WF11 leaves `pipeline_limit=10` while max_posts=30 → persistence
caps at 10 total, so broker_Aleksey persisted 0 rows (fetched+classified but past cap). Quality unaffected;
coverage capped below ≤90 plan. FIX NEXT: honor plan cap in the agent override + focused regression + deploy +
fresh WF11 re-run (all 3 channels persist), THEN Telegram SOURCE_QUALITY fully closes.

**Provider spend this session (best-available; telemetry `unknown`):** Firecrawl 3 scrapes + Claude 4 calls
(Website) + t.me http_get 3 (free). Cumulative well under the $10 ceiling.

**EXACT NEXT (in order):** (a) fix TELEGRAM-CAP-001 (cycle) → re-run WF11 live → confirm 3-channel persistence;
(b) **Avito** — run imported driver `msdrvavitolv001` (WF09 id `msloc524306e4474`, approval_token
`AVITO_LIVE_APPROVED`, actor `fatihtahta~avito-russia-scraper`, 3 queries×30, body limit+startUrls) → inspect
new rows/precision/dedup; (c) **VK last** — WF26 (id `SMQkUppyeFH2sFuf`) + cred `pRZcJEyp7KExTReQ`, communities
kredit874/da_credit/anna_findoctor, posts+comments separate, tolerant-empty; (d) close Stage D matrix
(STAGE_D_SOURCE_QUALITY=PASS only when all targets met); (e) `/status`→`/cancel`→progress lifecycle (each: fix +
regression + deploy + fresh REAL Telegram proof via secure WF18 — needs a real inbound; webhook/ngrok live since
bot is replying); (f) user-supplied-URL end-to-end Telegram proof (real non-preset URL); (g) Stage E (existing
canonical scoring contract — do NOT invent a second). Drivers are disposable/inactive; DB-delete in a window.

**UPDATE-3 (session 36, 2026-07-06) — TELEGRAM-CAP-001 CLOSED + fresh-live proven.** HEAD **`9de541a`**
(`fix(wf11): fair per-channel Telegram persistence within approved bounds`) + `cfee86f` docs continuation +
pending docs commit. Fix: `Set Connector Config` derives `pipeline_limit=min(max_posts×channels,90)`; `Deduplicate
Posts` rewritten to **round-robin fair** per-channel cap `min(live_max_posts_per_channel,30)` + global
`min(pipeline_limit,90)` (only unique-accepted rows consume capacity). Regression `test_wf11_channel_fairness.js`
(19). **Fresh live WF11 exec `440`** (`mslocacac6611966`, req `req_tg_sd2_20260706`, http_get, $0): 3 channels
fetched 10 each; dedup mfo {2 skip, 8 dup} / da_credit {3 skip, 2 dup, **5 unique**} / broker_Aleksey {4 skip, 1
invalid, **5 unique**} — **broker_Aleksey 0→5, starvation fixed**; global dedup intact (mfo all-duplicate =
already collected run-1). 10 new unique rows manually full-text inspected: precision **10/10**, 0 bad URLs, 10/10
distinct dedup_keys, 0 placeholders, scores 55(market)/80(competitor) per tier, contacts (@ipotekaprosto1) only
where verbatim public. Markers in `docs/STAGE_D_SOURCE_QUALITY_ACCEPTANCE.md`. **Two honest nuances (recorded,
NOT auto-PASS):** (1) WF11 coarse hint under-labels 5 competitor-owned offer/CTA posts (U2/U6/U7/U8/U9) as
`market_signal` — verified vs WF08 routing: WF08 `classifyDeterministic` is source-of-truth for route/entity
(Claude enrichment only enriches fields+scores, NEVER route), competitor_activity→monitor_queue→competitor,
market_signal+public_channel_post→FALLBACK review_queue/content_idea; BOTH competitor channels still captured as
competitors via U5(da_credit/603)+U10(broker_Aleksey/11646) → competitor identity NOT lost; the other posts feed
market_angles/content (defensible = marketing/positioning angles). **Downstream persisted-run PROVEN:** driver
`msdrvtgds001` WF16→WF08→WF10→WF12 (exec 442/443/444/445, WF08 llm_primary llm_enabled=true) over persisted
req_tg_sd2 (no recollection): 10 unique selected (10 dup-audit NOT selected — Filter takes dedup_status=unique
only → 0 duplicate leaks), competitor_profiles=2 (BOTH channels captured), market_angles=3 grounded (ценовой
якорь/ипотека-рефинанс/плохая КИ), claimed_pains grounded, observed_pains/leads=N/A (competitor-owned, no user
content → 0 false leads), NO fabrication. **Claude aiprimetech.io 3/8 valid JSON** (5 deterministic_fallback →
degraded→health-excluded, honest, no fabrication) = **Task F** confirmed (separate stage). Report also grounds
Website snapshots (finardi от 9,5%, lioncredit от 4,99%/до 100 млн — "от"/"до" preserved). Limitation A
(competitor offer detail thin "competitor channel ad copy") = Stage E enrichment. (2) adjacent_real_estate over-skips ~3 credit-relevant
posts (222/600/11635 mention квартира/застройщик w/o exact strong-service phrase) = deliberate niche recall
trade-off → Stage E niche tuning. **EXACT NEXT:** finish Telegram downstream persisted trace → Avito
(`msdrvavitolv001`) → VK last (WF26 `SMQkUppyeFH2sFuf`) → close Stage D → bot defects → delivery proofs → Stage E.

---

## Session: 2026-07-05 (session 34) — Empty-report root cause fixed: ISO-ARID-001 + PENDING-MINORITY-001

**Status (exact):** branch `fix/stage4-live-final-acceptance`, HEAD **`8cf219e`** (2 commits this session: `63c1d87`
eligibility + `8cf219e` report cleanliness, NOT pushed). `make test` ALL PASS · validate_workflows 308/0 · $0.
**Production WAS mutated (operator-authorized): WF10+WF12 re-imported + reactivated (twice); 2 inactive disposable
QA drivers added.** Reporting product path now proven END-TO-END: content-ful + clean + non-empty readable XLSX.

**REPORT-CLEAN-001 (commit `8cf219e`, DEPLOYED + LIVE-proven):** WF20 deliveryBody sends WF12 `report_markdown`
verbatim to the user; the render leaked report_id/`WF10 run`/`rows_after_filters=`/`trend_status=`/DEC codes/English
section-enums/workflow-names (WF04-14)/internal flags (outreach_allowed=, review_status=, manual_review). Rewrote the
render to clean concise Russian (business content unchanged); added REPORT-CLEAN-001 regression + updated VK-wording &
lead_scout redaction assertions. Live WF12 replay (report_20260705_125958): rows_after_filters=11, ALL 11 leak
patterns clear, real content (МКБК finance/LionCredit/Кредитный брокер Москва + sites+prices). **XLSX proven offline
from the real report_bundle:** 9427 bytes, valid OOXML (PK zip, 15 parts), 8 sheets, Competitors=3 rows with real
names+domains+region+source links. Detailed provenance stays in the XLSX (report_package/report_bundles), which is
report_markdown-independent.

**Defect (why approved runs delivered an empty "NO DATA" report):** two independent bugs in the aggregation path.
- **ISO-ARID-001** — WF10 run-isolation used strict `r.agent_request_id === cfg.agent_request_id_filter`, but WF08
  queue rows carry **no `agent_request_id` column** (only a family `source_run_id` like `req_x::website::a1[::telegram]`).
  Result: `rows_after_isolation` went 28→0 → empty report. Fix: isolate via `runFamilyMatch(source_run_id, filter)`
  fallback (mirrors the existing source_run_id_filter line). Cross-request isolation stays strict.
- **PENDING-MINORITY-001** — a run-level `pending_review` quality flag (ONE pending sibling) made
  `report_gate.decideRun` exclude the WHOLE website run, discarding the two confirmed report-eligible records
  (mkbkfin.ru, lioncredit.ru). Fix: run-level gate now excludes only on run-level `review_status=pending`; the
  per-record `rowEligible` still drops the individual pending record; fully-pending runs stay fail-closed.

**Changed (commit 63c1d87):** `n8n/lib/report_gate.js` + WF10/WF12 embedded mirrors (programmatically re-synced
byte-identical; drift tests green) + `tests/test_report_gate.js` + `tests/test_wf10_source_health.js` (focused
regressions for both bugs incl. no-cross-request-leakage + confirmed-survive/pending-excluded + fully-pending fail-closed).

**Live proof (real data, req_90112771, zero recollection):** deployed via surgical splice (exported live WF10/WF12,
replaced only the changed node `jsCode`, preserved credential bindings + ids + `active=true`; import deactivates →
reactivated). Replayed WF10→WF12 through a disposable driver. **WF10 exec 414:** rows_after_isolation=**12**,
rows_after_filters=**11**, excluded_by_health=1 (pending sibling), competitor_profiles=**3**, market_angles=**5**,
no foreign-request rows. **WF12 report** (report_20260705_121358): rows_after_filters=11, NOT no_data; real content —
competitors МКБК finance / LionCredit / Кредитный брокер Москва; sites mkbkfin.ru, finardi.ru, lioncredit.ru w/ prices;
angles ипотека/рефинансирование, плохая КИ, скорость; telegram audience q=8/obj=3/complaints=3.

**Prod preserved:** secure WF18 ACTIVE · legacy WF18 / WF23 / WF25 inactive · Telegram webhook healthy (url set,
pending=0, no error) · command menu [start,help,status,cancel]. Backups: `scratchpad/backup/wf{10,12}_prod_*.json`.

**Operator added a large product-acceptance list (12 items). Done so far: 1–3 (deploy 63c1d87, WF10/WF12 replay,
content-ful+clean report+XLSX). NEXT = item 4: fix `/status`** — it shows multiple stale/duplicate requests
(waiting-for-approval, approved-preparing, old test requests). Required: scope by owner+chat; show at most ONE current
active request (newest valid non-terminal); ignore completed/rejected/cancelled/superseded; TTL-expire stale awaiting-
approval; reconcile approved-but-completed; `/cancel` acts only on the current active; no internal IDs/raw states.
Trace status selection logic + persisted request states (agent_requests / conversation_state sheets), add focused
regressions, reconcile only the operator's stale rows (never delete valid reports). THEN items 5-12: durable business
profile/memory (`что ты помнишь?`), report follow-ups/filters/evidence/export/charts, source-registry management UX
(one canonical registry; migrate configured web/TG/VK sources), Telegram source types, bounded VK acceptance (WF26,
existing cred), weekly-digest control (WF23/WF25 stay inactive), one-message progress lifecycle, full source acceptance,
final regression, operator checkpoint. Do NOT introduce PostgreSQL. 2 inactive disposable drivers (`msdrvreplay0001`,
`msdrvwf12only01`) safe to DB-delete in a maintenance window.

---

## Session: 2026-06-28 (session 32) — Stage 4–8 final closure: LIVE production repair + image pin (DEC-164)

**Status (exact):** branch `fix/stage4-8-final-closure` off `main` @ `189c0ee` (PR #45). **3 repo commits, NOT
pushed, no AI attribution:** `8d02032` deploy entrypoints + fail-closed dry-run · `8ac1600` (type,name) credential
reconciliation + WF19 Claude name · `b60bb54` real shell-entrypoint + credential tests. **$0, 0 paid/external calls.**
This session DID mutate production (operator-authorized Stage 4–8 closure): one **inactive** repair apply, an image
pin, a concurrency env add, and one n8n-only restart. **sing-box / Amnezia / 3x-ui / port 443 / the production
volume untouched; old conversational WF18 not deleted or activated; NOTHING activated (0 active workflows); no
Telegram webhook registered; no paid connector enabled.**

**BLOCKER A (fixed):** `credential_audit()`/`verify_production()` read `N8N_EXPECTED_VERSION` (in `detect_n8n_version`)
before `load_manifest_arrays` → `set -u` crash. Added `ensure_expected_version()` (idempotent, called at the top of
`detect_n8n_version`) + reordered. All modes now clean under a clean env.

**BLOCKER B (fixed):** production dry-run said "reconciliation deferred to apply" + returned OK. It now stages what an
apply would import against the LIVE workflow+credential export and AUDITS it (zero mutation, throwaway id map), emits
PRODUCTION_*/WF18_* markers, fails closed on hard failures, returns non-zero with `PASS_WITH_DEFERRED_CREDENTIALS` on
deferred-only. `release_plan.reconcile_credentials` fails closed for production when no export is supplied.

**Credential model (CRED-003):** production legitimately holds 3 httpHeaderAuth creds (Claude/Firecrawl/Apify), so
reconcile by **(type,name) → type-unique fallback → defer/abort**. `collectReferences` now captures the credential
NAME. WF19 planner credential renamed generic→`Claude API - Marketing Scout` (regen: only WF19 changed). Derived vs
LIVE prod: **92 = 84 googleApi + 6 httpHeaderAuth + 2 httpQueryAuth**; **90 resolve, 2 VK defer (no prod
httpQueryAuth), WF18 14/14 clean.**

**Pre-repair LIVE baseline:** 92 required, 56 missing-ref, 31 placeholder-leak, 87 failures, WF18 0/14 → AUDIT=FAIL.
**Post inactive apply (`b60bb54`):** 0 missing, 0 placeholders, 90 resolved, 2 deferred, **0 failures**, 13/13
bindings, 0 active, coverage 15/15, **WF18 14/14 → PASS**; evidence `result=PASS_WITH_DEFERRED_CREDENTIALS` (honest).
**`make verify-production`=PASS.** Image pinned `n8nio/n8n:latest→:2.23.3` (same digest `c0c39b1ca69d`; localhost-only
`127.0.0.1:5678` preserved); `N8N_CONCURRENCY_PRODUCTION_LIMIT=1` set + effective (IDEMP-001 serialization). Fresh
read-only backup `/root/backups/n8n-stage48-closure-20260628-104515` (sha `19a8dcff…`) + compose/env backups.

**Still BLOCKED on operator (genuine external prereq):** `PUBLIC_WEBHOOK_BASE_URL` / public HTTPS ingress for the
Telegram webhook — port 443 = sing-box(tcp)/amnezia-awg2(udp), n8n localhost-only, no domain/tunnel creds. WF18
activation gate stays PENDING (TELEGRAM-001 open; IDEMP-001 mitigated→live concurrent proof needs activation). VK
httpQueryAuth credential also operator-pending (real token). `make test` ALL PASS incl new `deploy-entrypoints`.

**Finding (non-blocking):** WF04/WF08 Claude nodes target `aiprimetech.io` (not `api.anthropic.com`) on the DISABLED
paid-LLM path — operator should confirm that proxy host is intended.

---

## Session: 2026-06-28 (session 31) — Production credential reconciliation (DEC-163)

**Status (exact):** branch `fix/production-credential-reconciliation` off `main` @ `752c565`. **9 commits, NOT
pushed, no AI attribution.** `ee59912` cred refs · `2189baa` audit missing-ref · `03c73f7` docker-safe cred export
· `63aa3a4` evidence/verify fail-closed · `cccef38` redact bind ids · `768561e` staged fixture · `6aa5c43` manifest
resync · (+IDEMP doc). **$0, 0 external/paid calls, all 28 committed workflows `active=false`, no secret/raw-id
committed, production `n8n-n8n-1`/volume/`sing-box`/443/Amnezia/3x-ui untouched, NOTHING activated, no Telegram
webhook, no docker mutation, no compose edit.** `make test` ALL PASS; `make release-core-acceptance` PASS.

**Root cause (P0).** Two defects: (1) `gen_stage4_workflows.js` built every Sheets node (+ Claude/VK HTTP) with NO
`credentials` block — 53/84 Sheets nodes credential-less; the audit only flagged *bad* refs so WF18's 14
credential-less Sheets nodes falsely PASSed. (2) `deploy_n8n.sh` credential export wrote `--output` to a HOST path
the docker CLI can't see → empty credflag → all deferred. **Both fixed.**

**Fixed (repository-scoped, committed):** every credential-requiring node now carries a config-derived reference
(**92 expected** = 84 googleApi + 6 httpHeaderAuth + 2 httpQueryAuth, 0 missing; node-by-node, NOT to make counts
green); `reconcile_credentials.js` requirement model + honest `--audit`; Docker-safe `export_credentials` +
`--credential-audit`; `release_report.deriveResult()` (never PASS on unknown/deferred creds; manifest counts 15/13
not stale 8); `do_import` POST-IMPORT audit + conditional "preserved" message + hard-FAIL blocks clean release;
`--verify-production` aggregate marker; bind report `*_fp` redaction. **Offline proof:** staged vs 3-cred export →
92/92 resolved, 0 deferred, 0 failures, WF18 PASS (14 refs). +44 new tests.

**Operator-gated (NOT done — hard stops):** fresh backup / live cred compare / inactive repair apply (docker);
**IMAGE_PIN=FAIL** (`/opt/n8n/docker-compose.yml` = `n8nio/n8n:latest`, running 2.23.3 — needs pin to `2.23.3` +
n8n-only restart, **outside repo**); **IDEMP-001** (set `N8N_CONCURRENCY_PRODUCTION_LIMIT=1` main-mode — currently
UNSET — + concurrent test); **TELEGRAM-001** (n8n on 127.0.0.1:5678 only, 443=sing-box; needs outbound tunnel +
operator domain/creds + `PUBLIC_WEBHOOK_BASE_URL`/`MS_TELEGRAM_WEBHOOK_SECRET`, both MISSING); real Sheets accepted
path; Telegram prelive/live; legacy conversational WF18 retirement. WF18 gate correctly CLOSED (TELEGRAM-001 +
IDEMP-001).

---

## Session: 2026-06-27 (session 30) — Stage 4–8 runtime acceptance + production-discovery repair (DEC-162)

**Status (exact):** branch `test/stage4-runtime-acceptance` off `main` @ `d10866b`. **4 commits, NOT pushed**
(`38a8698` release/discovery fixes · `3fc7c74` idempotency honesty · `c81b738` runtime acceptance + topology audit
· `74e4c02` DEC-162 docs). **$0, 0 external/paid calls, all committed workflows `active=false`, no secret/raw-id
committed, production `n8n-n8n-1`/volume/`sing-box`/443 untouched, NOTHING activated, no Telegram webhook
registered.** `make test` → ALL SUITES PASS; `make release-core-acceptance` PASS; `make runtime-acceptance` →
**RUNTIME_ACCEPTANCE=PASS** (real disposable n8n 2.23.3).

**Read-only production discovery (sanitized):** 21 workflows ALL inactive; **14/15 exact-match (UPDATE in place,
ids preserved), WF18 = RENAME (conversational→secure dispatcher → CREATE + legacy predecessor), 0 dup, 0
ambiguous, 7 legacy/extra, 0 active.** Existing prod workflows ARE reconcilable in place; WF20/21/23 child edges
already bound (noop) — only WF18's 5 dispatch edges unbound (stale prod WF18). Container env has everything except
`PUBLIC_WEBHOOK_BASE_URL` + `MS_TELEGRAM_WEBHOOK_SECRET` (TELEGRAM-001, operator).

**Fixed (confirmed, repository-scoped):** STATUS-001 (RESOLVE_STATUS subshell bug → `resolve_into` + inventory
classifier; fail-closed on empty listing), CHECKCONFIG-001 (preflight `--discover` uses effective env
container>file>process), RELEASE-006 (docker-safe `capture_export`), DISCOVERY-001 (`make release-discovery` =
live read-only), OPERATOR-REPORT-001 (binding counts from manifest=13). IDEMP-001 `resolved`→`mitigated`
(concurrent exactly-once unproven; gate clears only resolved/accepted → stays PENDING on TELEGRAM-001+IDEMP-001).
RUNTIME-ACCEPTANCE-001 = new disposable runtime proof (8 reject paths route to Terminate w/ zero side effects;
accept→dispatch; real parent→child + child-failure propagation).

**Rejected:** WF04 SSRF — WF04 calls only fixed allowlisted hosts (Firecrawl API + Claude); the user URL is a
Firecrawl parameter, never fetched by n8n → no direct SSRF surface.

**New files:** `tools/workflow_inventory.js`, `tools/gen_runtime_acceptance_fixtures.js`,
`scripts/n8n_runtime_acceptance.sh`, `tests/test_status_discovery.js` (65), `tests/test_runtime_acceptance.js`
(137), `tests/test_stage567_topology.js` (56). Changed: `scripts/deploy_n8n.sh`, `tools/preflight_config.js`,
`tools/release_plan.js`, `tools/wf18_activation_gate.js`, `config/wf18_blockers.json`, `Makefile`, `tests/run_all.js`,
`tests/test_reconcile_and_gate.js`.

**Remaining (operator/live):** production dry-run → inactive deploy (WF18 rename decision) → verify → HTTPS ingress
(TELEGRAM-001) → telegram-prelive → WF18 activation (gate still PENDING on TELEGRAM-001+IDEMP-001) → controlled
live acceptance (accepted-path-with-Sheets + Telegram = OPERATOR_PENDING).

---

## Session: 2026-06-27 (session 29) — WF18 gateway REARCHITECTURE: real secure dispatcher (DEC-161)

**Status (exact):** branch `fix/wf18-gateway-rearchitecture` off `main` @ `2631499`. **3 commits, NOT pushed**
(`66fe401` core rearchitecture · `f4618e1` real-topology suite · docs commit pending). **$0, 0 external/live
calls, all workflows `active=false`, no secret/raw-id committed, production `n8n-n8n-1`/volume untouched,
`sing-box`/443 untouched, no API call, no activation.** `make test` → **MAKE_TEST_RC=0, ALL SUITES PASS**
(external calls=0, $0); new `wf18-real-topology` = **85 checks**.

**Root cause (why libs passed while the graph was dead):** the offline E2E suites SIMULATED the sequence in JS;
the committed WF18 graph was `webhook→reads→persist→reply` with **0 `executeWorkflow` nodes**, no secret/kill-
switch/auth/dedup hard-stop, and `Build Conversation Context` fanning out to every Sheets write + the Telegram
send for unauthorized AND duplicate updates. WF19/20/21/22 were **manual-only (not callable)**.

**Built (DEC-161, all generator-driven + drift-proof, regenerated WF17-26):**
- **Fail-closed ingress** — `telegram_io.ingressDecision` (secret header vs `MS_TELEGRAM_WEBHOOK_SECRET`, constant-
  time, blank=reject; `MS_ENABLE_TELEGRAM` kill switch; supported-type message/callback only; private-chat-only;
  bot filter; auth) as ONE pure node BEFORE any read. `agent_config.enable_telegram` default **false**;
  `enable_llm_intent` pinned false (no in-graph classifier ⇒ clarify; WF19-LLM-001 honest). `Ingress Accepted?` /
  `New Update?` IFs hard-stop to **Respond-200**; reject/duplicate reach **0 Sheets / 0 child / 0 business send**
  (only an authorized-but-duplicate callback gets `answerCallbackQuery`).
- **Real dispatcher** — WF18 routes `dispatch_target` → `executeWorkflow` to **WF19** (plan) / **WF20** (orchestrate)
  / **WF21** (deep) / **WF22** (control: memory/source/cancel/reject/status) / **WF24** (report ops). WF19/20/21/22
  gained Execute Sub-workflow Triggers + named contracts + robust caller-input read. Manifest auto-derives **8→13
  binding edges**, **6→11 callable targets**; `audit_workflows` passes.
- **Durable plan + approval binding** — `request_planner.planIdentity/buildPlanRow/validateApproval` + new
  `execution_plans` tab. Plan persisted (status `awaiting_approval`) BEFORE the approval message; approval bound by
  owner/chat/request/**plan_hash**, rejected when stale/cancelled/completed/replayed; free-text да/нет binds only on
  exactly one pending plan (STATE-002 / WF18-APPROVAL-002/003).
- **State/memory/persist** — `request=t.record` (STATE-001); conv id = chat+user (cross-user isolation);
  `selectLatestState/advanceState` monotonic revision (STATE-004); WF18 reads durable_memories + latest summary +
  scoped artifacts (MEMORY-001/002/003); explicit Shape node before every Append (DATA-001); formula-injection
  escape (SHEETS-004); WF22 UPSERTS canonical stores, audit only after mutation (WF22-PERSIST/CANCEL-001).
- **Tests** — `tests/test_wf18_real_topology.js` (85) inspects the committed JSON graph (reachability) for §19's 20
  assertions + §20 negative matrix; existing drift/manifest/binding/release count tests updated (13 edges / 11
  callables / 41 sheet tabs).

**Blockers registry:** 18/19 `config/wf18_blockers.json` resolved with named tests; **TELEGRAM-001 (public HTTPS
ingress) LEFT OPEN** (operator sing-box/443 infra). `wf18_activation_gate.js` → **WF18_REARCHITECTURE=PENDING**,
WF18 activation correctly still BLOCKED (honest: dispatcher-ready, not live-ready). **IDEMP-001 caveat:** claim-
before-side-effect + deterministic key + sequential-dup proven; true concurrent atomicity needs WF18 single-
concurrency (documented). **ORCH-STATE-001 partial:** entry gate enforces approved/not-cancelled; per-stage
re-read in WF20 is a documented follow-up. **RELEASE-006/DISCOVERY-001** (prod export-capture) unchanged — still
block `make deploy-inactive`/`telegram-activate`; left as exact handoff (no prod dry-run run this session).

**Next:** operator (1) provision HTTPS ingress (TELEGRAM-001) → resolve in registry; (2) disposable n8n import/
export round-trip of the new topology (n8n CLI absent here); (3) prod dry-run to clear RELEASE-006/DISCOVERY-001;
(4) gated controlled live acceptance. No code work queued for WF18 core.

---

## Session: 2026-06-26 (session 28) — Stage 8 release-path INTEGRATION REPAIR (DEC-160), DISPOSABLE_DEPLOY=PASS

**Status (exact):** NEW branch `fix/stage8-release-integration` off `main` @ `2ee4a71`. The first release-core
session (session 27) built good standalone tools but they were **NOT wired into the real operator deploy path**
(operator inspection confirmed: `deploy_n8n.sh` still imported raw JSON, printed `id=(assigned on import)`,
selected by first-match, never called runtime_ids/reconcile/lock/backup/release_report; disposable tested the
legacy path). This focused repair connected them into **ONE shared, ordered, fail-closed, idempotent release
pipeline** used by BOTH production deploy and the disposable acceptance. **Proven against REAL n8n 2.23.3** in a
throwaway container: **`DISPOSABLE_DEPLOY=PASS`** with the full honest §14 marker block. **Production `n8n-n8n-1` /
volume `n8n_n8n_data` NEVER touched** (Up 16h throughout), `$0`, no secret printed, no workflow activated, no
production volume touched, `sing-box` untouched. `node tests/run_all.js` ALL SUITES PASS. **6 commits, NOT pushed.**

**Built/fixed (all disposable-proven against real n8n 2.23.3):**
- **New tools:** `env_discovery.js` (effective config from file/compose/container/process; SET/MISSING/fingerprint,
  secrets NEVER printed — fixes the CONFIG/PREFLIGHT defect), `release_plan.js` (the ordered fail-closed planner
  composing runtime_ids+reconcile+preflight+gate), `prepare_staged_workflows.js` (staged JSON: resolved id+bindings
  +reconciled creds+active=false; import STAGED not raw).
- **`scripts/lib/release_pipeline.sh`** shared lock/backup/evidence/rollback layer; **`scripts/rollback.sh`** real
  rollback (webhook+publication+id-map+backup restore+verify), Makefile `rollback` no longer telegram-only.
- **`deploy_n8n.sh`:** dry-run runs live discovery + the ordered planner (production fails closed = DEPLOY-004;
  explicit soft `--offline-plan`); `id_fp` fingerprints (DEPLOY-003); strict exact-name 0/1/>1 (DEPLOY-002,
  ambiguous aborts); `--apply` = lock→resolve+persist ids→reconcile→backup→import STAGED inactive→bind→verify→
  evidence→unlock (EXIT-trap writes ABORT diagnostics+rollback+frees lock on failure); transactional WF18-only
  `--activate-telegram` (ACTIVATE-002, auto-unpublish on webhook failure); publish via `n8n_cli` (ACTIVATE-001).
- **Docker-only blocker no prior session caught:** a docker-exec `import:workflow --input=<host path>` ENOENTs (CLI
  runs INSIDE the container) → `n8n_exec.sh` gained `n8n_put`/`n8n_get` (docker cp); deploy copies staged in before
  import; bindings pre-resolved so a single fresh-export VERIFY replaces the re-import dance; `backup.sh` runs the
  backup container `--user 0:0` (node user couldn't write the root-owned dest).
- **Disposable e2e** (`n8n_disposable_e2e.sh`) drives the SAME `deploy_n8n.sh --apply` (TEST-002); broad `|| true`
  removed from the primary apply (exit codes asserted, TEST-003); `PARENT_CHILD_RUNTIME`→`PARENT_CHILD_TOPOLOGY`
  (MARKER-001); guarded disposable names (never production / never image-ancestor filter); honest SKIP without docker.
- **Tests:** `test_release_integration.js` (112) proves the deploy path calls discovery→reconcile→resolve IN ORDER,
  fails closed on every negative path, and a runtime proof that rp_finish writes ABORT evidence + releases the lock;
  `test_prepare_staged.js` (23). Registered in run_all.js + Makefile.
- **Docs:** corrected the sequence everywhere to `discovery→resolve IDs→preflight→dry-run→backup→apply inactive→
  verify` (DOCS-001) — STAGE8_RELEASE_CORE, NEXT_ACTIONS, WF18 handoff, DEFECT_REGISTRY (new integration table +
  first-session table now Disposable ✅).

**Commits:** `6b90a15` ids+discovery · `7a294c6` staged+cred reconcile · `dd5fe3e` lock+backup+evidence+rollback ·
`3932dc1` docker-safe+transactional activation · `8dc1b8e` disposable via shared pipeline · (docs commit pending).

**Next:** the WF18 gateway rearchitecture session (`docs/WF18_REARCHITECTURE_HANDOFF.md`) → then operator prod/live
acceptance. The hard gate keeps WF18 unpublishable until the 19 P0/P1 blockers are resolved with named tests.

---

## Session: 2026-06-26 (session 27) — Stage 8 RELEASE-CORE built (DEC-159)

**Status (exact):** NEW branch `feat/stage8-release-engineering` off `main` @ `d3a392c` (Stage 5/6/7 already on
main via PR #39 + locale fix PR #40 — nothing lost). **$0, 0 external/live calls, every workflow `active=false`,
NOT pushed/merged/imported, production untouched, `sing-box`/volume untouched, no secret or raw n8n id committed.**
`node tests/run_all.js` ALL SUITES PASS. 7 commits.

**Scope decision (operator-confirmed):** focus = **release-engineering core** (the literal Stage 8 spine), NOT
the WF18 rearchitecture. Honest markers only: `STAGE8_RELEASE_CORE=PASS`, `WF18_REARCHITECTURE=PENDING`,
`CONTROLLED_LIVE_ACCEPTANCE=PENDING`, `PRODUCTION_UNTOUCHED=true`. `STAGE8_RELEASE_ENGINEERING` intentionally NOT
asserted. ID strategy: gitignored operator-local map (operator-confirmed), real ids never committed.

**Built (all offline-proven, $0):**
- **Operator-local id strategy** (DEPLOY-007/003/002/006): manifest `runtime_identity` (logical, `canonical_id:null`)
  + `tools/runtime_ids.js` fail-closed/idempotent resolver (verified/discover/generate/create/abort). Real ids
  live ONLY in gitignored `config/runtime_ids.local.json` (mode 600, backup-before-write); reports = fingerprints
  only. `tests/test_runtime_ids.js` (47).
- **Docker-safe exec** (DEPLOY-001/BACKUP-001): `scripts/lib/n8n_exec.sh` (host/docker/`/bin/sh`, `--entrypoint
  /bin/sh`, dry-echo `MS_N8N_EXEC_DRY`, destructive guard); deploy routes through `n8n_cli`. `test_release_shell.js` (76).
- **Strict preflight** (CONFIG/PREFLIGHT/LIVE-001/TELEGRAM-001/002/FUTURE-015): token/$env/IANA-tz/report-mode/
  webhook-url/secret + cross-field invariants + 22-key zero-paid profile assertion. `test_preflight_strict.js` (36).
- **Operator scripts**: `backup.sh` (entrypoint-override, never `--decrypted`/volume-rm), `restore_validate.sh`
  (offline sha256+content; disposable when docker), `telegram_webhook.sh` (token env-only never printed),
  `release_lock.sh` (stale-safe), `tools/release_report.js` (sanitized evidence). `test_release_scripts.js` (35).
  Fixed a real `tar|grep -q` pipefail/SIGPIPE false-negative in restore.
- **Reconciliation + WF18 gate**: `reconcile_workflows.js` (exact-name 0/1/>1), `reconcile_credentials.js`
  (non-decrypted, refuses `PASTE_CREDENTIAL_ID_HERE`), `wf18_activation_gate.js` + `config/wf18_blockers.json`
  (19 P0/P1 open → deploy `--activate-triggers` refuses WF18). `test_reconcile_and_gate.js` (29).
- **Acceptance + interface**: `test_stage8_release_e2e.js` (23) emits the §21 marker block; `make release-*`
  unified operator interface.
- **Docs**: `docs/STAGE8_RELEASE_CORE.md`, `docs/DEFECT_REGISTRY_STAGE8.md`, `docs/WF18_REARCHITECTURE_HANDOFF.md`.

**Next:** the WF18 gateway rearchitecture session (see handoff) → then operator disposable/prod/live acceptance.

---

## Session: 2026-06-24 (session 26) — MVP Stage 4–8 hardening: module isolation, compile gate, Vinci identity (DEC-158)

**Status (exact):** NEW branch `feat/vinci-mvp-stage4-8` off `fix/stage3-verification-stage4-readiness` @ `f1a9d47`
(all prior commits preserved). **$0, 0 external calls, every workflow `active=false`, NOT pushed/merged/imported,
no production change, no secret exposed.** `make test` ALL SUITES PASS (66 suites).

**Release blocker fixed (root cause):** the live Stage 3C `Identifier 'MS_TZ' has already been declared` came from
the ops‑QA generator concatenating the engine core directly into the Code node, so the engine's private
`var MS_TZ` collided with the node glue's `const MS_TZ`. New `tools/embed_lib.js` `isolatedModule()` wraps the
stripped core in an IIFE returning an explicit exports object (no `module.exports` literal); engine privates stay
inside the IIFE. Regenerated the QA workflow (deterministic). 3 commits: `e9c7c2c` (fix+compile gate),
`57d2882` (identity+command menu), docs commit pending.

**Compile gate (new):** `tests/test_generated_code_compiles.js` parses every Code node (215) in all 33 committed
workflows + every generator's in‑memory `build()` output via `new Function` (never executed). `gen_stage4` now
builds in memory with no disk writes unless run as CLI. Wired first in `run_all.js`.

**Vinci AI Pilot identity:** new canonical versioned `n8n/lib/agent_identity.js` (`identity-v1`/`vinci-system-v1`)
— Russian identity, deterministic zero‑cost identity answer, Claude system prompt. `agent_charter.js` →
`charter-v2` with the Vinci identity; `intent_router` routes "кто ты?"‑class to non‑external help. Regenerated
WF18/20/21/23/26.

**Command menu:** `scripts/configure_telegram_commands.sh` (dry‑run default, env‑only token never printed/in argv,
`--live` verifies via `getMyCommands`, fail‑closed). Offline tests: `test_agent_identity` (48), `test_telegram_commands` (16).

**Docs (new):** `MVP_IMPLEMENTATION_STATUS.md`, `MVP_STAGE4_8_REQUIREMENTS_MATRIX.md`,
`config/stage_acceptance_manifest.json`, `MVP_LIVE_ROLLOUT_RUNBOOK.md`, `MVP_SECURITY_REVIEW.md`.

**Invariants kept:** 31 manifest / 15 runtime closure / 8 binding edges / n8n 2.23.3.
**Next:** operator Stage 3C live retest (QA‑018/019 still FIXED IN CODE — LIVE RETEST REQUIRED) → Stage 4 live deploy.

## Session: 2026-06-23 (session 25) — Moscow time + non-empty staging + Stage 4 free path (DEC-157)

**Status (exact):** same branch `fix/stage3-verification-stage4-readiness`. **$0, 0 external calls, every
workflow `active=false`, NOT pushed/merged/imported, no production change, no secret exposed.** Consolidated
package fixing the SECOND live Stage 3C failure (non-empty staging) + completing the Russian Stage 4 free path.

**Residual QA-018 cause (found):** a correct live write still failed `READ_BACK_AGENT_REQUEST` because the
staging sheet held prior QA runs AND the timestamp columns (`created_at`/`ts`/`updated_at`/`added_at`/
`last_change_at`) re-render in Google's offset-less locale form (`23.06.2026 15:04:05`) that `Date.parse` can't
round-trip. **Fix:** new `n8n/lib/ms_time.js` (Europe/Moscow, IANA offset, RFC3339 `+03:00`, `DD.MM.YYYY HH:mm
МСК`); engine `toInstant` now Moscow-aware (mirrors it) so Z/+03:00/offset-less/RU+US renderings = one instant;
QA harness writes Moscow RFC3339.

**Non-empty staging (QA-019 robustness):** `findRequestARow` locates request A by FULL identity (qa_run_id +
agent_request_id + owner + data_mode + role marker, never first-match); `verifyBeforeAfter` classifies
current_run_owned / previous_qa_run / foreign_non_qa and holds the latter two unchanged. Diagnostics gain
physical_row/key/qa_run_id/reason; empty = `[]` not `[null]`. New markers CURRENT_RUN_OWNED_ROWS /
PREVIOUS_QA_RUN_ROWS / FOREIGN_NON_QA_ROWS. Proven by §21 (fresh run over prior A+B + foreign rows).

**Stage 4 free path:** `agent_config` gains canonical fail-closed zero-paid guards (enable_telegram/
enable_external_actions/enable_claude/enable_apify/firecrawl/vk/monitoring/weekly_digest; `zero_paid_mode`,
`effective_max_external_calls`, helpers paidCallsAllowed/collectorEnabled/llmAllowed/freePathStatus);
`MS_MAX_EXTERNAL_CALLS=0` master kill-switch; approval can't bypass. `/start` now a deterministic Russian command
(intent_router → welcome/help, no API). Stage 4 workflows regenerated (deterministic).

**Evidence (offline):** `make test` ALL SUITES PASS — sheets-operations-qa **190**, ms-time **24**,
stage4-freepath **76**; manifest 187, validate_workflows.py 277, validate_sheet_contracts 363; all generators
drift-clean. New docs: `docs/STAGE_4_BOT_DEPLOYMENT.md` (BotFather list + Russian UX + auth + idempotency +
approval + zero-paid + env + deploy + webhook + smoke + rollback). DEC-157.

**Status markers:** QA-018/QA-019 = FIXED IN CODE — LIVE RETEST REQUIRED; STAGE_4_IMPLEMENTATION = READY FOR
LIVE DEPLOYMENT TEST. **Next:** operator live Stage 3C retest (4-run sequence) + Stage 4 free-path smoke.

---

## Session: 2026-06-23 (session 24) — Stage 3C QA-018/QA-019 fix + Stage 4A readiness audit (DEC-156)

**Status (exact):** branch `fix/stage3-verification-stage4-readiness` off `main` `820a593`. **$0, 0 external
calls, every workflow `active=false`, NOT pushed/merged/imported, no n8n import, no credentials touched, no
production change.** Consolidated repair of the two live Stage 3C defects + a read-only Stage 4A Telegram
live-readiness audit.

**QA-018 (read-back) — FIXED IN CODE, LIVE RETEST REQUIRED.** The first live write was correct but
`READ_BACK_AGENT_REQUEST` failed because `USER_ENTERED` values come back **rendered**: `-5`→`-5.00` /
`-4.5`→`-4.50` (bootstrap number format `#,##0.00####` on `*_usd` columns), `false`→`FALSE` (checkbox). Fix =
one shared **contract-aware comparison layer** in `n8n/lib/sheets_operations_qa.js` (numeric/boolean/timestamp/
text/blank semantics; blank never == 0/false; locale digits only on proven-numeric columns; legitimate
apostrophes preserved) with structured `READ_BACK_FAILURES` diagnostics. Formula safety stays **separate**: a
bounded `spreadsheets.get?includeGridData=true` typed read (new nodes *Build Request-A Type Range* + *Get
Request-A Cell Types*) proves each formula cell is `userEnteredValue.stringValue`, never `formulaValue`.

**QA-019 (before/after scope) — FIXED IN CODE, LIVE RETEST REQUIRED.** Byte comparison mis-counted the run's
own normalized rows as foreign, so `BEFORE_AFTER_SCOPE` failed while all scope counters were 0. Fix =
**identity-based** `verifyBeforeAfter` (run-owned vs foreign by marker/identity; foreign rows compared with the
same contract-aware comparator) returning structured `BEFORE_AFTER_FAILURES`. No check removed.

**Markers (D):** `WRITE_NODE_EXECUTED / WRITE_REQUEST_SUCCEEDED / MUTATIONS_EXECUTED / AFTER_SNAPSHOT_READ /
ACCEPTANCE_VERIFIED / CHANGES_APPLIED / RESULT` are now separable & truthful — `CHANGES_APPLIED=true` even when
verification fails; once the write node ran, `RESULT` is acceptance-based (no fall-back to the dry-run PASS).

**Evidence (offline):** `tests/test_sheets_operations_qa.js` **162 checks** PASS; generated workflow **20 nodes**,
deterministic (`source_hash=h1287b23e`, regen twice byte-identical); `node tests/run_all.js` ALL SUITES PASS
(`$0`, 0 external calls); manifest 187, `validate_workflows.py` 277, `validate_sheet_contracts` 363.

**Stage 4A audit:** read-only (`docker compose ps`, `docker ps`, `n8n --version`); no import/activation/restart;
no secrets printed. See `docs/STAGE_4A_TELEGRAM_LIVE_READINESS.md`.

**Commits (local only):** `fix(sheets): verify normalized Stage 3C read-back`, `docs(stage4): add Telegram
live-readiness audit`.

**Next:** operator live retest sequence (dry-run → first write new `QA_RUN_ID` → repeat same id → final dry-run)
to close QA-018/QA-019; then Stage 4A controlled live E2E. See `docs/STAGE3_SHEETS_OPERATIONS_ACCEPTANCE.md`.

---

## Session: 2026-06-21 (session 23) — Reporting UX & release-verification phase (DEC-155)

**Status (exact):** branch `feat/reporting-ux-and-release-verification` (baseline `b7a95c1`). **$0, 0 external
calls, all 31 workflows `active=false`, NOT pushed/merged/imported, no credentials.** Built reporting outputs
(scoped CSV/XLSX/charts, evidence, compare, NL filter, smart refresh), conversation UX (scope/cost preview in
WF19, progress in WF20, weekly digest WF25), optional VK public-community collector (`vk_collector.js` + WF26 +
WF23 edge — *structurally implemented, offline-tested, live-unverified*), honest Telegram channel capability,
URL SSRF + prompt-injection safety, and the storage layer (`sheets_contracts.json` + validator + `sheet_audit` +
`retention_policy`). New WF24/25/26; libs embedded drift-proof.

**Commits this session (local only):** `6478ac0` progress/scope/digest libs · `8fc91bf` reporting WF integration
· `673a5bd` VK collector · `9cc2068` storage contracts/retention · `b9bec47` url-safety + telegram channel +
capability matrix · (+ test(release) e2e/docs commit). `make test` ALL SUITES PASS (external calls=0, $0).

**Next:** operator review → optional push/PR; credentialed staging test for VK + Telegram bot-update before
marking production-live; n8n import remains unproven (CLI absent). See
`docs/REPORTING_UX_AND_RELEASE_VERIFICATION.md`.

---

## Session: 2026-06-21 (session 22) — Release hardening: proactive delivery + scheduled monitoring (DEC-153)

**Status (exact):** final automated release-hardening before controlled install. Branch
`stage-3-closure-and-stage-4`. **0 external calls, $0**, all workflows `active=false`, **not pushed**, no n8n
import. Three planned commits: (1) `feat(agent): complete proactive report assistance and scheduled
monitoring`; (2) `fix(release): verify n8n persistence subworkflow and delivery wiring`; (3) `test(release):
add full project regression and disposable import smoke`.

**Commit 1 — BUILT (DEC-153):**
- **Proactive delivery in the REAL path:** WF20 `Build Delivery Outbox` now co-embeds conversation_response +
  agent_charter; `deliveryBody` = immutable facts + state-aware proactive continuation (registry-driven;
  partial/no-data → recovery actions); keyboard on FINAL chunk only (`intent:<id>` callbacks).
- **WF23 Scheduled Tracked Source Monitor** (16 nodes, real Schedule Trigger, `active=false`) + new
  `n8n/lib/source_monitor.js`: due selection, sched/manual idempotency window, content-hash change detection
  (baseline-then-diff), lifecycle updates, change event persisted BEFORE notify, notify-once (`change_id =
  source_id::new_hash`). Manual "check now" reuses the contract with a manual window.
- **Collector truthfulness:** website=WF04; telegram=WF11 fixture-first/approval-gated t.me/s preview (recent
  posts only, not bot channel_post/comments) — `MS_ENABLE_TELEGRAM_COLLECTOR`; vk=WF13 disabled placeholders →
  `setup_required`. `tracked_sources.addSource` sets honest initial status + monitoring fields + chat_id.
- Tests: `test_monitoring.js` (59). Migration: tracked_sources monitoring fields + chat_id, new
  `source_change_events`, §B4 collector config. Deploy order += WF23. `make test` → ALL PASS (28 workflows,
  validator 259, $0, 0 calls).

**Was scheduled monitoring present before this block?** NO — no schedule trigger / WF23 existed (verified).
**n8n CLI:** NOT installed locally → static resolver (`tools/audit_workflows.js`) + documented disposable-import.

**Commit 2 — DONE `35990e5` (DEC-154):** operator-authorized fix of callable triggers.
- **Execute Sub-workflow Triggers added** to WF04/08/10/12/16 (node *When Called by Agent*), each preserving its
  Manual Trigger for standalone diagnosis. Each declares a canonical input contract (`agent_request_id`,
  `source_run_id`, `workflow_run_id`, `data_mode`, + per-workflow filters/budget/force flags). The config node
  merges those inputs over its defaults; manual mode (empty input) is **byte-identical** (all Stage 1-3 suites
  still pass). WF20/21/23 now pass **named** canonical fields via `workflowInputs` (no `.first()` reliance in the
  callable). `audit_workflows.js` now **hard-fails** if a callable lacks the trigger or is publicly exposed.
- **Persistence/delivery wiring proven:** WF18 reconstructs context from Sheets (conversation_state read+upsert,
  messages read+append, summaries); WF20 persists execution_summaries + telegram_outbox before send.
- **`deploy_n8n.sh --activate-triggers`** finished: WF18 always, WF23 only when `MS_MONITORING_ENABLED=true`;
  version detection; explicit confirm; never activates a callable; refuses if n8n CLI absent. `test_release_audit.js`
  → 98 checks. `docs/N8N_COMPAT_AND_TOPOLOGY.md` updated (gap RESOLVED + classification + contracts).

**Commit 3 — DONE (this session):** `test_release_e2e.js` (62) — full 20-step multi-turn monitoring E2E
(search→clarify→approve→collect→quality→report→proactive→deep facts/recs→add source→idempotent dup→scheduled
no-change→meaningful change→one notification→reuse evidence→compaction→follow-up resolves competitors) + negative
paths (unauth, dup update, invalid plan, unapproved/cancelled/over-budget gate, fail-closed source health,
all-quarantined no-data, Telegram retry/never-resend, dup monitor window, missing tg/vk collector, deleted memory,
ephemeral no-state). `scripts/n8n_import_smoke.sh` = disposable temp-folder import (prints exact command when n8n
absent). `make test` → ALL PASS (34 suites, validator 259, $0, 0 calls, all `active=false`). **Not pushed.**

---

## Session: 2026-06-21 (session 21) — Conversational agent: NL intent + bounded memory + deep analysis (DEC-151/152)

**Status (exact):** transforming the button-driven Stage 4 bot into a real conversational agent. Branch
`stage-3-closure-and-stage-4`. **0 external calls, $0**, all workflows `active=false`, **not pushed**, no n8n
import, no AI attribution. Three planned commits: (1) `feat(agent): add conversational intent routing and
bounded memory`; (2) `feat(agent): add context-aware deep competitor analysis`; (3) `test(agent): add
multi-turn memory and deep-analysis e2e`.

**Commit 1 (conversational intent + memory) — BUILT:**
- 5 libs in `n8n/lib/`: `agent_charter` (immutable versioned charter + deterministic capability registry;
  availability from allowlist; Claude can't invent IDs), `intent_router` (deterministic-first; guarded Claude
  classifier with strict `validateIntentJSON`; clarification fallback; `intent:<id>` button == typed intent;
  no external work from unvalidated intent), `conversation_memory` (L1 state, L2 window=8, L3 versioned rolling
  summary preserving IDs/decisions verbatim, L4 per-user durable memory + forget/forget_all audit with value
  HASH not raw, L5 artifacts, token-budgeted `buildContext` never drops charter/state/safety/newest),
  `conversation_response` (useful text w/o buttons + post-report NL invitation; optional buttons only),
  `tracked_sources` (add/list/pause/resume/remove/check; idempotent; honest platform availability).
- Generator extended: WF18 now conversational (13 nodes: Route Intent, Build Conversation Context, Build
  Conversational Reply) + new **WF22 Conversation Control & Sources** (9 nodes). Both `active=false`.
- Tests: `test_agent_contracts.js` (109) + `test_agent_workflows.js` (30 drift+harness). Registered.
- Migration extended (§B2: conversations/conversation_messages/conversation_state/conversation_summaries/
  durable_memories/memory_audit_events/context_usage/tracked_sources/source_audit_events). Deploy order += WF22.
- `make test` → ALL SUITES PASS (29 suites + validator 247 + lead_scout); $0; 0 calls; 26 workflows active=false.

**Commit 2 (context-aware deep analysis) — BUILT (DEC-152):**
- 2 libs: `deep_analysis` (bounded plan w/ graceful degradation website_only→full; honest unavailable_sources;
  evidence contract; `assembleDeepReport` separates evidence-backed FACTS from RECOMMENDATIONS — orphan recs
  never become facts) + `orchestration_policy` (`reuseDecision` reuse/collect/extend; context-answerable intents
  spend $0; explicit refresh/stale collects; new configured platform extends).
- Generator: new **WF21 Deep Competitor Analysis** (14 nodes) + WF20 gains `Orchestration Reuse Decision` +
  `Needs External Call?` branch (21 nodes). Both `active=false`.
- Tests: `test_deep_analysis_contracts.js` (43) + `test_deep_analysis_workflows.js` (22). Registered.
- Migration §B3: orchestration_decisions / deep_analysis_findings / deep_analysis_recommendations. Deploy += WF21.

**Commit 3 (multi-turn E2E + docs) — BUILT:**
- `test_agent_e2e.js` (30) — full mocked dialogue: search→plan→approve(free text)→report→"сравни первых двух
  подробнее"→deep plan from prior report→approve→deep report (facts vs recommendations)→"добавь их сайты"
  (resolved from context, added once/idempotent)→"что ещё умеешь?" (only configured caps)→window overflow→
  rolling summary preserves rep_1→follow-up still resolves CASHMOTOR,CarCapital→"идеи" reuses report, $0 calls.
  Single external-call counter; 0 external calls.
- `docs/CONVERSATIONAL_AGENT.md` (Mermaid architecture + sequence + intent schema + memory/compaction + control
  commands + deep analysis + source availability + reuse + tests + limitations). README points to it.
- Fix surfaced by E2E: help regex broadened (`умеешь|что ещё`) so "а что ещё ты умеешь?" routes to help; WF18
  regenerated.
- Three commits landed: `215a6c8` (intent+memory), `0f13f9f` (deep analysis), + this docs/e2e commit.
- `make test` → ALL SUITES PASS (32 JS suites + validator 253 + lead_scout); $0; 0 calls; 27 workflows active=false.

**Open:** operator runtime retest (Stage C.1 + the one controlled live E2E). No further code work queued.

---

## Session: 2026-06-21 (session 20) — Stage 4 single-user Telegram agent MVP (branch stage-3-closure-and-stage-4, DEC-150)

**Status (exact):** Phase A (Stage 3 closure) already LANDED as `0d0ab69`
(`fix(stage3): close production analysis aggregation and reporting gates`). Phase B (Stage 4 MVP) BUILT and
about to land as `feat(stage4): add telegram agent orchestration MVP`. **0 external calls, $0**, all
workflows `active=false`, **not pushed**, no n8n import, no AI attribution.

**Phase B (Stage 4) — what's in:**
- **7 contract libraries** (`n8n/lib/`): `agent_config` (one central config, fail-closed defaults, no
  secrets), `agent_state` (14-state durable machine, terminal absorbing, cancel-from-any, `canMakeExternalCall`),
  `request_planner` (deterministic plan + guarded Claude planner + strict JSON validation + budget clamps),
  `approval_gate` (single paid-call chokepoint; `GATE_TERMINAL` renamed to avoid `const` clash with
  `agent_state.TERMINAL` when co-embedded; deterministic `idempotencyKey`), `source_adapter` (canonical
  result + `rollupCollection` complete/partial/no_data; cost never fabricated to 0), `telegram_io`
  (parse/auth/duplicate-`update_id`/MarkdownV2 escape/3900-chunk/outbox payload-hash dedup),
  `execution_summary` (one flat canonical summary + single next action).
- **`tools/gen_stage4_workflows.js`** deterministically generates **WF17** (config, 2 nodes), **WF18**
  (Telegram gateway, 9), **WF19** (planner, 9), **WF20** (orchestrator, 16) with libs embedded byte-identically
  between drift markers. Re-running is idempotent.
- **Tests:** `test_stage4_contracts.js` (72) direct lib units + `test_stage4_workflows.js` (33) drift proof +
  offline harness node execution. Registered in `run_all.js` + `Makefile`.
- `make test` → **ALL SUITES PASS** (24 JS suites + validator 241 + lead_scout); 0 external calls; $0;
  25 workflow JSON all `active=false`.

**Phase C (testing/deploy/docs) — LANDED as `test(stage4): add replay e2e deployment and portfolio docs`:**
- `n8n/fixtures/stage4/replay_fixtures.json` (sanitized: Apify SERP discovery / Avito search cards /
  CASHMOTOR healthy Firecrawl / CarCapital degraded / source_health / WF08 / WF10 / WF12).
- `tests/test_stage4_e2e.js` (62 checks) — mocked replay driving all 7 libs through the full lifecycle:
  16 scenarios (duplicate-update, unauthorized, unapproved, cancelled/terminal-blocked, gate pass, off-allowlist,
  budget/call/item overflow, deterministic idempotency, no-double-spend, healthy-proceeds, degraded-blocked,
  partial state, all-quarantined no_data, invalid-planner-JSON 0 calls, summary-OFF 0 LLM, delivery-retry dedupe)
  + full happy path Telegram→…→completed + illegal-transition rejection. Single external-call counter proves 0
  calls on every negative path. Registered in run_all.js + Makefile.
- `scripts/deploy_n8n.sh` — DRY-RUN default (validate JSON + config check + print plan, offline, no n8n);
  `--apply` imports WF17→WF18→WF19→WF20 inactive, never touches credentials.
- `docs/SHEETS_MIGRATION_STAGE_4.md` — 7 new tabs (exact headers: agent_requests/agent_request_events/
  execution_plans/approval_decisions/telegram_outbox/execution_summaries/dead_letter_events) + existing-tab
  append-only deps + verification checklist.
- `docs/STAGE_4_AGENT.md` (Mermaid architecture + Telegram sequence + state machine + setup + controlled live
  E2E + known limitations) + README updated to Stage 4.
- **Fix surfaced by E2E:** `execution_summary.js` next-action ordering — `no_data` now precedes the generic
  `partial` message (all-quarantined ⇒ "broaden sources", not "review partial report"); WF20 embed regenerated.
- `make test` → **ALL SUITES PASS** (25 JS suites + validator 241 + lead_scout); 0 external calls; $0;
  25 workflow JSON `active=false`. **Not pushed**, no n8n import, no AI attribution.

**Open:** operator runtime retest (Stage C.1 + Stage 4 controlled live E2E). No further code work queued.

---

## Session: 2026-06-20 (session 19) — Stage 3 closure + Stage 4 (branch stage-3-closure-and-stage-4, DEC-147)

**Status (exact):** new authoritative two-phase spec (Phase A = close Stage 3 runtime contracts; Phase B =
Stage 4 orchestration). Branch `stage-3-closure-and-stage-4` from `origin/main` (4ba4e52, already contains
Patch 5). **0 external calls, $0**, all workflows `active=false`, **not pushed**, no AI attribution. Three-commit
plan: (1) `fix(stage3): unify runtime contracts and quality gates`; (2) `feat(stage4): add production
orchestration and telegram gateway`; (3) `test(stage4): add end-to-end contracts and deployment docs`.

**Commit 1 LANDED (canonical lineage + WF16 boolean fidelity):**
- New `n8n/lib/lineage.js` — canonical identity contract (`source_run_id` join key vs `workflow_run_id`),
  `canonicalSourceRunId`, `coerceSheetBool`.
- **WF04 mismatch FIXED** (the live `no_compatible_baseline` blocker): `live_source_runs` no longer rewrites
  `firecrawl_*`→`wf04_*`; emits `source_run_id=run_id=firecrawl_<stamp>` + `workflow_run_id=wf04_<stamp>` +
  `data_mode`; snapshots carry the same canonical `source_run_id`. Ledger honesty: `approval_token_used=not_required`,
  separated `primary_calls`/`repair_calls`, cost `unknown`/`null` (never 0).
- **WF16 §2.3 boolean fidelity:** `Assemble` `cbool()` (mirrors lib) — Sheets string `'FALSE'` now scored invalid.
- `tests/test_lineage_contract.js` (34 checks). `make test` → ALL SUITES PASS (20 JS suites + validator + lead_scout).

**Commit 2 LANDED — `fix(stage3): connect website source quality and analysis pipeline` (DEC-148):**
- **WF04 = website source adapter:** new `Build Canonical Raw Record` emits one canonical `raw_market_records`
  row per scraped URL (full lineage + `source_record_id` + `analysis_status=pending`); WF04 extraction kept as
  source hints; snapshots/transport preserved. + `Append raw_market_records` node.
- **WF08 = single semantic owner:** `Filter & Select Records` + `source_run_id_filter` + record-level quality gate
  (degraded/quarantined/pending blocked, per-record) + exactly-once via new `analysis_runs` ledger
  (`Read analysis_runs` + `Build/Append analysis_runs Row`; key=`source_run_id::source_record_id`; `force_reprocess`).
- WF16 scores WF04 rows by `source_run_id`. `tests/test_website_pipeline.js` (36 checks) on
  `firecrawl_20260620_104531` (CASHMOTOR healthy→WF08 once; CarCapital degraded blocked; lineage identical).
  `make test` → ALL SUITES PASS (21 JS suites). Sheets: `raw_market_records` WF04 cols + `analysis_runs` tab (§24/§25).

**Commit 3 IN PROGRESS — `fix(stage3): close production analysis aggregation and reporting gates` (DEC-149):**
- **WF10/WF12 fail-closed verification:** `rowEligible` no longer lets a live row self-attest past a missing
  `source_health` join when `require_source_health=true` (production default in both WF10 + WF12); explicit
  `allow_unverified_source=true` is the only dev bypass. Embedded mirrors stay byte-identical to
  `n8n/lib/report_gate.js` (drift-proof).
- **Guarded LLM (not disabled nodes):** WF08 `Prepare Record` guard (enabled+token+quality+not-cancelled+
  not-analyzed+budget); WF12 `Claude Summary Approval Gate`/`Build Claude Summary Prompt` (enable flag+token+
  eligible facts+budget+idempotency); OFF⇒0 calls; invalid⇒1 repair⇒deterministic fallback; unknown cost=null.
- **WF12 isolation parity:** report scoped by run stamp + (additive) `agent_request_id`; `report_data_mode=live`
  excludes fixture/manual snapshots; lineage-carrying snapshots held to the same `__bodyEligible` gate as profiles.
- **WF05** executable pre-Apify approval/budget gate (token never logged); `items_relevant`=direct competitors;
  truthful `approval_token_used`. **WF06** regex root detection (no `new URL(`, sandbox-safe). **WF09** search
  cards `items_relevant=0` + `Detail enrichment required; do not run WF08` (enrichment = documented limitation).
- `tests/test_stage3_gates.js` (47 checks) + updated `test_lineage_e2e.js`/`test_report_gate.js`.
  `make test` → ALL SUITES PASS (22 JS suites + validator + lead_scout); $0; 0 external calls; active=false.

**Open:** ALL of Stage 4 (Phase B — Telegram gateway, planner, state machine, approval/budget gate,
source-adapter contract, idempotency/outbox, dead-letter) + Phase C (replay fixtures, mocked E2E, deploy script,
consolidated migration, portfolio docs). Continuing autonomously per the single-user MVP directive.

## Session: 2026-06-20 (session 18) — Stage C Runtime Patch 5 (DEC-146): WF09 Apify actor-input regression

**Status (exact):** narrow WF09 fix from the first live retest — two runs stalled after `Build
raw_market_records Rows`, which got one empty/malformed item. **0 external calls, $0**, all workflows
`active=false`. Local commit only — **not pushed**. `make test` → ALL SUITES PASS (19 JS suites + validator +
lead_scout); new `wf09-actor-input` = 48 checks; `intake-gates` back to 55.

**Root cause:** Patch 4 sent `actor_start_urls` (`{url,userData}` objects) to the actor
`fatihtahta/avito-russia-scraper`, which expects `startUrls` (array of **URL strings**) + `limit` (int) → it
returned one empty item → zero raw rows → stalled run.

**Fix (WF09 only):**
- Apify request body now sends `startUrls = cfg.start_urls` (string URLs) + `limit = cfg.actor_limit`.
  `actor_start_urls` kept in `Set Config` for internal mapping/tests only — never the live input.
- Normalize per-record query origin: explicit actor query metadata → `parentSourceUrl` matched against
  `cfg.query_plan` → `unknown`. `source_search_url` from `parentSourceUrl` (else matched query_plan URL).
  Removed the old `start_urls[0]`/`firstStart` fallback; never the concatenated query list.
- Malformed/empty actor items stay `invalid` → zero raw/registry rows + explicit error/skip summary (proven).

**Files:** `n8n/workflows/09…json` (Set Config comment, Apify request, Normalize); `tests/test_wf09_actor_input.js`
(new), `tests/run_all.js`, `Makefile`; docs (migration §22–§23, DEC-146, this entry). **WF16 + quality_gate.js
unchanged.**

**Next:** operator live retest on n8n (real Apify call now returns listings; verify `parentSourceUrl` echo →
query mapping, and that an empty actor response yields zero rows + error summary, not a stall). No Claude before
Phase D.

## Session: 2026-06-20 (session 17) — Stage C Runtime Patch 4 (DEC-145): first real WF09→WF16 live run

**Status (exact):** narrow runtime patch from the first live execution (`avito_20260620_055017`: 10 items, all
non-detail Avito search cards, 9 unique + 1 dup). **0 external calls, $0**, all workflows `active=false`. Local
commit only — **not pushed**. `make test` → ALL SUITES PASS (18 JS suites + validator + lead_scout); new
`wf16-runtime-searchcards` = 77 checks.

**Root causes fixed (the live run looked healthy when it was not):**
- **WF09 `live_source_runs.run_id` = `agent_request_id`** broke WF16's join → blank workflow/platform/family.
  Now `run_id=cfg.run_id` (+ `source_run_id`, preserved `agent_request_id`); WF16 join has an `agent_request_id`
  legacy fallback. `approval_token_used` from the live gate (value never stored); cost `unknown`/`null` (never 0).
- **Raw rows lacked the search-card contract** (`is_detail`/`detail_fetch_required`/`placeholder_title`/
  `exact_evidence_url`(now boolean)/`activity_subtype`/`skip_reason`/`detail_fetch_status=pending`/populated
  `quality_flags`/`llm_eligible`/`search_query`/`source_search_url`). WF16 now detects search cards from explicit
  + legacy fields, recognizes `duplicate_in_registry`/`_in_batch`, and **quarantines** a `report_candidate=0`
  search-card-only run via a critical `search_cards_only` flag; all-`pending` runs are never report/LLM eligible;
  non-detail cards don't inflate `exact_evidence_url_rate`. Mirrored in `n8n/lib/quality_gate.js` + WF16 node
  (drift-proven).
- **WF09 summary** now separates search cards from confirmed offers (the company-registration card is preserved
  for review, never an offer). **Query origin** = specific per-record query (start-URL `userData` propagated) or
  `unknown`, never the concatenated list.

**Files:** `n8n/lib/quality_gate.js`; `n8n/workflows/09…json` (Set Config, Apify request, Normalize, Build raw,
Build live_source_runs, Final Summary); `n8n/workflows/16…json` (Assemble Run Bundles, Build Source Health);
`tests/test_wf16_runtime_searchcards.js` (new), `tests/test_wf09_searchcard.js` (detail_fetch_status→pending),
`tests/run_all.js`, `Makefile`; docs (migration §19–§21, DEC-145, this entry).

**Next:** operator runtime retest on live n8n (real Apify call + Sheets header mapping per migration §19–§21);
no WF10/WF12 change. No Claude before Phase D.

## Session: 2026-06-20 (session 16) — Stage C Closure Patch 3 (DEC-144): make the gate real

**Status (exact):** narrow correctness patch closing the Patch-2 audit's blocking findings. **0 external
calls, $0**, all workflows `active=false`. Local commit only — **not pushed**. `make test` → ALL SUITES PASS
(19 JS suites + validator + lead_scout).

**Root causes fixed (audit B1/B2/C1/C2/D1/D5/S3-D21):**
- **Lineage was never produced upstream** → WF10/WF12 gate was a no-op. Now connectors (WF09/WF07/WF13) write
  `source_run_id`+`data_mode`+`quality_status`+`report_eligible`+`review_status`+`quality_flags` to
  `raw_market_records`; **WF08 propagates the identical lineage** onto monitor/content/review queues on BOTH
  deterministic + LLM paths (join key via `source_run_id‖run_id‖agent_request_id`, matching WF16).
- **`report_gate.rowEligible` rewritten**: merges record-local lineage + matched source_health (stricter
  wins), **production fail-closed**; fail-open only via explicit `allow_unverified_source` (default false on
  WF10/WF12). WF10 stamps lineage on outputs; WF12 filters its BODY by it (`__bodyEligible`,
  `body_records_excluded`) so body ↔ source-quality section never contradict.
- **WF04 counters wired into real execution** (Normalize+Route + snapshot writer single points; dead
  `__rr`/`__acct` removed; per-run reset; cost unknown=null).
- **S3-D21** proven by real WF09 node execution.

**New tests (run the real nodes):** `test_lineage_e2e.js` (33; WF09→WF08→WF10→WF12 negative+matrix),
`test_wf04_accounting.js` (28; real parse/route/snapshot → Final Summary counters),
`test_wf09_searchcard.js` (20; search-card quarantine), report_gate +12 (merge/verification + embed-parity).

**See:** `docs/SOURCE_LINEAGE_CONTRACT.md`, `docs/SHEETS_MIGRATION_STAGE_C_HARDENING.md` §14–§18, DEC-144.
**Next:** operator applies §14–§18 columns → re-run connectors → WF08 → WF16 → WF10 → WF12 (runtime retest).

---

## Session: 2026-06-19 (session 15) — Stage C Closure Patch 2 (DEC-143)

**Status (exact):** finishes the Stage C work DEC-142 left partial/merged-only/not-wired. **0 external calls,
$0**, all workflows `active=false`, no real keys/IDs, no contacts surfaced, `outreach=false` preserved. BUILT +
offline-validated; **operator runtime retest required** (see `docs/STAGE_C_CLOSURE_PATCH_2.md`). Local commit
only — **not pushed**.

**Headline:** WF16/`source_health` is now **physically enforced** in WF10 and WF12 via a shared, drift-proof
`n8n/lib/report_gate.js` (embedded mirror in both nodes; tests assert node==lib). Each adds a `Read
source_health` node + config switches. Excluded by default: fixture/manual_test/quarantined/pending/
semantic-failed/stale/degraded; degraded only via `allow_degraded_report` (warning), fixture only via
`allow_fixture_report` (watermark). WF10 also: strict run isolation + observed-vs-inferred split +
pending/uncertain record exclusion. WF12 also: no dangling `(x34 =)`, compatible baseline /
`no_compatible_baseline`, contact counters (`report_contains_contacts=false`), corrected VK wording,
`changed_domains=0` neutral action, degraded website-snapshot exclusion.

**Source-workflow fixes (each with a test running the real node):** WF04 (Final Summary + repair/fallback
accounting, MKBK brand fallback, no raw Markdown in offer, evidence confidence/page_type/services, phone
normalization, cost telemetry), WF05 (regulator/publisher/direct/indirect/source split — cbr.ru not a
competitor; root URL canonicalization; scope/service; cost), WF06 (`approval_status=processed` in the real
payload), WF07 (actual-vs-estimated cost, irrelevant≠hard_skipped, `data_mode=manual_test`), WF09 (declared
multi-query drives start URLs + dedup + origin), WF14 (`zero_write_reason` never empty).

**Tests/CI:** extended offline harness (no coverage removed); new suites `report-gate, wf04/05/06/07/09/10/12,
ci-workflow`; `.github/workflows/regression.yml` runs `make test` on PR + push:main (Node 20 / Python 3.12, no
secrets). `make test` → **ALL SUITES PASS (external calls=0, live cost=$0)**.

**Next:** operator applies Sheets migration (`docs/SHEETS_MIGRATION_STAGE_C_HARDENING.md` Closure Patch 2 §7–13)
→ import workflows (`active=false`) → run retest order → then Stage C / MVP close. No Claude before Phase D.

---

## Session: 2026-06-19 (session 14) — Stage C Hardening: taxonomy + semantic engine + WF16 + WF08 llm_primary (DEC-142)

**Status (exact):** systemic production-hardening patch over the 64-item acceptance defect register. **No
external calls** (no Claude/Apify/Firecrawl/VK/Telegram), no real keys/Spreadsheet IDs, all workflows
`active=false`. **$0.** BUILT + offline-validated; **operator runtime retest required** before Stage C close.

**New systemic core (all tested, $0):**
- **`config/taxonomy.json`** (`semantic-v2.0`) — ONE canonical taxonomy: record/entity/activity/service enums +
  alias compat (`secured_auto_loan→pts_loan`, `return_lease_refinancing→auto_lease_refinance`,
  `question_objection→audience_question`, `credit_broker→credit_brokerage`) + route map + confidence caps + flags.
- **`n8n/lib/semantic_core.js`** — Stage A pre-gate (system-event/placeholder/search-card/evidence completeness),
  owned-media/affiliate/direct-offer/negation detectors, explainable confidence + caps, Stage D validator, route
  mapper, `classifyOffline()` (free offline/fixture classifier = LLM fallback). Cyrillic-`\w` regex bug fixed.
- **`n8n/lib/quality_gate.js` + WF16** (`16_source_quality_gate_health_score.json`) — run/source health →
  `source_health` tab; quality_score/status/report_eligible/llm_eligible/flags; gates WF10/WF12. **Real, importable,
  NOT doc-only**; embedded scoring proven byte-equal to the lib.

**Workflows patched (real node code, harness-tested):**
- **WF08:** `analysis_mode=llm_primary` (Claude PRIMARY, POST_EVIDENCE overrides hints; semantic-v2 prompt with
  POST_EVIDENCE/SOURCE_METADATA/UPSTREAM_HINTS separation, canonical enums, evidence caps); system-event hard-skip
  pre-gate; `llm_enabled=false` safe default (guard intact).
- **WF09:** `LIVE Apify Safety Gate` (fixture=false ∧ live=true ∧ token match ∧ max_items ∧ budget; token value
  NEVER logged/propagated); placeholder/search-card → source_candidate + detail_fetch_required + report/llm
  ineligible (no fabricated `Оффер: Ещё4 фото`); search_query vs source_search_url separation; data_mode.
- **WF11:** system-event gate (service NOT from new title) + affiliate subtype + direct-offer override + negation/
  quotation + per-post freshness + data_mode/eligibility.

**Harness:** `make test` / `node tests/run_all.js` → **654 checks PASS, 0 external calls, $0**
(taxonomy 96 · semantic-contract 86 · quality-gate 31 · wf16-node 37 · intake-gates 55 · validate_workflows.py
217 · lead_scout 132/132). 12 semantic evidence fixtures + 3 quality fixtures. `scripts/validate_workflows.py`
(JSON validity + secret-leak scan).

**Docs:** new SEMANTIC_TAXONOMY, SOURCE_QUALITY_GATE, STAGE_C_HARDENING_IMPLEMENTATION, _TEST_RESULTS,
SHEETS_MIGRATION_STAGE_C_HARDENING; README + DECISIONS (DEC-142) updated.

**Next:** operator runtime retest — (1) import WF08/09/11/16 + add `source_health` tab/columns; (2) `make test`;
(3) WF16 fixture self-test; (4) controlled WF08 Claude batch (own approval); (5) one live Telegram channel;
(6) one approved Avito live smoke; (7) WF10/WF12 must consult `source_health.report_eligible`. Then Stage C close.

---

## Session: 2026-06-19 (session 13) — Stage C.1 consolidated patch (DEC-141)

**Status (exact):** corrective patch from REAL operator n8n runtime evidence. **No Stage 4/Claude, no external calls**
(no VK/Telegram/Firecrawl/Apify/Claude/OpenAI), no activation, no real keys/Spreadsheet IDs/VK groups, no
auto-outreach, no member/private extraction. All workflows `active=false`. **$0.** **Stage C.1 NOT passed — operator
runtime retest required** (`docs/STAGE_C_1_TEST_RESULTS.md` §3).

**Defects fixed (code, harness-validated):**
- **WF14:** (B) `service_type` deterministic-first → PTS = **`pts_loan`** (was `unknown`; the WF13 `"unknown"` hint no
  longer shadows `svcType()`). (E) `diagnoseZeroWrite()` (8 reasons) + `below_threshold_skipped` → repeat run says
  "all 5 already exist, dedup succeeded, collect new data" (NOT "lower min_lead_score"). (G) `include_review_queue` +
  `source_agent_request_id` for clean acceptance isolation (defaults unchanged).
- **WF13:** (C) evidence-based `probableNeed()` — business/PTS/bad-credit no longer get a false "после отказов" hint;
  `service_hint` for PTS = `pts_loan`. (D) handoff strings → **WF14** canonical (WF08 optional Stage 3). (F) audience
  aggregates = consumer authors only → **`audience_author_count=5`** (was `active_author_count=7`).
- **WF12:** (A) deterministic `redact()` before truncation + final pass over every field → no phone/@handle/profile/
  email/t.me ever printed; amounts/%/post-URLs kept; contact counts correct. (H) sticky schema counts 20→25, 28→47.

**New scope (operator-approved):** WF13 **monitored VK groups** engine (group→posts→relevant posts→public comments;
post+comment relevance, bounded selection, dedup, counters) + deterministic `monitored_fixture_mode` simulation (20
§6.4 cases). Live two-stage transport = STAGED/DISABLED, `BLOCKED_BY_OPERATOR` (`docs/VK_MONITORED_SOURCE_RUNBOOK.md`).

**New harness (real Code-node logic under n8n shims):** `node n8n/fixtures/lead_scout/run_all.js` → **132/132 PASS
($0)**. Pinned counters unchanged (A 7/3-2-2; B 5/2-2-1; repeat 0/dup 5). Files: `_harness.js`, `run_wf14_triage.test.js`,
`run_wf13_monitored.test.js`, `run_wf12_redaction.test.js`, `run_all.js`.

**Docs:** new `STAGE_C_1_TEST_RESULTS.md` (results + retest runbook + expected deltas) + `VK_MONITORED_SOURCE_RUNBOOK.md`;
updated WF12/13/14 RU, fixtures README, STAGE_C pack, report schema (20→25), CONTACT policy, DECISIONS (DEC-141), warm.

**Next:** operator runtime retest (import WF12/13/14, clear only raw_market_records/market_record_registry/
public_lead_signals/market_intelligence_reports, run WF13→WF14→WF14 repeat→WF12, verify pts_loan + dedup diagnosis +
redaction). Then Stage C C1 (paid Stage 2) / C4 (live VK) = operator-gated; monitored VK live = blocked. Stage 4 NOT started.

---

## Session: 2026-06-17 (session 12) — Stage 3.5 audit alignment + live-readiness hardening (DEC-140)

**Status (exact):** post-audit hardening patch before Stage C. **No new features, no Stage 4/Claude, no external
calls** (no VK/Telegram/Firecrawl/Apify/Claude/OpenAI), no activation, no real keys/Spreadsheet IDs, no
auto-outreach, no member/private extraction. External audit found **no P0 blockers**; this patch closes its 4
pre-Stage-C items. All workflows `active=false`.

**Code fixes (WF14 only — verified safe via local harness):**
- **`review_priority` → 4-value enum.** `priorityOf` now faithfully mirrors `score_band` over {high, medium, low,
  **ignore**} (was collapsing ignore→low). Default `min_lead_score=25` still filters ignore-band before write, so
  emitted set stays {high,medium,low} unless lowered. No behaviour change on fixtures.
- **`splitCmt()` comment-URL contract fix.** WF13 (fixture+live) folds the comment anchor into `post_url`
  (`…_201#reply2011`) and can't add a `comment_url` column (raw_market_records is fixed 40-col). WF14 now derives
  `source_comment_url` from a reply-anchored `post_url` and cleans `source_post_url` to the base post → **fixture
  and live rows share dedup keys + `lead_signal_id`**, and `source_comment_url` is populated. Harness: WF13-path
  `signals_written=5` (H/M/L 2/2/1) with **byte-identical lead_signal_ids** to baseline; repeat run 0/dup 5.

**Canonical decisions (docs):**
- **Timestamps:** `created_at` (write/append) / `updated_at` / `extracted_at`; **no `append_timestamp`/
  `timestamp_appended` column exists** under either name (phantom). Documented in TABLE_SCHEMA §G + validation plan.
- **Pinned Stage C fixture outcomes (harness-derived, not invented):** standalone 10-scenario → **7 written**, H/M/L
  **3/2/2**, contacts_found=2, **contacts_blank=1 (F10)**, dup=1 (F8), irrelevant=1 (F7), F6 competitor excluded;
  WF13 9-item fixture → **5 written**, H/M/L **2/2/1**, repeat 0/dup 5; `outreach_allowed=FALSE` everywhere.
- **VK live readiness = `IMPLEMENTED_READY_FOR_STAGE_C`** (token gate + allowlist-only wall.get/wall.getComments
  v5.199 + disabled HTTP placeholder-token node + inert throwing parser + caps + ledger). Only runtime API =
  `BLOCKED_BY_OPERATOR_CREDENTIALS_OR_LIVE_RUN`. Exact operator setup in LEAD_SCOUT_LAYER_PLAN §12.
- **WF12 unchanged** — already audit-compliant (anonymized lead block, schema-tolerant, no raw contacts, no Claude).

**Docs edited (md):** TABLE_SCHEMA §G, GOOGLE_SHEETS_VALIDATION_PLAN (list 28 + §3.6 explicit enums),
PUBLIC_LEAD_SIGNAL_LAYER, LEAD_SCOUT_LAYER_PLAN (§3a/§12), STAGE_C_ACCEPTANCE_PACK (C3/C5), fixtures README,
DECISIONS (DEC-140), warm decisions, NEXT_ACTIONS, AGENT_LOG.

**Next:** **Stage C acceptance** unchanged — C3/C5/C6/C7 fixture-runnable now ($0); C1 (Stage 2 paid) + C4 (live VK)
= `BLOCKED_BY_OPERATOR_CREDENTIALS_OR_LIVE_RUN`. Then Phase D / Stage 4 Claude (own approval). Stage 4 NOT started.

---

## Session: 2026-06-17 (session 11) — Stage 3.5 Lead Scout Foundation BUILT (DEC-139)

**Status (exact):** real build patch (Phase B of the LOCKED A/B/C/D model). Deterministic, **all `active=false`,
$0, NO external calls** (no VK/Telegram/Apify/Firecrawl/Claude), no activation, no real keys/Spreadsheet IDs, no
auto-outreach, no member/private extraction. Fixture/harness-validated only.

**Architecture (DEC-139):** Option A refined — **no new WF16**. WF13 = VK public lead source, WF14 = central Lead
Scout engine, WF12 = lead report block; competitor branch (WF08/WF10) untouched (no pollution).

**Built (code, fixture-validated):**
- **WF14 v0.3 Lead Scout Triage & Scoring engine:** reads `raw_market_records` audience rows (PRIMARY, decoupled
  from WF08) + `review_queue`; deterministic 0–100 scoring (intent25+urgency15+pain20+niche15+contact8+region7+
  freshness10 − penalties) → `lead_score`/`score_band`/`review_priority`/`recommended_action`/`score_reasons`;
  public-contact extraction (verbatim only, `contact_source_url` mandatory, blank+`do_not_use` if unprovable);
  multi-key dedup; supplier/competitor-ad exclusion; writes `public_lead_signals` v0.3 (47 cols) + `agent_requests`;
  self-test (read_once/cap/dedup/policy). **61/61 fixture checks; repeat-run dedup PASS.**
- **WF13 v0.3 VK public lead source:** consumer-demand detection → audience lead rows; gated live `wall.get` +
  `wall.getComments` (inert; runtime = PENDING_STAGE_C); lead-rich synthetic fixtures (+7 000 phones).
  **Routing harness: 6 audience rows incl dedup + competitor separate + 1 hard-skip PASS.**
- **WF12 lead block:** priority H/M/L + public-contact-evidence counts + top-N **anonymized** summaries (no
  contacts in report). **12/12 incl. no-leak checks.**
- **WF15:** source_family += public_lead_source/lead_triage.
- **Schema/docs:** `public_lead_signals` v0.3 (47 cols, TABLE_SCHEMA §G + migration); validation lists 27–33 +
  §3.6; LEAD_SCOUT_LAYER_PLAN BUILT; PUBLIC_LEAD_SIGNAL_LAYER v0.3; **new STAGE_C_ACCEPTANCE_PACK** (max 7 checks);
  COSTS note; fixtures `n8n/fixtures/lead_scout/`.

**Policy:** public evidence only; contact = evidence not permission; `outreach_allowed=false` always;
recommended_action ∈ {manual_review, content_idea, monitor, ignore}; no hidden/inferred contacts, no member
extraction, no private groups, no MTProto.

**Next:** **Stage C acceptance** (`STAGE_C_ACCEPTANCE_PACK.md`) — C3/C5/C6/C7 fixture-runnable now ($0); C1 Stage 2
paid snapshot + C4 live VK run = `BLOCKED_BY_OPERATOR_CREDENTIALS_OR_LIVE_RUN`. Then **Phase D / Stage 4 Claude** (own approval). Stage 4 NOT started.

---

## Session: 2026-06-17 (session 10) — Stage A Cleanup Lock: A/B/C/D stage model LOCKED (DEC-138)

**Status (exact):** documentation/stage-model cleanup-lock patch only. **No build, no Stage 3.5 build, no Stage 4,
no code/workflow edits, no external calls** (no Firecrawl/Apify/VK/Telegram/Claude), no activation, no real
keys/Spreadsheet IDs, no deletions.

**What was locked (DEC-138):**
- **Stage model A/B/C/D:** A = Cleanup Lock · B = **Stage 3.5 Lead Scout Foundation + paid/live readiness (NEXT
  ACTIVE BUILD)** · C = Acceptance Pack · D = Stage 4 Claude Intelligence Layer.
- **Locked status:** Stage 1 CLOSED · Stage 2 CODE-COMPLETE / READY FOR CONTROLLED PAID-LIVE ACCEPTANCE ·
  Stage 3 MVP CLOSED/PASS · **Stage 3.5 NEXT ACTIVE BUILD** · Stage 4 after Stage 3.5 + Acceptance Pack ·
  Stage 5 after the Stage 4 contract.
- Stage 2 paid/live acceptance **postponed to Stage C**; Stage 4 starts **only after** Stage 3.5 + Acceptance Pack;
  testing happens **after full builds**, not micro-tests per node.

**Docs edited (Markdown only):** ROADMAP (LOCKED block + session-7/8 historical), NEXT_ACTIONS (Stage 3.5 priority),
LEAD_SCOUT_LAYER_PLAN (reframed Stage 3.5 NEXT ACTIVE BUILD + source priority/fields/status/testing),
STAGE_3 doc (v0.4.2 closure-PENDING marked historical/superseded; current = MVP CLOSED/PASS), STAGE_4 doc
(Stage 4 = Claude Intelligence Layer, does NOT start now; Stage 3.5 + Acceptance Pack first; 4.1/4.2/4.3 kept),
PRE_STAGE_4_EXTERNAL_AUDIT_BRIEF (audit v2 response appended), AGENT_LOG (session 10 + session-7 historical),
DECISIONS + warm decisions (DEC-138).

**Next:** start **Stage 3.5 Lead Scout Foundation** (its own approval per step); Stage 2 paid/live acceptance and
Stage 4 wait for Stage C / Stage D respectively.
