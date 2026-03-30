#!/usr/bin/env node
/**
 * Step 3 验证脚本：Redis 初始化（ioredis）
 * 运行：cd packages/core && node scripts/test-step3-redis.mjs
 * 若本地无 Redis，连接相关测试自动跳过，模块初始化测试仍执行。
 */
import {
  initRedis, connectRedis, disconnectRedis,
  setSessionState, getSessionState,
  incrCostRealtime, pushRoutingLog,
  REDIS_KEYS, REDIS_TTL,
} from '../dist/index.js';

let passed = 0;
let failed = 0;
let skipped = 0;

function ok(label) { console.log(`  ✓ ${label}`); passed++; }
function fail(label, err) { console.log(`  ✗ ${label}: ${err?.message ?? err}`); failed++; }
function skip(label) { console.log(`  - ${label} (跳过：Redis 不可用)`); skipped++; }

console.log('\n=== Step 3: Redis 初始化（ioredis） ===\n');

// 1. 模块常量验证（无需连接）
try {
  if (REDIS_KEYS.sessionState('k1') === 'session_state:k1') ok('REDIS_KEYS.sessionState() 格式正确');
  else fail('REDIS_KEYS.sessionState', new Error(`got ${REDIS_KEYS.sessionState('k1')}`) );

  if (REDIS_KEYS.costsRealtime('2026-03-30') === 'costs_realtime:2026-03-30') ok('REDIS_KEYS.costsRealtime() 格式正确');
  else fail('REDIS_KEYS.costsRealtime', new Error(`got ${REDIS_KEYS.costsRealtime('2026-03-30')}`));

  if (REDIS_TTL.sessionState === 86400) ok('REDIS_TTL.sessionState = 86400s');
  else fail('REDIS_TTL.sessionState', new Error(`got ${REDIS_TTL.sessionState}`));

  if (REDIS_TTL.instanceHealth === 10) ok('REDIS_TTL.instanceHealth = 10s');
  else fail('REDIS_TTL.instanceHealth', new Error(`got ${REDIS_TTL.instanceHealth}`));
} catch (err) {
  fail('常量验证', err);
}

// 2. initRedis() 返回 Redis 实例（不实际连接）
try {
  const redis = initRedis('redis://127.0.0.1:6379');
  if (redis && typeof redis.get === 'function') ok('initRedis() 返回有效的 Redis 实例');
  else fail('initRedis()', new Error('返回值无 get 方法'));
  // 不调用 connect，直接 disconnect 释放
  redis.disconnect();
} catch (err) {
  fail('initRedis()', err);
}

// 3. 连接 + 操作测试（需要真实 Redis）
let redisAvailable = false;
try {
  const redis = await connectRedis('redis://127.0.0.1:6379');
  await redis.ping();
  redisAvailable = true;
  ok('connectRedis() 连接成功，PING 响应正常');
} catch {
  skip('connectRedis() 连接（本地 Redis 不可用）');
}

if (redisAvailable) {
  try {
    // setSessionState / getSessionState
    await setSessionState('test:sess-1', { model: 'claude-sonnet-4-6', status: 'active' });
    const state = await getSessionState('test:sess-1');
    if (state?.model === 'claude-sonnet-4-6') ok('setSessionState / getSessionState 读写正确');
    else fail('sessionState 读写', new Error(`got ${JSON.stringify(state)}`));

    // getSessionState 不存在的 key 返回 null
    const missing = await getSessionState('nonexistent:key');
    if (missing === null) ok('getSessionState 不存在的 key 返回 null');
    else fail('getSessionState null', new Error(`got ${JSON.stringify(missing)}`));

    // incrCostRealtime
    const today = new Date().toISOString().slice(0, 10);
    await incrCostRealtime(today, 'claude-sonnet-4-6', 100, 200, 0.01);
    await incrCostRealtime(today, 'claude-sonnet-4-6', 50, 100, 0.005);
    const { Redis } = await import('ioredis');
    const redis = await connectRedis();
    const raw = await redis.hget(REDIS_KEYS.costsRealtime(today), 'claude-sonnet-4-6');
    const cost = JSON.parse(raw);
    if (cost.tokenInput === 150 && cost.tokenOutput === 300) ok('incrCostRealtime 累计计算正确');
    else fail('incrCostRealtime', new Error(`got ${JSON.stringify(cost)}`));

    // pushRoutingLog + ltrim
    await pushRoutingLog({ prompt: 'test', layer: 'L2', model: 'qwen2.5:7b', latencyMs: 12 });
    const logLen = await redis.llen(REDIS_KEYS.routingLogsBuffer);
    if (logLen >= 1) ok(`pushRoutingLog 写入成功（当前 buffer 长度 ${logLen}）`);
    else fail('pushRoutingLog', new Error(`llen = ${logLen}`));

    // 清理测试数据
    await redis.del(
      REDIS_KEYS.sessionState('test:sess-1'),
      REDIS_KEYS.costsRealtime(today),
      REDIS_KEYS.routingLogsBuffer,
    );
    ok('测试数据清理完成');

  } catch (err) {
    fail('Redis 操作', err);
  } finally {
    await disconnectRedis();
  }
}

console.log(`\n结果：${passed} 通过，${failed} 失败，${skipped} 跳过`);
if (failed > 0) process.exit(1);
process.exit(0);
