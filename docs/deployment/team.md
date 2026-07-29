# 团队模式运行基线

团队模式的目标是让一台中央 ClawGate 服务发现并调度多个成员机器上的 OpenClaw Gateway。当前代码已经有团队、成员、实例、心跳、负载、告警和跨实例 DAG 的 API 骨架，也有对应 Web 页面；但认证隔离、Gateway 兼容、心跳代理和数据持久化尚未闭环。

**结论：当前团队模式只适合隔离网络中的开发验证，不适合公网或生产部署。**

## 1. 实际拓扑

```text
                         HTTP REST / Web UI
管理员与成员  -------------------------------------->  ClawGate Server :3000
                                                           |
                                                           | HTTP
                                      +--------------------+------------------+
                                      |                    |                  |
                                      v                    v                  v
                                Router :3001          Intent :8000      Redis / SQLite
                                                           |
                                                   Qdrant / Ollama

ClawGate Server  --------------------- WebSocket ---------------------> 成员 OpenClaw Gateway
                         中央服务主动连接成员登记的 gatewayUrl
```

关键边界：

- 成员实例不是通过长连接接入 ClawGate；它先用 HTTP 注册 `gatewayUrl` 与 token，中央 Server 再主动建立 WebSocket。
- 仓库没有成员侧 daemon 或 CLI 心跳进程。注册响应要求每 10 秒心跳，但当前必须由外部程序自行上报。
- Gateway token 当前明文写入 SQLite。
- 跨进程协议是 HTTP REST；Proto 没有接入。

## 2. 已实现能力与成熟度

| 能力域 | 当前实现 | 已知限制 |
|---|---|---|
| 团队与成员 | 创建团队、添加/列出/删除成员、API Key 鉴权 | Key 用 `Math.random()` 生成并明文存储；无轮换、过期和撤销模型 |
| 实例 | 注册、重注册、心跳、列表、详情、负载、删除 | 心跳不验证实例归属；按 environment 过滤会覆盖团队条件 |
| GatewayPool | 按在线状态和负载选择实例，复用进程内连接 | 不是 LRU；断线检查、并发建连和跨团队强制选择存在缺口 |
| DAG | manual/cron/webhook、拓扑批次、条件、延迟、团队实例选择 | 当前 OpenClaw RPC/event contract 不兼容，真实 Agent 节点 E2E 未通过 |
| 健康与告警 | 每分钟健康检查、offline 告警、确认 API | 只有 offline 告警真正产生；趋势使用最新快照，不是历史时序数据 |
| Web UI | 团队、实例、DAG、健康和告警页面 | 部分实时事件未认证、未按团队分区 |

## 3. 为什么不能直接公网部署

当前存在以下高优先级风险：

1. 未提供 `X-API-Key` 时，通用鉴权会进入个人模式；部分 DAG、Run 和实例详情路由只在团队模式检查归属，知道资源 UUID 即可能绕过团队隔离。
2. Server 固定监听 `0.0.0.0:3000`，CORS 接受任意 Origin，路由、OpenAI、Agent、Session、Stats 和 `/ws/events` 等接口没有统一认证。
3. `POST /api/instances/:id/heartbeat` 没有验证调用者与目标实例是否属于同一团队。
4. `GET /api/instances?environment=...` 的第二次 Drizzle `.where()` 会覆盖原团队条件，可能返回其他团队实例。
5. OpenClaw restart/upgrade 比较 `X-Admin-Token` 与 `CLAWGATE_ADMIN_TOKEN`；两者都未设置时存在 `undefined === undefined` 放行路径。团队 Compose 配置的 `ADMIN_API_KEY` 完全未被该代码读取。
6. 成员 API Key 和 Gateway token 均以明文存储；API Key 没有可靠随机源、哈希、轮换与撤销机制。
7. `/ws/events` 当前是全局广播，没有认证、团队分区、背压或稳定的异常隔离。
8. 当前 Gateway adapter 与 OpenClaw 2026.4.14 的 `payload`、`message` 和事件完成语义不兼容。

反向代理和 VPN 可以缩小暴露面，但不能修复资源归属判断和凭据存储问题。

## 4. 中央服务的当前启动方式

团队 Compose 可以作为集成环境模板：

```bash
docker compose -f docker-compose.team.yml config --quiet
docker compose -f docker-compose.team.yml up -d
docker compose -f docker-compose.team.yml ps
```

本轮只验证了 Compose 配置可以解析，没有验证远程 `latest` 镜像、全栈冷启动或真实成员 Gateway。

### Compose 变量实情

| 变量 | 当前作用 |
|---|---|
| `CLAWGATE_PORT` | 只控制宿主机端口映射，容器内 Server 固定 3000 |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | Server Provider 使用 |
| `SIMPLE_MODEL` / `COMPLEX_MODEL` | Router 与 Intent 使用 |
| `ADMIN_API_KEY` | Compose 会传入，但 Server 不读取 |
| `CLAWGATE_ADMIN_TOKEN` | 生命周期路由实际读取，但团队 Compose 目前未传入 |
| `CLAWGATE_DB_PATH` | Server/Core 当前不读取 |

此外，Compose 的 `/app/data` volume 未接入实际 SQLite 路径；干净数据库的 `cron_timezone` 建表遗漏已通过临时空库复现。不要按当前 volume 声明设计备份策略。

## 5. API 联调流程

以下命令仅用于隔离开发环境，并描述当前 API 合约，不代表生产安全方案。

### 5.1 创建团队

```bash
curl -X POST http://127.0.0.1:3000/api/teams \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Engineering",
    "slug": "engineering",
    "ownerEmail": "lead@example.com",
    "ownerName": "Lead"
  }'
```

响应中的 `owner.apiKey` 是后续管理 API 使用的团队成员 Key。当前实现还会通过 `/api/members/me` 再次返回该 Key，因此“仅显示一次”的响应文案与实际行为不一致。

### 5.2 添加成员

```bash
curl -X POST http://127.0.0.1:3000/api/members \
  -H 'X-API-Key: OWNER_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "dev@example.com",
    "name": "Developer",
    "role": "member"
  }'
```

保存响应中的 `member.apiKey`。

### 5.3 注册成员 Gateway

中央 Server 必须能够主动访问 `gatewayUrl`。不要使用只能从成员本机访问的 `127.0.0.1`。

```bash
curl -X POST http://127.0.0.1:3000/api/instances/register \
  -H 'X-API-Key: MEMBER_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "dev-machine-01",
    "gatewayUrl": "ws://10.0.0.21:18789",
    "gatewayToken": "development-token",
    "environment": "development",
    "tags": ["workflow-lab"]
  }'
```

响应会返回 `instanceId` 和 `heartbeatIntervalSec: 10`。

### 5.4 上报心跳

```bash
curl -X POST http://127.0.0.1:3000/api/instances/INSTANCE_ID/heartbeat \
  -H 'X-API-Key: MEMBER_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "version": "2026.4.14",
    "platform": "darwin-arm64",
    "activeSessions": 0,
    "queuedTasks": 0,
    "cpuUsage": 5,
    "memoryUsage": 512,
    "gatewayHealthy": true
  }'
```

负载写入 Redis，TTL 为 20 秒。仓库没有自动上报程序；停止心跳后实例会失去负载快照，并在健康检查中被标记为离线。

### 5.5 查询团队状态

```bash
curl http://127.0.0.1:3000/api/instances \
  -H 'X-API-Key: MEMBER_API_KEY'

curl http://127.0.0.1:3000/api/health/overview \
  -H 'X-API-Key: MEMBER_API_KEY'

curl http://127.0.0.1:3000/api/alerts \
  -H 'X-API-Key: MEMBER_API_KEY'
```

不要使用 `environment` 查询参数评估租户隔离，相关条件覆盖问题尚未修复。

## 6. DAG 团队调度边界

团队 Key 可以创建与触发 DAG；Worker 会通过 GatewayPool 选择团队实例。DAG 的拓扑、变量替换、并行批次、条件节点和延迟节点已有 Core 自动化测试，但真实团队执行仍同时受以下问题阻塞：

- Gateway RPC 响应按 `result` 解析，而当前 OpenClaw 使用 `payload`。
- `sessions.send` 发送 `content`，当前 OpenClaw 要求 `message`。
- 执行器等待不存在的 `session.end`，且事件监听注册晚于发送动作。
- Cron Worker 创建的 Run 没有稳定写入团队归属。
- 强制指定实例时，GatewayPool 没有验证该实例属于请求团队。

因此不要把“Run 已进入 BullMQ”解释为“任务已在成员 Agent 上成功执行”。

## 7. 数据与运维现状

| 领域 | 当前状态 |
|---|---|
| SQLite 备份 | 容器路径未形成稳定契约，暂不提供正式备份命令 |
| Redis 持久化 | Compose 开启 AOF，但热数据到 SQLite 的归档 Worker 未由 Server 启动 |
| 告警 | 健康 Worker只创建 offline 告警，无通知 Webhook |
| 趋势 | 读取 TTL 20 秒的最新负载，不能形成真实 1 小时时序 |
| 日志与审计 | 没有成员操作审计或管理员安全审计 |
| 凭据 | 无加密、哈希、轮换和撤销闭环 |

## 8. 生产化验收条件

团队部署至少需要满足以下条件后，才能升级为生产部署文档：

1. 统一认证中间件，所有资源查询和变更都强制校验 `teamId`、`memberId` 与角色。
2. 使用密码学安全随机源生成 Key，只保存哈希，并实现轮换、撤销和审计。
3. 加密保存 Gateway token，建立成员侧注册与心跳 agent。
4. 修复 OpenClaw 当前协议并完成单实例、跨实例、断线恢复的真实 E2E。
5. 修复干净数据库迁移、明确 `CLAWGATE_DB_PATH`，完成备份恢复演练。
6. 启动并重构 Redis 归档为可恢复的 at-least-once 流程。
7. 为 WebSocket 加认证、团队分区、背压和 `wss://` 支持。
8. 增加 Server 路由、认证、Docker、Python 和跨服务集成测试，再设置可执行的 CI 门禁。

修复顺序见 `docs/progress/NEXT.md`。
