<p align="center">
  <img src="./docs/assets/logo.png" alt="ClawGate" width="120" />
</p>

<h1 align="center">ClawGate</h1>

<p align="center">
  <strong>OpenClaw 智能资源调度平台</strong><br/>
  多模型路由 · Agent 管理 · 工作流编排
</p>

<p align="center">
  <a href="./README.md">English</a> ·
  <a href="./architecture.md">架构文档</a> ·
  <a href="./docs/progress/DONE.md">已完成功能</a> ·
  <a href="./docs/progress/NEXT.md">下一步计划</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/版本-v0.3-blue" />
  <img src="https://img.shields.io/badge/许可证-MIT-green" />
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" />
  <img src="https://img.shields.io/badge/rust-1.70%2B-orange" />
  <img src="https://img.shields.io/badge/python-3.11%2B-yellow" />
</p>

---

## ClawGate 是什么？

ClawGate 是 [OpenClaw](https://github.com/openclaw)（本地 AI Agent 运行时）的**基础设施增强层**。将 API Base URL 指向 ClawGate，即可立即获得：

- 🧠 **智能路由** — 四层引擎（Hash 缓存 → 向量检索 → 哨兵模型 → 反馈闭环）自动为每个请求调度最优模型
- 📊 **Agent 管理** — 跨所有 OpenClaw 实例的实时监控、Session 控制与 Token 成本追踪
- 🔁 **工作流编排** — 基于 DAG 的任务调度，支持 cron、事件、Webhook 触发 *(v0.5 即将推出)*

> 零迁移成本。任何支持自定义 API Base URL 的工具（Cursor、LobeChat、OpenWebUI）均可直接接入。

---

## ⚡ 快速开始

### 前置要求

| 依赖 | 版本 |
|------|------|
| Node.js | ≥ 18 |
| Rust | ≥ 1.70 |
| Python | ≥ 3.11 |
| Docker & Compose | 最新版 |
| OpenClaw | 已安装于 `~/.openclaw/` |

### 安装与启动

```bash
git clone https://github.com/DXL_0702/ClawGate.git
cd ClawGate

pnpm install        # 安装 Node.js 依赖
pnpm build          # 构建所有包

docker compose up -d   # 启动 Redis、Qdrant、Ollama

pnpm dev            # 启动所有服务
```

### 首次使用

```bash
pnpm cli init          # 从 ~/.openclaw 自动生成 clawgate.yaml
pnpm cli status        # 查看路由命中率、成本汇总、Agent 健康状态
pnpm cli agents list   # 发现所有 OpenClaw Agent 实例
```

将任意 OpenAI 兼容客户端的 Base URL 指向 `http://localhost:3000/v1`，路由自动生效。

---

## 🧠 路由引擎

ClawGate 的核心是**四层路由流水线**，为每个请求选择最优模型：

```
用户输入
    │
    ▼  ─────────────────────────────────────────
    │  L1  Hash 缓存          Rust    < 1ms    │  ~30% 请求
    │  ─────────────────────────────────────────│
    │  L2  向量语义检索        Python  10-30ms  │  ~55% 请求
    │  ─────────────────────────────────────────│
    │  L3  哨兵模型分类        Ollama  200-500ms│  ~15% 请求
    │  ─────────────────────────────────────────│
    │  L4  反馈闭环            异步    0ms      │  100%（后台）
    └──────────────────────────────────────────
```

| 层级 | 技术 | 延迟 | 职责 |
|------|------|------|------|
| L1 | Rust + Redis | < 1ms | SHA-256 精确匹配缓存 |
| L2 | Python + Qdrant | 10–30ms | Embedding 相似度，Top-3 投票 |
| L3 | Ollama qwen2.5:3b | 200–500ms | Few-Shot 哨兵分类 |
| L4 | 异步写入 | 非阻塞 | 反馈 → 向量库持续进化 |

---

## 📡 API

ClawGate 暴露完整的 **OpenAI 兼容**端点：

```
POST http://localhost:3000/v1/chat/completions
```

Provider 根据路由决策自动分发：

| 模型前缀 | Provider |
|---------|----------|
| `claude-*` | Anthropic |
| `gpt-*` | OpenAI |
| 其他 | Ollama（本地） |

扩展端点：

```
GET  /api/health
GET  /api/agents
GET  /api/sessions/:id
GET  /api/route/stats          # L1–L4 各层命中率与延迟
POST /api/route/feedback       # 提交 L4 反馈信号
```

---

## 📦 项目结构

```
ClawGate/
├── packages/
│   ├── shared/          # 共享 TypeScript 类型
│   ├── core/            # 配置、Gateway 客户端、路由客户端、数据库
│   ├── server/          # Fastify API 服务（REST + WebSocket）
│   ├── web/             # React 18 + shadcn/ui 控制台
│   └── cli/             # Commander.js CLI
├── services/
│   ├── router-rust/     # L1 Hash 缓存 + 规则引擎（Axum/Tokio）
│   └── intent-python/   # L2/L3/L4 意图服务（FastAPI + Qdrant）
├── proto/               # gRPC Protobuf 定义
├── docker-compose.yml
└── architecture.md      # 详细系统架构设计
```

---

## 🗺️ 开发路线图

| 里程碑 | 状态 | 核心内容 |
|--------|------|----------|
| MVP | ✅ | Monorepo、OpenClaw 集成、Web UI 骨架 |
| v0.1 | ✅ | Agent 管理、Session 追踪、CLI、SQLite |
| v0.3 | ✅ | 四层路由引擎、OpenAI 兼容 API（L1 已验证，L2/L3 代码就绪） |
| v0.5 | 🔧 | DAG 工作流（Wave 1-2 完成）· Web 端 OpenClaw 重启/升级（Wave 2.5）· 多节点 DAG（Wave 3） |
| v1.0 | 🔜 | 团队部署（中央服务器 + 多成员接入）· 多实例运维 · SDK · 自动更新（Watchtower） |

**v0.3 端到端验证结果（2026-04-15）**：
- ✅ L1 Hash 缓存：命中率 100%，延迟 5s → 2ms
- ✅ OpenAI 兼容端点 `/v1/chat/completions`
- ✅ 服务启动链路：Rust (3001) + Python (8000) + Node.js (3000)
- ⚠️ L2/L3 深度验证：被 L1 快速路径拦截，代码就绪，推迟至 v0.5
- 🔜 L4 反馈接口：Node.js 端点未实现

---

## 🛠️ 开发

```bash
pnpm test                              # vitest（Node.js 包）
cd services/router-rust && cargo test  # Rust 单元测试
cd services/intent-python && pytest    # Python 单元测试

pnpm build                             # 全量 Monorepo 构建
```

---

## 🤝 参与贡献

欢迎贡献。开始前请：

1. 查看[已完成功能](./docs/progress/DONE.md)了解当前状态
2. 查看[下一步计划](./docs/progress/NEXT.md)了解待开发内容与技术思路
3. 提 Issue 讨论你的改动方案，再提交 PR

---

## 📄 许可证

MIT — 详见 [LICENSE](./LICENSE)

---

<p align="center">为 OpenClaw 社区而构建</p>
