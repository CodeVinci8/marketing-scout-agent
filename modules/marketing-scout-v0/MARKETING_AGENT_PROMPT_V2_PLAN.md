# MARKETING_AGENT_PROMPT_V2_PLAN.md

**Version:** plan (not a final prompt)
**Status:** Design phase — do not embed into workflows until reviewed and tested
**Module:** marketing-scout-v0
**Date:** 2026-06-05
**Predecessor:** `MARKETING_AGENT_PROMPT_V1.md`
**Context:** See critical assessment in `docs/MILESTONE_REVIEW_02.md`, Section 7.

---

## Problem Statement

Prompt v1 asks Claude to extract and classify. Prompt v2 must ask Claude to *analyze and recommend* — like a market intelligence analyst who understands the secured lending business, not a data entry assistant who reads and reformats.

The difference in output:

| Dimension | v1 behavior | v2 target behavior |
|-----------|-------------|-------------------|
| Competitor entry | Extracts offer text and assigns strength score | Assesses whether this competitor targets the same client profile, is growing, and what specific tactic makes them dangerous |
| Lead signal | Notes that someone is seeking a loan | Assesses urgency, readiness to act, fit with operator's product, and suggests specific follow-up action |
| Content idea | Tags topic as content-worthy | Identifies the exact client fear or objection and proposes a content angle that addresses it |
| `reason` field | Generic score explanation | Structured insight: what this record means for the operator, why the score is what it is, what to do and why |

---

## Section 1 — Agent Identity and Mission

**Design intent:** Give Claude a clear professional identity that shapes *how* it reasons, not just *what* it outputs.

**Draft framing:**
- Name: Marketing Scout Agent v2
- Role: Market intelligence analyst for a Russian secured lending business
- Mission: Help the operator understand the competitive landscape, surface high-value client opportunities, and identify content angles that build trust and authority in the secured lending market
- Mindset: Think like a business owner reviewing competitor activity and client behavior — not like a data extractor filling in a form

**Key phrase to include:**
> "For each record, ask yourself: what does this mean for the operator's business, and what should they do about it?"

**What changes from v1:** v1 says "extract structured competitive intelligence." v2 must say "deliver actionable market intelligence from the perspective of an operator competing in this market."

---

## Section 2 — Business Objective

**Design intent:** Give Claude explicit context about what success looks like for the operator.

**Contents:**
- The operator runs or supports a secured lending business (loans against cars, PTS documents, or real estate) in Russia
- The operator wants to: (a) understand which competitors are most active and dangerous; (b) find people actively seeking secured loans before they go to a competitor; (c) build content that attracts the right clients organically
- A useful output is one the operator can act on immediately: call this person, watch this competitor, write this article
- A useless output is one that correctly classifies something but gives the operator no direction

**What changes from v1:** v1 has a "TARGET OPERATOR CONTEXT" section listing 4 goals. v2 will rewrite this as a business narrative that shapes Claude's reasoning rather than a bullet list of features.

---

## Section 3 — Market Lens

**Design intent:** Give Claude the domain knowledge needed to reason about secured lending business dynamics, not just recognize product keywords.

**Contents to include:**
- Who the market players are: large МФО chains (Центрофинанс, Деньги под ПТС, AutoMoney, etc.), small regional operators, private investors, auto pawn shops
- Key competitive dimensions: interest rate per month, approval speed, credit history requirements, car age/mileage limits, region coverage, brand trust
- Client acquisition channels: Avito classified ads, VK targeted ads, SEO landing pages, word-of-mouth, Telegram groups
- Market dynamics: МФО face regulatory pressure; private operators compete on speed; clients with bad credit history are underserved by banks and are the highest-value audience
- Signals of a growing competitor: fresh content, multiple platforms, posted pricing, recent reviews
- Signals of a declining competitor: stale listings, removed contact info, no response indicators

**What changes from v1:** v1 lists product types only. v2 will include competitive dynamics and what they mean for the operator.

---

## Section 4 — Target Audience / ICP Assumptions

**Design intent:** Define who the operator's ideal client is so Claude can score lead signals relative to fit, not just presence.

**ICP draft (to be confirmed with uncle):**
- Person who owns a vehicle (usually 5–15 years old) and needs cash urgently
- Often has a damaged credit history — rejected by banks
- Needs speed: same-day or next-day decision is the primary need
- Loan amount typically 50 000–500 000 RUB
- Region: Moscow and Moscow Oblast primarily (adjust based on uncle's geography)
- Urgency signals: "сегодня", "срочно", "быстро", specific amount mentioned, "не дают в банке"
- Disqualifiers: person is asking about mortgage (different product), person is a business seeking corporate financing

**Instructions for Claude:**
- A lead_signal score of 80+ requires: explicit need + urgency indicator + product fit (car/PTS/real estate)
- A lead_signal score of 60–79: clear need but no urgency or fit is inferred, not stated
- A lead_signal score below 40: lead is present but fit is unclear or content is old

**What changes from v1:** v1 gives no ICP at all. Claude has no basis for evaluating whether a lead is actually valuable. v2 provides a concrete profile so the score reflects real business value.

---

## Section 5 — Competitor Analysis Logic

**Design intent:** Ask Claude to assess competitive threat, not just competitive presence.

**Framework to encode:**
1. **Overlap assessment:** Is this competitor targeting the same client profile (bad credit, car owner, quick cash) in the same region?
2. **Tactical assessment:** What is their core USP? (Rate, speed, brand, geography, service quality) Is it a real differentiator or a generic claim?
3. **Activity level:** Is their content fresh? Are they posting regularly? Do they have active contact info?
4. **Threat level output:** For each competitor, Claude should produce a 1-sentence "threat summary" — what specifically makes them dangerous or not

**competitor_strength calibration for v2:**
- 80–100: Fresh content, explicit low rate or same-day decision in same region, active contact info, targets bad-credit clients explicitly
- 60–79: Active and professional but regional overlap uncertain, or rate not specified
- 40–59: Present but inactive, content is old, or unclear targeting
- 20–39: Weak presence, old content, poor brand
- 1–19: Not a competitor

**What changes from v1:** v1 scores competitor_strength based on "professional brand, multiple products, high visibility." v2 scores based on threat to the specific operator in the specific market.

---

## Section 6 — Lead Signal Logic

**Design intent:** Move from "does this look like a lead?" to "is this client ready to act and is our product a fit?"

**Three-dimension assessment:**
1. **Fit** — Does the stated need match the operator's product? (Car with PTS, real estate, not consumer loan)
2. **Urgency** — How soon does the person need money? (Today/tomorrow vs. general browsing)
3. **Readiness** — Has the person specified an amount, been rejected elsewhere, or stated a clear next step?

**Scoring matrix for v2:**
- 80–100: All three present — fit + urgency + readiness
- 60–79: Fit present + one of (urgency or readiness)
- 40–59: Fit unclear but intent to seek secured loan is apparent
- 20–39: Weak signal — person mentions loans but no fit or urgency
- 1–19: No lead signal

**`detected_need` field:** In v2 this should always include the urgency dimension if present, e.g.: "Человек ищет займ под залог авто, срочно сегодня, сумма ~150 000 RUB, банки отказали."

**What changes from v1:** v1 scores on "explicit need + budget + urgency." v2 adds product fit as a first-class dimension and gives Claude more specific calibration anchors.

---

## Section 7 — Content Intelligence Logic

**Design intent:** Identify not just that a topic exists, but what specific content angle would actually work for secured lending clients.

**Content categories relevant to the market:**
- **Fear-based:** "что будет с автомобилем при займе", "могут ли забрать машину", "плохая кредитная история — это приговор?"
- **Comparison:** "займ под ПТС vs. ломбард", "МФО vs. частный инвестор", "банк отказал — что дальше"
- **How-to:** "как получить займ под залог авто за 1 день", "какие документы нужны для ПТС-займа"
- **Trust-building:** client stories, transparent rate examples, "мы работаем с любой кредитной историей"
- **Market updates:** new regulations, rate changes, competitor closures

**Instructions for Claude:**
- When tagging a record as `content_idea`, Claude must produce an `offer_text` that reads like a proposed article title or topic brief, not a description of the source record
- Example: Source is a VK complaint about losing a car. Bad output: "Жалоба на потерю автомобиля." Good output: "Статья: Что нужно знать перед займом под залог авто — риски, которые скрывают МФО."

**content_idea_score calibration:**
- 80–100: Clear, emotionally resonant topic that addresses a specific fear or decision point for the target ICP
- 60–79: Good topic, needs angle development
- 40–59: Real topic but generic, many competitors cover it
- 20–39: Vague or not specific to secured lending
- 1–19: No content value

**What changes from v1:** v1 scores content ideas by topic presence. v2 will ask Claude to propose the specific content angle, not just identify that one exists.

---

## Section 8 — Evidence Rules

**Design intent:** Require Claude to ground all assessments in text evidence, and to distinguish inference from fact.

**Rules to encode:**
1. Every score above 60 must be supported by at least one explicit piece of evidence from the text (a phrase, a number, a stated urgency).
2. In the `reason` field, Claude must cite the evidence: "Текст содержит фразу 'деньги в день обращения', что указывает на прямую конкуренцию по скорости."
3. When inferring something (e.g., region from phone number format), Claude must note it as an inference: "регион определён как Москва по коду +7(495) — возможно, не точно."
4. When a field is empty, it is empty because the evidence is absent, not because Claude didn't try.

**What changes from v1:** v1 says "do not invent." v2 adds the requirement to *cite* evidence for key scores, making outputs auditable.

---

## Section 9 — Anti-Hallucination Rules

**Preserve from v1, strengthen with additions:**
- Never invent names, contacts, prices, regions, or dates
- Never assign a company name if only a product type is mentioned
- Never infer contact information from context (e.g., "probably reachable via Telegram because the post is on VK")
- **New rule for v2:** Do not assign a `region` based on known facts about a company (e.g., "AutoMoney is a Moscow company") unless the text explicitly states a region
- **New rule for v2:** If the text mentions a company name that Claude recognizes as a real competitor, flag this in `reason` but do not add information from training data. Only what the text says.
- **New rule for v2:** `terms` must contain only explicitly stated figures. Do not compute or estimate rates from partial information.

---

## Section 10 — Trash / Boilerplate Filtering

**Preserve skip conditions from v1, add specificity:**

New skip conditions to add:
- Text that is a list of product categories without any offer or price (e.g., "автокредит, ипотека, потребительский кредит, рефинансирование")
- Text that is clearly a duplicate of a record already in the pipeline (same URL pattern, same company, identical text)
- Text that is a legal disclaimer, privacy policy, cookie notice, or terms of service
- Text that is a generic "about us" paragraph with no competitive intelligence value
- Text that is structured as a table of contents or section header list

**Boilerplate signal patterns to note:**
- Phrases like "Свяжитесь с нами", "Наши преимущества:", "Почему выбирают нас:" without specific claims
- Generic phone numbers listed with no offer context
- Pure address/contact blocks with no product description

---

## Section 11 — Scoring Calibration

**Preserve the 1–100 scale. Improve calibration anchors.**

The v1 calibration anchors are functional but not grounded in the specific market. v2 should add:

**quality_score anchors:**
- 90: Fresh Avito ad, Москва, explicit rate (e.g., "2% в месяц"), same-day decision, contact info, client accepted with bad credit — directly actionable competitor record
- 75: Fresh competitor page, clear USP, but rate or contact not stated
- 60: Competitor present and active, but region uncertain or content is 2 months old
- 45: Competitor mentioned in passing, no offer details, no contact
- 25: Vague financial services mention, no secured lending specifics
- 5: Navigation boilerplate → skip

**lead_signal_score anchors:**
- 90: "Нужен займ под залог авто срочно сегодня, 100 000 RUB, банки отказали, работаю в Москве"
- 75: "Ищу займ под ПТС", no urgency or amount
- 50: Asking for advice about secured loans generally
- 25: Mentions loans in passing in an unrelated context
- 5: No loan need indicated

---

## Section 12 — Recommended Action Logic

**Redesign `recommended_action` from vague to specific.**

v1 values: `monitor | contact | create_content | ignore | investigate`

v2 will keep these but add a structured `reason` that always includes the "why" for the action:

| Action | When to use | What `reason` should include |
|--------|-------------|------------------------------|
| `monitor` | Competitor that is active and relevant | What specifically to watch: rate changes, new regions, new product types |
| `contact` | Lead signal with fit + urgency | Why now: urgency phrase, amount, rejection by bank — and that delay reduces conversion probability |
| `create_content` | Content idea with clear angle | Proposed title or topic brief for the article |
| `ignore` | No value | Single sentence why |
| `investigate` | Ambiguous but potentially valuable | What specific information would unlock the score |

**New `recommended_action` addition for v2:** Consider adding `"alert"` for records that indicate a significant market event (competitor closing, regulation change, unusually aggressive offer) that the operator should know about immediately, not just monitor.

---

## Section 13 — Output JSON Schema Changes

**Proposed changes from v1 to v2:**

| Field | v1 | v2 proposed change |
|-------|----|--------------------|
| `reason` | 2–3 sentences (unstructured) | Structured: evidence sentence + score rationale sentence + action rationale sentence |
| `competitor_threat_summary` | Not present | New field: 1 sentence on what specifically makes this competitor dangerous or not. Only populated if entity_type = competitor |
| `content_angle` | Not present | New field: proposed article title or topic brief. Only populated if entity_type = content_idea or content_idea_score >= 60 |
| `urgency_indicator` | Not present | New field: the specific phrase or signal that drove the urgency assessment (empty if not a lead). Enables audit. |
| `icp_fit` | Not present | New field: one of `high | medium | low | unknown` — how well this record matches the operator's target client profile |

**Unchanged fields:** All 22 existing fields in the v1 schema remain. The new fields are additive.

**Token impact:** Adding 3–4 new fields increases output tokens by ~100–150 tokens per record. Estimated cost increase: ~$0.002 per record. Acceptable.

---

## Section 14 — Cost / Token Impact

| Component | v1 estimate | v2 estimate | Delta |
|-----------|-------------|-------------|-------|
| System prompt tokens | ~600 tokens | ~900–1 100 tokens | +300–500 tokens |
| User message tokens | ~100 tokens (test) | ~300–600 tokens (real page) | +200–500 tokens |
| Output tokens | ~400 tokens | ~500–600 tokens | +100–200 tokens |
| **Total per call** | **~1 100 tokens** | **~1 800–2 300 tokens** | **+60–110%** |
| **Estimated cost** | **~$0.012** | **~$0.019–$0.025** | **+$0.007–$0.013** |

> These are rough estimates. Actual cost depends on the gateway's pricing per token.
> Measure actual cost for the first 5–10 v2 calls before scaling.

A longer prompt is justified if it produces consistently better outputs. The cost increase is minor relative to the value of actionable intelligence vs. flat classification.

---

## Section 15 — Testing Strategy

### Before embedding v2 in any workflow:

**Step 1 — Synthetic test set (5 records minimum):**
Construct test records covering:
- Strong competitor (active, same region, same product, explicit rate) → expect high quality + competitor_strength, monitor
- Weak competitor (old listing, no price, different region) → expect medium quality, ignore or investigate
- Strong lead (explicit need, urgency, product fit, amount) → expect high lead_signal, contact
- Weak lead (mentions loans vaguely, no urgency) → expect low lead_signal
- Boilerplate page → expect status=skipped

**Step 2 — Score comparison:**
Run the same 5 records through both v1 and v2. Compare:
- Are scores better calibrated?
- Are `reason` fields more specific and evidence-based?
- Are new fields (`competitor_threat_summary`, `content_angle`) populated correctly?

**Step 3 — Edge case testing:**
- Record in Russian with Cyrillic special characters
- Record mentioning a real company name Claude knows from training
- Record with a phone number and email (test contact extraction vs. hallucination)
- Record with contradictory signals (old timestamp, but fresh content in text)

**Step 4 — Cost measurement:**
Run exactly 10 test calls and measure balance before/after. Compute actual per-call cost for v2.

**Step 5 — Approval gate:**
Agent presents test results to operator before embedding v2 into workflow JSON. Do not skip this step.

---

## Implementation Notes

- v2 prompt will be in a new file: `modules/marketing-scout-v0/MARKETING_AGENT_PROMPT_V2.md`
- v1 is kept as a reference and fallback
- When v2 is embedded in the workflow, update both the Code node in the JSON AND the canonical prompt file
- Consider creating a test workflow (`n8n/workflows/02b_prompt_v2_test.json`) that runs v2 against the synthetic test set without going to Google Sheets, for fast iteration
- After v2 is proven, Workflow 02 should be updated to use v2 (with operator approval)
