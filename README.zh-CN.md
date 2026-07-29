<h1 align="center">ClawGate</h1>

<p align="center">
  <strong>面向 OpenClaw 的基础设施与编排增强层</strong><br/>
  模型路由 · Agent 与 Session 可观测性 · DAG 工作流 · 团队实例运维
</p>

<p align="center">
  <a href="./README.md">English</a> ·
  <a href="./architecture.md">架构文档</a> ·
  <a href="./docs/deployment/single-node.md">单点部署</a> ·
  <a href="./docs/deployment/team.md">团队部署</a> ·
  <a href="./docs/progress/DONE.md">已实现</a> ·
  <a href="./docs/progress/NEXT.md">下一步</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.1.0-blue" alt="版本 0.1.0" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT 许可证" />
  <img src="https://img.shields.io/badge/Node.js-%3E%3D20-brightgreen" alt="Node.js 20 或更高版本" />
  <img src="https://img.shields.io/badge/Rust-1.83-orange" alt="Rust 1.83 Docker 构建基线" />
  <img src="https://img.shields.io/badge/Python-3.11%2B-yellow" alt="Python 3.11 或更高版本" />
</p>

## ClawGate 是什么

ClawGate 是 [OpenClaw](https://github.com/openclaw/openclaw) 周边的基础设施增强层，不替代 OpenClaw Gateway。它增加了一套控制面，用于选择模型 Provider、观察 OpenClaw Agent 与 Session、执行多步骤工作流，以及协调多个已注册实例。

项目围绕四个核心思想构建：

- 渐进式处理路由：先查精确缓存，再做语义意图判断，最后使用保守降级策略。
- 保持 OpenClaw 集成为可选依赖：Gateway 不可达时，路由和控制台仍可启动；Agent、Session 与依赖 Gateway 的 DAG 能力需要 OpenClaw。
- 将编排状态放入明确的数据层：SQLite 保存结构化记录，Redis 保存热状态与队列，Qdrant 保存语义样本。
- 通过统一的 Node.js API 与控制台承载运维入口，同时将路由和意图分类拆分为职责集中的 Rust、Python 服务。

ClawGate 当前是版本号为 `0.1.0` 的早期项目。仓库已经包含较多实际功能，但尚未完成生产加固，也没有完成基于真实 OpenClaw Gateway 的端到端发布验收。

## 系统架构

```text
浏览器 / CLI / OpenAI 风格客户端
                 |
                 v
       Node.js API 与控制面 :3000
       Fastify + REST + WebSocket + BullMQ
          |             |              |
          | HTTP        | Provider     | WebSocket
          v             v              v
    Rust 路由器 :3001  Anthropic /    OpenClaw Gateway
    L1 + 降级规则 +    OpenAI /       （可选）
    熔断状态           Ollama
          |
          | HTTP
          v
    Python 意图服务 :8000
    L2 语义检索 + L3 分类 + L4 反馈

SQLite：持久化应用记录
Redis：热状态、成本、路由日志、节点缓存、BullMQ
Qdrant：语义路由样本
```

ClawGate 各服务之间的运行时通信使用 HTTP/REST。`proto/` 下的文件是协议设计稿，当前没有接入运行时。

| 能力域 | 当前实现 |
| --- | --- |
| API 与控制面 | Node.js、TypeScript、Fastify 5、WebSocket、BullMQ、Drizzle、SQLite、Redis |
| 路由器 | Rust、Axum、Tokio、Redis Hash 缓存、降级规则、进程内 Provider 熔断状态 |
| 意图服务 | Python、FastAPI、Ollama Embedding、Qdrant、规则/LR/保守分类、显式反馈接口 |
| Web 应用 | React 19、Vite 6、Tailwind CSS 4、Zustand、TanStack Query、React Flow、Recharts |
| CLI | 基于 Commander.js 的配置、发现、Session、状态与 OpenClaw 生命周期命令 |
| 集成协议 | 服务间使用 REST；连接 OpenClaw 与浏览器事件使用 WebSocket |

模块归属、数据流与部署拓扑详见[架构文档](./architecture.md)。

## 能力状态

下表中的“已实现”表示功能存在于 `HEAD`（`7820640`，Phase D）源码中，不表示所有路径都已经通过最新一轮真实 Gateway 端到端测试。

| 能力 | 状态 | 当前范围 |
| --- | --- | --- |
| 渐进式模型路由 | 源码已实现 | Rust L1 精确缓存、Python L2 语义检索、Python L3 规则/可选 LR/保守降级、显式 L4 反馈 |
| OpenAI 风格 Chat 接口 | 已实现子集 | `POST /v1/chat/completions`；非流式支持候选 Provider 故障切换，流式只调用一个已选 Provider，两条路径均记录成本 |
| Provider 保护 | 已实现但有限制 | Anthropic、OpenAI、Ollama 分发与熔断上报；熔断状态仅保存在进程内 |
| Agent 与 Session 可观测性 | Adapter 存在，兼容性阻塞 | 本地发现已实现，但当前 RPC payload 与事件契约不兼容已核验的 OpenClaw 2026.4.14 |
| DAG 工作流 | 引擎已实现，真实 Gateway 阻塞 | 拓扑、变量、条件、延迟、历史、缓存和触发器已存在；真实 Agent 节点 E2E 被 Gateway 契约阻塞 |
| Phase D 触发可靠性 | 已进入 HEAD，待运行验收 | Cron 时区、scheduler 恢复/清理、Webhook payload 与替换已实现；迁移和外部 E2E 仍待完成 |
| 团队实例管理 | 已实现基础能力 | 团队、成员、实例注册与心跳、健康总览、离线告警 |
| 运维控制台 | 已实现 | 路由、成本、DAG、实例、健康与告警页面；部分实时链路和国际化仍不完整 |
| Proto 定义 | 未接入 | 定义文件存在，但当前生产运行时调用使用 REST |

当前未提交工作区还包含 Phase F 开发内容，尚未纳入已验证基线：

- F1：DAG JSON 导入与导出。
- F2：控制台 OpenClaw 状态、npm registry 版本检查与可复制的运维命令建议。当前工作不让控制台直接执行重启或升级。
- F3：Gateway 实时事件面板与 WebSocket 广播稳定性调整。

更细的进度拆分见 [DONE.md](./docs/progress/DONE.md) 与 [NEXT.md](./docs/progress/NEXT.md)。

## 快速开始

### 从源码使用 Docker 启动

以下命令启动 ClawGate 三个服务，以及 Redis、Qdrant、Ollama：

```bash
git clone https://github.com/DXL-0702/ClawGate.git
cd ClawGate
cp .env.example .env
docker compose up -d --build

# 源码构建版 Compose 不会预拉取以下模型。
docker exec clawgate-ollama ollama pull nomic-embed-text
docker exec clawgate-ollama ollama pull qwen2.5:3b

curl http://localhost:3000/api/health
```

服务健康后访问 `http://localhost:3000`。`.env` 中的 Provider Key 是可选项；不配置时，只能使用已配置的本地 Ollama 模型。

当前干净数据库迁移会创建不含 `cron_timezone` 的 `dags` 表；临时空库探针已在首次完整 DAG 查询时复现 `no such column: cron_timezone`。在 [NEXT.md](./docs/progress/NEXT.md) 的迁移 P0 修复前，请把该路径视为集成环境。

仓库也提供基于已发布镜像的 Compose 文件：

```bash
docker compose -f docker-compose.prod.yml up -d
```

文件名表示其预期部署方式，不代表项目已经具备生产就绪保证。对外暴露服务前，请先阅读[单点部署指南](./docs/deployment/single-node.md)。

### 源码开发

先安装并构建 Node.js 工作区：

```bash
corepack enable
pnpm install
pnpm build
docker compose up -d redis qdrant ollama
```

然后在不同终端分别运行应用进程：

```bash
cargo run --manifest-path services/router-rust/Cargo.toml
```

```bash
python3 -m venv .venv
.venv/bin/pip install -r services/intent-python/requirements.txt
.venv/bin/uvicorn main:app --app-dir services/intent-python --port 8000
```

```bash
pnpm --filter @clawgate/server dev
pnpm --filter @clawgate/web dev
```

API 地址为 `http://localhost:3000`，Vite 开发控制台地址为 `http://localhost:5173`。Vite 会将 `/api` 代理到 3000 端口。`pnpm dev` 只启动工作区包进程，不会启动 Rust 或 Python 服务。

### 配置与 CLI

服务器首次启动时，如果没有 `clawgate.yaml`，会自动生成。执行 `pnpm build` 后，可直接运行仓库 CLI：

```bash
node packages/cli/dist/bin/clawgate.js init
node packages/cli/dist/bin/clawgate.js status
node packages/cli/dist/bin/clawgate.js agents list
node packages/cli/dist/bin/clawgate.js sessions list
```

Agent 发现依赖 OpenClaw 安装目录，实时 Session 命令要求 Gateway 可达且协议兼容。`status` 展示的是归一化后的本地 OpenClaw 配置，不是路由命中率或成本汇总。

### API 入口

```text
GET  /api/health                 服务与 OpenClaw 连接状态
POST /api/route                  请求路由决策
GET  /api/route/stats            路由统计
POST /api/route/feedback         提交显式反馈
POST /v1/chat/completions        OpenAI 风格 Chat Completions 子集

GET  /api/agents                 已发现的 OpenClaw Agent
GET  /api/sessions               Gateway Session

GET  /api/dags                   DAG 定义
POST /api/dags/:id/run           启动 DAG 执行
GET  /api/dag-runs/:runId        查看 DAG 执行状态
POST /api/dags/:id/webhook       触发 Webhook DAG

GET  /api/instances              已注册实例
GET  /api/health/overview        团队健康总览
GET  /api/alerts                 告警历史
GET  /api/stats/overview         控制台统计
```

以上是代表性入口，不是完整 API 规范。当前契约以 `packages/server/src/routes/` 为准。

## 验证基线

使用以下命令建立最新本地基线：

```bash
pnpm build
pnpm test
cargo test --manifest-path services/router-rust/Cargo.toml
python3 -m compileall services/intent-python
docker compose config
docker compose -f docker-compose.prod.yml config
```

当前只有 `packages/core` 存在 Vitest 文件；Server、Shared、Web 没有测试文件，CLI 没有 test 任务。因此根 `pnpm test` 目前仍会失败，尽管 Core 的 46 个测试全部通过。Rust 有 22 个通过测试；Python 没有 pytest 套件，不能宣称其回归已覆盖。

除非验证过程明确接入兼容的真实 OpenClaw Gateway，并同时覆盖路由、流式输出、工作流、WebSocket 事件与团队认证，否则不应将当前验证解释为真实 Gateway 端到端验收。

## 已知限制

- `/v1/chat/completions` 实现的是 ClawGate 当前使用的子集，不保证其他 OpenAI 端点或完整请求/响应字段一致。
- 已核验的 OpenClaw 2026.4.14 使用 `payload` 返回 RPC 数据，Session 发送字段要求 `message`，并不存在当前 Adapter 等待的 `session.end` 完成事件。因此实时 Session 与 DAG Agent 节点目前是明确阻塞，不只是尚未测试。
- Python 可选 LR 分类器路径仍使用过时的 `sklearn.externals.joblib` 导入，仓库也没有训练模型文件；LR 不可用时 L3 会从规则路径降级到保守策略，L2 仍依赖 Ollama Embedding 与 Qdrant。
- L4 反馈计数保存在进程内，并按模型聚合，不是持久化、按 prompt 运作的自主学习闭环。
- Rust 熔断状态保存在内存中，部分路由统计计数器尚未接入实际路由路径。
- 浏览器实时能力仍需针对 HTTPS/WebSocket 部署和页面级订阅完整性进行加固。
- 当前保存路径不会持久化 DAG 节点画布位置，部分前端超时与状态处理仍需修正。
- 团队 Gateway Token 仍为明文存储，API Key 也没有轮换流程。没有额外安全控制时，不应把当前团队部署暴露给不可信网络。
- 国际化尚未完成，包括部分 Phase F 工作区改动。

这些限制属于重构与交付就绪工作，不能通过标记为 `v1.0` 来掩盖。

## 仓库结构

```text
packages/
  shared/          共享 TypeScript 契约
  core/            配置、OpenClaw 客户端、存储、DAG 执行
  server/          Fastify REST/WebSocket API 与静态 Web 托管
  web/             React 控制台与 DAG 编辑器
  cli/             Commander.js CLI
services/
  router-rust/     L1 路由缓存、降级与熔断状态
  intent-python/   L2/L3 意图分类与 L4 反馈
proto/             尚未接入的协议设计定义
docs/deployment/   单点与团队部署指南
docs/progress/     已实现基线与后续工作
```

## 文档导航

- [架构文档](./architecture.md)：运行时边界、数据流、存储与已知设计债务。
- [单点部署](./docs/deployment/single-node.md)：本地与 Docker 部署细节。
- [团队部署](./docs/deployment/team.md)：中央服务、成员、实例与安全假设。
- [已实现基线](./docs/progress/DONE.md)：仓库基线中已经存在的能力。
- [下一步](./docs/progress/NEXT.md)：当前工作区改动、验证缺口与计划重构。

## 参与贡献

修改行为前，请对照 [DONE.md](./docs/progress/DONE.md) 与 [NEXT.md](./docs/progress/NEXT.md) 检查实际实现。测试范围应与受影响的运行时边界匹配，不要把 Proto 定义或历史里程碑文字当作当前契约。

## 许可证

MIT，详见 [LICENSE](./LICENSE)。
