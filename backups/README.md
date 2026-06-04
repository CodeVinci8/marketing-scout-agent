# backups/ — Backup Storage

This directory is intended for n8n data backups created by `scripts/backup.sh`.

## What Gets Backed Up

- n8n workflow definitions
- n8n execution history
- n8n credentials metadata (encrypted — actual secrets stay in n8n's storage)

## Usage

1. Copy `scripts/backup.sh.example` to `scripts/backup.sh`
2. Fill in `N8N_DATA_DIR` and `BACKUP_DIR` with real paths
3. Make executable: `chmod +x scripts/backup.sh`
4. Run manually: `./scripts/backup.sh`
5. Or add to cron for automated daily backups

## Restore

See `scripts/restore.sh.example` for restore procedure.
Always stop n8n before restoring.

## Important Notes

- This directory is for backup archives only — no source code or docs here.
- Backup files are `.tar.gz` archives named `n8n_backup_TIMESTAMP.tar.gz`.
- Do not commit large backup archives to Git. Add `*.tar.gz` to `.gitignore`.
- Keep at least 3 recent backups before deleting older ones.
- Test your restore procedure at least once before you need it in an emergency.

## Current Backups

(No backups yet — pipeline not yet deployed.)
