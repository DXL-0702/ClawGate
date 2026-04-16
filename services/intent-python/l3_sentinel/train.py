"""L3 LR 分类器训练脚本"""
import asyncio
import json
from pathlib import Path

import httpx
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, classification_report
import joblib

from .lr_classifier import MODEL_DIR, MODEL_FILE

OLLAMA_URL = "http://127.0.0.1:11434"
EMBED_MODEL = "nomic-embed-text"


async def get_embedding(prompt: str) -> np.ndarray | None:
    """获取 embedding"""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{OLLAMA_URL}/api/embeddings",
            json={"model": EMBED_MODEL, "prompt": prompt},
        )
        data = resp.json()
        embedding = data.get("embedding")
        if embedding:
            return np.array(embedding, dtype=np.float32)
    return None


async def prepare_data(data_file: Path) -> tuple[list[np.ndarray], list[str]]:
    """
    从标注数据文件生成 embeddings。

    数据文件格式（JSONL）:
    {"prompt": "什么是Python", "label": "simple"}
    {"prompt": "设计分布式系统", "label": "complex"}
    """
    embeddings = []
    labels = []

    with open(data_file) as f:
        for line in f:
            item = json.loads(line.strip())
            prompt = item["prompt"]
            label = item["label"]

            emb = await get_embedding(prompt)
            if emb is not None:
                embeddings.append(emb)
                labels.append(label)
                print(f"✓ {label}: {prompt[:50]}...")
            else:
                print(f"✗ Failed: {prompt[:50]}...")

    return embeddings, labels


def train(embeddings: list[np.ndarray], labels: list[str]) -> None:
    """训练 LR 模型"""
    X = np.array(embeddings)
    y = np.array([1 if label == "complex" else 0 for label in labels])

    # 划分训练集/测试集
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    # 训练
    clf = LogisticRegression(
        max_iter=1000,
        class_weight="balanced",
        C=1.0,
    )
    clf.fit(X_train, y_train)

    # 评估
    y_pred = clf.predict(X_test)
    acc = accuracy_score(y_test, y_pred)
    print(f"\n=== 模型评估 ===")
    print(f"准确率: {acc:.2%}")
    print(f"训练样本: {len(y_train)}, 测试样本: {len(y_test)}")
    print(f"\n分类报告:\n{classification_report(y_test, y_pred, target_names=['simple', 'complex'])}")

    # 保存
    MODEL_DIR.mkdir(exist_ok=True)
    joblib.dump(clf, MODEL_FILE)
    print(f"\n模型已保存到: {MODEL_FILE}")


async def main():
    """
    使用示例:

    1. 创建训练数据文件 l3_training_data.jsonl:
       {"prompt": "什么是Python", "label": "simple"}
       {"prompt": "设计分布式缓存系统", "label": "complex"}
       ... (至少300条，simple/complex各150条)

    2. 运行训练:
       cd services/intent-python
       python -c "from l3_sentinel.train import main; asyncio.run(main())"

    3. 模型会自动保存到 l3_sentinel/models/l3_classifier.pkl
    """
    data_file = Path(__file__).parent / "l3_training_data.jsonl"

    if not data_file.exists():
        print(f"训练数据文件不存在: {data_file}")
        print("请创建 JSONL 文件，格式: {\"prompt\": \"...\", \"label\": \"simple|complex\"}")
        return

    print("准备训练数据...")
    embeddings, labels = await prepare_data(data_file)

    if len(embeddings) < 50:
        print(f"样本不足 ({len(embeddings)} < 50)，请添加更多标注数据")
        return

    print(f"\n训练数据就绪: {len(embeddings)} 条")
    train(embeddings, labels)


if __name__ == "__main__":
    asyncio.run(main())
