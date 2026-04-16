import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';

export const agents = sqliteTable('agents', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  configPath: text('config_path').notNull(),
  status: text('status', { enum: ['running', 'stopped', 'unknown'] }).notNull().default('unknown'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const sessions = sqliteTable('sessions', {
  key: text('key').primaryKey(),       // agentId:sessionId
  agentId: text('agent_id').notNull(),
  sessionId: text('session_id').notNull(),
  status: text('status', { enum: ['active', 'ended', 'failed'] }).notNull().default('active'),
  tokenInput: integer('token_input').notNull().default(0),
  tokenOutput: integer('token_output').notNull().default(0),
  model: text('model'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const costs = sqliteTable('costs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  date: text('date').notNull(),          // YYYY-MM-DD
  model: text('model').notNull(),
  provider: text('provider').notNull(),
  tokenInput: integer('token_input').notNull().default(0),
  tokenOutput: integer('token_output').notNull().default(0),
  estimatedUsd: real('estimated_usd').notNull().default(0),
  createdAt: text('created_at').notNull(),
});

export const routingLogs = sqliteTable('routing_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sessionKey: text('session_key'),
  prompt: text('prompt').notNull(),
  layer: text('layer', { enum: ['L1', 'L2', 'L3'] }).notNull(),
  model: text('model').notNull(),
  cacheHit: integer('cache_hit', { mode: 'boolean' }).notNull().default(false),
  latencyMs: real('latency_ms').notNull().default(0),
  createdAt: text('created_at').notNull(),
});

// v0.5 DAG 工作流表
export const dags = sqliteTable('dags', {
  id: text('id').primaryKey(),              // uuid
  name: text('name').notNull(),
  definition: text('definition').notNull(), // JSON: { nodes: [], edges: [] }
  // v0.5 Wave 2: 触发器配置
  trigger: text('trigger', { enum: ['manual', 'cron', 'webhook'] })
    .notNull()
    .default('manual'),
  cronExpression: text('cron_expression'),  // Cron 表达式 (如 "*/5 * * * *")
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  webhookToken: text('webhook_token'),       // Webhook 验证 token
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  // 索引：快速查询启用的 Cron DAG
  triggerEnabledIdx: index('idx_dags_trigger_enabled').on(table.trigger, table.enabled),
}));

export const dagRuns = sqliteTable('dag_runs', {
  id: text('id').primaryKey(),              // uuid
  dagId: text('dag_id').notNull().references(() => dags.id),
  status: text('status', { enum: ['pending', 'running', 'completed', 'failed'] })
    .notNull()
    .default('pending'),
  triggeredBy: text('triggered_by', { enum: ['manual', 'cron', 'webhook'] })
    .notNull()
    .default('manual'),
  output: text('output'),                   // 执行结果 JSON
  error: text('error'),                     // 错误信息
  startedAt: text('started_at'),
  endedAt: text('ended_at'),
  createdAt: text('created_at').notNull(),
});

// v0.5 DAG 节点执行状态表
export const dagNodeStates = sqliteTable('dag_node_states', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: text('run_id').notNull(),           // 关联 dag_runs.id
  nodeId: text('node_id').notNull(),         // DAG 定义中的节点 ID
  status: text('status', {
    enum: ['pending', 'running', 'completed', 'failed', 'skipped']
  }).notNull().default('pending'),
  output: text('output'),                    // 节点执行输出（JSON 或纯文本）
  error: text('error'),                      // 错误信息
  startedAt: text('started_at'),             // 开始执行时间 ISO8601
  endedAt: text('ended_at'),                 // 结束执行时间 ISO8601
  createdAt: text('created_at').notNull(),   // 记录创建时间
}, (table) => ({
  // 复合索引：加速查询指定 run 的所有节点状态
  runIdIdx: index('idx_node_states_run_id').on(table.runId),
  // 复合索引：加速查询指定 run + 特定节点的状态
  runNodeIdx: index('idx_node_states_run_node').on(table.runId, table.nodeId),
}));
