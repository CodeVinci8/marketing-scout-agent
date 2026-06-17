# LEAD_SCOUT_LAYER_PLAN.md — Lead + Market Intelligence Agent (MVP Lead Layer)

**Status:** 📐 PLAN — concrete MVP lead layer on the **current** architecture. No new live sources, no Claude,
no outreach are authorized by this document. Builds on existing sheets/workflows.
**Date:** 2026-06-17 · **Decisions:** DEC-098 (no outreach), DEC-112 (Claude in report/control layer),
DEC-130 (public lead signal layer), DEC-131 (quota-safe triage), DEC-133/135 (post-level relevance),
CONTACT_AND_OUTREACH_POLICY (binding).
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
