# N8N_WORKFLOW_03_FIRECRAWL_SINGLE_URL_RU.md — Workflow 03: Firecrawl один URL → устойчивый анализатор

**Файл workflow:** `n8n/workflows/03_firecrawl_single_url_resilient.json`
**Имя в n8n:** `03 - Firecrawl Single URL to Resilient Analyzer`
**Дата:** 2026-06-07
**Статус:** Готов к ручному тесту. НЕ активировать.

---

## 1. Назначение

Первый рабочий процесс с **реальным источником**. Берёт ОДИН публичный URL конкурента,
скрапит его через Firecrawl (только markdown), превращает в запись-источник и прогоняет через
тот же устойчивый анализатор, что и Workflow 02 (Claude → разбор JSON → при сбое ремонт-проход →
нормализация → динамический маршрут в Google Sheets).

Это **не** crawl, **не** batch, **не** расписание. Один URL за один ручной запуск.

**Поток нод:**

```
Manual Start
  → Set Firecrawl URL            (единственное место, где меняется target_url)
  → Build Firecrawl Request      (формирует тело запроса /v2/scrape)
  → Firecrawl Scrape API         (POST, onError=continue)
  → Normalize Firecrawl Output   (markdown → запись; при сбое → строка technical_errors)
  → IF Firecrawl Normalized OK?
       ├─ OK (route пусто)  → Build Primary Claude Request → … → Normalize + Route → Append
       └─ Сбой (route=technical_errors) → Append to Dynamic Route Sheet  (без вызова Claude)
```

Анализатор (Build Primary Claude Request … Normalize + Route) — это копия продакшн-нод из
`02_claude_api_single_record_v2_resilient_router_production.json`. Подворкфлоу пока НЕ вызывается;
ноды скопированы внутрь, чтобы workflow был самостоятельным и импортируемым.

---

## 2. Требуемые креденшлы (по имени)

| Назначение | Имя креденшла в n8n | Тип |
|------------|----------------------|-----|
| Firecrawl | `Firecrawl API - Marketing Scout` | HTTP Header Auth |
| Claude (оба HTTP-нода) | `Claude API - Marketing Scout` | HTTP Header Auth |
| Google Sheets | `Google Sheets - Marketing Scout Service Account` | Service Account (googleApi) |

В файле — только имена и плейсхолдеры (`PASTE_CREDENTIAL_ID_HERE`, `PASTE_SPREADSHEET_ID_HERE`).
Реальные ключи и Spreadsheet ID хранятся только в n8n, в файл не коммитятся.

---

## 3. Как создать креденшл Firecrawl (Header Auth)

1. n8n → **Credentials → New → Header Auth**.
2. Имя: `Firecrawl API - Marketing Scout`.
3. **Header Name:** `Authorization`
4. **Header Value:** `Bearer <FIRECRAWL_API_KEY>` (вставить реальный ключ вместо `<FIRECRAWL_API_KEY>`).
5. (Если доступно) ограничить домен: **Allowed domain = `api.firecrawl.dev`**.
6. Сохранить и привязать к ноде `Firecrawl Scrape API`.

---

## 4. Требуемые 6 вкладок и 33-колоночный заголовок

Динамическая нода Append пишет в одну из шести вкладок по полю `route`. **Все 6 вкладок должны
существовать заранее** (нода не создаёт отсутствующие вкладки) и иметь **одинаковый 33-колоночный
заголовок** (см. `docs/TABLE_SCHEMA.md`):

Вкладки: `results`, `review_queue`, `monitor_queue`, `content_queue`, `skipped_log`, `technical_errors`.

33 колонки (порядок): 25 основных + 8 технических —
`created_at, source_type, platform, source_url, parsed_at, published_at, freshness_status, entity_type,
company_name, profile_name, profile_url, region, service_type, offer_text, terms, contact_public,
text_context, detected_need, competitor_strength, lead_signal_score, content_idea_score, quality_score,
reason, recommended_action, status, processing_status, parse_method, parse_error, raw_response_preview,
route, needs_manual_review, repair_used, repair_status`.

Заголовки — внутренние английские имена. Русские названия — задача будущего слоя отчётов/Telegram.

---

## 5. Импорт

1. n8n → **Workflows → ⋮ → Import from File**.
2. Выбрать `n8n/workflows/03_firecrawl_single_url_resilient.json`.
3. Проверить, что `active = false` (тумблер выключен).

---

## 6. Настройка нод

1. **Firecrawl Scrape API** → Credential = `Firecrawl API - Marketing Scout`.
2. **Claude Primary API Request** и **Claude Repair API Request** → Credential = `Claude API - Marketing Scout`.
3. **Append to Dynamic Route Sheet** → Credential = `Google Sheets - Marketing Scout Service Account`;
   **Document ID** = реальный Spreadsheet ID (заменить `PASTE_SPREADSHEET_ID_HERE`);
   **Sheet Name** оставить выражением `={{ $json.route }}`.

---

## 7. Как выбрать первый URL

- Одна **публичная** страница конкурента по залоговому кредитованию (ПТС / авто / недвижимость).
- Желательно страница с услугой: ставки, сроки, скорость одобрения, контакты, Москва/МО.
- Не закрытая логином, не капча, не PDF.
- Вставить URL в ноду **Set Firecrawl URL → поле `target_url`**. Это единственное место правки URL.

---

## 8. Как запустить ручной тест

1. Записать **баланс Firecrawl** и **баланс Claude ДО** (см. `docs/COSTS_AND_LIMITS.md`).
2. Открыть workflow → **Execute Workflow** (ручной запуск).
3. Дождаться завершения.
4. Записать **баланс ПОСЛЕ**, посчитать дельту, занести в `docs/COSTS_AND_LIMITS.md`.

---

## 9. Ожидаемый результат

- Страница активного конкурента → строка во вкладке **`monitor_queue`**,
  `entity_type=competitor`, `recommended_action=monitor`, `processing_status=parsed_success`,
  `parse_method=primary_json` (или `repaired_json`, если сработал ремонт).
- Если Firecrawl упал или вернул пустой/непригодный markdown → строка в **`technical_errors`**,
  `parse_method=firecrawl_error`, Claude **не вызывается**.

---

## 10. Troubleshooting

| Симптом | Причина | Действие |
|---------|---------|----------|
| Firecrawl **401/403** | Неверный/просроченный ключ или нет `Bearer ` | Проверить Header Value = `Bearer <ключ>`; проверить домен креденшла |
| Firecrawl **429** | Превышен лимит/rate-limit | Подождать; не запускать повторно сразу; проверить тариф |
| Firecrawl **пустой markdown** | Страница за JS/капчей/логином или только картинки | Строка уйдёт в `technical_errors`; выбрать другой URL |
| Claude **502** | Нестабильность шлюза | Запись попадёт в `technical_errors` с Primary+Repair диагностикой; повторить позже |
| **Вкладка не найдена** | Нет одной из 6 вкладок | Создать все 6 вкладок с 33-колоночным заголовком |
| **Выражение Sheet Name отклонено** | Сборка n8n не принимает выражение в resourceLocator | Откатиться на ветвление по `route` (6 IF-нод), см. DEC-035 fallback |

---

## 11. Контроль стоимости

- Записать кредиты/баланс Firecrawl, если видны в дашборде.
- Записать баланс Claude **до** и **после** прогона; дельту занести в `docs/COSTS_AND_LIMITS.md`.
- `text_context` ограничен **6000 символов** перед Claude — контроль токенов.
- Ремонт-проход вызывается только при сбое разбора. Один URL за раз. Без расписания.

> Связано: `docs/FIRECRAWL_SETUP.md`, `docs/WORKFLOW_02_RESILIENT_OUTPUT_LAYER.md`,
> `docs/TABLE_SCHEMA.md`, `docs/COSTS_AND_LIMITS.md`, DEC-039–DEC-042.
