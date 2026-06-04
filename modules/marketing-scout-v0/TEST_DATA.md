# TEST_DATA.md — Sample Records for Pipeline Testing

Three sample records representing the main source types.
Use these to test the n8n workflow and evaluate the Claude API system prompt.

Run with `quality_threshold = 1` during testing to pass all items through the filter.

---

## Record 1 — Competitor Website

**Source type:** `competitor_site`
**Platform:** `website`
**Source URL:** `https://webstudio-example.ru/services`
**Published at:** (unknown)
**Text context:**
```
Веб-студия «Пример» — создаём сайты под ключ с 2015 года. Разработка лендингов от 30 000 ₽,
корпоративные сайты от 80 000 ₽. Команда 12 специалистов: дизайнеры, разработчики, SEO.
Портфолио: 200+ проектов. Работаем по договору, предоплата 50%. Контакт: info@webstudio-example.ru
```

**Expected Claude output (approximate):**
```json
{
  "entity_type": "competitor",
  "company_name": "Веб-студия Пример",
  "region": "",
  "service_type": "веб-разработка",
  "offer_text": "Разработка сайтов под ключ: лендинги от 30 000 ₽, корпоративные от 80 000 ₽",
  "terms": "предоплата 50%",
  "contact_public": "info@webstudio-example.ru",
  "competitor_strength": "strong",
  "lead_signal_score": 1,
  "content_idea_score": 6,
  "quality_score": 7,
  "recommended_action": "monitor"
}
```

---

## Record 2 — Avito Listing

**Source type:** `avito`
**Platform:** `avito`
**Source URL:** `https://www.avito.ru/moskva/uslugi/sozdam_sait_dlya_vashego_biznesa_123456789`
**Published at:** 2026-06-01
**Text context:**
```
Создам сайт для вашего бизнеса за 3 дня. Лендинг под ключ: дизайн + верстка + домен + хостинг.
Цена: 15 000 ₽. Опыт 5 лет, 80+ проектов. Пишите в WhatsApp: +7-999-123-45-67.
Нахожусь в Москве, работаю удалённо по всей России.
```

**Expected Claude output (approximate):**
```json
{
  "entity_type": "competitor",
  "company_name": "",
  "profile_name": "(freelancer)",
  "region": "Москва",
  "service_type": "веб-разработка, лендинги",
  "offer_text": "Лендинг под ключ за 3 дня включая дизайн, верстку, домен и хостинг за 15 000 ₽",
  "terms": "15 000 ₽, 3 дня",
  "contact_public": "+7-999-123-45-67 (WhatsApp)",
  "competitor_strength": "moderate",
  "lead_signal_score": 2,
  "content_idea_score": 5,
  "quality_score": 6,
  "recommended_action": "monitor"
}
```

---

## Record 3 — Social Media Comment

**Source type:** `social`
**Platform:** `vk`
**Source URL:** `https://vk.com/wall-12345678_901`
**Published at:** 2026-06-03
**Text context:**
```
Подскажите, кто делал сайт для малого бизнеса? Нужен интернет-магазин для продажи мёда,
бюджет около 50 000 ₽. Важно чтобы был мобильный вид и форма заказа. Желательно на Тильде
или Битриксе. Срочно нужно, планируем запуск через месяц.
```

**Expected Claude output (approximate):**
```json
{
  "entity_type": "lead",
  "company_name": "",
  "profile_name": "(VK user)",
  "region": "",
  "service_type": "интернет-магазин",
  "offer_text": "Ищет исполнителя для создания интернет-магазина для продажи мёда",
  "terms": "бюджет 50 000 ₽, срок запуска 1 месяц",
  "contact_public": "",
  "detected_need": "Клиент ищет разработчика интернет-магазина на Тильде или Битриксе с бюджетом 50 000 ₽",
  "competitor_strength": "not_applicable",
  "lead_signal_score": 9,
  "content_idea_score": 4,
  "quality_score": 8,
  "recommended_action": "contact"
}
```

---

## Testing Checklist

For each record, verify after running through the pipeline:

- [ ] Claude returns valid JSON (no parsing errors)
- [ ] All required fields present and non-null
- [ ] `entity_type` matches expected category
- [ ] `quality_score` passes threshold (when threshold = 1, all 3 should pass)
- [ ] Google Sheets row created with correct column mapping
- [ ] Telegram summary sent after all 3 items processed
