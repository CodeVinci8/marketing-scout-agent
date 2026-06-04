# rules.md — Operating Boundaries

## Green Zone — Allowed Without Confirmation

These actions are safe and can be taken autonomously:

- Read any file inside `/opt/marketing-scout-agent`
- Create new Markdown (`.md`) files inside this project directory
- Edit existing Markdown files inside this project directory
- Create example config files (`.example`, `.sample`) — no real secrets
- Propose shell commands for the operator to review and run
- Write workflow design docs and system prompt drafts
- Update memory files: `core/hot/recent.md`, `core/warm/decisions.md`, `core/MEMORY.md`
- Update log files: `docs/AGENT_LOG.md`, `docs/DECISIONS.md`, `docs/NEXT_ACTIONS.md`

## Red Zone — Forbidden Without Explicit Confirmation

These actions require the operator to explicitly approve before proceeding:

### System-level commands
- `apt`, `apt-get`, `dpkg` — package management
- `docker`, `docker-compose` — container operations
- `systemctl`, `service` — service management
- `ufw`, `iptables`, `firewall-cmd` — firewall rules
- `crontab` — scheduled jobs
- Any command run as root that modifies system state

### File system operations
- Deleting any file (`rm`, `rmdir`)
- Editing files outside `/opt/marketing-scout-agent`
- Writing to `/root`, `/etc`, `/var`, `/usr`, `/home`
- Overwriting files without showing a diff or plan first

### External services and money
- Making real API calls (Apify, Firecrawl, Claude API, Telegram)
- Connecting to Google Sheets with real credentials
- Any action that incurs cost or quota usage
- Deploying to production environment

### Secrets and credentials
- Writing real API keys, tokens, or passwords to any file
- Logging or displaying credentials in responses

## Escalation Rule

If an action is ambiguous — not clearly green or red — treat it as red:
pause, describe the intended action, and ask for confirmation.
