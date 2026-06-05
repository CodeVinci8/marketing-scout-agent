# PROMPTS.md — Prompt Version Register

Tracks all Claude API prompt versions used in the pipeline.
Each version must be tested against synthetic records before embedding into a workflow.

**Last updated:** 2026-06-05 (v2 written; test records and test plan created)

---

## Active Prompt

**Module:** marketing-scout-v0
**Version:** v1.0
**File:** `modules/marketing-scout-v0/MARKETING_AGENT_PROMPT_V1.md`
**Status:** Active — confirmed working in Workflow 02 (2026-06-05)
**Model:** `claude-sonnet-4-6` via `https://aiprimetech.io/v1/messages`
**Domain:** Russian secured lending market intelligence

> **Duplication note (DEC-020):** This prompt text is also embedded inside the `Build Claude Request`
> Code node in `n8n/workflows/02_claude_api_single_record_analysis.json`. The file is the canonical
> source; the Code node is what runs at runtime. Update both on any change.

---

## Prompt v2 — Ready for Testing

**File:** `modules/marketing-scout-v0/MARKETING_AGENT_PROMPT_V2.md`
**Design plan:** `modules/marketing-scout-v0/MARKETING_AGENT_PROMPT_V2_PLAN.md`
**Status:** Written 2026-06-05 — awaiting synthetic test approval before embedding in workflow
**Test records:** `modules/marketing-scout-v0/TEST_RECORDS_V2.md` — 7 records
**Test guide:** `docs/N8N_WORKFLOW_02_V2_TEST_PLAN_RU.md`
**Schema changes:** None — same 25 output fields as v1

**Key improvements over v1:**
- Explicit priority order in reasoning: lead signals first → competitors second → content ideas third
- Confirmed ICP: Moscow car owner, bad credit, urgent cash need; PTS/auto > real estate > refinancing
- Region scoring rules: MO leads eligible for 60–100; out-of-region leads capped at 40
- Competitor threat framework: regional overlap + tactical USP + activity level → competitor_strength
- Lead urgency model: fit × urgency × readiness three-axis scoring with calibration anchors
- Content angle framing: `offer_text` for content_idea records = proposed article title, not source description
- Structured 3-sentence `reason` field: what (evidence) → why (scores) → next (action + urgency)
- Evidence citation required for any score above 60
- Anti-hallucination additions: brand knowledge firewall, rate inference prohibition, region inference restriction
- Expanded skip rules: category lists, contact-only blocks, legal pages, duplicate patterns

**Gate before use:** Must pass all 7 synthetic test criteria in `N8N_WORKFLOW_02_V2_TEST_PLAN_RU.md`.
Do not embed in any workflow without operator approval after test results are reviewed.

---

## Legacy / Superseded

**File:** `modules/marketing-scout-v0/SYSTEM_PROMPT.md`
**Version:** v0 (initial draft)
**Status:** Superseded by MARKETING_AGENT_PROMPT_V1.md — do not use
**Notes:** Generic marketing analyst prompt, 0–10 scoring, non-domain-specific entity types.

---

## Version History

| Version | File | Date | Status | Notes |
|---------|------|------|--------|-------|
| v0 (draft) | `SYSTEM_PROMPT.md` | 2026-06-04 | Superseded | Initial generic prompt, 0–10 scale, never tested in production |
| v1.0 | `MARKETING_AGENT_PROMPT_V1.md` | 2026-06-05 | Active | Secured lending domain, 1–100 scale, confirmed working in Workflow 02 |
| v2.0 | `MARKETING_AGENT_PROMPT_V2.md` | 2026-06-05 | Awaiting test approval | Analyst identity, confirmed ICP, competitive threat, lead urgency model, content angle framing, region rules |

---

## Prompt Evaluation Criteria

Before promoting a prompt version to active/production status:

1. **Coverage:** Does it populate all required output fields?
2. **Accuracy:** Are entity types, scores, and `detected_need` plausible for the input?
3. **Consistency:** Same input produces the same output category across multiple runs
4. **Format compliance:** Output is valid JSON matching the schema in `docs/TABLE_SCHEMA.md`
5. **Calibration:** `quality_score` distribution is reasonable — most records score 35–70; 80+ is exceptional
6. **Skip logic:** Boilerplate and short inputs correctly return `status: skipped` with `quality_score: 1`
7. **Anti-hallucination:** No invented contacts, prices, names, or regions not present in the source text
8. **Evidence:** `reason` field cites specific text evidence for the scores

Test against the 5-record synthetic test set described in `MARKETING_AGENT_PROMPT_V2_PLAN.md` Section 15 before marking any version as `active`.

---

## Prompt Engineering Notes

- **Token budget:** v1 system prompt is approximately 600–700 tokens. v2 is approximately 1 400–1 800 tokens (longer due to ICP, region rules, frameworks, and evidence requirements). Measure actual cost on first 7 test calls.
- **Scoring scale:** 1–100 integers. Do not revert to 0–10.
- **Calibration anchors:** Include at least 2 concrete examples per score dimension (e.g., "a fresh competitor with explicit rate in the same region is quality_score ~75").
- **JSON output enforcement:** Always specify the complete output schema in the prompt. Claude must see `{` as first character of response.
- **Fence stripping:** The Parse Code node handles markdown fence removal. But the prompt must still say "no backticks" to reduce the frequency of fenced output.
- **Temperature:** Use `0.2` for analytical/scoring tasks. Higher temperature introduces score variance across identical inputs.
- **User message format:** Pass the full input record as `JSON.stringify(inputRecord)`, not as individual fields. This ensures all context is available and reduces prompt fragility.
