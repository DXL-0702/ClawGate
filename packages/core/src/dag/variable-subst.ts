/**
 * DAG 节点间变量替换引擎
 *
 * 支持语法：
 * - {{nodeId.output}}            上游节点的输出
 * - {{webhookPayload}}           整个 webhook body 的 JSON 字符串
 * - {{webhookPayload.path.to}}   webhook body 中的嵌套路径
 *
 * 安全规则：
 * - 仅替换 context / payload 中存在的值
 * - 未知变量原样保留，不报错（容许部分替换）
 * - 标识符仅允许字母、数字、连字符、下划线（防止注入）
 */

/** 节点输出上下文，key 为 nodeId，value 为该节点的输出文本 */
export type NodeOutputContext = Record<string, string>;

const NODE_OUTPUT_PATTERN = /\{\{([a-zA-Z0-9_-]+)\.output\}\}/g;
const WEBHOOK_PATTERN = /\{\{webhookPayload((?:\.[a-zA-Z0-9_]+)*)\}\}/g;

/**
 * 按点分路径取嵌套值（不支持数组索引）
 * 例：getValueByPath({a:{b:1}}, 'a.b') === 1
 */
function getValueByPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  const parts = path.split('.').filter(Boolean);
  let cur: unknown = obj;
  for (const key of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/** 将任意 JSON 值序列化为字符串（用于 prompt 替换） */
function serializeValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  // 对象 / 数组
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

/**
 * 将 prompt 中的 {{nodeId.output}} 与 {{webhookPayload[.path]}} 占位符替换为实际值。
 *
 * @param prompt 原始 prompt 文本（可能含变量）
 * @param context 已执行节点的输出 Map
 * @param webhookPayload Webhook 触发时的 request body（其他触发方式为 undefined）
 * @returns 替换后的 prompt 文本
 */
export function substituteVariables(
  prompt: string,
  context: NodeOutputContext,
  webhookPayload?: unknown,
): string {
  // 1. 替换节点输出
  let result = prompt.replace(NODE_OUTPUT_PATTERN, (match, nodeId: string) => {
    if (Object.prototype.hasOwnProperty.call(context, nodeId)) {
      return context[nodeId]!;
    }
    return match; // 未知变量原样保留
  });

  // 2. 替换 webhookPayload
  if (webhookPayload !== undefined) {
    result = result.replace(WEBHOOK_PATTERN, (match, pathPart: string) => {
      // pathPart 形如 "" 或 ".user.email"
      const path = pathPart.replace(/^\./, '');
      const value = getValueByPath(webhookPayload, path);
      if (value === undefined) return match; // 路径不存在，原样保留
      return serializeValue(value);
    });
  }

  return result;
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
  const re = new RegExp(NODE_OUTPUT_PATTERN.source, 'g');
  while ((match = re.exec(prompt)) !== null) {
    refs.add(match[1]!);
  }
  return [...refs];
}
