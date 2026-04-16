"""L3 规则引擎 - 高置信度快速分类"""
import re

# 高置信度规则定义
RULES = [
    # (规则名, 检测函数, 判断结果, 置信度权重)
    ("code_block", lambda p: "```" in p or p.count("`") >= 6, "complex", 0.95),
    ("function_def", lambda p: bool(re.search(r"(def\s+\w+|function\s+\w+|fn\s+\w+)", p)), "complex", 0.90),
    ("class_struct", lambda p: bool(re.search(r"(class\s+\w+|struct\s+\w+|interface\s+\w+)", p)), "complex", 0.90),
    ("architecture", lambda p: any(kw in p.lower() for kw in ["设计", "架构", "distributed", "system design", "scalable", "microservice"]), "complex", 0.85),
    ("algorithm", lambda p: any(kw in p.lower() for kw in ["算法", "algorithm", "optimize", "complexity", "time/space", "big o"]), "complex", 0.85),
    ("debug_refactor", lambda p: any(kw in p.lower() for kw in ["debug", "refactor", "fix", "bug", "error", "exception", "performance issue"]), "complex", 0.80),
    ("multi_step", lambda p: len([c for c in ["and", "then", "also", "additionally", "furthermore", "moreover"] if c in p.lower()]) >= 3, "complex", 0.70),
    ("long_query", lambda p: len(p) > 800, "complex", 0.65),
    ("translation", lambda p: any(kw in p.lower() for kw in ["translate", "翻译", "convert to chinese", "转成中文"]), "simple", 0.90),
    ("definition", lambda p: any(kw in p.lower() for kw in ["what is", "什么是", "define", "explain", "difference between"]) and len(p) < 200, "simple", 0.85),
    ("short_qa", lambda p: len(p) < 100 and "?" in p, "simple", 0.80),
    ("casual_chat", lambda p: any(kw in p.lower() for kw in ["hello", "hi", "你好", "谢谢", "thanks", "how are you"]), "simple", 0.85),
]

THRESHOLD_HIGH = 0.80  # 高置信度阈值


def rule_classify(prompt: str) -> tuple[str, float] | None:
    """
    规则引擎分类。

    Returns:
        (complexity, confidence) 如果置信度 >= THRESHOLD_HIGH
        None 如果规则无法高置信判断
    """
    scores = {"simple": 0.0, "complex": 0.0}

    for name, checker, result, weight in RULES:
        if checker(prompt):
            scores[result] += weight

    # 归一化
    total = scores["simple"] + scores["complex"]
    if total == 0:
        return None

    if scores["complex"] > scores["simple"]:
        confidence = scores["complex"] / total
        return ("complex", confidence) if confidence >= THRESHOLD_HIGH else None
    else:
        confidence = scores["simple"] / total
        return ("simple", confidence) if confidence >= THRESHOLD_HIGH else None
