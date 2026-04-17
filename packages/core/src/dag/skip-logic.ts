/**
 * DAG 条件分支跳过逻辑
 *
 * 判断节点是否应被跳过：
 * - 所有入边的 source 均已 skipped → 跳过
 * - 入边来自条件节点的非活跃分支（sourceHandle 不匹配条件结果） → 跳过
 * - 根节点（无入边）永远不跳过
 */

import type { DagNodeDef } from './queue.js';

interface SkipEdge {
  source: string;
  target: string;
  sourceHandle?: string | null;
}

/**
 * 判断节点是否应被跳过。
 *
 * @param nodeId 当前节点 ID
 * @param edges 所有边
 * @param skippedNodes 已跳过的节点集合
 * @param conditionResults 条件节点的求值结果（nodeId → "true"/"false"）
 * @param nodeMap 节点 ID → 节点定义映射
 */
export function shouldSkipNode(
  nodeId: string,
  edges: SkipEdge[],
  skippedNodes: Set<string>,
  conditionResults: Record<string, string>,
  nodeMap: Map<string, DagNodeDef>
): boolean {
  const incomingEdges = edges.filter((e) => e.target === nodeId);

  // 根节点（无入边）永远不跳过
  if (incomingEdges.length === 0) return false;

  // 每条入边都需要检查：只要有一条"活跃"入边，就不跳过
  for (const edge of incomingEdges) {
    const sourceNode = nodeMap.get(edge.source);

    // source 已被跳过 → 这条边无效
    if (skippedNodes.has(edge.source)) continue;

    // source 是条件节点且有 sourceHandle → 检查分支是否匹配
    if (sourceNode?.type === 'condition' && edge.sourceHandle) {
      const condResult = conditionResults[edge.source];
      // 条件结果与 sourceHandle 匹配 → 活跃分支
      if (condResult === edge.sourceHandle) return false;
      // 不匹配 → 非活跃分支，继续检查其他入边
      continue;
    }

    // 普通边且 source 未 skipped → 活跃
    return false;
  }

  // 所有入边都无效（skipped 或非活跃分支）→ 跳过
  return true;
}
