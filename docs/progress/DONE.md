# 已实现能力基线（DONE）

> 本文件以仓库当前提交 `7820640`（`Finish phase d`）为基线，只记录该提交中已经存在的实现。当前工作区尚未提交的 F1/F2/F3 改动不计入“已完成”。
>
> “已实现”表示代码存在且满足本节写明的验证边界，不等同于生产环境端到端验收或 v1.0 GA。最后核对：2026-07-29。

## 状态与验证口径

- **已实现**：能力已进入 `HEAD`，并通过与其风险相称的现有自动化验证。
- **代码已就绪**：实现已进入 `HEAD` 且可构建，但缺少专门测试或真实依赖端到端验证。
- **不在本基线**：仅存在于未提交工作区、设计文档或未接入代码中。

### 当前验证快照

| 范围 | 命令/方式 | 结果 | 边界 |
|---|---|---|---|
| Node/前端构建 | `pnpm exec turbo run build --force` | 5/5 包成功，0 cache | Web 产物主 JS 为 917.78 kB；Vite 给出大于 500 kB 警告 |
| Core 单元/集成测试 | `pnpm --filter @clawgate/core test` | 4 个文件、46 个测试全部通过：cache-key 4、topo-sort 19、gateway-executor 8、executor-integration 15 | 覆盖 DAG 核心算法与模拟 Gateway 执行，不覆盖真实 Redis、OpenClaw 或 HTTP API |
| Node 根测试 | `pnpm test` | **失败** | `server`、`shared`、`web` 均无测试文件，Vitest 因而退出失败；`cli` 没有 `test` 任务 |
| Node lint | `pnpm lint` | 退出码 0 | Turbo 实际执行 0 个任务；各包没有 `lint` 脚本，不能视为 lint 已通过 |
| Rust 测试 | 在隔离临时目录执行 `cargo test` | 22/22 通过 | 仓库内直接运行受父目录 `/Users/jaxson/Cargo.toml` workspace 污染；测试不依赖真实 Redis/Qdrant/Ollama |
| Python 语法 | `python -m compileall services/intent-python` | 通过 | 只证明可编译为字节码 |
| Python 测试 | `pytest` | **0 个测试，退出码 5** | 本机缺少 `fastapi`、`numpy`，未完成运行时 import 和服务启动验证 |
| Compose 静态检查 | 对 `docker-compose.yml`、`docker-compose.prod.yml`、`docker-compose.team.yml` 分别执行 `docker compose ... config --quiet` | 3/3 通过 | 只验证 Compose 可解析，未拉取镜像、冷启动服务或检查持久化 |

## 1. 工程骨架与交付形态

**负责模块**

- 根目录 pnpm workspace、Turborepo、TypeScript 基础配置
- `packages/shared`、`packages/core`、`packages/server`、`packages/cli`、`packages/web`
- `services/router-rust`、`services/intent-python`
- 三份 Docker Compose 与三个服务镜像定义

**当前状态**

- **已实现**。项目由 Node/Fastify 主服务、Rust/Axum 路由服务、Python/FastAPI 意图服务组成；Web UI 由 React 19 + Vite 6 构建并由 Node 服务静态托管。
- Node、Rust、Python 之间的实际进程间协议均为 HTTP REST。`proto/` 仅保留未接入的协议草案，不属于运行链路。
- CLI 当前提供 `init`、`agents`、`sessions`、`status`、`openclaw` 命令组。

**验证**

- Node/前端 5 个包强制全量构建成功。
- Rust 22 个测试在隔离目录全部通过。
- 三份 Compose 均通过静态解析。

**限制**

- 根测试、lint、Python 运行时测试和镜像冷启动尚未形成完整交付门禁。
- Web 主 bundle 已触发 Vite 体积警告。
- 包版本仍为 `0.1.0`；当前实现成熟度不能由历史文档中的 v0.x/v1.0 标签推断。

**本页纳入条件**

- 服务边界、构建入口和实际传输协议可由代码直接确认，且所有 Node 包能够从当前源码构建。

## 2. 智能路由与 OpenAI 兼容入口

**负责模块**

- `services/router-rust`：L1 Redis Hash 缓存、规则 fallback、统计与 Provider 熔断状态 API
- `services/intent-python`：L2 Ollama Embedding + Qdrant、L3 分类、L4 反馈
- `packages/core/src/router`：Node 到 Rust 的 HTTP 客户端与 fallback
- `packages/server/src/routes/route.ts`、`openai.ts`、`feedback.ts`、`stats.ts`

**当前状态**

- **代码已就绪**。Rust `/route` 先查 L1 缓存，未命中时调用 Python `/classify`，Python 不可达时使用 Rust 规则 fallback。
- Node 提供 `/api/route`、`/api/route/stats`、`/v1/chat/completions` 和反馈/统计接口。
- OpenAI 兼容入口支持 Anthropic、OpenAI、Ollama 分发；非流式分支支持候选 Provider failover，流式分支提供 SSE；Provider 成败可上报 Rust 熔断器。
- Python 提供 `/health`、`/classify`、`/feedback`、`/feedback/stats`。

**验证**

- Rust 的缓存、规则、Python HTTP 调用 fallback 与熔断器相关测试计入 22/22 通过。
- Node 路由与 Provider 代码通过 TypeScript 构建。
- Python 源码通过 `compileall`。

**限制**

- 本轮未启动 Redis、Qdrant、Ollama 或外部 Provider，不能声明 L1→L2→L3→Provider 的真实全链路、延迟、命中率或准确率已验证。
- Python 没有 pytest 用例；LR 分类器引用已从现代 scikit-learn 移除的 `sklearn.externals.joblib`，仓库也没有训练模型，LR 路径当前不可交付。
- L4 反馈计数保存在 Python 进程内存，并按模型聚合；重启会丢失，尚不是持久、可审计的自动反馈闭环。
- Rust 熔断状态保存在进程内存；`rule_decisions`、`complex_routed`、`simple_routed` 计数器虽已定义，但当前路由路径没有递增它们。
- `proto/router.proto`、`proto/intent.proto` 与 REST 实现已漂移，不能作为当前契约使用。

**本页纳入条件**

- 纳入的是现有路由分层、API 和 fallback 代码，以及 Rust 单元/模拟 HTTP 测试；不纳入历史文档中的性能、准确率和生产联调结论。

## 3. OpenClaw Gateway、Agent 与 Session 管理

**负责模块**

- `packages/core/src/config`、`gateway`、`openclaw/lifecycle`
- `packages/server/src/routes/agents.ts`、`sessions.ts`、`events.ts`、`openclaw-lifecycle.ts`
- `packages/cli/src/commands`
- Web 的 Agents、Sessions 与 Dashboard 页面

**当前状态**

- **代码已就绪**。GatewayClient 使用 WebSocket RPC，支持 token、challenge、auto 三种握手模式，并从 OpenClaw 配置/设备身份文件读取连接信息。
- Node 服务默认允许 OpenClaw 不可达时以 standalone 模式继续运行；Gateway 相关 API 仍会注册，但其实时行为同时取决于连接与协议兼容性。
- 已实现 Agent 发现、Session 列表/创建/终止、Session 用量写入、Gateway 事件转发到 `/ws/events`。
- 已实现 OpenClaw 状态、更新检查、重启和升级 API；CLI 暴露状态、重启和升级入口。

**验证**

- Gateway 执行器的模拟测试 8/8 通过；相关 Node/CLI/Web 代码构建成功。

**限制**

- 本轮没有运行真实 Gateway E2E；静态对照本机 OpenClaw 2026.4.14 已确认业务契约不兼容：Adapter 按 `result`/`data` 读取，真实协议使用 `payload`；Session 发送使用 `content` 而真实 schema 要求 `message`；执行器等待不存在的 `session.end`。
- Gateway executor 的 Mock 测试直接触发 listener，绕过了上述帧解析和发送字段，因此 8/8 通过不能证明真实 Session/DAG Agent 节点可用。
- WebSocket 客户端当前硬编码 `ws://`，HTTPS 部署需要改为 `wss://`；Vite 开发代理也未配置 `/ws`。
- lifecycle 写操作的管理员变量是 `CLAWGATE_ADMIN_TOKEN`，与团队 Compose 暴露的 `ADMIN_API_KEY` 不一致。
- 未提交工作区中的 Dashboard 运维面板不属于本基线。

**本页纳入条件**

- 纳入 Gateway Adapter、服务降级路径、API/CLI 入口和模拟执行器测试；真实 OpenClaw 兼容修复不属于 DONE。

## 4. DAG 工作流

**负责模块**

- `packages/core/src/dag` 与 BullMQ `dag-execution` 队列
- SQLite 的 `dags`、`dag_runs`、`dag_node_states`
- `packages/server/src/routes/dags.ts`、`dag-runs.ts`
- Web DAG 列表、编辑器、执行历史与详情页面

**当前状态**

- **已实现（核心算法）/代码已就绪（外部执行）**。
- 支持 agent、condition、delay 三类节点；执行器进行拓扑分层，支持线性/并行批次、六种条件运算、跳过传播、节点输出变量替换、并发上限和 Redis 节点输出缓存。
- 支持 manual、cron、webhook 三类触发；运行和节点状态写入 SQLite，前端可轮询运行状态并展示执行历史。
- 个人/团队模式共用执行链路；团队任务可通过 GatewayPool 选择实例。

**验证**

- Core 4 个测试文件、46 个测试全部通过，覆盖 cache key、拓扑排序、条件/跳过/变量替换与模拟 Gateway 执行；未覆盖真实 Redis 缓存读写、HTTP、数据库迁移或 Gateway 帧解析。
- DAG API 与 Web 编辑器通过构建。

**限制**

- 未使用真实 Redis、SQLite HTTP API、OpenClaw Gateway 做完整 DAG E2E；Cron/Webhook 外部触发也未在本轮进行运行时回归。
- Web 编辑器保存时没有持久化 React Flow 节点 `position`，重新加载后会使用推导布局。
- 前端 60 秒轮询超时读取了闭包中的旧 `isRunning` 状态，超时提示可能不生效。
- API 仅用“5 段”检查 Cron 表达式，没有完整语义和 IANA 时区校验。
- 未提交工作区中的 DAG JSON 导入/导出不属于本基线；CLI 也没有 `dag` 命令。

**本页纳入条件**

- DAG 纯算法与 Mock 执行以 46 个 Core 测试为完成边界；涉及 Redis、HTTP、数据库迁移、真实 Gateway 的行为只记为代码就绪或明确阻塞。

### Phase D：已编码，尚未完成运行时验收

**负责模块**

- D1：`dags.cronTimezone`、DAG API、BullMQ JobScheduler `tz`
- D2：Server 启动时扫描 Cron DAG、重新注册 scheduler、清理孤儿/禁用 scheduler
- D3：Webhook JSON body、50 KB 上限、`{{webhookPayload}}` 与嵌套路径替换

**当前状态**

- 三项均已进入 `HEAD`，因此原 NEXT 中“Phase D 待开发”的说法已失效。

**验证**

- Phase D 代码随 5 个 Node 包完成构建。
- 当前 46 个 Core 测试不是 Phase D 专项验收；仓库没有 Server API 测试覆盖 D1/D2/D3。

**限制**

- 干净数据库的 `CREATE TABLE dags` 遗漏 `cron_timezone`；补列逻辑只在迁移开始前已存在 `dags` 时运行。临时空库已复现首次完整 DAG 查询报 `no such column: cron_timezone`。迁移也没有版本、事务、回滚和失败阻断。
- 尚未验证旧数据库升级、非法时区、Redis 数据保留/清空后的 scheduler 恢复、孤儿清理失败重试。
- 尚未通过 HTTP + BullMQ + Worker + Gateway 验证 payload 从 Webhook 到节点 prompt 的完整传播。

**验收条件**

- 用旧版 SQLite 副本验证可重复迁移；覆盖合法/非法时区与夏令时边界；覆盖 Redis 重启、孤儿/禁用 scheduler 清理；对 payload 大小、嵌套值、不存在路径和队列传播增加 API/E2E 测试。

## 5. 团队实例调度与健康告警

**负责模块**

- `packages/core/src/auth`、`gateway/pool`、`queue/health-check`
- SQLite 的 `teams`、`members`、`instances`、`alerts`
- Server 的 teams、members、instances、health-overview、alerts 路由
- `docker-compose.team.yml`

**当前状态**

- **代码已就绪**。存在个人/团队双模式上下文、团队/成员 CRUD、实例注册与心跳、环境/标签过滤、负载选择、Gateway 延迟连接、每分钟健康检查和离线告警。
- 团队 Compose 定义 Node/Rust/Python 与 Redis/Qdrant/Ollama 的中央部署拓扑。

**验证**

- 相关 Node 代码构建成功；团队 Compose 静态解析成功。

**限制**

- Server 没有团队 API 自动化测试，也没有多租户端到端隔离测试。
- 未携带 `X-API-Key` 会自动进入个人模式；部分资源读取/心跳更新没有按资源所属团队收紧，团队边界不能视为已完成安全验收。
- Team 创建入口未使用 Compose 中的 `ADMIN_API_KEY`；成员 API Key 和实例 Gateway Token 明文存入 SQLite，缺少哈希/加密、轮换与吊销机制。
- 健康状态依赖 Redis 20 秒 TTL 与每分钟扫描，尚未验证抖动、重复告警和 Worker 重启场景。

**本页纳入条件**

- 纳入数据模型、路由、GatewayPool 和健康检查代码；不把团队部署标记为安全或生产验收完成。

## 6. 数据、统计与可观测界面

**负责模块**

- SQLite + Drizzle schema
- Redis 热状态、实时成本、路由日志缓冲与 DAG 缓存
- Server stats/health/alerts API
- Web Dashboard、Router、Stats、DAG Runs 页面

**当前状态**

- **代码已就绪**。请求路径可把实时成本和路由日志写入 Redis，SQLite 保存结构化实体和历史；Web 提供概览、路由统计、成本趋势、告警与 DAG 历史视图。
- `packages/core/src/queue/index.ts` 中存在成本与日志归档队列、Worker 和 scheduler 实现。

**验证**

- 数据与 UI 代码通过构建；DAG cache key 和缓存降级包含在 Core 测试中。

**限制**

- Server 启动链路没有调用 `initQueue()`、`startArchiveWorker()`、`scheduleArchiveJobs()`，因此成本/日志归档当前不会自动运行；不能声称 Redis→SQLite 定时归档已交付。
- 现有归档逻辑先从 Redis 移除再逐条写 SQLite，数据库写入失败时存在数据丢失窗口，也没有幂等键或归档 checkpoint。
- Stats 与页面缺少 Server/Web 测试；Router 页面没有启动 Gateway WebSocket hook，实时路由展示并不完整。

**本页纳入条件**

- 纳入热数据写入、持久表、查询 API 和 UI；自动归档在接入启动链路并通过故障恢复测试前不属于已完成能力。

## 7. 当前明确不属于 DONE 的内容

- 当前未提交工作区中的 F1：DAG JSON 导入/导出 API 与 Web UI。
- 当前未提交工作区中的 F2：Dashboard OpenClaw 状态/版本/命令建议，以及 npm registry 版本检查调整。
- 当前未提交工作区中的 F3：Dashboard 实时 Gateway 事件面板与广播迭代稳定性调整。
- gRPC 生产链路、Node/Python SDK、插件机制、Remote SSH、跨实例日志聚合、自动更新。
- “全部测试通过”“四层路由生产全链路通过”“v1.0 GA”之类超出现有验证证据的结论。
