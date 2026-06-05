# WORKFLOW_DESIGN.md — Marketing Scout v0.1 n8n Workflow

## Workflow Overview

**Name:** marketing-scout-v0-manual
**Trigger:** Manual
**Purpose:** Scrape → Split → Normalize → Analyze → Score → Aggregate → Store → Notify

---

## Node-by-Node Specification

### Node 1 — Manual Trigger

**Type:** n8n built-in `Manual Trigger`
**Purpose:** Starts the pipeline run on operator demand.
**Output:** Passes execution to Node 2 with no data payload.
**Notes:** In v0.2, this will be replaced with a Schedule (cron) trigger.

---

### Node 2 — Set Search Config

**Type:** `Set` node
**Purpose:** Define all run parameters in one place for easy adjustment.
**Fields to set:**

| Field               | Example Value                    | Description                          |
|---------------------|----------------------------------|--------------------------------------|
| `keywords`          | `["веб-разработка", "сайт"]`     | Search keywords (array)              |
| `platforms`         | `["avito", "competitor_site"]`   | Target platforms for this run        |
| `target_urls`       | `["https://competitor.ru"]`      | Competitor URLs to scrape            |
| `quality_threshold` | `60`                             | Minimum quality_score to pass filter (1–100 scale) |
| `max_items`         | `20`                             | Max items to process per run         |
| `run_id`            | `={{$now.toISO()}}`              | Unique run identifier                |

**Output:** Config object passed to all downstream nodes via `$json`.

---

### Node 3a — Start Apify Actor Run

**Type:** `HTTP Request` node
**Purpose:** Trigger an Apify actor to start scraping.
**Method:** POST
**URL:** `https://api.apify.com/v2/acts/ACTOR_ID/runs?token=APIFY_API_TOKEN`

> **Credentials:** Do NOT hardcode the API token in the URL or body.
> Store the Apify API key in **n8n Credentials UI** (type: Header Auth or Generic Credential).
> Reference it via the node's credential picker — not via `{{ $credentials.x.y }}` expressions,
> which are not valid n8n expression syntax.

**Body:**
```json
{
  "startUrls": [{ "url": "{{ $json.target_urls[0] }}" }],
  "maxItems": {{ $json.max_items }}
}
```
**Output:** `{ "data": { "id": "RUN_ID", "defaultDatasetId": "DATASET_ID" } }`

---

### Node 3b — Wait (30–60 seconds)

**Type:** `Wait` node
**Purpose:** Give the Apify actor time to complete before fetching results.
**Duration:** 30–60 seconds (adjust based on actor speed)

**v0.1 approach — simple wait:**
Use a fixed Wait node. If the actor has not finished when results are fetched,
retry the fetch manually in the n8n UI. Complex polling logic is deferred to v0.2.

**Future improvement (v0.2+):** Replace with a polling loop:
`HTTP Request (check run status)` → `IF status == SUCCEEDED` → fetch dataset
OR use an Apify webhook that triggers a separate n8n webhook node on completion.

---

### Node 3c — Fetch Apify Dataset Items

**Type:** `HTTP Request` node
**Purpose:** Retrieve the scraped items from the Apify dataset.
**Method:** GET
**URL:** `https://api.apify.com/v2/datasets/DATASET_ID/items?token=APIFY_API_TOKEN&format=json`

> **Credentials:** Same rule as Node 3a — use n8n Credentials UI, not hardcoded tokens.

**Output:** Array of scraped item objects.

**If no items returned:** The actor is still running. Wait 30 more seconds and re-trigger
Node 3c manually in the n8n UI. In v0.1, this is acceptable — no retry automation needed yet.

---

### Node 4 — Split Out Items

**Type:** `Split Out` node (n8n built-in)
**Purpose:** Convert the array of scraped items into individual items for per-item processing.
**Field to split:** The array field returned by Apify (e.g. `items` or the root array)

**Why this is needed:** Apify returns an array. All downstream nodes (Normalize, Claude API,
IF filter, Google Sheets) operate on one item at a time. Without this split, the pipeline
processes only the first item or fails.

**Output:** One item per execution path, fed into Node 5.

---

### Node 5 — Normalize Item

**Type:** `Code` node (JavaScript) or `Set` node
**Purpose:** Map raw scraper output to the standard schema fields.
**Actions:**
- Set `parsed_at` = current timestamp
- Set `source_type` from config
- Truncate `raw_text` to 500 chars → `text_context`
- Compute `freshness_status` from `published_at` vs now:
  - < 7 days → `fresh`
  - 7–30 days → `recent`
  - > 30 days → `stale`
  - Unknown → `unknown`

**Output:** Normalized item with all metadata fields populated.

---

### Node 6 — Claude API Analysis

**Type:** `HTTP Request` node
**Purpose:** Send normalized item to Claude API for structured analysis.
**Method:** POST
**URL:** `https://aiprimetech.io/v1/messages`

> **Gateway note:** The project uses a Claude-compatible API gateway, not the official Anthropic endpoint.
> See DEC-018 and `tools/TOOLS.md` for confirmed gateway details.

**Headers required (add manually in HTTP Request node):**
```
anthropic-version: 2023-06-01
```
`content-type: application/json` is set automatically by n8n when body type is JSON or raw.

> **Credentials:** Use n8n **HTTP Header Auth** credential named `Claude API - Marketing Scout`.
> Header Name: `Authorization`, Header Value: `Bearer <token>`.
> Select this credential in the HTTP Request node's credential picker.
> Do NOT hardcode the token in the node body or URL.
> Do NOT use `{{ $credentials.x.y }}` expressions — that syntax is not valid in n8n.

**Body:**
```json
{
  "model": "claude-sonnet-4-6",
  "max_tokens": 1200,
  "temperature": 0.2,
  "system": "<paste system prompt text from MARKETING_AGENT_PROMPT_V1.md here>",
  "messages": [
    {
      "role": "user",
      "content": "Analyze this market record. Return JSON only.\n\n{{ JSON.stringify($json) }}"
    }
  ]
}
```

> **Active prompt:** Use the text from `modules/marketing-scout-v0/MARKETING_AGENT_PROMPT_V1.md`
> (between the START/END markers). Do not use the old `SYSTEM_PROMPT.md` — that file is superseded.
> Prompt v2 is planned; see `MARKETING_AGENT_PROMPT_V2_PLAN.md`.

**Output:** Claude response — the analysis JSON is inside the `content` array.

> **IMPORTANT — response parsing:** Do NOT use `content[0].text`. The response may include a
> `thinking` content block before the text block. Always find the text item by type:
> ```javascript
> const textItem = $json.content.find(c => c.type === 'text');
> let raw = textItem.text.trim();
> // Strip markdown fences if present
> raw = raw.replace(/^```json\s*/i, '').replace(/\s*```\s*$/, '').trim();
> const parsed = JSON.parse(raw);
> ```
> See the `Parse Claude JSON Response` Code node in Workflow 02 for the full safe implementation.

---

### Node 7 — IF quality_score >= threshold

**Type:** `IF` node
**Purpose:** Filter out low-quality items.
**Conditions (AND):**
- `{{ $json.status }}` equals `analyzed`
- `{{ $json.quality_score }}` >= `{{ $json.quality_threshold }}` (default: `60` on the 1–100 scale)

**True branch:** → Node 8 (Google Sheets)
**False branch:** → counted as discarded (feed into aggregation at Node 9)

> **Scale note:** `quality_threshold` is `60` by default (1–100 scale). The old default of `6` (0–10 scale) is obsolete.

---

### Node 8 — Google Sheets Append Row

**Type:** `Google Sheets` node
**Purpose:** Write the qualified scored record to the output sheet.
**Operation:** Append row
**Spreadsheet:** Configured via n8n Google Sheets credential + Sheet ID
**Sheet name:** `results`
**Mapping:** `autoMapInputData` — n8n matches JSON field names to column headers automatically.

> **Credentials:** Use Service Account credential named `Google Sheets - Marketing Scout Service Account`.
> The spreadsheet must be shared with the service account email as Editor.
> Do NOT use OAuth2 — see DEC-016.

> **Column header requirement:** Row 1 of sheet `results` must be a single horizontal header row
> with field names exactly matching the JSON output (case-sensitive). See DEC-017.

---

### Node 9 — Aggregate Results (Code Node)

**Type:** `Code` node (JavaScript, "Run Once for All Items" mode)
**Purpose:** Collect counts and top items across all pipeline iterations before sending the summary.

**Logic:**
```javascript
const items = $input.all();

const total = items.length;
const passed = items.filter(i => i.json.quality_score >= i.json.quality_threshold).length;
const discarded = total - passed;

const topItems = items
  .filter(i => i.json.quality_score >= i.json.quality_threshold)
  .sort((a, b) => b.json.lead_signal_score - a.json.lead_signal_score)
  .slice(0, 3)
  .map(i => `• ${i.json.offer_text} (lead: ${i.json.lead_signal_score}, quality: ${i.json.quality_score})`);

return [{
  json: {
    TOTAL_COUNT: total,
    PASSED_COUNT: passed,
    DISCARDED_COUNT: discarded,
    TOP_ITEMS_SUMMARY: topItems.join('\n') || '(none)'
  }
}];
```

**Output:** Single object with `TOTAL_COUNT`, `PASSED_COUNT`, `DISCARDED_COUNT`, `TOP_ITEMS_SUMMARY`.

---

### Node 10 — Telegram Summary

**Type:** `Telegram` node
**Purpose:** Notify operator that the run is complete.
**Operation:** Send message
**Chat ID:** Operator chat ID (stored in n8n Telegram credential)

**Message template:**
```
Marketing Scout Run Complete
{{ $now.toFormat('yyyy-MM-dd HH:mm') }}

Items scraped: {{ $json.TOTAL_COUNT }}
Items passed filter: {{ $json.PASSED_COUNT }}
Items discarded: {{ $json.DISCARDED_COUNT }}

Top signals:
{{ $json.TOP_ITEMS_SUMMARY }}

View results in Google Sheets.
```

> **Credentials:** Set up Telegram Bot token in n8n Credentials UI.
> The bot must have been started by the operator's Telegram account (send /start to the bot first).

---

## Error Handling

- Apify run failure: check n8n execution log, re-run Node 3a manually
- Apify dataset empty after wait: wait 30 more seconds, re-trigger Node 3c manually (v0.1 only)
- Claude API failure: retry once via n8n's built-in retry setting on the HTTP Request node; skip item on second failure
- Google Sheets write failure: retry once; log error in n8n execution history on second failure
- Telegram failure: log only — do not block pipeline completion

---

## Testing

Use test records from `modules/marketing-scout-v0/TEST_DATA.md` for initial validation.
Run with `max_items = 3` and `quality_threshold = 1` to pass all test items through.

For the first test, skip Nodes 3a–3c and manually inject test data via a `Set` node
placed before Node 4 (Split Out). This lets you test the analysis and storage logic
without needing a live Apify account.
