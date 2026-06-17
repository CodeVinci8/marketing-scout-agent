# Lead Scout fixtures (Stage 3.5) — SYNTHETIC TEST DATA ONLY

These fixtures validate the deterministic **Lead Scout** path (WF13 → raw_market_records → WF14 → public_lead_signals)
**without any live API call**. They contain **no real people, no real phone numbers, no real profiles**.

- Phone numbers use the **non-routable `+7 000 …` prefix** (synthetic placeholders).
- Usernames/profile ids are `*_synthetic_*` / `*_fixture`.
- Group names carry the `_fixture` suffix.

## Files

- `lead_signals_fixtures.json` — golden fixture rows + expected classification/scoring/contact/policy outcomes
  for WF14 v0.3. Each `raw` block mirrors a `raw_market_records` audience row that a public source connector
  (WF13 VK) would write; `expect` documents the deterministic result.

## Scenarios covered

| id | scenario | must become a lead? |
|----|----------|---------------------|
| F1 | high-intent + synthetic public **username** | yes (high) |
| F2 | high-intent + synthetic public **phone** (под залог ПТС) | yes (high) |
| F3 | **question** without contact | yes (medium) |
| F4 | **complaint / fraud fear** | yes (content_idea) |
| F5 | **business finance** need | yes |
| F6 | **competitor broadcast** (broker ad) | **no** (supplier/competitor, excluded) |
| F7 | **generic market news** | **no** (no consumer demand) |
| F8 | **duplicate** of F1 | **no** (deduped) |
| F9 | **stale / low-confidence** | yes (low) |
| F10 | contact present but **no public source URL** | yes, but contact **blanked** → `do_not_use` |

## How they are used

- **WF13 fixture mode** (`fixture_mode=true`, $0): `Build Fixture VK Group Items` carries equivalent synthetic
  comments/posts; a fixture run writes them to `raw_market_records` for the Lead Scout path.
- **WF14 v0.3** reads those audience rows and produces scored `public_lead_signals` rows.
- Hard invariants asserted: deterministic bands, correct pain/intent, public-contact extraction with
  `contact_source_url`, contact blanking when unprovable, repeat-run dedup, and **`outreach_allowed=false` on every row**.

## Exact expected outcomes (deterministic; audit alignment, DEC-140)

Two fixture vectors exercise the same WF14 v0.3 engine. **Numbers below are derived from the actual WF13/WF14
Code nodes (local harness, $0), not invented.**

### A. Standalone 10-scenario file → WF14 (per-scenario classification proof)

Feed each `raw` block as a `raw_market_records` audience row; run WF14 once on an empty `public_lead_signals`.

| Metric | Value |
|--------|-------|
| total fixture scenarios | **10** (F1–F10) |
| candidates considered | 9 (F6 competitor broadcast excluded at read — non-audience) |
| **`signals_written`** | **7** |
| priority **high / medium / low / ignore** | **3 / 2 / 2 / 0** |
| `irrelevant_skipped` | 1 (F7 generic market news — no consumer demand) |
| `duplicates_skipped` | 1 (F8 in-batch duplicate of F1) |
| `supplier_skipped` | 0 (F6 is removed earlier, as a non-audience row) |
| **`contacts_found_public`** | **2** (F1 username, F2 phone — both **with** `contact_source_url`) |
| **`contacts_blank_due_to_policy`** | **1** (F10 — contact present but **no public source URL** → blanked, `contact_use_policy=do_not_use`, `privacy_flags=contact_blanked_no_source_url`) |
| `self_test_passed` | true |
| `outreach_allowed` | **FALSE on every written row** |

Written leads: F1 (high, username, manual_review), F2 (high, phone, manual_review), F10 (high, contact **blanked**),
F5 (medium, business_finance), F3 (medium, question), F4 (low, complaint → `content_idea`), F9 (low, stale, backfill).
**Skipped / blanked categories:** competitor broadcast = F6 (excluded), generic news = F7 (irrelevant), duplicate = F8
(deduped), stale/low-confidence = F9 (kept at low band by backfill), policy-risk contact blanking = F10.

### B. Operational path WF13 fixture → `raw_market_records` → WF14 (this is **Stage C check C3**)

WF13's internal fixture has **9 items**.

| Stage | Metric | Value |
|-------|--------|-------|
| WF13 | items_received | **9** |
| WF13 | hard_skipped | **1** (юр.адрес/регистрация ООО — hard negative) |
| WF13 | unique | **7** (5 consumer-demand comments + 1 competitor post + 1 market post) |
| WF13 | duplicate_in_batch | **1** (repeat comment) |
| WF13 | raw rows written | 8 (7 unique + 1 duplicate-audit row) |
| WF14 | candidates considered | 6 (5 demand comments + 1 market post; competitor post = non-audience) |
| WF14 | **`signals_written`** | **5** |
| WF14 | priority **high / medium / low** | **2 / 2 / 1** |
| WF14 | `irrelevant_skipped` | 1 (market-news post) |
| WF14 | `contacts_found_public` | 2 · `contacts_blank_due_to_policy` 0 |
| WF14 | repeat run | `signals_written=0`, `duplicates_skipped=5` |
| WF14 | `self_test_passed` | true · `outreach_allowed=FALSE` everywhere |

> The policy-blank invariant (`contacts_blank_due_to_policy`) is only exercised by vector **A / F10** — WF13's
> internal fixture has no "contact without a public source URL" item, so C3 shows `contacts_blank_due_to_policy=0`.

Validation is run **once** as part of the **Stage C Acceptance Pack** (see `docs/STAGE_C_ACCEPTANCE_PACK.md`),
not as per-node micro-tests.
