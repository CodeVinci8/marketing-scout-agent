# PUBLIC_LEAD_SIGNAL_LAYER.md — Public Lead Signal Layer (WF14 Lead Scout + `public_lead_signals`)

**Status:** ✅ **v0.3 Lead Scout engine BUILT, fixture/deterministic, $0 (2026-06-17, Stage 3.5).** ·
**Decisions:** DEC-130 (layer), **DEC-138 (LOCKED A/B/C/D)**, **DEC-139 (Lead Scout v0.3 engine)**
**Workflow:** `n8n/workflows/14_public_lead_signal_triage.json` (`active=false`, manual trigger; node "Build
Candidate Pool & Classify" = the scoring engine). **Source:** `13_..._connector.json` (VK public lead source).
**Related:** `LEAD_SCOUT_LAYER_PLAN.md`, `STAGE_C_ACCEPTANCE_PACK.md`, `TABLE_SCHEMA.md` (§G v0.3),
`CONTACT_AND_OUTREACH_POLICY.md` (binding), `N8N_WORKFLOW_14_PUBLIC_LEAD_SIGNAL_TRIAGE_RU.md`.

> **v0.3 (Stage 3.5):** WF14 is now a deterministic **scoring** engine (not just triage): reads
> `raw_market_records` audience rows as the PRIMARY source (decoupled from WF08) + `review_queue` enrichment;
> emits `public_lead_signals` v0.3 (47 cols) with `lead_score`/`score_band`/`review_priority`, split public-contact
> evidence, a review/status workflow, and `outreach_allowed=false` on every row. The classification below is the
> v0.3 canonical set.

---

## 1. Purpose

The pipeline already collects public audience voice (VK comments, forum-style questions, reviews) into
`review_queue` and `raw_market_records`, but a manager cannot work from those operator tables. The Public
Lead Signal Layer turns that public evidence into a **manager-readable triage table**: one row per public
signal, classified by pain and intent, scored deterministically, with an explicit non-outreach policy.

This is a *signal* layer, not a lead-generation/outreach layer.

## 2. Flow

```
WF13 VK public lead source (+ WF09/WF11) → raw_market_records (audience rows)
                                   ├──────────────► WF14 Lead Scout (PRIMARY: raw audience rows)
                                   └─ WF08 → review_queue ─► WF14 Lead Scout (enrichment)
                                          WF14 Lead Scout Triage & Scoring (deterministic, $0, no Claude)
                                                → public_lead_signals (47 cols, v0.3) + agent_requests
                                                → WF12 report "Аудитория и публичные лид-сигналы" block (aggregates + anonymized; NO contacts)
```
The Lead Scout path is **decoupled from WF08**: WF14 reads `raw_market_records` audience rows directly (so leads
are captured even before the competitor analyzer runs), and also consumes `review_queue` when present.

## 3. Classification (deterministic vocabulary v0.3, credit_brokerage)

- **pain_type (multi):** `bank_refusal` · `bad_credit_history` · `overdue_debt` · `refinancing_need` ·
  `mortgage_need` · `business_finance_need` · `pledge_auto_pts` · `broker_price_question` · `fraud_fear` ·
  `prepayment_fear` · `document_problem` · `unknown`
- **intent_type (one):** `question` · `objection` · `complaint` · `buying_intent` · `content_signal`
- **lead_score (0–100, deterministic):** weighted sum `intent25 + urgency15 + pain20 + niche15 + contact8 +
  region7 + freshness10 − penalties` → `score_band` (`high`≥75 / `medium`50–74 / `low`25–49 / `ignore`<25).
- **review_priority** ∈ **{high, medium, low, ignore}** — faithfully mirrors `score_band` (WF14 `priorityOf`). With
  the default `min_lead_score=25` (= `band_low`), ignore-band rows are filtered **before** write, so only
  `high`/`medium`/`low` are emitted in practice; `ignore` appears only if `min_lead_score` is lowered. Each row also
  carries `score_reasons` (component audit trail). Supplier/competitor-ad rows are excluded (a broker advertising is
  not a consumer lead).
- **recommended_action:** `manual_review` (questions/buying intent) · `content_idea` (objections/complaints —
  answer publicly, not DMs) · `monitor` · `ignore` (below threshold). **Never an outreach action;
  `outreach_allowed=false` always.**

## 4. Hard policy (binding, CONTACT_AND_OUTREACH_POLICY)

1. **Public evidence only.** Source rows already carry only public text; WF14 adds nothing.
2. **A public profile URL is evidence, not permission for outreach.** It exists so a manager can verify
   the signal in context — not to message the author.
3. `contact_public` only if it was verbatim in the public text upstream; written Sheets-safe (DEC-124).
4. `contact_use_policy` ∈ **{manual_review, aggregate_only, do_not_use}**: `manual_review` when a public contact
   exists **with** a public source URL (evidence anchor); `aggregate_only` when there is no contact; **`do_not_use`**
   when a contact appears but cannot be evidenced by a public source URL — the contact is then **blanked** and
   `privacy_flags=contact_blanked_no_source_url` (the "policy-risk blanking" case). A public contact is therefore
   only ever surfaced **with** `contact_source_url`.
5. No private chats, no hidden contacts, no member extraction, no mass "active people" lists, no
   auto-outreach — structurally impossible: WF14 writes only `public_lead_signals` + `agent_requests`.
6. Deterministic by default; no Claude calls; $0.
7. Dedup: multi-key (`source_comment_url` strongest, then `source_post_url`+text-hash, then profile+text-hash, then
   platform+text-hash) + a deterministic `lead_signal_id`; a signal is never written twice (repeat runs are no-ops).
   WF14 `splitCmt()` derives `source_comment_url` from a reply-anchored `post_url` (`…#reply<id>` / `?reply=<id>`),
   so **fixture and live rows for the same comment produce identical keys / `lead_signal_id`** (audit alignment, DEC-140).

## 5. Manager workflow (v0.3 review/status)

1. Open `public_lead_signals`, filter `review_status=new`, sort by `review_priority` (high first) / `lead_score`.
2. Read `evidence_excerpt` / `score_reasons`; open `source_comment_url` / `source_post_url` to verify in context.
3. Move the row through the status workflow (manual edit): `new` → `needs_review` →
   `accepted` / `rejected` / `duplicate` / `stale`. Use `manager_note` / `rejection_reason` / `duplicate_of`.
4. Use confirmed objections/questions as content/FAQ input (WF12 content actions). Any contact decision is a
   **human** decision under `contact_use_policy` (`manual_review`/`aggregate_only`/`do_not_use`) — the system
   never initiates contact; `outreach_allowed` is always `FALSE`.
