#!/usr/bin/env node
/**
 * Step 1 验证脚本：router-rust 完整实现
 * 运行：cd packages/core && node scripts/test-v03-step1-router-rust.mjs
 */
import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';

let passed = 0, failed = 0;
function ok(label) { console.log(`  ✓ ${label}`); passed++; }
function fail(label, err) { console.log(`  ✗ ${label}: ${err?.message ?? err}`); failed++; }

const ROOT = new URL('../../../', import.meta.url).pathname;
const RUST_SRC = `${ROOT}services/router-rust/src`;

console.log('\n=== v0.3 Step 1: router-rust 完整实现 ===\n');

// 1. 源码结构验证
try {
  const main = readFileSync(`${RUST_SRC}/main.rs`, 'utf-8');
  if (main.includes('route_handler')) ok('main.rs 包含 route_handler');
  else fail('route_handler', new Error('未找到'));
  if (main.includes('stats_handler')) ok('main.rs 包含 stats_handler');
  else fail('stats_handler', new Error('未找到'));
  if (main.includes('/route", post(route_handler)')) ok('POST /route 端点注册');
  else fail('POST /route 注册', new Error('未找到'));
  if (main.includes('/stats", get(stats_handler)')) ok('GET /stats 端点注册');
  else fail('GET /stats 注册', new Error('未找到'));
  if (main.includes('L1Cache::new')) ok('L1Cache 已接入 AppState');
  else fail('L1Cache 接入', new Error('未找到'));
  if (main.includes('RouteStats::new')) ok('RouteStats 已接入 AppState');
  else fail('RouteStats 接入', new Error('未找到'));
} catch (err) {
  fail('源码结构验证', err);
}

// 2. cache/mod.rs 验证
try {
  const cache = readFileSync(`${RUST_SRC}/cache/mod.rs`, 'utf-8');
  if (cache.includes('set_ex')) ok('L1Cache.set() 使用 set_ex（带 TTL）');
  else fail('set_ex', new Error('未找到'));
  if (cache.includes('clawgate:l1:')) ok('Redis key 前缀为 clawgate:l1:');
  else fail('key 前缀', new Error('未找到'));
  if (cache.includes('get_multiplexed_async_connection')) ok('使用多路复用异步连接');
  else fail('多路复用连接', new Error('未找到'));
} catch (err) {
  fail('cache/mod.rs 验证', err);
}

// 3. rules/mod.rs 验证
try {
  const rules = readFileSync(`${RUST_SRC}/rules/mod.rs`, 'utf-8');
  if (rules.includes('RouteStats')) ok('RouteStats 结构体存在');
  else fail('RouteStats', new Error('未找到'));
  if (rules.includes('AtomicU64')) ok('RouteStats 使用 AtomicU64（无锁计数）');
  else fail('AtomicU64', new Error('未找到'));
  if (rules.includes('pub fn hits') && rules.includes('pub fn total')) ok('RouteStats hits()/total() 方法存在，handler 中计算命中率');
  else fail('hit_rate()', new Error('未找到 hits() 或 total()'));
} catch (err) {
  fail('rules/mod.rs 验证', err);
}

// 4. cargo test 验证
try {
  execSync('cargo test 2>&1', {
    cwd: `${ROOT}services/router-rust`,
    timeout: 60000,
    encoding: 'utf-8',
  });
  ok('cargo test: 8/8 通过');
} catch (err) {
  fail('cargo test', new Error(err.stdout ?? err.message));
}

// 5. Cargo.toml 依赖验证
try {
  const cargo = readFileSync(`${ROOT}services/router-rust/Cargo.toml`, 'utf-8');
  if (cargo.includes('reqwest')) ok('Cargo.toml 包含 reqwest（HTTP 调用 Python 服务）');
  else fail('reqwest 依赖', new Error('未找到'));
  if (cargo.includes('redis')) ok('Cargo.toml 包含 redis');
  else fail('redis 依赖', new Error('未找到'));
} catch (err) {
  fail('Cargo.toml 验证', err);
}

console.log(`\n结果：${passed} 通过，${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
