#!/bin/sh
# Production entrypoint: apply pending migrations, then start the API.
# Uses `prisma migrate deploy` ONLY — never db push, never reset, never
# destructive. Fails fast if the database is unreachable.
set -e

echo "[entrypoint] Applying database migrations (migrate deploy)..."
npx prisma migrate deploy

echo "[entrypoint] Starting backend..."
exec node dist/main
