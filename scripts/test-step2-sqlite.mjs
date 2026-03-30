#!/usr/bin/env node
/**
 * Step 2 验证脚本：SQLite 初始化（Drizzle ORM）
 * 运行：node scripts/test-step2-sqlite.mjs
 */
import { initDb, getDb, schema } from '../packages/core/dist/index.js';
import { eq } from 'drizzle-orm';
import { unlinkSync, existsSync } from 'fs';

const TMP_DB = '/tmp/clawgate-test-step2.db';
if (existsSync(TMP_DB)) unlinkSync(TMP_DB);
if (existsSync(TMP_DB + '-wal')) unlinkSync(TMP_DB + '-wal');
if (existsSync(TMP_DB + '-shm')) unlinkSync(TMP_DB + '-shm');

let passed = 0;
let failed = 0;

function ok(label) { console.log(`  ✓ ${label}`); passed++; }
function fail(label, err) { console.log(`  ✗ ${label}: ${err?.message ?? err}`); failed++; }

console.log('\n=== Step 2: SQLite 初始化（Drizzle ORM） ===\n');

try {
  // 1. 初始化数据库
  const db = initDb(TMP_DB);
  ok('initDb() 成功，数据库文件已创建');

  // 2. getDb() 返回同一实例
  const db2 = getDb();
  if (db === db2) ok('getDb() 返回已初始化的实例');
  else fail('getDb() 单例', new Error('返回了不同实例'));

  // 3. 插入 agent
  const now = new Date().toISOString();
  await db.insert(schema.agents).values({
    id: 'test-agent-1',
    name: 'Test Agent',
    configPath: '/tmp/agent.json',
    status: 'running',
    createdAt: now,
    updatedAt: now,
  });
  const agentRows = await db.select().from(schema.agents);
  if (agentRows.length === 1 && agentRows[0].id === 'test-agent-1') ok('agents 表插入与查询正确');
  else fail('agents 表', new Error(`got ${agentRows.length} rows`));

  // 4. 插入 session
  await db.insert(schema.sessions).values({
    key: 'test-agent-1:sess-001',
    agentId: 'test-agent-1',
    sessionId: 'sess-001',
    status: 'active',
    tokenInput: 100,
    tokenOutput: 200,
    model: 'claude-sonnet-4-6',
    createdAt: now,
    updatedAt: now,
  });
  const sessRows = await db.select().from(schema.sessions);
  if (sessRows.length === 1 && sessRows[0].tokenOutput === 200) ok('sessions 表插入与查询正确');
  else fail('sessions 表', new Error(`got ${JSON.stringify(sessRows)}`))

  // 5. 插入 cost
  await db.insert(schema.costs).values({
    date: '2026-03-30',
    model: 'claude-sonnet-4-6',
    provider: 'anthropic',
    tokenInput: 1000,
    tokenOutput: 500,
    estimatedUsd: 0.015,
    createdAt: now,
  });
  const costRows = await db.select().from(schema.costs);
  if (costRows.length === 1 && costRows[0].estimatedUsd === 0.015) ok('costs 表插入与查询正确');
  else fail('costs 表', new Error(`got ${JSON.stringify(costRows)}`));

  // 6. 插入 routing_log
  await db.insert(schema.routingLogs).values({
    sessionKey: 'test-agent-1:sess-001',
    prompt: 'help me write a sort algorithm',
    layer: 'L2',
    model: 'qwen2.5:7b',
    cacheHit: false,
    latencyMs: 18.5,
    createdAt: now,
  });
  const logRows = await db.select().from(schema.routingLogs);
  if (logRows.length === 1 && logRows[0].latencyMs === 18.5) ok('routing_logs 表插入与查询正确');
  else fail('routing_logs 表', new Error(`got ${JSON.stringify(logRows)}`));

  // 7. 按条件查询
  const filtered = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.agentId, 'test-agent-1'));
  if (filtered.length === 1) ok('sessions 按 agentId 条件查询正确');
  else fail('sessions 条件查询', new Error(`got ${filtered.length} rows`));

  // 8. 重复 initDb 不崩溃（幂等）
  initDb(TMP_DB);
  ok('重复调用 initDb() 不崩溃（迁移幂等）');

} catch (err) {
  fail('未预期错误', err);
} finally {
  // 清理
  if (existsSync(TMP_DB)) unlinkSync(TMP_DB);
  if (existsSync(TMP_DB + '-wal')) unlinkSync(TMP_DB + '-wal');
  if (existsSync(TMP_DB + '-shm')) unlinkSync(TMP_DB + '-shm');
}

console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);
