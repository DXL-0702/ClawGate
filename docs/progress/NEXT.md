# 下一步开发计划 (NEXT)

> 本文件记录当前阶段的**具体开发思路**，完整路线图请参阅 [README.md](../../README.md)。
> 最后更新：v1.0 Phase 4 开始 + Issue 6 状态修正（2026-04-18）

---

## 已完成：v0.5 Wave 3 ✅

- 拓扑排序引擎（Kahn's BFS，分层批次）
- 变量替换引擎（`{{node-X.output}}`）
- 多节点执行引擎（线性链 + 并行批次）
- 前端 i18n（ZH/EN 切换）+ 节点状态可视化
- edges 保存 + 节点状态轮询
- 双模式支持（个人/团队）

## 已完成：v0.5 Wave 3.5 ✅

- 节点卡片精致化（多层阴影 + 发光状态点 + 微标签）
- 工具栏紧凑图标化（图标+文字紧凑布局）
- 右侧工作台精致化（可折叠卡片 + 变量引用地图）
- 连线流动动效（执行时 animated 流动）
- 橙灰工业风配色统一（amber/slate/rose/stone 层次）

---

## 已完成：v0.5 Wave 2 ✅

### Wave 2 完成项

- ✅ DAG 触发器 Schema 扩展（`trigger`, `cronExpression`, `enabled`, `webhookToken`）
- ✅ Cron 定时触发器（BullMQ JobScheduler，启动时注册，动态更新）
- ✅ Webhook 外部触发器（Token 验证，安全可控）
- ✅ 三种触发方式统一（manual/cron/webhook 共用 Worker 链路）
- ✅ L4 反馈接口（`POST /api/route/feedback` + Python 闭环）

### Wave 2 技术债务

- ⚠️ **Cron 时区问题**：当前使用服务器本地时区，需确认是否支持 UTC/自定义时区
- ⚠️ **Webhook Payload**：当前仅触发执行，未实现自定义 payload 映射到节点输入
- ⚠️ **Cron 持久化**：BullMQ Scheduler 任务在 Redis 重启后需重新注册

---

## 已完成：Wave 2.5 — OpenClaw 重启 + 升级 ✅

**状态**：已完成（CLI 为主入口，API 已验证）

**完成项**：
- ✅ `backupConfig()` 实现：升级前自动备份配置到 `~/.openclaw/backups/{timestamp}/`
- ✅ 路由挂载：`POST /api/openclaw/restart`、`POST /api/openclaw/upgrade`、`GET /api/openclaw/status`
- ✅ CLI 命令：`clawgate openclaw status`、`restart`、`upgrade`
- ⚠️ Web UI 延后（CLI 已覆盖核心场景）
- ⚠️ EventBus 延后（Issue 6 Gateway 认证解决后）

**已知问题**：
- Issue 6: Gateway 设备认证（challenge-response）未实现，远程重启无法验证
- Issue 8: Linux apt 升级路径未实机验证

---

## 已完成：v1.0 Phase 2 — 团队部署架构核心 ✅

**状态**：架构验证通过，GatewayPool 已跑通完整流程

**完成项**：
- ✅ Schema：teams / members / instances / dags（含 teamId/environment/tags）
- ✅ API：注册/心跳/团队/成员/DAG（全链路 X-API-Key 认证）
- ✅ GatewayPool：延迟连接 + 负载选择策略（最少连接数 → 队列任务 → CPU）
- ✅ DAG 集成：Worker 自动选择实例执行（按 environment 过滤）
- ✅ Issue 9：实例环境标签（development/staging/production）
- ✅ Issue 10：心跳负载信息（Redis 存储，TTL 20s）

**测试验证结果**（2026-04-17）：
1. 创建团队 → 获得 owner API Key
2. 注册 production 实例 + 心跳 → 负载数据写入 Redis
3. 创建 DAG（自动关联 teamId）
4. 触发 DAG → GatewayPool 选择 production 实例 → 执行

**问题**：DAG 执行失败于 Gateway 认证（Issue 6），但 GatewayPool 选择逻辑正确

---

## 已完成：v0.6 Wave 4 ✅

### D1. DAG 深度验证（Issue 9）✅
- ✅ 15 场景 Mock 集成测试（线性链、并行 Diamond、失败中断、循环检测、变量边界、条件分支、延迟节点、组合场景）
- ✅ `executor-integration.test.ts`：46/46 全部通过

### D5. 执行历史 ✅
- ✅ DAG Run 历史列表页（`/dags/:id/runs`，`DagRunsPage.tsx`）
- ✅ 单次执行详情页（节点时间线 + 输出展示，`DagRunDetailPage.tsx`）
- ✅ 后端 API：`GET /api/dag-runs`（列表 + 分页）、`GET /api/dag-runs/:runId`（详情含节点状态）

### D2. 条件分支节点 ✅
- ✅ `condition-eval.ts`：6 种运算符（eq/neq/contains/not_contains/empty/not_empty）
- ✅ `skip-logic.ts`：基于 condition 结果的下游节点跳过逻辑
- ✅ 前端：`ConditionNode.tsx` 菱形节点组件，`DagNodePanel` 表达式构建器
- ✅ 执行引擎集成：condition 结果写入 `conditionResults` + `context`，驱动 `shouldSkipNode`

### D3. 延迟节点 ✅
- ✅ 执行引擎支持 `delay` 类型节点（`delaySeconds` 睡眠）
- ✅ 前端：`DelayNode.tsx` 时钟图标节点，`DagNodePanel` 秒数输入
- ✅ 0 秒延迟不阻塞，正确传递 context

### D4. 节点输出缓存 ✅
- ✅ `cache-key.ts`：`computeCacheKey(agentId, resolvedPrompt)` → SHA-256 64 字符 hex
- ✅ Redis 函数：`getDagNodeCache` / `setDagNodeCache`（50KB 保护 + try-catch 静默降级）
- ✅ 执行引擎：单节点 + 并行执行路径均支持缓存读写
- ✅ 前端：`cacheTtl` number input（0 = 不缓存，单位秒）
- ✅ 服务端：`cacheTtl >= 0` 校验，序列化仅 `> 0` 时写入（节省 JSON 体积）
- ✅ 单元测试：`cache-key.test.ts` 4/4 通过

## 当前阶段：v1.0 Phase 4 — 生态扩展（进行中）

### 近期目标（执行顺序）

1. ✅ **Node.js SDK 首版** — `@clawgate/sdk`（11 方法 / 17 测试通过 / 11.2 KB bundle，2026-04-18 完成）
2. **Python SDK** — `sdk-python/`，以 Node.js SDK 为契约参考 ⬅ 当前
3. **Watchtower 自动更新** — Docker 容器自动拉取最新镜像并重启
4. **Issue 6 双模式认证深化** — 用户可选的分层安全机制（待 SDK 完成后）

### Issue 6 状态修正（2026-04-18）

**已完成（Bug 修复层）**：
- ✅ 添加 `connect.failed` / `connect.error` 事件处理，输出清晰错误日志
- ✅ challenge 响应失败后立即关闭连接，避免等待 5s 超时
- ✅ 重连时重新尝试加载设备密钥（首次加载失败后可恢复）
- ✅ `docker-compose.prod.yml` 默认启用 `~/.openclaw` volume 映射
- ✅ `single-node.md` 添加功能依赖说明表

**待深化（双模式认证设计）**：
- ⚠️ Token-Only 握手存在竞态：盲等 500ms → 应改为监听 `connect.success`（需确认 Gateway 在 Token-Only 模式下是否发该事件）
- ⚠️ `clawgate.yaml` 缺少 `auth_mode` 字段，用户无法声明式切换模式
- ⚠️ `configReader` 未读取并透传 `auth_mode` 至 `GatewayClient`
- ⚠️ 开发/生产分层安全（Token-Only vs Challenge-Response）未完整落地

### 技术债务处理
- [ ] Cron 时区问题（支持 UTC/自定义时区）
- [ ] Webhook Payload 映射到节点输入
- [ ] DAG 导出/导入（JSON 格式）

---

## 已完成：v1.0 Phase 3 — 健康检查定时任务 ✅

**状态**：全部完成

**完成项**：
- ✅ BullMQ 定时任务（每分钟）：遍历 online 实例，检查 Redis 心跳 TTL
- ✅ 无心跳数据 → 标记 `offline`，写入 `alerts` 表（severity: critical）
- ✅ GatewayPool.disconnect() 清理僵尸 WebSocket 连接
- ✅ 长时间（>30min）offline 实例日志告警
- ✅ server/index.ts 启动注册 + SIGTERM/SIGINT 优雅清理

---

## 已完成：v1.0 Phase 1 — Rust 熔断器 + Streaming + Stats Dashboard ✅

**状态**：已完成（2026-04-18）

### 交付摘要

| Wave | 内容 | 关键文件 |
|------|------|---------|
| Wave 1 | Rust 熔断器 + 规则引擎 | `services/router-rust/src/circuit/mod.rs` |
| Wave 2 | Streaming + Failover + 成本追踪 | `packages/server/src/routes/openai.ts` |
| Wave 3 | Stats Dashboard | `packages/server/src/routes/stats.ts`, `StatsPage.tsx` |
| 发布 | Docker 三镜像 + CI + 开箱即用 | `.github/workflows/docker.yml`, `docker-compose.prod.yml` |

**外部依赖解决**：OpenClaw 可选模式（`CLAWGATE_REQUIRE_OPENCLAW=false`）允许无 OpenClaw 启动，智能路由核心能力始终可用。

---

## 历史：v1.0 Phase 1 原始计划（已归档）

<details>
<summary>点击查看原始 Phase 1 计划（已全部完成或调整）</summary>

#### R1. HTTP/WS 反向代理（架构调整）
- ~~Axum 实现 HTTP 代理~~ → **SSE Streaming 在 Node.js 直出，Rust 仅作路由决策服务**

#### R2. SSE 流处理（Node.js 实现）
- ✅ 三 Provider streaming 完整实现（Anthropic SDK / OpenAI SDK / Ollama fetch）

#### R3. 熔断器（Rust 实现）
- ✅ Circuit Breaker 状态机（`services/router-rust/src/circuit/mod.rs`）
- ✅ Node.js Failover 集成（`dispatchWithFailover`）

#### R4. Stats Dashboard
- ✅ 路由分布、成本趋势、模型用量、熔断器状态四区块可视化
</details>

---

## v1.0 — 完整产品 + 团队部署（状态汇总）

| Phase | 状态 | 备注 |
|-------|------|------|
| Phase 1：核心功能补全 | ✅ 完成 | Rust 熔断器 + Streaming + Stats Dashboard（2026-04-18） |
| Phase 2：团队部署架构 | ✅ 完成 | GatewayPool + 多实例注册 + 心跳负载（2026-04-17） |
| Phase 3：运维管理 | ✅ 完成 | 健康面板 API + 告警系统 + 自动离线检测 |
| Phase 4：生态扩展 | 🔄 进行中 | Node.js SDK ✅ → Python SDK（当前）→ Watchtower → Issue 6 双模式认证深化 |
| Phase 5：文档 | 🔄 持续更新 | 个人/团队部署文档已发布，README 同步更新中 |

### Phase 4：生态扩展（当前阶段）

- [x] **Node.js SDK 首版（`@clawgate/sdk`）** — 11 方法、17/17 测试、11.2 KB bundle（2026-04-18）
- [ ] **Python SDK** — 以 Node.js SDK 为契约参考 ⬅ 当前
- [ ] **ClawGate 自动更新（Docker + Watchtower）**
- [ ] **Issue 6 双模式认证深化** — Token-Only 握手修复 + auth_mode 配置透传 + 分层安全落地
- [ ] `clawgate self-update` CLI 命令（裸机部署场景）
- [ ] 插件扩展机制

### Phase 5：文档（持续维护）

- ✅ 团队部署文档（`docs/deployment/team.md`）
- ✅ 个人部署文档（`docs/deployment/single-node.md`）
- 🔄 README 中英双语同步（版本 v0.6 → v1.0）
- [ ] Contributing Guide（开源贡献指引）
