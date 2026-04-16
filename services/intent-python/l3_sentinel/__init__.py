from __future__ import annotations
import time
from dataclasses import dataclass
import numpy as np

from .rule_engine import rule_classify
from .lr_classifier import L3LRClassifier

@dataclass
class L3Result:
    complexity: str   # "simple" | "complex"
    model: str        # routing target model
    confidence: float
    latency_ms: float
    layer: str        # "L3-rule" | "L3-lr" | "L3-conservative"
    timed_out: bool = False


class L3HybridClassifier:
    """L3 混合策略分类器：规则引擎 -> LR分类器 -> 保守策略"""

    def __init__(
        self,
        api_key: str | None = None,  # 保持向后兼容参数名
        ollama_url: str = "http://127.0.0.1:11434",
        simple_model: str = "qwen2.5:7b",
        complex_model: str = "claude-sonnet-4-6",
        embed_model: str = "nomic-embed-text",
        timeout_s: float = 5.0,
    ) -> None:
        self.ollama_url = ollama_url
        self.simple_model = simple_model
        self.complex_model = complex_model
        self.embed_model = embed_model
        self.timeout_s = timeout_s
        self.lr_classifier = L3LRClassifier(confidence_threshold=0.80)

    async def _get_embedding(self, prompt: str) -> np.ndarray | None:
        """获取 embedding（复用 L2 的 nomic-embed-text）"""
        import httpx
        try:
            async with httpx.AsyncClient(timeout=self.timeout_s) as client:
                resp = await client.post(
                    f"{self.ollama_url}/api/embeddings",
                    json={
                        "model": self.embed_model,
                        "prompt": prompt[:500],
                    },
                )
                data = resp.json()
                embedding = data.get("embedding")
                if embedding:
                    return np.array(embedding, dtype=np.float32)
        except Exception:
            pass
        return None

    async def classify(self, prompt: str) -> L3Result:
        """混合策略分类：规则 -> LR -> 保守"""
        start = time.monotonic()

        # Step 1: 规则引擎（高置信度，<1ms）
        rule_result = rule_classify(prompt)
        if rule_result:
            complexity, confidence = rule_result
            target = self.complex_model if complexity == "complex" else self.simple_model
            latency = (time.monotonic() - start) * 1000
            return L3Result(
                complexity=complexity,
                model=target,
                confidence=confidence,
                latency_ms=latency,
                layer="L3-rule",
                timed_out=False,
            )

        # Step 2: LR 分类器（中置信度，~5ms，需要 embedding）
        embedding = await self._get_embedding(prompt)
        if embedding is not None:
            lr_result = self.lr_classifier.predict(embedding)
            if lr_result:
                complexity, confidence = lr_result
                target = self.complex_model if complexity == "complex" else self.simple_model
                latency = (time.monotonic() - start) * 1000
                return L3Result(
                    complexity=complexity,
                    model=target,
                    confidence=confidence,
                    latency_ms=latency,
                    layer="L3-lr",
                    timed_out=False,
                )

        # Step 3: 保守策略兜底（复杂查询优先）
        latency = (time.monotonic() - start) * 1000
        return L3Result(
            complexity="complex",
            model=self.complex_model,
            confidence=0.5,  # 保守策略置信度较低
            latency_ms=latency,
            layer="L3-conservative",
            timed_out=False,
        )


# 向后兼容
L3OllamaClassifier = L3HybridClassifier
