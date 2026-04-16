# 下一步开发计划 (NEXT)

> 本文件记录当前阶段的**具体开发思路**，完整路线图请参阅 [README.md](../../README.md)。
> 最后更新：v0.5 Wave 2 完成，进入 Wave 2.5

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

## 当前阶段：Wave 2.5 — OpenClaw 重启 + 升级（进行中）

### 目标

通过 Web UI 和 API 实现 OpenClaw Gateway 的自动化重启与版本升级（本地模式优先）。

### 任务清单

#### Step 1. 完善 `lifecycle.ts` 已知问题
- 实现 `backupConfig()`：升级前复制 `~/.openclaw/openclaw.json` + `~/.openclaw/agents/` 到 `~/.openclaw/backups/{timestamp}/`
- 删除 `openclaw-lifecycle.ts` 底部重复的 FastifyRequest/FastifyReply 类型声明
- 新增 Linux `apt-get upgrade openclaw` 基础支持

#### Step 2. 路由挂载 + API 集成验证
- `server/index.ts` 注册 `openclawLifecycleRoutes`（前缀 `/api`）
- 验证四个端点：`GET /status`、`GET /update`、`POST /restart`、`POST /upgrade`

#### Step 3. CLI 命令实现
- `clawgate openclaw status` — 显示 Gateway 连接状态、版本、PID
- `clawgate openclaw restart` — 重启 Gateway（交互式确认）
- `clawgate openclaw upgrade` — 检查更新 + 执行升级 + 自动重启
- 复用 `@clawgate/core` 的 `OpenClawLifecycle` 模块，与 `clawgate agents list` 风格一致

#### Step 4. Web UI 操作入口
- 状态卡片：版本、PID、连接状态、运行时间
- "检查更新"按钮 → 显示当前版本 vs 最新版本
- "重启"按钮（确认弹窗 + X-Confirm-Action 头）
- "升级"按钮（确认弹窗 + 进度状态反馈）

#### Step 5. EventBus 集成
- 重启/升级操作通过 WebSocket EventBus 推送状态事件
- 事件类型：`openclaw.restarting` / `openclaw.restarted` / `openclaw.upgrading` / `openclaw.upgraded`
- 前端实时显示操作进度

### 已有代码基础

- `packages/core/src/openclaw/lifecycle.ts` — 核心逻辑骨架已完成（restart/upgrade/getStatus/checkUpdate）
- `packages/server/src/routes/openclaw-lifecycle.ts` — REST 端点已写（含 auth + 确认头保护）
- Remote SSH 模式为 stub，推迟至 v1.0 Phase 3

---

## 下一阶段：Wave 3 — 多节点依赖与并行

### 目标

实现多节点 DAG 执行（线性链和并行分支），支持节点间数据传递。

### 任务清单

#### C1. 拓扑排序 + 循环依赖检测
- 解析 DAG edges 构建执行图
- 检测循环依赖（报错或自动断开）
- 生成拓扑排序执行序列

#### C2. 线性链执行
- A → B → C 顺序执行
- 上游输出 → 下游 Prompt 变量替换 (`{{node-1.output}}`)
- 任一节点失败停止后续执行

#### C3. 并行批次执行
- 依赖解析：识别可并行节点批次
- 最大并发数限制（默认 5）
- 信号量控制并发
- 所有并行节点完成后再执行下游

#### C4. 可视化 DAG 编辑器增强
- React Flow edges 连线编辑
- 节点连接关系保存到 definition
- 执行状态可视化（节点颜色标识 pending/running/completed/failed）

---

## v1.0 — 完整产品 + 团队部署

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
