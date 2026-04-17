<h1 align="center" style="font-size: 64px;">ClawGate</h1>

<p align="center">
  <strong>OpenClaw 智能资源调度平台</strong><br/>
  多模型路由 · Agent 管理 · 工作流编排
</p>

<p align="center">
  <a href="./README.md">English</a> ·
  <a href="./architecture.md">架构文档</a> ·
  <a href="./docs/deployment/single-node.md">部署指南</a> ·
  <a href="./docs/progress/DONE.md">已完成功能</a> ·
  <a href="./docs/progress/NEXT.md">下一步计划</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/版本-v0.6-blue" />
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
- 🔁 **工作流编排** — 基于 DAG 的任务调度，支持 Cron 定时与 Webhook 外部触发，多节点并行执行与变量传递

> 零迁移成本。任何支持自定义 API Base URL 的工具（Cursor、LobeChat、OpenWebUI）均可直接接入。

---

## ⚡ 快速开始

**部署方式**: [单点部署](./docs/deployment/single-node.md)（裸机或 Docker）· [团队部署](./docs/deployment/team.md)（中央服务器 + 多成员）

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

纯 Docker 部署见 [单点部署指南](./docs/deployment/single-node.md)。

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
GET  /api/dags                 # DAG 工作流列表
POST /api/dags/:id/run         # 触发 DAG 执行
GET  /api/dag-runs/:runId      # 查询执行状态（含节点级状态）
POST /api/dags/:id/webhook     # 外部 Webhook 触发
GET  /api/health/overview      # 团队实例健康总览
GET  /api/alerts               # 告警历史
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
| v0.1 | ✅ | Agent 管理、Session 追踪、CLI、SQLite + Redis 分层存储 |
| v0.3 | ✅ | 四层路由引擎、OpenAI 兼容 API，L1–L4 全链路已验证 |
| v0.5 | ✅ | DAG 工作流（Wave 1-3）：多节点执行、Cron/Webhook 触发、变量传递、可视化编辑器 |
| v0.6 | ✅ | DAG 进阶：执行历史、条件分支节点、延迟节点、输出缓存（Redis opt-in，50KB 保护） |
| v1.0 | 🔜 | 团队部署（Phase 2 核心已完成）· 健康面板（Phase 3 进行中）· SDK · 自动更新 |

**v0.6 Wave 4 交付结果（2026-04-17）**：
- ✅ 15 场景集成测试套件（46/46 全部通过），覆盖条件+延迟组合场景
- ✅ 执行历史页面（列表 + 节点时间线详情）
- ✅ 条件分支节点（6 种运算符、true/false handle 路由、跳过逻辑）
- ✅ 延迟节点（0–3600s，0s 不阻塞）
- ✅ 节点输出缓存：SHA-256 key（变量替换后计算）、Redis 节点级 opt-in（`cacheTtl`）、50KB 保护、静默降级

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
