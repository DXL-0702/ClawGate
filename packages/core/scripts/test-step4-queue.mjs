#!/usr/bin/env node
/**
 * Step 4 验证脚本：BullMQ 初始化 + 归档任务
 * 运行：cd packages/core && node scripts/test-step4-queue.mjs
 * 若本地无 Redis，队列相关测试自动跳过，模块导出验证仍执行。
 */
import {
  initQueue, getQueue, startArchiveWorker, scheduleArchiveJobs, stopQueue,
  initDb, schema,
  initRedis, connectRedis, disconnectRedis,
  incrCostRealtime, pushRoutingLog, REDIS_KEYS,
} from '../dist/index.js';
import { unlinkSync, existsSync } from 'fs';

const TMP_DB = '/tmp/clawgate-test-step4.db';
for (const f of [TMP_DB, TMP_DB + '-wal', TMP_DB + '-shm']) {
  if (existsSync(f)) unlinkSync(f);
}

let passed = 0, failed = 0, skipped = 0;
function ok(label) { console.log(`  ✓ ${label}`); passed++; }
function fail(label, err) { console.log(`  ✗ ${label}: ${err?.message ?? err}`); failed++; }
function skip(label) { console.log(`  - ${label} (跳过：Redis 不可用)`); skipped++; }

console.log('\n=== Step 4: BullMQ 初始化 + 归档任务 ===\n');

// 1. 模块导出验证（无需连接）
try {
  if (typeof initQueue === 'function') ok('initQueue 导出正确');
  else fail('initQueue 导出', new Error('不是函数'));
  if (typeof startArchiveWorker === 'function') ok('startArchiveWorker 导出正确');
  else fail('startArchiveWorker 导出', new Error('不是函数'));
  if (typeof scheduleArchiveJobs === 'function') ok('scheduleArchiveJobs 导出正确');
  else fail('scheduleArchiveJobs 导出', new Error('不是函数'));
  if (typeof stopQueue === 'function') ok('stopQueue 导出正确');
  else fail('stopQueue 导出', new Error('不是函数'));
} catch (err) {
  fail('模块导出验证', err);
}

// 2. 连接 Redis
let redisAvailable = false;
try {
  initRedis('redis://127.0.0.1:6379');
  await connectRedis('redis://127.0.0.1:6379');
  redisAvailable = true;
  ok('Redis 连接成功');
} catch {
  skip('Redis 连接');
}

if (redisAvailable) {
  const db = initDb(TMP_DB);

  try {
    // 3. Queue 初始化
    const queue = initQueue();
    if (queue && typeof queue.add === 'function') ok('initQueue() 返回有效 Queue 实例');
    else fail('initQueue()', new Error('无 add 方法'));

    if (getQueue() === queue) ok('getQueue() 返回同一实例');
    else fail('getQueue() 单例', new Error('实例不同'));

    // 4. Worker 启动
    const worker = startArchiveWorker();
    if (worker && typeof worker.close === 'function') ok('startArchiveWorker() 返回有效 Worker');
    else fail('startArchiveWorker()', new Error('无 close 方法'));

    // 5. 写入 Redis costs + logs，手动触发归档 job，验证写入 SQLite
    const today = new Date().toISOString().slice(0, 10);
    await incrCostRealtime(today, 'claude-sonnet-4-6', 500, 250, 0.025);
    await pushRoutingLog({ prompt: 'archive test', layer: 'L2', model: 'qwen2.5:7b', latencyMs: 20 });
    ok('测试数据写入 Redis 成功');

    // 手动触发归档 job（不等定时器）
    await queue.add('costs:archive', {}, { removeOnComplete: true });
    await queue.add('logs:archive', {}, { removeOnComplete: true });

    // 等待 Worker 处理完成（最多 5s）
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // 6. 验证 SQLite 写入
    const costRows = await db.select().from(schema.costs);
    if (costRows.length >= 1 && costRows[0].estimatedUsd === 0.025) ok('costs 归档到 SQLite 正确');
    else fail('costs 归档', new Error(`got ${JSON.stringify(costRows)}`));

    const logRows = await db.select().from(schema.routingLogs);
    if (logRows.length >= 1 && logRows[0].prompt === 'archive test') ok('routing_logs 归档到 SQLite 正确');
    else fail('routing_logs 归档', new Error(`got ${JSON.stringify(logRows)}`));

    // 7. Redis buffer 已被清空
    const redis = await connectRedis();
    const bufLen = await redis.llen(REDIS_KEYS.routingLogsBuffer);
    if (bufLen === 0) ok('归档后 routing_logs_buf 已清空');
    else fail('buffer 清空', new Error(`llen = ${bufLen}`));

  } catch (err) {
    fail('BullMQ 操作', err);
  } finally {
    await stopQueue();
    await disconnectRedis();
    for (const f of [TMP_DB, TMP_DB + '-wal', TMP_DB + '-shm']) {
      if (existsSync(f)) unlinkSync(f);
    }
  }
}

console.log(`\n结果：${passed} 通过，${failed} 失败，${skipped} 跳过`);
process.exit(failed > 0 ? 1 : 0);
