# TEST_RECORDS_V2_EXTENDED.md — Extended Test Records for Workflow 02 v2

**Version:** 1.0
**Date:** 2026-06-05
**Module:** marketing-scout-v0
**Workflow:** `n8n/workflows/02_claude_api_single_record_v2_extended_tests.json`
**Baseline:** d350069 raw JSON harness (works, Test 1 confirmed)

Tests 1–7 are documented in `TEST_RECORDS_V2.md`.
Tests 8–12 here cover uncle's business priorities: Telegram/Instagram leads and competitors,
Avito refinancing/real estate edge case, weak website competitor, and out-of-region lead.

Content_idea tests (e.g. original Test 5) are deferred to a future Content Agent — see DECISIONS.md DEC-030.

---

## Test 8 — Telegram Hot Lead (Moscow)

**test_id:** 8
**Purpose:** Verify the agent correctly identifies a strong, urgent, contactable lead from Telegram. This is the primary monetization case — a car owner with bad credit needing money today in Moscow.

**Input JSON:**
```json
{
  "source_type": "social",
  "platform": "telegram",
  "source_url": "https://t.me/zaymy_msk_test/test-record-008",
  "profile_url": "https://t.me/ivan_tg_test",
  "parsed_at": "2026-06-05",
  "published_at": "2026-06-05",
  "text_context": "Срочно нужен займ под ПТС, Toyota Land Cruiser 2017, ПТС чистый. 300 000 руб., банки отказали из-за просрочек. Деньги нужны сегодня. Москва, СВАО. Писать в личку @ivan_tg_test."
}
```

**Why this text:** All key ICP signals present. Urgency: срочно + сегодня. Bank rejection: банки отказали из-за просрочек. Region: Москва, СВАО. Product: ПТС. Amount: 300 000 руб. Collateral: 2017 Toyota, ПТС чистый. Contact: @ivan_tg_test. No internal quotes or em-dashes that could break JSON.

**Expected output:**

| Field | Expected |
|-------|----------|
| entity_type | lead_signal |
| recommended_action | contact |
| lead_signal_score | ≥ 80 |
| quality_score | ≥ 75 |
| status | analyzed |
| contact_public | @ivan_tg_test |
| region | Москва or Москва, СВАО |
| service_type | pts_loan or secured_auto_loan |
| Quality Gate | PASS (should write to Sheets) |

**Pass criteria:**
- entity_type = lead_signal ✓
- recommended_action = contact ✓
- lead_signal_score ≥ 80 ✓
- quality_score ≥ 75 ✓
- contact_public not empty ✓
- No JSON parse error ✓

**Fail conditions:**
- JSON parse failure
- entity_type ≠ lead_signal
- recommended_action ≠ contact (would mean urgency/region signals ignored)
- lead_signal_score < 70 (would mean scoring miscalibrated)

---

## Test 9 — Instagram Competitor (Moscow/MO, Strong Offer)

**test_id:** 9
**Purpose:** Verify the agent classifies a well-specified competitor Instagram post correctly. Has explicit rate, speed, bad-credit acceptance, operating area, and contact.

**Input JSON:**
```json
{
  "source_type": "social",
  "platform": "instagram",
  "source_url": "https://www.instagram.com/p/test-record-009/",
  "profile_url": "https://www.instagram.com/zaym_msk_inst/",
  "parsed_at": "2026-06-05",
  "published_at": "2026-06-04",
  "text_context": "Займы под залог авто и ПТС в Москве и МО. От 2% в месяц. Одобрение за 30 минут. Любая кредитная история. Без выходных. Офис у м. Коломенская. Контакт: @zaym_msk_inst."
}
```

**Why this text:** Explicit competitor markers. Product: авто и ПТС (direct competitor). Rate: от 2% в месяц (explicit). Speed: 30 минут. Bad-credit: любая кредитная история. Region: Москва и МО. Contact: @zaym_msk_inst. Published yesterday (fresh). No problematic characters.

**Expected output:**

| Field | Expected |
|-------|----------|
| entity_type | competitor |
| recommended_action | monitor |
| competitor_strength | ≥ 65 |
| quality_score | ≥ 65 |
| status | analyzed |
| terms | contains "2%" or "2% в месяц" |
| region | Москва or Москва и МО |
| service_type | secured_auto_loan or pts_loan |
| Quality Gate | PASS |

**Pass criteria:**
- entity_type = competitor ✓
- recommended_action = monitor ✓
- competitor_strength ≥ 65 ✓
- quality_score ≥ 65 ✓
- No JSON parse error ✓

---

## Test 10 — Avito Refinancing / Real Estate Lead (MO, Moderate Urgency)

**test_id:** 10
**Purpose:** Verify the agent handles a lower-urgency real estate refinancing lead from Moscow Oblast correctly. Has collateral and amount but no bank rejection and no "today" urgency — should get investigate, not contact.

**Input JSON:**
```json
{
  "source_type": "classified",
  "platform": "avito",
  "source_url": "https://www.avito.ru/balashikha/test-record-010",
  "profile_url": "",
  "parsed_at": "2026-06-05",
  "published_at": "2026-06-03",
  "text_context": "Авито, Балашиха: ищу рефинансирование займа под залог квартиры. Долг около 1 200 000 руб., текущая ставка 4% в месяц, хочу снизить до 2%. Есть время, рассматриваю предложения."
}
```

**Why this text:** Real estate collateral (operator product). Moscow Oblast (Balashikha). Amount: 1 200 000. No urgency — "есть время, рассматриваю предложения" is explicit low-urgency signal. Should be lead_signal but not contact-level. Service type: refinancing. No bank rejection stated. No "срочно".

**Expected output:**

| Field | Expected |
|-------|----------|
| entity_type | lead_signal |
| recommended_action | investigate |
| lead_signal_score | 50–70 |
| quality_score | 45–65 |
| status | analyzed |
| service_type | refinancing or secured_real_estate_loan |
| region | Балашиха or Московская область |
| Quality Gate | may or may not pass (depends on quality_score ≥ 60) |

**Pass criteria:**
- entity_type = lead_signal ✓
- recommended_action = investigate (NOT contact) ✓
- lead_signal_score in 50–70 range ✓
- No JSON parse error ✓

**Fail conditions:**
- recommended_action = contact (urgency signals absent — would be miscalibration)
- lead_signal_score > 75 (no urgency or bank rejection → should not be this high)

---

## Test 11 — Website Competitor Weak / Old Signal

**test_id:** 11
**Purpose:** Verify the agent does not over-score a competitor with generic language, no explicit rate, and unknown freshness. Moscow is mentioned but the offer is vague.

**Input JSON:**
```json
{
  "source_type": "scraped_web",
  "platform": "website",
  "source_url": "https://example-competitor.ru/zalogy",
  "profile_url": "",
  "parsed_at": "2026-06-05",
  "published_at": "",
  "text_context": "Займы под залог автомобиля и недвижимости. Быстро и выгодно. Без лишних документов. Работаем в Москве и регионах. Позвоните нам: +7(495)000-00-00. Индивидуальный подход."
}
```

**Why this text:** Competitor in Moscow. But: no explicit rate (only "быстро и выгодно"), no bad-credit acceptance claim, no specific speed figure, no fresh date. Classic generic landing page. Should score moderate, not high.

**Expected output:**

| Field | Expected |
|-------|----------|
| entity_type | competitor |
| recommended_action | monitor or investigate |
| competitor_strength | 40–65 |
| quality_score | 40–65 |
| freshness_status | unknown |
| status | analyzed |
| terms | empty string (no explicit rate) |
| Quality Gate | borderline — depends on quality_score |

**Pass criteria:**
- entity_type = competitor ✓
- competitor_strength ≤ 65 (generic offer, no rate) ✓
- terms = "" or terms does not contain a specific number ✓
- No JSON parse error ✓

**Fail conditions:**
- competitor_strength ≥ 80 (over-scoring a weak/generic offer)
- terms containing a made-up rate (hallucination)

---

## Test 12 — Out-of-Region Lead (St. Petersburg)

**test_id:** 12
**Purpose:** Verify the agent applies the region cap correctly. Strong urgency signals but explicit St. Petersburg location — lead_signal_score must not exceed 40.

**Input JSON:**
```json
{
  "source_type": "classified",
  "platform": "avito",
  "source_url": "https://www.avito.ru/spb/test-record-012",
  "profile_url": "",
  "parsed_at": "2026-06-05",
  "published_at": "2026-06-04",
  "text_context": "Авито, Санкт-Петербург: срочно нужен займ под залог ПТС, автомобиль Kia Rio 2019. 150 000 руб., банки отказали. Санкт-Петербург, Невский район. Тел. +7(921)555-00-11."
}
```

**Why this text:** All the urgency and product signals of a hot lead — but in St. Petersburg, explicitly stated twice. The prompt has a hard cap: other region → lead_signal_score ≤ 40. This tests whether the region rule is correctly enforced even when all other signals are strong.

**Expected output:**

| Field | Expected |
|-------|----------|
| entity_type | lead_signal or irrelevant |
| recommended_action | investigate or ignore |
| lead_signal_score | ≤ 40 |
| quality_score | ≤ 50 |
| region | Санкт-Петербург |
| status | analyzed or skipped |
| Quality Gate | FAIL (must not reach Sheets as a hot lead) |

**Pass criteria:**
- lead_signal_score ≤ 40 ✓ (region cap enforced)
- recommended_action ≠ contact ✓
- region = Санкт-Петербург ✓
- No JSON parse error ✓

**Fail conditions:**
- lead_signal_score > 40 (region cap ignored)
- recommended_action = contact (would route an out-of-region person to operator — wrong)
- quality_score > 60 AND Quality Gate passes (would pollute Sheets with out-of-region records)

---

## Summary Table

| test_id | Platform | Scenario | Expected entity_type | Expected action | Key check |
|---------|----------|----------|---------------------|-----------------|-----------|
| 8 | Telegram | Hot lead, Moscow, PTS, srochno | lead_signal | contact | lead_signal_score ≥ 80 |
| 9 | Instagram | Competitor, MO, explicit rate | competitor | monitor | competitor_strength ≥ 65 |
| 10 | Avito | Refinancing MO, moderate urgency | lead_signal | investigate | action ≠ contact |
| 11 | Website | Weak generic competitor, Moscow | competitor | monitor | competitor_strength ≤ 65 |
| 12 | Avito | Out-of-region SPb lead | lead_signal / irrelevant | investigate / ignore | lead_signal_score ≤ 40 |

---

## Why content_idea is not in this set

Content_idea tests are deferred. The current Quality Gate (status=analyzed AND quality_score≥60) is tuned for lead and competitor records. A typical content_idea record with quality_score 65-75 passes the gate and gets written to Sheets — but the Sheets schema has no column for the content team to act on it, and the operator's workflow does not yet include a content review step.

Content_idea support will be added in Stage 3 (Content Agent), with a separate Sheets tab and a separate Quality Gate threshold. See ROADMAP.md.
