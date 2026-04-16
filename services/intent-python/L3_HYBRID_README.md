# L3 混合策略分类器（方案 E）

## 架构

```
用户查询
    │
    ▼
┌─────────────────────┐  <1ms, ~30% 查询
│ 规则引擎            │  高置信度规则（代码块/函数/简单问答）
│ (rule_engine.py)    │  置信度 >= 0.80 直接返回
└─────────────────────┘
    │ 未命中
    ▼
┌─────────────────────┐  ~5ms, ~50% 查询（需训练后）
│ LR 分类器           │  Fine-tuned Logistic Regression
│ (lr_classifier.py)  │  proba > 0.80 返回，否则 fallback
│                     │  依赖 nomic-embed-text (Ollama)
└─────────────────────┘
    │ 置信度不足
    ▼
┌─────────────────────┐  兜底，~20% 查询
│ 保守策略            │  标记为 complex → Claude Sonnet
│ (conservative)      │  宁可过度配置，不错过复杂需求
└─────────────────────┘
```

## 性能预估

| 路径 | 延迟 | 准确率 | 覆盖率 |
|------|------|--------|--------|
| 规则引擎 | <1ms | 90% | 30% |
| LR 分类器 | 5ms | 82% | 50% |
| 保守策略 | 0ms | N/A | 20% |
| **加权平均** | **~3ms** | **~85%** | **100%** |

## 当前状态

### 已实现
- [x] `rule_engine.py` - 增强规则引擎（10+ 条高置信度规则）
- [x] `lr_classifier.py` - LR 分类器框架（需训练后启用）
- [x] `__init__.py` - L3HybridClassifier 混合调度
- [x] `train.py` - 训练数据收集与模型训练脚本

### 待完成
- [ ] 收集 300 条标注数据训练 LR 模型
- [ ] 测试完整四层路由链路（当前 L2 加载卡住）
- [ ] 性能基准测试

## 训练数据收集方案

创建 `l3_sentinel/l3_training_data.jsonl`：

```jsonl
{"prompt": "什么是Python", "label": "simple"}
{"prompt": "翻译这段话到中文", "label": "simple"}
{"prompt": "设计一个支持百万并发的消息队列", "label": "complex"}
{"prompt": "```python\ndef quicksort(arr):\n...", "label": "complex"}
```

要求：
- 至少 300 条（simple 150条，complex 150条）
- 覆盖团队常见查询类型
- 标注标准：
  - simple: 日常对话、单步问答、翻译、短查询（<100字）
  - complex: 代码、设计、算法、多步推理、长查询（>500字）

训练命令：
```bash
cd services/intent-python
python -c "from l3_sentinel.train import main; import asyncio; asyncio.run(main())"
```

## 对比其他方案

| 方案 | 准确率 | 延迟 | 成本 | 维护 |
|------|--------|------|------|------|
| 方案 A: Zero-shot | 72% | 25ms | 零 | 低 |
| 方案 B: Fine-tuned | 82% | 5ms | 零 | 中 |
| **方案 E: 混合（当前）** | **85%** | **3ms** | **零** | **中** |
| 方案 D: Groq API | 88% | 50ms | $5/月 | 低 |

## 建议下一步

1. **短期**：使用规则引擎 + 保守策略（已可用，准确率 ~75%）
2. **中期**：收集标注数据，训练 LR 模型，提升至 85%
3. **长期**：根据团队反馈持续优化规则引擎
