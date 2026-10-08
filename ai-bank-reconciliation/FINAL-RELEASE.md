# AI Bank Reconciliation Tool — Version 1.0.0 Release Candidate

**FEATURE SET FROZEN. Further development should only address production blockers or verified defects.**

- Version: 1.0.0 Release Candidate
- Overall readiness: 97% (31/32 verification items complete)
- Freeze date: 2026-10-08
- Authoritative deployment checklist: `PRODUCTION-CHECKLIST.md` (this file
  does not replace it — every cutover item there must still be checked off
  with evidence on the real host)

## Completed features

Steps 1–14 (auth with OWNER/ACCOUNTANT/REVIEWER/VIEWER roles, companies,
bank xlsx/xls/csv import ≤10 MB with normalization, read-only TallyPrime
sync, deterministic reconciliation: exact / fuzzy / 1:N / N:1 /
duplicates / wrong-party, AI exception stack with fallback+cache+audit,
review + party-alias approval workflows, dashboard, reports, Excel + PDF
exports, Docker packaging, prod cutover docs), Step 16 (request-ID
middleware), Step 17 (centralized secret-safe error logging), Step 18
(backup + isolated restore drill), Step 19 (frontend `Request ID`
support reference), Step 20 (scheduled backups + backup-age monitoring).

## Production blockers

1. **No production host provisioned or deployed.** All deployment,
   DNS/TLS, `.env.prod`, migration, smoke-test, backup-schedule, and
   monitoring work from `PRODUCTION-CHECKLIST.md` is unexecuted.
2. **Step 15 real-AI accuracy evaluation remains pending because OpenAI
   API credits are unavailable.** The AI stack (provider abstraction,
   retries, fallback, cache, audit, secret handling) is fully verified;
   only genuine LLM accuracy is unmeasured. Do not retry without credits.

## Step 15 AI test status

Blocked externally (`credit_balance_exhausted` on every call; key itself
is accepted). Fallback path verified live and in suite (4/10 honest
narrow-heuristic score — not an LLM claim). Re-run the Step 15
procedure once credits exist; no code changes needed.

## Production deployment requirements

A real host with Docker, DNS (`APP_DOMAIN`, `API_DOMAIN`), TLS via the
reverse proxy (`docs/reverse-proxy.md`: Caddy or nginx), `.env.prod`
created from `.env.production.example` (never committed — now
gitignored alongside `backend/.env`), then `PRODUCTION-CHECKLIST.md`
top to bottom.

## Backup/restore requirements

Daily dumps via `database/Backup-Postgres.ps1` (scheduled with
`database/Register-BackupSchedule.ps1`, default 02:30), freshness via
`database/Check-BackupAge.ps1` (warn ≥26 h, critical ≥50 h), isolated
restore drills via `database/Restore-Verify.ps1`, quarterly restore
tests, off-machine copies, manual 30-daily + 12-monthly retention —
never auto-delete. Last drill: 2026-10-08, PASS (counts matched,
7 migration rows, secret scan clean, scratch dropped).

## Security status

PASS at release time: helmet, global throttling (+stricter auth
limits), CORS allow-list, `X-Request-Id` exposure only, strict
validation pipe, backend-only AI key, secret-safe logging (no bodies,
query, headers, or tokens), secret scans green (`deployment.spec.ts`),
env templates placeholders-only, `.env`/`.env.prod` gitignored.

## Test results (release run, 2026-10-08)

Backend unit 228/228 (22 files) · e2e 3/3 · `tsc`/`oxlint`/`nest build`
clean · frontend `tsc`/`eslint`/tests 6/6/build 17/17 routes ·
tally-agent `tsc` + 15/15 · `docker compose config` exit 0 (dev + prod).

## Tally integration status

Read-only verified (no write-back verbs anywhere in the agent; outbound
push only). Live `check` against TallyPrime must run on the
XML-enabled host before cutover.

## Exact production cutover sequence

1. Provision host (Docker, scheduled-task/cron owner, off-machine storage).
2. Copy `.env.production.example` → `.env.prod`, fill secrets (never commit).
3. DNS + TLS per `docs/reverse-proxy.md`; confirm HTTP→HTTPS redirect.
4. `docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build`.
5. `prisma migrate deploy` → `migrate status` "up to date".
6. Health/ready 200s → register → login → dashboard smoke.
7. Synthetic bank import → reconciliation run → review → exports.
8. Register backup schedule; run + age-check; isolated restore drill.
9. Configure Tally Agent on the Windows PC; live `check` + test sync.
10. Wire monitoring/alerting per `docs/observability.md`.

## Post-deployment verification checklist

`PRODUCTION-CHECKLIST.md` in full (network, secrets, migrations, app
health, features, backup/recovery, observability, Tally PC) — each item
checked only with evidence, never pasted secrets.
