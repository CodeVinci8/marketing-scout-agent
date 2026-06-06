# AGENT_CAPABILITIES.md — Marketing Scout Agent Capabilities Reference

**Last updated:** 2026-06-06 (updated after full project review — `docs/PROJECT_REVIEW_03_RESILIENT_ROUTER.md`)
**Active agent version:** Marketing Scout Agent v2 (`MARKETING_AGENT_PROMPT_V2.md`, baseline d350069)
**Test status:** Resilient Router (dynamic-sheet) Tests A–E **all pass live**. B retest confirmed (`review_queue`, `primary_json`, lead≈38) after DEC-036 routing patch. Repair Formatter validated by Test D; technical_errors path validated by Test E.

## Currently Approved Capabilities (Post Tests A–E, 2026-06-06)

- **Two-pass resilient analysis** of a single Russian secured-lending record: Primary Claude → parse → conditional JSON repair → parse → normalize → route.
- **Six-way routing** via one dynamic Google Sheets node: `results`, `review_queue`, `monitor_queue`, `content_queue`, `skipped_log`, `technical_errors`.
- **Field hardening:** route validation (invalid → technical_errors), `service_type` enum normalization, `recommended_action` enum guard, competitor `company_name` descriptive fallback (DEC-036).
- **Failure isolation:** technical errors separated from business skips; `needs_manual_review` flag set.

**Not yet approved:** production resilient Workflow 02 (still a test harness with test-only columns), any real-source ingestion, multi-item/batch, `content_idea` production handling. See `docs/PROJECT_REVIEW_03_RESILIENT_ROUTER.md` §3–4.
**Business requirements:** `docs/BUSINESS_REQUIREMENTS.md`

---

## Confirmed Business Requirements (2026-06-05)

These facts were confirmed with the operator's uncle and must shape Prompt v2 and all scraping configuration:

| Dimension | Confirmed Value |
|-----------|----------------|
| Priority order | Lead signals → Competitors → Content ideas |
| Primary region | Moscow + Moscow Oblast |
| Core products | PTS loans, auto collateral, real estate collateral, refinancing |
| Top business sources | Telegram, Instagram, Avito, Yandex / competitor websites |
| Technical start sequence | Competitor websites → Avito → Telegram → Instagram |
| Action on strong lead | Contact / write to the person |
| Action on active competitor | Monitor |
| Useful row definition | Helps identify/contact a lead, monitor a competitor, or extract a content insight |

Full details: `docs/BUSINESS_REQUIREMENTS.md`.

---

## Current Infrastructure

| Component | Value |
|-----------|-------|
| Orchestration | n8n (self-hosted on VPS, accessed via SSH tunnel) |
| Claude gateway | `https://aiprimetech.io/v1/messages` |
| Model | `claude-sonnet-4-6` |
| Auth | HTTP Header Auth — `Authorization: Bearer <token>` |
| n8n credential name | `Claude API - Marketing Scout` |
| Storage | Google Sheets — `Marketing Scout Results`, sheet `results` |
| Google Sheets auth | Service Account — `Google Sheets - Marketing Scout Service Account` |

No API keys, tokens, or Spreadsheet IDs are stored in project files.

---

## Current Workflow Chain

```
Manual Trigger
    ↓
Set Test Competitor Data  (hardcoded test record for Workflow 02)
    ↓
Build Claude Request      (Code node — assembles /v1/messages body with system prompt)
    ↓
Claude API Request        (HTTP Request — POST to https://aiprimetech.io/v1/messages)
    ↓
Parse Claude JSON Response (Code node — finds type=text item, strips fences, JSON.parse)
    ↓
Quality Gate              (IF — status == "analyzed" AND quality_score >= 60)
    ↓ (true branch)
Append Row to Google Sheets
```

The false branch of Quality Gate currently ends silently. No Telegram notification exists yet.

---

## What Marketing Scout Agent v1 Can Do

- **Classify a market record** into one of five entity types: `competitor`, `lead_signal`, `market_signal`, `content_idea`, `irrelevant`
- **Identify the service type** from seven categories in the Russian secured lending market (PTS loans, auto loans, real estate loans, refinancing, etc.)
- **Extract structured fields** from unstructured Russian text: company name, region, offer text, terms, public contact info
- **Assess freshness** of the record based on `published_at` relative to `parsed_at`
- **Assign 1–100 scores** for quality, lead signal strength, content idea value, and competitor strength
- **Skip boilerplate** and low-quality records automatically (returns `status: skipped`, `quality_score: 1`)
- **Refuse to invent data** — returns empty string for fields that cannot be determined from the text
- **Return strict JSON** — the Parse node handles occasional markdown fence wrapping
- **Feed directly into Google Sheets** via the quality-gated append node

**Proven in Workflow 02 v2 (baseline d350069):**
- Test 1 (Авито, сильный лид, ПТС, Москва): `entity_type=lead_signal`, `recommended_action=contact`, `quality_score=97`, `lead_signal_score=98`. ✓
- Hot lead detection: confirmed working for urgent Moscow PTS/car collateral cases.
- Weak lead filtering, competitor classification, SEO skipping: confirmed in earlier baseline runs.
- Cautious edge-case handling: refinancing with uncertainty → investigate (not contact).
- Source/result traceability via `source_url` field.

**Current approved capabilities:**
1. **Hot lead detection** — identifies urgent, contactable, Moscow/MO PTS/auto leads with high scores.
2. **Weak lead filtering** — does not promote vague or low-urgency queries as hot leads.
3. **Competitor monitoring** — classifies active competitors with explicit offers; calibrates strength.
4. **SEO/navigation junk skipping** — returns `status=skipped`, `quality_score=1` for boilerplate.
5. **Cautious edge-case handling** — uses `investigate` for ambiguous signals rather than false-positive contact.
6. **Source/result traceability** — `source_url` written to Sheets for every analyzed record.

**Not production-approved yet:**
- `content_idea` classification: deferred to Stage 3 (Content Agent). Current Sheets schema has no content review process. See DEC-030.
- Telegram Control Bot: future roadmap stage. Not in current MVP. See ROADMAP.md.
- Workflow not connected to real scraping: all tests use synthetic records.
- Gateway stability: tool_use, KEY=VALUE line protocol, and compact prompts all returned 502 from current gateway. Baseline raw JSON is the only stable format.
- Output contract reliability: Tests 9–12 and 5 failed with JSON serialization errors (Markdown blocks, no-text responses, invalid JSON). Resilient Output Layer (two-pass repair + multi-tab routing) designed to fix this. See DEC-033 and `docs/WORKFLOW_02_RESILIENT_OUTPUT_LAYER.md`.

---

## What v1 Cannot Do Well

- **Reason like a marketing analyst.** v1 extracts and classifies; it does not reason about competitive positioning, client urgency fit, or what the operator should actually do next.
- **Assess competitive threat.** `competitor_strength` reflects brand quality, not threat to the specific operator. A weak competitor in the same micro-region can be more dangerous than a strong brand in another city.
- **Evaluate lead urgency with precision.** v1 notes urgency words but does not score a lead based on the three-axis model (product fit + urgency + readiness) needed for meaningful lead prioritization.
- **Propose content angles.** v1 can tag a record as `content_idea` but cannot propose the specific article title or content brief that would actually work for the target audience.
- **Handle ambiguous or adversarial records.** v1 has not been tested on genuinely messy real-world scraped data (duplicate listings, partial pages, multi-topic posts).
- **Know who the operator's target client is.** v1 has no ICP (Ideal Customer Profile) definition. It cannot distinguish a high-fit lead from a low-fit lead within the same product category.
- **Cite evidence for its scores.** The `reason` field is unstructured and often generic.
- **Process multiple items.** Workflow 02 is a single-record test. Multi-item pipeline behavior is unproven.

---

## What v2 Must Improve

Based on `docs/MILESTONE_REVIEW_02.md` Section 7, `MARKETING_AGENT_PROMPT_V2_PLAN.md`, and `docs/BUSINESS_REQUIREMENTS.md`:

1. **Priority order in reasoning** — lead signals first, competitors second, content ideas third (confirmed by uncle)
2. **Agent identity** — market intelligence analyst who reasons from business context, not a form-filler
3. **ICP definition** — car owner with PTS, Moscow / MO, bad credit likely, urgency is key; fast cash need
4. **Region filter** — Moscow / MO records score higher; out-of-region records are lower priority
5. **Product fit scoring** — PTS/auto > real estate > refinancing > other products
6. **Competitive threat model** — regional overlap + tactical USP + activity level → threat assessment sentence
7. **Lead urgency model** — fit × urgency × readiness → precise lead_signal_score with named urgency phrases
8. **Content angle output** — proposed article title or topic brief, not just a "content_idea" tag
9. **Structured `reason` field** — evidence sentence + score rationale + action rationale
10. **New fields** — `competitor_threat_summary`, `content_angle`, `urgency_indicator`, `icp_fit`
11. **Evidence requirement** — every score above 60 must cite a specific phrase from the source text

**Gate:** v2 must not be embedded in any workflow until it passes all 7 synthetic test criteria defined in `docs/N8N_WORKFLOW_02_V2_TEST_PLAN_RU.md` and is approved by the operator.

**v2 is written.** See `modules/marketing-scout-v0/MARKETING_AGENT_PROMPT_V2.md`.
**Test records ready.** See `modules/marketing-scout-v0/TEST_RECORDS_V2.md`.
**Test guide ready.** See `docs/N8N_WORKFLOW_02_V2_TEST_PLAN_RU.md`.

---

## Current Scoring Fields

All scores are integers on a **1–100 scale**.

| Field | What it measures | High (80–100) | Medium (40–59) | Low (1–19) |
|-------|-----------------|---------------|----------------|-----------|
| `quality_score` | Overall value and actionability | Rich data, clear signals, directly actionable | Partial data, incomplete context | Noise or boilerplate |
| `lead_signal_score` | Likelihood this is a potential client | Explicit need + urgency + product fit | Possible intent, ambiguous signals | No lead signal |
| `content_idea_score` | Value as content marketing inspiration | Specific, emotionally resonant pain point | Usable topic, needs development | No content value |
| `competitor_strength` | Assessed strength in the secured lending market | Strong brand, active marketing, clear pricing | Moderate presence, some activity | Not a competitor (set to 1) |

Quality gate threshold: `quality_score >= 60` to pass to Google Sheets.

---

## Current Output Schema

Fields written to Google Sheets on each successful analysis (25 columns):

```
created_at, source_type, platform, source_url, parsed_at, published_at,
freshness_status, entity_type, company_name, profile_name, profile_url,
region, service_type, offer_text, terms, contact_public, text_context,
detected_need, competitor_strength, lead_signal_score, content_idea_score,
quality_score, reason, recommended_action, status
```

Full schema: `docs/TABLE_SCHEMA.md`

`recommended_action` values: `monitor` / `contact` / `create_content` / `ignore` / `investigate`

`status` values: `analyzed` (processed normally) / `skipped` (boilerplate or low quality)

---

## Current Known Risks

| Risk | Severity | Status |
|------|----------|--------|
| content_idea not production-approved in Workflow 02 | Medium | Deferred to Stage 3 (Content Agent). DEC-030. |
| Gateway unstable for tool_use, KEY=VALUE, compact prompts | High | Baseline raw JSON is the only stable format. DEC-026–028. |
| Output contract unstable for non-obvious records | Medium | Resilient Output Layer (two-pass repair + dynamic-sheet routing) implemented and tested A–E. Repair validated by Test D, technical_errors by Test E. DEC-033/035/036. Production migration pending. |
| Business routing drift (weak lead misclassified as content) | Medium | Found in Test B; fixed in `Normalize + Route` with strict routing priority (DEC-036). Weak/potential leads now route to review_queue before content_queue. B retest pending. |
| Workflow not connected to real scraping | High | Extended tests use synthetic records. Real source test is Step E. |
| Telegram Control Bot not implemented | Low | Future roadmap (Stage 2.5). DEC-032. |
| No pre-filter node — all records hit Claude API | Medium | Design in progress. |
| Prompt duplication (Code node vs. file) | Medium | DEC-020 procedure documented. |
| Real page cost unknown (only short-record baseline) | Medium | Measure after first Firecrawl test. |
| Multi-item pipeline unproven | Medium | Will be tested in Workflow 03+. |
| .gitignore not audited before GitHub push | Low | Audit required before next push. |

---

## How to Explain Agent Capabilities to a Non-Technical Client

**What it does today:**

The system reads a description of a competitor or a potential client and asks an AI (Claude) to analyze it. The AI categorizes the record, scores how useful it is, and writes the result to a Google Sheets table. This takes about 2–3 seconds per record and costs less than 1 ruble each.

**What it can detect:**

- This is a competitor — here is what they offer, how strong they are, and whether you should watch them
- This person is looking for a loan — here is how urgent their need is and whether you should reach out
- This is a topic idea — here is what your audience is worried about and what you could write about

**What it cannot do yet:**

- It cannot search the internet on its own — you need to tell it where to look (Avito, VK, a competitor website)
- It cannot send you a message automatically yet — Telegram notifications are coming in a later version
- It is not yet tuned to the confirmed business priorities — a smarter v2 prompt is in design and will prioritize lead signals first, then competitors, then content ideas

**What makes it useful:**

Instead of reading hundreds of listings manually, the system reads them and gives you a prioritized table. You only review rows that scored above 60 — everything else is filtered out. Over time, as the prompt is improved, the quality of those rows will increase.

**Planned improvements:**

The current AI prompt is good but basic. We are designing a smarter version that understands your specific clients — who they are, what they need, and what makes a competitor dangerous to your business. That version will produce more useful scores and better action recommendations.
