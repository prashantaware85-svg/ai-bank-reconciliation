# AI Bank Reconciliation Tool

## Project purpose

Production-ready accounting software that compares **Bank Statement data** with **TallyPrime bank transactions** and identifies:

- matched transactions
- unmatched transactions
- wrong party
- duplicate entries
- amount mismatch
- date mismatch
- missing Tally entries
- missing bank entries
- bank charges
- other reconciliation exceptions

> Step 1: project foundation only. No business logic implemented yet.

## Technology stack

- **Frontend:** Next.js + React + TypeScript (App Router, ESLint)
- **Backend:** NestJS + Node.js + TypeScript (REST API structure, ESLint via oxlint)
- **Database:** PostgreSQL + Prisma
- **Cache/Queue:** Redis
- **Infra:** Docker Compose
- **Package manager:** npm

## Folder structure

```text
ai-bank-reconciliation/
├── frontend/               # Next.js App Router (TypeScript, ESLint)
├── backend/                # NestJS REST API (TypeScript) + Prisma
│   ├── prisma/
│   │   └── schema.prisma   # PostgreSQL datasource (no models yet — Step 1)
│   ├── src/                # NestJS source (AppModule only — Step 1)
│   └── prisma.config.ts    # Prisma v8 config
├── tally-agent/            # Placeholder for TallyPrime connector (later step)
├── reconciliation-engine/  # Placeholder for matching engine (later step)
├── ai-engine/              # Placeholder for AI explanations (later step)
├── database/               # Placeholder for DB scripts/seeds (later step)
├── docs/                   # Project docs (later steps)
├── tests/                  # Cross-service / e2e tests (later steps)
├── docker-compose.yml      # PostgreSQL + Redis services
├── .env.example            # Required env vars template
├── .gitignore
└── README.md
```

## Prerequisites

- Node.js 20+ (tested on Node v24.18.0)
- npm 10+ (tested on npm 11.16.0)
- Git
- Docker + Docker Compose (for PostgreSQL + Redis)
- PostgreSQL 16 (via Docker) + Redis 7 (via Docker)

## Installation commands

```bash
cd ai-bank-reconciliation

# Frontend deps (already installed by scaffolding, re-run if needed)
cd frontend
npm install

# Backend deps (includes Prisma + @prisma/client)
cd ../backend
npm install
```

Copy env template and fill values:

```bash
cp .env.example .env
# Edit DATABASE_URL, REDIS_URL, JWT_SECRET, JWT_REFRESH_SECRET,
# AI_API_KEY, TALLY_CONNECTOR_URL, ENCRYPTION_KEY
```

Generate Prisma client (after adding models in later steps):

```bash
cd backend
npx prisma generate
```

## Docker commands

```bash
cd ai-bank-reconciliation

# Start PostgreSQL + Redis in background
docker compose up -d

# Check status
docker compose ps

# View logs
docker compose logs -f postgres redis

# Validate compose file (no daemon needed)
docker compose config

# Stop and remove containers (keep volumes)
docker compose down

# Stop and delete volumes (wipes DB data)
docker compose down -v
```

Default ports:

- PostgreSQL: `localhost:5432` (db `bank_reconciliation`, user `bankapp`)
- Redis: `localhost:6379`

Example `DATABASE_URL` for local Docker:

```text
DATABASE_URL="postgresql://bankapp:bankapp_secret@localhost:5432/bank_reconciliation?schema=public"
REDIS_URL="redis://localhost:6379"
```

## Frontend start command

```bash
cd ai-bank-reconciliation/frontend
npm run dev     # http://localhost:3000
npm run build   # production build check
npm run start   # serve production build
npm run lint    # ESLint check
```

## Backend start command

```bash
cd ai-bank-reconciliation/backend
npm run start:dev   # watch mode, default port 3000 (set PORT env to avoid clash with frontend)
npm run build       # nest build -> dist/
npm run start:prod  # node dist/main
npm run lint        # oxlint type-aware check
```

> Note: frontend (`3000`) and backend (`3000` default) share the same default port.
> Run backend with `PORT=3001` (e.g. `$env:PORT=3001; npm run start:dev` on PowerShell)
> or set `PORT` in `.env` once config support is added.

## Step 1 scope

Implemented:

- [x] Git repo
- [x] Folder skeleton
- [x] Next.js frontend (TS, App Router, ESLint)
- [x] NestJS backend (TS, REST skeleton)
- [x] Prisma initialized (PostgreSQL datasource, no models)
- [x] docker-compose.yml (postgres + redis)
- [x] .env.example, .gitignore, README.md

Explicitly NOT implemented (later steps):

- Authentication, user system, company system
- Bank upload, Tally integration
- Reconciliation engine, AI engine
- Dashboard, reports
