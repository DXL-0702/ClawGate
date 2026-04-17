import { createHash } from 'node:crypto';

/**
 * 计算节点输出缓存键
 * 输入：agentId + '\n' + resolvedPrompt（变量替换后）
 * 输出：64 字符 hex SHA-256
 */
export function computeCacheKey(agentId: string, resolvedPrompt: string): string {
  return createHash('sha256').update(`${agentId}\n${resolvedPrompt}`).digest('hex');
}
