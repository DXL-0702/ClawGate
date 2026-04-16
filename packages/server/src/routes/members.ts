/**
 * 成员管理 API
 *
 * 端点：
 * - POST /api/members         — 添加成员（admin 权限）
 * - GET  /api/members         — 列出团队成员
 * - GET  /api/members/me      — 获取当前成员信息
 * - DELETE /api/members/:id   — 移除成员（admin 权限）
 */

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { getDb, schema } from '@clawgate/core';
import { eq, and } from 'drizzle-orm';

// 生成随机 API Key
function generateApiKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let key = 'cg_';
  for (let i = 0; i < 32; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return key;
}

// 认证中间件
async function authenticateMember(req: FastifyRequest) {
  const apiKey = req.headers['x-api-key'] as string | undefined;
  if (!apiKey) {
    throw new Error('Missing X-API-Key header');
  }

  const db = getDb();
  const [member] = await db
    .select()
    .from(schema.members)
    .where(eq(schema.members.apiKey, apiKey));

  if (!member) {
    throw new Error('Invalid API key');
  }

  return member;
}

interface CreateMemberBody {
  email: string;
  name?: string;
  role?: 'admin' | 'member';
}

export const memberRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/members — 添加成员（仅 admin）
  app.post<{ Body: CreateMemberBody }>('/members', async (req, reply) => {
    try {
      const adminMember = await authenticateMember(req);

      // 权限检查
      if (adminMember.role !== 'admin') {
        return reply.status(403).send({ error: 'Admin access required' });
      }

      const { email, name, role = 'member' } = req.body;

      // 验证
      if (!email || !email.includes('@')) {
        return reply.status(400).send({ error: 'Valid email is required' });
      }
      if (!['admin', 'member'].includes(role)) {
        return reply.status(400).send({ error: 'Role must be admin or member' });
      }

      const db = getDb();
      const now = new Date().toISOString();

      // 检查邮箱是否已存在（全局唯一）
      const [existing] = await db
        .select()
        .from(schema.members)
        .where(eq(schema.members.email, email));

      if (existing) {
        return reply.status(409).send({ error: 'Email already registered' });
      }

      // 创建成员
      const memberId = crypto.randomUUID();
      const apiKey = generateApiKey();

      await db.insert(schema.members).values({
        id: memberId,
        teamId: adminMember.teamId,
        email,
        name: name?.trim() || email.split('@')[0],
        role,
        apiKey,
        createdAt: now,
      });

      return {
        member: {
          id: memberId,
          email,
          name: name?.trim() || email.split('@')[0],
          role,
          apiKey, // 首次创建时返回
          createdAt: now,
        },
        message: 'Member added successfully. Save the API key — it will not be shown again.',
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to add member';
      return reply.status(401).send({ error: msg });
    }
  });

  // GET /api/members — 列出团队成员
  app.get('/members', async (req, reply) => {
    try {
      const member = await authenticateMember(req);
      const db = getDb();

      // admin 看所有，member 只看自己和基本信息
      const members = await db
        .select({
          id: schema.members.id,
          email: schema.members.email,
          name: schema.members.name,
          role: schema.members.role,
          createdAt: schema.members.createdAt,
        })
        .from(schema.members)
        .where(eq(schema.members.teamId, member.teamId))
        .orderBy(schema.members.createdAt);

      return { members };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to list members';
      return reply.status(401).send({ error: msg });
    }
  });

  // GET /api/members/me — 获取当前成员信息（包含 API Key）
  app.get('/members/me', async (req, reply) => {
    try {
      const member = await authenticateMember(req);

      return {
        id: member.id,
        email: member.email,
        name: member.name,
        role: member.role,
        teamId: member.teamId,
        apiKey: member.apiKey, // 仅自己可见
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Authentication failed';
      return reply.status(401).send({ error: msg });
    }
  });

  // DELETE /api/members/:id — 移除成员（admin 权限，不能移除自己）
  app.delete<{ Params: { id: string } }>('/members/:id', async (req, reply) => {
    try {
      const adminMember = await authenticateMember(req);

      // 权限检查
      if (adminMember.role !== 'admin') {
        return reply.status(403).send({ error: 'Admin access required' });
      }

      // 不能移除自己
      if (adminMember.id === req.params.id) {
        return reply.status(400).send({ error: 'Cannot remove yourself' });
      }

      const db = getDb();

      // 检查目标成员是否存在且在同一团队
      const [targetMember] = await db
        .select()
        .from(schema.members)
        .where(
          and(
            eq(schema.members.id, req.params.id),
            eq(schema.members.teamId, adminMember.teamId)
          )
        );

      if (!targetMember) {
        return reply.status(404).send({ error: 'Member not found' });
      }

      // 移除成员（级联删除其注册的 instances）
      await db
        .delete(schema.members)
        .where(eq(schema.members.id, req.params.id));

      return {
        success: true,
        message: `Member ${targetMember.email} removed successfully`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to remove member';
      return reply.status(401).send({ error: msg });
    }
  });
};
