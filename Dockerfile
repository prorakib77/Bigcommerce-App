# syntax=docker/dockerfile:1

# =============================================================================
# Base: pinned Node 24 (Active LTS) on Debian slim, pnpm via Corepack
# =============================================================================
FROM node:26.6.0-bookworm-slim AS base
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app
ENV NODE_ENV=production

# =============================================================================
# deps: install with a frozen lockfile only (fails the build if the lockfile
# is out of date instead of silently drifting)
# =============================================================================
FROM base AS deps
COPY package.json pnpm-lock.yaml* .npmrc ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# =============================================================================
# build: generate the Prisma client and build the Next.js production bundle.
# This app runs both a Next.js server (web) and a plain Node/tsx worker
# process from one image, so — unlike a web-only deployment — we keep full
# node_modules rather than Next's pruned "standalone" output, which the
# worker's dependencies (pg-boss, tsx itself, etc.) wouldn't be part of.
# =============================================================================
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm exec prisma generate
RUN pnpm build

# =============================================================================
# runtime: non-root user, only production artifacts + full node_modules
# =============================================================================
FROM base AS runtime
RUN groupadd --gid 1001 nodejs && useradd --uid 1001 --gid nodejs --shell /bin/bash --create-home appuser

COPY --from=build --chown=appuser:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=appuser:nodejs /app/.next ./.next
COPY --from=build --chown=appuser:nodejs /app/public ./public
COPY --from=build --chown=appuser:nodejs /app/src ./src
COPY --from=build --chown=appuser:nodejs /app/prisma ./prisma
COPY --from=build --chown=appuser:nodejs /app/prisma.config.ts ./prisma.config.ts
COPY --from=build --chown=appuser:nodejs /app/next.config.mjs ./next.config.mjs
COPY --from=build --chown=appuser:nodejs /app/package.json ./package.json
COPY --from=build --chown=appuser:nodejs /app/tsconfig.json ./tsconfig.json

USER appuser
ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# `next start` and the `tsx`-run worker both handle SIGTERM for graceful
# shutdown. Render (and `docker run --entrypoint`) override this command per
# service — web uses `pnpm start`, the worker uses `pnpm worker:start`.
CMD ["pnpm", "start"]
