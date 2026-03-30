#!/usr/bin/env node
/**
 * Step 1 验证脚本：clawgate.yaml 配置文件支持
 * 运行：node scripts/test-step1-yaml-config.mjs
 */
import { loadYamlConfig, getYamlConfig, generateDefaultConfig } from '../packages/core/dist/index.js';
import { writeFile, readFile, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

const TMP = join(process.cwd(), '.test-clawgate.yaml');
let passed = 0;
let failed = 0;

function ok(label) {
  console.log(`  ✓ ${label}`);
  passed++;
}
function fail(label, err) {
  console.log(`  ✗ ${label}: ${err?.message ?? err}`);
  failed++;
}

console.log('\n=== Step 1: clawgate.yaml 配置文件支持 ===\n');

// 1. 无文件时返回默认值
try {
  const cfg = await loadYamlConfig('/nonexistent/path.yaml');
  if (cfg.gateway.openclaw_url === 'ws://127.0.0.1:18789') ok('无配置文件时使用默认 gateway.openclaw_url');
  else fail('默认 gateway.openclaw_url', new Error(`got ${cfg.gateway.openclaw_url}`));
  if (cfg.gateway.port === 3000) ok('无配置文件时使用默认 gateway.port = 3000');
  else fail('默认 gateway.port', new Error(`got ${cfg.gateway.port}`));
  if (cfg.router.l2_threshold === 0.75) ok('无配置文件时使用默认 router.l2_threshold = 0.75');
  else fail('默认 router.l2_threshold', new Error(`got ${cfg.router.l2_threshold}`));
} catch (err) {
  fail('无配置文件默认值', err);
}

// 2. 加载自定义 YAML
try {
  await writeFile(TMP, `
gateway:
  openclaw_url: ws://127.0.0.1:19999
  port: 4000
router:
  l1_ttl: 7200
  l2_threshold: 0.85
  l3_model: qwen2.5:7b
budgets:
  daily_limit_usd: 10.0
  alert_threshold: 0.9
`);
  const cfg = await loadYamlConfig(TMP);
  if (cfg.gateway.openclaw_url === 'ws://127.0.0.1:19999') ok('自定义 gateway.openclaw_url 加载正确');
  else fail('自定义 gateway.openclaw_url', new Error(`got ${cfg.gateway.openclaw_url}`));
  if (cfg.gateway.port === 4000) ok('自定义 gateway.port = 4000');
  else fail('自定义 gateway.port', new Error(`got ${cfg.gateway.port}`));
  if (cfg.router.l1_ttl === 7200) ok('自定义 router.l1_ttl = 7200');
  else fail('自定义 router.l1_ttl', new Error(`got ${cfg.router.l1_ttl}`));
  if (cfg.router.l2_threshold === 0.85) ok('自定义 router.l2_threshold = 0.85');
  else fail('自定义 router.l2_threshold', new Error(`got ${cfg.router.l2_threshold}`));
  if (cfg.budgets.daily_limit_usd === 10.0) ok('自定义 budgets.daily_limit_usd = 10.0');
  else fail('自定义 budgets.daily_limit_usd', new Error(`got ${cfg.budgets.daily_limit_usd}`));
} catch (err) {
  fail('自定义 YAML 加载', err);
} finally {
  if (existsSync(TMP)) await unlink(TMP);
}

// 3. 非法值被 zod 拦截
try {
  await writeFile(TMP, `gateway:\n  port: 99999\n`);
  await loadYamlConfig(TMP);
  fail('非法 port 应被 zod 拦截', new Error('未抛出异常'));
} catch {
  ok('非法 port 99999 被 zod Schema 拦截');
} finally {
  if (existsSync(TMP)) await unlink(TMP);
}

// 4. generateDefaultConfig 生成文件
try {
  await generateDefaultConfig(TMP);
  const content = await readFile(TMP, 'utf-8');
  if (content.includes('openclaw_url')) ok('generateDefaultConfig 生成含 openclaw_url 的 YAML');
  else fail('generateDefaultConfig 内容', new Error('缺少 openclaw_url'));
  // 生成的文件可被再次加载
  const cfg = await loadYamlConfig(TMP);
  if (cfg.gateway.port === 3000) ok('生成的默认文件可被正常加载');
  else fail('生成文件再次加载', new Error(`port = ${cfg.gateway.port}`));
} catch (err) {
  fail('generateDefaultConfig', err);
} finally {
  if (existsSync(TMP)) await unlink(TMP);
}

// 5. getYamlConfig() 返回当前内存中的配置
try {
  await loadYamlConfig('/nonexistent/path.yaml');
  const cfg = getYamlConfig();
  if (cfg.gateway.port === 3000) ok('getYamlConfig() 返回内存中的配置');
  else fail('getYamlConfig()', new Error(`got ${cfg.gateway.port}`));
} catch (err) {
  fail('getYamlConfig()', err);
}

console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);
