# 团队部署

中央服务器 + 多成员 OpenClaw 实例架构。

```
┌─────────────────────────────┐
│      中央服务器              │
│  ClawGate + Redis + Qdrant  │
│      http://clawgate.io     │
└─────────────┬───────────────┘
              │
    ┌─────────┼─────────┐
    ▼         ▼         ▼
 成员A      成员B      成员C
 MacBook   Linux     远程服务器
```

---

## 分层安全架构（推荐）

ClawGate 支持两种 Gateway 认证模式，适应不同安全需求：

| 模式 | 适用场景 | 安全性 | 配置方式 |
|------|---------|--------|---------|
| **Token-Only** | 开发环境、内网团队 | 中 | `GATEWAY_AUTH_MODE=token` |
| **Challenge-Response** | 生产环境、公网暴露 | 高 | `GATEWAY_AUTH_MODE=challenge` |

### 模式对比

**Token-Only（开发首选）**
- 仅使用 Bearer Token 认证
- 部署简单，无需设备密钥
- 适合本地开发、小团队内网

**Challenge-Response（生产推荐）**
- Ed25519 设备签名 + Token 双因子
- 每个设备独立密钥，可单独吊销
- 适合公网中央服务器、企业级部署

### 快速选择

```bash
# 开发/测试环境（简单快速）
GATEWAY_AUTH_MODE=token

# 生产/公网环境（安全优先）
GATEWAY_AUTH_MODE=challenge
# 需配合 device.json 设备注册（见下文"设备密钥管理"）

# 自动检测（默认）
# 有 device.json → challenge，无 → token
GATEWAY_AUTH_MODE=auto
```

---

## 中央服务器部署

### 1. 准备服务器

要求：
- 2 vCPU / 4GB RAM / 20GB 磁盘
- 公网 IP 或内网可访问
- Docker 已安装

### 2. 部署

```bash
# 下载团队 Compose 文件和环境变量模板
curl -O https://raw.githubusercontent.com/DXL-0702/ClawGate/main/docker-compose.team.yml
curl -O https://raw.githubusercontent.com/DXL-0702/ClawGate/main/.env.example

# 编辑 .env，必填项：
#   ANTHROPIC_API_KEY 或 OPENAI_API_KEY（至少一个）
#   ADMIN_API_KEY=<openssl rand -hex 32 生成的随机值>
cp .env.example .env && vi .env

# 启动（首次约 10 分钟，需下载 Ollama 模型）
docker compose -f docker-compose.team.yml up -d

# 验证
curl http://localhost:3000/api/health
```

> **说明**：`docker-compose.team.yml` 与 `docker-compose.prod.yml` 的区别：
> - 不挂载 `~/.openclaw`（团队模式下 OpenClaw 实例由成员本地运行，通过 HTTP 注册）
> - `CLAWGATE_REQUIRE_OPENCLAW=false`（中央服务器无需本地 OpenClaw）
> - 容器名加 `-team-` 前缀，可与单节点模式共存于同一宿主机
> - 支持 `CLAWGATE_PORT` 环境变量自定义外部端口（默认 3000）

---

## 团队接入流程

### 1. 创建团队（管理员）

```bash
curl -X POST http://clawgate-server:3000/api/teams \
  -H "Content-Type: application/json" \
  -d '{"name":"Engineering","slug":"eng","ownerEmail":"lead@company.com"}'
```

保存返回的 `apiKey`（仅显示一次）。

### 2. 添加成员

```bash
curl -X POST http://clawgate-server:3000/api/members \
  -H "X-API-Key: ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"dev@company.com","name":"Developer","role":"member"}'
```

### 3. 成员注册实例

成员本地执行：

```bash
# 确认 OpenClaw 运行
openclaw gateway

# 注册到中央服务器
curl -X POST http://clawgate-server:3000/api/instances/register \
  -H "X-API-Key: MEMBER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "MacBook-Pro-1",
    "gatewayUrl": "ws://$(hostname -I | cut -d" " -f1):18789",
    "gatewayToken": "openclaw-token",
    "environment": "production",
    "tags": ["ml-team"]
  }'
```

**注意**：`gatewayUrl` 需使用内网 IP（非 127.0.0.1），确保中央服务器可达。

---

## 验证

### 管理员查看团队状态

```bash
# 实例总览
curl http://clawgate-server:3000/api/health/overview \
  -H "X-API-Key: ADMIN_API_KEY"

# 告警列表
curl http://clawgate-server:3000/api/alerts \
  -H "X-API-Key: ADMIN_API_KEY"
```

### 创建 DAG 并调度

```bash
# 创建 DAG
curl -X POST http://clawgate-server:3000/api/dags \
  -H "X-API-Key: MEMBER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Data Pipeline",
    "definition": {"nodes":[{"id":"n1","type":"agent","agentId":"analyzer","prompt":"Analyze data"}]},
    "trigger": "manual"
  }'

# 触发执行（自动选择 production 实例）
curl -X POST http://clawgate-server:3000/api/dags/{dag-id}/run \
  -H "X-API-Key: MEMBER_API_KEY"
```

---

## 网络配置

### 场景一：内网部署（推荐）

所有成员与服务器在同一内网：
- 成员 `gatewayUrl`: `ws://192.168.x.x:18789`
- 服务器通过内网 IP 连接

### 场景二：公网部署

成员远程接入：
- 成员 OpenClaw 需暴露公网端口（或使用 Tailscale/WireGuard）
- 或使用反向代理 + VPN

---

## 运维

### 健康检查

系统自动每分钟检查：
- 无心跳 20s → 标记 offline
- 离线 30min → 告警

### 备份

```bash
# 备份数据库
docker cp clawgate:/data/clawgate.db ./backup.db

# 或定期任务
crontab -e
0 2 * * * docker cp clawgate:/data/clawgate.db /backups/clawgate-$(date +\%Y\%m\%d).db
```

### 监控端点

| 端点 | 用途 |
|------|------|
| `GET /api/health` | 服务健康 |
| `GET /api/health/overview` | 实例统计 |
| `GET /api/alerts` | 未确认告警 |

---

## 限制

当前版本（v1.0）：
- SQLite 单文件 → 适合 < 50 实例
- 无内置用户界面 → 使用 CLI 或自建前端
- DAG 单节点执行 → 多节点（拓扑/并行）规划中

规模化建议：
- > 50 实例：迁移至 PostgreSQL
- > 100 成员：拆分多团队部署