from __future__ import annotations
import time
from dataclasses import dataclass

import httpx
from qdrant_client import AsyncQdrantClient
from qdrant_client.models import (
    Distance, VectorParams, PointStruct, ScoredPoint
)

COLLECTION = "intent_cache"
VECTOR_DIM = 768  # nomic-embed-text output dim
DEFAULT_THRESHOLD = 0.75
EMBED_MODEL = "nomic-embed-text"


@dataclass
class L2Result:
    hit: bool
    model: str
    confidence: float
    latency_ms: float


class L2SemanticCache:
    """L2 语义缓存 - 使用 Ollama nomic-embed-text"""

    def __init__(
        self,
        qdrant_url: str = "http://127.0.0.1:6333",
        ollama_url: str = "http://127.0.0.1:11434",
        threshold: float = DEFAULT_THRESHOLD,
    ) -> None:
        self.client = AsyncQdrantClient(url=qdrant_url)
        self.ollama_url = ollama_url
        self.threshold = threshold

    async def _embed(self, text: str) -> list[float] | None:
        """通过 Ollama API 获取 embedding"""
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(
                    f"{self.ollama_url}/api/embeddings",
                    json={
                        "model": EMBED_MODEL,
                        "prompt": text[:500],  # 截断防止过长
                    },
                )
                data = resp.json()
                embedding = data.get("embedding")
                if embedding and len(embedding) == VECTOR_DIM:
                    return embedding
        except Exception:
            pass
        return None

    async def ensure_collection(self) -> None:
        """确保 Qdrant collection 存在（768维）"""
        try:
            collections = await self.client.get_collections()
            names = [c.name for c in collections.collections]
            if COLLECTION not in names:
                await self.client.create_collection(
                    collection_name=COLLECTION,
                    vectors_config=VectorParams(
                        size=VECTOR_DIM,
                        distance=Distance.COSINE,
                    ),
                )
        except Exception:
            pass  # Qdrant 不可用时静默失败

    async def lookup(self, prompt: str) -> L2Result:
        """语义缓存查找"""
        start = time.monotonic()

        vec = await self._embed(prompt)
        if vec is None:
            latency = (time.monotonic() - start) * 1000
            return L2Result(hit=False, model="", confidence=0.0, latency_ms=latency)

        try:
            results: list[ScoredPoint] = await self.client.query_points(
                collection_name=COLLECTION,
                query=vec,
                limit=3,
                with_payload=True,
            )

            # Top-3 投票：取得分最高且超过阈值的结果
            candidates = [r for r in results.points if r.score >= self.threshold]
            if candidates:
                votes: dict[str, float] = {}
                for c in candidates:
                    m = c.payload.get("model", "") if c.payload else ""
                    if m:
                        votes[m] = votes.get(m, 0.0) + c.score

                if votes:
                    best_model = max(votes, key=lambda k: votes[k])
                    confidence = votes[best_model] / len(candidates)
                    latency = (time.monotonic() - start) * 1000
                    return L2Result(
                        hit=True,
                        model=best_model,
                        confidence=confidence,
                        latency_ms=latency,
                    )
        except Exception:
            pass

        latency = (time.monotonic() - start) * 1000
        return L2Result(hit=False, model="", confidence=0.0, latency_ms=latency)

    async def store(self, prompt: str, model: str, complexity: str) -> None:
        """存储语义缓存"""
        vec = await self._embed(prompt)
        if vec is None:
            return

        try:
            import uuid
            point = PointStruct(
                id=str(uuid.uuid4()),
                vector=vec,
                payload={
                    "prompt": prompt,
                    "model": model,
                    "complexity": complexity,
                },
            )
            await self.client.upsert(collection_name=COLLECTION, points=[point])
        except Exception:
            pass
