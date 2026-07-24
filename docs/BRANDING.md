# BRANDING.md — Vinci AI Pilot naming contract

## Canonical names

| Purpose | Value |
|---|---|
| Public product name | **Vinci AI Pilot** |
| Repository slug / path-safe identifier | `Vinci-Ai-Pilot` |
| GitHub repository | `https://github.com/CodeVinci8/Vinci-Ai-Pilot` |
| Bot self-identification (RU) | «Я Vinci AI Pilot — …» |

“Marketing Scout” / “Marketing Scout Agent” is the **former** product name. It must not appear in any
product-facing surface: README, current architecture docs and runbooks, bot texts, report titles, generated
file names, prompts, UI labels, deployment documentation, or the canonical Stage F / F.5 / G documents.

## Technical legacy aliases (NOT the product name — do not rename)

These strings still contain `marketing-scout` / `marketing_scout` / `Marketing Scout` because they are **stable
machine identifiers bound to live installations**. Renaming any of them would break a real binding, not a label.
They are legacy aliases, kept deliberately.

| Identifier | Where | Why it stays |
|---|---|---|
| `Google Sheets - Marketing Scout Service Account` | n8n credential name (prod id-bound) | The credential NAME is part of the live n8n credential record. A rename would have to be done in n8n and re-bound across every workflow; credential changes are explicitly out of scope. |
| `Claude API - Marketing Scout`, `Firecrawl API - Marketing Scout`, `Apify API - Marketing Scout` | n8n credential names | Same as above. |
| `marketing-scout-webhook-proxy.service`, `ngrok-marketing-scout.service` | systemd units on the VPS | Renaming a unit is a system-service change; the running Telegram ingress depends on it. Only migrate together with a deliberate directory migration. |
| `/opt/marketing-scout-agent` | repository path on the VPS | Referenced by the systemd unit `ExecStart`, runbooks and backup scripts. Internal, never user-visible. See “Directory migration” below. |
| `marketing_scout_bootstrap` | Google Sheets `developerMetadata` key | Written into the live spreadsheet as the contract marker. Changing the key would orphan the existing marker. |
| `Marketing Scout Results` | Google Sheets spreadsheet title | Live storage artifact, internal, referenced by id not by name. |
| `marketing-scout/<contract>/v1` | schema strings (`runtime-ids`, `workflow-inventory`, `release-evidence`, `env-discovery`, `wf18-blockers`) | Versioned contract identifiers consumed by tooling and persisted evidence. |
| `marketing-scout-v<N>-<slug>` | n8n workflow `meta.instanceId` | Stable per-workflow machine identifier. |
| `modules/marketing-scout-v0/` | archived v0 prompt/design module | Historical record. |
| `marketing_scout_report_*.xlsx/.csv/.svg` under `release-evidence/` and quoted in continuity files | past run evidence | Immutable historical evidence. Never rewritten to hide the old name. |

## What the rename DID change

* `README.md`, `CLAUDE.md`, `Makefile`, `docs/PROJECT_BRIEF.md`, `docs/ROADMAP.md` — product prose and titles.
* Bot self-identification in `n8n/lib/plan_render_ru.js` (`/start` welcome, «кто ты?» reply) — now
  «Я Vinci AI Pilot …», matching `n8n/lib/agent_identity.js`, which already used the canonical name.
* **User-visible generated file names** (BRAND-001), because they are delivered to the user in Telegram:
  * XLSX attachment: `marketing_scout_<report_id>_report.xlsx` → `vinci_ai_pilot_<report_id>_report.xlsx`
    (`n8n/lib/report_package.js`)
  * CSV exports: `marketing_scout_…` → `vinci_ai_pilot_…` (`n8n/lib/report_export.js`)
  * SVG charts: `marketing_scout_…` → `vinci_ai_pilot_…` (`n8n/lib/report_charts.js`)
* Git remote `origin` → `https://github.com/CodeVinci8/Vinci-Ai-Pilot.git` (URL only; no history rewritten).

Historical evidence, past execution records and continuity quotations were **not** rewritten.

## Directory migration (deliberately NOT performed)

Moving the working copy to `/opt/Vinci-Ai-Pilot` would require editing the systemd unit `ExecStart`/
`WorkingDirectory`, reloading the daemon and restarting the live Telegram webhook proxy. The path is an internal
machine identifier that no user ever sees, so the change carries production risk for zero product benefit and is
**not** part of the branding milestone. If it is ever done, it must be its own clean mini-migration:
inventory hardcoded paths → back up the units → update `ExecStart`/`WorkingDirectory` → update scripts and
runbooks → ensure exactly one webhook proxy runs → `daemon-reload` → restart only the Vinci AI Pilot proxy →
verify the Telegram webhook and n8n health → remove the old path only after verification succeeds.
