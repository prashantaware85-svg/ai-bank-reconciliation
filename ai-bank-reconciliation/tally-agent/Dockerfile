# Tally Agent — local Windows component (NOT part of the cloud stack).
# This Dockerfile exists for CI verification and advanced users who run
# the agent in a container on the Tally LAN. Production use remains:
# `npm install && npm run build && node dist/cli.js` on the Windows PC
# next to TallyPrime. Never expose TallyPrime to the internet.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS production
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
RUN chown -R node:node /app
USER node
# Default command prints help; override per command, e.g.:
# docker run tally-agent node dist/cli.js check
CMD ["node", "dist/cli.js", "--help"]
