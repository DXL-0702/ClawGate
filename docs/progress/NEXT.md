# 下一步开发计划 (NEXT)

> 本文件记录当前阶段的**具体开发思路**，完整路线图请参阅 [README.md](../../README.md)。
> 最后更新：v0.5 规划阶段

---

## 当前阶段：v0.3 ✅ 已完成

### 完成项

- **L1 Hash 缓存** ✅：端到端验证通过，缓存命中率 100%，延迟降低 99.96%
- **OpenAI 兼容端点** ✅：`/v1/chat/completions` 200 OK，Provider 分发正常
- **Issue 1 修复** ✅：`connectRedis()` 启动链路修复，路由日志正常写入
- **服务启动链路** ✅：Rust + Python + Node.js 三服务全链路验证通过

### 遗留项（推迟至 v0.5）

- **L2/L3 深度验证**：代码就绪，但被 L1 快速路径拦截，需设计绕过测试用例
- **L4 反馈接口**：Node.js 端点未实现，需补充 `POST /api/route/feedback`
- **Qdrant healthcheck**：Issue 5 推迟，不影响功能

---

## 下一阶段：v0.5 — DAG 工作流

### 核心目标
将 ClawGate 从「路由中转站」升级为「任务编排平台」，支持多步骤 AI 工作流自动化。

### 技术思路

#### DAG 数据结构
```typescript
interface DAGNode {
  id: string;
  type: 'agent' | 'condition' | 'transform' | 'webhook';
  agentId?: string;
  prompt?: string;
  dependencies: string[];  // 前置节点 ID
}

interface DAGDefinition {
  id: string;
  name: string;
  nodes: DAGNode[];
  trigger: 'manual' | 'cron' | 'webhook';
  cronExpression?: string;
}
```

#### SQLite 持久化
- 新增 `dags` 表（DAG 定义）
- 新增 `dag_runs` 表（执行历史）
- 新增 `dag_node_states` 表（节点实时状态）

#### BullMQ 执行引擎
- `dag-executor` Worker：解析 DAG，按依赖顺序调度节点
- 并行节点：依赖满足的节点同时执行
- 失败处理：节点失败时标记下游节点为 skipped

#### 可视化 DAG 编辑器
- 技术选型：React Flow（节点拖拽、连线、缩放）
- 节点类型：Agent 节点、条件分支节点、数据转换节点
- 实时状态：执行中节点高亮，已完成/失败节点颜色标记

#### 触发器
- 手动触发：Web UI 一键执行
- 定时触发：cron 表达式（BullMQ Scheduler）
- Webhook