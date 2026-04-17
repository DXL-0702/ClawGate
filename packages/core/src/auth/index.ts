/**
 * 双模式认证辅助函数
 *
 * 根据请求是否携带 X-API-Key 自动区分模式：
 * - 无 API Key → 个人模式（teamId = 'local'）
 * - 有 API Key → 团队模式（从 members 表查询）
 */

import { getDb, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';

/** 个人模式的固定 teamId */
export const PERSONAL_TEAM_ID = 'local';

/** 认证上下文 */
export interface AuthContext {
  mode: 'personal' | 'team';
  teamId: string;
  memberId?: string;
  apiKey?: string;
}

/**
 * 从请求头中获取认证上下文
 *
 * @param headers 请求头对象
 * @returns 认证上下文（个人模式或团队模式）
 * @throws 有 API Key 但无效时抛出错误
 */
export async function getAuthContext(headers: Record<string, string | string[] | undefined>): Promise<AuthContext> {
  const apiKey = headers['x-api-key'] as string | undefined;

  // 个人模式：无 API Key
  if (!apiKey) {
    return {
      mode: 'personal',
      teamId: PERSONAL_TEAM_ID,
    };
  }

  // 团队模式：校验 API Key
  const db = getDb();
  const [member] = await db
    .select()
    .from(schema.members)
    .where(eq(schema.members.apiKey, apiKey));

  if (!member) {
    throw new Error('Invalid API key');
  }

  return {
    mode: 'team',
    teamId: member.teamId,
    memberId: member.id,
    apiKey,
  };
}
