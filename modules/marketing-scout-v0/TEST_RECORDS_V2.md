# TEST_RECORDS_V2.md — Synthetic Test Records for Prompt v2

**Version:** 2026-06-05
**Purpose:** Manual testing of `MARKETING_AGENT_PROMPT_V2.md` before embedding in any workflow.
**Instructions:** See `docs/N8N_WORKFLOW_02_V2_TEST_PLAN_RU.md` for the step-by-step test procedure.
**How to use:** For each record below, pass the `input_json` as the user message in the `Build Claude Request` node.

---

## Test Coverage Summary

| # | Scenario | Priority tested | Key validation |
|---|----------|----------------|----------------|
| 1 | Strong lead — Moscow, PTS, urgent | Priority 1 (lead) | High lead_signal_score, contact action, evidence citation |
| 2 | Weak lead — generic loan question | Priority 1 miss | Low lead_signal_score, no contact action |
| 3 | Active competitor — auto collateral, Moscow | Priority 2 (competitor) | High competitor_strength, monitor action |
| 4 | Competitor — real estate landing page | Priority 2 (competitor) | Region inference, evidence citation |
| 5 | Content idea — fear of losing car | Priority 3 (content) | Content angle in offer_text, create_content action |
| 6 | Irrelevant SEO boilerplate | Skip rules | status=skipped, quality_score=1 |
| 7 | Business loan / refinancing edge case | Product hierarchy | Secondary product scoring, investigate action |

---

## Record 1 — Strong Lead Signal (Moscow, PTS, Urgent)

**Scenario:** A person posts on Avito seeking an urgent PTS loan in Moscow. Explicit need, urgency, amount, bank rejection, and phone number visible. This is the ideal lead for the operator.

**Why it matters:** Tests whether v2 correctly prioritizes lead signals over other classifications and assigns a high lead_signal_score with evidence citation. Also tests whether `recommended_action = contact` is triggered correctly.

```json
{
  "source_type": "classified",
  "platform": "avito",
  "source_url": "https://www.avito.ru/moskva/test-record-001",
  "profile_url": "",
  "parsed_at": "2026-06-05",
  "published_at": "2026-06-04",
  "text_context": "Срочно нужен займ под залог ПТС, автомобиль Toyota Camry 2015, в хорошем состоянии. Нужно 180 000 рублей, банки везде отказали из-за просрочек в прошлом. Нужны деньги сегодня, желательно без лишних проверок. Москва, район Митино. Телефон: +7(916)555-12-34."
}
```

**Expected entity_type:** `lead_signal`
**Expected recommended_action:** `contact`
**Expected score ranges:**
- `lead_signal_score`: 85–95
- `quality_score`: 80–92
- `competitor_strength`: 1
- `content_idea_score`: 20–40

**Expected fields:**
- `region`: Москва
- `service_type`: pts_loan
- `contact_public`: +7(916)555-12-34
- `detected_need`: Must mention ПТС + ~180 000 RUB + банки отказали + сегодня + Москва
- `freshness_status`: fresh
- `reason` sentence 1: must reference "займ под залог ПТС" and "Toyota Camry 2015" or the amount
- `reason` sentence 2: must cite "банки везде отказали" or "нужны деньги сегодня" as urgency evidence
- `reason` sentence 3: must reference contact availability and urgency for recommended action

**Pass criteria:** lead_signal_score ≥ 82, recommended_action = contact, contact_public is not empty, reason cites specific phrases from text.

---

## Record 2 — Weak Lead Signal (Generic Loan Question, No Urgency)

**Scenario:** A VK user asks a general question about secured loans — no urgency, no amount, no specific product, no region. Intent is present but vague.

**Why it matters:** Tests whether v2 correctly downgrades ambiguous lead signals rather than over-scoring them. Validates that the three-axis model (fit × urgency × readiness) is applied properly. Tests that recommended_action does NOT become "contact" for a weak signal.

```json
{
  "source_type": "social",
  "platform": "vk",
  "source_url": "https://vk.com/wall-test-record-002",
  "profile_url": "https://vk.com/user_test_002",
  "parsed_at": "2026-06-05",
  "published_at": "2026-06-01",
  "text_context": "Подскажите, где можно взять кредит под залог машины? Интересует в принципе, просто изучаю варианты. Слышал, что это быстрее, чем банк. Есть у кого опыт?"
}
```

**Expected entity_type:** `lead_signal`
**Expected recommended_action:** `monitor` or `investigate` (NOT `contact`)
**Expected score ranges:**
- `lead_signal_score`: 25–45
- `quality_score`: 25–45
- `competitor_strength`: 1
- `content_idea_score`: 30–55

**Expected fields:**
- `region`: empty string (not stated)
- `service_type`: secured_auto_loan (or generic_lending)
- `contact_public`: empty string
- `detected_need`: must note weak signal — studying options, no urgency
- `freshness_status`: recent
- `reason`: must note absence of urgency, no amount, no region — explains lower score

**Pass criteria:** lead_signal_score ≤ 50, recommended_action ≠ contact, reason explains why score is lower (no urgency/region/readiness signals).

---

## Record 3 — Active Competitor (Auto Collateral, Moscow, Clear Offer)

**Scenario:** An Avito listing from a private investor offering PTS loans in Moscow. Fresh listing, explicit rate, same-day decision, bad credit accepted, phone visible. Direct competitor.

**Why it matters:** Tests competitor assessment framework — regional overlap + tactical threat + activity level. Validates high competitor_strength and monitor action. Tests whether rate and speed signals are properly weighted.

```json
{
  "source_type": "classified",
  "platform": "avito",
  "source_url": "https://www.avito.ru/moskva/test-record-003",
  "profile_url": "",
  "parsed_at": "2026-06-05",
  "published_at": "2026-06-03",
  "text_context": "Частный инвестор. Займы под залог ПТС и автомобиля. Ставка от 2,5% в месяц. Решение за 1 час. Одобряем с любой кредитной историей. Работаем по Москве и МО. Сумма от 50 000 до 800 000 руб. Без скрытых комиссий. Телефон: +7(499)888-44-55. Без выходных."
}
```

**Expected entity_type:** `competitor`
**Expected recommended_action:** `monitor`
**Expected score ranges:**
- `competitor_strength`: 82–95
- `quality_score`: 78–90
- `lead_signal_score`: 1
- `content_idea_score`: 15–35

**Expected fields:**
- `region`: Москва (and possibly МО)
- `service_type`: pts_loan
- `company_name`: empty string (no company name stated, only "Частный инвестор")
- `terms`: must include rate (2,5% в месяц) and decision time (1 час)
- `contact_public`: +7(499)888-44-55
- `freshness_status`: fresh
- `reason` sentence 1: must reference "Частный инвестор" and "2,5% в месяц" and Moscow/MO
- `reason` sentence 2: must explain competitor_strength based on rate, speed, credit acceptance
- `reason` sentence 3: monitor — watch for rate changes or geographic expansion

**Pass criteria:** competitor_strength ≥ 80, recommended_action = monitor, terms contains rate, reason cites specific phrases.

---

## Record 4 — Competitor Website (Real Estate Collateral Landing Page)

**Scenario:** A scraped landing page from a competitor offering real estate collateral loans in Moscow. Professional, but no explicit rate stated. Tests secondary product scoring and cautious inference.

**Why it matters:** Tests real estate collateral as a primary product, cautious inference for region (address in footer, not explicit in body), and whether the absence of a stated rate lowers competitor_strength appropriately.

```json
{
  "source_type": "scraped_web",
  "platform": "website",
  "source_url": "https://example-lender.ru/zaloz-kvartiry",
  "profile_url": "",
  "parsed_at": "2026-06-05",
  "published_at": "2026-05-10",
  "text_context": "Займы под залог квартиры в Москве. Рассматриваем квартиры, дома, коммерческую недвижимость. Без банка, без очереди, решение за день. Работаем с заёмщиками, которым банки отказали. Сумма от 300 000 рублей. Оставьте заявку или позвоните: +7(495)700-00-11. Офис: ул. Тверская, 15, Москва."
}
```

**Expected entity_type:** `competitor`
**Expected recommended_action:** `monitor`
**Expected score ranges:**
- `competitor_strength`: 65–82
- `quality_score`: 65–80
- `lead_signal_score`: 1
- `content_idea_score`: 20–40

**Expected fields:**
- `region`: Москва
- `service_type`: secured_real_estate_loan
- `terms`: empty string or partial (no explicit rate stated, only "решение за день" which is a speed claim)
- `contact_public`: +7(495)700-00-11
- `freshness_status`: recent
- `reason` sentence 2: must note absence of explicit rate as gap reducing competitor_strength below top tier
- `reason` sentence 3: monitor — consider checking for rate information elsewhere on site

**Pass criteria:** competitor_strength between 60 and 85 (not 90+, because no rate stated), recommended_action = monitor, terms is empty or does not include an invented rate, region = Москва.

---

## Record 5 — Content Idea (Fear of Losing Car or Apartment)

**Scenario:** A Reddit/forum-style complaint from someone who lost their car after defaulting on a PTS loan. Emotional, specific, reveals a real client fear. No offer, no competitor, no lead.

**Why it matters:** Tests content intelligence framework — whether v2 proposes a concrete content angle in `offer_text` rather than describing the source post. Tests that content_idea_score is high when the topic is emotionally resonant for the ICP.

```json
{
  "source_type": "social",
  "platform": "vk",
  "source_url": "https://vk.com/wall-test-record-005",
  "profile_url": "https://vk.com/user_test_005",
  "parsed_at": "2026-06-05",
  "published_at": "2026-05-28",
  "text_context": "Взял займ под залог ПТС год назад. Просрочил три месяца, потому что потерял работу. Машину забрали — пришли и увезли прямо с парковки. Договор подписал не читая. Никто не предупредил о таком развитии. Будьте осторожны с этими МФО, читайте мелкий шрифт."
}
```

**Expected entity_type:** `content_idea`
**Expected recommended_action:** `create_content`
**Expected score ranges:**
- `content_idea_score`: 78–92
- `quality_score`: 65–80
- `lead_signal_score`: 1–15
- `competitor_strength`: 1

**Expected fields:**
- `region`: empty string (not stated)
- `service_type`: pts_loan
- `offer_text`: must be a proposed content ANGLE, not a description of the post. Example: "Статья: Что происходит с автомобилем при просрочке по займу под залог ПТС — реальные риски, которые МФО не объясняют"
- `detected_need`: empty string (not a lead)
- `freshness_status`: recent
- `reason` sentence 1: must identify the fear ("машину забрали", "договор не читал")
- `reason` sentence 3: must reference the content opportunity for the operator

**Pass criteria:** content_idea_score ≥ 75, recommended_action = create_content, offer_text reads as a proposed content title (not a source description), entity_type = content_idea.

---

## Record 6 — Irrelevant SEO Boilerplate (Skip Case)

**Scenario:** A navigation/SEO dump scraped from a financial services aggregator homepage. No offer, no signal, no useful content. Should be skipped immediately.

**Why it matters:** Tests skip rules — whether v2 correctly identifies and skips content with no analyzable intelligence, even when it comes from a financial services domain. Critical for production cost control.

```json
{
  "source_type": "scraped_web",
  "platform": "website",
  "source_url": "https://example-aggregator.ru/kredity",
  "profile_url": "",
  "parsed_at": "2026-06-05",
  "published_at": "",
  "text_context": "Кредиты | Займы | Ипотека | Рефинансирование | Автокредит | Залог | Микрозаймы | Все виды кредитов онлайн. Главная О компании Услуги Контакты Войти Зарегистрироваться"
}
```

**Expected entity_type:** `irrelevant`
**Expected recommended_action:** `ignore`
**Expected score ranges:**
- `quality_score`: 1
- `lead_signal_score`: 1
- `content_idea_score`: 1
- `competitor_strength`: 1

**Expected fields:**
- `status`: skipped
- `freshness_status`: unknown
- `reason`: brief — explains why skipped (navigation boilerplate, no analyzable content)

**Pass criteria:** status = skipped, quality_score = 1, all other scores = 1. This is the pass/fail test for skip logic.

---

## Record 7 — Business Loan / Refinancing Edge Case

**Scenario:** A business owner posts on Avito seeking refinancing for an existing secured loan on commercial real estate. Secondary product for the operator. Not a primary PTS lead. Tests product hierarchy and whether v2 correctly scores secondary products lower on lead_signal_score without ignoring them.

**Why it matters:** Tests the product hierarchy (refinancing = secondary) and whether v2 recommends investigate rather than contact for an ambiguous business loan record where more context is needed.

```json
{
  "source_type": "classified",
  "platform": "avito",
  "source_url": "https://www.avito.ru/moskva/test-record-007",
  "profile_url": "",
  "parsed_at": "2026-06-05",
  "published_at": "2026-06-02",
  "text_context": "Ищу рефинансирование. Есть действующий займ под залог коммерческой недвижимости (помещение в Подмосковье, оценочная стоимость около 4 млн). Текущая ставка 5% в месяц, хочу снизить. Сумма остатка около 900 000 руб. Рассматриваю предложения."
}
```

**Expected entity_type:** `lead_signal` (refinancing lead is valid, secondary priority)
**Expected recommended_action:** `investigate` (commercial real estate, large amount, ambiguous borrower type)
**Expected score ranges:**
- `lead_signal_score`: 45–65
- `quality_score`: 50–68
- `competitor_strength`: 1
- `content_idea_score`: 20–40

**Expected fields:**
- `region`: Московская область (or Подмосковье — must not assign Москва city if not stated)
- `service_type`: refinancing or secured_real_estate_loan
- `terms`: must include current rate (5% в месяц) and amount (~900 000 руб.)
- `detected_need`: must note refinancing need, commercial RE, ~900 000 RUB, Подмосковье, current rate 5%
- `freshness_status`: fresh
- `reason` sentence 2: must explain lower lead_signal_score — secondary product (refinancing/commercial RE), not primary (PTS/auto); also note commercial nature (not individual client)
- `reason` sentence 3: investigate — determine if operator handles commercial RE refinancing and can compete with 5% current rate

**Pass criteria:** lead_signal_score between 40 and 70 (not high, not zero), recommended_action = investigate, reason explains secondary product status, region = Подмосковье or МО (NOT Москва), terms contains rate.

---

## Scoring Summary Table (Expected Ranges)

| Record | entity_type | recommended_action | quality_score | lead_signal | comp_strength | content_idea |
|--------|------------|-------------------|---------------|-------------|---------------|--------------|
| 1 — Strong lead | lead_signal | contact | 80–92 | 85–95 | 1 | 20–40 |
| 2 — Weak lead | lead_signal | monitor/investigate | 25–45 | 25–45 | 1 | 30–55 |
| 3 — Active competitor | competitor | monitor | 78–90 | 1 | 82–95 | 15–35 |
| 4 — RE landing page | competitor | monitor | 65–80 | 1 | 65–82 | 20–40 |
| 5 — Content idea | content_idea | create_content | 65–80 | 1–15 | 1 | 78–92 |
| 6 — SEO boilerplate | irrelevant | ignore | 1 | 1 | 1 | 1 |
| 7 — Refinancing edge | lead_signal | investigate | 50–68 | 45–65 | 1 | 20–40 |

---

## What These Tests Validate

**Priority order:** Records 1 and 2 confirm that v2 applies the lead-first priority and distinguishes strong from weak signals.

**Competitor framework:** Records 3 and 4 confirm that competitor_strength reflects actual threat (rate + region + activity), not just brand recognition.

**Content intelligence:** Record 5 confirms that offer_text contains a proposed content angle, not a source description.

**Skip logic:** Record 6 confirms that boilerplate triggers status=skipped with all scores = 1.

**Product hierarchy:** Record 7 confirms that secondary products (refinancing, commercial) receive lower lead scores and investigate action rather than contact.

**Evidence citation:** All 7 records require that the reason field cites specific phrases from the input text.

**Anti-hallucination:** Records 4 and 7 test whether Claude invents rates or regions not stated in the text.
