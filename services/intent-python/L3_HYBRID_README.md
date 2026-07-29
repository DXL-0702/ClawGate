# L3 混合分类器实现基线

本文描述 `services/intent-python/l3_sentinel` 的当前代码，不再保留未经基准测试验证的延迟、准确率或覆盖率数字。

## 实际决策链

```text
prompt
  |
  v
规则引擎 rule_engine.py
  | 命中且归一化置信度 >= 0.80
  +---------------------------------> simple / complex
  |
  | 未命中
  v
Ollama nomic-embed-text 生成 embedding
  |
  v
可选 LR 分类器 lr_classifier.py
  | 模型存在且 max probability >= 0.80
  +---------------------------------> simple / complex
  |
  | embedding、依赖、模型或置信度不可用
  v
保守策略：complex -> COMPLEX_MODEL
```

当前 L3 不调用生成式 Ollama 模型做 Few-Shot 分类。`L3OllamaClassifier` 只是 `L3HybridClassifier` 的向后兼容别名；Ollama 在这里用于 `nomic-embed-text` embedding。

## 模块职责

| 文件 | 当前职责 | 当前状态 |
|---|---|---|
| `rule_engine.py` | 对代码、架构、算法、翻译、短问答等模式做启发式分类 | 源码已实现，无 pytest 覆盖 |
| `__init__.py` | 串联规则、embedding、LR 和保守策略 | 源码已实现，无 pytest 覆盖 |
| `lr_classifier.py` | 加载 `models/l3_classifier.pkl` 并按概率阈值预测 | 当前不可交付，见下文 |
| `train.py` | 从 JSONL 获取 embedding、划分数据、训练并保存 LR | 工具代码存在，未随仓库提供数据或模型 |

## LR 路径的当前阻塞

1. `lr_classifier.py` 从 `sklearn.externals` 导入 `joblib`。现代 scikit-learn 已移除该入口，ImportError 会把 `SKLEARN_AVAILABLE` 设为 `False`，即使顶层 `joblib` 包已经安装也不会加载模型。
2. 仓库没有 `l3_sentinel/models/l3_classifier.pkl`。
3. 仓库没有 `l3_training_data.jsonl`。
4. Python 服务没有 pytest 文件，也没有训练质量、embedding 维度、模型兼容和降级路径测试。

因此当前运行行为通常是：规则命中时直接返回；规则未命中时尝试获取 embedding，但 LR 不可用，最终进入 `complex` 保守策略。

## 训练工具的预期输入

`train.py` 读取 `l3_sentinel/l3_training_data.jsonl`：

```jsonl
{"prompt":"什么是 Python","label":"simple"}
{"prompt":"设计一个可水平扩展的任务队列","label":"complex"}
```

运行前需要：

- 安装 `requirements.txt` 中的依赖。
- 启动 Ollama 并安装 `nomic-embed-text`。
- 准备至少 50 条数据才能越过脚本下限；这只是训练下限，不代表质量门槛。

```bash
cd services/intent-python
python -c "from l3_sentinel.train import main; import asyncio; asyncio.run(main())"
```

脚本会把模型写到 `l3_sentinel/models/l3_classifier.pkl`。该生成物当前不在版本控制中，也没有模型版本、训练数据版本或兼容性元数据。

## 当前验证

截至 2026-07-29：

- `python3 -m compileall -q services/intent-python` 通过。
- `pytest` 找不到测试，退出码为 5。
- 审计环境缺少 FastAPI/Numpy 等 Python 依赖，因此未完成服务 import 或运行时启动验证。
- 仓库没有可用于复现历史“85% 准确率”“3ms 延迟”等数字的数据集或基准脚本；这些数字不属于当前验证基线。

## 重构验收条件

1. 改用顶层 `import joblib`，并对缺依赖、缺模型、损坏模型和维度不匹配给出可观测状态。
2. 为模型文件加入格式版本、embedding 模型、维度、训练数据版本和质量指标元数据。
3. 为规则、LR、保守策略、Ollama 超时与 Qdrant 回写建立 pytest 覆盖。
4. 使用固定数据集报告 precision、recall、F1、混淆矩阵和分层延迟，不再使用估算值。
5. 明确模型生成物的发布方式；若不准备维护训练资产，应删除 LR 路径，保留规则 + 保守策略的简单契约。
