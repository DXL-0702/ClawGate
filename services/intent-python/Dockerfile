# syntax=docker/dockerfile:1

FROM python:3.11-slim AS runtime

# System deps (scikit-learn needs libgomp; curl for healthcheck)
RUN apt-get update && apt-get install -y --no-install-recommends \
      libgomp1 \
      curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first (better layer cache)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source
COPY main.py ./
COPY l2_semantic ./l2_semantic
COPY l3_sentinel ./l3_sentinel
COPY l4_feedback ./l4_feedback

ENV QDRANT_URL=http://qdrant:6333 \
    OLLAMA_URL=http://ollama:11434 \
    L2_THRESHOLD=0.75 \
    SIMPLE_MODEL=qwen2.5:7b \
    COMPLEX_MODEL=claude-sonnet-4-6 \
    PYTHONUNBUFFERED=1

EXPOSE 8000

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
    CMD curl -fs http://localhost:8000/health || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
