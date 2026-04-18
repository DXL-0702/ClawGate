<h1 align="center" style="font-size: 64px;">ClawGate</h1>

<p align="center">
  <strong>Intelligent Resource Scheduling Platform for OpenClaw</strong><br/>
  Multi-model routing · Agent management · Workflow orchestration
</p>

<p align="center">
  <a href="./README.zh-CN.md">中文文档</a> ·
  <a href="./architecture.md">Architecture</a> ·
  <a href="./docs/deployment/single-node.md">Deploy</a> ·
  <a href="./docs/progress/DONE.md">What's Built</a> ·
  <a href="./docs/progress/NEXT.md">What's Next</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-v0.6-blue" />
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
- 🔁 **Workflow orchestration** — DAG-based task scheduling with cron and webhook triggers, multi-node parallel execution with variable passing

> Zero migration required. Any tool that supports a custom API base URL (Cursor, LobeChat, OpenWebUI) works out of the box.

---

## ⚡ Quick Start

**Deploy Options**: [Single-node](./docs/deployment/single-node.md) (bare metal or Docker) · [Team](./docs/deployment/team.md) (central server + multi-member)

### Prerequisites

| Requirement | Version | Required For |
|-------------|---------|--------------|
| Docker & Compose | latest | **Recommended** — runs everything |
| Node.js | ≥ 18 | Source development only |
| Rust | ≥ 1.70 | Source development only |
| Python | ≥ 3.11 | Source development only |
| OpenClaw | installed at `~/.openclaw/` | Optional — enhances Agent/Session/DAG features |

> **Note**: ClawGate works out-of-the-box without OpenClaw. The core features (4-layer routing, OpenAI-compatible API, Stats Dashboard) are fully functional in **standalone mode**.

### Docker Experience (Recommended — 5 minutes)

```bash
mkdir clawgate && cd clawgate

# Download compose and env template
curl -O https://raw.githubusercontent.com/DXL-0702/ClawGate/main/docker-compose.prod.yml
curl -O https://raw.githubusercontent.com/DXL-0702/ClawGate/main/.env.example

# Optional: edit .env to add your ANTHROPIC_API_KEY / OPENAI_API_KEY
# (without keys, local Ollama models will be used)

docker compose -f docker-compose.prod.yml up -d

# Wait 5-10 minutes for Ollama models to download (one-time)
# Then open http://localhost:3000
```

**What's included**:
- Redis 7 (caching, session state)
- Qdrant (vector database for L2 semantic search)
- Ollama (local LLM — `qwen2.5:3b` for simple tasks, `nomic-embed-text` for embeddings)
- ClawGate 3-service stack (Node.js API + Rust Router + Python Intent)

### Source Development

```bash
git clone https://github.com/DXL-0702/ClawGate.git
cd ClawGate

pnpm install && pnpm build
docker compose up -d redis qdrant ollama
pnpm dev
```

### First Steps

```bash
# With OpenClaw installed (optional)
pnpm cli init          # auto-generate clawgate.yaml from ~/.openclaw
pnpm cli agents list   # discover OpenClaw Agent instances

# Always available (standalone mode)
curl http://localhost:3000/api/health          # check status
curl http://localhost:3000/api/stats/overview    # view routing stats
```

Point any OpenAI-compatible client at `http://localhost:3000/v1` — routing happens automatically.

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
GET  /api/health                      # service status + OpenClaw connection mode
GET  /api/stats/overview              # routing distribution, costs, trends, circuit status
GET  /api/agents                      # list all agents (requires OpenClaw)
GET  /api/sessions/:id                 # session details (requires OpenClaw)
GET  /api/route/stats                 # L1–L4 hit rates and latency
POST /api/route/feedback              # submit L4 feedback signal
GET  /api/dags                        # DAG workflow list
POST /api/dags/:id/run                # trigger DAG execution
GET  /api/dag-runs/:runId             # query run status (with node states)
POST /api/dags/:id/webhook            # external webhook trigger
GET  /api/health/overview             # team instance health summary
GET  /api/alerts                      # alert history

# Rust Router (internal, port 3001)
GET  /circuit/status                  # circuit breaker status for all providers
POST /circuit/report                  # report success/failure for a provider
POST /circuit/reset/:provider         # manually reset a provider's circuit
```

---

## 📦 Node.js SDK

For applications that want to embed ClawGate, the official SDK is available as `@clawgate/sdk` (zero runtime deps, 11 KB bundle):

```ts
import { ClawGate } from '@clawgate/sdk';

const gate = new ClawGate({ baseUrl: 'http://localhost:3000' });

// Routing decision (no model call)
const decision = await gate.route('write a sort algorithm');
// { model: 'qwen2.5:7b', layer: 'L2', cacheHit: false, latencyMs: 12 }

// OpenAI-compatible inference (streaming)
const stream = await gate.chat(
  [{ role: 'user', content: 'Explain quicksort' }],
  { stream: true },
);
for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0].delta.content ?? '');
}

// Team-mode ops (requires apiKey)
const ops = new ClawGate({ baseUrl: 'http://team:3000', apiKey: 'k-xxx' });
const { alerts } = await ops.listAlerts({ acknowledged: false });
const { runId } = await ops.triggerDag('dag-release');
const detail = await ops.getDagRun(runId);
```

**Methods (11)**: `route` · `stats` · `health` · `chat` (personal) · `listInstances` · `getInstanceLoad` · `listAlerts` · `ackAlert` · `triggerDag` · `getDagRun` · `triggerWebhook` (team).

**Errors**: `ClawGateError` / `ClawGateAuthError` (401/403) / `ClawGateBudgetError` (429 with `spentUsd` + `limitUsd`).

A Python SDK is planned next, using this one as the API contract reference.

---

## 📦 Project Structure

```
ClawGate/
├── packages/
│   ├── shared/          # shared TypeScript types
│   ├── core/            # config, gateway client, router client, DB
│   ├── server/          # Fastify API server (REST + WebSocket)
│   ├── web/              # React 18 + shadcn/ui dashboard
│   ├── sdk/              # @clawgate/sdk — official Node.js SDK (zero deps)
│   └── cli/              # Commander.js CLI
├── services/
│   ├── router-rust/     # L1 hash cache + circuit breaker (Axum/Tokio)
│   └── intent-python/   # L2/L3/L4 intent service (FastAPI + Qdrant)
├── proto/               # gRPC Protobuf definitions
├── docker-compose.yml              # dev: build from source
├── docker-compose.prod.yml         # prod: pull official images
├── .github/workflows/docker.yml    # CI: build & push to ghcr.io
├── .env.example                    # environment variables template
└── architecture.md                 # detailed system design
```

---

## 🗺️ Roadmap

| Milestone | Status | Highlights |
|-----------|--------|------------|
| MVP | ✅ | Monorepo, OpenClaw integration, Web UI skeleton |
| v0.1 | ✅ | Agent management, session tracking, CLI, SQLite + Redis layered storage |
| v0.3 | ✅ | 4-layer routing engine, OpenAI-compatible API, L1–L4 fully validated |
| v0.5 | ✅ | DAG workflow (Wave 1-3): multi-node execution, cron/webhook triggers, variable passing, visual editor |
| v0.6 | ✅ | DAG advanced: run history, condition branch, delay node, output cache (Redis opt-in, 50KB guard) |
| v1.0 Phase 1 | ✅ | Rust circuit breaker · Streaming + Failover + cost tracking · Stats Dashboard · Docker release |
| v1.0 Phase 2-3 | ✅ | Team deployment · Health overview · Auto-offline alerts |
| v1.0 Phase 4 | 🔄 | **Node.js SDK ✅** · Python SDK · Watchtower auto-update · Issue 6 dual-mode auth |

**v0.6 Wave 4 Delivery (2026-04-17)**:
- ✅ 15-scenario integration test suite (46/46 passing), covering condition+delay combinations
- ✅ Run history pages (list + node timeline detail)
- ✅ Condition branch node (6 operators, true/false handle routing, skip logic)
- ✅ Delay node (0–3600s, non-blocking at 0s)
- ✅ Node output cache: SHA-256 key (post-substitution), Redis opt-in per node (`cacheTtl`), 50KB guard, silent fallback

**v1.0 Phase 1 Delivery (2026-04-18)**:
- ✅ Rust circuit breaker with 3-state machine (Closed/Open/HalfOpen) and REST API
- ✅ SSE Streaming for all 3 providers (Anthropic/OpenAI/Ollama) with failover
- ✅ Automatic cost tracking (Redis real-time + SQLite daily aggregation)
- ✅ Stats Dashboard with Recharts (routing distribution, cost trend, model usage, circuit status)
- ✅ Docker multi-service release (`ghcr.io/dxl-0702/clawgate-{router,intent,server}:latest`)
- ✅ OpenClaw optional mode — core routing works without OpenClaw installed

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
