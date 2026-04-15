# 下一步开发计划 (NEXT)

> 本文件记录当前阶段的**具体开发思路**，完整路线图请参阅 [README.md](../../README.md)。
> 最后更新：v0.5 Wave 1 完成，进入 Wave 2

---

## 当前阶段：v0.5 Wave 1 ✅ 已完成

### Wave 1 完成项

- ✅ Linear 风格主题系统
- ✅ `dag_node_states` 表
- ✅ Gateway 执行封装 (`executeAgentNode`)
- ✅ DAG Worker 框架 (BullMQ)
- ✅ `/run` 异步化 + 状态查询 API
- ✅ DAG 编辑器加载绑定

### Wave 1 遗留项

- ⚠️ Gateway 端到端验证 — 依赖 OpenClaw Gateway 连接调试

---

## Wave 2 — 触发器机制（当前阶段）

### 目标

实现 Cron 定时触发和 Webhook 外部触发，完成 DAG 自动化调度能力。

### 任务清单

#### B7. Cron 触发器
- `dags` 表新增 `trigger: 'manual'|'cron'`, `cronExpression` 字段
- BullMQ `upsertJobScheduler` 管理定时任务
- 调度器启动时注册所有启用的 Cron DAG

#### B8. Webhook 触发器
- 新增端点 `POST /api/dags/:id/webhook`
- 支持自定义 payload 映射到节点输入
- Webhook URL 格式：`/api/dags/:id/webhook?token=...`

#### B9. L4 反馈接口（Issue 4）
- `POST /api/route/feedback` 端点
- 用户反馈信号写入向量库

### 技术思路

```
Cron 触发:
  BullMQ Scheduler → dag-execution 队列 → Worker 执行

Webhook 触发:
  HTTP POST → 验证 token → 构造 Job → 入队执行
```

---

## Wave 3 — 多节点依赖与并行（后续规划）

- 拓扑排序 + 循环依赖检测
- 依赖解析 + 并行批次执行（最大 5 并发）
- 上游输出 → 下游 Prompt 变量替换 (`{{node-1.output}}`)
- 可视化 DAG 编辑器支持 edges 连线

---

## Wave 4 — OpenClaw 运维管理（v1.0 前瞻）

- 多实例进程生命周期管理
- 健康心跳检测
- 跨实例日志聚合
- 资源用量面板
