# 单节点运行与部署基线

本文以当前工作区源码为准，适用于本地开发和受信网络中的功能评估。当前包版本为 `0.1.0`，尚未完成生产发布验收；不要把本页理解为 GA 部署手册。

## 1. 当前拓扑

单节点并不是一个 `clawgate` 单体镜像，而是三项 ClawGate 服务加三项基础设施：

| 进程 | 默认端口 | 职责 | 运行依赖 |
|---|---:|---|---|
| Node/Fastify Server | 3000 | REST、WebSocket、OpenAI 风格接口、DAG/BullMQ、Web SPA | Redis；部分能力需要 Router、OpenClaw |
| Rust/Axum Router | 3001 | L1 Redis 缓存、规则回退、熔断状态、调用 Intent | Redis；Intent 可失败降级 |
| Python/FastAPI Intent | 8000 | L2 Qdrant 语义缓存、L3 混合分类、L4 显式反馈 | Qdrant、Ollama |
| Redis | 6379 | 热状态、BullMQ、路由缓存与负载快照 | Server 启动硬依赖 |
| Qdrant | 6333/6334 | Prompt embedding 向量存储 | Python L2 使用 |
| Ollama | 11434 | Embedding 和本地模型调用 | Python L2/L3、本地 Provider 使用 |

跨进程调用当前全部是 HTTP REST。`proto/` 中的 Protobuf 尚未接入运行链路。

## 2. 能力依赖

| 能力 | 最低依赖 | 当前边界 |
|---|---|---|
| Web UI、基础 REST | Server + Redis | Server 无 Redis 时不能启动 |
| 智能路由 | Server + Router + Redis | L2/L3 还需 Intent、Qdrant、Ollama |
| `POST /v1/chat/completions` | Server + 可用 Provider | 仅覆盖当前实现的 chat completions 子集；非流式有 failover，流式无 failover |
| Agent / Session | Server + OpenClaw Gateway | 当前 Gateway 业务 payload/event 契约尚未适配 OpenClaw 2026.4.14，不能视为已验收 |
| DAG 纯调度逻辑 | Server + Redis + SQLite | 拓扑、条件、延迟和 Mock 执行已有自动化测试 |
| DAG Agent 节点 | 上述全部 + 可达 Gateway | 真实 Gateway E2E 当前不通过 |

## 3. 源码运行

### 3.1 前置条件

- Node.js 20+
- pnpm 10.33.x
- Rust 工具链（Docker 构建基线为 Rust 1.83）
- Python 3.11+
- Docker Engine 与 Docker Compose
- 可选：本机 OpenClaw，仅用于 Agent、Session 和 DAG Agent 节点联调

### 3.2 安装与构建

```bash
pnpm install --frozen-lockfile
pnpm exec turbo run build --force
```

当前源码的 5 个 workspace 包可以完成全量构建。Web 产物主 JavaScript chunk 约 918 kB，Vite 会给出大于 500 kB 的分包警告。

### 3.3 启动基础设施

```bash
docker compose up -d redis qdrant ollama
```

Redis 是 Server 的硬依赖。若只启动 Node Server 而没有 Redis，启动会在 `connectRedis()` 阶段失败。

### 3.4 启动 Python Intent

```bash
python3 -m venv services/intent-python/.venv
services/intent-python/.venv/bin/pip install -r services/intent-python/requirements.txt
services/intent-python/.venv/bin/uvicorn main:app \
  --app-dir services/intent-python \
  --host 127.0.0.1 \
  --port 8000
```

当前仓库没有 pytest 用例。`l3_sentinel/lr_classifier.py` 仍使用已从新版本 scikit-learn 移除的 `sklearn.externals.joblib`，且仓库没有预训练 LR 模型，因此 L3 的 LR 分支会退回保守策略。

### 3.5 启动 Rust Router

```bash
cargo run --manifest-path services/router-rust/Cargo.toml
```

如果仓库位于另一个 Cargo workspace 目录内，而父级 `Cargo.toml` 没有把本项目列为 member/exclude，Cargo 会拒绝运行。此时应调整父级 workspace 或把仓库放到该 workspace 之外；不要为此改写 ClawGate 的业务源码。

### 3.6 启动 Node Server

```bash
pnpm --filter @clawgate/server start
```

Server 从当前工作目录读取或生成 `clawgate.yaml`，从 `~/.openclaw` 读取 OpenClaw 本机配置，并固定监听 `0.0.0.0:3000`。

验证基础进程：

```bash
curl http://127.0.0.1:3000/api/health
curl http://127.0.0.1:3001/health
curl http://127.0.0.1:8000/health
```

## 4. Docker Compose

仓库有三份 Compose：

| 文件 | 作用 | 当前验证 |
|---|---|---|
| `docker-compose.yml` | 从本地源码构建三项服务 | `docker compose config --quiet` 通过 |
| `docker-compose.prod.yml` | 引用 GHCR `latest` 镜像的体验拓扑 | 仅配置解析通过，镜像可用性与全栈启动未在本轮验收 |
| `docker-compose.team.yml` | 中央服务 + 远程成员 Gateway 的团队拓扑 | 仅配置解析通过；不满足公网生产安全要求 |

本地源码构建：

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f server router intent
```

停止服务：

```bash
docker compose down
```

### Docker 已知阻塞项

1. `packages/core` 的 SQLite 默认路径由编译模块位置推导，不读取 `CLAWGATE_DB_PATH`。Compose 挂载的 `/app/data` 当前不会承载实际数据库，不能按该路径做持久化或备份承诺。
2. 干净数据库的建表 SQL 缺少 `dags.cron_timezone`，但 Drizzle schema 会访问该列。临时空库探针已复现首次完整 DAG 查询报 `no such column: cron_timezone`；旧数据库升级路径反而会补列。
3. `GATEWAY_URL` 当前没有驱动 Server 的 Gateway 地址；地址仍来自 `~/.openclaw` 配置读取器。
4. Server 会在容器工作目录生成 `clawgate.yaml`，现有 volume 没有明确持久化该文件。
5. `docker-compose.prod.yml` 和 `docker-compose.team.yml` 使用远程 `latest` 镜像，仓库没有把镜像存在性、架构支持和版本固定纳入本轮验证。

在这些问题修复前，Compose 适合检查镜像构建与服务集成，不适合作为可靠的数据持久化方案。

## 5. 实际环境变量

### Server / Core 已读取

| 变量 | 默认值 | 作用 |
|---|---|---|
| `REDIS_URL` | `redis://127.0.0.1:6379` | Core Redis 与 BullMQ 连接 |
| `ROUTER_URL` | `http://127.0.0.1:3001` | OpenAI 路由与 Stats 使用；`/api/route` 当前仍有独立默认客户端 |
| `INTENT_SERVICE_URL` | `http://127.0.0.1:8000` | 反馈 API 调用 Intent |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Server 本地 Ollama Provider |
| `ANTHROPIC_API_KEY` | 空 | Anthropic Provider |
| `OPENAI_API_KEY` | 空 | OpenAI Provider |
| `CLAWGATE_REQUIRE_OPENCLAW` | `false` | Gateway 连接失败时是否终止 Server |
| `GATEWAY_AUTH_MODE` | `auto` | GatewayClient 的环境回退；Server 实际优先使用 `clawgate.yaml.gateway.auth_mode`，CLI sessions 未传显式模式时会读它 |
| `CLAWGATE_MAX_PARALLEL_SESSIONS` | `5` | 单个 DAG 执行的并发 Session 上限 |
| `CLAWGATE_ADMIN_TOKEN` | 未设置 | 远程 OpenClaw restart/upgrade 的管理 Token |
| `WEB_DIST` | 自动推导 | SPA 静态目录 |

### 当前未接入或仅由 Compose 消费

| 变量 | 实际情况 |
|---|---|
| `CLAWGATE_DB_PATH` | Server/Core 不读取 |
| `GATEWAY_URL` | Server 不读取 |
| `ADMIN_API_KEY` | Server 不读取；生命周期接口读取的是 `CLAWGATE_ADMIN_TOKEN` |
| `CLAWGATE_PORT` | 只改变团队 Compose 的宿主机映射；Server 容器内仍固定 3000 |

## 6. 数据与备份

当前持久化职责：

- Redis volume：BullMQ、热状态、路由缓存、负载快照。
- Qdrant volume：L2 embedding 数据。
- Ollama volume：本地模型。
- SQLite：DAG、Run、团队、成员、实例、告警和归档目标。

SQLite 的容器路径契约尚未修复，因此当前文档不提供一个看似可用但实际错误的 `docker cp /app/data/clawgate.db` 命令。完成 `CLAWGATE_DB_PATH` 接线并增加冷启动迁移测试后，再建立正式备份与恢复步骤。

## 7. 安全边界

当前 Server 固定绑定 `0.0.0.0`，CORS 接受任意 Origin，部分 REST 与 `/ws/events` 没有认证；团队 DAG/实例详情还存在个人模式绕过团队归属检查的路径。Gateway token 与成员 API key 也以明文保存。

因此：

- 只在本机或隔离的受信网络运行。
- 不要直接映射到公网。
- 不要在当前版本录入生产 Gateway token、正式 Provider key 或敏感 Prompt 数据。
- 反向代理、TLS 和防火墙不能替代应用层鉴权修复，只能作为临时外围限制。

## 8. 当前验证基线

截至 2026-07-29：

| 检查 | 结果 |
|---|---|
| Node 强制全量构建 | 5/5 workspace 成功 |
| Core Vitest | 4 文件、46/46 通过 |
| 根 `pnpm test` | 失败；Server/Shared/Web 没有测试文件，CLI 无 test 任务 |
| Rust `cargo test` | 22/22 通过（在临时独立副本中规避父级 workspace 污染） |
| Python `compileall` | 通过 |
| Python pytest | 0 个测试，退出码 5 |
| 三份 Compose 配置解析 | 全部通过 |
| `pnpm lint` | 命令退出 0，但实际执行 0 个 lint task |

更完整的能力状态与修复优先级见 `docs/progress/DONE.md` 和 `docs/progress/NEXT.md`。
