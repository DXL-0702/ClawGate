<p align="center">
  <img src="./docs/assets/logo.png" alt="ClawGate" width="120" />
</p>

<h1 align="center">ClawGate</h1>

<p align="center">
  <strong>Intelligent Resource Scheduling Platform for OpenClaw</strong><br/>
  Multi-model routing · Agent management · Workflow orchestration
</p>

<p align="center">
  <a href="./README.zh-CN.md">中文文档</a> ·
  <a href="./architecture.md">Architecture</a> ·
  <a href="./docs/progress/DONE.md">What's Built</a> ·
  <a href="./docs/progress/NEXT.md">What's Next</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-v0.3-blue" />
  <img src="https://img.shields.io/badge/license-MIT-green" />
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" />
  <img src="https://img.shields.io/badge/rust-1.70%2B-orange" />
  <img src="https://img.shields.io/badge/python-3.11%2B-yellow" />
</p>

---

## What is ClawGate?

ClawGate is an **infrastructure enhancement layer** for [OpenClaw](https://github.com/openclaw) — the local AI Agent runtime. Point your API base URL at ClawGate and instantly gain:

- 🧠 **Intelligent routing** — 4-layer engine (hash cache → vector search → sentinel model → feedback loop) automatically dispatches each request to the optimal model
- 📊 **Agent management** — real-time monitoring, session control, and token cost tracking across all OpenClaw instances
- 🔁 **Workflow orchestration** — DAG-based task scheduling with cron, event, and webhook triggers *(coming in v0.5)*

> Zero migration required. Any tool that supports a custom API base URL (Cursor, LobeChat, OpenWebUI) works out of the box.

---

## ⚡ Quick Start

### Prerequisites

| Requirement | Version |
|-------------|---------|
| Node.js | ≥ 18 |
| Rust | ≥ 1.70 |
| Python | ≥ 3.11 |
| Docker & Compose | latest |
| OpenClaw | installed at `~/.openclaw/` |

### Install & Run

```bash
git clone https://github.com/DXL_0702/ClawGate.git
cd ClawGate

pnpm install        # install Node.js dependencies
pnpm build          # build all packages

docker compose up -d   # start Redis, Qdrant, Ollama

pnpm dev            # start all services
```

### First Steps

```bash
pnpm cli init          # auto-generate clawgate.yaml from ~/.openclaw
pnpm cli status        # routing hit rates, cost summary, agent health
pnpm cli agents list   # discover all OpenClaw Agent instances
```

Then point any OpenAI-compatible client at `http://localhost:3000/v1` — routing happens automatically.

---

## 🧠 Routing Engine

The core of ClawGate is a **4-layer routing pipeline** that selects the optimal model for each request:

```
User Prompt
    │
    ▼  ─────────────────────────────────────────
    │  L1  Hash Cache          Rust    < 1ms    │  ~30% of queries
    │  ─────────────────────────────────────────│
    │  L2  Vector Search       Python  10-30ms  │  ~55% of queries
    │  ─────────────────────────────────────────│
    │  L3  Sentinel Model      Ollama  200-500ms│  ~15% of queries
    │  ─────────────────────────────────────────│
    │  L4  Feedback Loop       Async   0ms      │  100% (background)
    └──────────────────────────────────────────
```

| Layer | Tech | Latency | Role |
|-------|------|---------|------|
| L1 | Rust + Redis | < 1ms | SHA-256 exact match cache |
| L2 | Python + Qdrant | 10–30ms | Embedding similarity, Top-3 vote |
| L3 | Ollama qwen2.5:3b | 200–500ms | Few-shot sentinel classification |
| L4 | Async write | non-blocking | Feedback → vector DB evolution |

---

## 📡 API

ClawGate exposes a fully **OpenAI-compatible** endpoint:

```
POST http://localhost:3000/v1/chat/completions
```

Provider dispatch is automatic based on the routing decision:

| Model prefix | Provider |
|---|---|
| `claude-*` | Anthropic |
| `gpt-*` | OpenAI |
| anything else | Ollama (local) |

Additional endpoints:

```
GET  /api/health
GET  /api/agents
GET  /api/sessions/:id
GET  /api/route/stats          # L1–L4 hit rates and latency
POST /api/route/feedback       # submit L4 feedback signal
```

---

## 📦 Project Structure

```
ClawGate/
├── packages/
│   ├── shared/          # shared TypeScript types
│   ├── core/            # config, gateway client, router client, DB
│   ├── server/          # Fastify API server (REST + WebSocket)
│   ├── web/             # React 18 + shadcn/ui dashboard
│   └── cli/             # Commander.js CLI
├── services/
│   ├── router-rust/     # L1 hash cache + rule engine (Axum/Tokio)
│   └── intent-python/   # L2/L3/L4 intent service (FastAPI + Qdrant)
├── proto/               # gRPC Protobuf definitions
├── docker-compose.yml
└── architecture.md      # detailed system design
```

---

## 🗺️ Roadmap

| Milestone | Status | Highlights |
|-----------|--------|------------|
| MVP | ✅ | Monorepo, OpenClaw integration, Web UI skeleton |
| v0.1 | ✅ | Agent management, session tracking, CLI, SQLite |
| v0.3 | ✅ | 4-layer routing engine, OpenAI-compatible API (L1 verified, L2/L3 code-ready) |
| v0.5 | 🔧 | DAG workflow (Wave 1-2 done) · OpenClaw restart/upgrade via Web UI (Wave 2.5) · Multi-node DAG (Wave 3) |
| v1.0 | 🔜 | Team deployment (central server + multi-member) · Multi-instance ops · SDK · Auto-update (Watchtower) |

**v0.3 End-to-End Validation (2026-04-15)**:
- ✅ L1 Hash cache: 100% hit rate, latency 5s → 2ms
- ✅ OpenAI-compatible endpoint `/v1/chat/completions`
- ✅ Service startup chain: Rust (3001) + Python (8000) + Node.js (3000)
- ⚠️ L2/L3 code ready but bypassed by L1 fast path, deferred to v0.5
- 🔜 L4 feedback API: Node.js endpoint pending implementation

---

## 🛠️ Development

```bash
pnpm test                              # vitest (Node.js packages)
cd services/router-rust && cargo test  # Rust unit tests
cd services/intent-python && pytest    # Python unit tests

pnpm build                             # full monorepo build
```

---

## 🤝 Contributing

Contributions are welcome. Before starting:

1. Check [What's Built](./docs/progress/DONE.md) to understand the current state
2. Check [What's Next](./docs/progress/NEXT.md) for planned work and technical approach
3. Open an issue to discuss your proposed change before submitting a PR

---

## 📄 License

MIT — see [LICENSE](./LICENSE)

---

<p align="center">Built for the OpenClaw community</p>
