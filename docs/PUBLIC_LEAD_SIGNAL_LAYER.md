# PUBLIC_LEAD_SIGNAL_LAYER.md — Public Lead Signal Layer (WF14 + `public_lead_signals`)

**Status:** BUILT, fixture/deterministic only (2026-06-12) · **Decision:** DEC-130
**Workflow:** `n8n/workflows/14_public_lead_signal_triage.json` (`active=false`, manual trigger)
**Related:** `TABLE_SCHEMA.md` (§ public_lead_signals), `CONTACT_AND_OUTREACH_POLICY.md` (binding),
`LEAD_DISCOVERY_ARCHITECTURE.md`, `N8N_WORKFLOW_14_PUBLIC_LEAD_SIGNAL_TRIAGE_RU.md`.

---

## 1. Purpose

The pipeline already collects public audience voice (VK comments, forum-style questions, reviews) into
`review_queue` and `raw_market_records`, but a manager cannot work from those operator tables. The Public
Lead Signal Layer turns that public evidence into a **manager-readable triage table**: one row per public
signal, classified by pain and intent, scored deterministically, with an explicit non-outreach policy.

This is a *signal* layer, not a lead-generation/outreach layer.

## 2. Flow

```
WF09/WF11/WF13 connectors → raw_market_records → WF08 → review_queue
                                   └────────────┬─────────────┘
                                          WF14 Public Lead Signal Triage (deterministic, $0, no Claude)
                                                → public_lead_signals (28 cols) + agent_requests
                                                → WF12 report "Аудитория и публичные лид-сигналы" block (aggregates only)
```

## 3. Classification (deterministic keyword vocabulary v0.1, credit_brokerage)

- **pain_type (multi):** `after_refusal` · `bad_credit_history` · `overdue_debt` · `urgent_money_need` ·
  `prepayment_fear` · `fraud_fear` · `broker_price_question` · `mortgage_refinance_need` ·
  `business_finance_need`
- **intent_type (one):** `question` · `objection` · `complaint` · `buying_intent` · `content_signal`
- **scores (0–100, deterministic):** `urgency_score`, `intent_score`, `objection_score`
- **recommended_action:** `manual_review` (questions/buying intent) · `content_idea`
  (objections/complaints — answer publicly with content, not DMs) · `monitor`. **Never an outreach action.**

## 4. Hard policy (binding, CONTACT_AND_OUTREACH_POLICY)

1. **Public evidence only.** Source rows already carry only public text; WF14 adds nothing.
2. **A public profile URL is evidence, not permission for outreach.** It exists so a manager can verify
   the signal in context — not to message the author.
3. `contact_public` only if it was verbatim in the public text upstream; written Sheets-safe (DEC-124).
4. `contact_use_policy` defaults: `manual_review` when a public contact exists, `aggregate_only` otherwise.
5. No private chats, no hidden contacts, no member extraction, no mass "active people" lists, no
   auto-outreach — structurally impossible: WF14 writes only `public_lead_signals` + `agent_requests`.
6. Deterministic by default; no Claude calls; $0.
7. Dedup: a signal with the same `post_url` + text hash is never written twice (repeat runs are no-ops).

## 5. Manager workflow

1. Open `public_lead_signals`, filter `status=new`.
2. Read `text_evidence` / `evidence_note`; open `post_url` to verify in context.
3. Set `status` to `confirmed` / `dismissed` (manual edit); use confirmed objections/questions as
   content/FAQ input (see WF12 content actions). Any contact decision stays a human decision under
   `contact_use_policy` — the system never initiates contact.
