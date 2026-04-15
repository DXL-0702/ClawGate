# 下一步开发计划 (NEXT)

> 本文件记录当前阶段的**具体开发思路**，完整路线图请参阅 [README.md](../../README.md)。
> 最后更新：v0.3 阶段

---

## 当前阶段：v0.3 收尾

### 待完成项

#### 1. L2/L3 服务层验证（进行中）
- **状态**：Ollama 模型（qwen2.5:3b）正在下载
- **待验证**：模型就绪后，发送复杂 prompt 验证 L3 分类返回 `layer: L3`
- **待验证**：第二次相同 prompt 命中 L2 向量缓存，返回 `layer: L2`
- **待验证**：L4 负反馈 3 次触发降级，写入 Qdrant 向量库

#### 2. OpenAI 兼容端点 `/v1/chat/completions`（✅ 已完成）
- 实现详情见 DONE.md
- 待补充：`qwen2.5:7b` 模型拉取后完整 Ollama 路径验证（`ollama pull qwen2.5:7b`）

#### 3. 路由规则管理 UI（低优先级，可延后至 v0.5）
- 当前可通过 `clawgate.yaml` 热重载替代
- 待实现：L2 阈值滑块、L3 模型选择、utterances 配置

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