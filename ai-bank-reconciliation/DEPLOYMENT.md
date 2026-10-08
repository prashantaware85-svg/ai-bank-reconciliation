# Deployment Guide — AI Bank Reconciliation Tool

Beginner-friendly production deployment with Docker Compose, plus local
development instructions.

Architecture:

```
Internet
   ↓
Reverse Proxy (nginx/Caddy/Traefik — you provide TLS here)
   ↓                    ↓
Frontend (:3000)     Backend (127.0.0.1:3001, via proxy /api)
                            ↓
                 +----------+----------+
                 |                     |
             PostgreSQL             Redis
        (internal only)      (internal only)

TallyPrime → Tally Agent (Windows PC) → HTTPS outbound → Backend API
```

PostgreSQL and Redis are never published to the network. TallyPrime is
never exposed to the internet; the agent only makes outbound calls.

---

## 1. Prerequisites

- Docker Engine 24+ with Compose v2 (`docker compose version`)
- 2 vCPU / 4 GB RAM minimum (4 vCPU / 8 GB recommended)
- A domain name for HTTPS (production), e.g. `recon.example.com`
- OpenAI-compatible API key only if you want live AI analysis
  (the app falls back to deterministic heuristics without one)

## 2. Environment variables

```powershell
Copy-Item .env.example .env.prod
notepad .env.prod
```

Required in `.env.prod` (see `.env.example` for placeholders):

| Variable | Purpose |
|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Database credentials |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | Auth signing keys (≥32 chars: `openssl rand -hex 32`) |
| `ENCRYPTION_KEY` | At-rest secret (≥32 chars) |
| `NEXT_PUBLIC_API_URL` | Public backend URL baked into the frontend at build time |
| `CORS_ORIGIN` | Comma-separated allowed origins (no `*` in production) |

Optional: `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL`, `REDIS_URL`
(default internal), `PORT` (default 3001 in prod compose).

## 3. Docker installation

Install Docker Desktop (Windows/Mac) or Docker Engine (Linux) from
https://docs.docker.com/get-docker/ and verify:

```powershell
docker --version
docker compose version
```

## 4. Environment setup

```powershell
cd ai-bank-reconciliation
Copy-Item .env.example .env.prod
# Edit .env.prod with real values (never commit this file)
```

## 5. Docker Compose startup (production)

```powershell
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

What happens: PostgreSQL and Redis start first; the backend waits for
both `healthy` (`depends_on` + health conditions), runs
`prisma migrate deploy` via its entrypoint, then starts the API; the
frontend starts last.

Local development is unchanged:

```powershell
docker compose up -d            # dev postgres + redis on localhost
cd backend; npm run start:dev
cd frontend; npm run dev
```

## 6. Prisma migration

Production startup applies pending migrations automatically
(`prisma migrate deploy` in `backend/docker-entrypoint.sh`).
To apply manually:

```powershell
docker compose -f docker-compose.prod.yml --env-file .env.prod exec backend npx prisma migrate deploy
docker compose -f docker-compose.prod.yml --env-file .env.prod exec backend npx prisma migrate status
```

Rules: never `prisma db push` in production, never `prisma migrate
reset` in production (it wipes data).

## 7. Health checks

```powershell
curl http://127.0.0.1:3001/health        # {"status":"ok", ...} — app alive
curl http://127.0.0.1:3001/health/ready  # {"status":"ok","database":"up","redis":"up"}
curl http://127.0.0.1:3000/              # frontend
docker compose -f docker-compose.prod.yml ps   # all "healthy"/"running"
```

`/health/ready` returns HTTP 200 when everything is up, 503
`{"status":"degraded",...}` otherwise. No secrets are exposed.

## 8. Frontend URL

- Local prod compose: http://localhost:3000
- Production: whatever your reverse proxy serves (set
  `NEXT_PUBLIC_API_URL` to the public backend URL **before** building,
  since Next.js bakes it into the client bundle).

## 9. Backend URL

- Local prod compose: http://127.0.0.1:3001 (localhost only)
- Production: behind your reverse proxy, e.g.
  `https://recon.example.com/api` → `backend:3001`

## 10. PostgreSQL backup

```powershell
# Backup (custom format, timestamped; run from the compose host):
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T postgres pg_dump -U $env:POSTGRES_USER -d $env:POSTGRES_DB -Fc > "backup-$(Get-Date -Format yyyyMMdd-HHmm).dump"

# Restore (stops writers first in real maintenance windows):
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T postgres pg_restore -U $env:POSTGRES_USER -d $env:POSTGRES_DB --clean backup-YYYYMMDD-HHMM.dump

# Verification: row counts + app health after restore:
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T postgres psql -U $env:POSTGRES_USER -d $env:POSTGRES_DB -c "SELECT count(*) FROM \"User\";"
curl http://127.0.0.1:3001/health/ready
```

Backups are never deleted automatically — rotate them yourself (e.g.
keep 30 daily + 12 monthly). Store copies off-machine.

## 11. Restore

See section 10. Always restore to a scratch database first on
important systems, verify counts, then cut over.

## 12. Logs

```powershell
# All services:
docker compose -f docker-compose.prod.yml logs -f
# One service:
docker compose -f docker-compose.prod.yml logs -f backend
# Production log level is warnings/errors only; request bodies, tokens,
# passwords and AI keys are never logged (enforced by code review +
# the repository secret scan in backend/src/deploy/deployment.spec.ts).
```

## 13. Shutdown

```powershell
# Stop containers, KEEP all data (volumes stay):
docker compose -f docker-compose.prod.yml down

# DANGER — deletes the database and Redis data permanently:
# docker compose -f docker-compose.prod.yml down -v
```

`down` never deletes volumes. `down -v` deletes named volumes
(`postgres-data`, `redis-data`) — do NOT run it casually.

## 14. Update / redeploy

```powershell
git pull
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.prod exec backend npx prisma migrate status
curl http://127.0.0.1:3001/health/ready
```

Frontend rebuild picks up `NEXT_PUBLIC_API_URL` automatically.

## 15. Tally Agent configuration (Windows PC)

```powershell
cd tally-agent
Copy-Item .env.example .env
notepad .env
npm install
npm run build
node dist/cli.js check        # must print {"ok":true,...}
node dist/cli.js companies    # lists Tally companies
```

`.env` needs:

```ini
TALLY_BASE_URL=http://127.0.0.1:9000
# ...or host + port separately:
# TALLY_HOST=127.0.0.1
# TALLY_PORT=9000
BACKEND_URL=https://recon.example.com/api   # outbound HTTPS in production
BACKEND_JWT=<paste a login JWT from the app>
```

Prerequisites in TallyPrime: running, XML enabled (F1 → Settings →
Connectivity, port 9000), company loaded. No installer / Windows
Service registration in this release — run it as a scheduled task or
manually. TallyPrime stays on the LAN; nothing inbound is required.

## 16. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Backend exits: "Environment validation failed" | Missing/short secret in `.env.prod`; check names (≥32 chars) |
| `migrate deploy` fails: password auth | `POSTGRES_PASSWORD` mismatch vs volume init; check `.env.prod` |
| `/health/ready` → 503 redis down | Redis still starting; wait 30 s, `docker ... ps` |
| Frontend shows API errors | `NEXT_PUBLIC_API_URL` baked wrong — rebuild frontend image |
| 429 Too Many Requests | Throttler: auth 5/min, AI 30/min, exports 10/min, default 100/min |
| Upload rejected (413/400) | 10 MB limit, `.xlsx/.xls/.csv` only — see import page message |
| Agent "Cannot reach TallyPrime" | TallyPrime not running / XML disabled / wrong port |
| Agent 401 from backend | `BACKEND_JWT` expired — log in again and paste a fresh token |

## Production checklist

- [ ] `.env.prod` configured (all required vars, strong secrets)
- [ ] Secrets generated (`openssl rand -hex 32`), none committed
- [ ] Database backup procedure tested (section 10)
- [ ] Docker images built (`up --build` succeeded)
- [ ] Migrations applied (`migrate status` clean)
- [ ] Health checks passing (`/health`, `/health/ready`)
- [ ] Frontend reachable (200 on `/`)
- [ ] Backend reachable (via proxy)
- [ ] Redis healthy (`docker ... exec redis redis-cli ping` → PONG)
- [ ] PostgreSQL healthy (`pg_isready`)
- [ ] Tally Agent configured (agent `check` → ok)
- [ ] HTTPS configured at deployment layer (reverse proxy)
- [ ] Logs checked (no errors, no secrets)

## Resource guidance

Minimum: 2 vCPU / 4 GB RAM / 20 GB disk. Recommended: 4 vCPU / 8 GB /
50 GB with backups off-machine. No hard CPU/memory limits are set in
compose — the reconciliation engine and argon2 hashing need burst
headroom; add generous limits only after measuring your workload.
