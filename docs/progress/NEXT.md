# 下一步开发计划（NEXT）

> 本文件以风险和能力域排序，不再按历史版本号推断成熟度。基线提交为 `7820640`；当前工作区 F1/F2/F3 单独列为“开发中”，不计入 DONE。最后核对：2026-07-29。

## 当前目标

先建立可重构、可迁移、可回归的真实基线，再讨论 v1.0 GA。优先级定义如下：

- **P0**：存在协议分叉、越权、数据损坏/丢失风险，进入架构重构前必须处理。
- **P1**：影响部署一致性、API 可靠性和持续回归，GA 前必须处理。
- **P2**：已经在工作区开发的产品能力，先完成回归和收口，再决定合入。
- **GA 后**：不阻塞当前核心产品交付的生态扩展。

## P0 — 契约、安全与数据正确性

### P0-1 修复 OpenClaw Gateway 业务契约并完成真实 E2E

**负责模块**

- `packages/core/src/gateway/index.ts`、`gateway-executor.ts`、`gateway/pool.ts`
- Server agents/sessions/events/DAG routes
- CLI sessions 与 Web 实时事件消费

**当前状态**

- token/challenge 握手逻辑存在，但业务响应按 `result`、事件按 `data` 解包；审计的 OpenClaw 2026.4.14 使用 `payload`。
- `sessions.send` 当前发送 `{ key, content }`，真实 schema 要求 `{ key, message }` 且禁止额外字段。
- DAG 执行器等待 `session.end`，该版本没有此完成事件；监听器又在 send 返回后注册，存在首帧丢失竞态。
- `sessions.list` 的真实 envelope 与 `Session[]` 假设不一致。

**当前验证**

- Gateway executor 8 个 Mock 测试通过，但 Mock 直接调用 listener，绕过帧解析、请求字段和完成事件。

**主要限制/风险**

- Session API、CLI sessions、实时面板和所有 DAG Agent 节点目前可能失败或得到错误结构。
- 连接握手成功会造成“Gateway 已兼容”的假象。

**验收条件**

- 以明确的 OpenClaw 版本矩阵固化请求、响应和事件 schema；Adapter 使用 `payload` 并正确映射 Session envelope。
- 根据真实协议定义 Agent 输出完成条件，发送前注册监听器，并覆盖超时、首帧、乱序、断线、abort 和重连。
- 使用本机真实 Gateway 完成 sessions list/create/send/abort、单节点 DAG、多节点 DAG 和事件广播 E2E。
- Mock fixture 必须来自真实捕获的脱敏 frame，并在 CI 中校验向后兼容版本。

### P0-2 统一 ClawGate 跨服务协议契约

**负责模块**

- Node：`packages/core/src/router`、Server route/client 层
- Rust：`services/router-rust`
- Python：`services/intent-python`
- 协议草案：`proto/router.proto`、`proto/intent.proto`

**当前状态**

- 运行链路实际全部使用 HTTP REST；Proto 未接入，并且字段/端点已经与 REST 实现漂移。
- Node、Rust、Python 各自定义请求/响应结构，没有单一可生成、可校验的契约源。

**当前验证**

- Rust 有模拟 Python HTTP 响应测试；Node/Python 没有跨服务契约测试。

**主要限制/风险**

- 任一服务独立改字段可能只能在运行时暴露错误。
- 文档若继续同时描述 REST 和 gRPC，会进一步扩大设计与实现分叉。

**验收条件**

- 明确近期唯一生产协议：建议先以现有 REST 为准；Proto 要么删除/标记归档，要么重新生成并真正接入，不能保持双重真相。
- 为 route、classify、feedback、stats、circuit 建立版本化 schema，并由三端共享或生成类型。
- CI 中加入 Node→Rust→Python 的兼容性测试，覆盖成功、超时、非法响应、服务不可达和版本不兼容。

### P0-3 收紧鉴权、租户隔离与密钥生命周期

**负责模块**

- `packages/core/src/auth`
- Server teams/members/instances/dags/dag-runs/openclaw lifecycle 路由
- `.env.example`、`docker-compose.team.yml`
- SQLite members/instances 表

**当前状态**

- 无 `X-API-Key` 会自动进入个人模式；团队 API Key、实例 Gateway Token 明文保存。
- Team 创建入口没有消费 `ADMIN_API_KEY`；lifecycle 写操作检查的是 `CLAWGATE_ADMIN_TOKEN`。
- 部分按 ID 操作只验证“调用者有无 key”，没有把目标资源与调用者的 team/member 绑定。

**当前验证**

- 仅完成 TypeScript 构建；没有认证矩阵、跨租户和密钥轮换测试。

**主要限制/风险**

- 公网部署时可能把“省略认证”误解释为个人模式。
- 已知资源 ID 的调用者可能操作不属于自己的实例或读取个人模式下的其他资源。
- 密钥泄漏后没有轮换、吊销、审计路径。

**验收条件**

- 定义明确的部署模式和默认拒绝策略：团队/公网模式不得自动降级为匿名个人模式。
- 统一管理员变量与 Header，保护团队 bootstrap、团队读取、lifecycle 写操作和所有管理 API。
- 所有资源查询/更新/删除都附带 team/member 所属条件；补齐匿名、无效 key、普通成员、管理员、跨团队五类测试。
- API Key 只保存不可逆摘要并支持创建、轮换、吊销；Gateway Token 使用受保护的加密存储，响应和日志默认脱敏。

### P0-4 建立版本化数据库迁移

**负责模块**

- `packages/core/src/db/schema.ts`、`db/index.ts`
- 所有 SQLite route/worker
- 部署卷、备份和恢复流程

**当前状态**

- 当前用 `CREATE TABLE IF NOT EXISTS` 与启动时 `ALTER TABLE` 混合迁移，没有迁移版本表。
- Drizzle schema 与手写 SQL 在 nullability/default/演进字段上存在不一致；部分业务更新字段没有对应 schema 列。
- Phase D 的 `cron_timezone` 在干净建表 SQL 中缺失；补列只对迁移开始前已经存在的 `dags` 执行，并且采用捕获错误后继续启动的 best-effort 策略。

**当前验证**

- 临时空库探针已复现 `initDb()` 后首次完整 DAG 查询报 `no such column: cron_timezone`。
- 旧数据库升级、重复迁移和故障回滚仍没有自动化测试；Compose 只做了静态解析。

**主要限制/风险**

- 迁移失败可能只打印日志，服务继续运行并在后续请求中失败。
- 无法可靠判断某实例的 schema 版本，也没有自动备份、事务回滚或降级策略。

**验收条件**

- 引入单调版本号的迁移目录和 `schema_migrations`；启动前以事务执行，失败则阻止服务进入 ready。
- 用空库、上一版本真实 schema 副本、重复执行和故意中断四类场景测试所有迁移。
- 对齐 Drizzle 与实际 DDL，明确外键、级联、nullability、索引和默认值；团队+owner 等多表写入使用事务。
- 数据路径由显式 `DB_PATH` 控制，Compose 持久卷实际覆盖该路径；形成备份、恢复和回滚说明。

### P0-5 接通并加固 Redis→SQLite 归档

**负责模块**

- `packages/core/src/queue/index.ts`、`redis/index.ts`
- `packages/server/src/index.ts`
- costs/routing_logs 表与 stats API

**当前状态**

- 归档 Queue、Worker 和 scheduler 代码存在，但 Server 启动链路没有初始化或启动它们。
- 成本 Hash 与路由日志 List 会写 Redis；现有处理器读取/移除 Redis 数据后再写 SQLite。

**当前验证**

- 本轮没有运行归档脚本或真实 Redis/SQLite 故障测试。

**主要限制/风险**

- 自动归档事实上不运行，Redis TTL 到期后历史成本可能消失。
- SQLite 插入失败时，已从 Redis 移除的数据无法自动恢复；重复执行也缺少幂等依据。

**验收条件**

- Server 完整接入 archive queue 的初始化、scheduler、worker 和优雅关闭，并在 health/metrics 中暴露状态。
- 采用可重试且幂等的搬运协议：先持久化确认、再 ack/删除；为归档批次或事件建立唯一键/checkpoint。
- 覆盖 Redis 重启、SQLite 锁定/写失败、Worker 崩溃、重复 job、超过 500 条 backlog 和跨日成本场景。
- Dashboard 的实时值与归档值在切换窗口不重不漏，并有可执行的对账测试。

## P1 — 部署契约、API 可靠性与回归体系

### P1-1 对齐配置、镜像与持久化契约

**负责模块**

- 三份 Docker Compose、三个 Dockerfile、`.env.example`
- Node config/yaml/环境变量读取
- CI 镜像构建与发布

**当前状态**

- 三份 Compose 均可解析，但尚未冷启动。
- 多处配置名或消费方不一致：例如团队 Compose 的 `ADMIN_API_KEY` 与 lifecycle 的 `CLAWGATE_ADMIN_TOKEN`，以及容器声明的 Gateway/Intent 配置与代码实际读取路径。
- Qdrant/Ollama 使用浮动 `latest`，Node 数据卷是否覆盖实际 SQLite 路径尚未验收。

**当前验证**

- `docker compose ... config --quiet` 3/3 通过；未拉镜像、未建卷、未执行 health check。

**主要限制/风险**

- “配置文件可解析”不代表服务能连通、数据能持久或发布镜像存在。
- 环境变量看似配置成功但实际未被代码读取，会造成危险的静默回退。

**验收条件**

- 建立一张配置契约表：变量名、默认值、消费模块、开发/生产/团队差异和敏感性，并由启动时校验未知/缺失配置。
- 固定基础镜像版本；验证 GHCR 三镜像从干净机器可拉取并完成健康启动。
- 对开发、单机、团队三套 Compose 做冷启、重启、升级与卷恢复测试；Linux 与 macOS 至少各一轮。
- 反向代理 TLS 场景验证 HTTP、SSE、WebSocket（自动 `ws/wss`）和 SPA 静态资源。

### P1-2 统一 API 校验、错误与异步任务语义

**负责模块**

- 全部 Fastify routes
- DAG/Cron/Webhook、Gateway、Provider failover 与 lifecycle
- Web/CLI API clients

**当前状态**

- 请求校验主要由路由内手写条件完成；错误状态码和返回结构不统一。
- Cron 只校验 5 段；部分后台注册失败只记录日志但 API 仍返回成功。
- Server 启动时 Cron 恢复以未 await 的异步函数运行，readiness 不代表调度恢复完成。

**当前验证**

- Server 无测试文件；现状只有构建验证。

**主要限制/风险**

- 客户端无法可靠区分认证、输入、依赖不可用和部分成功。
- 数据已经落库但 scheduler/队列注册失败时，API 语义不明确，也缺少补偿状态。

**验收条件**

- 用 Fastify/Zod JSON Schema 统一验证请求/响应，生成 API 文档与客户端类型。
- 统一错误 envelope、错误码、HTTP 状态和 request ID；依赖故障有明确 502/503/504 语义。
- 对数据库+队列/scheduler 的跨系统写入定义事务边界、补偿任务和可查询状态。
- readiness 等待关键迁移、Redis、Worker 与 scheduler 恢复；standalone 降级必须在 health 中可见。

### P1-3 完成自动化测试与 CI 门禁

**负责模块**

- `packages/server`、`shared`、`web`、`cli`
- `services/intent-python`
- Docker/E2E 测试与 CI workflow

**当前状态**

- Core 46/46、Rust 22/22；Server/Shared/Web/Python 没有测试，CLI 没有 test 任务。
- `pnpm test` 当前失败；`pnpm lint` 实际 0 tasks。

**当前验证**

- 见 DONE 的 2026-07-29 验证快照。

**主要限制/风险**

- 当前 CI 即使只看构建也无法拦住 API、UI、Python、数据库迁移和部署回归。
- 历史源码字符串验证脚本不能替代行为测试。

**验收条件**

- Server：路由注入测试覆盖认证、DAG、团队、OpenAI、反馈、统计与 lifecycle 权限。
- Web：关键页面组件/交互测试覆盖 DAG 保存运行、错误态、i18n、事件重连；增加至少一条浏览器 E2E。
- Python：建立可安装的锁定环境，覆盖 L2/L3/L4 正常/降级路径，并修复或移除不可运行的 LR 路径。
- 根 `pnpm test`、真实 lint/typecheck、`cargo test`、pytest、Compose E2E 在干净 CI 环境全部可重复通过；不再依赖父目录 Cargo 配置。

### P1-4 修复已知前端与实时链路可靠性问题

**负责模块**

- Web DAG editor/store、Gateway events hook、Router/Dashboard 页面
- Server WebSocket events

**当前状态**

- DAG 布局 position 保存丢失；60 秒运行超时存在闭包旧状态问题。
- Gateway WebSocket URL 固定 `ws://`；Router 页没有挂载实时事件 hook。
- 前端 i18n 只覆盖部分既有页面；当前工作区新能力有硬编码中文。
- Web 主 JS 917.78 kB。

**当前验证**

- Vite 构建通过但给出 bundle 体积警告；没有 Web 测试。

**主要限制/风险**

- HTTPS、开发代理、长任务、页面刷新与中英文切换下行为不稳定。

**验收条件**

- 持久化并兼容迁移节点 position；轮询改为可取消、基于 run 状态且支持超过 60 秒的服务端超时策略。
- WebSocket 根据页面协议选择 `ws/wss`，支持代理 base URL、指数退避、心跳和卸载清理。
- 所有用户可见字符串进入 i18n；按页面拆包，将 bundle 警告纳入可量化预算。

## P2 — 当前未提交工作区（F1/F2/F3）

> 下列状态描述当前工作区中的 6 个用户修改文件。这些改动已经随本轮 Node 全量构建通过，但尚未形成独立提交，也没有 Server/Web 行为测试，因此不得提前写入 DONE。

### F1 — DAG JSON 导入/导出

**负责模块**

- `packages/server/src/routes/dags.ts`
- `packages/web/src/pages/DagsListPage.tsx`

**当前状态**

- **工作区开发中**。新增导出 v1 JSON、导入新建 API 和列表页文件导入/下载；Webhook Token 不导出，导入 Webhook 时重新生成。
- 当前没有 CLI `dag export/import` 实现。

**当前验证**

- TypeScript/Vite 构建通过；没有 API 或浏览器测试。

**主要限制/风险**

- 导入只做基础结构校验，尚未完整复用创建 DAG 的节点、边、条件、delay、cache 与 Cron 校验。
- 前端提示硬编码中文；团队鉴权、重复名称、超大文件、恶意深层 JSON、Cron 注册部分成功均未验收。

**验收条件**

- 定义稳定的 export schema/version 与兼容策略；创建和导入共用同一校验器。
- 覆盖 round-trip、旧/未知版本、非法节点/边、跨团队、Token 不泄漏、大小限制和 Cron 注册失败。
- 完成 i18n 和可访问错误提示；是否增加 CLI 由重构后的产品边界决定。

### F2 — Dashboard OpenClaw 状态与运维建议

**负责模块**

- `packages/core/src/openclaw/lifecycle.ts`、`packages/core/clawgate.yaml`
- `packages/web/src/pages/DashboardPage.tsx`

**当前状态**

- **工作区开发中**。Dashboard 展示状态、版本检查与可复制的重启/升级命令；版本查询改为 npm registry；本地示例 `auth_mode` 改为 `token`。
- UI 只给出命令建议，不直接调用 restart/upgrade API。

**当前验证**

- 构建通过；npm registry 网络、超时、版本比较和各平台命令没有运行时测试。

**主要限制/风险**

- 简单字符串不等价比较不能正确处理所有 semver/预发布版本。
- Dashboard 文案硬编码中文；命令建议需要与实际安装来源和权限模型对齐。

**验收条件**

- 使用 semver 比较并覆盖无安装、registry 超时、非 2xx、预发布/降级等场景。
- 状态和建议必须标明来源与适用平台，不在中央团队服务上暗示可直接控制成员主机。
- 完成 i18n；明确 `token/challenge/auto` 的安全默认值后再调整示例配置。

### F3 — Gateway 实时事件面板与广播稳定性

**负责模块**

- `packages/server/src/routes/events.ts`
- `packages/web/src/pages/DashboardPage.tsx`

**当前状态**

- **工作区开发中**。广播时对订阅者集合取快照，Dashboard 挂载事件 hook 并展示最近事件。

**当前验证**

- 构建通过；没有多客户端、断线重连、HTTPS 或事件洪峰测试。

**主要限制/风险**

- 事件只在单个 Node 进程内广播，没有跨副本 EventBus；WebSocket 仍硬编码 `ws://`。
- 当前只桥接有限的 Session 事件，缺少背压、序号、补发和权限隔离。

**验收条件**

- 覆盖多客户端连接/断开、发送失败、重连、乱序与高频事件；HTTPS 使用 `wss`。
- 定义事件 envelope、版本、租户过滤和保留策略；多副本部署前接入 Redis Pub/Sub/Streams 等共享总线。
- Router 与 Dashboard 对“路由事件”和“Gateway Session 事件”使用清晰、独立的语义。

## GA 验收门槛

以下条件同时满足后，才把项目标记为 v1.0 GA：

1. P0 全部关闭，并有迁移、越权、归档故障恢复测试作为证据。
2. 根构建、测试、真实 lint、Rust、Python 和 Compose E2E 在干净 CI 全绿。
3. 单机与团队部署分别完成冷启、重启、升级、备份恢复、TLS/WebSocket 和最小权限验收。
4. 核心场景完成可重复 E2E：智能路由、OpenAI 流式/非流式、DAG manual/cron/webhook、团队注册/心跳/调度/告警。
5. 发布版本、镜像 tag、数据库 schema、API 契约和中英文文档采用同一版本源；已知限制公开且可定位。
6. 形成资源基线与 SLO：启动时间、路由延迟、队列积压、事件连接数、数据保留和恢复目标。

## GA 后事项

下列能力不应挤占 P0/P1：

- Node.js SDK 与 Python SDK（在稳定 API 契约之后设计）。
- 插件扩展机制与第三方 Provider/节点类型。
- 跨实例日志聚合、搜索与长期可观测平台。
- Remote SSH 与远程主机生命周期管理。
- 自动更新/Watchtower 与裸机 `clawgate self-update`。
- 更复杂的团队调度策略、配额、审计与计费。
- HA 控制面、多副本事件总线和外部数据库支持。
- 完整贡献指南、发布治理与兼容性政策。
