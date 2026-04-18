# 下一步开发计划 (NEXT)

> 本文件记录当前阶段的**具体开发思路**，完整路线图请参阅 [README.md](../../README.md)。
> 最后更新：Phase R 全部完成（2026-04-18），进入 Phase D

---

## 🎯 当前阶段：v1.0 Delivery Readiness（交付准备）

**目标**：把所有"代码就绪"功能提升为"用户可见可用"，完成最终 v1.0 GA 交付。

**重要决策记录（2026-04-18）**：
- **撤销 Phase 4 Node.js SDK 实验性原型**：实验代码（`packages/sdk/`）已完全撤回，待 GA 后重新设计
- **不开发 Python SDK**：移入 v1.x Phase 4 GA 后阶段
- **路线图重组**：所有 GA 后才做的项目统一归入 v1.x Phase 4 生态扩展

---

### Phase R — 缺口修复（最高优先）

| 步骤 | 内容 | 状态 |
|------|------|------|
| R1 | **Web UI 入 Docker 镜像** — Dockerfile builder 阶段 build web，runtime COPY `packages/web/dist/` 至 `/app/public`；server 注册 `@fastify/static` serve `/` + SPA fallback（仅 GET + 非扩展名/`.html` 回退 index.html，真资源保持 404） | ✅ 2026-04-18 |
| R2 | **Issue 6 双模式认证深化** — 修复 Gateway 握手协议（RPC 帧格式 `type:"req"`、`client.id`、operatorToken 分离、等 `ok:true` 响应替代盲等）；yaml `auth_mode` 字段 + configReader 透传；验证：Gateway 握手成功，`/api/agents` 返回 main agent | ✅ 2026-04-18 |
| R3 | **团队部署 Docker Compose 模板** — 新增 `docker-compose.team.yml`：三服务全栈 + `ADMIN_API_KEY` 环境变量 + 容器名 `-team-` 前缀（可与单节点共存）+ `CLAWGATE_PORT` 自定义端口；更新 `team.md` 部署章节 | ✅ 2026-04-18 |

### Phase D — 技术债清理

| 步骤 | 内容 | 状态 |
|------|------|------|
| D1 | **Cron 时区支持** — `dags` schema 加 `cronTimezone` 字段（默认 UTC），BullMQ JobScheduler 透传 tz 选项 | 🔜 |
| D2 | **Cron 持久化补强** — Server 启动扫描 `enabled=true && trigger=cron` 全部重新注册（已部分实现，需补 Redis 重启场景验证） | 🔜 |
| D3 | **Webhook Payload 映射** — `POST /api/dags/:id/webhook` 接收 JSON body，写入 `context.webhookPayload`，节点可用 `{{webhookPayload.foo}}` 引用 | 🔜 |

### Phase F — 功能完善

| 步骤 | 内容 | 状态 |
|------|------|------|
| F1 | **DAG 导出 / 导入** — `GET /api/dags/:id/export` 返回标准 JSON；`POST /api/dags/import` 校验 + 写入；CLI 增 `clawgate dag export/import` | 🔜 |
| F2 | **Web UI OpenClaw 运维入口** — 新增「实例运维」面板，按钮调用已有 `/api/openclaw/restart \| upgrade`，仅缺 UI | 🔜 |
| F3 | **EventBus 集成** — Gateway 实时事件桥接到 EventBus，前端 SSE 订阅；依赖 R2 完成 | 🔜 |

### Phase Doc — 文档

| 步骤 | 内容 | 状态 |
|------|------|------|
| Doc1 | **快速上手文档** — 整合 `single-node.md` + `team.md` 为统一 `docs/quickstart.md`：5 分钟跑起来 + 常见故障排查 | 🔜 |
| Doc2 | **Contributing Guide** — `CONTRIBUTING.md`：分支策略、Conventional Commits、模块测试方式、PR Checklist | 🔜 |
| Doc3 | **五份文档同步** — 每个步骤完成后同步 CLAUDE / README × 2 / DONE / NEXT | 🔄 持续 |

### Phase QA — 端到端深度测试

| 步骤 | 内容 | 状态 |
|------|------|------|
| QA1 | **干净环境冷启验证** — 全清 Docker 卷 + macOS / Linux 各跑一次 `docker compose -f docker-compose.prod.yml up -d`，逐项打勾 | 🔜 |
| QA2 | **10 场景验收** — 浏览 Dashboard、调 OpenAI 端点、L1→L2→L3 路由、DAG 创建+触发、Cron 自动触发、Webhook 触发、团队实例注册+心跳、告警自动产生、Web UI OpenClaw 重启、Stats Dashboard 实时更新 | 🔜 |
| QA3 | **回归测试** — 全部 vitest / cargo test / pytest 全绿；新增端到端纳入 CI matrix | 🔜 |
| QA4 | **交付报告** — 列每个功能验证结果 + 已知限制 + 用户使用建议 | 🔜 |

---

## v1.x Phase 4：生态扩展（GA 交付后）

GA 之后再做的项目，全部归入此阶段：

- [ ] Node.js SDK（`@clawgate/sdk`）— 重新设计与实现
- [ ] Python SDK（`sdk-python/`）
- [ ] ClawGate 自动更新（Docker + Watchtower）
- [ ] 跨实例日志聚合与搜索
- [ ] Remote SSH 模式（远程重启 / 升级 OpenClaw）
- [ ] Linux apt 升级路径实机验证（Issue 8）
- [ ] `clawgate self-update` CLI 命令（裸机部署场景）
- [ ] 插件扩展机制

---

## 已完成阶段汇总

### v0.5 Wave 3 ✅ — 多节点 DAG 执行

- 拓扑排序引擎（Kahn's BFS，分层批次）
- 变量替换引擎（`{{node-X.output}}`）
- 多节点执行引擎（线性链 + 并行批次）
- 前端 i18n（ZH/EN 切换）+ 节点状态可视化
- edges 保存 + 节点状态轮询
- 双模式支持（个人/团队）

### v0.5 Wave 3.5 ✅ — 视觉专业化

- 节点卡片精致化（多层阴影 + 发光状态点 + 微标签）
- 工具栏紧凑图标化
- 右侧工作台精致化（可折叠卡片 + 变量引用地图）
- 连线流动动效
- 橙灰工业风配色统一

### v0.5 Wave 2 ✅ — DAG 触发器机制

- DAG 触发器 Schema 扩展（`trigger`, `cronExpression`, `enabled`, `webhookToken`）
- Cron 定时触发器（BullMQ JobScheduler，启动时注册，动态更新）
- Webhook 外部触发器（Token 验证，安全可控）
- 三种触发方式统一（manual/cron/webhook 共用 Worker 链路）
- L4 反馈接口（`POST /api/route/feedback` + Python 闭环）

### Wave 2.5 ✅ — OpenClaw 重启 + 升级（CLI 入口）

- `backupConfig()` 实现：升级前自动备份配置到 `~/.openclaw/backups/{timestamp}/`
- 路由挂载：`POST /api/openclaw/restart`、`POST /api/openclaw/upgrade`、`GET /api/openclaw/status`
- CLI 命令：`clawgate openclaw status / restart / upgrade`
- ⚠️ Web UI 操作入口移入 Phase F2

### v1.0 Phase 2 ✅ — 团队部署架构核心

- Schema：teams / members / instances / dags（含 teamId/environment/tags）
- API：注册/心跳/团队/成员/DAG（全链路 X-API-Key 认证）
- GatewayPool：延迟连接 + 负载选择策略
- DAG 集成：Worker 自动选择实例执行
- ⚠️ 团队 Docker Compose 模板移入 Phase R3

### v0.6 Wave 4 ✅ — DAG 进阶功能

- D1 深度验证：15 场景 / 46 测试全部通过
- D2 条件分支节点（6 种运算符 + true/false handle）
- D3 延迟节点（0–3600s）
- D4 节点输出缓存（Redis opt-in，50KB 保护，静默降级）
- D5 执行历史（列表 + 节点时间线详情）

### v1.0 Phase 1 ✅ — Rust 熔断器 + Streaming + Stats Dashboard

| Wave | 内容 |
|------|------|
| Wave 1 | Rust 熔断器 + 规则引擎 |
| Wave 2 | Streaming + Failover + 成本追踪 |
| Wave 3 | Stats Dashboard |
| 发布 | Docker 三镜像 + CI |

### v1.0 Phase 3 ✅ — 健康检查定时任务

- BullMQ 每分钟检查实例心跳，自动标记 offline + 写入告警
- GatewayPool.disconnect() 清理僵尸 WebSocket
- ⚠️ 跨实例日志聚合 / Remote SSH 移入 v1.x Phase 4

---

## 已知问题与延后说明

- **Issue 6**：Bug 修复层完成，双模式认证深化移入 Phase R2
- **Wave 2 技术债**：Cron 时区 / Webhook payload / Cron 持久化全部移入 Phase D
- **NEXT 技术债**：DAG 导出/导入移入 Phase F1

