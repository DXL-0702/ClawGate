#!/usr/bin/env node
/**
 * Step 5 验证脚本：GatewayClient 超时保护 + Session API
 * 运行：cd packages/core && node scripts/test-step5-session-api.mjs
 */
import { GatewayClient, initDb, schema } from '../dist/index.js';
import { eq } from 'drizzle-orm';
import { unlinkSync, existsSync, readFileSync } from 'fs';

const TMP_DB = '/tmp/clawgate-test-step5.db';
for (const f of [TMP_DB, TMP_DB + '-wal', TMP_DB + '-shm']) {
  if (existsSync(f)) unlinkSync(f);
}

let passed = 0, failed = 0;
function ok(label) { console.log(`  ✓ ${label}`); passed++; }
function fail(label, err) { console.log(`  ✗ ${label}: ${err?.message ?? err}`); failed++; }

console.log('\n=== Step 5: GatewayClient 超时保护 + Session API ===\n');

// 1. Gateway 不可用时 listSessions() 返回空数组（不抛出）
try {
  const client = new GatewayClient({
    url: 'ws://127.0.0.1:19789',
    token: 'test',
    reconnectIntervalMs: 99999,
  });
  const sessions = await client.listSessions();
  if (Array.isArray(sessions) && sessions.length === 0) {
    ok('Gateway 不可用时 listSessions() 返回空数组（不抛出）');
  } else {
    fail('listSessions() fallback', new Error(`got ${JSON.stringify(sessions)}`));
  }
  client.disconnect();
} catch (err) {
  fail('listSessions() fallback', err);
}

// 2. call() 超时逻辑：验证 timeout 参数存在于编译产物
try {
  const src = readFileSync(new URL('../dist/gateway/index.js', import.meta.url), 'utf-8');
  if (src.includes('Gateway RPC timeout')) {
    ok('GatewayClient.call() 包含超时保护逻辑（Gateway RPC timeout）');
  } else {
    fail('超时保护逻辑', new Error('dist 中未找到 Gateway RPC timeout'));
  }
} catch (err) {
  fail('超时保护逻辑验证', err);
}

// 3. GatewayClient disconnect() 不抛出
try {
  const client = new GatewayClient({ url: 'ws://127.0.0.1:19789', token: 'test' });
  client.disconnect(); // 未连接时调用不应抛出
  ok('未连接状态下 disconnect() 不抛出');
} catch (err) {
  fail('disconnect() 安全性', err);
}

// 4. SQLite Session 写入 + 用量更新 + 状态终止
try {
  const db = initDb(TMP_DB);
  const now = new Date().toISOString();

  await db.insert(schema.sessions).values({
    key: 'agent1:sess001',
    agentId: 'agent1',
    sessionId: 'sess001',
    status: 'active',
    tokenInput: 0,
    tokenOutput: 0,
    model: null,
    createdAt: now,
    updatedAt: now,
  });
  ok('Session 写入 SQLite 成功');

  await db.update(schema.sessions)
    .set({ tokenInput: 150, tokenOutput: 300, model: 'claude-sonnet-4-6', updatedAt: new Date().toISOString() })
    .where(eq(schema.sessions.key, 'agent1:sess001'));

  const rows = await db.select().from(schema.sessions);
  if (rows[0].tokenInput === 150 && rows[0].model === 'claude-sonnet-4-6') {
    ok('Session 用量更新正确（tokenInput=150, model=claude-sonnet-4-6）');
  } else {
    fail('Session 用量更新', new Error(JSON.stringify(rows[0])));
  }

  await db.update(schema.sessions)
    .set({ status: 'ended', updatedAt: new Date().toISOString() })
    .where(eq(schema.sessions.key, 'agent1:sess001'));

  const ended = await db.select().from(schema.sessions);
  if (ended[0].status === 'ended') ok('Session 状态更新为 ended 正确');
  else fail('Session ended 状态', new Error(`got ${ended[0].status}`));

} catch (err) {
  fail('SQLite Session 操作', err);
} finally {
  for (const f of [TMP_DB, TMP_DB + '-wal', TMP_DB + '-shm']) {
    if (existsSync(f)) unlinkSync(f);
  }
}

console.log(`\n结果：${passed} 通过，${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
