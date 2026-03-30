# ClawGate

[English Documentation](./README.md)

> **OpenClaw 智能资源调度平台**

ClawGate 是为 [OpenClaw](https://github.com/openclaw) 设计的综合资源调度平台，提供智能路由、多 Agent 管理和工作流编排能力。

---

## 🌟 核心功能

### 1. 多 Agent 管理
- 多个 OpenClaw Agent 实例实时监控
- Session 可视化控制台，支持实时事件流
- Token 用量追踪与成本估算

### 2. 智能路由引擎（四层架构）
- **L1**：Hash 精确匹配缓存（Rust，<1ms）
- **L2**：语义向量检索（Python + Qdrant，10-30ms）
- **L3**：哨兵模型分类（Ollama，200-500ms）
- **L4**：反馈闭环持续优化

### 3. 工作流编排（v0.5 即将推出）
- 基于 DAG 的任务调度
- 支持 cron、事件、Webhook 触发
- 可视化工作流编辑器

---

## 🚀 快速开始

### 前置要求

- Node.js 18+
- Rust 1.70+
- Python 3.11+
- Docker & Docker Compose
- OpenClaw 已安装于 `~/.openclaw/`

### 安装

```bash
# 克隆仓库
git clone https://github.com/yourusername/ClawGate.git
cd ClawGate

# 安装 Node.js 依赖
pnpm install

# 构建所有包
pnpm build

# 启动基础设施服务
docker compose up -d

# 启动开发服务器
pnpm dev
```

### 首次运行

```bash
# 初始化配置
pnpm cli init

# 检查状态
pnpm cli status

# 列出已发现的 Agent
pnpm cli agents list
```

访问 Web UI：http://localhost:5173

---

## 📦 项目结构

```
ClawGate/
├── packages/
│   ├── shared/      # 共享 TypeScript 类型
│   ├── core/        # 核心业务逻辑
│   ├── server/      # Fastify API 服务器
│   ├── web/         # React Web UI
│   └── cli/         # 命令行工具
├── services/
│   ├── router-rust/       # Rust 路由层（L1 缓存）
│   └── intent-python/     # Python 意图服务（L2/L3/L4）
└── docker-compose.yml     # 基础设施服务
```

---

## 🛠️ 开发

### 运行测试

```bash
# Node.js 测试
pnpm test

# Rust 测试
cd services/router-rust && cargo test

# Python 测试
cd services/intent-python && pytest
```

### 生产构建

```bash
pnpm build
```

---

## 📊 架构

详细的系统架构和设计决策请参阅 [architecture.md](./architecture.md)。

---

## 🗺️ 开发路线图

- [x] **MVP**：核心基础设施与 OpenClaw 集成
- [x] **v0.1**：Agent 管理与 Session 追踪
- [x] **v0.3**：智能路由引擎（L1-L4）
- [ ] **v0.5**：DAG 工作流编排
- [ ] **v1.0**：生产就绪，支持 SDK

---

## 📄 许可证

MIT License - 详见 [LICENSE](./LICENSE)

---

## 🤝 贡献

欢迎贡献！请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md) 了解贡献指南。

---

## 📮 联系方式

- 问题反馈：[GitHub Issues](https://github.com/yourusername/ClawGate/issues)
- 讨论交流：[GitHub Discussions](https://github.com/yourusername/ClawGate/discussions)

---

**用 ❤️ 为 OpenClaw 社区构建**
