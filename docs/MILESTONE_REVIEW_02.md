# MILESTONE_REVIEW_02.md — Post-Workflow 02 Milestone Review

**Date:** 2026-06-05
**Reviewed by:** project-engineer agent
**Trigger:** Successful completion of Workflow 02 (Claude API Single Record Analysis)
**Scope:** All project files as of session end 2026-06-05

---

## 1. Current Project Status

Three baseline workflows proven end-to-end on real infrastructure:

| Workflow | Status | What it proves |
|----------|--------|---------------|
| 00 — Healthcheck | ✓ Complete | n8n runs on VPS, Manual Trigger works |
| 01 — Google Sheets Append | ✓ Complete | n8n → Service Account → Google Sheets write |
| 02 — Claude API Single Record | ✓ Complete | n8n → Claude gateway → parse JSON → Quality Gate → Google Sheets |

The core AI analysis loop is working. The infrastructure layer (VPS, Docker, n8n, Google Sheets) is operational. One test AI-scored row exists in the `results` sheet with correct field values.

**Current stage:** End of v0.1 infrastructure validation. Not yet at v0.1 pipeline operation.

---

## 2. What Is Proven Technically

- n8n self-hosted on VPS runs stably via Docker with SSH tunnel access
- Claude-compatible API gateway (`https://aiprimetech.io/v1/messages`) accepts requests from n8n HTTP Request node using HTTP Header Auth credential
- Model `claude-sonnet-4-6` works; `claude-sonnet-4.6` (dot notation) does not
- Claude returns a valid `content` array; thinking blocks may precede the text item; parse-by-type works correctly
- Markdown fence stripping in the Parse Code node works
- Quality Gate (IF node) correctly routes on `status == "analyzed" AND quality_score >= 60`
- Google Sheets append via Service Account works with autoMapInputData
- Workflow JSON generation → GitHub → n8n import is the confirmed delivery pattern for all workflows
- Single-item AI analysis cost measured: $0.0115 per short scoring ≈ 0.84 RUB

---

## 3. What Is NOT Proven Yet

- **Web scraping** — Apify and Firecrawl are entirely untested. No actor has been run.
- **Multi-item pipeline** — All proven workflows process one item. The Split Out node has never been exercised with real data.
- **Pre-filtering** — No node exists to discard boilerplate before reaching the Claude node. Every item currently hits the API.
- **Real scraped text** — The only text sent to Claude was a manually typed 200-char Russian sentence. Real pages may be 1 000–5 000 tokens.
- **Telegram notification** — Workflow 10 design exists but no Telegram workflow JSON has been created or tested.
- **Scheduling** — All runs are manual. Cron/schedule trigger has not been tested.
- **Error recovery** — No retry logic or dead-letter behavior exists in any workflow.
- **Partial run failure** — If Claude fails on item 7 of 20, the behavior is unknown.
- **Prompt quality in production** — The test record was ideal input. The prompt has not been tested on genuinely ambiguous, stale, or adversarial data.
- **Business requirements** — The operator's uncle has not been consulted. We do not know which outputs, platforms, or actions he actually cares about.

---

## 4. Main Risks Before Real Scraping

### Risk 1 — Prompt quality (HIGH)
The current Marketing Agent Prompt v1 is an extractor/classifier, not a marketing analyst. It asks Claude to copy fields from the input into structured output fields. It does not ask Claude to reason about competitive positioning, client urgency, or what the operator should actually *do*. Real scraped data is much messier than the test record. The prompt will produce flat, low-value outputs on most real records.

### Risk 2 — Unknown business requirements (HIGH)
We do not know what the operator's uncle actually needs from this system. If he wants daily competitor monitoring, the pipeline design is correct. If he wants inbound lead capture, the scraping targets and quality thresholds are completely different. Starting paid scraping without this conversation wastes money and time.

### Risk 3 — No pre-filter node (MEDIUM)
The pipeline has no pre-filter between scraping and Claude. Apify and Firecrawl will return navigation pages, pagination artifacts, duplicate listings, and boilerplate at significant rates (often 40–70% of raw results). Every one of these hits the Claude API and costs money. Pre-filtering is not designed yet.

### Risk 4 — Cost uncertainty for real pages (MEDIUM)
The $0.0115 baseline was for ~200 chars. Real competitor pages or Avito listings can be 1 000–10 000 tokens. Cost per record could be $0.03–$0.10. At 500 records/month at $0.05 each, that's $25/month in AI cost alone, on top of scraping costs. The $5 test budget covers 430 short records but possibly only 50–150 real-page records.

### Risk 5 — Prompt duplication (LOW-MEDIUM)
The active prompt is embedded in the Code node inside the workflow JSON. The canonical file is `MARKETING_AGENT_PROMPT_V1.md`. If the prompt is changed in the file but not in the JSON, Claude runs the old version silently. No tooling exists to detect or prevent this drift.

### Risk 6 — No .gitignore audit (LOW)
The project is on GitHub. It has not been verified that `.gitignore` covers `n8n.env`, the live `docker-compose.yml`, and any credential backup files. These should be checked before the next commit.

### Risk 7 — Gateway dependency (LOW)
The pipeline depends on `aiprimetech.io`, a third-party Claude-compatible gateway. No fallback to the official Anthropic endpoint is configured. If the gateway becomes unavailable or changes its pricing, the pipeline stops. The gateway URL and model ID are hardcoded in the workflow JSON.

---

## 5. Documentation Consistency Issues

| File | Issue |
|------|-------|
| `WORKFLOW_DESIGN.md` | Still references `api.anthropic.com` as Claude API URL — superseded by `aiprimetech.io` gateway |
| `WORKFLOW_DESIGN.md` | References `SYSTEM_PROMPT.md` (old v0) as the prompt source — should reference `MARKETING_AGENT_PROMPT_V1.md` |
| `WORKFLOW_DESIGN.md` | Node 7 uses `quality_threshold: 6` (old 0–10 scale) — must be updated to `60` (1–100 scale) |
| `WORKFLOW_DESIGN.md` | Node 6 output note says `content[0].text` — superseded by `find(type=text)` pattern |
| `TABLE_SCHEMA.md` | Columns 19–22 describe scores as `0–10 integer` — now 1–100 scale |
| `TABLE_SCHEMA.md` | `competitor_strength` listed as string (`strong/moderate/weak/not_applicable`) — now integer 1–100 |
| `TABLE_SCHEMA.md` | Only 25 columns; `freshness_status` and `profile_url` are in the schema but column positions need re-verification |
| `README.md` | Says "v0.1 — Manual Pipeline (in design)" — should reflect that infrastructure is now validated |
| `tools/TOOLS.md` | Google Sheets notes say "Requires OAuth credentials" — we use Service Account, not OAuth |
| `tools/TOOLS.md` | GitHub listed as "Not active in v0.1" — the repo is in active use for workflow delivery |
| `SYSTEM_PROMPT.md` | Old v0 prompt still present in `modules/marketing-scout-v0/` alongside V1 — risk of confusion about which is active |
| `core/warm/decisions.md` | Only contains DEC-001 to DEC-005 — DEC-018 through DEC-020 (gateway, scoring, prompt duplication) are not reflected |

---

## 6. Workflow Consistency Issues

| Issue | Impact |
|-------|--------|
| Three isolated workflows, not a connected pipeline | Each baseline tests one step; no workflow tests the full chain |
| No multi-item workflow exists | The Split Out node (WORKFLOW_DESIGN.md Node 4) has never been exercised |
| No pre-filter node in any workflow | All records reach the Claude API node regardless of quality |
| Workflow 02 quality gate is hardcoded at `quality_score >= 60` | Cannot be adjusted per run without editing the JSON |
| `quality_threshold` from WORKFLOW_DESIGN.md Node 2 is never used in any existing workflow | The config node approach is unproven |
| Telegram notification not started | Full pipeline cannot run without it |
| No error handling in Workflow 02 | If Claude API is unavailable, the workflow fails silently with no operator notification |
| The Parse node `raw_response_preview` field in the error fallback object is not a schema column | This field would appear in Google Sheets if a parse error row passes the quality gate |

---

## 7. Prompt Quality Assessment

### Overall verdict: extractor/classifier, not a marketing analyst

**What v1 does well:**
- Structural clarity: every rule is explicit and machine-readable
- Anti-hallucination: the "never invent" rules are strong
- Skip/boilerplate filtering: well-designed
- 1–100 scoring scale: correct decision for granularity
- Domain vocabulary: correct product types for the Russian secured lending market
- JSON output schema: clean and complete for the current use case

**What v1 lacks — the core problem:**

The prompt asks Claude to **copy and categorize** what it reads, not to **think like a sales or marketing professional**. Claude extracts `offer_text` and `terms` directly from the text. It categorizes into `entity_type`. It assigns scores based on whether the information is present or absent. This is structured data extraction, not intelligence.

A real marketing analyst watching a competitor page would ask:
- *Is this competitor growing or contracting?* (Is the content fresh? Are they hiring? Do they have recent reviews?)
- *Who is their ideal client, and do they overlap with ours?* (Bad-credit clients? Fast-cash seekers? Property owners?)
- *What is their USP and is it a real threat?* (Same-day decision? Lower rates? Better UX?)
- *Is this a lead who is ready, not just browsing?* (Did they mention an amount? A timeline? A specific urgency like "сегодня"?)
- *What content topic would actually work?* (Not just "there's a pain point here" but "here is an article angle that addresses the fear of losing a car and explains how PTS loans work")

**Specific gaps in v1:**

1. **No ICP definition.** The prompt does not describe who the operator's target client is. Without this, Claude cannot distinguish a low-value lead from a high-value one.

2. **No competitive threat assessment.** `competitor_strength` is assigned based on brand/marketing quality, not on threat to the operator specifically. A weak brand in the same region with the same client profile is more dangerous than a strong brand in another city.

3. **No urgency dimension.** A lead posted today with "нужны деньги сегодня" is completely different from a 3-month-old listing. The prompt captures `freshness_status` but does not connect it to `lead_signal_score` calibration.

4. **No negative signal awareness.** The prompt cannot identify records that signal a market problem (e.g., client complaints about a competitor, regulatory news about lending restrictions, news about a competitor closing).

5. **No content strategy depth.** The prompt can tag a record as `content_idea` but gives Claude no framework for what types of content actually work for secured lending clients: comparison articles ("bank vs PTS loan"), fear-based content ("что будет с машиной"), how-to guides, testimonials.

6. **`reason` field is unstructured.** Claude is told to write "2–3 sentences explaining the scores" but there is no structure for what those sentences should cover. In practice this produces generic output.

7. **No differentiation between "monitored" competitors.** The prompt does not ask Claude to note what makes a competitor's offer distinct or potentially superior. `recommended_action: monitor` is not actionable without knowing *what specifically to watch*.

**What to preserve in v2:** Skip logic, anti-hallucination rules, JSON schema, scoring scale, entity/service type enums.

**What to rewrite in v2:** Agent identity framing, business objective statement, ICP definition, competitive threat assessment logic, lead urgency assessment, content strategy framing, `reason` field structure, `recommended_action` specificity.

---

## 8. Cost Model Assessment

**Strengths of the current cost model:**
- A real baseline measurement exists ($0.0115 per short record)
- The cost formula is correct and documented
- Budget alert thresholds are defined
- The RUB conversion and exchange rate risk are noted

**Weaknesses:**
- Only one data point, from a 200-char manually typed record
- Real scraped pages from Avito, VK, or competitor websites may be 5–50× longer in token terms
- No measured cost for a full-length Firecrawl extraction (likely 500–2 000 tokens input)
- Apify free tier limits are noted as "TBD" but not researched
- The prompt v2 will likely be longer (more tokens), increasing per-call cost
- There is no cost ceiling per session — a runaway workflow could exhaust the $5 balance in one bad run

**Estimate revision needed:**
At a more realistic 800–1 200 token input per real page, cost per scoring could be $0.03–$0.06, making 500 real-page records/month cost $15–$30 in AI alone. This should be documented after the first Firecrawl test.

---

## 9. Security / Secrets Checklist

| Item | Status |
|------|--------|
| Claude API key | ✓ Stored in n8n credential manager only; not in any project file |
| Google Sheets service account key | ✓ In n8n credential manager; not in project files |
| n8n.env (encryption key, env vars) | ✓ Outside project directory, not committed |
| Workflow JSONs — credentials | ✓ Placeholder `PASTE_CREDENTIAL_ID_HERE`; no real IDs committed |
| Workflow JSONs — Spreadsheet ID | ✓ Placeholder `PASTE_SPREADSHEET_ID_HERE` |
| Gateway URL in workflow JSON | ⚠ `https://aiprimetech.io` committed to project files — not a secret, but worth noting if gateway is private |
| `.gitignore` audit | ⚠ Not explicitly verified; should be checked before next commit push |
| n8n port exposure | ✓ Bound to `127.0.0.1:5678`; not public (DEC-010) |
| VPS access | ✓ SSH key-based; n8n only accessible via tunnel |
| Real service account email | ⚠ Should not appear in any committed file; not verified |

**Action required:** Audit `.gitignore` before the next push to ensure `n8n.env`, live `docker-compose.yml`, and any key files are excluded.

---

## 10. Recommended Next 5 Actions

### Action 1 — Consult uncle about business requirements _(zero cost, high value)_
Before any scraping or prompt work, ask the operator's uncle: what does he want the system to deliver? Which platforms matter? What is a useful output for him — a daily Telegram message, a reviewed Sheets row, a list of leads to call? His answers determine the entire scope of Workflow 03 and beyond. Do not skip this step.

### Action 2 — Write Marketing Agent Prompt v2 _(zero cost)_
Based on this review, redesign the prompt with a real marketing analyst identity, ICP definition, competitive threat assessment, and structured `reason` output. Test v2 against 5–10 diverse synthetic records (including boilerplate, strong leads, weak competitors, and ambiguous cases) before embedding it in a workflow. See `modules/marketing-scout-v0/MARKETING_AGENT_PROMPT_V2_PLAN.md`.

### Action 3 — Fix documentation consistency _(zero cost)_
Update `WORKFLOW_DESIGN.md` (gateway URL, prompt reference, scale), `TABLE_SCHEMA.md` (score scale, competitor_strength type), `README.md` (current stage), `tools/TOOLS.md` (Google Sheets auth type), and `core/warm/decisions.md` (add DEC-018 through DEC-020).

### Action 4 — Design the pre-filter node _(zero cost)_
Before Workflow 03, design a pre-filter Code node that discards records with: text_context under 50 chars, known boilerplate patterns, duplicate source_url from previous runs, or `published_at` older than 90 days. This node sits between the scraper output and the Claude API node and will save significant API cost in production.

### Action 5 — Audit .gitignore and lock baseline workflows _(low effort)_
Verify `.gitignore` covers all sensitive files before the next GitHub push. Mark all three baseline workflow JSONs (00, 01, 02) as locked in `docs/NEXT_ACTIONS.md`. These should not be modified — new functionality goes into new workflow files.
