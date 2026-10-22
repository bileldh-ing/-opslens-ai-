# syntax=docker/dockerfile:1.7
# Multi-stage build. Default target `runner` = Next.js standalone server (small, non-root).
# Target `worker` = full source + deps for the BullMQ worker and one-off migrate/seed jobs.
ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS worker
ENV NODE_ENV=production
RUN addgroup -S -g 1001 opslens && adduser -S -u 1001 -G opslens opslens
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json drizzle.config.ts ./
COPY src ./src
COPY scripts ./scripts
COPY drizzle ./drizzle
COPY data ./data
COPY evals ./evals
RUN mkdir -p .data uploads && chown -R opslens:opslens .data uploads
USER opslens
CMD ["npx", "tsx", "src/server/jobs/worker.ts"]

FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup -S -g 1001 opslens && adduser -S -u 1001 -G opslens opslens
COPY --from=build --chown=opslens:opslens /app/.next/standalone ./
COPY --from=build --chown=opslens:opslens /app/.next/static ./.next/static
COPY --from=build --chown=opslens:opslens /app/public ./public
COPY --from=build --chown=opslens:opslens /app/drizzle ./drizzle
COPY --from=build --chown=opslens:opslens /app/data ./data
RUN mkdir -p .data uploads && chown opslens:opslens .data uploads
USER opslens
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health > /dev/null || exit 1
CMD ["node", "server.js"]
