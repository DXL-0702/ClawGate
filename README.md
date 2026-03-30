# ClawGate

[中文文档](./README.zh-CN.md)

> **Intelligent Resource Scheduling Platform for OpenClaw**

ClawGate is a comprehensive resource scheduling platform designed for [OpenClaw](https://github.com/openclaw), providing intelligent routing, multi-agent management, and workflow orchestration capabilities.

---

## 🌟 Core Features

### 1. Multi-Agent Management
- Real-time monitoring of multiple OpenClaw Agent instances
- Session visualization console with live event streaming
- Token usage tracking and cost estimation

### 2. Intelligent Routing Engine (4-Layer Architecture)
- **L1**: Hash-based exact match cache (Rust, <1ms)
- **L2**: Semantic vector search (Python + Qdrant, 10-30ms)
- **L3**: Sentinel model classification (Ollama, 200-500ms)
- **L4**: Feedback loop for continuous optimization

### 3. Workflow Orchestration (Coming in v0.5)
- DAG-based task scheduling
- Support for cron, event, and webhook triggers
- Visual workflow editor

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Rust 1.70+
- Python 3.11+
- Docker & Docker Compose
- OpenClaw installed at `~/.openclaw/`

### Installation

```bash
# Clone repository
git clone https://github.com/yourusername/ClawGate.git
cd ClawGate

# Install Node.js dependencies
pnpm install

# Build all packages
pnpm build

# Start infrastructure services
docker compose up -d

# Start development servers
pnpm dev
```

### First Run

```bash
# Initialize configuration
pnpm cli init

# Check status
pnpm cli status

# List discovered agents
pnpm cli agents list
```

Access the Web UI at: http://localhost:5173

---

## 📦 Project Structure

```
ClawGate/
├── packages/
│   ├── shared/      # Shared TypeScript types
│   ├── core/        # Core business logic
│   ├── server/      # Fastify API server
│   ├── web/         # React Web UI
│   └── cli/         # Command-line interface
├── services/
│   ├── router-rust/       # Rust routing layer (L1 cache)
│   └── intent-python/     # Python intent service (L2/L3/L4)
└── docker-compose.yml     # Infrastructure services
```

---

## 🛠️ Development

### Run Tests

```bash
# Node.js tests
pnpm test

# Rust tests
cd services/router-rust && cargo test

# Python tests
cd services/intent-python && pytest
```

### Build for Production

```bash
pnpm build
```

---

## 📊 Architecture

See [architecture.md](./architecture.md) for detailed system architecture and design decisions.

---

## 🗺️ Roadmap

- [x] **MVP**: Core infrastructure and OpenClaw integration
- [x] **v0.1**: Agent management and session tracking
- [x] **v0.3**: Intelligent routing engine (L1-L4)
- [ ] **v0.5**: DAG workflow orchestration
- [ ] **v1.0**: Production-ready with SDK support

---

## 📄 License

MIT License - see [LICENSE](./LICENSE) for details

---

## 🤝 Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

---

## 📮 Contact

- Issues: [GitHub Issues](https://github.com/yourusername/ClawGate/issues)
- Discussions: [GitHub Discussions](https://github.com/yourusername/ClawGate/discussions)

---

**Built with ❤️ for the OpenClaw community**
