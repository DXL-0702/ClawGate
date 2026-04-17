/**
 * DAG 节点间变量替换引擎
 *
 * 支持语法：{{nodeId.output}}
 * 示例：{{node-1.output}} 将被替换为 node-1 节点的执行输出。
 *
 * 安全规则：
 * - 仅替换 context 中存在的 nodeId（已完成执行的节点）
 * - 未知变量原样保留，不报错（容许部分替换）
 * - nodeId 只允许字母、数字、连字符、下划线（防止注入）
 */

/** 节点输出上下文，key 为 nodeId，value 为该节点的输出文本 */
export type NodeOutputContext = Record<string, string>;

const VARIABLE_PATTERN = /\{\{([a-zA-Z0-9_-]+)\.output\}\}/g;

/**
 * 将 prompt 中的 {{nodeId.output}} 占位符替换为对应节点的实际输出。
 *
 * @param prompt 原始 prompt 文本（可能含变量）
 * @param context 已执行节点的输出 Map
 * @returns 替换后的 prompt 文本
 */
export function substituteVariables(
  prompt: string,
  context: NodeOutputContext
): string {
  return prompt.replace(VARIABLE_PATTERN, (match, nodeId: string) => {
    if (Object.prototype.hasOwnProperty.call(context, nodeId)) {
      return context[nodeId]!;
    }
    // 未知变量原样保留
    return match;
  });
}

/**
 * 提取 prompt 中所有引用的 nodeId 列表。
 * 用于提前校验依赖节点是否存在。
 *
 * @param prompt 原始 prompt 文本
 * @returns 被引用的 nodeId 数组（去重）
 */
export function extractReferencedNodes(prompt: string): string[] {
  const refs = new Set<string>();
  let match: RegExpExecArray | null;
  const re = new RegExp(VARIABLE_PATTERN.source, 'g');
  while ((match = re.exec(prompt)) !== null) {
    refs.add(match[1]!);
  }
  return [...refs];
}
