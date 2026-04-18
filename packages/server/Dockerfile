# syntax=docker/dockerfile:1

# ---- Build stage ----
FROM node:20-bookworm-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /repo

# 1. 根目录配置（tsconfig.base.json 被所有子包 extends，必须先复制）
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json tsconfig.base.json ./

# 2. 各包 manifest（供 pnpm install 解析 workspace 依赖图）
COPY packages/shared/package.json  packages/shared/
COPY packages/core/package.json    packages/core/
COPY packages/server/package.json  packages/server/
COPY packages/web/package.json     packages/web/
COPY packages/cli/package.json     packages/cli/

# 3. 安装所有依赖（含 native 编译：better-sqlite3 / msgpackr-extract / esbuild）
RUN pnpm install --frozen-lockfile

# 4. 复制源码（整个目录已含各包的 tsconfig.json / src/）
COPY packages/shared  packages/shared
COPY packages/core    packages/core
COPY packages/server  packages/server
COPY packages/web     packages/web

# 5. 按依赖顺序构建（含 web SPA）
RUN pnpm --filter @clawgate/shared build && \
    pnpm --filter @clawgate/core   build && \
    pnpm --filter @clawgate/server build && \
    pnpm --filter @clawgate/web    build

# 6. 生成自包含 deploy bundle（只保留 server + 生产依赖，排除 devDeps 和其他包源码）
RUN pnpm --filter @clawgate/server deploy --prod --legacy /deploy

# ---- Runtime stage ----
FROM node:20-bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
    && rm -rf /var/lib/apt/lists/* && \
    useradd -m -u 1001 clawgate

WORKDIR /app

COPY --from=builder --chown=clawgate:clawgate /deploy /app

# 复制 Web SPA 静态资源（由 Fastify @fastify/static serve）
COPY --from=builder --chown=clawgate:clawgate /repo/packages/web/dist /app/public

USER clawgate

ENV NODE_ENV=production \
    ROUTER_URL=http://router:3001 \
    REDIS_URL=redis://redis:6379 \
    OLLAMA_URL=http://ollama:11434 \
    WEB_DIST=/app/public \
    CLAWGATE_REQUIRE_OPENCLAW=false

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
    CMD curl -fs http://localhost:3000/api/health || exit 1

CMD ["node", "dist/index.js"]
