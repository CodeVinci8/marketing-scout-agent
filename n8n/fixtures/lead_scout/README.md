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

Validation is run **once** as part of the **Stage C Acceptance Pack** (see `docs/STAGE_C_ACCEPTANCE_PACK.md`),
not as per-node micro-tests.
