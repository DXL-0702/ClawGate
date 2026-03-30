#!/usr/bin/env node
/**
 * v0.3 Step 5 验证脚本：Node.js RouterClient 接入
 * 运行：cd packages/core && node scripts/test-v03-step5-router-client.mjs
 */
import { readFileSync } from 'fs';
import { RouterClient } from '../dist/index.js';

let passed = 0, failed = 0;
function ok(label) { console.log(`  ✓ ${label}`); passed++; }
function fail(label, err) { console.log(`  ✗ ${label}: ${err?.message ?? err}`); failed++; }

const ROOT = new URL('../../../', import.meta.url).pathname;

console.log('\n=== v0.3 Step 5: Node.js RouterClient 接入 ===\n');

// 1. RouterClient 模块导出验证
try {
  if (typeof RouterClient === 'function') ok('RouterClient 导出正确');
  else fail('RouterClient', new Error('不是类'));
  const client = new RouterClient();
  if (typeof client.route === 'function') ok('RouterClient.route() 方法存在');
  else fail('route()', new Error('方法不存在'));
  if (typeof client.stats === 'function') ok('RouterClient.stats() 方法存在');
  else fail('stats()', new Error('方法不存在'));
  if (typeof client.health === 'function') ok('RouterClient.health() 方法存在');
  else fail('health()', new Error('方法不存在'));
} catch (err) {
  fail('RouterClient 模块', err);
}

// 2. Router 不可用时 route() fallback 验证
try {
  const client = new RouterClient('http://127.0.0.1:19999');
  const decision = await client.route('hello world', 'test:sess-001');
  if (decision.model === 'claude-sonnet-4-6') ok('Router 不可用时 fallback 到 claude-sonnet-4-6');
  else fail('fallback model', new Error(`got ${decision.model}`));
  if (decision.provider === 'anthropic') ok('fallback provider = anthropic');
  else fail('fallback provider', new Error(`got ${decision.provider}`));
  if (decision.cacheHit === false) ok('fallback cacheHit = false');
  else fail('fallback cacheHit', new Error(`got ${decision.cacheHit}`));
} catch (err) {
  fail('fallback 验证', err);
}

// 3. stats() 不可用时返回 null
try {
  const client = new RouterClient('http://127.0.0.1:19999');
  const stats = await client.stats();
  if (stats === null) ok('Router 不可用时 stats() 返回 null');
  else fail('stats() null fallback', new Error(`got ${JSON.stringify(stats)}`));
} catch (err) {
  fail('stats() fallback', err);
}

// 4. health() 不可用时返回 false
try {
  const client = new RouterClient('http://127.0.0.1:19999');
  const healthy = await client.health();
  if (healthy === false) ok('Router 不可用时 health() 返回 false');
  else fail('health() false fallback', new Error(`got ${healthy}`));
} catch (err) {
  fail('health() fallback', err);
}

// 5. server/routes/route.ts 源码验证
try {
  const src = readFileSync(`${ROOT}packages/server/src/routes/route.ts`, 'utf-8');
  if (src.includes('POST') && src.includes('/route')) ok('POST /api/route 端点存在');
  else fail('POST /api/route', new Error('未找到'));
  if (src.includes('GET') && src.includes('/route/stats')) ok('GET /api/route/stats 端点存在');
  else fail('GET /api/route/stats', new Error('未找到'));
  if (src.includes('pushRoutingLog')) ok('路由决策写入 routing_logs');
  else fail('pushRoutingLog', new Error('未找到'));
  if (src.includes('setImmediate')) ok('routing_logs 写入为非阻塞（setImmediate）');
  else fail('setImmediate', new Error('未找到'));
} catch (err) {
  fail('route.ts 源码验证', err);
}

console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);
process.exit(0);
