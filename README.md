<h1 align="center">ClawGate</h1>

<p align="center">
  <strong>Infrastructure and orchestration layer for OpenClaw</strong><br/>
  Model routing · Agent and session visibility · DAG workflows · Team instance operations
</p>

<p align="center">
  <a href="./README.zh-CN.md">中文</a> ·
  <a href="./architecture.md">Architecture</a> ·
  <a href="./docs/deployment/single-node.md">Single-node deployment</a> ·
  <a href="./docs/deployment/team.md">Team deployment</a> ·
  <a href="./docs/progress/DONE.md">Implemented</a> ·
  <a href="./docs/progress/NEXT.md">Next</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.1.0-blue" alt="version 0.1.0" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT license" />
  <img src="https://img.shields.io/badge/Node.js-%3E%3D20-brightgreen" alt="Node.js 20 or newer" />
  <img src="https://img.shields.io/badge/Rust-1.83-orange" alt="Rust 1.83 Docker build baseline" />
  <img src="https://img.shields.io/badge/Python-3.11%2B-yellow" alt="Python 3.11 or newer" />
</p>

## What ClawGate Is

ClawGate is an infrastructure enhancement layer around [OpenClaw](https://github.com/openclaw/openclaw). It does not replace the OpenClaw Gateway. It adds a control surface for choosing model providers, observing OpenClaw agents and sessions, executing multi-step workflows, and coordinating multiple registered instances.

The project is built around four ideas:

- Route requests progressively: exact cache first, semantic intent next, then a conservative fallback.
- Keep OpenClaw integration optional: routing and the dashboard can start without a reachable Gateway; Agent, Session, and Gateway-backed DAG capabilities require it.
- Put orchestration state in explicit stores: SQLite for structured records, Redis for hot state and queues, and Qdrant for semantic examples.
- Expose operations through one Node.js API and dashboard while keeping routing and intent classification in focused Rust and Python services.

ClawGate is currently an early-stage `0.1.0` project. The repository contains substantial implemented functionality, but it has not completed production hardening or a real OpenClaw Gateway end-to-end release qualification.

## System Architecture

```text
Browser / CLI / OpenAI-style client
                 |
                 v
      Node.js API and control plane :3000
      Fastify + REST + WebSocket + BullMQ
          |             |              |
          | HTTP        | providers    | WebSocket
          v             v              v
   Rust router :3001  Anthropic /    OpenClaw Gateway
   L1 + fallback +    OpenAI /       (optional)
   circuit state      Ollama
          |
          | HTTP
          v
   Python intent :8000
   L2 semantic + L3 classifier + L4 feedback

SQLite: durable application records
Redis: hot state, costs, route logs, node cache, BullMQ
Qdrant: semantic routing examples
```

Runtime communication between ClawGate services is HTTP/REST. Files under `proto/` are design artifacts and are not wired into the current runtime.

| Area | Current implementation |
| --- | --- |
| API and control plane | Node.js, TypeScript, Fastify 5, WebSocket, BullMQ, Drizzle, SQLite, Redis |
| Router | Rust, Axum, Tokio, Redis hash cache, fallback rules, in-memory provider circuit state |
| Intent service | Python, FastAPI, Ollama embeddings, Qdrant, rule/LR/conservative classification, explicit feedback endpoint |
| Web application | React 19, Vite 6, Tailwind CSS 4, Zustand, TanStack Query, React Flow, Recharts |
| CLI | Commander.js commands for configuration, discovery, sessions, status, and OpenClaw lifecycle operations |
| Integration protocols | REST between services; WebSocket to OpenClaw and for browser events |

See [architecture.md](./architecture.md) for module ownership, data flow, and deployment topology.

## Capability Status

"Implemented" below means the behavior exists in source at `HEAD` (`7820640`, Phase D). It does not mean every path has passed a fresh real-Gateway end-to-end test.

| Capability | Status | Current scope |
| --- | --- | --- |
| Progressive model routing | Source implemented | Rust L1 exact cache, Python L2 semantic lookup, Python L3 rules/optional LR/conservative fallback, explicit L4 feedback |
| OpenAI-style chat endpoint | Implemented subset | `POST /v1/chat/completions`; non-streaming supports candidate failover, streaming uses one selected provider, and both paths record cost |
| Provider protection | Implemented with limits | Anthropic, OpenAI, and Ollama dispatch plus circuit reporting; circuit state is process-local |
| Agent and Session visibility | Adapter present; compatibility blocked | Local discovery exists, but the current RPC payload and event contract is incompatible with the audited OpenClaw 2026.4.14 runtime |
| DAG workflows | Engine implemented; live Gateway blocked | Topology, variables, conditions, delays, history, cache, and triggers exist; real Agent-node E2E is blocked by the Gateway contract |
| Phase D trigger reliability | Code in HEAD; runtime qualification pending | Cron timezone, scheduler restoration/cleanup, Webhook payload access, and substitution exist; migration and external E2E remain open |
| Team instance management | Implemented foundation | Teams, members, instance registration and heartbeat, health overview, and offline alerts |
| Operations dashboard | Implemented | Routing, costs, DAGs, instances, health, and alert views; some real-time and localization paths remain incomplete |
| Proto definitions | Not integrated | Definitions exist, but production runtime calls use REST |

The current uncommitted workspace also contains Phase F work that is still under development and has not been promoted into the verified baseline:

- F1: DAG JSON import and export.
- F2: Dashboard OpenClaw status, npm-registry version checks, and copyable operational command suggestions. The dashboard does not directly perform restart or upgrade operations in this work.
- F3: A live Gateway event panel and WebSocket broadcast stability changes.

For a finer progress breakdown, read [DONE.md](./docs/progress/DONE.md) and [NEXT.md](./docs/progress/NEXT.md).

## Quick Start

### Docker from source

This starts the three ClawGate services plus Redis, Qdrant, and Ollama:

```bash
git clone https://github.com/DXL-0702/ClawGate.git
cd ClawGate
cp .env.example .env
docker compose up -d --build

# The source-build compose file does not preload these models.
docker exec clawgate-ollama ollama pull nomic-embed-text
docker exec clawgate-ollama ollama pull qwen2.5:3b

curl http://localhost:3000/api/health
```

Open `http://localhost:3000` after the services are healthy. Provider keys in `.env` are optional; without them, only configured local Ollama models are available.

The current clean-database migration creates `dags` without `cron_timezone`; a temporary fresh-database probe reproduced `no such column: cron_timezone` on the first full DAG query. Treat this path as an integration environment until the migration P0 in [NEXT.md](./docs/progress/NEXT.md) is fixed.

An image-based compose file also exists:

```bash
docker compose -f docker-compose.prod.yml up -d
```

The filename reflects its intended deployment mode, not a production-readiness guarantee. Review the [single-node guide](./docs/deployment/single-node.md) before exposing the service.

### Source development

Install and build the Node.js workspace first:

```bash
corepack enable
pnpm install
pnpm build
docker compose up -d redis qdrant ollama
```

Then run the application processes in separate terminals:

```bash
cargo run --manifest-path services/router-rust/Cargo.toml
```

```bash
python3 -m venv .venv
.venv/bin/pip install -r services/intent-python/requirements.txt
.venv/bin/uvicorn main:app --app-dir services/intent-python --port 8000
```

```bash
pnpm --filter @clawgate/server dev
pnpm --filter @clawgate/web dev
```

The API runs at `http://localhost:3000`; the Vite development UI runs at `http://localhost:5173`. The Vite server proxies `/api` to port 3000. `pnpm dev` only starts workspace package processes; it does not start the Rust or Python services.

### Configuration and CLI

On first startup the server creates `clawgate.yaml` when it is missing. After `pnpm build`, the repository CLI can be invoked directly:

```bash
node packages/cli/dist/bin/clawgate.js init
node packages/cli/dist/bin/clawgate.js status
node packages/cli/dist/bin/clawgate.js agents list
node packages/cli/dist/bin/clawgate.js sessions list
```

Agent discovery expects an OpenClaw installation, and live session commands require a reachable and compatible Gateway. `status` reports normalized local OpenClaw configuration; it is not a routing or cost summary.

### API entry points

```text
GET  /api/health                 Service and OpenClaw connection status
POST /api/route                  Request a routing decision
GET  /api/route/stats            Routing statistics
POST /api/route/feedback         Submit explicit feedback
POST /v1/chat/completions        OpenAI-style chat-completions subset

GET  /api/agents                 Discovered OpenClaw agents
GET  /api/sessions               Gateway sessions

GET  /api/dags                   DAG definitions
POST /api/dags/:id/run           Start a DAG run
GET  /api/dag-runs/:runId        Inspect a DAG run
POST /api/dags/:id/webhook       Trigger a Webhook DAG

GET  /api/instances              Registered instances
GET  /api/health/overview        Team health summary
GET  /api/alerts                 Alert history
GET  /api/stats/overview         Dashboard statistics
```

These are representative entry points rather than a complete API specification. Inspect `packages/server/src/routes/` for the current contract.

## Verification Baseline

Use the following checks for a fresh local baseline:

```bash
pnpm build
pnpm test
cargo test --manifest-path services/router-rust/Cargo.toml
python3 -m compileall services/intent-python
docker compose config
docker compose -f docker-compose.prod.yml config
```

Only `packages/core` currently has Vitest files; Server, Shared, and Web have no test files, and CLI has no test task. Therefore the root `pnpm test` command currently fails even though Core's 46 tests pass. Rust has 22 passing tests. The Python service has no pytest suite, so Python regression cannot be described as covered.

No current verification should be interpreted as a real OpenClaw Gateway end-to-end sign-off unless it explicitly uses a compatible live Gateway and exercises routing, streaming, workflows, WebSocket events, and team authentication together.

## Known Limits

- `/v1/chat/completions` implements the subset used by ClawGate; other OpenAI endpoints and complete request/response parity are not guaranteed.
- The audited OpenClaw 2026.4.14 runtime returns RPC data in `payload`, requires `message` for session sends, and does not provide the `session.end` completion event expected by the current adapter. Live Session and Agent-node DAG behavior is therefore blocked, not merely untested.
- Python's optional LR classifier path uses a stale `sklearn.externals.joblib` import and the repository does not include a trained model artifact. L3 currently falls through from rules to the conservative strategy when LR is unavailable; L2 still depends on Ollama embeddings and Qdrant.
- L4 feedback counters are in process memory and aggregate by model, so they are not a durable per-prompt autonomous learning loop.
- Rust circuit state is in memory, and several route-stat counters are not yet connected to the live routing path.
- Browser real-time behavior still needs hardening for HTTPS/WebSocket deployment and complete page-level subscription coverage.
- DAG node canvas positions are not persisted by the current save path, and some frontend timeout/state behavior still needs correction.
- Team Gateway tokens are stored in plaintext and API keys do not have a rotation workflow. Do not expose the current team deployment to untrusted networks without additional controls.
- Internationalization is incomplete, including parts of the Phase F workspace changes.

These limits are tracked as refactoring and delivery-readiness work, not hidden behind a `v1.0` label.

## Repository Layout

```text
packages/
  shared/          Shared TypeScript contracts
  core/            Configuration, OpenClaw clients, storage, DAG execution
  server/          Fastify REST/WebSocket API and static web hosting
  web/             React dashboard and DAG editor
  cli/             Commander.js CLI
services/
  router-rust/     L1 routing cache, fallback, and circuit state
  intent-python/   L2/L3 intent classification and L4 feedback
proto/             Unintegrated protocol design definitions
docs/deployment/   Single-node and team deployment guides
docs/progress/     Implemented baseline and next work
```

## Documentation

- [Architecture](./architecture.md): runtime boundaries, data flow, storage, and known design debt.
- [Single-node deployment](./docs/deployment/single-node.md): local and Docker deployment details.
- [Team deployment](./docs/deployment/team.md): central service, members, instances, and security assumptions.
- [Implemented baseline](./docs/progress/DONE.md): capabilities already present in the repository baseline.
- [Next work](./docs/progress/NEXT.md): active workspace work, validation gaps, and planned refactoring.

## Contributing

Before changing behavior, compare the implementation with [DONE.md](./docs/progress/DONE.md) and [NEXT.md](./docs/progress/NEXT.md). Add tests in proportion to the affected runtime boundary, and avoid treating Proto definitions or historical milestone text as the current contract.

## License

MIT. See [LICENSE](./LICENSE).
