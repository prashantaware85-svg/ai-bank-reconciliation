# Production Cutover Checklist — AI Bank Reconciliation Tool

Complete every item before serving real users. Check off only with evidence
(command output, screenshots, or log lines — never paste secrets).

## Network & domains

- [ ] DNS configured (APP_DOMAIN and API_DOMAIN resolve to the host)
- [ ] TLS configured (valid certificate, auto-renewal enabled)
- [ ] HTTP → HTTPS redirect verified (`curl -I http://<host>` → 301/308)
- [ ] PostgreSQL NOT publicly exposed (no published 5432 port)
- [ ] Redis NOT publicly exposed (no published 6379 port)
- [ ] TallyPrime port 9000 NOT publicly exposed (agent uses outbound only)

## Secrets & environment

- [ ] `.env.prod` created from `.env.production.example` (never committed)
- [ ] `POSTGRES_PASSWORD` strong and unique
- [ ] `JWT_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY` all ≥32 chars, all different
- [ ] `CORS_ORIGIN` set to the real frontend origin (not `*`)
- [ ] `NEXT_PUBLIC_API_URL` points at the public HTTPS backend URL
- [ ] No secrets in images, logs, or git (`backend` deployment spec secret scan passes)

## Data & migrations

- [ ] Database available (postgres container healthy)
- [ ] Redis available (redis container healthy)
- [ ] Migrations applied (`prisma migrate deploy` ran clean in backend logs;
      `prisma migrate status` shows "Database schema is up to date!")
- [ ] Never ran `prisma db push` or `prisma migrate reset` against production

## Application health

- [ ] Health endpoint passing (`GET /health` → 200 `{"status":"ok",...}`)
- [ ] Readiness passing (`GET /health/ready` → 200 `database: up, redis: up`)
- [ ] Frontend reachable (200 on `/`)
- [ ] Backend reachable (via reverse proxy path)
- [ ] Authenticated smoke test passes (register → login → dashboard)

## Features & integrations

- [ ] CORS verified (browser app works; foreign origins rejected)
- [ ] Bank import works (synthetic statement, 10 MB / xlsx-csv rules intact)
- [ ] Reconciliation run completes on synthetic data
- [ ] AI analysis behaves per provider config (or deterministic fallback)
- [ ] Review workflow records history + audit rows
- [ ] Excel/PDF exports download with correct content types
- [ ] Tally Agent configured (agent `check` → ok, outbound HTTPS only)

## Backup & recovery

- [ ] Daily PostgreSQL backup scheduled (see `docs/backup-restore.md`)
- [ ] Backups stored off-machine
- [ ] Retention policy set (e.g. 30 daily + 12 monthly), never auto-delete prod backups
- [ ] Restore procedure tested on an isolated database

## Observability

- [ ] Logs verified (`docker compose logs`, no errors, no secrets)
- [ ] Monitoring configured (health, CPU, memory, disk, restarts — see `docs/observability.md`)
- [ ] Alerting for failed auth spikes / failed imports / failed runs

## Tally Agent (Windows PC)

- [ ] Agent `.env` configured (`BACKEND_URL` = HTTPS, fresh `BACKEND_JWT`)
- [ ] TallyPrime running with XML enabled, company loaded
- [ ] No inbound port forwarding to the Tally PC
