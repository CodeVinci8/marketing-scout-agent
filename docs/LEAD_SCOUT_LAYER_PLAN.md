# LEAD_SCOUT_LAYER_PLAN.md — Stage 3.5 Lead Scout Foundation (NEXT ACTIVE BUILD)

**Status:** ✅ **STAGE 3.5 — LEAD SCOUT FOUNDATION = BUILT (deterministic, fixture-validated, $0).** Live VK
lead-source path is **implemented + gated (inert)**; its runtime verification is `PENDING_STAGE_C_ACCEPTANCE`.
Public lead signals only, manual review, **no auto-outreach** (`outreach_allowed=false` always). No Claude is
called by this layer (Claude enrichment = Stage 4 / Phase D, after Stage 3.5 + the Stage C Acceptance Pack).
**Date:** 2026-06-17 · **Decisions:** **DEC-139 (Stage 3.5 Lead Scout BUILT — WF14 v0.3 engine + WF13 VK lead
source + WF12 lead block + public_lead_signals v0.3)**, **DEC-138 (LOCKED A/B/C/D; Stage 3.5)**, DEC-098 (no
outreach), DEC-112 (Claude in report/control layer), DEC-130 (public lead signal layer), DEC-131 (quota-safe
triage), DEC-133/135 (post-level relevance), CONTACT_AND_OUTREACH_POLICY (binding).

> **Architecture decision (DEC-139):** **no separate WF16 connector.** WF13 is already the VK public source on
> the shared `raw_market_records` contract, and WF14 is already the lead-triage layer — duplicating either would
> fragment the source layer and create two lead engines. Instead: **WF13** = VK public *lead* source (consumer-demand
> detection + gated `wall.get`/`wall.getComments`), **WF14 v0.3** = the central deterministic Lead Scout
> triage+scoring engine, **WF12** = lead report block. The competitor branch (WF08/WF10/WF12 competitor sections)
> is untouched, so lead flows do not pollute competitor intelligence. (Options A/B/C considered; this is A refined.)
**Related:** `docs/PUBLIC_LEAD_SIGNAL_LAYER.md`, `docs/LEAD_DATA_MODEL_PLAN.md`,
`docs/LEAD_DISCOVERY_ARCHITECTURE.md`, `docs/N8N_WORKFLOW_14_PUBLIC_LEAD_SIGNAL_TRIAGE_RU.md`,
`docs/TABLE_SCHEMA.md`, `docs/STAGE_4_REPORT_AND_CLAUDE_LAYER.md`.

---

## 0. Why this exists

Marketing Scout must not stay a competitor analyzer only. The same public-source pipeline that feeds competitor
intelligence also surfaces **public demand signals** — people publicly asking for credit/refinancing after a
refusal, with bad credit history, needing pledge/ПТС loans, etc. The Lead Scout layer turns those public
signals into a **manager-reviewable lead list**. It is an intelligence layer, **not** an outreach engine.

**Hard frame (non-negotiable):**
- Public lead signals **only**; public evidence **only**.
- **No auto-outreach.** Ever. Manager decides and acts manually.
- Public phone / username / profile URL may be **stored** only if explicitly visible in public content,
  always with `source_url` + `extracted_at`.
- Stored public contact evidence is **NOT** permission to message/call. `contact_use_policy` stays
  `manual_review` or `aggregate_only`.
- **No** inference of hidden/private contacts. No member extraction. No private-group scraping. (Current MVP.)

---

## 1. Source strategy (priority order)

**Stage 3.5 source priority (LOCKED order, DEC-138):**

1. **VK public comments / discussions / reviews — first priority.** Richest explicit public demand
   ("дайте кредит после отказа", "плохая КИ, нужен залог").
2. **Banki.ru / forums / Q&A** — refinancing, refusal, debt, pledge discussion boards.
3. **Public reviews / complaints / questions** (maps, Zoon, marketplaces) — dissatisfaction = switch intent.
4. **Telegram public comments / groups — later / high-risk.** Demand under broker posts; **no** MTProto, **no**
   member extraction, **no** private-group scraping in MVP.
5. **Avito — mostly competitor / source evidence, NOT a primary consumer lead source** unless explicit public
   lead signals appear in the listing/contact content.

| Tier | Source | Lead value | Status / risk |
|------|--------|-----------|---------------|
| Now (deterministic) | Existing connector output already in `raw_market_records` (Avito WF09, Telegram public WF11, VK public WF13) | public questions/objections/intent already collected | ✅ available — WF14 triages it today |
| Next (high value) | **VK public comments / discussions / Q&A** | richest explicit demand ("дайте кредит после отказа", "плохая КИ, нужен залог") | Stage 3 expansion — own approval + VK credential |
| Next | **Banki.ru / forums / Q&A / public discussion boards** | refinancing, refusal, debt, pledge questions | new connector, own approval |
| Next | **Reviews / complaints / questions** (maps, Zoon, marketplaces) | dissatisfaction with current broker = switch intent | new connector, own approval |
| Later (high-risk) | **Telegram public comments / groups** | demand under broker posts | future high-risk extension — no MTProto/members in MVP |

**Lead-intent vocabulary (credit_brokerage):** credit after refusal, bad credit history (плохая КИ),
refinancing (рефинансирование), pledge / ПТС / залог, business credit, mortgage approval help, debt
consolidation, urgent cash need. These are *intent markers* used for scoring (§4), not auto-actions.

---

## 2. Pipeline (reuses current workflows)

```
lead source connector (WF09/WF11/WF13 + future VK-comments/forum connector)
  → raw_market_records (+ market_record_registry dedup)
  → WF08 deterministic touchpoint analysis  +  WF14 public lead signal triage
  → public_lead_signals (manager-readable; scored; status=new)
  → MANAGER REVIEW (confirm / dismiss / mark contacted-manually)
  → WF12 report "Аудитория и публичные лид-сигналы" block (aggregate-only, no contacts in report)
  → [Stage 4.1] selective Claude enrichment of chosen lead signals only
  → [Stage 5] Telegram Business Agent surfaces aggregate counts + manual-review reminder
```

No step in this pipeline messages or calls a lead. WF14 stays quota-safe (DEC-131): single-read,
scoped/capped candidate pool, capped batched append, deterministic-hash dedup.

---

## 3. Public contact handling (fields)

Stored on `public_lead_signals` rows (see TABLE_SCHEMA `public_lead_signals`; this plan defines the
contact-evidence contract):

| Field | Rule |
|-------|------|
| `contact_phone` / `contact_username` / `contact_profile_url` / `public_handle` | only if **verbatim** visible in public content; Sheets-safe (DEC-124, leading `'` on phone-like values) |
| `source_url` | **mandatory** when any contact field is set — where the evidence was publicly visible |
| `source_platform` | avito / telegram / vk / forum / reviews |
| `extracted_at` | ISO 8601 MSK |
| `evidence_text` | short verbatim public snippet justifying the signal (no edits, no inference) |
| `contact_confidence` | 0–100 — strength that this contact belongs to the signal author |
| `status` | `new` / `confirmed` / `dismissed` / `manual_contacted` |
| `contact_use_policy` | `manual_review` (default) or `aggregate_only` — **never** an auto-action flag |
| `recommended_action` | always a **manual** instruction (e.g. "manager review"); never "send message" |

If contact is not explicitly public → leave contact fields empty; the signal is still valuable as an
aggregate demand data point (`contact_use_policy=aggregate_only`).

---

## 3a. Canonical lead-signal fields (Stage 3.5)

Each lead signal row carries:

**Evidence / contact (public, verbatim only):**
- `phone` — only if explicitly public; Sheets-safe leading `'` on phone-like values (DEC-124)
- `username` — public handle, only if explicitly public
- `profile_url` — public profile link, only if explicitly public
- `source_url` — **mandatory** where the evidence was publicly visible (always set when any contact field is set)
- `evidence_text` — short verbatim public snippet justifying the signal (no edits, no inference)
- `extracted_at` — ISO 8601 MSK

**Scoring / classification:**
- `lead_score` — deterministic 0–100 (Claude refines later, Stage 4)
- `urgency` — deadline / "срочно" / repeated asks
- `intent` — explicit request to apply/buy vs general discussion
- `pain` — refusal / bad КИ / debt / pledge need
- `niche_fit` — credit_brokerage relevance (post-level evidence, DEC-133/135)
- `source_confidence` — platform/source reliability (sc_rules)
- `contact_confidence` — 0–100, strength that the contact belongs to the signal author
- `contact_use_policy` — ∈ **{manual_review, aggregate_only, do_not_use}**; **never** an auto-action flag
  (`do_not_use` = contact present but no public source URL → blanked)
- `review_priority` — ∈ **{high, medium, low, ignore}**, faithfully mirrors `score_band` (default `min_lead_score=25`
  filters ignore-band before write, so `ignore` is not emitted unless lowered)

> **Canonical column names (audit alignment, DEC-140):** the conceptual names above map to the **47-col
> `public_lead_signals` v0.3** headers in `TABLE_SCHEMA.md` §G — `phone→public_phone`, `username→public_username`,
> `profile_url→public_profile_url`, `source_url→contact_source_url`, `intent→intent_type`, `pain→pain_type`,
> `urgency→urgency` (0–100 number). **Timestamps are `created_at` (write/append time) / `updated_at` / `extracted_at`
> — there is no `append_timestamp`/`timestamp_appended` column.**

## 3b. Status workflow (Stage 3.5)

A lead signal moves through this status set:

`new` → `needs_review` → `accepted` / `rejected` / `duplicate` / `stale`

- `new` — just written by triage, not yet looked at.
- `needs_review` — queued for manager review.
- `accepted` — manager confirmed it is a real, actionable public lead signal (manual action only).
- `rejected` — manager dismissed it (not a real lead / not in niche).
- `duplicate` — same author/evidence already captured (deterministic-hash dedup, DEC-131).
- `stale` — too old / no longer actionable.

No status transition triggers contact. Acceptance is a **manager decision**; the agent never auto-contacts.

---

## 4. Lead scoring (deterministic core; Claude refines later)

`lead_score` (0–100) is a deterministic weighted sum, fully reproducible:

- **urgency** — "срочно", deadline language, repeated asks
- **intent** — explicit request to buy/apply vs general discussion
- **pain** — refusal / bad КИ / debt / pledge need (niche-fit pains weigh higher)
- **fit to niche** — credit_brokerage relevance (post-level evidence, DEC-133/135)
- **contact evidence presence** — public contact verbatim present (+confidence)
- **freshness** — recency of the public post
- **source confidence** — platform/source reliability (sc_rules)

Thresholds: `min_signal_score` gates what WF14 writes (already configurable, DEC-131). Scoring weights live
in one config block so they are auditable and tunable without code spread.

---

## 5. Safety invariants

- No auto-outreach (DEC-098). No message/call generation. No CRM push that triggers contact.
- No hidden/private data; no inferred contacts; no member extraction; no private-group scraping (MVP).
- Contacts only verbatim from public text, always with `source_url` + `extracted_at`.
- Manager decision only; the agent proposes, the human acts.
- Reports remain **aggregate-only** for audience/lead data (no contacts surfaced in WF12 output).
- `active=false`, manual trigger, fixture-first, $0 by default — same as every connector.

---

## 6. Stage 4 integration (Claude enrichment — selective)

Stage 4.1 Claude enrichment improves lead **scoring/extraction** for **selected** lead signals only
(ambiguous intent, unclear pain, offer/objection decomposition) — never the whole raw dump, always
budget-gated and cost/token-logged (see `STAGE_4_REPORT_AND_CLAUDE_LAYER.md`). Stage 4.2 WF12 explains lead
opportunities in normal business language (aggregate; no contacts).

## 7. Stage 5 integration (Telegram Business Agent)

The agent may report demand in plain language, e.g.:

> «Нашёл 4 публичных сигнала спроса. Это не разрешение на автоматический контакт. Рекомендую ручную проверку
> менеджером.»

It never auto-contacts and never exposes raw contacts in chat; it surfaces counts + a manual-review pointer.

---

## 8. Build order (each step its own approval)

1. **Now / $0:** keep WF14 producing `public_lead_signals` from existing connector output; add the scoring-weight
   config block + contact-evidence fields above; verify repeat-run dedup. (Deterministic, no external calls.)
2. **VK public-comments connector** (highest lead value) — fixture-first, own approval + VK credential.
3. **Forum / Q&A / reviews connector** — fixture-first, own approval.
4. **Stage 4.1 selective Claude enrichment** of chosen lead signals — budget-gated.
5. **Stage 5** conversational surfacing — aggregate + manual-review only.

---

## 9. Stage 4.1 Lead Scout enrichment requirements (prep only — DO NOT BUILD NOW)

These are the exact requirements Stage 4.1 (Claude Enrichment Core) must satisfy when it later enriches lead
signals. No lead connector and no enrichment are built in this patch.

**Inputs (existing, no new sheets):** selected `public_lead_signals` rows (status=new) + their `raw_market_records`
evidence; never the whole raw dump. Selection is operator/score-gated.

**Public contact evidence (binding):**
- Store `contact_phone` / `contact_username` / `contact_profile_url` **only if explicitly public** and verbatim
  in the source content (Sheets-safe per DEC-124).
- `contact_source_url` **required** whenever any contact field is set; `extracted_at` **required**.
- `contact_use_policy` ∈ {`manual_review`, `aggregate_only`} — **never** an auto-action flag.
- **No auto-outreach. No message/call generation. Manual review only.** No hidden/private/inferred contacts;
  no member extraction; no private-group scraping.

**Enrichment outputs (per selected lead signal):** `lead_score` (0–100) plus its components —
`urgency`, `intent`, `pain`, `fit_to_niche`, `freshness`, `source_confidence`, `contact_evidence_present` —
and a short RU rationale. Claude may **refine** the deterministic score and extract intent/pain, but must not
invent contacts, urgency, or evidence not present in the input.

**Controls (mandatory):** approval-gated + budget-gated (max_calls_per_run, max_tokens, est-cost guard before the
HTTP node) + cost/token logged to `agent_requests` + `COSTS_AND_LIMITS.md` + deterministic fallback when LLM is
disabled/over-budget/non-JSON + bounded repair (≤1) + selected-row only. Same guard model as WF12's Claude branch.

**Acceptance for Stage 4.1 lead enrichment:** on a small fixture set, enrichment runs only on selected rows,
produces scored fields + rationale, writes zero contacts not present verbatim in input, logs cost, and falls back
deterministically when the gate is closed.

---

## 10. Testing philosophy (Stage 3.5 — LOCKED, DEC-138)

- **No micro-tests after every node.** Do not stop to verify each node as it is added.
- **Full Stage 3.5 acceptance only after the complete build.** Build the lead layer end-to-end first, then run
  one deliberate acceptance pass.
- **Stage 3.5 acceptance pack:**
  1. **Fixture lead source** — deterministic fixture rows exercising the lead fields + status workflow ($0).
  2. **One controlled public source** — a single approved public source run (own approval + cost note), not a
     broad multi-source rollout.
  3. **WF14** — public lead signal triage produces scored `public_lead_signals` rows; repeat-run dedup holds.
  4. **WF12 lead block** — the report's "Аудитория и публичные лид-сигналы" block renders (aggregate-only, no
     contacts surfaced).
  5. **No-auto-outreach / contact-policy check** — confirm no message/call generation, contacts only verbatim
     from public text with `source_url` + `extracted_at`, `contact_use_policy` ∈ {`manual_review`,
     `aggregate_only`}, manager-decision-only.

This acceptance pack is part of the **Stage C Acceptance Pack** (Phase C of the LOCKED model), run after the
Stage 3.5 build — alongside the postponed Stage 2 paid/live website acceptance. Full plan:
`docs/STAGE_C_ACCEPTANCE_PACK.md`.

---

## 11. Implementation status (Stage 3.5 BUILT — DEC-139, 2026-06-17)

**Built this session (deterministic, `active=false`, $0, no external calls, fixture-validated):**

- **WF14 v0.3 — Lead Scout Triage & Scoring engine** (`14_..._triage.json`, renamed
  "Lead Scout Triage & Scoring"): reads `raw_market_records` audience rows (PRIMARY, decoupled from WF08) +
  `review_queue` (enrichment), each tab read once (quota-safe, DEC-131). Deterministic 0–100 scoring
  (intent25+urgency15+pain20+niche15+contact8+region7+freshness10 − penalties) → `lead_score`/`score_band`/
  `score_reasons`/`review_priority`/`recommended_action`. Public-contact extraction (phone/username/profile,
  verbatim only, `contact_source_url` mandatory, blanked + `do_not_use` when unprovable). Multi-key dedup
  (comment_url / post_url+texthash / profile+texthash / hash). Supplier/competitor-ad exclusion. Writes
  `public_lead_signals` v0.3 (47 cols) + `agent_requests`. Self-test in Final Summary
  (`read_once_ok`/`append_cap_ok`/`dedup_ok`/`policy_ok`). **Validated:** 61/61 fixture checks; repeat run = 0
  written + dedup.
- **WF13 v0.3 — VK public *lead* source** (`13_..._connector.json`, renamed "VK Public Discussion / Lead Source
  Connector"): consumer-demand detection routes public comments/posts (нужен кредит / под залог ПТС / для
  бизнеса / после отказа) to `question_objection` audience rows for the Lead Scout path; lead-rich synthetic
  fixtures; gated live `wall.get` **and** `wall.getComments` (inert HTTP placeholder + dual-shape parser;
  runtime = `PENDING_STAGE_C_ACCEPTANCE`).
- **WF12 — lead report block**: priority H/M/L counts, public-contact-evidence count + policy-hidden count,
  top-N **anonymized** lead summaries (band/score/intent/pain/action/excerpt — **no contacts ever surfaced**),
  manual-review + `outreach_allowed=false` statements. Tolerates v0.3 + old 28-col schema during migration.
- **Schema:** `public_lead_signals` v0.3 (47 cols, TABLE_SCHEMA §G) + migration mapping; validation lists 27–33
  + §3.6 dropdowns (GOOGLE_SHEETS_VALIDATION_PLAN). **WF15** source_family += `public_lead_source`/`lead_triage`.
- **Fixtures:** `n8n/fixtures/lead_scout/` (synthetic golden data; no real contacts).

**Not done in this patch (by policy):** any live VK/Telegram/Apify/Firecrawl/Claude call; activation; real
credentials/Spreadsheet IDs; auto-outreach; member/private-group extraction. Live VK lead capture +
end-to-end acceptance = **Stage C**.

## 12. VK live readiness classification (audit hardening, DEC-140)

**Status: `IMPLEMENTED_READY_FOR_STAGE_C`** — the live code path exists and is complete; only the runtime API
behaviour is `BLOCKED_BY_OPERATOR_CREDENTIALS_OR_LIVE_RUN`. No code path is missing.

What is already implemented in WF13 (verified this patch):
- **Fixture mode is the default and stays default** (`fixture_mode=true`, `live_mode=false`); `IF fixture_mode?`
  routes to the synthetic builder; $0.
- **Gated live path:** `LIVE VK Approval Gate` throws unless `live_approval_token=I_APPROVE_LIVE_VK_PUBLIC_DISCUSSION`
  **and** a non-empty `live_group_allowlist` (for `wall.get`) and/or `live_post_allowlist` (for `wall.getComments`).
- **Official public API only:** `wall.get` (public group walls) + `wall.getComments` (public post comments), API
  version `5.199`, `fetch_url=https://api.vk.com/method/...`. The gate **rejects** invite/`join`/private/`@`/`+`
  entries and non-`wall-<owner>_<post>` post URLs (allowlist-only, no crawling).
- **Two-key safety:** the HTTP node `Fetch VK Public Wall` ships **DISABLED** with `access_token` =
  `BIND_N8N_VK_CREDENTIAL_NEVER_PASTE_TOKEN` (placeholder — token is an **n8n credential**, never in JSON); the
  inert `Parse Live VK Items` **throws** if no API response, so no fabricated rows can enter the pipeline.
- **Caps:** `live_max_items_per_group ≤ 10`; 1–2 targets recommended on the first smoke.
- **Ledger:** every run appends one `live_source_runs` row and one `agent_requests` row; dedup via
  `market_record_registry` (`dedup_key`); failures route to the gate/parse throw, not to silent fabrication.
- **`active=false`.** No real token. No private/closed groups, no messages/friends/member lists, no hidden
  contacts, no auto-outreach (aggregate author counts only).

Exact operator setup for the live run (Stage C / C4):
1. **Token type:** a VK **standalone/service** app token with **read-only public wall** access (no review needed
   for public read). Bind it **only as an n8n credential**; never paste into the workflow JSON.
2. **Permissions:** public wall/comments read only. **Do NOT** request friends/messages/groups-management/offline scopes.
3. **Public objects:** set `live_group_allowlist` = 1–2 public group screen-names/URLs (for `wall.get`) and/or
   `live_post_allowlist` = 1–2 public post URLs `https://vk.com/wall-<owner>_<post>` (for `wall.getComments`).
4. **Tracked public VK sources** are exactly those allowlists (operator-controlled, capped) — no discovery crawl.
5. **Caps per run:** `live_max_items_per_group ≤ 10`; 1–2 targets first smoke.
6. **Rate/limit:** public `wall.get`/`wall.getComments` are **free** (no USD/call); exposure is VK rate limits
   (operational), not money. Record `cost_not_recovered` in COSTS if anything unexpected.
7. **Must NOT be collected:** private/closed groups, private messages, member/follower lists, friends graphs,
   hidden contacts, any non-public field. Contacts only if **verbatim public** in the post/comment text, always
   with `contact_source_url`. **No auto-outreach** — manager decision only.

Runtime verification of the actual VK API behaviour is the only thing deferred to Stage C.
