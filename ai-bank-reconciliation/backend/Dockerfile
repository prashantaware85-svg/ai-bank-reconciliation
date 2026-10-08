# AI Bank Reconciliation — backend (NestJS) production image.
# Multi-stage: dependencies -> build -> minimal production runtime.
# Runs as non-root `node` user. Never bake .env files into the image.

# ---- base: pinned major Node LTS on minimal Alpine ----
FROM node:22-alpine AS base
RUN apk add --no-cache openssl libc6-compat
WORKDIR /app

# ---- deps: full install (devDeps needed for build + prisma generate) ----
FROM base AS deps
COPY package.json package-lock.json ./
# `omit=dev=false` is intentional here: typescript, @nestjs/cli and prisma
# are required to compile the app and generate the Prisma client.
RUN npm ci --no-audit --no-fund

# ---- build: compile + generate client (no secrets available at build) ----
FROM deps AS build
COPY prisma ./prisma
COPY prisma.config.ts ./
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npx prisma generate
RUN npm run build

# ---- production: prod deps only + prisma CLI for `migrate deploy` ----
FROM base AS production
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
  && npm install --no-save --no-audit --no-fund prisma@7.10.0
# NOTE: keep the pinned prisma version above in sync with package.json.
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/generated ./src/generated
COPY prisma ./prisma
COPY prisma.config.ts ./
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh \
  && chown -R node:node /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e 'fetch("http://127.0.0.1:" + (process.env.PORT || 3000) + "/health").then(function(r){if(!r.ok)process.exit(1)}).catch(function(){process.exit(1)})'
ENTRYPOINT ["./docker-entrypoint.sh"]
