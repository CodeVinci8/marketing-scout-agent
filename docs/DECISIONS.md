# DECISIONS.md — Decision Register

Non-obvious architectural and design choices with reasoning.
Most recent first.

---

## DEC-076 — Stage 3 Starts With Lead Source Evaluation, Not the Telegram Bot

**Date:** 2026-06-07
**Context:** With Stage 2 approved, the temptation is to jump to a visible feature (the Telegram Control Bot). But the bot is a *controller*; without evaluated, compliant lead sources behind it, it would have nothing to drive.
**Decision:** **Stage 3.0 = Lead Source Evaluation** is the first Stage 3 step. Compare Avito/Classifieds vs Telegram vs VK on data availability, cost, risk, lead quality, and implementation complexity **before** building any connector. Preliminary (non-binding) recommendation: **Avito/Classifieds first** (public, high-intent, most tractable — pending actor/API + compliance check); **Telegram second** (the Telegram **Parser** is a source connector needing a separate client/MTProto access design, distinct from the Telegram **Control Bot**); VK/Instagram/Yandex later. The Telegram Control Bot stays Stage 4. **Do not build lead connectors or the Telegram bot yet.**
**Reason:** evaluate data/cost/risk before sinking build effort; avoid conflating controller vs parser; sequence value by accessibility and lead quality.
**Files:** `docs/LEAD_DISCOVERY_ARCHITECTURE.md`, `docs/LEAD_SOURCE_CONNECTORS_PLAN.md`, `docs/ROADMAP.md`, `docs/NEXT_ACTIONS.md`.

---

## DEC-075 — Auto-Handoff (06 → 04) Allowed Only If Implemented Safely Without Duplicating Workflow 04

**Date:** 2026-06-07
**Context:** Manual copying of Workflow 06's URL block into Workflow 04 is the one remaining manual step in the chain. Auto-handoff was evaluated this pass (`docs/WORKFLOW_06_AUTO_HANDOFF_PLAN.md`).
**Decision:** Auto-handoff is **permitted only** via a *callable entry path on Workflow 04* (Execute Workflow Trigger feeding the **existing** analyzer chain) driven by an Execute Workflow node in Workflow 06 — **never** by duplicating Workflow 04's Firecrawl+Claude logic into Workflow 06. It must keep manual mode (`Manual Start` + `Set URL List`) intact, default `processing_mode=manual_handoff_to_workflow_04`, `active=false`, `max_per_run=5`, the runtime `url_registry` recheck, and must mark candidates `processed` **only after** Workflow 04 confirms success per candidate (`technical_error` → `error`/`approved+note`, never `processed`). **This pass: DEFERRED** — a safe implementation is non-trivial (no `source_candidate_id` threading through Workflow 04's 25-node, 35-field-locked, branching/looped analyzer; the confirm-then-mark safety property cannot be live-tested in this environment). Scheduled as **Stage 2.4** before the Telegram bot; manual handoff remains the approved Stage 2 path.
**Reason:** stability over removing one manual copy step; the riskiest behavior (confirm-then-mark) must be live-validated, which is impossible here.
**Files:** `docs/WORKFLOW_06_AUTO_HANDOFF_PLAN.md`, `docs/STAGE_2_WEB_PIPELINE_REVIEW.md`.

---

## DEC-074 — Stage 2 Web Pipeline APPROVED With Manual-Handoff Limitation; Stays Modular (Not a Monolith)

**Date:** 2026-06-07
**Context:** Stage 2 (05 → approval → 06 → manual handoff → 04) passed real tests (see `docs/STAGE_2_FINAL_TEST_RESULTS.md`): WF05 discovery PASS, WF06 runtime registry recheck PASS, WF04 PTS override PASS, contact-partial blanking PASS, manual handoff PASS. Runner modes are implemented + simulation-validated (live re-test with fresh same-domain candidates recommended — watch item W1).
**Decision:** **Stage 2 is APPROVED with minor limitations** — human approval required; **manual** 06→04 handoff; candidates marked `processed` manually after WF04 confirmation; Telegram bot / lead connectors / universal `market_profile` not built. The three workflows **remain modular** (discovery / approval-runner / analyzer) and are **not** merged into one monolith: separation preserves the human-approval spend gate, auditability, independent failure/reuse, and incremental change.
**Reason:** the chain is proven and safe as separate, inspectable stages; the remaining manual steps are deliberate safety gates, not defects.
**Files:** `docs/STAGE_2_WEB_PIPELINE_REVIEW.md`, `docs/STAGE_2_FINAL_TEST_RESULTS.md`.

---

## DEC-073 — Workflow 06 Must Always Re-Check `url_registry` at Runtime (Reaffirmed)

**Date:** 2026-06-07
**Context:** Test 4 re-confirmed live: when the operator re-set already-processed URLs to `approval_status=approved`, Workflow 06 returned `selected_count=0`, `skipped_count=18` with `registry_recheck_duplicate` / `already_processed` / `duplicate_status` / `approval_status_not_approved`.
**Decision (reaffirms DEC-065):** Workflow 06 **must always** re-read `url_registry` at runtime and re-normalize each `candidate_url`, and must **never** trust the editable `url_candidates` `dedup_status`/`registry_status` fields. This holds in **both** runner modes (`first_pass_domain_diversity` and `deep_domain_analysis`) — Test 5 confirmed deep mode does not bypass the recheck. This is the primary guard against duplicate Firecrawl/Claude spend.
**Reason:** editable sheet fields are advisory and can be wrong/stale; the registry is the source of truth.
**Files:** `n8n/workflows/06_approved_candidates_runner.json`, `docs/STAGE_2_FINAL_TEST_RESULTS.md`.

---

## DEC-072 — Workflow 06 Default Is Domain-Diverse First Pass; deep_domain_analysis Is Explicit, Not Default

**Date:** 2026-06-07
**Context:** The E2E run selected two URLs from the same domain `autolombard-moskva.ru` in one run. Surveying many pages of one competitor is sometimes useful (deep analysis) but should not happen by default — a first pass should cover **diverse** competitors.
**Decision:** Workflow 06 gains a `runner_mode` (Set Runner Config node), default **`first_pass_domain_diversity`**: at most **1** selected URL per normalized domain per run; extra approved same-domain URLs are skipped with `reason_category=duplicate_domain_in_run` (reason: "Same domain already selected in this run; use deep_domain_analysis mode for multi-page domain analysis."). The explicit **`deep_domain_analysis`** mode allows multiple URLs per domain, **capped at 3/domain/run** (extras → `domain_deep_limit`), and tags each selected item with `warning="deep_domain_analysis mode: multiple URLs from same domain allowed intentionally."` Both modes always keep `max_per_run=5`, `url_registry` runtime recheck, exact normalized-URL dedup, `direct_competitor`→confidence→rank→root priority, manual handoff, no auto-call, no auto-mark-processed. **`url_registry` semantics are unchanged (full normalized URL, never domain-based).** Summary adds `runner_mode`, `domain_diversity`, `domain_selected_counts`.
**Reason:** make breadth the safe default and depth an explicit, bounded opt-in; keep dedup semantics intact.
**Verification:** WF06 JSON VALID; Set Runner Config node present (default first_pass); both modes simulated on the 4 E2E URLs (first_pass → 3 selected + 1 `duplicate_domain_in_run`; deep → 4 selected with deep warning); registry recheck + max 5 + manual handoff preserved; active=false; no tool_use / no KEY=VALUE.
**File:** `n8n/workflows/06_approved_candidates_runner.json`.

---

## DEC-071 — Stage 2 Web Pipeline Stays Modular (05 / 06 / 04); Not Merged Into a Monolith

**Date:** 2026-06-07
**Context:** As Stage 2 nears final approval and the Lead Discovery Layer is designed, there is recurring temptation to collapse discovery + approval + analysis into one workflow.
**Decision:** Keep the three workflows separate — **05 (discovery / URL supplier) → human approval → 06 (approval runner / selection) → manual handoff → 04 (resilient analyzer / URL consumer)**. Do **not** merge them into a monolith. The human-approval spend gate sits between 05 and 06; the manual handoff sits between 06 and 04. Future lead sources add **peer** workflows of the same shape, not a bigger monolith. Recorded in `docs/STAGE_2_WEB_PIPELINE_REVIEW.md` §5.
**Reason:** separation of concerns, auditability, spend safety (the approval gate cannot be accidentally bypassed), independent failure/reuse, and incremental change. A monolith would be unauditable, unsafe to modify, and would not generalize to lead connectors.
**File:** `docs/STAGE_2_WEB_PIPELINE_REVIEW.md`.

---

## DEC-070 — Workflow 04 Keeps Valid Full Contacts and Blanks Partial/Hallucinated Ones; Stronger PTS Override

**Date:** 2026-06-07
**Context:** Final Stage 2 hardening. The E2E run left `service_type=generic_lending` on clear PTS/autolombard pages (`autolombardn1.ru`, `autolombard-moskva.ru/services/…`), and `contact_public` must keep real contacts while never storing a hallucinated partial.
**Decision (patch `Normalize + Route` only — no field-count/architecture/dedup change):**
- **Stronger PTS `service_type` override (B3):** if `entity_type=competitor` and the combined `text_context + offer_text + terms + reason` (+ URL) contains **≥3** distinct strong tokens (`ПТС`, `ЭПТС`, `под ПТС`, `залог ПТС`, `займ под залог ПТС`, `автоломбард`, `залог авто`, `залог автомобиля`, `автомобиль остаётся`, `машина остаётся`, `без проверки КИ`, `любая кредитная история`) ⇒ `service_type=pts_loan`, **unless** a genuine multi-product root (kept `generic_lending`) or clearly real-estate-only (kept `secured_real_estate_loan`). Clear auto-without-PTS can still be `secured_auto_loan`.
- **Contact extraction/sanitation (`bestContact`/`extractContacts`):** deterministically extract reliable public contacts — RU phone (10–11 digits after cleanup; `+7`/`7`/`8`/`8-800`), email, Telegram (`@handle` ≥4 chars or `t.me/`), WhatsApp (`wa.me/`), and contact/profile/application URLs that are **not** just the page `source_url`. Extract from the **model value first** (keeps a valid full contact, drops partials), else from page text; **prefer a deterministic extracted contact over a model partial**. Blank values like `"+7 (495) ..."`, `"номер указан на сайте"`, `"телефон есть на сайте"`, `"требуется извлечение"`, or any ellipsis value with no full reliable contact. Phones inside `wa.me/<digits>`/`t.me/<handle>` URLs are not misread (phone/email/handle scan runs on a URL-stripped copy).
**Reason:** PTS mislabeling undercounts the core product; a contact field must be actionable — keep real contacts, never store a partial/invented one.
**Verification:** WF04 JSON VALID; **exactly 35 business fields** on all 3 emitters + **10** `url_registry` fields unchanged; B3 token set expanded; `extractContacts`/`bestContact(3-arg)` at all 3 emitters; unit-tested — full model contacts kept (no stray phone), `8 800…`/`@handle`/email kept, partials blanked, text fallback works; dedup architecture unchanged; active=false; no tool_use / no KEY=VALUE.
**File:** `n8n/workflows/04_firecrawl_url_list_resilient.json`.

---

## DEC-069 — Lead Discovery Layer: Avito/Classifieds Likely First Source, Pending Stage 3.0 Evaluation

**Date:** 2026-06-07
**Context:** The system's primary business goal is **lead search**, not only competitor monitoring. We need a direction for the next major layer without committing to a connector prematurely.
**Decision:** Design the Lead Discovery Layer now (`docs/LEAD_DISCOVERY_ARCHITECTURE.md`, `docs/LEAD_SOURCE_CONNECTORS_PLAN.md`), but **build nothing** until **Stage 3.0 — Lead Source Evaluation** compares Avito vs Telegram vs VK on data availability, cost, risk, lead quality, and implementation complexity. **Preliminary** (non-binding) recommendation: **Avito/Classifieds first** (public, high-intent, most tractable access — pending actor/API + compliance evaluation), **Telegram second** (needs a separate parser/client design, not just a bot). Manual Records Intake is wired first to validate the lead schema + analyzer with zero source risk.
**Reason:** avoid sinking effort into a connector before its data/cost/risk are known; keep the highest-intent, most-accessible source as the default candidate.
**Files:** `docs/LEAD_DISCOVERY_ARCHITECTURE.md`, `docs/LEAD_SOURCE_CONNECTORS_PLAN.md`.

---

## DEC-068 — Lead Records Use a Separate Schema (`raw_market_records`), Not `url_candidates`; Lead Dedup Is Non-URL

**Date:** 2026-06-07
**Context:** `url_candidates`/`url_registry` model **web URLs**. Leads from classifieds/social/chats have authors, posts, profiles, and sometimes **no stable URL**, and the same intent can be reposted in many places.
**Decision:** Introduce a **separate** record concept for the Lead Discovery Layer: `raw_market_records` (chosen over `lead_candidates` because it also holds competitor posts, content ideas, and market signals), a `lead_discovery_requests` ledger, and a `market_record_registry` that dedups by a **composite `dedup_key`** (`platform + (post_url|message_id)` else `platform + profile + hash(normalized_text)`). The existing **`url_registry` stays URL-only and unchanged**; the two ledgers coexist. All three new sheets are **proposed, not created** (see `TABLE_SCHEMA.md`).
**Reason:** URL equality is insufficient for social/classified dedup (post IDs vs URLs, no-URL records, cross-posting, identity via profile/text). Forcing leads into `url_candidates` would corrupt both models.
**Files:** `docs/TABLE_SCHEMA.md` (Proposed — Lead Discovery Layer), `docs/LEAD_DISCOVERY_ARCHITECTURE.md`.

---

## DEC-067 — Telegram Control Bot Is a Controller, Not a Parser; Pipeline Stays Modular (05 / 06 / 04)

**Date:** 2026-06-07
**Context:** "Telegram" means two different things that must not be conflated, and there is pressure to merge workflows as the system grows.
**Decision:** (1) The **Telegram Bot API** is only ever the **control interface** (commands + summaries; Stage 4) — it is **not** a lead harvester. Historical/public channel/chat collection is a **separate** connector (client/MTProto-style) with its own session/compliance design. (2) The web pipeline **remains modular**: Workflow 05 = discovery, Workflow 06 = approval runner, Workflow 04 = analyzer/consumer. **Do not merge them into one monolith;** the Lead Discovery Layer adds peer workflows rather than collapsing existing ones. Connectors never call Claude; the analyzer never scrapes; human approval is always the spend gate.
**Reason:** conflating bot-vs-parser leads to ToS/compliance and architecture mistakes; a monolith would be unauditable and unsafe to change.
**Files:** `docs/LEAD_DISCOVERY_ARCHITECTURE.md`, `docs/LEAD_SOURCE_CONNECTORS_PLAN.md`.

---

## DEC-066 — Web Pipeline E2E Passed; WF06 Domain Diversity + WF04 Stronger PTS Override & Contact Extraction

**Date:** 2026-06-07
**Context:** A full manual end-to-end test of the web competitor path passed: WF05 (query «автоломбард Москва займ под ПТС без проверки кредитной истории») → 4 approved direct competitors → WF06 selected 4 (read 18, skipped 14, max 5, registry_recheck=enabled) → WF04 processed all 4 → `monitor_queue`, competitors, `parsed_success`. Two issues surfaced: (a) WF06 selected **two URLs from the same domain** `autolombard-moskva.ru` in one run; (b) WF04 left `service_type=generic_lending` on two clearly-PTS pages (`autolombardn1.ru`, `autolombard-moskva.ru/services/…`).
**Decision (patch WF06 + WF04 only — no architecture/dedup change):**
- **WF06 domain diversity (default):** re-derive `domain` from `candidate_url` (same rules as WF05: hostname, lowercase, strip `www.`) and select **at most one URL per domain per run**. A second+ URL from an already-selected domain is skipped with `reason_category=duplicate_domain_in_run`. Priority unchanged + a **root-homepage-first** tiebreaker (root page is preferred for first-pass competitor analysis). A `mode=deep_domain_analysis` is reserved to allow multiple pages/domain but is **not enabled** in v0.1. **`url_registry` semantics unchanged** (still full-normalized-URL dedup); diversity is a per-run selection rule only. `max_per_run=5`, registry recheck, and `manual_handoff_to_workflow_04` all preserved; no auto-call of WF04, no auto-`processed`.
- **WF04 stronger PTS override (B3):** after the existing B2 chain, if `entity_type=competitor` and the URL+evidence contains **≥3** distinct strong tokens (`птс`, `залог птс`, `под птс`, `автоломбард`, `залог авто`, `залог автомобил(я)`, `авто остаётся`, `любая ки`, `без проверки кредитной истории`/`ки`), force `service_type=pts_loan` — **unless** the page is a genuine **multi-product root** (kept `generic_lending`) or **clearly real-estate-only** (kept `secured_real_estate_loan`). Verified by simulation: `autolombardn1.ru`→`pts_loan`, `autolombard-moskva.ru/services/…`→`pts_loan`, `mosinvestfinans.ru/` root→`generic_lending`, lioncredit RE page→`secured_real_estate_loan`.
- **WF04 contact extraction/sanitation:** keep valid full contacts (e.g. `"+7 495 740-01-01, https://t.me/autolombardvip, https://wa.me/79857375386"`, `"8 800 777-95-67; https://lk.cashmotor.ru/"`); blank partial/invented ones (`"+7 (495) … требуется извлечение"`). New `bestContact(model, text)` = sanitized model value if valid, **else** a deterministic `extractContactFromText()` (RU phone 10–11 digits, `t.me/`, `wa.me/`, email) from `text_context` — **prefers a real extracted contact over a model-invented partial**. Applied at all 3 contact emitters. **35 business + 10 registry field counts unchanged; dedup architecture unchanged.**
**Reason:** one run should survey diverse competitors, not many pages of one; PTS mislabeling undercounts the core product; partial contacts are non-actionable but real contacts are valuable.
**Verification:** both `python3 -m json.tool` VALID; WF06 reads `url_registry`, rechecks registry, enforces 1 URL/domain/run (`usedDomains` + `duplicate_domain_in_run`), `MAX=5`, manual handoff; WF04 has `ptsStrongHits`/B3 + `bestContact`/`extractContactFromText` (×3 emitters); both active=false; placeholders only; no Apify/Firecrawl/Claude node added; no tool_use / no KEY=VALUE.
**Files:** `n8n/workflows/06_approved_candidates_runner.json`, `n8n/workflows/04_firecrawl_url_list_resilient.json`.

---

## DEC-065 — Workflow 06 Must Re-Check `url_registry` at Runtime; `url_candidates` Dedup Fields Are Advisory

**Date:** 2026-06-07
**Context:** First Workflow 06 test exposed a trust bug. The operator manually edited an **old duplicate** candidate (`https://www.autolombard-moskva.ru/pledge-pts/`) in `url_candidates` to `dedup_status=unique`, `registry_status=not_in_registry`, `candidate_type=direct_competitor`, `approval_status=approved`. Workflow 06 trusted those editable discovery-time fields and selected it for hand-off (`selected_count=1`) — even though the URL **already exists in `url_registry`**. Selecting a URL already in the registry would cause a duplicate Firecrawl/Claude spend in Workflow 04. The dedup fields in `url_candidates` are set once at discovery time (Workflow 05) and are operator-editable, so they are not a safe final gate.
**Decision (patch Workflow 06 only — same node skeleton):** Workflow 06 must perform the **final dedup check at runtime against `url_registry`**, not against the editable candidate fields:
- Add a **`Read url_registry`** Google Sheets node (Manual Start → Read url_candidates → Read url_registry → Select). The selection code reads both tabs.
- **Re-normalize** `candidate_url` with the **same `normalizeUrl()` rules as Workflow 04/05** (lowercase scheme/host, drop fragment + utm/gclid/yclid/fbclid params, strip trailing slash) and compare the result against the set of `normalized_source_url` values in `url_registry`.
- Selection gate is now: `approval_status=approved` **AND** `candidate_url` not empty **AND** re-normalized URL **NOT** in `url_registry`. `approval_status` ∈ {`processed`,`duplicate`,`rejected`,`error`} is skipped. The editable `dedup_status`/`registry_status` are **ignored** for the decision (kept in output only as informational fields).
- If `url_candidates` says `unique` but the registry contains the URL → **skip** with reason category `registry_recheck_duplicate`. Manual edits to `dedup_status`/`registry_status` cannot force a duplicate through.
- Skip reason categories: `approval_status_not_approved`, `already_processed`, `duplicate_status`, `registry_recheck_duplicate`, `missing_candidate_url`, `not_direct_competitor_optional_warning`, `over_limit`.
- **Change vs DEC-064:** aggregators/directories/marketplaces/socials/media are no longer hard-blocked behind an `aggregator_approved` note — if `approval_status=approved` they **can** be selected, but the selected item carries a `warning` (`candidate_type is not direct_competitor; review before Workflow 04`). Priority unchanged (`direct_competitor` → `confidence_score` desc → `rank` asc), hard cap 5/run unchanged, manual hand-off unchanged, no auto-`processed` in v0.1.
**Reason:** the registry is the single source of truth for dedup; a runtime recheck makes accidental or manual duplicates impossible to hand off and prevents wasted Firecrawl/Claude spend. Candidate-table dedup fields are discovery-time hints, not a final gate.
**Verification:** `python3 -m json.tool` VALID; node types = manualTrigger, **3×googleSheets** (2 read + 1 disabled update), 2×code, if, 2×stickyNote — **no Apify/Firecrawl/Claude/httpRequest node**; `normalizeUrl` present; reads both `url_candidates` and `url_registry`; `registry_recheck_duplicate` skip present; hard cap 5; `manual_handoff_to_workflow_04` preserved; active=false; placeholders only; no tool_use / no KEY=VALUE.
**File:** `n8n/workflows/06_approved_candidates_runner.json`. **Stage 2.2c remains under test until the registry recheck is validated.**

---

## DEC-064 — Workflow 06 Is the Approved-Candidate Bridge; ≤5 Approved URLs per Run

**Date:** 2026-06-07
**Context:** The manual discovery→approval→consume chain is now proven end-to-end (DEC-062). The repetitive operator step — pick approved candidates from `url_candidates`, prioritize them, and hand ≤5 to Workflow 04 — needed a dedicated, auditable workflow without duplicating discovery or analysis logic.
**Decision:** Build `06 - Approved Candidates Runner` (`n8n/workflows/06_approved_candidates_runner.json`, active=false) as the **bridge between discovery (Workflow 05) and the URL consumer (Workflow 04)**:
- Reads `url_candidates`, filters `approval_status=approved AND dedup_status=unique AND registry_status=not_in_registry AND candidate_url not empty`, excludes aggregators/directories/marketplaces/socials/media unless the operator explicitly overrides (note contains `aggregator_approved`).
- Prioritizes `direct_competitor` first, then higher `confidence_score`, then lower `rank`; **hard cap = 5 candidates per run** (eligible rows beyond 5 are skipped with reason `over_max_5_limit`).
- Emits a WF04-shaped batch (`target_url`, `source_type=scraped_web`, `platform=website`, `source_candidate_id`, `discovery_request_id`, `candidate_type`, `run_id`, `batch_index`) plus an Execution Summary and a ready-to-paste `Set URL List` block.
- **Does not** call Apify/Firecrawl/Claude, discover URLs, or duplicate the analyzer. **v0.1 = manual hand-off**: Workflow 04 keeps its Manual Trigger + fixed `Set URL List`; turning it into a callable subworkflow is a risky trigger/input refactor, deferred. A `Mark Candidates Processed` Google Sheets update node exists but is **disabled by default** — the operator enables it (or sets `approval_status=processed` manually) only after confirming `monitor_queue` output, preserving `approved_by`/`approved_at` and appending `Processed by Workflow 06 run_id=…` to `notes`.
**Reason:** keep one controlled, spend-bounded place to release approved work into the consumer; 5/run mirrors Workflow 04's hard cap and bounds cost; manual hand-off avoids destabilizing the proven consumer.
**Verification:** `python3 -m json.tool` VALID; node types = manualTrigger, 2×googleSheets (read + disabled update), 2×code, if, 2×stickyNote — **no Apify/Firecrawl/Claude/httpRequest node**; active=false; placeholders only (no Spreadsheet ID / credential ID); no tool_use / no KEY=VALUE.
**File:** `n8n/workflows/06_approved_candidates_runner.json`.

---

## DEC-063 — Contact Fields Must Be Exact; Partial Contacts Are Blanked

**Date:** 2026-06-07
**Context:** During the first manual E2E test, Workflow 04 stored `contact_public = "+7 (495) ... (номер указан на сайте, требуется извлечение)"` — a partial/placeholder value, not a usable contact. Storing partial contacts is misleading and risks acting on non-data.
**Decision (patch `Normalize + Route` only — no field-count or architecture change):** add a `sanitizeContact()` helper applied wherever `contact_public` is emitted. A value is **blanked** unless it matches at least one reliable public-contact pattern, and is blanked outright if it contains an ellipsis (`...`/`…`) or `требуется извлечение`. Reliable patterns: phone led by `+7`/`8`/`7` with **10–11 digits** after cleanup; valid email; Telegram (`@handle` or `t.me/`); or a contact/profile URL (`t.me/`, `wa.me/`, whatsapp, viber, `vk.com/`, contact/kontakt/profile). `указан на сайте` with no full contact fails the pattern gate → empty. **Never invent or keep a partial contact.**
**Reason:** a contact field must be actionable; an empty cell is correct when extraction is incomplete.
**Verification:** `python3 -m json.tool` VALID; exactly **35** business + **10** registry fields unchanged; dedup untouched; `sanitizeContact` referenced 4× (1 definition + 3 emitters: main analyzed return, technical_error pass-through, deterministic-fallback pass-through).
**File:** `n8n/workflows/04_firecrawl_url_list_resilient.json`.

---

## DEC-062 — Workflow 04 service_type: Root Page May Get a Specific Type When Content Is Overwhelmingly Focused

**Date:** 2026-06-08
**Context:** First manual **end-to-end** test of the discovery→consume chain passed: Workflow 05 discovered `https://carcapital.ru/` (`candidate_type=direct_competitor`, `service_hint=pts_loan`, confidence 100) → operator approved → Workflow 04 processed it → `monitor_queue`, competitor, `CarCapital`, strength 87. **But `service_type=generic_lending` was wrong** — the page text is overwhelmingly PTS/auto (займы под залог ПТС, ставка 2%/мес, автомобиль остаётся у владельца, ПТС, автоломбард, Москва и МО). The prior B2 override (DEC-053/054) only fired on **non-root** URLs, so a single-product *root* homepage kept `generic_lending`.
**Decision (patch `Normalize + Route` B2 only — no architecture/dedup change):** keep the rule that a genuine multi-product root stays `generic_lending`, but add **content-based deterministic scoring** that lets a root page receive a specific `service_type` when its content is overwhelmingly focused:
- count distinct `pts_auto` / `real_estate` / `refinancing` signal tokens over `source_url + evidence`;
- **multi-product root** (`real_estate ≥ 2 AND refinancing ≥ 1`) → keep `generic_lending`;
- else **`pts_auto ≥ 3 AND real_estate ≤ 1 AND refinancing == 0`** → `pts_loan` (applies even to a root homepage);
- else `pts_auto ≥ 3 AND url/path has pts|avto|car|zalog` → `pts_loan`;
- else `real_estate ≥ 3 AND pts_auto ≤ 1 AND refinancing == 0` → `secured_real_estate_loan`;
- existing non-root path-token overrides (pts/auto/real-estate) unchanged.
**Reason:** competitor monitoring needs an accurate product label; a focused autolombard homepage is a PTS lender, not generic. Multi-product portals (e.g. `mosinvestfinans.ru/`) still resolve to `generic_lending`.
**Verification:** `python3 -m json.tool` VALID; 35 business + 10 registry fields unchanged; dedup architecture untouched; simulation of all 6 documented cases PASS — `carcapital.ru/`→`pts_loan`, `cashmotor.ru/`→`pts_loan`, `autolombard-moskva.ru/pledge-pts/`→`pts_loan`, `mosinvestfinans.ru/`→`generic_lending`, `…/kredit/pod-zalog-avto/`→`pts_loan`, `lioncredit…/kredit-pod-zalog-nedvizhimosti`→`secured_real_estate_loan`.
**File:** `n8n/workflows/04_firecrawl_url_list_resilient.json`.

---

## DEC-061 — Workflow 05 Candidate Quality: `candidate_type`, Fixed Domain, Competitor-First Scoring

**Date:** 2026-06-08
**Context:** First real Apify run («займ под залог ПТС Москва») passed technically (10 candidates, 1 registry duplicate, `discovery_requests` row), but quality was weak: `domain` empty for all rows; `confidence_score` too high for aggregators/directories/media; no way to tell a direct competitor from a portal.
**Decision (patch, no architecture change):**
1. **Fixed `domain` extraction** — robust hostname parse with regex fallback, lowercased, leading `www.` stripped (e.g. `https://www.autolombard-moskva.ru/` → `autolombard-moskva.ru`). Computed authoritatively in `Classify Candidates` so it is never empty.
2. **Added `candidate_type`** (`direct_competitor` / `aggregator` / `directory` / `media_article` / `marketplace` / `social` / `unknown`), deterministic from domain allow-lists + keyword/path heuristics. **`url_candidates` grows 25 → 26 columns** (`candidate_type` inserted after `domain`; `domain` moved before `title`/`snippet`).
3. **Competitor-first confidence** — `+30 direct_competitor`; positives for залог/ПТС/авто/Москва/кредит-займ/ставка-сумма/lender; negatives `-50 duplicate_in_registry`, `-35 directory`, `-25 aggregator`, `-20 media_article`, `-20 marketplace` (unless the query asks for one), `-30 social`; clamp 1–100.
4. **Approval policy:** duplicates → `duplicate`; unique direct competitors → `new`; unique aggregators/directories/media → `new` **with a "review manually; not a direct competitor" note**. No auto-reject.
5. Also fixed `looksLender` to match `займ` (not only `заим`/`заём`) — without it, e.g. `carcapital.ru` mis-typed as `unknown`.
**Reason:** make discovery output directly usable for approval and future Telegram summaries; push spend toward real competitors and away from low-value aggregator/portal pages.
**Verification:** `python3 -m json.tool` VALID; only the Apify HTTP node (0 Firecrawl/0 Claude); node simulation on the 10 real-test-like candidates → domains filled, types correct (4 direct_competitor new, cashmotor direct_competitor duplicate, 2gis directory, finuslugi/vbr/banki aggregator, kp media_article), competitors 85–100 vs aggregators/directory/media 15–45, exact **26** url_candidates + **18** discovery_requests field counts.
**Operator action required:** add `candidate_type` to the `url_candidates` sheet (after `domain`) → 26-column header, re-import, rerun the same query.
**File:** `n8n/workflows/05_apify_search_candidate_discovery.json`.

---

## DEC-060 — Workflow 05 Built: Apify Google Search Sync Endpoint, 0 Firecrawl/Claude, Manual Approval

**Date:** 2026-06-08
**Context:** Implementing Stage 2.2 (DEC-059) as a concrete n8n workflow.
**Decision:**
1. **Workflow 05 (`05 - Apify Search Candidate Discovery`) is built** (`n8n/workflows/05_apify_search_candidate_discovery.json`, active=false, 13 nodes). It calls the **Apify Google Search Results Scraper** via the **sync endpoint** `POST /v2/acts/apify~google-search-scraper/run-sync-get-dataset-items?format=json&clean=true` (one query, one page, ≤10 results) using Header Auth credential `Apify API - Marketing Scout`.
2. **Workflow 05 spends 0 Firecrawl and 0 Claude.** It only searches, normalizes (Workflow 04 rules → keys match `url_registry`), reads `url_registry` for dedup, scores candidates **deterministically** (no LLM), and writes `url_candidates` (25 cols) + one `discovery_requests` row (18 cols). It writes **no** business tab.
3. **Manual approval required.** Unique → `approval_status=new`; duplicates (registry or batch) → `duplicate`. No candidate reaches Workflow 04 without a human setting `approved`. The Approved Candidates Runner (Stage 2.2c) and Telegram bot stay deferred.
4. **Robust-write design:** both Sheets-append branches start from the always-1-item `Classify Candidates` node, so the `discovery_requests` row is written even on 0 candidates / Apify error (`status=error`). The Apify HTTP node uses `onError=continueRegularOutput` so a failure still produces a summary row.
5. **Source-agnostic + future-compatible:** Workflow 05 is the *Web Search Connector*; lead-source connectors (Avito/social/classified) come later as separate connectors feeding the same source-agnostic analyzers. Not hardcoded to competitors only.
**Reason:** keep discovery cheap and separate; preserve the human spend gate; reuse the dedup spine; leave room for lead discovery later.
**Verification:** `python3 -m json.tool` VALID; active=false; only the Apify HTTP node (no Firecrawl/Claude/anthropic nodes); no `tool_use`/`KEY=VALUE`; placeholders only (no real token/Spreadsheet ID); node-logic simulation confirmed 25/18 field counts, dedup/batch-dup/registry classification, error path, and confidence discrimination.
**File:** `n8n/workflows/05_apify_search_candidate_discovery.json`, `docs/N8N_WORKFLOW_05_APIFY_SEARCH_CANDIDATES_RU.md`.

---

## DEC-059 — Stage 2.2 = Apify Search Candidate Discovery (Level 2); Manual Intake Demoted; `discovery_requests` Added

**Date:** 2026-06-08
**Context:** Manual URL *lists* are already handled by Workflow 04 (the URL consumer). Positioning Workflow 05 as "manual candidate intake" added little. The real gap is **automated** candidate discovery from a search query, with a human gate before paid processing.
**Decision (refines DEC-058):**
1. **Stage 2.2 becomes `05 - Apify Search Candidate Discovery` (Level 2).** Given a query, an **Apify Google Search Results Scraper** actor returns up to 10 candidate URLs (+title/snippet/rank); Workflow 05 normalizes, checks `url_registry`, scores deterministically, marks duplicates, writes `url_candidates`, and writes/updates a `discovery_requests` row. **Workflow 05 calls neither Firecrawl nor Claude and never auto-processes.**
2. **Manual URL intake is demoted** to an optional fallback input mode of Workflow 05 — **not** the main next step (DEC-058's "Option A first" is superseded on ordering).
3. **Primary discovery API = Apify** (Header Auth credential `Apify API - Marketing Scout`, `Authorization: Bearer <token>`, domain `api.apify.com`). Apify is already the planned stack for future Avito/social/classified actors; **Firecrawl stays the content-extraction layer for known approved URLs**, not for discovery. Fallbacks: Google CSE (low-cost), SerpAPI (paid) — later. Firecrawl `/v2/search` parked.
4. **New sheet `discovery_requests` (18 cols)** groups candidates per request (id, query, region, counts, estimates, lifecycle `status`); `url_candidates` confirmed at 25 cols. No existing sheet removed.
5. **Telegram Control Bot is a control interface later, not a data-processing engine** — it orchestrates `discovery_requests` + `url_candidates` + Workflow 04 and duplicates no scraping/analysis logic.
6. **Source connectors are separate from core analyzers** — new platforms add a *connector* (Web Search / Website Scrape / Classifieds / Social); analyzers (Market Record / Lead Signal / Content Insight / Report) classify records as competitor/lead_signal/content_idea/market_signal/irrelevant **independent of source**.
**Reason:** Workflow 04 already covers manual lists; the valuable next capability is query→candidates automation with approval. Apify fits and is already planned. Keeping discovery, approval, and processing separate preserves cost control and testability.
**Default volumes:** collect 10 candidates; Workflow 04 processes ≤5/run → two batches of 5; nothing processed until `approval_status=approved`.
**File:** planning — `docs/WORKFLOW_05_URL_DISCOVERY_PLAN.md`, `docs/URL_DISCOVERY_STRATEGY.md`, `docs/TABLE_SCHEMA.md`.

---

## DEC-058 — URL Discovery = Hybrid A+B+D; `url_candidates` Grows to 25 Columns; Collect 10 / Process 5

**Date:** 2026-06-08
**Context:** Refining Stage 2.2 before building Workflow 05. The discovery layer must support a future Telegram bot and per-request summaries without re-architecting, while keeping discovery, approval, and processing as separate, independently testable stages.
**Decision:**
1. **Selected architecture = Hybrid A + B + D** (C parked): Option A (manual intake) **first**, then Option B (search/API or Apify actor) once a source is evaluated, then Option D (Telegram) **as an interface only**. Firecrawl `/v2/search` (C) is **parked** — do not combine search+scrape+analysis in one step; if evaluated later, use C for candidate discovery only.
2. **`url_candidates` schema grows from 22 → 25 columns**, adding request-level grouping fields `discovery_request_id`, `requested_by`, `requested_limit` (plus `query`, `created_at` already present) so candidates from one operator request can be grouped, summarized, and reported by a future bot.
3. **Default volumes:** a discovery request **collects up to 10 candidates** (`requested_limit=10`); **Workflow 04 still processes max 5 URLs per run**, so 10 approved candidates run as **two controlled batches of 5**. **No candidate reaches Firecrawl/Claude until `approval_status=approved`.**
4. **Stage 2.2c Approved Candidates Runner** is the named hand-off layer (approved candidates → Workflow 04 in batches of 5); manual for now, not built.
**Reason:** the grouping fields are cheap to add now and expensive to retrofit; the hybrid order de-risks cost and quality; Telegram-as-interface keeps core logic in one place.
**Supersedes:** the 22-column proposal in DEC-055.
**File:** planning — `docs/URL_DISCOVERY_STRATEGY.md`, `docs/WORKFLOW_05_URL_DISCOVERY_PLAN.md`, `docs/TABLE_SCHEMA.md`.

---

## DEC-057 — Telegram Control Bot Deferred Until Candidate + Approval Flow Exists

**Date:** 2026-06-08
**Context:** A natural-language Telegram interface is attractive but it is an *interface*, not a discovery source. Building it before a candidate sheet + human approval flow exist would couple NL parsing, discovery, approval, and processing into one fragile step.
**Decision:** Telegram Control Bot (Stage 2.3) is **deferred** until Stage 2.2a (manual candidate intake) and the approval flow are built and validated (gates G1–G3 in `URL_DISCOVERY_STRATEGY.md`). The bot will then only orchestrate: submit query → show estimated cost → operator approves → write approved URLs → trigger Workflow 04 (or a future Workflow 06).
**Reason:** keep each layer independently testable; never auto-process without a human gate.
**File:** planning — `docs/URL_DISCOVERY_STRATEGY.md`.

---

## DEC-056 — Manual Candidate Intake Before Automated Search (Option A first)

**Date:** 2026-06-08
**Context:** Discovery can be manual (operator pastes candidate URLs) or automated (search API / SERP actor / Firecrawl `/v2/search`). Automated sources carry cost, rate-limit, quality, and ToS risk that must be evaluated.
**Decision:** Stage 2.2 starts with **Option A — Manual URL Candidates** (Workflow 05: normalize → `url_registry` lookup → write `url_candidates`, 0 cost). **Option B** (search API / Apify actor) is a later, measured test after source evaluation (gate G4). **Option C** (Firecrawl `/v2/search`) stays **blocked** until explicitly evaluated — not assumed best.
**Reason:** cheapest, safest, no new external dependency; proves the candidate + approval + dedup flow before any paid discovery.
**File:** planning — `docs/WORKFLOW_05_URL_DISCOVERY_PLAN.md`.

---

## DEC-055 — URL Discovery Is a Separate Layer; Workflow 04 Remains the URL Consumer

**Date:** 2026-06-08
**Context:** Workflow 04 is validated as the URL **consumer** (≤5 URLs → dedup → Firecrawl → Claude → routing). Stage 2.2 needs a URL **supplier** that turns an operator topic/query into vetted candidate URLs.
**Decision:** Build the supplier as a **separate layer**, not inside Workflow 04. A new **`url_candidates`** sheet (22 columns; **expanded to 25 in DEC-058**) holds candidates with `approval_status` (`new`/`approved`/`rejected`/`processed`/`duplicate`/`error`); discovery checks `url_registry` early so already-processed URLs never reach approval or spend; **human approval is required** before any Firecrawl/Claude processing. Workflow 04 is unchanged and keeps its ≤5-URL limit. The candidate normalizer reuses Workflow 04's rules so `url_candidates.normalized_source_url` matches `url_registry` exactly.
**Reason:** separates cost profiles and failure modes (discovery vs analysis), inserts a human gate, and reuses dedup. Keeps each workflow simple and independently testable.
**File:** planning — `docs/URL_DISCOVERY_STRATEGY.md`, `docs/WORKFLOW_05_URL_DISCOVERY_PLAN.md`.

---

## DEC-054 — Workflow 04 Approved for Manual ≤5-URL Mini-Batch; Placeholder Pre-Filter + Stronger PTS Override

**Date:** 2026-06-08
**Context:** 5-URL validation run (`firecrawl_20260607_100715`) passed end-to-end:
- 2 duplicates (`mosinvestfinans.ru/`, `lioncredit.ru/…/kredit-pod-zalog-nedvizhimosti`) → `skipped_log`/`dedup_source_url`, 0 cost.
- 1 placeholder (`zalogpts.ru/`, a Wix "domain not connected" page) → `irrelevant`/`skipped_log` but **only after a Claude call** (`parse_method=primary_json`) — wasteful.
- 2 competitors (`cashmotor.ru/` → `pts_loan`; `autolombard-moskva.ru/pledge-pts/` → competitor but `generic_lending`, should be `pts_loan`).
- Cost: Claude delta **$0.0429**; Firecrawl ~3 credits (only the 3 non-duplicates).

**Decision:**
1. **Workflow 04 is APPROVED for manual ≤5-URL mini-batches.** Hard limits unchanged: manual trigger only, max 5 URLs, no schedule, no crawl/batch/search, no Telegram bot yet.
2. **Placeholder pre-filter (`Normalize Firecrawl Output`):** after markdown cleaning, if the page is an obvious placeholder/parking/domain-not-connected page (`domain not connected`, `wix domain not connected`, `parking page`, `сайт/домен не подключен`, `заглушка сайта`, or bare `coming soon` with **no** business content) → emit a 35-field `skipped_log` row (`parse_method=firecrawl_placeholder_prefilter`, `business_skip`, scores 1, `ignore`) **before any Claude call**. The row still appends to `url_registry` (no repeat processing by default). Strong phrases skip unconditionally; `coming soon` skips only when there are zero commercial terms, to avoid false skips of real pages.
3. **Stronger PTS/path service-type override (`Normalize + Route`):** explicit tokens now force `pts_loan` (`pledge-pts`, `zalog-pts`, `залог ПТС`, `под залог птс`, `птс автомобиля`, `займ под залог птс`, bare `птс`/`pts`), `secured_auto_loan` (`pod-zalog-avto`, `под залог автомобиля`, …) without explicit PTS, and `secured_real_estate_loan` (`pod-zalog-nedvizhimosti`, `залог недвижимости`, `квартир`, `коммерческ`, `залог дом`). Root homepage / multi-product stays `generic_lending`.

**Reason:** deterministic, no architecture/dedup change, no prompt tuning. Placeholder pre-filter saves Claude spend on parked domains; the PTS override fixes the one mislabelled competitor (`autolombard-moskva.ru/pledge-pts/`).

**Operational note:** after each import, `Append url_registry` must be set manually — **Sheet = `url_registry` (name mode, NOT the dynamic `{{ $json.route }}`), Mapping = Automatically, real Document ID, Google Sheets credential**. `Registry Lookup` also uses Sheet = `url_registry`. Only `Append to Dynamic Route Sheet` uses `{{ $json.route }}`.

**Verification:** `python3 -m json.tool` VALID; 35 business + 10 registry fields preserved; dedup path unchanged; node simulation — `pledge-pts` → `pts_loan`, `pod-zalog-avto` → `secured_auto_loan`, `…nedvizhimosti` → `secured_real_estate_loan`, root → `generic_lending`; Wix-not-connected + bare coming-soon → skip, coming-soon-with-offer + real page → process. Primary lane nodes lifted to y=140 so the technical-error arrow reads cleanly.

**File:** `n8n/workflows/04_firecrawl_url_list_resilient.json`.

---

## DEC-053 — Workflow 04 Approved for Manual Mini-Batch; Output Language Guard + URL/Path Service-Type Override

**Date:** 2026-06-08
**Context:** Two-run validation of Workflow 04 (after the `url_registry` patch) passed:
- **Run 1** (`firecrawl_20260607_094000`, 3 URLs) — all reached `monitor_queue` as competitors (`МосИнвестФинанс` 78/80; `МОСИНВЕСТФИНАНС` 78/82; `LionCredit` 75/75). `url_registry` was empty, so all three were processed (expected).
- **Run 2** (`firecrawl_20260607_094303`, same 3 URLs) — all three → `skipped_log` / `business_skip` / `parse_method=dedup_source_url`, **0 Firecrawl / 0 Claude**. Dedup confirmed working.

Two output-quality issues surfaced: (a) the auto/PTS service page `…/kredit/pod-zalog-avto/` was labelled `generic_lending` instead of `pts_loan`/`secured_auto_loan`; (b) the repaired `LionCredit` row came back with an **English** `reason` on a Russian source page.

**Decision:**
1. **Workflow 04 is APPROVED for manual mini-batch (3–5 URLs, manual trigger only).** Larger automation stays blocked (no schedule, no crawl/batch/search, no >5 URLs, no discovery/Telegram).
2. **`url_registry` is the single source of truth for dedup.** Old business rows written before the registry existed do **not** dedup unless backfilled into `url_registry`. Backfilling older rows is **optional future maintenance**, not required.
3. **Output language guard (`Normalize + Route`):** when the source is Cyrillic but the final `reason` is mostly English / CJK / foreign-script, replace it with a deterministic Russian fallback by `entity_type` (competitor → "Страница содержит признаки конкурента … Запись отправлена в мониторинг конкурентов."). Same guard applied to `offer_text` (build a short Russian offer from company/service/terms).
4. **URL/path service-type override (`Normalize + Route`):** a **specific** service URL beats the multi-product `generic_lending` default — `pod-zalog-avto`/`залог ПТС`/`ПТС` → `pts_loan` (or `secured_auto_loan` without PTS), `pod-zalog-nedvizhimosti`/`залог недвижимости`/`квартир`/`коммерческ` → `secured_real_estate_loan`. A **root homepage** (no service path segment) stays `generic_lending`.

**Reason:** keep deterministic, no heavy prompt tuning, no architecture/dedup change. Language consistency and service-type precision are post-model normalization, where they are cheap and reliable.

**Verification:** `python3 -m json.tool` VALID; 35 business fields + 10 registry fields preserved; dedup path unchanged; root → `generic_lending`, `/kredit/pod-zalog-avto` → `pts_loan`/`secured_auto_loan`, `/uslugi/kredit-pod-zalog-nedvizhimosti` → `secured_real_estate_loan`.

**File:** `n8n/workflows/04_firecrawl_url_list_resilient.json`.

---

## DEC-051 — Workflow 04 Dedup Uses a Dedicated `url_registry` Tab (Supersedes Six-Tab Scan)

**Date:** 2026-06-08
**Context:** The first Workflow 04 test re-processed a URL that had already been analyzed earlier — the four-tab `Dedup Lookup` chain (`results/review_queue/monitor_queue/content_queue`) was fragile and did not reliably block duplicates. Scanning six business tabs per URL is brittle and does not scale to a future Telegram Bot / URL Discovery agent.

**Decision:** Dedup uses a **dedicated `url_registry` tab** (10 columns), keyed by `normalized_source_url`, checked **before** Firecrawl/Claude. A match (with `force_reprocess=false`) → `skipped_log` / `parse_method=dedup_source_url`, **0 cost**. After **every** non-duplicate processing attempt — including `technical_errors` — Workflow 04 appends a row to `url_registry` (`Build Registry Row` → `Append url_registry`), so a URL is not re-processed by default. `force_reprocess` (a field on `Set URL List`, default `false`) bypasses dedup for manual/future overrides. The six-tab scan is **rejected and removed**.

**Reason:** one registry tab is cleaner, cheaper (one read), and future-proof. Telegram Bot / URL Discovery can write/consume the same registry.

**Verification:** node simulation — duplicate → 35-field `skipped_log`; non-duplicate → source record; `Build Registry Row` emits exactly the 10 registry fields.

**File:** `n8n/workflows/04_firecrawl_url_list_resilient.json`.

---

## DEC-052 — Deterministic Competitor Fallback After Primary+Repair JSON Failure

**Date:** 2026-06-08
**Context:** On long real pages (`mosinvestfinans.ru/kredit/pod-zalog-avto/`, `lioncredit.ru/…/kredit-pod-zalog-nedvizhimosti`) Firecrawl returned rich markdown but both the primary and repair JSON parses failed, routing clear competitors to `technical_errors` even though `raw_response_preview` plainly showed `entity_type=competitor`, a company, and a service type. Those should be `monitor_queue`, not lost.

**Decision:** After primary+repair both fail to yield JSON, `Parse Repaired JSON` runs a **deterministic** fallback: count competitor signals (кредит, займ, залог, ПТС, авто, недвиж, ставка, сумма, телефон, Москва, руб, %, …) over `text_context`+primary raw preview. If **≥5 signals** and the source is a scraped website → build a 35-field `competitor` row (`route=monitor_queue`, `parse_method=deterministic_competitor_fallback`, `recommended_action=monitor`, `repair_status=failed_fallback`, `needs_manual_review=true`), deriving `company_name` (МосИнвестФинанс / LionCredit / hostname / «Конкурент без бренда»), `service_type` (pts_loan / secured_real_estate_loan / generic_lending), short `offer_text`/`terms`, `region`, and `competitor_strength` 70 (or 80 with ≥8 signals + contact/amount). If **<5 signals** → `technical_errors` (unchanged). This is **deterministic hardening, not prompt experimentation** — the primary/repair prompts were left intact (only a small safety line added to the repair prompt). Also lowered `text_context` cap to **3500** + added markdown cleaning (drop image/svg lines, commercially-relevant lines first), and made both JSON parsers deterministic (strip fences → direct parse → first balanced object → first `{`..last `}`).

**Verification:** simulation — junk repair text + 8 signals → `monitor_queue` / `deterministic_competitor_fallback` / МосИнвестФинанс / pts_loan / strength 80, 35 fields; low-signal junk → `technical_errors`, 35 fields.

**File:** `n8n/workflows/04_firecrawl_url_list_resilient.json`.

---

## DEC-048 — Batch Schema = 35 Columns (run_id + batch_index)

**Date:** 2026-06-08
**Context:** Workflow 04 processes several URLs per run; rows need to be grouped by run and ordered by URL position for traceability and cost attribution. The operator extended all six Google Sheets tabs from 33 to 35 columns by adding `run_id` and `batch_index`.

**Decision:** The production/batch schema is now **35 columns** = 25 core + 8 technical + `run_id` + `batch_index`. `run_id` is one id per execution (`firecrawl_YYYYMMDD_HHmmss`); `batch_index` is the 1-based URL position within the run (0 if N/A). **Workflow 04 fills both on every output path** (dedup-skip, firecrawl-error, analyzer, repaired-technical-error). **Workflows 02 and 03 may leave them empty** — the dynamic append auto-maps by header, so absent fields are written blank. All six tabs must carry the same 35-column header.

**Verification:** node simulation confirms all WF04 output paths emit exactly 35 keys including `run_id`/`batch_index`.

---

## DEC-049 — Workflow 04 Deduplicates by source_url Before Firecrawl/Claude Spend

**Date:** 2026-06-08
**Context:** Re-running an overlapping URL list would create duplicate rows and waste Firecrawl credits + Claude tokens. The plan made dedup a first-class requirement.

**Decision:** Workflow 04 normalizes each URL (lowercase scheme/host, strip `#fragment`, drop tracking params `utm_*`/`gclid`/`yclid`/`fbclid`, remove trailing slash except root) into `normalized_source_url`, then looks it up in the four **business** tabs (`results`, `review_queue`, `monitor_queue`, `content_queue`) **before** calling Firecrawl/Claude. A match → `skipped_log` row with `parse_method=dedup_source_url`, `processing_status=business_skip`, **zero Firecrawl/Claude cost**. `technical_errors` and `skipped_log` are intentionally **not** hard-duplicate blockers, so previously failed/skipped URLs can be retried.

**Implementation status: IMPLEMENTED (best-effort).** Four Google Sheets `read` nodes filter `source_url` (`filtersUI` lookup) with `alwaysOutputData=true` + `onError=continueRegularOutput`; `Evaluate Dedup` aggregates via `$('node').all()` and matches the exact normalized key. If a given n8n build rejects the lookup config on import, the RU guide documents a fallback (whole-tab read + compare, or temporary dedup bypass). Dedup is never silently omitted.

**File:** `n8n/workflows/04_firecrawl_url_list_resilient.json`.

---

## DEC-050 — Future Telegram Bot May Feed URL Lists to Workflow 04; URL Discovery Deferred

**Date:** 2026-06-08
**Context:** A natural next-product step is letting the operator request analysis in plain language (e.g. «найди конкурентов по кредитам под залог авто в Москве») instead of pasting URLs.

**Decision:** A future Telegram Control Bot / URL Discovery agent may collect or generate candidate URLs, estimate cost, ask for confirmation, then pass the list into Workflow 04 (whose dedup prevents repeated processing). **This is deferred** — URL discovery and NL requests are a separate future layer. **Workflow 04 accepts only manually provided URLs** (max 5). Not built now.

---

## DEC-045 — Firecrawl Single-URL Competitor Websites Approved (After Two Successful Tests)

**Date:** 2026-06-08
**Context:** Workflow 03 (`03_firecrawl_single_url_resilient.json`), after the DEC-043/044 hardening, passed two real single-URL tests:
- **Test 1 — `https://mosinvestfinans.ru/`** (multi-product homepage): `route=monitor_queue`, `entity_type=competitor`, `company_name=МосИнвестФинанс`, `region=Москва`, `service_type=generic_lending`, `competitor_strength=78`, `quality_score=78`, `recommended_action=monitor`, `processing_status=parsed_success`, `parse_method=primary_json`, `repair_used=false`.
- **Test 2 — `https://www.lioncredit.ru/uslugi/kredit-pod-zalog-nedvizhimosti`** (specific real-estate collateral page): `route=monitor_queue`, `entity_type=competitor`, `company_name=LionCredit`, `service_type=generic_lending`, `competitor_strength=75`, `quality_score=75`, `recommended_action=monitor`, `parsed_success`, `primary_json`, `repair_used=false`.

**Decision:** **Firecrawl single-URL ingestion of competitor websites is approved** for controlled, manual use, and competitor-website → `monitor_queue` routing is approved. This is now a known-good source type for the pipeline.

**Still blocked:** multi-page crawl, batch scraping over large URL lists, scheduled scraping, and real ingestion of Avito/Telegram/Instagram. The next step up is the **small mini-batch** (DEC-047), not a crawler.

**Note:** `service_type` may later be refined to `secured_real_estate_loan` for clearly single-product real-estate pages (Test 2 returned `generic_lending`); not a blocker.

---

## DEC-046 — n8n Credential Rebinding After Import Is an Operational Requirement

**Date:** 2026-06-08
**Context:** Workflow JSON stores credentials by **name + a placeholder ID** (`PASTE_CREDENTIAL_ID_HERE`). n8n credential IDs are **local to each instance**, so on every import the four credential-bearing nodes lost their binding and required manual reselection before the workflow could run.

**Decision:** Treat **manual credential rebinding after every import** as a standard operational step, documented in each workflow's RU guide. After importing Workflow 03 (and future Firecrawl workflows), rebind:
- `Firecrawl Scrape API` → `Firecrawl API - Marketing Scout`
- `Claude Primary API Request` → `Claude API - Marketing Scout`
- `Claude Repair API Request` → `Claude API - Marketing Scout`
- `Append to Dynamic Route Sheet` → `Google Sheets - Marketing Scout Service Account` (+ real Spreadsheet ID)

This is expected behavior, not a bug. Keeping credential IDs as placeholders in the repo is correct (no secret leakage); the cost is one manual rebinding pass per import.

---

## DEC-047 — Workflow 04 May Process a Small Manual URL List (Max 5, No Schedule)

**Date:** 2026-06-08
**Context:** With single-URL competitor ingestion approved (DEC-045), the next step is to iterate over a few URLs — but without jumping to crawl/batch/schedule, which multiply cost and failure surface.

**Decision:** Workflow 04 (planned, not built) may process a **manually provided list of 3–5 competitor URLs in one manual run**. Hard limits: **max 5 URLs**, **manual trigger only**, **no crawl**, **no schedule**, `text_context`≤6000, continue-on-failure per URL (failed URL → `technical_errors`). **Deduplication by `source_url` is a first-class requirement** for Workflow 04 (in-run de-dup always; cross-run Sheets lookup recommended). Reuses Workflow 03's analyzer/normalize/routing nodes verbatim.

**Build gate:** plan documented in `docs/WORKFLOW_04_FIRECRAWL_URL_LIST_PLAN.md`. **Do not build until the operator approves the plan.**

---

## DEC-043 — Post-Repair Business-Consistency Hardening for Scraped Competitor Pages

**Date:** 2026-06-08
**Context:** First real-source test (Firecrawl on `https://mosinvestfinans.ru/`, a rich secured-lending homepage). Firecrawl succeeded (1 credit); the **primary** Claude analysis failed JSON parse; the **repair** branch succeeded (`parse_method=repaired_json`, `repair_used=true`, `repair_status=success`). But the repaired output was internally contradictory and was routed to `review_queue`: `entity_type=competitor` yet `competitor_strength=1`, `quality_score=6`, `recommended_action=investigate`, `service_type=pts_loan` (despite many real-estate/refinancing products), and a **reason written in Chinese** ("活跃抵押贷款竞争对手…"). Architecture worked; the **repaired JSON is structurally valid but not trustworthy for business values**.

**Decision:** `Normalize + Route` now distrusts repaired/low-confidence output and enforces business invariants for scraped website pages (it does **not** change any prompt):

1. **Competitor signal counting** over `text_context + offer_text + terms + reason + scraped markdown` using a Russian secured-lending term list (кредит, займ, залог, ПТС, авто, недвиж, рефинанс, ипотек, ставка, сумма, одобрен, плохая кредитн, просрочк, телефон, москва, московск).
2. **Competitor consistency rule (≥3 signals, `entity_type=competitor`, `source_type=scraped_web`, `platform=website`):** `competitor_strength=max(cur,65)`, `quality_score=max(cur,65)`, `recommended_action=monitor`, `route=monitor_queue`, `needs_manual_review=false` unless `parse_error` exists, `processing_status` stays `parsed_success`. **≥5 signals:** floors raised to 75.
3. **Repaired-JSON trust rule:** if `repair_used=true` and `entity_type=competitor`, never allow `competitor_strength<45` unless the scraped text is empty/unusable (<80 chars); rich competitor website pages must **never** land in `review_queue` (route forced to `monitor_queue` before the weak-lead branch).
4. **Language guard:** if the source text contains Cyrillic but `reason` contains CJK characters or is mostly non-Cyrillic/non-Latin, replace `reason` with a Russian fallback (a fixed competitor sentence, or a templated sentence from entity/company/service/terms/region/scores for non-competitors).
5. **`raw_response_preview`** capped at **200** chars on `parsed_success` (still 500 on `technical_error`) — no need to store large model output after a clean parse.

**Verification:** Node simulation of the mosinvest repaired output → `monitor_queue`, `entity_type=competitor`, `company_name=МосИнвестФинанс`, `service_type=generic_lending`, `competitor_strength=75`, `quality_score=75`, `recommended_action=monitor`, Russian `reason`, `needs_manual_review=false`, 33 fields. Regression (hot lead→results, weak lead→review_queue, skip→skipped_log, technical_error passthrough, auto/PTS-only competitor→monitor_queue keeping `pts_loan`) all pass with 33 fields.

**File:** `n8n/workflows/03_firecrawl_single_url_resilient.json` (`Normalize + Route` only). No new workflow copy (validation passed). No prompt change, no new fields.

---

## DEC-044 — Multi-Product Website Pages Classify as generic_lending Unless One Product Dominates

**Date:** 2026-06-08
**Context:** The mosinvest homepage advertises залог недвижимости, рефинансирование, ипотека, and залог авто/ПТС together. The repaired `service_type` came back `pts_loan` merely because "ПТС" appeared, misrepresenting a multi-product lender as an auto-collateral specialist.

**Decision:** In `Normalize + Route`, when `source_type=scraped_web` and `platform=website`, detect product categories (real-estate collateral, refinancing, mortgage, auto/PTS). If **two or more** categories are present, set `service_type=generic_lending` — a single keyword (e.g. "ПТС") must not force a narrow type. A genuinely single-product page (e.g. only `кредит под залог авто`/ПТС) keeps its specific enum (`pts_loan`/`secured_auto_loan`). Expected for the mosinvest homepage: `generic_lending` (or `secured_real_estate_loan`), never `pts_loan`.

**File:** `n8n/workflows/03_firecrawl_single_url_resilient.json` (`Normalize + Route`).

---

## DEC-039 — First Scraper Source Is Firecrawl Single URL (Not Crawl / Batch / Search)

**Date:** 2026-06-07
**Context:** Workflow 02 production resilient analyzer smoke test passed (competitor record → `monitor_queue`, `processing_status=parsed_success`, `parse_method=primary_json`, dynamic Sheets routing confirmed). The first real source can now be connected.

**Decision:** The first scraper is **Firecrawl `POST /v2/scrape` on one URL at a time** — not crawl, not batch, not search, no `actions`, no browser steps. Workflow 03 (`03_firecrawl_single_url_resilient.json`) scrapes one public competitor page, normalizes the markdown into a source record, and feeds it to the same resilient analyzer.

**Rationale:** Lowest risk and lowest cost. One URL keeps anti-bot exposure, credit burn, and failure surface minimal while the per-URL cost profile is still unknown. The competitor → `monitor_queue` path is already validated (Test C + production smoke). Crawl/batch/search multiply cost and failure modes before we have a cost baseline.

**Trigger to expand:** Only after a passing single-URL test with a recorded cost delta may multi-URL be considered (then Avito/Apify → Telegram → Instagram).

**File:** `n8n/workflows/03_firecrawl_single_url_resilient.json`. active=false, placeholders only.

---

## DEC-040 — Firecrawl MCP/CLI Integration Deferred

**Date:** 2026-06-07
**Context:** Firecrawl offers an HTTP API, an MCP server, and a CLI.

**Decision:** Use the **n8n HTTP Request node** against `https://api.firecrawl.dev/v2/scrape` with Header Auth. The **MCP server and CLI are deferred** to a later phase for local agent / browser automation, where an interactive agent drives scraping itself.

**Rationale:** The HTTP node is transparent (visible in the execution log), reuses the existing Claude HTTP pattern and the credential-by-name model, and needs no extra daemon/runtime on the constrained VPS. MCP/CLI add a local process and a different auth/runtime surface with no benefit for a single n8n-orchestrated scrape.

**Doc:** `docs/FIRECRAWL_SETUP.md`.

---

## DEC-041 — Firecrawl Failures Route to technical_errors Without a Claude Call

**Date:** 2026-06-07
**Context:** If Firecrawl returns an HTTP/API error or an empty/unusable page, sending it to Claude would waste AI spend and produce a meaningless analysis.

**Decision:** The `Normalize Firecrawl Output` Code node emits a complete **33-field `technical_errors` row** directly when (a) the Firecrawl call errored, or (b) the scrape succeeded but the cleaned markdown has **fewer than 80 meaningful characters**. The `IF Firecrawl Normalized OK?` node then sends that row straight to `Append to Dynamic Route Sheet`, **bypassing Claude**. Error rows carry `parse_method=firecrawl_error`, `processing_status=technical_error`, `needs_manual_review=true`, `route=technical_errors`, and a `raw_response_preview` (≤500) of the error/markdown.

**Note on empty content:** an empty-but-successful scrape is treated as `technical_errors` (scrape succeeded, content unusable) rather than `skipped_log`, so the operator sees a pipeline issue, not a business skip (DEC-038 distinction preserved).

**File:** `n8n/workflows/03_firecrawl_single_url_resilient.json` (`Normalize Firecrawl Output`, `IF Firecrawl Normalized OK?`).

---

## DEC-042 — text_context Capped at 6000 Chars Before Claude (Firecrawl Cost Control)

**Date:** 2026-06-07
**Context:** Real scraped pages are far longer than the ~200-char test records. Unbounded markdown would inflate Claude token cost per record and risk gateway limits.

**Decision:** `Normalize Firecrawl Output` cleans the markdown (strip `\r`, collapse 3+ blank lines, trim) and caps `text_context` at **6000 characters** before it reaches `Build Primary Claude Request`. The first test uses **one URL only**; per-record cost is measured on that run and logged in `docs/COSTS_AND_LIMITS.md`.

**Rationale:** 6000 chars preserves enough of a competitor landing page to classify it (offer, rates, region, contact) while bounding token cost. Tighter caps can be applied later once the cost/quality tradeoff is measured on real pages.

**File:** `n8n/workflows/03_firecrawl_single_url_resilient.json` (`Normalize Firecrawl Output`).

---

## DEC-038 — Production Smoke-Test Patch: Diagnostics Preservation, Compact Repair, 33 English Columns

**Date:** 2026-06-06
**Context:** First manual production smoke test (competitor website record) failed: primary parse failed, the Repair API returned **502 Bad Gateway / upstream_error**, the row went to `technical_errors`, and `raw_response_preview` showed only the repair error — the primary raw response was lost, making diagnosis impossible.

**Decisions:**
1. **`technical_errors` rows must preserve both failure stages.** `parse_error` = `Primary: <primary error> | Repair: <repair error>` (≤800). `raw_response_preview` keeps the **primary** raw response first (≤500), appending the repair error only if space remains. The primary raw response is never overwritten by the repair error alone. `Parse Primary JSON` now always emits `primary_parse_error`, `primary_raw_response_preview`, `content_summary`, `original_record`; `Parse Repaired JSON` reads them back via `$('Parse Primary JSON')`.
2. **Compact repair payload to reduce gateway 502 risk.** Repair request: trimmed `original_record` (essential fields, `text_context`≤500), `primary_raw_response_preview`≤500, `primary_parse_error`≤300, compact schema + enum summary, `max_tokens=700`, `temperature=0`. System prompt opens "You are a JSON repair formatter, not a market analyst…". No tool_use, no KEY=VALUE.
3. **Production schema is 33 English machine columns** (25 core + 8 technical). Every Sheets tab uses exactly this header. **Russian/human display names are deferred to the Telegram/reporting layer** — they are not part of the internal schema, and the Sheets headers must stay English.
4. **`parse_method=technical_error`** is used when repair fails (distinct from `primary_json` / `repaired_json` success values).
5. **Primary prompt reminder** added (short): JSON-only output, and classify competitor-website records as `competitor` when they offer secured lending services/rates/speed/contact/Moscow-MO coverage. No methodology bloat, no format experiment.
6. **No new workflow copy** — patched in place (validation passed). Firecrawl stays blocked until the patched production smoke test passes.

**Verification:** `python3 -m json.tool` VALID; output schema still exactly 33 fields; leakage scan shows no test/mock/tool_use/KEY=VALUE; logic simulation of primary-fail + repair-502 chain produces a `technical_errors` row carrying both errors and the primary raw preview (33 fields).

**File:** `n8n/workflows/02_claude_api_single_record_v2_resilient_router_production.json` (patched).

---

## DEC-037 — Production Resilient Workflow Strips Test Fields; Test Harness Retained as Evidence

**Date:** 2026-06-06
**Context:** Tests A–E passed on the dynamic-sheet test harness. The harness writes 14 test-only columns (`test_id`, `expected_*`, `actual_*`, `test_pass_basic`, `test_notes`, `source_record_type`) plus mock-mode logic — correct for testing, wrong for production tabs.

**Decision:**
1. **Create a separate production workflow** `02_claude_api_single_record_v2_resilient_router_production.json` (name: `... RESILIENT ROUTER PRODUCTION`). It removes `Set Test Selector`, `Select Test Record`, `IF Skip Primary API?`, all mock-mode logic (`mock_markdown`, `mock_unrepairable`), and every test-only output field. Production emits exactly **33 fields = 25 core + 8 technical**.
2. **Production input** is a single `Set Source Record` node with a safe placeholder (`source_url=https://example.com/source`, `text_context=PLACEHOLDER_TEXT_REPLACE_BEFORE_RUN`, `parsed_at={{ $today }}`) until a scraper is connected.
3. **Test harness retained** (`..._resilient_router_test_dynamic_sheet.json`) as A–E evidence — not the production artifact.
4. **Obsolete Switch-based workflows removed** via `git rm`: `..._resilient_router_test.json` (Switch v3) and `..._resilient_router_test_fixed.json` (Switch v1). Superseded by dynamic-sheet routing (DEC-035).
5. **`repair_used` and `repair_status` retained** as production technical fields — they tell the operator whether the JSON Repair Formatter ran and whether it succeeded, which is operationally important for trust and cost.
6. **`raw_response_preview` capped at 500 chars** in production (was 1200 in the harness) — enough for debugging, not too wide for Sheets, reduces noise/leakage.
7. **`recommended_action` normalized to the route** in `Normalize + Route`: results→contact (lead), review_queue→investigate (unless lead contact & score≥70), monitor_queue→monitor (competitor), technical_errors/skipped_log→ignore, content_queue→create_content (unless a stronger action is justified).
8. **`source_url` is the first v0.1 dedup key.** No dedup column yet; a future scraper workflow should check existing `source_url` before append. Any future `dedup_key` column requires a documented justification and a matching schema/header update.

**Verification:** logic simulation of production `Normalize + Route` — A→results/contact/pts_loan, B→review_queue/investigate/secured_auto_loan, C→monitor_queue/monitor/`МФО / частный кредитор`, D→results/contact/pts_loan, E→technical_errors/ignore, skip→skipped_log/ignore; all emit exactly 33 fields. `python3 -m json.tool` VALID. No test/mock/tool_use/KEY=VALUE leakage.

**Files:** `n8n/workflows/02_claude_api_single_record_v2_resilient_router_production.json` (created); two Switch workflows removed. active=false, placeholders only, no real secrets.

---

## DEC-036 — Routing Priority Fix + service_type/company_name Normalization (Post Tests A–E)

**Date:** 2026-06-06
**Context:** Dynamic-sheet resilient router Tests A–E were run. A, C, D, E passed. **Test B failed business intent:** a weak/potential lead with clear product fit was classified (via repair) as `content_idea` and routed to `content_queue`. Two secondary gaps surfaced: Test C had empty `company_name` for a competitor MFO, and Test D's repaired `service_type` came back as free text (`"займ под залог ПТС"`) instead of an enum.

**Decision:** Patch `Normalize + Route` only (no prompt change, no architecture change, no new workflow copy):

1. **Routing priority** (strict order): technical_errors → business-skip/irrelevant → hot lead (`results`) → **weak/potential lead (`review_queue`)** → competitor (`monitor_queue`) → pure content idea (`content_queue`) → fallback `review_queue`. The weak-lead rule runs **before** content_queue.

2. **Weak/potential lead rule** → `review_queue` if ANY: entity=lead_signal with lead_signal_score 30–69; OR recommended_action=investigate; OR (lead_signal_score≥30 AND source_type in [social, classified] AND text mentions loan/collateral/PTS/auto/real-estate/refinancing); OR (entity=content_idea AND lead_signal_score≥30 AND source_type in [social, classified] AND service_type≠unknown).

3. **content_queue** only if entity=content_idea AND content_idea_score≥50 AND the weak-lead rule did not match.

4. **service_type normalization** to enum: птс/pts→`pts_loan`; авто/машин + collateral→`secured_auto_loan`; недвиж/квартир/дом/земл→`secured_real_estate_loan`; рефинанс→`refinancing`; ипотек→`mortgage_adjacent`; бизнес→`generic_lending` (or `secured_real_estate_loan` only if real-estate collateral explicit); else `unknown`. Already-valid enums pass through unchanged.

5. **company_name descriptive fallback** (competitor, when empty): МФО/микрофинанс/mfo→`МФО / частный кредитор`; частный инвестор→`Частный инвестор`; автоломбард→`Автоломбард`; брокер→`Брокер`; otherwise `Конкурент без бренда`. Never invents a brand.

6. **Test-pass logic:** for `expected_route=review_queue`, pass = (route=review_queue AND needs_manual_review=true AND lead_signal_score≥30) — route-focused, since entity may legitimately differ after repair. Other routes keep strict entity match.

**Verification:** logic simulation confirmed A→results, B→review_queue, C→monitor_queue (company_name=`МФО / частный кредитор`), D→results (service_type=`pts_loan`); all `test_pass_basic=true`.

**Retest required:** Test B (live), then optional A/D smoke. C/E paths unchanged.

**File:** `n8n/workflows/02_claude_api_single_record_v2_resilient_router_test_dynamic_sheet.json` (Normalize + Route node only). active=false, no real secrets.

---

## DEC-035 — Dynamic Google Sheets Routing Replaces Switch by Route

**Date:** 2026-06-06
**Context:** The Switch by Route node (6 outputs → 6 separate Google Sheets Append nodes) caused recurring visual/import problems in the n8n UI: append nodes shifted position, connection lines from Switch did not render reliably, and the six near-identical Append nodes were redundant. Two prior attempts (`_test.json` typeVersion 3 rules-mode, `_fixed.json` typeVersion 1 string-match) both imported but left a cluttered, hard-to-read canvas.

**Decision:** Replace the Switch by Route node and the six per-tab Append nodes with a **single dynamic Google Sheets Append Row node**. The `route` field already contains the exact target tab name (`results`, `review_queue`, `monitor_queue`, `content_queue`, `skipped_log`, `technical_errors`), so the node uses Sheet Name expression `={{ $json.route }}` with Map Automatically. `Normalize + Route` connects directly to this one node.

**Routing logic unchanged.** All thresholds and priority ordering stay in `Normalize + Route`. Only the n8n destination implementation changed: 7 nodes (1 Switch + 6 Append) → 1 node.

**Route-validation safety added to `Normalize + Route`:** if `route` is missing or not one of the six valid values, the node forces `route = technical_errors`, `processing_status = technical_error`, `needs_manual_review = true`, and appends `invalid_route` to `parse_error`. No record can be lost to a bad/empty tab name.

**Fallback:** if a given n8n build rejects an expression in the Google Sheets Sheet Name resourceLocator, revert to branch-based routing — six IF nodes (one per `route` value), each feeding a fixed-tab Append node — using `_fixed.json` as the base. Documented in `docs/N8N_WORKFLOW_02_RESILIENT_ROUTER_TEST_RU.md`.

**Credential/secret pattern unchanged:** `PASTE_CREDENTIAL_ID_HERE`, `PASTE_SPREADSHEET_ID_HERE`, credentials by name only. active=false.

**File:** `n8n/workflows/02_claude_api_single_record_v2_resilient_router_test_dynamic_sheet.json`
**Supersedes (for testing):** `_test.json` and `_fixed.json` (kept as history, not deleted).

---

## DEC-034 — Resilient Router TEST HARNESS: 21-Node Workflow with Mock Modes

**Date:** 2026-06-06
**Context:** Building a testable harness for the Resilient Output Layer (DEC-033) without requiring real scraped data or live API calls for negative tests.
**Decision:** The TEST HARNESS uses three mock modes in Select Test Record:
- `none` — real Primary Claude API call (Tests A, B, C)
- `mock_markdown` — bypasses primary API; feeds a simulated Markdown response to Repair Formatter (Test D)
- `mock_unrepairable` — bypasses primary API; feeds an unreadable response; Parse Repaired JSON checks `mock_mode` and forces `processing_status=technical_error`, `route=technical_errors` regardless of repair output (Test E)

Repair API is still called for Test E (unavoidable — the mock bypass is in Parse Repaired JSON, not before the HTTP node). One extra API call for Test E is acceptable — costs ~$0.001.

IF Skip Primary API? checks `skip_primary_api === true` and routes True → Build Repair Request, False → Claude Primary API Request. The HTTP body strips `skip_primary_api` via explicit field selection in body expression so Anthropic API does not receive unknown parameters.

Normalize + Route passes through confirmed `technical_error` records without re-routing. For all others it validates entity_type and recommended_action against allowed enum sets, clamps scores 1–100, and applies routing thresholds. Test assertion fields (`test_pass_basic`, `test_notes`, `expected_route`) are output alongside business fields for easy review in Sheets.

**Credential pattern:** `PASTE_CREDENTIAL_ID_HERE` for both httpHeaderAuth and googleApi in all relevant nodes. `PASTE_SPREADSHEET_ID_HERE` for all 6 Append nodes. No real secrets in file.

**File:** `n8n/workflows/02_claude_api_single_record_v2_resilient_router_test.json`
**Guide:** `docs/N8N_WORKFLOW_02_RESILIENT_ROUTER_TEST_RU.md`

---

## DEC-033 — Resilient Output Layer: Two-Pass Parse + Repair + Multi-Tab Router

**Date:** 2026-06-06
**Context:** Extended tests 9–12 confirmed that the single-step Claude JSON output is structurally unstable for non-obvious records:
- Test 9 (Instagram competitor): no `text` item in content array — thinking-only response.
- Test 10 (Avito refinancing): Claude returned Markdown analysis block instead of JSON.
- Test 11 (weak website competitor): Claude returned Markdown analysis block instead of JSON.
- Test 12 (out-of-region SPb lead): invalid JSON structure.
- Test 5 (content_idea): JSON.parse failure from unescaped characters in string fields.

In all cases, Claude's reasoning was sound. The failures were output serialization failures, not reasoning failures.

Five output strategy experiments (v2.0 raw JSON, v2.1 safety rules, v2.2 tool_use, v2.3–v2.5 KEY=VALUE) all failed — either from gateway 502 constraints or from parsing edge cases. Further prompt-level format experiments are not expected to eliminate the failure mode.

**Decision:** Replace the single-step output architecture with a Resilient Output Layer:
1. **Primary parse:** attempt JSON.parse on Claude's natural output (baseline behavior unchanged).
2. **Repair pass:** on parse failure, send the raw response to a dedicated JSON Repair Formatter (a second Claude call, Haiku model, ~400-char strict schema-only prompt). Reformats without re-analyzing. Does not add new facts.
3. **Multi-tab Router:** replaces the binary Quality Gate. Routes to 6 Google Sheets tabs: `results`, `review_queue`, `monitor_queue`, `content_queue`, `skipped_log`, `technical_errors`.

**Three output states defined:**
- `parsed_success`: machine-parseable on first attempt.
- `technical_error`: unparseable even after repair.
- `business_skip`: correctly parsed; Claude determined record is not actionable.

**tool_use status:** Deferred — gateway returns 502 for `tools`/`tool_choice` parameters.
**KEY=VALUE status:** Deferred — v2.3–v2.5 all returned 502 from gateway at various prompt sizes.

**Applies to:** Workflow 02 TEST HARNESS (Phase 1). After Tests A–E pass, migrate to production Workflow 02. All future output layers in this project should use the two-pass pattern.

**Design spec:** `docs/WORKFLOW_02_RESILIENT_OUTPUT_LAYER.md`

---

## DEC-032 — Telegram Control Bot Is Future Roadmap, Not Current MVP

**Date:** 2026-06-05
**Decision:** An operator Telegram Control Bot (Stage 2.5 in ROADMAP.md) is added to the project plan but is not part of the current MVP scope. It requires: (1) at least one stable real scraping source, (2) Workflow 02 approved for production, (3) Telegram Webhook configured in n8n. Building the bot before the data pipeline is stable would create an interface with nothing to interface. Prioritize real source testing first.
**Applies to:** All session planning. Do not start bot implementation until Step E (Firecrawl) is complete and approved.

---

## DEC-031 — Do Not Repeat Proven Tests; Extend with Business-Priority Scenarios

**Date:** 2026-06-05
**Decision:** Tests 1–7 were designed to cover basic classification correctness. Test 1 confirmed the baseline works strongly. Rather than re-running all 7 tests (which would cost ~$0.10 and mostly repeat confirmed behavior), the extended test set (8–12) covers the uncle's actual business priorities: Telegram hot leads, Instagram competitors, Avito refinancing, website weak signal, and out-of-region cap. These scenarios are more representative of real scraping output and cover edge cases not exercised in the original 7-test set.
**Applies to:** Workflow 02 v2 testing. After extended tests pass, close this testing stage.

---

## DEC-030 — Content Automation Deferred to Stage 3 (Content Agent)

**Date:** 2026-06-05
**Decision:** `content_idea` records are not production-approved for Workflow 02. The current Quality Gate (status=analyzed AND quality_score≥60) passes content_idea records to Google Sheets, but the schema has no dedicated column or review process for them. They create noise in the leads/competitors table. Content intelligence is deferred to Stage 3 (Content Agent) with a separate Sheets tab, separate Quality Gate, and separate n8n branch. Extended tests 8–12 do not include content_idea scenarios.
**Applies to:** Workflow 02 configuration and all future Quality Gate decisions until Stage 3 is designed.

---

## DEC-029 — Baseline Raw JSON Is the Working Fallback; v2.1–v2.5 Experiments Deferred

**Date:** 2026-06-05
**Context:** The d350069 baseline raw JSON harness works: Test 1 passed (entity_type=lead_signal, recommended_action=contact, quality_score=97, lead_signal_score=98). The v2.1–v2.5 experiments all failed or were unstable:
- v2.1: JSON.parse failures on Test 1 and Test 5.
- v2.2: Gateway 502 on tool_use.
- v2.3: Gateway 502 at 9.2 KB.
- v2.4: Gateway 502 at 5.3 KB.
- v2.5 MICRO: curl still returned 502 at ~2 KB.
All 502 failures happened after Test 1 passed on the baseline — the gateway can handle the baseline payload.
**Decision:** The baseline raw JSON harness (d350069) is the current working approach. The v2.1–v2.5 experiment files are preserved in the repository but are not the active test path. The immediate task is to fix the only known baseline failure point: Test 5 (`content_idea` with long text that produced JSON.parse errors). A shortened Test 5 is the smallest possible change to validate before approving the baseline.
**Rationale:** Incrementally fixing the baseline is lower-risk than chasing gateway compatibility with experimental output formats that all returned 502. The gateway clearly handles the baseline payload — the only remaining question is whether Claude produces valid JSON for the shortened Test 5 text.
**Next step:** Run `02_claude_api_single_record_v2_baseline_short_test5.json` with test_id=5 first. If it passes, run test_id=1 to confirm baseline is unaffected. Then decide whether to approve the baseline for production.
**Applies to:** Prompt v2 test strategy until gateway constraints are resolved or a direct Anthropic API endpoint is available.

---

## DEC-028 — Micro-Sized Runtime Prompts Required; Detailed Methodology Stays in Docs Only

**Date:** 2026-06-05
**Context:** v2.4 compact prompt (5.3 KB / 5343 chars) still returned 502 upstream_error from the gateway. Minimal curl with a very small prompt continues to work. Conclusion: the gateway cannot reliably handle even moderately sized prompts — the threshold is well below 5 KB.
**Decision:** Strip runtime prompts to the absolute minimum — essential rules, enums, field limits, and output format only. Target: 1500–2200 chars (~1.5–2 KB). All detailed methodology (ICP description, evidence rules, anti-hallucination prose, full skip rules) is preserved in the canonical prompt file (`MARKETING_AGENT_PROMPT_V2.md`) for reference and debugging, but is NOT included in the runtime prompt sent to Claude.
**v2.5 MICRO changes:**
- System prompt: 5343 chars (v2.4) → 1997 chars (v2.5). −63%.
- max_tokens: 700 → 450. Sufficient for 25 KEY=VALUE lines.
- User message: removed profile_url (not needed for core analysis).
- Field limits tightened: offer_text 140→80, text_context 220→100, detected_need 160→100, reason 220→120.
**Long-term posture:** Detailed agent prompts and tool_use are deferred until an official Anthropic API endpoint or a verified-stable gateway is confirmed. Micro prompt is the production approach for this gateway. If scoring quality is insufficient, restore sections one at a time and retest.
**If 502 persists with v2.5 MICRO:** The issue is NOT prompt size. Check gateway balance (402 masks as 502), per-minute rate limits, or account-level routing. Run raw curl from VPS with the full v2.5 payload to isolate n8n from gateway.
**Applies to:** All Claude API calls via aiprimetech.io until gateway constraints are resolved or a different gateway is adopted.

---

## DEC-027 — Compact Prompts Required for Stable Gateway Execution

**Date:** 2026-06-05
**Context:** v2.3 used the correct KEY=VALUE line protocol (resolves JSON parsing failures) but still returned 502 Bad Gateway on Test 1. The prompt was 9.2 KB. A minimal curl with a short prompt to the same gateway and same model works correctly. Conclusion: the gateway has request-size or processing-time constraints that cause 502 for large payloads. The failure is not network-level or credential-level.
**Decision:** Use compact prompts for all Claude API calls via this gateway. Target: ≤6 KB system prompt. Specific reductions in v2.4:
- System prompt: 9.2 KB → 5.3 KB (same business logic, rewrote all sections for brevity).
- max_tokens: 1100 → 700 (line protocol responses are short; 700 is sufficient for 25 KEY=VALUE lines plus field content).
- temperature: kept at 0.1.
- Field char limits tightened: offer_text 180→140, detected_need 220→160, text_context 300→220, reason 350→220.
**If 502 persists with v2.4 compact prompt:** the issue is not prompt size. Check gateway balance (402 can be masked as 502), model routing, or per-minute rate limits. Do a raw curl from the VPS to isolate n8n vs. gateway.
**Long-term:** If an official Anthropic API endpoint or a verified-compatible gateway becomes available, restore full prompt length and re-evaluate tool_use (DEC-025). Compact prompt is a workaround for the current gateway constraint.
**Applies to:** All Claude API calls via aiprimetech.io until gateway constraints are clarified.

---

## DEC-026 — KEY=VALUE Line Protocol for Claude Output (Gateway Does Not Support tool_use)

**Date:** 2026-06-05
**Context:** Three output strategies failed or were unavailable:
1. v2.0/v2.1: Raw JSON text. Claude put unescaped quotes or colons inside field values (`offer_text`, `reason`, `detected_need`), breaking `JSON.parse`. Prompt-level rules and Parse-node cleanup reduced but did not eliminate failures.
2. v2.2: Anthropic tool_use structured output. The gateway (aiprimetech.io) returned 502 Bad Gateway for all requests containing `tools` and `tool_choice` parameters. tool_use is not supported by this gateway.
   Also discovered: Select Test Record node was not connected to Build Claude Request v2.2 in the generated workflow JSON (stale connection key from node rename). Entire test chain was broken.
**Decision:** Use plain text KEY=VALUE line protocol. Claude returns exactly 25 lines in order: `field_name=value`. The n8n Parse node (`Parse Claude Line Response`) splits each line on the first `=` character and assembles a JS object. No `JSON.parse` is called on Claude's output. Integer fields are parsed with `parseInt` and clamped to 1–100. Enum fields are validated; invalid values fall back to safe defaults. Parse failures are caught deterministically: if fewer than 5 fields are found, `parse_method=line_failed` is returned.
**Workflow fix:** All connections rebuilt from scratch in the Python generation script. The broken connection bug is resolved. The connection chain is now explicit and verified at build time.
**Build parameters changed:** `max_tokens` 1400 → 1100; `temperature` 0.2 → 0.1; no `tools`; no `tool_choice`. User message appended with `\n\nReturn KEY=VALUE lines only.` for reinforcement.
**Known edge case:** If Claude returns a value containing `=` (e.g. in `terms` field), the parser takes everything before the first `=` as the key and everything after as the value. The prompt instructs Claude to avoid `=` inside values. This is acceptable for MVP.
**Applies to:** TEST HARNESS v2.3. If a gateway supporting tool_use becomes available, DEC-025 strategy is preferred and should be re-evaluated at that point.

---

## DEC-025 — tool_use Structured Output Is the Preferred Architecture for Claude API Integration

**Date:** 2026-06-05
**Context:** Raw JSON text output from Claude failed JSON.parse in production twice across two prompt versions:
- v2.0: Test 5 (content_idea) — Claude put colons and quotes inside `offer_text` string value.
- v2.1: Test 1 (strong lead) — Claude put unescaped content inside `reason` or `detected_need` string value.
Prompt-level instructions (JSON SAFETY RULES) and Parse-node-level cleanup (brace extraction, smart-quote normalization) reduced but did not eliminate the failure mode. The root cause is that any Russian text field containing a period, quote, or colon adjacent to other JSON syntax will break `JSON.parse` if Claude serializes incorrectly.
**Decision:** Use Anthropic Messages API `tool_use` structured output instead of asking Claude to write JSON text. The API request includes:
1. `tools`: array with one tool definition `return_marketing_analysis` containing a full JSON Schema (25 fields, `additionalProperties: false`).
2. `tool_choice: { type: "tool", name: "return_marketing_analysis" }` to force the call.
Claude fills schema fields directly. The API serializes the result — Claude never writes raw JSON string values containing quotes or escape sequences. The Parse node reads `content.find(c => c.type === "tool_use" && c.name === "return_marketing_analysis").input` directly as a plain JS object.
**Text fallback retained:** The old text parser remains as a fallback path (`parse_method=text_fallback`) in case the gateway (aiprimetech.io) strips `tools`/`tool_choice` parameters before passing to Claude. If all 7 tests return `text_fallback`, the gateway does not support tool_use and a different solution is needed.
**Parse method field:** The Parse node now outputs `parse_method` = "tool_use" | "text_fallback" | "text_failed" | "none" for observability.
**Prompt changes:** Removed JSON SAFETY RULES, OUTPUT FORMAT, and REQUIRED JSON SCHEMA sections. Added FIELD CONSTRAINTS and OUTPUT INSTRUCTION sections. Business logic unchanged.
**Applies to:** All Claude API integrations in this project from v2.2 onward. If the gateway supports tool_use, prefer it over raw text output for all structured data extraction.

---

## DEC-024 — Prompt v2 Cannot Be Approved If Any Expected-Analyzed Record Fails JSON Parsing

**Date:** 2026-06-05
**Context:** Test 5 (content_idea record) failed with a JSON.parse error in the Parse node during the first full test run. Tests 1, 2, 3, 4, 6, 7 passed. The failure was caused by Claude returning unescaped double quotes or colons inside the `offer_text` string value — a well-formed reasoning response but invalid JSON output.
**Decision:** A JSON parse failure on any record that is expected to return `status=analyzed` is an automatic blocker for Prompt v2 approval. Prompt must be patched and the failing test rerun before the full suite can be approved.
**Rationale:** A parse failure means the output cannot be written to Google Sheets and cannot be used by any downstream system. A prompt that passes 6/7 tests on reasoning quality but produces unparseable output on the 7th is not production-ready. Parse errors are not acceptable in a data pipeline.
**Fix applied in v2.1:** JSON SAFETY RULES section added to prompt; offer_text and detected_need field instructions tightened; Parse node upgraded with brace extraction and smart-quote normalization as a defensive backstop.
**Trigger to unblock:** Rerun Test 5 after v2.1 patch; confirm JSON.parse succeeds and `offer_text` is a plain-text angle (no leading labels, no internal quotation marks, ≤180 chars).

---

## DEC-023 — Prompt v2 Testing: Use TEST HARNESS Workflow, Not Manual Node Editing

**Date:** 2026-06-05
**Context:** The original plan for testing Prompt v2 was to duplicate Workflow 02, manually paste the new prompt into the Build Claude Request Code node, and manually change the Set node fields for each of the 7 test records. This requires 7 manual Set-node edits per run and risks introduction of copy-paste errors.
**Decision:** Use a dedicated importable test harness workflow (`02_claude_api_single_record_v2_test_harness.json`) that has Prompt v2 and all 7 test records pre-embedded. The operator changes only a single `test_id` integer (1–7) to select each record. No manual prompt pasting or code editing required.
**Benefits:** Reproducible, error-resistant, keeps the production Workflow 02 untouched, the harness can be re-imported from Git if accidentally broken in n8n UI.
**Gate unchanged:** The production Workflow 02 is still updated only after all test criteria pass and the operator gives explicit approval.

---

## DEC-022 — Prompt v2 Schema: No New Columns Until v2 Is Validated in Production

**Date:** 2026-06-05
**Context:** The Prompt v2 plan (`MARKETING_AGENT_PROMPT_V2_PLAN.md`) defines four new output fields: `competitor_threat_summary`, `content_angle`, `urgency_indicator`, `icp_fit`. These would provide richer intelligence but require Google Sheets schema changes (new columns), updated n8n output mapping, and re-import of the workflow JSON.
**Decision:** Prompt v2 will use the same 25-field schema as Prompt v1. No new columns are added until v2 passes the 7-record synthetic test, is approved by the operator, runs successfully on real scraped data, and the operator confirms the additional fields are worth the added complexity.
**The new fields are documented as planned** in `MARKETING_AGENT_PROMPT_V2.md` (Planned Future Fields section) and will be implemented in schema v2.1+ after production validation.
**Rationale:** Adding columns before the schema is stable is technical debt. The priority is getting v2 reasoning quality validated, not expanding the output surface area.
**Trigger to add new fields:** v2 is in stable production use (≥ 20 real scraped records analyzed); operator reviews output and confirms new fields are needed.

---

## DEC-021 — No Paid Scraping Until Prompt v2 Is Ready and Business Requirements Are Clarified

**Date:** 2026-06-05
**Context:** Milestone Review 02 identified that Marketing Agent Prompt v1 is an extractor/classifier, not a marketing analyst. It also confirmed that the operator's uncle's specific business requirements (which platforms, which outputs, which actions matter) have not been discussed. Starting paid Apify or Firecrawl scraping before these two things are resolved will produce low-value outputs and waste the limited test budget.
**Decision:** Do not start any paid web scraping (Apify, Firecrawl) until BOTH of the following are done:
1. Marketing Agent Prompt v2 is written, tested against synthetic records, and approved by the operator
2. The operator's uncle has confirmed what business outputs and target platforms he actually needs
**Rationale:** The $5 Claude API test budget and unknown Firecrawl/Apify free tier limits are finite. Burning them on v1 prompt + wrong targets is waste. The infrastructure is now proven. The next investment is in prompt and requirements quality.
**Trigger to unblock:** Operator confirms uncle's requirements in writing (even a brief bullet list) AND v2 prompt passes the 5-record synthetic test described in `MARKETING_AGENT_PROMPT_V2_PLAN.md`.
**Alternatives considered:** Proceed with scraping immediately to generate real data for prompt improvement (rejected — real data costs money; synthetic test records are sufficient for prompt iteration).

---

## DEC-020 — Prompt Duplication in v0.1: Embedded + File Source

**Date:** 2026-06-05
**Context:** The active Marketing Scout Agent system prompt exists in two places simultaneously: embedded as a JavaScript string inside the `Build Claude Request` Code node in `02_claude_api_single_record_analysis.json`, and as the canonical source file `modules/marketing-scout-v0/MARKETING_AGENT_PROMPT_V1.md`. These can diverge silently if one is updated without the other.
**Decision:** For v0.1 this duplication is acceptable — it avoids the complexity of runtime prompt loading (from a file, n8n variable, or external service). `MARKETING_AGENT_PROMPT_V1.md` is the **canonical source**. When the prompt changes, both the file and the Code node must be updated in the same session. The Code node text takes precedence at runtime.
**Future:** v0.2+ will move prompt loading to an n8n variable, a static file served locally, or an n8n credential field, so the workflow JSON contains only a reference, not the full text.
**Alternatives considered:** Storing prompt in n8n environment variable (deferred — requires n8n config change and a code node read pattern not yet tested).

---

## DEC-019 — Marketing Scout Agent: Scoring Scale Changed to 1–100

**Date:** 2026-06-05
**Context:** The original SYSTEM_PROMPT.md used a 0–10 scoring scale for quality_score, lead_signal_score, content_idea_score, and competitor_strength. For Workflow 02, the scoring scale was upgraded to 1–100 to provide finer granularity and enable more precise quality gating. The Quality Gate IF node uses threshold >= 60 (equivalent to ~6/10 in the old scale).
**Decision:** All scores in MARKETING_AGENT_PROMPT_V1.md and Workflow 02 use integers 1–100. The old SYSTEM_PROMPT.md retains the 0–10 scale as a legacy draft; MARKETING_AGENT_PROMPT_V1.md is the active prompt for all workflows from v02 onward.
**Quality gate threshold:** quality_score >= 60 passes to Google Sheets; below 60 discarded.
**Alternatives considered:** Keep 0–10 scale (rejected — too coarse for differentiated filtering at scale).

---

## DEC-018 — Claude API Gateway: Auth Format, Model ID, and Response Parsing

**Date:** 2026-06-05
**Context:** The project uses a Claude-compatible API gateway at `https://aiprimetech.io` rather than the official Anthropic endpoint. A compatibility test was run from the VPS to confirm auth format, model ID naming, and response structure.
**Decision:**
- Base URL: `https://aiprimetech.io`, endpoint `/v1/messages`
- Auth: `Authorization: Bearer <token>` (HTTP Header Auth in n8n)
- Working model ID: `claude-sonnet-4-6` (hyphen-dot notation — `claude-sonnet-4.6` with a literal dot returns "No available accounts")
- n8n credential name: `Claude API - Marketing Scout`
- Response parsing: do NOT use `content[0].text` — the response may include a `thinking` block before the text block. Always select the content item where `type == "text"`:
  ```javascript
  const content = $json.content.find(c => c.type === 'text');
  const parsed = JSON.parse(content.text);
  ```
- System prompt must include an explicit instruction to return raw JSON only — no markdown, no code fences. Without this, Claude may wrap output in triple-backtick blocks that break `JSON.parse`.
- API key must remain only in the n8n credential manager — never committed to any project file.
**Alternatives considered:** Official Anthropic endpoint (available as fallback — same auth format, same model IDs).

---

## DEC-017 — Google Sheets Headers: Single Row 1, Horizontal Only

**Date:** 2026-06-04
**Context:** During Workflow 01 testing, the Google Sheet was initially created with field names
entered vertically in column A (rows 1–25) instead of horizontally in row 1 (columns A–Y).
n8n's `autoMapInputData` mode matches fields by column header name in row 1 — it does not read
vertical headers. The rows 2–25 had to be deleted, leaving only the horizontal header row 1.
**Decision:** The Google Sheet `results` must have exactly one header row: row 1, columns A–Y,
with field names matching the output of the Code/Claude node exactly (case-sensitive).
All data rows start at row 2. No vertical layouts, no merged cells in the header.
**How to fix if broken:** Delete rows 2–25 in Google Sheets if they contain field names in column A;
keep only row 1 with horizontal headers.
**Alternatives considered:** Using `defineBelow` column mapping in n8n (deferred — adds maintenance burden when schema changes).

---

## DEC-016 — Google Sheets Integration: Service Account, Not OAuth2

**Date:** 2026-06-04
**Context:** n8n supports two authentication methods for Google Sheets: OAuth2 (browser-based)
and Service Account (key file). OAuth2 requires a browser redirect during credential setup,
which is cumbersome via SSH tunnel. Service Account credentials are created once using a JSON key
file and do not require interactive browser flow.
**Decision:** Use Google Service Account (`googleApi` credential type in n8n) for Google Sheets
in all v0.1 workflows. The service account email must be added as Editor to the target spreadsheet.
**Credential name convention:** `Google Sheets - Marketing Scout Service Account`
**Alternatives considered:** OAuth2 (deferred — requires browser redirect, adds setup friction in SSH-only environment).

---

## DEC-015 — n8n Workflow Delivery via Generated JSON (Confirmed)

**Date:** 2026-06-04
**Context:** Workflow 00 (Healthcheck Manual Test) was generated as a JSON file by Claude Code,
committed to the project repo, and imported into n8n by the operator. The workflow executed
successfully on first import with no manual node editing required.
**Decision:** All future n8n workflows will be delivered as importable JSON files committed
to `n8n/workflows/`. The operator imports via **Workflows → ⋮ → Import from File** or clipboard.
Manual node-by-node construction in the UI is the fallback only if JSON import fails.
**Confirmed path:** Claude Code → `n8n/workflows/*.json` → GitHub → n8n Import → execution.
**Workflow 00 baseline:** `n8n/workflows/00_healthcheck_manual_test.json` must not be modified —
it serves as the healthcheck reference to verify the platform is functioning.
**Alternatives considered:** Manual UI construction (retained as fallback); n8n API push (deferred — requires additional credentials).

---

## DEC-014 — Execution Pruning Enabled at Launch

**Date:** 2026-06-04
**Context:** VPS disk is tight (~1.4G free, 86% used after n8n launch). n8n stores execution
history in its SQLite database by default, which grows unboundedly.
**Decision:** Execution pruning configured in `n8n.env` at deployment time:
`EXECUTIONS_DATA_PRUNE=true`, `EXECUTIONS_DATA_MAX_AGE=168` (7 days), `EXECUTIONS_DATA_PRUNE_MAX_COUNT=1000`.
This caps history to the last 7 days or 1000 executions, whichever is hit first.
**Alternatives considered:** Disable pruning and rely on manual cleanup (rejected — too easy to forget on a constrained disk).

---

## DEC-013 — VPS Disk Constraint Acknowledged; Upgrade Deferred

**Date:** 2026-06-04
**Context:** After n8n launch, VPS disk is at ~86% used with ~1.4G free.
This is sufficient for MVP (no high-volume scraping yet), but leaves little headroom.
**Decision:** Proceed with current VPS for v0.1 MVP. Plan a disk upgrade or VPS tier change
before running high-volume Apify scrape jobs or accumulating significant execution history.
Do not run large scrapes without checking free disk first.
**Trigger for upgrade:** Disk usage exceeds 90%, or before any run expected to produce >500 items.
**Alternatives considered:** Immediate upgrade (deferred — no pressing need before first workflow test).

---

## DEC-012 — Real Credentials Stay Outside Git

**Date:** 2026-06-04
**Context:** n8n requires an encryption key and may later hold API tokens via env file.
**Decision:** `n8n.env` and any `docker-compose.yml` containing real values are never committed
to Git. Only `.example` template files are versioned. The encryption key is generated once on
the VPS and stored only in the live `n8n.env` file outside the project directory.
**Alternatives considered:** `.env` in repo with `.gitignore` (rejected — risk of accidental commit).

---

## DEC-011 — No Public Domain or HTTPS for v0.1

**Date:** 2026-06-04
**Context:** v0.1 is a manual, operator-only pipeline. Public access is not required.
Setting up a reverse proxy and TLS certificate adds setup time before the pipeline is proven.
**Decision:** n8n has no public domain or HTTPS in v0.1. All access is via SSH tunnel.
Public HTTPS will be added when a specific technical requirement arises: Apify/Telegram webhooks,
Google OAuth redirect URI, or remote monitoring.
**Alternatives considered:** Caddy with auto-TLS from day one (rejected — unnecessary complexity for v0.1).

---

## DEC-010 — n8n Bound to localhost, Accessed via SSH Tunnel

**Date:** 2026-06-04
**Context:** n8n must not be exposed to the public internet in v0.1. The operator is the only user.
**Decision:** n8n is bound to `127.0.0.1:5678` in the Docker Compose port mapping.
Access is via SSH tunnel: `ssh -L 5678:127.0.0.1:5678 root@SERVER_IP`.
This eliminates the need for firewall rules, TLS, or authentication hardening for v0.1.
**Alternatives considered:** Bind to `0.0.0.0:5678` with firewall rule (rejected — accidental exposure risk if firewall misconfigured).

---

## DEC-009 — Docker Compose Installed Manually (Not via apt)

**Date:** 2026-06-04
**Context:** `apt install docker-compose-plugin` failed — package not found on this VPS.
Docker Engine (v29.1.3) was already present with 3 running containers and 39 images.
**Decision:** Docker Compose v5.1.2 was installed manually as a CLI plugin:
`/usr/local/lib/docker/cli-plugins/docker-compose`
Used as `docker compose` (plugin syntax).
**Impact:** On any server migration, rebuild, or fresh OS install, Docker Compose must be
reinstalled manually from the official Docker GitHub releases page. It will not be present
after a standard apt Docker install.
**Safety note:** Do not run `docker system prune` or destructive Docker cleanup without
explicit operator approval — existing containers are actively running.
**Alternatives considered:** `docker-compose` standalone binary (rejected — plugin syntax preferred; standalone is deprecated).

---

## DEC-008 — v0.1 Apify Integration: Simple Start + Wait + Fetch

**Date:** 2026-06-04
**Context:** Apify actor runs are asynchronous. A proper polling loop or webhook callback
requires additional n8n nodes and error handling logic — too complex for the first working version.
**Decision:** v0.1 uses a simple three-step pattern: POST to start the actor run → Wait node
(30–60 sec fixed delay) → GET dataset items. If the dataset is empty, the operator waits
and manually re-triggers the fetch node. No automated retry logic in v0.1.
**Future:** v0.2 will implement a polling loop (check run status → loop until SUCCEEDED)
or an Apify webhook that triggers n8n on completion.
**Alternatives considered:** Polling loop in v0.1 (rejected — adds complexity before basic pipeline is proven).

---

## DEC-007 — Public HTTPS/Domain Deferred Until Required

**Date:** 2026-06-04
**Context:** n8n does not need inbound public access for a manual, operator-run pipeline.
Setting up a reverse proxy (nginx/Caddy) and TLS certificate adds setup time and
introduces attack surface before the pipeline even works.
**Decision:** Public HTTPS and a domain name are deferred until they become technically required —
specifically when Apify/Telegram webhooks need to call n8n, or when Google OAuth requires
a verified redirect URI. Until then, all n8n access is via SSH tunnel.
**Alternatives considered:** Set up nginx + Let's Encrypt from day one (rejected — unnecessary for v0.1).

---

## DEC-006 — n8n Accessed via SSH Tunnel in v0.1 (No Public Domain)

**Date:** 2026-06-04
**Context:** The VPS is a production machine. Exposing n8n on a public port without
authentication hardening and HTTPS creates unnecessary security risk for a tool still under development.
**Decision:** n8n UI is accessed exclusively via SSH port forwarding during v0.1:
`ssh -L 5678:localhost:5678 user@vps-ip` → open `http://localhost:5678` locally.
No public port, no domain, no reverse proxy required for MVP.
**Alternatives considered:** Direct public port exposure (rejected — security risk); VPN (deferred as overkill for one operator).

---

## DEC-005 — English for Technical Files

**Date:** 2026-06-04
**Context:** Project files may be reviewed by tools, collaborators, or future agents.
**Decision:** All technical documentation files are written in English.
Russian permitted in informal operator notes only.
**Alternatives considered:** Russian-first (rejected — limits tool compatibility and future sharing).

---

## DEC-004 — Secrets Stay Out of Project Files

**Date:** 2026-06-04
**Context:** Project files will eventually be version-controlled on GitHub.
**Decision:** No real API keys, tokens, or passwords in any project file.
All example/config files use placeholder strings (`YOUR_API_KEY_HERE`).
Credentials live only in n8n's built-in credential manager.
**Alternatives considered:** `.env` files with `.gitignore` (rejected for v0.1 — adds complexity before Git is set up).

---

## DEC-003 — Stack Locked for v0.1

**Date:** 2026-06-04
**Context:** Risk of scope creep before first working pipeline.
**Decision:** v0.1 stack is fixed: n8n + Apify/Firecrawl + Claude API + Google Sheets + Telegram.
No new tools without explicit operator approval.
**Alternatives considered:** Adding Notion, Airtable, or Slack (deferred to later stages).

---

## DEC-002 — Plan-Before-Code Workflow

**Date:** 2026-06-04
**Context:** Operator is iterative and wants control over all changes.
**Decision:** Engineering agent always shows a plan and gets explicit approval before
creating or editing any file. No silent file creation.
**Alternatives considered:** Auto-create files (rejected — removes operator oversight).

---

## DEC-001 — Lightweight Architecture (No External Agent Frameworks)

**Date:** 2026-06-04
**Context:** Operator is learning. External frameworks (LangChain, CrewAI, AutoGen) add
complexity, hide mechanics, and are harder to debug on a VPS.
**Decision:** Custom lightweight structure using only Markdown files and Claude Code.
Agents are roles defined in docs, not running processes or SDK objects.
**Alternatives considered:** LangChain, CrewAI (rejected — too heavy for learning context and VPS resources).
