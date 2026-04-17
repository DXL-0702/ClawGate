#!/usr/bin/env bash
# =============================================================================
# test-dag-wave3.sh — v0.5 Wave 3 多节点 DAG 执行验证脚本
#
# 前置条件：
#   - ClawGate server 已启动（pnpm dev 或 node dist/index.js）
#   - Redis 在线
#   - 已创建至少一个团队和 API Key
#
# 用法：
#   export API_KEY="your-api-key"     # 团队成员 API Key
#   bash scripts/test-dag-wave3.sh
# =============================================================================

set -euo pipefail

BASE_URL="${CLAWGATE_URL:-http://localhost:3000}"
API_KEY="${API_KEY:-test-key}"
PASS=0
FAIL=0

# 颜色输出
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RESET='\033[0m'

pass() { echo -e "${GREEN}✓ PASS${RESET} $1"; ((PASS++)); }
fail() { echo -e "${RED}✗ FAIL${RESET} $1"; ((FAIL++)); }
info() { echo -e "${CYAN}  →${RESET} $1"; }
section() { echo -e "\n${YELLOW}══ $1 ══${RESET}"; }

# =============================================================================
# 场景 1：拓扑排序单元验证（Node.js 直调，不依赖服务）
# =============================================================================
section "场景 1: 拓扑排序引擎单元验证"

TOPO_RESULT=$(node --input-type=module <<'EOF'
import { topologicalSort, hasCycle } from './packages/core/dist/dag/topo-sort.js';

let ok = true;

// 1a. 线性链 A→B→C
const linear = topologicalSort(
  [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
  [{ id: 'e1', source: 'A', target: 'B' }, { id: 'e2', source: 'B', target: 'C' }]
);
if (JSON.stringify(linear) !== JSON.stringify([['A'],['B'],['C']])) {
  console.log('FAIL: linear chain');
  ok = false;
} else {
  console.log('PASS: linear chain A→B→C produces 3 batches');
}

// 1b. Diamond A→B,C→D
const diamond = topologicalSort(
  [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }],
  [
    { id: 'e1', source: 'A', target: 'B' },
    { id: 'e2', source: 'A', target: 'C' },
    { id: 'e3', source: 'B', target: 'D' },
    { id: 'e4', source: 'C', target: 'D' },
  ]
);
if (diamond.length !== 3 || diamond[0][0] !== 'A' || !diamond[1].includes('B') || !diamond[1].includes('C') || diamond[2][0] !== 'D') {
  console.log('FAIL: diamond structure');
  ok = false;
} else {
  console.log('PASS: diamond A→B,C→D produces 3 layers (middle parallel)');
}

// 1c. 循环检测 A→B→A
let caught = false;
try {
  topologicalSort(
    [{ id: 'A' }, { id: 'B' }],
    [{ id: 'e1', source: 'A', target: 'B' }, { id: 'e2', source: 'B', target: 'A' }]
  );
} catch (e) {
  caught = true;
}
if (!caught) {
  console.log('FAIL: cycle detection did not throw');
  ok = false;
} else {
  console.log('PASS: cycle A→B→A correctly throws error');
}

// 1d. hasCycle
const cycle = hasCycle(
  [{ id: 'X' }, { id: 'Y' }],
  [{ id: 'e1', source: 'X', target: 'Y' }, { id: 'e2', source: 'Y', target: 'X' }]
);
console.log(cycle ? 'PASS: hasCycle returns true for cyclic graph' : 'FAIL: hasCycle should return true');
if (!cycle) ok = false;

process.exit(ok ? 0 : 1);
EOF
)

while IFS= read -r line; do
  if [[ "$line" == PASS* ]]; then
    pass "$line"
  elif [[ "$line" == FAIL* ]]; then
    fail "$line"
  fi
done <<< "$TOPO_RESULT"

# =============================================================================
# 场景 2：变量替换单元验证
# =============================================================================
section "场景 2: 变量替换引擎单元验证"

SUBST_RESULT=$(node --input-type=module <<'EOF'
import { substituteVariables, extractReferencedNodes } from './packages/core/dist/dag/variable-subst.js';

let ok = true;

// 2a. 已知变量替换
const r1 = substituteVariables('结果：{{node-1.output}}', { 'node-1': '分析完成' });
if (r1 !== '结果：分析完成') {
  console.log('FAIL: known variable not substituted');
  ok = false;
} else {
  console.log('PASS: known variable substitution works');
}

// 2b. 未知变量保留
const r2 = substituteVariables('{{node-99.output}}', {});
if (r2 !== '{{node-99.output}}') {
  console.log('FAIL: unknown variable should be preserved');
  ok = false;
} else {
  console.log('PASS: unknown variable preserved as-is');
}

// 2c. 提取引用节点
const refs = extractReferencedNodes('基于 {{node-1.output}} 和 {{node-2.output}} 生成报告');
if (!refs.includes('node-1') || !refs.includes('node-2') || refs.length !== 2) {
  console.log('FAIL: extractReferencedNodes incorrect');
  ok = false;
} else {
  console.log('PASS: extractReferencedNodes extracts 2 unique refs');
}

process.exit(ok ? 0 : 1);
EOF
)

while IFS= read -r line; do
  if [[ "$line" == PASS* ]]; then
    pass "$line"
  elif [[ "$line" == FAIL* ]]; then
    fail "$line"
  fi
done <<< "$SUBST_RESULT"

# =============================================================================
# 场景 3：多节点 DAG 创建（含 edges）— 需要服务在线
# =============================================================================
section "场景 3: 多节点 DAG 创建（含 edges）"

echo "使用 BASE_URL=$BASE_URL"

# 服务健康检查
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/health" 2>/dev/null || echo "000")
if [ "$HTTP_STATUS" != "200" ]; then
  echo -e "${YELLOW}⚠ 跳过场景 3/4：服务未启动（$BASE_URL/api/health 返回 $HTTP_STATUS）${RESET}"
  echo -e "${YELLOW}  启动服务后重新运行此脚本可验证完整链路${RESET}"
else
  # 3a. 创建多节点 DAG（线性链：node-A → node-B → node-C）
  CREATE_RESP=$(curl -s -X POST "$BASE_URL/api/dags" \
    -H "Content-Type: application/json" \
    -H "X-API-Key: $API_KEY" \
    -d '{
      "name": "Wave3 Test - Linear Chain",
      "definition": {
        "nodes": [
          { "id": "node-A", "type": "agent", "agentId": "test-agent", "prompt": "第一步：分析任务" },
          { "id": "node-B", "type": "agent", "agentId": "test-agent", "prompt": "第二步：基于分析结果 {{node-A.output}} 生成方案" },
          { "id": "node-C", "type": "agent", "agentId": "test-agent", "prompt": "第三步：基于方案 {{node-B.output}} 撰写报告" }
        ],
        "edges": [
          { "id": "e1", "source": "node-A", "target": "node-B" },
          { "id": "e2", "source": "node-B", "target": "node-C" }
        ]
      }
    }')

  DAG_ID=$(echo "$CREATE_RESP" | node -e "process.stdin.setEncoding('utf8'); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{try{const o=JSON.parse(d);console.log(o.id||'')}catch{console.log('')}})")

  if [ -z "$DAG_ID" ]; then
    fail "多节点 DAG 创建失败: $CREATE_RESP"
  else
    pass "多节点 DAG 创建成功 (id=${DAG_ID:0:8}...)"
    info "definition 含 3 节点 + 2 条 edges"

    # 3b. 验证 edges 持久化
    GET_RESP=$(curl -s "$BASE_URL/api/dags/$DAG_ID")
    EDGE_COUNT=$(echo "$GET_RESP" | node -e "process.stdin.setEncoding('utf8'); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{try{const o=JSON.parse(d);console.log((o.definition?.edges||[]).length)}catch{console.log(0)}})")

    if [ "$EDGE_COUNT" = "2" ]; then
      pass "edges 正确持久化到 SQLite (count=$EDGE_COUNT)"
    else
      fail "edges 持久化失败 (count=$EDGE_COUNT，期望 2)"
    fi

    # 3c. 触发执行，验证节点状态数组返回
    RUN_RESP=$(curl -s -X POST "$BASE_URL/api/dags/$DAG_ID/run")
    RUN_ID=$(echo "$RUN_RESP" | node -e "process.stdin.setEncoding('utf8'); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{try{const o=JSON.parse(d);console.log(o.runId||'')}catch{console.log('')}})")

    if [ -z "$RUN_ID" ]; then
      fail "DAG 触发失败: $RUN_RESP"
    else
      pass "DAG 触发成功 (runId=${RUN_ID:0:8}...)"

      # 等待 Worker 初始化节点状态
      sleep 2

      # 3d. 验证 dag-runs 返回 nodes 数组（含 3 个节点）
      RUN_STATUS=$(curl -s "$BASE_URL/api/dag-runs/$RUN_ID")
      NODE_COUNT=$(echo "$RUN_STATUS" | node -e "process.stdin.setEncoding('utf8'); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{try{const o=JSON.parse(d);console.log((o.nodes||[]).length)}catch{console.log(0)}})")

      if [ "$NODE_COUNT" = "3" ]; then
        pass "dag-runs 响应内嵌节点状态数组 (count=$NODE_COUNT)"
        RUN_ST=$(echo "$RUN_STATUS" | node -e "process.stdin.setEncoding('utf8'); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{try{const o=JSON.parse(d);console.log(o.status)}catch{console.log('?')}})")
        info "run 状态: $RUN_ST"
      else
        fail "dag-runs nodes 数组异常 (count=$NODE_COUNT，期望 3)"
      fi
    fi
  fi

  # =============================================================================
  # 场景 4：循环依赖 DAG — 期望 run 标记为 failed
  # =============================================================================
  section "场景 4: 循环依赖 DAG 执行（期望 failed）"

  CYCLE_RESP=$(curl -s -X POST "$BASE_URL/api/dags" \
    -H "Content-Type: application/json" \
    -H "X-API-Key: $API_KEY" \
    -d '{
      "name": "Wave3 Test - Cycle Detection",
      "definition": {
        "nodes": [
          { "id": "node-X", "type": "agent", "agentId": "test-agent", "prompt": "Task X" },
          { "id": "node-Y", "type": "agent", "agentId": "test-agent", "prompt": "Task Y" }
        ],
        "edges": [
          { "id": "e1", "source": "node-X", "target": "node-Y" },
          { "id": "e2", "source": "node-Y", "target": "node-X" }
        ]
      }
    }')

  CYCLE_DAG_ID=$(echo "$CYCLE_RESP" | node -e "process.stdin.setEncoding('utf8'); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{try{const o=JSON.parse(d);console.log(o.id||'')}catch{console.log('')}})")

  if [ -z "$CYCLE_DAG_ID" ]; then
    fail "循环依赖 DAG 创建失败: $CYCLE_RESP"
  else
    pass "循环依赖 DAG 创建成功 (id=${CYCLE_DAG_ID:0:8}...)"

    CYCLE_RUN=$(curl -s -X POST "$BASE_URL/api/dags/$CYCLE_DAG_ID/run")
    CYCLE_RUN_ID=$(echo "$CYCLE_RUN" | node -e "process.stdin.setEncoding('utf8'); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{try{const o=JSON.parse(d);console.log(o.runId||'')}catch{console.log('')}})")

    if [ -z "$CYCLE_RUN_ID" ]; then
      fail "循环 DAG 触发失败: $CYCLE_RUN"
    else
      sleep 3
      CYCLE_STATUS=$(curl -s "$BASE_URL/api/dag-runs/$CYCLE_RUN_ID")
      CYCLE_ST=$(echo "$CYCLE_STATUS" | node -e "process.stdin.setEncoding('utf8'); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{try{const o=JSON.parse(d);console.log(o.status)}catch{console.log('?')}})")
      CYCLE_ERR=$(echo "$CYCLE_STATUS" | node -e "process.stdin.setEncoding('utf8'); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{try{const o=JSON.parse(d);console.log(o.error||'')}catch{console.log('')}})")

      if [ "$CYCLE_ST" = "failed" ]; then
        pass "循环依赖 DAG run 正确标记为 failed"
        info "错误信息: $CYCLE_ERR"
      else
        fail "循环依赖 DAG run 状态应为 failed，实际: $CYCLE_ST"
      fi
    fi
  fi
fi

# =============================================================================
# 汇总
# =============================================================================
echo -e "\n${YELLOW}══ 验证结果汇总 ══${RESET}"
echo -e "通过: ${GREEN}$PASS${RESET}  失败: ${RED}$FAIL${RESET}"

if [ "$FAIL" -eq 0 ]; then
  echo -e "${GREEN}✓ Wave 3 所有验证通过${RESET}"
  exit 0
else
  echo -e "${RED}✗ 有 $FAIL 项验证失败，请检查上方输出${RESET}"
  exit 1
fi
