# ARCHITECTURE.md — System Design

## Pipeline Overview

```
VPS (Ubuntu 24.04)
└── Docker
    └── n8n (self-hosted)
        │
        ├── [1] Manual Trigger
        │       Operator starts the run
        │
        ├── [2] Set Search Config
        │       Define: keywords, sources, platforms, thresholds
        │
        ├── [3a] Start Apify Actor Run
        │       POST to Apify API → receive run_id + dataset_id
        │
        ├── [3b] Wait (30–60 sec)
        │       Fixed delay — actor finishes scraping
        │
        ├── [3c] Fetch Apify Dataset Items
        │       GET dataset → returns array of scraped items
        │       (if empty: wait more and retry manually in v0.1)
        │
        ├── [4] Split Out / Loop Over Items
        │       Convert results array → one item per execution path
        │       Required: all downstream nodes operate on single items
        │
        ├── [5] Normalize Item
        │       Map raw fields → standard schema (see TABLE_SCHEMA.md)
        │       Compute freshness_status, truncate text_context
        │
        ├── [6] Claude API Analysis
        │       POST to Claude API with system prompt + normalized text
        │       Returns: entity_type, detected_need, scores, recommended_action
        │       Parse response content[0].text as JSON
        │
        ├── [7] IF quality_score >= threshold
        │       Branch: PASS → continue | FAIL → feed into aggregation
        │
        ├── [8] Google Sheets — Append Row
        │       Write full scored record to output sheet (PASS items only)
        │
        ├── [9] Aggregate Results (Code Node)
        │       Runs once after all items processed
        │       Computes: TOTAL_COUNT, PASSED_COUNT, DISCARDED_COUNT, TOP_ITEMS_SUMMARY
        │
        └── [10] Telegram — Send Summary
                Deliver session stats to operator
```

---

## Component Roles

| Component      | Role                                                        |
|----------------|-------------------------------------------------------------|
| VPS            | Compute host for all services                               |
| Docker         | Container runtime for n8n                                   |
| n8n            | Orchestrator — connects all pipeline steps                  |
| Apify          | Actor-based scraping (Avito, websites, social)              |
| Firecrawl      | Clean Markdown extraction from web pages (alternative path) |
| Claude API     | Structured analysis and scoring of scraped items            |
| Google Sheets  | Persistent output storage with schema                       |
| Telegram Bot   | Operator notification after each pipeline run               |

---

## Data Flow

```
Apify Actor Run (start)
    ↓ (wait 30–60 sec)
Apify Dataset (array of raw items)
    ↓ (Split Out node)
Individual Raw Item
    ↓ (Normalize)
Normalized Item (standard fields + freshness_status)
    ↓ (Claude API)
Scored Record (+ entity_type, scores, recommended_action)
    ↓ (IF filter)
  PASS → Google Sheets row appended
  FAIL → counted as discarded
    ↓ (after all items: Aggregate node)
Summary stats (TOTAL / PASSED / DISCARDED / TOP_ITEMS)
    ↓
Telegram notification → operator
```

---

## Key Implementation Notes

### Why Split Out is Required
Apify returns a JSON array of items. n8n processes items individually through most node types.
Without a `Split Out` node between the dataset fetch and the normalize step, only the first
item would be processed. `Split Out` unpacks the array so each item travels through the
pipeline independently.

### Apify Integration — v0.1 Approach
v0.1 uses a simple **start → wait → fetch** pattern:
1. POST to start the actor run
2. Fixed Wait node (30–60 sec)
3. GET the dataset items

If the dataset is empty (actor still running), manually wait and re-trigger the fetch node.
A proper polling loop or webhook callback is deferred to v0.2.

### Credentials — Never in Expressions
All API credentials (Apify, Claude API, Google Sheets, Telegram) are stored exclusively
in the **n8n Credentials UI**. They are attached to nodes via the credential picker.
The syntax `{{ $credentials.x.y }}` is NOT valid in n8n — do not use it.

### Accessing n8n — SSH Tunnel (v0.1)
n8n is not exposed publicly in v0.1. Access the UI via SSH tunnel:
```
ssh -L 5678:localhost:5678 user@your-vps-ip
```
Then open `http://localhost:5678` in a local browser.
Public HTTPS access is deferred until webhooks or OAuth require it.

---

## Credentials Management

All credentials (API keys, tokens, OAuth) are stored **only in n8n's built-in
credential manager**. They are never written to project files, scripts, or docs.

Placeholder format used in example files: `YOUR_API_KEY_HERE`

---

## Deployment Notes

- n8n runs as a Docker container on the VPS
- Persistent volume mounted for n8n data (workflows, credentials, executions)
- Access via SSH tunnel in v0.1 — no public domain or reverse proxy needed
- Public HTTPS/domain deferred until webhooks or OAuth integrations require inbound access
- All scraping is outbound only — no inbound ports required for the pipeline itself
