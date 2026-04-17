# syntax=docker/dockerfile:1

# ---- Build stage ----
FROM rust:1.83-bookworm AS builder

WORKDIR /build

# Cache deps by building an empty project first
COPY Cargo.toml Cargo.lock* ./
RUN mkdir -p src && echo "fn main() {}" > src/main.rs && \
    cargo build --release && \
    rm -rf src target/release/deps/clawgate_router*

# Copy real source and build
COPY src ./src
RUN cargo build --release

# ---- Runtime stage ----
FROM debian:bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      libssl3 \
      curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /build/target/release/clawgate-router /usr/local/bin/clawgate-router

ENV RUST_LOG=info \
    REDIS_URL=redis://redis:6379 \
    INTENT_URL=http://intent:8000 \
    L1_TTL_SECS=3600 \
    SIMPLE_MODEL=qwen2.5:7b \
    COMPLEX_MODEL=claude-sonnet-4-6 \
    CIRCUIT_FAILURE_THRESHOLD=5 \
    CIRCUIT_RESET_TIMEOUT_SECS=30 \
    CIRCUIT_HALF_OPEN_SUCCESSES=2

EXPOSE 3001

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -fs http://localhost:3001/health || exit 1

ENTRYPOINT ["/usr/local/bin/clawgate-router"]
