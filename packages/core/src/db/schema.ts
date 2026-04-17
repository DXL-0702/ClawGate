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
  teamId: text('team_id').references(() => teams.id), // 所属团队，nullable 支持个人模式
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
  // 索引：查询团队 DAG
  dagTeamIdIdx: index('idx_dags_team_id').on(table.teamId),
}));

export const dagRuns = sqliteTable('dag_runs', {
  id: text('id').primaryKey(),              // uuid
  dagId: text('dag_id').notNull().references(() => dags.id),
  teamId: text('team_id'),                  // 关联团队，用于查询隔离（nullable 支持个人模式）
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

// v1.0 Phase 3: 告警记录表
export const alerts = sqliteTable('alerts', {
  id: text('id').primaryKey(),              // uuid
  teamId: text('team_id').notNull().references(() => teams.id),
  instanceId: text('instance_id').references(() => instances.id),
  type: text('type', { enum: ['offline', 'error', 'high_load', 'gateway_unhealthy'] }).notNull(),
  severity: text('severity', { enum: ['critical', 'warning', 'info'] }).notNull(),
  message: text('message').notNull(),
  details: text('details'),                   // JSON 额外信息
  acknowledged: integer('acknowledged', { mode: 'boolean' }).notNull().default(false),
  acknowledgedBy: text('acknowledged_by'),    // member id
  acknowledgedAt: text('acknowledged_at'),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  // 索引：查询团队告警
  teamIdIdx: index('idx_alerts_team_id').on(table.teamId),
  // 索引：查询未确认告警
  acknowledgedIdx: index('idx_alerts_acknowledged').on(table.acknowledged),
  // 索引：按时间查询
  createdAtIdx: index('idx_alerts_created_at').on(table.createdAt),
}));

// v1.0 团队部署架构表

export const teams = sqliteTable('teams', {
  id: text('id').primaryKey(),               // uuid
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),     // URL-friendly 标识
  ownerId: text('owner_id').notNull(),       // 创建者 member id
  createdAt: text('created_at').notNull(),
});

export const members = sqliteTable('members', {
  id: text('id').primaryKey(),               // uuid
  teamId: text('team_id').notNull().references(() => teams.id),
  email: text('email').notNull(),
  name: text('name'),                        // 显示名称
  role: text('role', { enum: ['admin', 'member'] }).notNull().default('member'),
  apiKey: text('api_key').notNull().unique(), // 用于 CLI/API 认证
  createdAt: text('created_at').notNull(),
}, (table) => ({
  // 索引：通过 API Key 快速查找成员
  apiKeyIdx: index('idx_members_api_key').on(table.apiKey),
  // 索引：查询团队成员
  teamIdIdx: index('idx_members_team_id').on(table.teamId),
}));

export const instances = sqliteTable('instances', {
  id: text('id').primaryKey(),               // uuid，由实例注册时生成或分配
  teamId: text('team_id').notNull().references(() => teams.id),
  memberId: text('member_id').notNull().references(() => members.id), // 归属成员
  name: text('name').notNull(),              // 实例别名（如"MacBook-Pro-1"）

  // 环境分组（Issue 9）
  environment: text('environment', {
    enum: ['development', 'staging', 'production']
  }).notNull().default('development'),
  tags: text('tags'),                        // JSON ["project-a", "ml-team"]

  // 连接配置
  gatewayUrl: text('gateway_url').notNull(),     // ws://host:port
  gatewayToken: text('gateway_token').notNull(), // 连接 token

  // 状态
  status: text('status', {
    enum: ['online', 'offline', 'error']
  }).notNull().default('offline'),
  lastHeartbeatAt: text('last_heartbeat_at'),

  // 资源信息（心跳上报）
  version: text('version'),                  // OpenClaw 版本
  platform: text('platform'),                // darwin/linux/win32
  pid: integer('pid'),                       // 进程 ID

  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  // 索引：查询团队实例
  teamIdIdx: index('idx_instances_team_id').on(table.teamId),
  // 索引：查询成员实例
  memberIdIdx: index('idx_instances_member_id').on(table.memberId),
  // 索引：查询在线实例
  statusIdx: index('idx_instances_status').on(table.status),
  // 索引：按环境查询（Issue 9）
  environmentIdx: index('idx_instances_environment').on(table.environment),
}));
