/**
 * DAG 拓扑排序引擎
 *
 * 使用 Kahn's BFS 算法，自然产生分层批次（同批次内节点可并行执行）。
 * 时间复杂度 O(V+E)，空间复杂度 O(V+E)。
 */

export interface DagEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export interface DagNode {
  id: string;
  [key: string]: unknown;
}

/**
 * 拓扑排序，返回分层批次。
 * 同一批次内的节点无相互依赖，可并行执行。
 * 不同批次之间严格有序，前一批次全部完成后才能执行下一批次。
 *
 * @param nodes DAG 节点列表
 * @param edges DAG 边列表（source → target 表示 source 必须先于 target 执行）
 * @returns 分层批次，每层是一组可并行执行的节点 ID
 * @throws 检测到循环依赖时抛出错误
 */
export function topologicalSort(
  nodes: DagNode[],
  edges: DagEdge[] = []
): string[][] {
  if (nodes.length === 0) return [];

  // 构建邻接表和入度表
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const node of nodes) {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }

  for (const edge of edges) {
    // 跳过引用了不存在节点的边（防御性处理）
    if (!inDegree.has(edge.source) || !inDegree.has(edge.target)) continue;

    adjacency.get(edge.source)!.push(edge.target);
    inDegree.set(edge.target, inDegree.get(edge.target)! + 1);
  }

  // Kahn's BFS：从所有入度为 0 的节点开始
  const batches: string[][] = [];
  let queue: string[] = [];

  for (const [nodeId, degree] of inDegree) {
    if (degree === 0) queue.push(nodeId);
  }

  let visited = 0;

  while (queue.length > 0) {
    // 当前批次（全部入度为 0，可并行）
    batches.push([...queue]);
    visited += queue.length;

    const nextQueue: string[] = [];

    for (const nodeId of queue) {
      for (const neighbor of adjacency.get(nodeId) ?? []) {
        const newDegree = inDegree.get(neighbor)! - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) nextQueue.push(neighbor);
      }
    }

    queue = nextQueue;
  }

  // 若访问节点数 < 总节点数，说明存在循环依赖
  if (visited < nodes.length) {
    const cycleNodes = [...inDegree.entries()]
      .filter(([, degree]) => degree > 0)
      .map(([id]) => id);
    throw new Error(
      `DAG contains cycle involving nodes: [${cycleNodes.join(', ')}]`
    );
  }

  return batches;
}

/**
 * 仅检测循环依赖，不返回排序结果。
 * 适合在保存 DAG 定义时进行校验。
 *
 * @returns true 表示存在循环依赖
 */
export function hasCycle(nodes: DagNode[], edges: DagEdge[]): boolean {
  try {
    topologicalSort(nodes, edges);
    return false;
  } catch {
    return true;
  }
}
