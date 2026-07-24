# Vinci AI Pilot — установка, активация, эксплуатация, бэкап, восстановление, откат

Практическое операторское руководство. Детальные раннеры — в `docs/STAGE_F_RUNBOOK.md`,
`docs/MVP_LIVE_ROLLOUT_RUNBOOK.md`, `docs/N8N_DEPLOYMENT.md`, `docs/DEPLOYMENT_BINDING.md`.

> **Правила безопасности (из `CLAUDE.md`).** Агент НЕ запускает `apt`/`docker`/`systemctl`/`ufw`/`iptables`,
> не редактирует пути вне проекта, не использует реальные секреты в файлах, не деплоит в прод без явного
> одобрения. Команды ниже — для оператора; агент их только предлагает.

## 1. Предпосылки

- VPS Ubuntu 24.04, Docker, self-hosted n8n (образ закреплён — см. `docs/N8N_VERSION_PINNING.md`).
- Google-таблица с 44 табами-контрактами (`config/sheets_contracts.json`).
- Credentials в n8n: Google Sheets, Claude, (опц.) Firecrawl/Apify/VK/Telegram.
- Окружение `/opt/n8n/n8n.env` (root-owned, вне проекта).

## 2. Активация возможностей (флаги окружения)

Правится оператором в `/opt/n8n/n8n.env`, затем пересоздание контейнера. Ключевые флаги и значения по
умолчанию — в `docs/CAPABILITIES_RU.md`. Минимум для веб-пайплайна: `MS_ENABLE_FIRECRAWL=true`,
`MS_ENABLE_CLAUDE=true`, `MS_ENABLE_LLM_ANALYSIS=true`, `MS_ENABLE_TELEGRAM=true`,
`MS_TELEGRAM_ALLOWED_USER_IDS=<id>`, `MS_TELEGRAM_WEBHOOK_SECRET=<секрет>`.

Свежий сбор VK (по желанию): `MS_ENABLE_VK=true` **И** добавить `vk` в `MS_SOURCE_ALLOWLIST`
(по умолчанию `['website']`) — нужны обе части. Мониторинг: `MS_MONITORING_ENABLED=true` и активация WF23.

## 3. Локальная проверка (перед любым деплоем)

```
make test          # офлайн-регрессия: node tests/run_all.js — внешних вызовов 0, стоимость $0
node tools/gen_stage4_workflows.js   # регенерация экспортов (идемпотентна, побайтово стабильна)
git status         # после регенерации не должно быть неожиданного дрейфа
```

Полезные проверочные цели (`make help` — полный список):
`make deploy-dry-run`, `make verify-production`, `make credential-audit`, `make source-parity`,
`make runtime-acceptance`, `make release-preflight`.

## 4. Деплой (структурный, backup-first)

Экспорты генерируются, не правятся руками. Инструменты:

- `tools/deploy_workflow_structural.js` — структурный графт топологии репозитория на живой экспорт
  (runtime-id и привязки credential сохраняются). Паритет — структурный, не побайтовый.
- `scripts/deploy_n8n.sh` — операторский скрипт деплоя (запускает оператор).

Порядок: бэкап → `make deploy-dry-run` (дифф) → деплой только изменённых workflow → `make verify-production`
(health, active, webhook, ingress) → `make credential-audit`. Workflow коммитятся с `active: false`;
активация — отдельным осознанным шагом (`make telegram-activate` и т.п.).

## 5. Бэкап

- `scripts/backup.sh` (шаблон `scripts/backup.sh.example`) — снимок workflow-экспортов и метаданных.
- `make release-backup` — бэкап в релизном потоке.
- Метаданные бэкапов — в `backups/` (см. `backups/README.md`).

## 6. Восстановление

- `scripts/restore.sh.example` — шаблон восстановления.
- `scripts/restore_validate.sh` / `make release-restore-validate` — проверка целостности восстановления.

## 7. Откат

- `scripts/rollback.sh` — откат к предыдущему снимку workflow.
- Т.к. экспорты генерируемы и версионируются в git, безопасный откат = вернуть коммит + перегенерировать
  + структурно задеплоить + `make verify-production`.

## 8. GitHub / CI

- CI `offline-regression` (`.github/workflows/regression.yml`): `make test` + скан утечки секретов +
  проверка `active=false`. Триггеры: push в `main`, pull_request.
- Рабочий процесс: ветка → коммит → push → PR → зелёный CI → merge в `main`.
- Никогда не коммитить `active: true` и реальные секреты — CI упадёт (так и задумано).

## 9. Что НЕ трогать

`CLAUDE.md`, `core/AGENTS.md`, `.github/workflows/`, `docs/MVP_SECURITY_REVIEW.md`, машинные контракты
(`config/*.json`, `config/sheets_contracts.json`, `config/taxonomy.json`), идентификаторы workflow,
имена env-переменных, схемы таблиц — без явной причины и проверки.
