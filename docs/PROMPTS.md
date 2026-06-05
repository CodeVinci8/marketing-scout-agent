# PROMPTS.md — Prompt Version Register

Tracks all Claude API prompt versions used in the pipeline.
Each version must be tested against synthetic records before embedding into a workflow.

**Last updated:** 2026-06-05

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

## Planned: Prompt v2

**File (when written):** `modules/marketing-scout-v0/MARKETING_AGENT_PROMPT_V2.md`
**Design plan:** `modules/marketing-scout-v0/MARKETING_AGENT_PROMPT_V2_PLAN.md`
**Status:** Design phase — not written yet
**Blocker:** Uncle's business requirements must be confirmed before finalizing ICP section

**Key improvements planned over v1:**
- Agent identity as marketing analyst, not data extractor
- ICP definition for the operator's target client
- Competitive threat assessment (regional overlap, urgency, tactic differentiation)
- Lead signal urgency model (fit + urgency + readiness three-axis scoring)
- Content angle proposals (not just tagging a record as content_idea)
- Structured `reason` field with evidence citation
- New output fields: `competitor_threat_summary`, `content_angle`, `urgency_indicator`, `icp_fit`

**Gate before use:** Prompt v2 must pass a 5-record synthetic test before embedding into any workflow.
See `docs/MILESTONE_REVIEW_02.md` Section 7 and `MARKETING_AGENT_PROMPT_V2_PLAN.md` Section 15.

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
| v2.0 | `MARKETING_AGENT_PROMPT_V2.md` | TBD | Planned | Analyst identity, ICP, competitive threat, urgency model |

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

- **Token budget:** System prompt should stay under 1 200 tokens for cost efficiency. v1 is approximately 600–700 tokens. v2 is estimated at 900–1 100 tokens.
- **Scoring scale:** 1–100 integers. Do not revert to 0–10.
- **Calibration anchors:** Include at least 2 concrete examples per score dimension (e.g., "a fresh competitor with explicit rate in the same region is quality_score ~75").
- **JSON output enforcement:** Always specify the complete output schema in the prompt. Claude must see `{` as first character of response.
- **Fence stripping:** The Parse Code node handles markdown fence removal. But the prompt must still say "no backticks" to reduce the frequency of fenced output.
- **Temperature:** Use `0.2` for analytical/scoring tasks. Higher temperature introduces score variance across identical inputs.
- **User message format:** Pass the full input record as `JSON.stringify(inputRecord)`, not as individual fields. This ensures all context is available and reduces prompt fragility.
