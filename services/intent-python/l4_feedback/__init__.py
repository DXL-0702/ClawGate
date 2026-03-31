from __future__ import annotations
import time
from dataclasses import dataclass, field
from collections import defaultdict
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from l2_semantic import L2SemanticCache

NEGATIVE_THRESHOLD = 3  # 连续 3 次负反馈触发降级

DEFAULT_SIMPLE_MODEL  = "qwen2.5:7b"
DEFAULT_COMPLEX_MODEL = "claude-sonnet-4-6"


@dataclass
class FeedbackRecord:
    prompt: str
    model: str
    complexity: str
    satisfied: bool
    timestamp: float = field(default_factory=time.time)


class L4FeedbackLoop:
    def __init__(
        self,
        simple_model: str = DEFAULT_SIMPLE_MODEL,
        complex_model: str = DEFAULT_COMPLEX_MODEL,
    ) -> None:
        self._simple_model = simple_model
        self._complex_model = complex_model
        # model -> consecutive negative count
        self._neg_counts: dict[str, int] = defaultdict(int)
        # model -> total feedback count
        self._total: dict[str, int] = defaultdict(int)
        self._records: list[FeedbackRecord] = []

    def record(
        self,
        prompt: str,
        model: str,
        complexity: str,
        satisfied: bool,
    ) -> str | None:
        """
        Record user feedback. Returns a suggested model adjustment if
        negative feedback threshold is exceeded, otherwise None.
        """
        self._records.append(FeedbackRecord(prompt, model, complexity, satisfied))
        self._total[model] += 1

        if satisfied:
            self._neg_counts[model] = 0  # 重置连续负反馈计数
            return None

        self._neg_counts[model] += 1
        if self._neg_counts[model] >= NEGATIVE_THRESHOLD:
            self._neg_counts[model] = 0  # 重置，避免重复触发
            return self._suggest_alternative(model, complexity)
        return None

    def _suggest_alternative(self, model: str, complexity: str) -> str:
        """当前模型连续负反馈超过阈值，建议切换方向."""
        if complexity == "simple":
            # simple 任务反复不满意 → 升级到更强模型
            return self._complex_model
        else:
            # complex 任务反复不满意 → 可能过度复杂，尝试降级
            return self._simple_model

    def satisfaction_rate(self, model: str) -> float:
        total = self._total.get(model, 0)
        if total == 0:
            return 1.0
        satisfied = sum(
            1 for r in self._records
            if r.model == model and r.satisfied
        )
        return satisfied / total

    def stats(self) -> dict:
        return {
            "total_feedback": len(self._records),
            "models": {
                m: {
                    "total": self._total[m],
                    "satisfaction_rate": self.satisfaction_rate(m),
                    "consecutive_negatives": self._neg_counts.get(m, 0),
                }
                for m in self._total
            },
        }
