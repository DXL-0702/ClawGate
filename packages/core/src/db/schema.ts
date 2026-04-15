import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

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
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const dagRuns = sqliteTable('dag_runs', {
  id: text('id').primaryKey(),              // uuid
  dagId: text('dag_id').notNull().references(() => dags.id),
  status: text('status', { enum: ['pending', 'running', 'completed', 'failed'] })
    .notNull()
    .default('pending'),
  output: text('output'),                   // 执行结果 JSON
  error: text('error'),                     // 错误信息
  startedAt: text('started_at'),
  endedAt: text('ended_at'),
  createdAt: text('created_at').notNull(),
});
