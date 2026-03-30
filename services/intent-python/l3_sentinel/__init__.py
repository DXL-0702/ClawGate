from __future__ import annotations
import time
from dataclasses import dataclass

import httpx

FEW_SHOT_PROMPT = """\
You are a task complexity classifier. Classify the user prompt as either "simple" or "complex".

Rules:
- simple: short Q&A, single-step tasks, factual lookups, casual chat
- complex: multi-step reasoning, code generation, long-form writing, analysis, debugging

Examples:
Prompt: "What is the capital of France?" -> simple
Prompt: "Explain the difference between TCP and UDP" -> simple
Prompt: "Write a REST API in Rust with authentication and rate limiting" -> complex
Prompt: "Debug this Python code and refactor it to be async" -> complex
Prompt: "Translate this paragraph to Chinese" -> simple
Prompt: "Design a distributed caching system with consistency guarantees" -> complex

Respond with ONLY one word: simple or complex.

Prompt: "{prompt}" ->"""


@dataclass
class L3Result:
    complexity: str   # "simple" | "complex"
    model: str        # routing target model
    confidence: float
    latency_ms: float
    timed_out: bool


class L3OllamaClassifier:
    def __init__(
        self,
        ollama_url: str = "http://127.0.0.1:11434",
        classify_model: str = "qwen2.5:3b",
        simple_model: str = "qwen2.5:7b",
        complex_model: str = "claude-sonnet-4-6",
        timeout_s: float = 5.0,
    ) -> None:
        self.ollama_url = ollama_url
        self.classify_model = classify_model
        self.simple_model = simple_model
        self.complex_model = complex_model
        self.timeout_s = timeout_s

    async def classify(self, prompt: str) -> L3Result:
        start = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=self.timeout_s) as client:
                resp = await client.post(
                    f"{self.ollama_url}/api/generate",
                    json={
                        "model": self.classify_model,
                        "prompt": FEW_SHOT_PROMPT.format(prompt=prompt[:500]),
                        "stream": False,
                        "options": {"temperature": 0, "num_predict": 5},
                    },
                )
                data = resp.json()
                raw = data.get("response", "").strip().lower()
                complexity = "complex" if "complex" in raw else "simple"
                target = self.complex_model if complexity == "complex" else self.simple_model
                latency = (time.monotonic() - start) * 1000
                return L3Result(
                    complexity=complexity,
                    model=target,
                    confidence=0.9,
                    latency_ms=latency,
                    timed_out=False,
                )
        except Exception:
            latency = (time.monotonic() - start) * 1000
            # fallback: 默认 simple
            return L3Result(
                complexity="simple",
                model=self.simple_model,
                confidence=0.0,
                latency_ms=latency,
                timed_out=True,
            )
