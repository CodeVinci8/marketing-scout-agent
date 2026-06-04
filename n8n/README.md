# n8n/ — Workflow Storage

This directory stores exported n8n workflow JSON files and related documentation.

## Structure

```
n8n/
├── workflows/     ← Exported workflow JSON files go here
└── README.md      ← This file
```

## Workflow Naming Convention

```
{module}-{version}-{trigger-type}.json
```

Examples:
- `marketing-scout-v0-manual.json`
- `marketing-scout-v1-scheduled.json`

## How to Export a Workflow from n8n

1. Open the workflow in n8n UI
2. Click the three-dot menu (top right)
3. Select "Download" or "Export"
4. Save the JSON file to `n8n/workflows/`
5. Commit to version control (when Git is set up)

## How to Import a Workflow into n8n

1. Open n8n UI
2. Click "Add workflow" → "Import from file"
3. Select the JSON file from `n8n/workflows/`
4. Review and activate the workflow

## Notes

- Credentials are NOT exported with workflows — they stay in n8n only.
- After import, re-link all credential references in the workflow nodes.
- Keep workflow exports up to date after any significant change.
- Workflow design specs live in `modules/*/WORKFLOW_DESIGN.md` — not here.
