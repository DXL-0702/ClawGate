#!/bin/bash
set -e

API="http://localhost:3000/api"
REDIS_URL="redis://127.0.0.1:6379"

echo "=========================================="
echo "  ClawGate DAG 执行链路端到端联调测试"
echo "=========================================="
echo ""

# 步骤 0: 检查依赖
echo "[Step 0] 检查依赖服务..."

# 检查 Redis (Docker 或本地)
REDIS_PING=""
if command -v redis-cli &> /dev/null && redis-cli ping > /dev/null 2>&1; then
  REDIS_PING="PONG"
  REDIS_MODE="local"
elif docker exec clawgate-redis redis-cli ping > /dev/null 2>&1; then
  REDIS_PING="PONG"
  REDIS_MODE="docker"
fi

if [ "$REDIS_PING" = "PONG" ]; then
  echo "  ✓ Redis 运行正常 ($REDIS_MODE)"
else
  echo "  ✗ Redis 未运行"
  echo "    请启动: docker compose up -d redis"
  exit 1
fi

# 检查 ClawGate API
if curl -s "$API/health" > /dev/null 2>&1; then
  echo "  ✓ ClawGate API 运行正常"
else
  echo "  ✗ ClawGate API 未运行"
  echo "    请先在另一个终端执行: pnpm dev"
  exit 1
fi

# 检查 OpenClaw Gateway
OPENCLAW_CONFIG="$HOME/.openclaw/openclaw.json"
if [ -f "$OPENCLAW_CONFIG" ]; then
  echo "  ✓ OpenClaw 配置存在 ($OPENCLAW_CONFIG)"
else
  echo "  ✗ OpenClaw 配置未找到"
  exit 1
fi

echo ""
echo "[Step 1] 创建测试 DAG..."
DAG_RESPONSE=$(curl -s -X POST "$API/dags" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "E2E Test Workflow",
    "definition": {
      "nodes": [{
        "id": "node-1",
        "type": "agent",
        "agentId": "main",
        "prompt": "Say hello in exactly 3 words"
      }]
    }
  }' 2>/dev/null || echo '{"error": "Connection failed"}')

if echo "$DAG_RESPONSE" | grep -q '"error"'; then
  echo "  ✗ 创建 DAG 失败: $DAG_RESPONSE"
  exit 1
fi

DAG_ID=$(echo "$DAG_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
DAG_NAME=$(echo "$DAG_RESPONSE" | grep -o '"name":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "  ✓ DAG 创建成功"
echo "    ID: $DAG_ID"
echo "    Name: $DAG_NAME"

echo ""
echo "[Step 2] 触发 DAG 执行..."
RUN_RESPONSE=$(curl -s -X POST "$API/dags/$DAG_ID/run" 2>/dev/null || echo '{"error": "Connection failed"}')

if echo "$RUN_RESPONSE" | grep -q '"error"'; then
  echo "  ✗ 触发执行失败: $RUN_RESPONSE"
  exit 1
fi

RUN_ID=$(echo "$RUN_RESPONSE" | grep -o '"runId":"[^"]*"' | cut -d'"' -f4)
INITIAL_STATUS=$(echo "$RUN_RESPONSE" | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "  ✓ 执行已触发"
echo "    Run ID: $RUN_ID"
echo "    Initial Status: $INITIAL_STATUS"

echo ""
echo "[Step 3] 轮询执行状态..."
echo "  轮询间隔: 2秒, 最大轮询: 15次 (约30秒)"

count=0
MAX_POLL=15
FINAL_STATUS=""
FINAL_RESPONSE=""

while [ $count -lt $MAX_POLL ]; do
  count=$((count + 1))
  sleep 2

  STATUS_RESPONSE=$(curl -s "$API/dag-runs/$RUN_ID" 2>/dev/null || echo '{"error": "Connection failed"}')

  if echo "$STATUS_RESPONSE" | grep -q '"error"'; then
    echo "  Poll $count: 查询失败, 继续重试..."
    continue
  fi

  STATUS=$(echo "$STATUS_RESPONSE" | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4)
  echo "  Poll $count: status = $STATUS"

  if [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ]; then
    FINAL_STATUS="$STATUS"
    FINAL_RESPONSE="$STATUS_RESPONSE"
    break
  fi
done

echo ""
echo "[Step 4] 验证结果..."

if [ -z "$FINAL_STATUS" ]; then
  echo "  ✗ 超时: 30秒内未完成"
  exit 1
fi

if [ "$FINAL_STATUS" = "completed" ]; then
  echo "  ✓ 执行成功完成"

  # 提取输出
  OUTPUT=$(echo "$FINAL_RESPONSE" | grep -o '"output":"[^"]*"' | head -1 | cut -d'"' -f4)
  if [ -n "$OUTPUT" ]; then
    echo "    Output: $OUTPUT"
  fi

  # 验证节点状态
  NODE_COUNT=$(echo "$FINAL_RESPONSE" | grep -o '"nodeId"' | wc -l | tr -d ' ')
  echo "    节点数: $NODE_COUNT"

elif [ "$FINAL_STATUS" = "failed" ]; then
  echo "  ✗ 执行失败"
  ERROR=$(echo "$FINAL_RESPONSE" | grep -o '"error":"[^"]*"' | head -1 | cut -d'"' -f4)
  echo "    Error: $ERROR"
fi

echo ""
echo "[Step 5] 验证节点状态表..."
NODES_RESPONSE=$(curl -s "$API/dag-runs/$RUN_ID" 2>/dev/null)
NODE_STATUS=$(echo "$NODES_RESPONSE" | grep -o '"status":"[^"]*"' | grep -v "$FINAL_STATUS" | head -1 | cut -d'"' -f4)
if [ -n "$NODE_STATUS" ]; then
  echo "  ✓ 节点状态: $NODE_STATUS"
else
  echo "  ! 节点状态信息未找到"
fi

echo ""
echo "=========================================="
echo "  联调测试完成"
echo "=========================================="
echo ""
echo "完整响应:"
echo "$FINAL_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$FINAL_RESPONSE"

# 清理（可选）
echo ""
echo "[清理] 删除测试 DAG..."
# curl -s -X DELETE "$API/dags/$DAG_ID" > /dev/null 2>&1 || true
echo "  （保留用于人工检查，可手动删除）"

exit 0
