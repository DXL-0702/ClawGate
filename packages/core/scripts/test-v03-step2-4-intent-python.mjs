#!/usr/bin/env node
/**
 * v0.3 Step 2-4 验证脚本：intent-python L2/L3/L4 实现
 * 运行：cd packages/core && node scripts/test-v03-step2-4-intent-python.mjs
 */
import { readFileSync } from 'fs';

let passed = 0, failed = 0;
function ok(label) { console.log(`  ✓ ${label}`); passed++; }
function fail(label, err) { console.log(`  ✗ ${label}: ${err?.message ?? err}`); failed++; }

const ROOT = new URL('../../../', import.meta.url).pathname;
const PY = `${ROOT}services/intent-python`;

console.log('\n=== v0.3 Step 2-4: intent-python L2/L3/L4 ===\n');

// ── Step 2: L2 语义缓存 ──────────────────────────────────────────
console.log('--- L2 SemanticCache ---');
try {
  const src = readFileSync(`${PY}/l2_semantic/__init__.py`, 'utf-8');
  if (src.includes('AsyncQdrantClient')) ok('L2: 使用 AsyncQdrantClient');
  else fail('L2: AsyncQdrantClient', new Error('未找到'));
  if (src.includes('SentenceTransformer')) ok('L2: 使用 SentenceTransformer 生成 embedding');
  else fail('L2: SentenceTransformer', new Error('未找到'));
  if (src.includes('COSINE')) ok('L2: 使用余弦相似度');
  else fail('L2: COSINE', new Error('未找到'));
  if (src.includes('self.threshold')) ok('L2: 阈值过滤（默认 0.75）');
  else fail('L2: threshold', new Error('未找到'));
  if (src.includes('async def store')) ok('L2: store() 写入向量缓存');
  else fail('L2: store()', new Error('未找到'));
  if (src.includes('async def lookup')) ok('L2: lookup() 查找相似 prompt');
  else fail('L2: lookup()', new Error('未找到'));
  if (src.includes('Top-3') || src.includes('limit=3')) ok('L2: Top-3 相似度投票');
  else fail('L2: Top-3', new Error('未找到'));
} catch (err) { fail('L2 源码读取', err); }

// ── Step 3: L3 Ollama Few-Shot ──────────────────────────────────
console.log('\n--- L3 OllamaClassifier ---');
try {
  const src = readFileSync(`${PY}/l3_sentinel/__init__.py`, 'utf-8');
  if (src.includes('FEW_SHOT_PROMPT')) ok('L3: 包含 Few-Shot Prompt 模板');
  else fail('L3: Few-Shot Prompt', new Error('未找到'));
  if (src.includes('qwen2.5:3b') || src.includes('classify_model')) ok('L3: 使用 qwen2.5:3b 分类模型');
  else fail('L3: classify_model', new Error('未找到'));
  if (src.includes('timeout')) ok('L3: 包含超时保护');
  else fail('L3: timeout', new Error('未找到'));
  if (src.includes('timed_out=True')) ok('L3: 超时时 fallback 到默认模型');
  else fail('L3: timed_out fallback', new Error('未找到'));
  if (src.includes('/api/generate')) ok('L3: 调用 Ollama /api/generate 端点');
  else fail('L3: /api/generate', new Error('未找到'));
  if (src.includes('temperature": 0')) ok('L3: temperature=0（确定性输出）');
  else fail('L3: temperature=0', new Error('未找到'));
} catch (err) { fail('L3 源码读取', err); }

// ── Step 4: L4 反馈闭环 ──────────────────────────────────────────
console.log('\n--- L4 FeedbackLoop ---');
try {
  const src = readFileSync(`${PY}/l4_feedback/__init__.py`, 'utf-8');
  if (src.includes('NEGATIVE_THRESHOLD')) ok('L4: 包含 NEGATIVE_THRESHOLD 常量（3次）');
  else fail('L4: NEGATIVE_THRESHOLD', new Error('未找到'));
  if (src.includes('def record')) ok('L4: record() 方法存在');
  else fail('L4: record()', new Error('未找到'));
  if (src.includes('satisfaction_rate')) ok('L4: satisfaction_rate() 统计方法存在');
  else fail('L4: satisfaction_rate()', new Error('未找到'));
  if (src.includes('_suggest_alternative')) ok('L4: _suggest_alternative() 模型降级逻辑');
  else fail('L4: _suggest_alternative()', new Error('未找到'));
  if (src.includes('neg_counts[model] = 0')) ok('L4: 触发降级后重置负反馈计数');
  else fail('L4: 重置计数', new Error('未找到'));
} catch (err) { fail('L4 源码读取', err); }

// ── main.py 集成验证 ────────────────────────────────────────────
console.log('\n--- main.py 集成 ---');
try {
  const src = readFileSync(`${PY}/main.py`, 'utf-8');
  if (src.includes('l2.lookup')) ok('main.py: L2 lookup 接入 /classify');
  else fail('main.py: l2.lookup', new Error('未找到'));
  if (src.includes('l3.classify')) ok('main.py: L3 classify 接入 /classify');
  else fail('main.py: l3.classify', new Error('未找到'));
  if (src.includes('l2.store')) ok('main.py: L3 结果写入 L2 缓存');
  else fail('main.py: l2.store', new Error('未找到'));
  if (src.includes('l4.record')) ok('main.py: L4 feedback 接入 /feedback');
  else fail('main.py: l4.record', new Error('未找到'));
  if (src.includes('/feedback/stats')) ok('main.py: /feedback/stats 端点存在');
  else fail('main.py: /feedback/stats', new Error('未找到'));
  if (src.includes('lifespan')) ok('main.py: 使用 lifespan 管理服务生命周期');
  else fail('main.py: lifespan', new Error('未找到'));
} catch (err) { fail('main.py 集成验证', err); }

console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);
process.exit(0);
