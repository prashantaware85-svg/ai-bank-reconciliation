# PostgreSQL Backup & Restore — AI Bank Reconciliation Tool

All commands run from the compose host against the `postgres` service.
Backups are never deleted automatically — rotate them yourself.

## Scripted backup + isolated restore drill (Step 18)

Canonical scripts (no duplicates exist): `database/Backup-Postgres.ps1`
and `database/Restore-Verify.ps1`. They read connection values from
`backend/.env` (never print them), store the password only in process
memory (`$env:PGPASSWORD`), and write dumps outside the repo (TEMP) so
secrets are never committed. Guardrails shared with the automated policy
tests (`backend/src/deploy/backup-restore.spec.ts`):

- scratch names must match `^[A-Za-z][A-Za-z0-9_]{0,62}$` and must NOT be
  the source DB or a system DB (`postgres`/`template0`/`template1`);
- the source database is only ever read (`SELECT` counts) — restores go
  to the scratch DB, which is always dropped afterwards;
- Windows PowerShell strips plain double quotes passed via `psql -c`,
  so all SQL identifiers use backtick-escaped quotes (verified by drill).

Backup command:

```powershell
cd database
.\Backup-Postgres.ps1
# → BACKUP_OK path=...\backup-YYYYMMDD-HHMM.dump bytes=<n> entries=<n> sha256=<hash>
```

Restore + verification drill command (isolated — never touches production data):

```powershell
cd database
.\Restore-Verify.ps1 -DumpFile "$env:TEMP\ai-bank-backups\backup-YYYYMMDD-HHMM.dump"
# → RESTORE_OK scratch=<name> user=<n> ai=<n> audit=<n> migrations=<n> secrets=clean
# → SCRATCH_DROPPED scratch=<name>
```

Verification procedure (automated inside `Restore-Verify.ps1`):

1. Dump is non-empty and `pg_restore --list` parses entries.
2. `User` / `AIAnalysis` / `AuditLog` counts in scratch match the source.
3. `_prisma_migrations` has rows (restored schema is proven current).
4. Secret hygiene scan of the dump SQL is clean (`AI_API_KEY=`,
   `JWT_*SECRET=`, `sk-…`, private-key blocks, credentialed postgres URLs).
5. Scratch database is dropped; any mismatch fails closed.

Rollback/recovery: if verification fails, the source database is
untouched (drill is read-only toward it) — fix the cause, re-run the
drill. For a real restore, follow "Real restore (maintenance window)"
below, then re-run the drill script against the fresh backup.

Recommended frequency: daily automated backup (cron / Task Scheduler /
systemd timer), same as below. Retention: 30 daily + 12 monthly,
manual pruning only.

Last successful drill: 2026-10-08 — local dev DB `bank_reconciliation`
→ `backup-20261008-1135.dump` (68,966 bytes, 180 entries) → isolated
restore into `restore_drill_s18a` → counts 0/0/0 matched, 7 migration
rows, secret scan clean, scratch dropped. (Docker daemon is unavailable
on this machine, so the drill ran via local `pg_dump`/`pg_restore`;
the procedure is engine-identical to the `docker compose exec` variant
below.)

## Scheduled backups + age monitoring (Step 20)

Reuses `Backup-Postgres.ps1` (no duplicate implementation). Nothing is
ever auto-deleted — retention stays manual (30 daily + 12 monthly).

Install/register the daily task (configurable time, default 02:30):

```powershell
cd database
.\Register-BackupSchedule.ps1
# → SCHEDULE_OK task=AI-Bank-Backup-Daily daily=02:30 state=Ready nextRun=...
```

Change the schedule (re-registers the same task):

```powershell
.\Register-BackupSchedule.ps1 -DailyTime '03:15' -OutDir 'D:\backups\ai-bank'
```

Run a manual backup any time:

```powershell
.\Backup-Postgres.ps1
# → BACKUP_OK path=... bytes=<n> entries=<n> sha256=<hash>   (exit 0; non-zero on failure)
```

Verify the latest backup / detect a stale or missing backup
(exit 0 fresh, 1 older than 26 h, 2 missing/empty/older than 50 h):

```powershell
.\Check-BackupAge.ps1
# → BACKUP_AGE_OK file=... ageHours=<n> bytes=<n>
```

Remove/disable the scheduled task:

```powershell
Unregister-ScheduledTask -TaskName 'AI-Bank-Backup-Daily' -Confirm:$false
Disable-ScheduledTask -TaskName 'AI-Bank-Backup-Daily'   # disable instead of removing
```

Linux equivalent (compose host without Task Scheduler) — daily cron
calling the same procedure via `docker compose exec`:

```cron
30 2 * * * docker compose -f /srv/ai-bank/docker-compose.prod.yml --env-file /srv/ai-bank/.env.prod exec -T postgres pg_dump -U ${POSTGRES_USER} -d ${POSTGRES_DB} -Fc > /srv/ai-bank/backups/backup-$(date +\%Y\%m\%d-\%H\%M).dump
```

Stale detection on Linux: alert when `find /srv/ai-bank/backups -name
'backup-*.dump' -mtime -1 | wc -l` is 0, mirroring the 26-hour policy.

## Daily backup (manual / Docker host)

```powershell
# Custom-format dump with a timestamped name:
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T postgres `
  pg_dump -U $env:POSTGRES_USER -d $env:POSTGRES_DB -Fc > "backup-$(Get-Date -Format yyyyMMdd-HHmm).dump"
```

Schedule daily (cron / Task Scheduler / systemd timer). Copy every dump
off-machine the same day (object storage, NAS, or a second host).

## Off-machine backup

At least one daily copy must leave the database host. Example flow:
host → encrypted object storage bucket with versioning enabled. Test
downloading from storage quarterly.

## Retention

- Keep 30 daily backups.
- Keep 12 monthly backups (first-of-month).
- Never auto-delete production backups; prune manually after verifying
  the newer chain restores.

## Restore test (isolated — never touches production data)

Restore into a scratch database on the same server, verify, then drop
the scratch database:

```powershell
# 1. Create the isolated scratch database:
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T postgres `
  psql -U $env:POSTGRES_USER -d postgres -c "CREATE DATABASE restore_test;"

# 2. Restore the dump into it (NOT into the production database):
Get-Content backup-YYYYMMDD-HHMM.dump -Raw -AsByteStream | docker compose `
  -f docker-compose.prod.yml --env-file .env.prod exec -T postgres `
  pg_restore -U $env:POSTGRES_USER -d restore_test --clean

# 3. Verify counts and migrations state:
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T postgres `
  psql -U $env:POSTGRES_USER -d restore_test -t -c 'SELECT count(*) FROM "User"; SELECT count(*) FROM _prisma_migrations;'

# 4. Drop the scratch database:
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T postgres `
  psql -U $env:POSTGRES_USER -d postgres -c "DROP DATABASE restore_test;"
```

Run this restore test after any backup-procedure change and at least
quarterly. Record the date + row counts in your ops log.

## Real restore (maintenance window)

1. Stop writers: `docker compose -f docker-compose.prod.yml stop backend frontend`
2. Restore with `pg_restore --clean` into the production database.
3. Run `npx prisma migrate status` (via the backend container) — expect
   "Database schema is up to date!".
4. `curl http://127.0.0.1:3001/health/ready` — expect database up.
5. Restart the stack and smoke-test login + dashboard.
