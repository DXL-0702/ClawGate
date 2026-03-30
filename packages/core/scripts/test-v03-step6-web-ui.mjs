#!/usr/bin/env node
/**
 * v0.3 Step 6 验证脚本：Web UI 路由决策可视化
 * 运行：cd packages/core && node scripts/test-v03-step6-web-ui.mjs
 */
import { readFileSync, existsSync } from 'fs';

let passed = 0, failed = 0;
function ok(label) { console.log(`  ✓ ${label}`); passed++; }
function fail(label, err) { console.log(`  ✗ ${label}: ${err?.message ?? err}`); failed++; }

const ROOT = new URL('../../../', import.meta.url).pathname;
const WEB = `${ROOT}packages/web/src`;

console.log('\n=== v0.3 Step 6: Web UI 路由决策可视化 ===\n');

// 1. RouterPage 存在
try {
  const src = readFileSync(`${WEB}/pages/RouterPage.tsx`, 'utf-8');
  if (src.includes('router-stats')) ok('RouterPage: 查询 router-stats');
  else fail('router-stats', new Error('未找到'));
  if (src.includes('refetchInterval')) ok('RouterPage: 5s 自动刷新统计');
  else fail('refetchInterval', new Error('未找到'));
  if (src.includes('LAYER_COLOR')) ok('RouterPage: L1/L2/L3/L4 颜色标记');
  else fail('LAYER_COLOR', new Error('未找到'));
  if (src.includes('route.decision')) ok('RouterPage: 监听 route.decision 实时事件');
  else fail('route.decision', new Error('未找到'));
} catch (err) { fail('RouterPage 读取', err); }

// 2. App.tsx 路由注册
try {
  const src = readFileSync(`${WEB}/App.tsx`, 'utf-8');
  if (src.includes('/router')) ok('App.tsx: /router 路由已注册');
  else fail('/router 路由', new Error('未找到'));
  if (src.includes('RouterPage')) ok('App.tsx: RouterPage 组件已导入');
  else fail('RouterPage import', new Error('未找到'));
} catch (err) { fail('App.tsx 读取', err); }

// 3. Layout 侧边栏
try {
  const src = readFileSync(`${WEB}/components/Layout.tsx`, 'utf-8');
  if (src.includes('/router')) ok('Layout: Router 导航项已添加');
  else fail('Router 导航', new Error('未找到'));
} catch (err) { fail('Layout 读取', err); }

// 4. DashboardPage 真实数据
try {
  const src = readFileSync(`${WEB}/pages/DashboardPage.tsx`, 'utf-8');
  if (src.includes('fetchAgents') && src.includes('fetchSessions')) ok('Dashboard: 接入真实 Agents/Sessions 数据');
  else fail('Dashboard 真实数据', new Error('未找到'));
  if (src.includes('fetchRouterStats')) ok('Dashboard: 接入路由统计数据');
  else fail('fetchRouterStats', new Error('未找到'));
  if (src.includes('L1 Hit Rate')) ok('Dashboard: 展示 L1 命中率');
  else fail('L1 Hit Rate', new Error('未找到'));
} catch (err) { fail('DashboardPage 读取', err); }

// 5. Web dist 存在
if (existsSync(`${ROOT}packages/web/dist/assets`)) ok('Web dist 产物存在');
else fail('Web dist', new Error('目录不存在'));

console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);
process.exit(0);
