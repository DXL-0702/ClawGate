from __future__ import annotations
import os
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from l2_semantic import L2SemanticCache
from l3_sentinel import L3OllamaClassifier
from l4_feedback import L4FeedbackLoop

# ── 配置（环境变量覆盖） ─────────────────────────────────────────
QDRANT_URL     = os.getenv("QDRANT_URL",    "http://127.0.0.1:6333")
OLLAMA_URL     = os.getenv("OLLAMA_URL",    "http://127.0.0.1:11434")
L2_THRESHOLD   = float(os.getenv("L2_THRESHOLD", "0.75"))
SIMPLE_MODEL   = os.getenv("SIMPLE_MODEL",  "qwen2.5:7b")
COMPLEX_MODEL  = os.getenv("COMPLEX_MODEL", "claude-sonnet-4-6")
CLASSIFY_MODEL = os.getenv("CLASSIFY_MODEL","qwen2.5:3b")

# ── 单例 ────────────────────────────────────────────────────────
l2: L2SemanticCache
l3: L3OllamaClassifier
l4: L4FeedbackLoop


@asynccontextmanager
async def lifespan(app: FastAPI):
    global l2, l3, l4
    l2 = L2SemanticCache(qdrant_url=QDRANT_URL, threshold=L2_THRESHOLD)
    l3 = L3OllamaClassifier(
        ollama_url=OLLAMA_URL,
        classify_model=CLASSIFY_MODEL,
        simple_model=SIMPLE_MODEL,
        complex_model=COMPLEX_MODEL,
    )
    l4 = L4FeedbackLoop(simple_model=SIMPLE_MODEL, complex_model=COMPLEX_MODEL)
    # 尝试初始化 Qdrant collection（Qdrant 不可用时不崩溃）
    try:
        await l2.ensure_collection()
    except Exception:
        pass
    yield
    # shutdown: nothing to clean up


app = FastAPI(title="ClawGate Intent Service", version="0.3.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── 请求/响应模型 ────────────────────────────────────────────────
class ClassifyRequest(BaseModel):
    prompt: str
    session_id: str | None = None


class ClassifyResponse(BaseModel):
    complexity: str
    model: str
    layer: str
    confidence: float
    latency_ms: float


class FeedbackRequest(BaseModel):
    prompt: str
    model: str
    complexity: str
    satisfied: bool


class FeedbackResponse(BaseModel):
    recorded: bool
    suggested_model: str | None = None


# ── 端点 ─────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {"status": "ok", "service": "intent-python", "version": "0.3.0"}


@app.post("/classify", response_model=ClassifyResponse)
async def classify(req: ClassifyRequest):
    total_start = time.monotonic()

    # L2: 语义缓存查找
    l2_result = await l2.lookup(req.prompt)
    if l2_result.hit:
        return ClassifyResponse(
            complexity="unknown",
            model=l2_result.model,
            layer="L2",
            confidence=l2_result.confidence,
            latency_ms=(time.monotonic() - total_start) * 1000,
        )

    # L3: Ollama Few-Shot 分类
    l3_result = await l3.classify(req.prompt)

    # L3 结果写入 L2 缓存（供后续命中）
    if not l3_result.timed_out:
        await l2.store(req.prompt, l3_result.model, l3_result.complexity)

    return ClassifyResponse(
        complexity=l3_result.complexity,
        model=l3_result.model,
        layer="L3",
        confidence=l3_result.confidence,
        latency_ms=(time.monotonic() - total_start) * 1000,
    )


@app.post("/feedback", response_model=FeedbackResponse)
async def feedback(req: FeedbackRequest):
    suggested = l4.record(
        prompt=req.prompt,
        model=req.model,
        complexity=req.complexity,
        satisfied=req.satisfied,
    )
    # 负反馈触发降级时，更新 L2 缓存
    if suggested and not req.satisfied:
        await l2.store(req.prompt, suggested, req.complexity)
    return FeedbackResponse(recorded=True, suggested_model=suggested)


@app.get("/feedback/stats")
async def feedback_stats():
    return l4.stats()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
