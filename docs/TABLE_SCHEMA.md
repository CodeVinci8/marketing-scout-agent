# TABLE_SCHEMA.md — Google Sheets Output Schema

One row per analyzed item. All columns populated by the pipeline.
Claude API fills the analysis columns; n8n fills the metadata columns.

---

## Column Reference

| # | Column Name          | Type     | Source       | Description                                                    |
|---|----------------------|----------|--------------|----------------------------------------------------------------|
| 1 | `created_at`         | datetime | n8n          | Timestamp when the row was created (pipeline run time)         |
| 2 | `source_type`        | string   | n8n config   | Category of source: `competitor_site`, `avito`, `social`       |
| 3 | `platform`           | string   | n8n config   | Platform name: `avito`, `vk`, `instagram`, `website`, etc.     |
| 4 | `source_url`         | string   | scraper      | URL of the scraped page or listing                             |
| 5 | `parsed_at`          | datetime | n8n          | Timestamp when the item was scraped                            |
| 6 | `published_at`       | datetime | scraper      | Original publish date of the content (if available)            |
| 7 | `freshness_status`   | string   | Claude/n8n   | `fresh` (< 7 days) / `recent` (7–30 days) / `stale` (> 30d)  |
| 8 | `entity_type`        | string   | Claude       | `competitor` / `lead` / `content_source` / `unknown`           |
| 9 | `company_name`       | string   | Claude       | Name of company or business if detected                        |
|10 | `profile_name`       | string   | Claude       | Name of individual or profile if detected                      |
|11 | `profile_url`        | string   | scraper      | Direct link to profile or author page                          |
|12 | `region`             | string   | Claude       | Geographic region or city mentioned                            |
|13 | `service_type`       | string   | Claude       | Type of service or product offered/needed                      |
|14 | `offer_text`         | string   | Claude       | Short extracted description of the offer or listing            |
|15 | `terms`              | string   | Claude       | Price, conditions, delivery terms if mentioned                 |
|16 | `contact_public`     | string   | Claude       | Public contact info: phone, email, Telegram handle (if visible)|
|17 | `text_context`       | string   | n8n          | First 500 characters of raw source text (for reference)        |
|18 | `detected_need`      | string   | Claude       | Inferred need or intent of the author                          |
|19 | `competitor_strength`| string   | Claude       | `strong` / `moderate` / `weak` / `not_applicable`             |
|20 | `lead_signal_score`  | integer  | Claude       | 0–10: likelihood this item represents an inbound lead          |
|21 | `content_idea_score` | integer  | Claude       | 0–10: potential value as a content idea inspiration            |
|22 | `quality_score`      | integer  | Claude       | 0–10: overall quality and actionability of this item           |
|23 | `reason`             | string   | Claude       | 1–2 sentence explanation of the scores                         |
|24 | `recommended_action` | string   | Claude       | Suggested next step: `contact`, `monitor`, `create_content`, `ignore` |
|25 | `status`             | string   | operator     | Manual status update: `new` / `in_progress` / `done` / `skip` |

---

## Notes

- Rows with `quality_score < 6` are filtered out by the IF node and not written to the sheet.
- `text_context` is truncated to 500 chars to keep the sheet readable.
- `contact_public` stores only publicly visible contact info — no scraping of private data.
- `status` column is filled manually by the operator after reviewing results.
- `published_at` may be empty if the scraper cannot determine the publish date.
