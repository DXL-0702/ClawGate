# syntax=docker/dockerfile:1

# ---- Build stage ----
FROM node:20-bookworm-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /repo

# Copy workspace manifests first for better layer caching
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json ./
COPY packages/shared/package.json  packages/shared/
COPY packages/core/package.json    packages/core/
COPY packages/server/package.json  packages/server/
COPY packages/web/package.json     packages/web/
COPY packages/cli/package.json     packages/cli/

RUN pnpm install --frozen-lockfile

# Copy source and build
COPY packages/shared  packages/shared
COPY packages/core    packages/core
COPY packages/server  packages/server

RUN pnpm --filter @clawgate/shared build && \
    pnpm --filter @clawgate/core   build && \
    pnpm --filter @clawgate/server build

# Produce a self-contained deploy bundle with only server + prod deps
RUN pnpm --filter @clawgate/server deploy --prod /deploy

# ---- Runtime stage ----
FROM node:20-bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
    && rm -rf /var/lib/apt/lists/* && \
    useradd -m -u 1001 clawgate

WORKDIR /app

COPY --from=builder --chown=clawgate:clawgate /deploy /app

USER clawgate

ENV NODE_ENV=production \
    ROUTER_URL=http://router:3001 \
    REDIS_URL=redis://redis:6379 \
    OLLAMA_URL=http://ollama:11434 \
    CLAWGATE_REQUIRE_OPENCLAW=false

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
    CMD curl -fs http://localhost:3000/api/health || exit 1

CMD ["node", "dist/index.js"]
