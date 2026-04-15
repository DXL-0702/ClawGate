#!/bin/bash
# 完整的 DAG E2E 测试流程

set -e

echo "=========================================="
echo "  ClawGate DAG 端到端联调测试"
echo "=========================================="
echo ""

# 1. 检查依赖
echo "[1/5] 检查依赖..."

# Redis
if docker exec clawgate-redis redis-cli ping > /dev/null 2>&1; then
  echo "  ✓ Redis (Docker)"
else
  echo "  ✗ Redis 未运行，启动中..."
  docker compose up -d redis
  sleep 2
fi

# ClawGate API
if curl -s http://localhost:3000/api/health > /dev/null 2>&1; then
  echo "  ✓ ClawGate API"
else
  echo "  ✗ ClawGate API 未运行"
  echo ""
  echo "  请先在另一个终端启动服务:"
  echo "    cd /Users/jaxson/ClawGate && pnpm dev"
  echo ""
  echo "  等待服务启动后按 Enter 继续..."
  read
fi

echo ""
echo "[2/5] 执行 API 测试..."
./scripts/test-dag-e2e.sh

echo ""
echo "[3/5] 测试完成"
