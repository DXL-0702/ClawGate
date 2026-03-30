from __future__ import annotations
import asyncio
import time
from dataclasses import dataclass
from typing import Optional

from qdrant_client import AsyncQdrantClient
from qdrant_client.models import (
    Distance, VectorParams, PointStruct, ScoredPoint
)
from sentence_transformers import SentenceTransformer

COLLECTION = "intent_cache"
VECTOR_DIM = 384  # all-MiniLM-L6-v2 output dim
DEFAULT_THRESHOLD = 0.75


@dataclass
class L2Result:
    hit: bool
    model: str
    confidence: float
    latency_ms: float


class L2SemanticCache:
    def __init__(
        self,
        qdrant_url: str = "http://127.0.0.1:6333",
        threshold: float = DEFAULT_THRESHOLD,
        model_name: str = "all-MiniLM-L6-v2",
    ) -> None:
        self.client = AsyncQdrantClient(url=qdrant_url)
        self.threshold = threshold
        self._encoder: Optional[SentenceTransformer] = None
        self._model_name = model_name

    def _encoder_instance(self) -> SentenceTransformer:
        if self._encoder is None:
            self._encoder = SentenceTransformer(self._model_name)
        return self._encoder

    async def ensure_collection(self) -> None:
        collections = await self.client.get_collections()
        names = [c.name for c in collections.collections]
        if COLLECTION not in names:
            await self.client.create_collection(
                collection_name=COLLECTION,
                vectors_config=VectorParams(size=VECTOR_DIM, distance=Distance.COSINE),
            )

    def _embed(self, text: str) -> list[float]:
        vec = self._encoder_instance().encode(text, normalize_embeddings=True)
        return vec.tolist()

    async def lookup(self, prompt: str) -> L2Result:
        start = time.monotonic()
        try:
            loop = asyncio.get_event_loop()
            vec = await loop.run_in_executor(None, self._embed, prompt)
            results: list[ScoredPoint] = await self.client.query_points(
                collection_name=COLLECTION,
                query=vec,
                limit=3,
                with_payload=True,
            )
            # Top-3 投票：取得分最高且超过阈值的结果
            candidates = [r for r in results.points if r.score >= self.threshold]
            if candidates:
                # 按 model 投票
                votes: dict[str, float] = {}
                for c in candidates:
                    m = c.payload.get("model", "") if c.payload else ""
                    votes[m] = votes.get(m, 0.0) + c.score
                best_model = max(votes, key=lambda k: votes[k])
                confidence = votes[best_model] / len(candidates)
                latency = (time.monotonic() - start) * 1000
                return L2Result(hit=True, model=best_model, confidence=confidence, latency_ms=latency)
        except Exception:
            pass
        latency = (time.monotonic() - start) * 1000
        return L2Result(hit=False, model="", confidence=0.0, latency_ms=latency)

    async def store(self, prompt: str, model: str, complexity: str) -> None:
        try:
            loop = asyncio.get_event_loop()
            vec = await loop.run_in_executor(None, self._embed, prompt)
            import uuid
            point = PointStruct(
                id=str(uuid.uuid4()),
                vector=vec,
                payload={"prompt": prompt, "model": model, "complexity": complexity},
            )
            await self.client.upsert(collection_name=COLLECTION, points=[point])
        except Exception:
            pass
