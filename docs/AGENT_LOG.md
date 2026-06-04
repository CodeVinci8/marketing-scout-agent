# AGENT_LOG.md — Session Log

One entry per session that produces tangible output.
Most recent first.

---

## 2026-06-04 — n8n Successfully Deployed on VPS

**Agent role:** project-engineer
**Session goal:** Record confirmed n8n deployment and update all related documentation.

**Deployment confirmed:**
- Container `n8n-n8n-1` running — port binding `127.0.0.1:5678->5678/tcp`
- Access verified via SSH tunnel → `http://localhost:5678` in local browser
- Execution pruning added to `n8n.env`:
  - `EXECUTIONS_DATA_PRUNE=true`
  - `EXECUTIONS_DATA_MAX_AGE=168`
  - `EXECUTIONS_DATA_PRUNE_MAX_COUNT=1000`
- Disk after launch: ~1.4G free, 86% used — acceptable for MVP, upgrade deferred

**Files updated:**
- `docs/AGENT_LOG.md` — this entry
- `docs/NEXT_ACTIONS.md` — Step 3 marked complete; Step 6 updated with first workflow action
- `docs/DECISIONS.md` — added DEC-013 (disk constraint), DEC-014 (execution pruning)
- `tools/TOOLS.md` — n8n status updated to Active with deployment details
- `docs/N8N_DEPLOYMENT.md` — added Deployment Status section and disk warning

**Decisions recorded:** DEC-013, DEC-014

**Next session should start with:** `core/hot/recent.md` → `docs/NEXT_ACTIONS.md`

---

## 2026-06-04 — n8n Deployment Templates Created

**Agent role:** project-engineer
**Session goal:** Prepare n8n deployment templates for v0.1 — localhost-only, SSH tunnel access, no real secrets.

**Files created:**
- `scripts/docker-compose.n8n.example` — minimal Docker Compose for n8n: localhost port binding, n8n_data volume, env_file reference, commented
- `scripts/n8n.env.example` — all required env vars with MVP-safe values; placeholder for N8N_ENCRYPTION_KEY with generation instruction
- `docs/N8N_DEPLOYMENT.md` — full deployment guide: SSH tunnel rationale, copy steps, key generation, start/logs/update commands, what not to commit, future HTTPS path

**Files updated:**
- `docs/DECISIONS.md` — added DEC-010 (localhost binding + SSH tunnel), DEC-011 (no public domain/HTTPS for v0.1), DEC-012 (real credentials outside Git)
- `docs/NEXT_ACTIONS.md` — Step 2 marked complete with deploy commands summary
- `docs/AGENT_LOG.md` — this entry

**Decisions recorded:** DEC-010, DEC-011, DEC-012

**Next session should start with:** `core/hot/recent.md` → `docs/NEXT_ACTIONS.md`

---

## 2026-06-04 — Docker Compose Installation State Documented

**Agent role:** project-engineer
**Session goal:** Record Docker Engine and Docker Compose installation state discovered on VPS.

**Context recorded:**
- Docker Engine v29.1.3 — active, 3 containers running, 39 images, overlayfs storage driver
- Docker Compose v5.1.2 — installed manually at `/usr/local/lib/docker/cli-plugins/docker-compose`
- `apt install docker-compose-plugin` failed (package not found); manual binary install used instead
- Existing containers are running — no destructive Docker cleanup without explicit approval

**Files edited:**
- `tools/TOOLS.md` — added Docker Engine and Docker Compose entries under Infrastructure with version, install method, and migration warning
- `docs/DECISIONS.md` — added DEC-009 documenting manual install decision and safety note
- `docs/NEXT_ACTIONS.md` — marked Docker/Compose checks complete; added note referencing DEC-009
- `docs/AGENT_LOG.md` — this entry

**Next session should start with:** `core/hot/recent.md` → `docs/NEXT_ACTIONS.md`

---

## 2026-06-04 — Pre-Commit Fix: Claude API Response Format

**Agent role:** project-engineer
**Session goal:** Fix broken instruction found during pre-commit review.

**Files edited:**
- `modules/marketing-scout-v0/WORKFLOW_DESIGN.md` — corrected Node 6 Output description: replaced incorrect OpenAI response format (`choices[0].message.content`) with correct Anthropic Claude API format (`content[0].text`)
- `docs/AGENT_LOG.md` — this entry

**Next session should start with:** `core/hot/recent.md` → `docs/NEXT_ACTIONS.md`

---

## 2026-06-04 — Autonomy Rules Update in CLAUDE.md

**Agent role:** project-engineer
**Session goal:** Reduce friction in CLAUDE.md while preserving server safety.

**Files edited:**
- `CLAUDE.md` — four targeted changes to operating and safety rules; new Autonomy Levels section added
- `docs/AGENT_LOG.md` — this entry

**Changes made:**
- **Operating Rules:** Replaced generic "ask before creating or editing files" with a precise rule:
  Markdown docs inside the project are autonomous; scripts, configs, Docker files, workflow exports,
  secrets, system commands, external API calls, deployment, deletion, and anything outside the project
  directory require explicit approval.
- **Forbidden list:** Replaced blanket prohibition on `scripts/`, `n8n/workflows/`, `backups/` with
  a targeted rule: real scripts/exports/backups require approval; `.example` templates are autonomous.
- **Forbidden list:** Replaced "Connecting to external APIs" with "Calling real external APIs or
  using real credentials" — tighter scope.
- **New section — Autonomy Levels:** Three-tier model (Green / Yellow / Red) with explicit item lists,
  replacing ambiguous prose with a scannable reference.

**Next session should start with:** `core/hot/recent.md` → `docs/NEXT_ACTIONS.md`

---

## 2026-06-04 — Documentation Review and Fixes

**Agent role:** project-engineer
**Session goal:** Review all foundation documents for consistency, specificity, and safety; apply approved fixes.

**Files edited:**
- `modules/marketing-scout-v0/WORKFLOW_DESIGN.md` — rewrote Node 3 as 3a/3b/3c (start actor, wait, fetch dataset); added Node 4 (Split Out) with explanation; removed invalid `{{ $credentials.x.y }}` syntax; replaced Node 5 credential note; added Node 9 (Aggregate Code node) with real JavaScript; renumbered Telegram node to 10; added response parsing note after Claude API node
- `docs/ARCHITECTURE.md` — updated pipeline diagram to 10 nodes including Split Out and Aggregate; added Key Implementation Notes section explaining Split Out, Apify v0.1 approach, credential rule, and SSH tunnel access
- `CLAUDE.md` — scoped the external API safety rule to distinguish documentation sessions (no calls) from implementation sessions (calls allowed only with explicit per-service approval)
- `modules/marketing-scout-v0/SYSTEM_PROMPT.md` — added full fallback behavior block for low-quality/boilerplate input (returns quality_score: 1, status: "skipped"); added explicit no-hallucination instruction; added `status` field to both normal and skipped JSON schemas; added response parsing code snippet for n8n
- `docs/NEXT_ACTIONS.md` — added Step 2 (prepare docker-compose.yml before running Docker); added SSH tunnel access instructions; added note that public HTTPS is deferred; renumbered steps; added docker-compose.n8n.example as next concrete action
- `docs/ROADMAP.md` — added module directory path to all 6 stages
- `docs/AGENT_LOG.md` — added this entry
- `docs/DECISIONS.md` — added DEC-006, DEC-007, DEC-008

**Issues resolved:**
- Apify polling ambiguity → simple start/wait/fetch pattern for v0.1
- Invalid n8n credential expression syntax → removed, replaced with UI credential picker instructions
- Missing loop/split node in architecture → Split Out node added at Node 4
- Telegram summary unresolved placeholders → Aggregate Code node (Node 9) computes all values
- External API rule too broad → scoped by session type
- No fallback for boilerplate input in system prompt → explicit skipped JSON block added
- NEXT_ACTIONS Step 2 missing docker-compose reference → added with SSH tunnel instructions
- Roadmap missing module directory names → added to all 6 stages

**Next session should start with:** `core/hot/recent.md` → `docs/NEXT_ACTIONS.md`

---

## 2026-06-04 — Project Structure Bootstrap

**Agent role:** project-engineer
**Session goal:** Create lightweight project-agent structure for Marketing Scout

**Files created:**
- `CLAUDE.md` — main agent instruction file
- `README.md` — project root orientation
- `core/AGENTS.md` — five future agent role definitions
- `core/USER.md` — operator profile (Nik)
- `core/rules.md` — green zone / red zone operating boundaries
- `core/MEMORY.md` — long-term memory index
- `core/hot/recent.md` — hot memory, first entry
- `core/warm/decisions.md` — five stable design decisions
- `tools/TOOLS.md` — full stack inventory with availability matrix
- `docs/PROJECT_BRIEF.md` — business goal and MVP definition
- `docs/ROADMAP.md` — six-stage roadmap
- `docs/ARCHITECTURE.md` — pipeline diagram and component roles
- `docs/AGENT_LOG.md` — this file
- `docs/DECISIONS.md` — decision register
- `docs/NEXT_ACTIONS.md` — immediate next steps
- `docs/TABLE_SCHEMA.md` — full 23-column output schema
- `docs/PROMPTS.md` — prompt version register
- `modules/marketing-scout-v0/README.md` — module overview
- `modules/marketing-scout-v0/WORKFLOW_DESIGN.md` — 8-node n8n workflow spec
- `modules/marketing-scout-v0/SYSTEM_PROMPT.md` — Claude API system prompt v1
- `modules/marketing-scout-v0/TEST_DATA.md` — 3 sample records
- `n8n/README.md` — n8n directory guide
- `scripts/backup.sh.example` — example backup script
- `scripts/restore.sh.example` — example restore script
- `backups/README.md` — backup directory guide

**Decisions made:** DEC-001 through DEC-005 (see `docs/DECISIONS.md`)

**Next session should start with:** `core/hot/recent.md` → `docs/NEXT_ACTIONS.md`
