# STAGE_3_1_MANUAL_TOUCHPOINT_INTAKE_PLAN.md — Stage 3.1 Plan

**Status:** 🔧 BUILT, UNDER TEST (`n8n/workflows/07_manual_touchpoint_intake.json`, `active=false`).
**Stage:** 3.1 (Lead/Touchpoint Data Model + Manual Intake) of the Business Scout Agent.
**Date:** 2026-06-08
**Decision:** DEC-079. Guide: `docs/N8N_WORKFLOW_07_MANUAL_TOUCHPOINT_INTAKE_RU.md`.

---

## 1. What Stage 3.1 delivers

The **first safe intake workflow** for Social/Classified Touchpoint Discovery. Workflow 07 normalizes manually
provided, mixed-source example records into the shared **`raw_market_records`** (40 cols) and **dedup ledger**
`market_record_registry` (15 cols), and logs one **`agent_requests`** row (21 cols). **No parser, no analyzer,
no LLM, no scraping, no external API.**

## 2. Why manual intake comes BEFORE Avito/Telegram/Instagram parsers

1. **Validate the shared data model first.** Every future connector (Avito, Dzen, VK, Telegram, Instagram,
   competitor-audience) must emit the **same** `raw_market_records` shape. Proving those 40 columns + the
   composite `dedup_key` + the 12 record classes with **hand-picked** examples de-risks every later connector.
2. **Validate dedup before volume.** The non-URL composite `dedup_key` and `market_record_registry` are new.
   Manual intake exercises in-registry / in-batch / unique paths deterministically, with a re-run proving
   idempotent dedup — *before* a real source can flood the sheet.
3. **Zero source cost, zero source risk.** No ToS/anti-bot/privacy exposure, no spend. The riskiest sources
   (Telegram parser, competitor-audience mining) stay untouched until the data model is proven.
4. **Provides labeled fixtures for the analyzer.** The 12 records (4 competitor, 5 market signals, 1
   question/objection incl. a hot-lead control, 2 irrelevant) become the **golden input** for building and
   testing the Stage 3.2 Touchpoint Analyzer — without needing any live source.
5. **Separation of concerns (reaffirms the Stage 2 pattern).** Intake (this) → analysis (3.2) → routing are
   distinct. Connectors never analyze; the analyzer never scrapes. Manual intake is the cleanest possible
   "connector" to lock that contract.

## 3. Record set (12 manual examples)

Mixed by design to stress the classifier and dedup: Avito competitor listings, Dzen competitor channels/posts,
a VK public search (auth-gated → source candidate), Yandex Maps + Zoon reviews, two Telegram public channels
(source candidates), a Banki.ru forum thread (question/objection with a hot-lead pattern — positive control),
and two irrelevant decoys (`zen.com` fintech ≠ Дзен; a vague micro-business article).

## 4. Deterministic hints produced (no LLM)

`record_id`, `dedup_key`, `text_hash`, `region_hint`, `urgency_hint`, `lead_intent_hint`, `confidence_score`,
`lead_temperature`, `next_action`, `approval_status=new`, `dedup_status` (after registry lookup),
`estimated_analysis_cost_usd` (0.02 non-irrelevant / 0 irrelevant). These are **triage hints only**; the
authoritative classification waits for the Stage 3.2 analyzer.

## 5. Out of scope (explicitly not built here)
- No Avito/Dzen/VK/Telegram/Instagram parser or connector.
- No competitor-audience scraping.
- No Claude/LLM analysis (Stage 3.2).
- No Telegram Control Bot (Stage 4), no scheduling, no outreach.
- `agent_memory` is **not** written by Workflow 07.

## 6. Exit criteria → Stage 3.2
- First run writes 12 `raw_market_records`, ~12 unique registry rows, 1 `agent_requests` row, with the expected
  class/temperature distribution (incl. the record-11 hot control).
- Re-run proves idempotent dedup (all `duplicate_in_registry`, registry +0, raw_market_records +12 audit).
- Then design/build the **Touchpoint Analyzer (Stage 3.2)** over these records (source-agnostic, reusing the
  Stage 2 resilient analyzer; harden scoring + `lead_temperature` + `next_action`).
