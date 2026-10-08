# Observability — AI Bank Reconciliation Tool

## What to monitor

| Signal | Source | Alert when |
|---|---|---|
| Application health | `GET /health` (200) | non-200 for 2+ minutes |
| Readiness | `GET /health/ready` | `status != ok`, `database`/`redis` down |
| PostgreSQL health | compose healthcheck / `pg_isready` | unhealthy |
| Redis health | compose healthcheck / `redis-cli ping` | unhealthy |
| CPU / memory / disk | host or `docker stats` | sustained >80%, disk >85% |
| Container restarts | `docker compose ps` / `docker events` | any unexpected restart |
| Failed authentication | backend logs (`401` bursts) | spike vs baseline |
| Failed imports | import rows with `FAILED` status | any occurrence |
| Failed reconciliation runs | runs with `FAILED` status | any occurrence |
| Backup age | `database/Check-BackupAge.ps1` (exit 0/1/2) or backup directory listing | no dump in 26 hours |
| TLS expiry | certificate monitor | <14 days remaining |

Suggested poll: health endpoints every 30–60 s (they are cheap:
liveness is trivial, readiness is one `SELECT 1` + one TCP connect).
Use any uptime monitor (Uptime Kuma, Grafana, Datadog, plain cron+curl).

## Logging policy (production)

- Backend log level is warnings/errors only (`NODE_ENV=production`).
- NEVER logged: passwords, JWTs, refresh tokens, AI API keys, Tally
  credentials, bank login credentials, full bank transaction payloads.
- Useful context on errors: timestamp, level, request ID (Step 16
  `RequestIdMiddleware`: reuses a valid incoming `X-Request-Id` or
  generates a UUID v4, attaches it as `req.requestId`, and echoes it on
  the response), service name, error code. Keep messages stable so alerts
  can match on them.
- The repository secret scan (`backend/src/deploy/deployment.spec.ts`)
  fails the build if real-looking secrets appear in tracked files.

## Centralized error logging (Step 17)

Every failed request emits exactly ONE structured JSON line via the
global `HttpExceptionLoggingFilter` (registered as `APP_FILTER`; it
delegates to `BaseExceptionFilter`, so API response formats are
byte-for-byte unchanged):

| Field | Source | Notes |
|---|---|---|
| `timestamp` | server clock (ISO) | UTC |
| `level` | always `"error"` | respects `NODE_ENV` log levels |
| `requestId` | Step 16 `req.requestId` (`"unknown"` if absent) | same value as the `X-Request-Id` response header |
| `method` | `req.method` | e.g. `POST` |
| `path` | `req.path` (never the URL) | query strings/fragments are stripped |
| `statusCode` | exception status (500 for unknown) | — |
| `message` | 4xx framework message / generic for 5xx | single line, max 500 chars |

Never logged: request bodies, query strings, headers (incl.
`Authorization`, `Cookie`), passwords, JWTs, refresh tokens, API keys,
`DATABASE_URL`. 5xx messages are always generic (`Internal server
error`); 4xx messages additionally pass a best-effort scrub of
well-formed secret shapes (`sk-…`, `Bearer …`, `postgres://…`,
private-key blocks). Application code must still never place secrets in
exception messages — the scrub is a safety net, not a permit.

Example (fake values only):

```json
{"timestamp":"2026-10-06T14:25:46.864Z","level":"error","requestId":"corr-test-42","method":"GET","path":"/companies","statusCode":401,"message":"Unauthorized"}
```

## Support correlation (Step 19)

When an API request fails, the frontend shows the server message plus a
muted support reference — `Request ID: <id>` — sourced from the
`X-Request-Id` response header (`frontend/src/lib/api-errors.ts`,
`frontend/src/components/ApiErrorNotice.tsx`). Only validated IDs
(`^[A-Za-z0-9._-]{1,128}$`) are displayed; no tokens, bodies, or other
response details ever reach the UI.

Support flow: the accountant copies the Request ID from the error notice
→ the operator greps backend logs for that exact `requestId` → the full
structured error line (timestamp, method, path, status) identifies the
failure. The backend exposes the header cross-origin via
`Access-Control-Expose-Headers: X-Request-Id` (additive CORS change;
no auth or response-body change).

## Dashboards worth building

- Reconciliation health over time (matched % / exceptions / pending).
- Review throughput (confirmed vs pending per day).
- AI fallback rate (provider errors vs successes).
- Export volume + 4xx/5xx rate on `/reports/*`.
