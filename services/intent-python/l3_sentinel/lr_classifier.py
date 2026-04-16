"""Fine-tuned Logistic Regression 分类器"""
import os
from pathlib import Path
import numpy as np

# 尝试导入 sklearn，未安装时使用 fallback
try:
    from sklearn.linear_model import LogisticRegression
    from sklearn.externals import joblib
    SKLEARN_AVAILABLE = True
except ImportError:
    SKLEARN_AVAILABLE = False

# 模型文件路径
MODEL_DIR = Path(__file__).parent / "models"
MODEL_FILE = MODEL_DIR / "l3_classifier.pkl"

def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))


class L3LRClassifier:
    """基于 Embedding + LR 的 L3 分类器"""

    def __init__(self, confidence_threshold: float = 0.80):
        self.threshold = confidence_threshold
        self.clf = None
        self._load_model()

    def _load_model(self) -> None:
        """加载预训练模型（如果存在）"""
        if not SKLEARN_AVAILABLE:
            return
        if MODEL_FILE.exists():
            try:
                self.clf = joblib.load(MODEL_FILE)
            except Exception:
                self.clf = None

    def predict(self, embedding: np.ndarray) -> tuple[str, float] | None:
        """
        预测复杂度。

        Returns:
            (complexity, confidence) 如果置信度 >= threshold
            None 如果模型未加载或置信度不足
        """
        if self.clf is None:
            return None

        proba = self.clf.predict_proba([embedding])[0]
        max_proba = max(proba)

        if max_proba < self.threshold:
            return None  # 置信度不足，走保守策略

        # proba[0] = simple, proba[1] = complex
        complexity = "complex" if proba[1] > proba[0] else "simple"
        return (complexity, max_proba)

    @staticmethod
    def train_model(embeddings: list[np.ndarray], labels: list[str]) -> None:
        """
        训练并保存模型。

        Args:
            embeddings: 768维向量列表
            labels: "simple" 或 "complex" 标签列表
        """
        if not SKLEARN_AVAILABLE:
            raise ImportError("sklearn is required for training")

        X = np.array(embeddings)
        y = np.array([1 if label == "complex" else 0 for label in labels])

        clf = LogisticRegression(
            max_iter=1000,
            class_weight="balanced",  # 处理类别不平衡
            C=1.0,  # 正则化强度
        )
        clf.fit(X, y)

        MODEL_DIR.mkdir(exist_ok=True)
        joblib.dump(clf, MODEL_FILE)
        print(f"Model trained and saved to {MODEL_FILE}")

    @staticmethod
    def evaluate(embeddings: list[np.ndarray], labels: list[str]) -> dict:
        """评估模型性能"""
        if not MODEL_FILE.exists():
            return {"error": "Model not found"}

        clf = joblib.load(MODEL_FILE)
        X = np.array(embeddings)
        y_true = np.array([1 if label == "complex" else 0 for label in labels])

        y_pred = clf.predict(X)
        accuracy = (y_pred == y_true).mean()

        return {
            "accuracy": float(accuracy),
            "samples": len(labels),
        }
