# PROMPTS.md — Prompt Version Register

Tracks all Claude API prompt versions used in the pipeline.
Each version should be tested against `modules/*/TEST_DATA.md` before deployment.

---

## Active Prompt

**Module:** marketing-scout-v0
**Version:** v1.0
**File:** `modules/marketing-scout-v0/SYSTEM_PROMPT.md`
**Status:** Draft — not yet tested in production
**Created:** 2026-06-04

---

## Version History

| Version | Module               | Date       | Status  | Notes                                  |
|---------|----------------------|------------|---------|----------------------------------------|
| v1.0    | marketing-scout-v0   | 2026-06-04 | Draft   | Initial system prompt, untested        |

---

## Prompt Evaluation Criteria

Before promoting a prompt version to active/production status:

1. **Coverage:** Does it populate all required output fields?
2. **Accuracy:** Are entity types, scores, and detected_need plausible?
3. **Consistency:** Same input → same output category (not wildly different scores)
4. **Format compliance:** Output is valid JSON matching the expected schema
5. **Threshold calibration:** quality_score distribution is reasonable (not all 8+, not all 3-)

Test against all 3 records in `TEST_DATA.md` before marking a version as `tested`.

---

## Prompt Engineering Notes

- Keep the system prompt under 1000 tokens for cost efficiency (claude-haiku) or under 2000 for claude-sonnet
- Always specify exact JSON output format in the prompt — do not rely on model defaults
- Include score definitions with explicit criteria (what makes a 8 vs a 4)
- Include a `reason` field instruction — it helps debug wrong scores
