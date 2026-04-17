/**
 * DAG 条件节点求值引擎
 *
 * 使用结构化表达式（非 eval/JS），安全且 UI 友好。
 * 支持运算符：eq | neq | contains | not_contains | empty | not_empty
 */

import type { ConditionExpression } from './queue.js';
import { substituteVariables, type NodeOutputContext } from './variable-subst.js';

/**
 * 求值条件表达式，返回 boolean。
 * left / right 均会先做变量替换（支持 {{nodeId.output}} 语法）。
 */
export function evaluateCondition(
  expression: ConditionExpression,
  context: NodeOutputContext
): boolean {
  const left = substituteVariables(expression.left ?? '', context);
  const right = expression.right
    ? substituteVariables(expression.right, context)
    : '';

  switch (expression.operator) {
    case 'eq':
      return left === right;
    case 'neq':
      return left !== right;
    case 'contains':
      return left.includes(right);
    case 'not_contains':
      return !left.includes(right);
    case 'empty':
      return left.trim().length === 0;
    case 'not_empty':
      return left.trim().length > 0;
    default:
      return false;
  }
}

/**
 * 求值条件表达式，返回 "true" / "false" 字符串。
 * 用于存入 context 供下游 {{condId.output}} 引用。
 */
export function evaluateConditionToString(
  expression: ConditionExpression,
  context: NodeOutputContext
): string {
  return evaluateCondition(expression, context) ? 'true' : 'false';
}
