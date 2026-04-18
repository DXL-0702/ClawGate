# 单点部署

两种方式：裸机（开发）或 Docker（生产）。

## 快速开始

### 方式一：裸机部署（开发调试）

**依赖**：Node 18+、pnpm、Rust 1.70+、Python 3.11+、Docker

```bash
git clone https://github.com/DXL-0702/ClawGate.git && cd ClawGate
pnpm install && pnpm build
docker compose up -d redis qdrant ollama
pnpm dev
```

验证：`curl http://localhost:3000/api/health`

---

## 功能依赖说明

| 功能 | 需要 OpenClaw | 说明 |
|------|--------------|------|
| 智能路由（4层） | ❌ 不需要 | L1-L4 路由核心，完全独立运行 |
| OpenAI 兼容 API | ❌ 不需要 | `/v1/chat/completions` 直接可用 |
| Stats Dashboard | ❌ 不需要 | 路由统计、成本趋势完全可用 |
| **Agent 管理** | ✅ **需要** | 需连接 OpenClaw Gateway |
| **Session 监控** | ✅ **需要** | 需连接 OpenClaw Gateway |
| **DAG 工作流** | ✅ **需要** | DAG Worker 通过 Gateway 执行 Agent 任务 |

> **建议**：首次体验可跳过 OpenClaw，验证智能路由功能后再安装 OpenClaw 解锁完整能力。

---

### 方式二：Docker 部署（推荐）

仅需 Docker。

**docker-compose.yml**：

```yaml
version: '3.8'
services:
  clawgate:
    image: ghcr.io/dxl-0702/clawgate:latest
    ports: ["3000:3000"]
    volumes:
      - ./data:/data
      - ~/.openclaw:/root/.openclaw:ro
    environment:
      - CLAWGATE_DB_PATH=/data/clawgate.db
  redis:
    image: redis:7-alpine
    volumes: [redis-data:/data]
  qdrant:
    image: qdrant/qdrant:latest
    volumes: [qdrant-data:/qdrant/storage]
  ollama:
    image: ollama/ollama:latest
    volumes: [ollama-data:/root/.ollama]

volumes:
  redis-data:
  qdrant-data:
  ollama-data:
```

启动：`docker compose up -d`

查看日志：`docker compose logs -f clawgate`

**配置 OpenClaw（可选）**：

若主机已安装 OpenClaw，下载 `.env.example` 并配置：

```bash
curl -O https://raw.githubusercontent.com/DXL-0702/ClawGate/main/.env.example
cp .env.example .env

# 编辑 .env，设置正确的 Gateway 地址（Linux 需用宿主机 IP）
# GATEWAY_URL=ws://host.docker.internal:18789  # macOS/Windows
# GATEWAY_URL=ws://192.168.1.x:18789           # Linux

docker compose -f docker-compose.prod.yml up -d
```

---

## 连接 OpenClaw

### 1. 创建团队

```bash
curl -X POST http://localhost:3000/api/teams \
  -H "Content-Type: application/json" \
  -d '{"name":"MyTeam","slug":"my-team","ownerEmail":"you@example.com"}'
# 保存返回的 apiKey
```

### 2. 注册实例

```bash
# Docker 部署用 host.docker.internal
# 裸机部署用 127.0.0.1

curl -X POST http://localhost:3000/api/instances/register \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My-MacBook",
    "gatewayUrl": "ws://host.docker.internal:18789",
    "gatewayToken": "your-token",
    "environment": "production"
  }'
```

### 3. 验证

```bash
curl http://localhost:3000/api/instances -H "X-API-Key: YOUR_API_KEY"
```

---

## 对比

| 维度 | 裸机 | Docker |
|------|------|--------|
| 依赖 | Node/Rust/Python/Docker | 仅 Docker |
| 安装 | 10-15 分钟 | 2-3 分钟 |
| 热重载 | ✅ | ❌ |
| 环境隔离 | ❌ | ✅ |
| 适用 | 开发 | 生产 |

---

## 常见问题

**Q: Docker 无法连接宿主机 OpenClaw？**

Linux 用宿主机 IP：`"gatewayUrl": "ws://192.168.x.x:18789"`

**Q: 数据库位置？**

- 裸机：`./clawgate.db`
- Docker：`./data/clawgate.db`

**Q: 如何升级？**

```bash
# 裸机
git pull && pnpm install && pnpm build

# Docker
docker compose pull && docker compose up -d
```
