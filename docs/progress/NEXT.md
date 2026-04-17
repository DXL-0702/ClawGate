# 下一步开发计划 (NEXT)

> 本文件记录当前阶段的**具体开发思路**，完整路线图请参阅 [README.md](../../README.md)。
> 最后更新：v0.5 Wave 3 完成，多节点 DAG 执行已验证

---

## 已完成：v0.5 Wave 3 ✅

- 拓扑排序引擎（Kahn's BFS，分层批次）
- 变量替换引擎（`{{node-X.output}}`）
- 多节点执行引擎（线性链 + 并行批次）
- 前端 i18n（ZH/EN 切换）+ 节点状态可视化（橙/绿/红/黄）
- edges 保存 + 节点状态轮询

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

## 当前阶段：v1.0 Phase 3 — 健康检查定时任务（进行中）

### 目标

实现实例健康检查定时任务，自动清理长时间未心跳的实例，保障 GatewayPool 选择准确性。

### 任务清单

#### Step 1. BullMQ 定时任务（每分钟）
- 遍历所有 `status = 'online'` 的 instances
- 检查 Redis `instance:load:{id}` 是否存在
- 无负载数据（超时 20s）→ 标记为 `offline`

#### Step 2. 连接清理
- 对已标记 `offline` 且 `lastHeartbeatAt > 5 分钟前` 的实例
- 调用 `GatewayPool.disconnect(instanceId)` 释放 WebSocket

#### Step 3. 告警通知（可选）
- 实例离线超过 10 分钟 → 发送通知（预留接口）

### 依赖
- BullMQ 定时任务已在 `packages/core/src/queue/index.ts` 有基础框架

- `packages/core/src/openclaw/lifecycle.ts` — 核心逻辑骨架已完成（restart/upgrade/getStatus/checkUpdate）
- `packages/server/src/routes/openclaw-lifecycle.ts` — REST 端点已写（含 auth + 确认头保护）
- Remote SSH 模式为 stub，推迟至 v1.0 Phase 3

---

## 下一阶段：v1.0 Phase 1 — Rust 流量层完整实现

### 目标

完成四层智能路由的 Rust 实现，包括 HTTP/WS 代理、SSE 流转发、熔断器。

### 任务清单

#### R1. HTTP/WS 反向代理
- Axum 实现 HTTP 代理，透明转发到各 Provider
- WebSocket 代理，支持 Gateway 长连接
- 请求/响应转换中间件

#### R2. SSE 流处理
- 大模型流式响应透明转发
- 背压控制，防止客户端消费慢导致内存溢出

#### R3. 熔断器
- Circuit Breaker 状态机（Closed/Open/Half-Open）
- 基于错误率和延迟的自动熔断
- 熔断时自动 fallback 到备用 Provider

#### R4. L1 缓存增强
- 请求归一化 + SHA-256 Hash
- Redis 缓存 + TTL 管理
- 缓存命中统计

---

## v1.0 — 完整产品 + 团队部署（剩余阶段）

### Phase 1：核心功能补全
- Rust 流量层完整实现（HTTP/WS 代理 + SSE 流转发 + 熔断器）
- Provider Router 完整集成（intent-based 策略 + 成本预算告警）
- DAG 条件分支 + 并行节点类型
- 数据统计 Dashboard（路由准确率、成本节省率、模型用量）

### Phase 2：团队部署架构（中央服务器 + 多成员接入）
- 多实例注册 API（HTTP 注册 + 心跳保活）
- 多实例连接池（多条 OpenClaw Gateway WebSocket）
- 成员认证鉴权（JWT/API Key，admin/member 分级）
- 团队 Docker Compose 一键部署

### Phase 3：运维管理
- 多实例健康面板（绿/黄/红状态、资源用量趋势）
- 跨实例日志聚合与搜索
- 异常告警（实例崩溃通知）
- Remote SSH 模式（远程重启/升级团队成员 OpenClaw）

### Phase 4：生态扩展
- ClawGate 自动更新（Docker + Watchtower）
- `clawgate self-update` CLI 命令
- SDK（Node.js + Python）
- 插件扩展机制

### Phase 5：文档（统一编写）
- 团队部署文档（Docker Compose 一键部署 + 网络配置 + 成员接入）
- 个人部署文档（单机快速上手）
- 开源文档（README + Contributing Guide）
