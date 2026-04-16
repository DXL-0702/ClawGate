/**
 * 团队管理 API
 *
 * 端点：
 * - POST /api/teams         — 创建团队（初始用户）
 * - GET  /api/teams/:id     — 获取团队信息
 * - PATCH /api/teams/:id    — 更新团队设置
 */

import type { FastifyPluginAsync } from 'fastify';
import { getDb, schema } from '@clawgate/core';
import { eq, sql } from 'drizzle-orm';

interface CreateTeamBody {
  name: string;
  slug: string;
  ownerEmail: string;
  ownerName?: string;
}

interface UpdateTeamBody {
  name?: string;
}

// 生成随机 API Key
function generateApiKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let key = 'cg_';
  for (let i = 0; i < 32; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return key;
}

export const teamRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/teams — 创建团队（同时创建 owner 成员）
  app.post<{ Body: CreateTeamBody }>('/teams', async (req, reply) => {
    const db = getDb();
    const now = new Date().toISOString();

    const { name, slug, ownerEmail, ownerName } = req.body;

    // 验证
    if (!name || !name.trim()) {
      return reply.status(400).send({ error: 'Team name is required' });
    }
    if (!slug || !slug.trim()) {
      return reply.status(400).send({ error: 'Team slug is required' });
    }
    if (!ownerEmail || !ownerEmail.includes('@')) {
      return reply.status(400).send({ error: 'Valid owner email is required' });
    }

    // 验证 slug 格式（只允许字母、数字、连字符）
    if (!/^[a-z0-9-]+$/.test(slug)) {
      return reply.status(400).send({
        error: 'Slug must contain only lowercase letters, numbers, and hyphens',
      });
    }

    try {
      // 检查 slug 是否已存在
      const [existingSlug] = await db
        .select()
        .from(schema.teams)
        .where(eq(schema.teams.slug, slug));

      if (existingSlug) {
        return reply.status(409).send({ error: 'Team slug already exists' });
      }

      // 检查 ownerEmail 是否已存在（简化：全局唯一）
      const [existingEmail] = await db
        .select()
        .from(schema.members)
        .where(eq(schema.members.email, ownerEmail));

      if (existingEmail) {
        return reply.status(409).send({
          error: 'Email already registered. Please use a different email.',
        });
      }

      // 创建团队
      const teamId = crypto.randomUUID();
      const ownerId = crypto.randomUUID();

      await db.insert(schema.teams).values({
        id: teamId,
        name: name.trim(),
        slug: slug.trim(),
        ownerId,
        createdAt: now,
      });

      // 创建 owner 成员
      const apiKey = generateApiKey();
      await db.insert(schema.members).values({
        id: ownerId,
        teamId,
        email: ownerEmail,
        name: ownerName?.trim() || ownerEmail.split('@')[0],
        role: 'admin',
        apiKey,
        createdAt: now,
      });

      return {
        team: {
          id: teamId,
          name: name.trim(),
          slug: slug.trim(),
          ownerId,
          createdAt: now,
        },
        owner: {
          id: ownerId,
          email: ownerEmail,
          name: ownerName?.trim() || ownerEmail.split('@')[0],
          role: 'admin',
          apiKey, // 首次创建时返回，之后不再显示
        },
        message: 'Team created successfully. Save the API key — it will not be shown again.',
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create team';
      req.log.error({ err: msg }, 'Team creation failed');
      return reply.status(500).send({ error: msg });
    }
  });

  // GET /api/teams/:id — 获取团队信息
  app.get<{ Params: { id: string } }>('/teams/:id', async (req, reply) => {
    const db = getDb();

    const [team] = await db
      .select({
        id: schema.teams.id,
        name: schema.teams.name,
        slug: schema.teams.slug,
        ownerId: schema.teams.ownerId,
        createdAt: schema.teams.createdAt,
      })
      .from(schema.teams)
      .where(eq(schema.teams.id, req.params.id));

    if (!team) {
      return reply.status(404).send({ error: 'Team not found' });
    }

    // 获取成员数量
    const [memberCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.members)
      .where(eq(schema.members.teamId, team.id));

    // 获取实例数量
    const [instanceCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.instances)
      .where(eq(schema.instances.teamId, team.id));

    return {
      ...team,
      memberCount: memberCount?.count || 0,
      instanceCount: instanceCount?.count || 0,
    };
  });

  // PATCH /api/teams/:id — 更新团队设置（仅 admin）
  app.patch<{ Params: { id: string }; Body: UpdateTeamBody }>(
    '/teams/:id',
    async (req, reply) => {
      const db = getDb();
      const now = new Date().toISOString();

      // 简单权限检查：需要 X-API-Key 且是 team admin
      const apiKey = req.headers['x-api-key'] as string | undefined;
      if (!apiKey) {
        return reply.status(401).send({ error: 'Missing X-API-Key' });
      }

      const [member] = await db
        .select()
        .from(schema.members)
        .where(eq(schema.members.apiKey, apiKey));

      if (!member || member.role !== 'admin') {
        return reply.status(403).send({ error: 'Admin access required' });
      }

      if (member.teamId !== req.params.id) {
        return reply.status(403).send({ error: 'Cannot modify other teams' });
      }

      const [team] = await db
        .select()
        .from(schema.teams)
        .where(eq(schema.teams.id, req.params.id));

      if (!team) {
        return reply.status(404).send({ error: 'Team not found' });
      }

      const updates: Record<string, unknown> = { updatedAt: now };
      if (req.body.name) {
        updates.name = req.body.name.trim();
      }

      await db
        .update(schema.teams)
        .set(updates)
        .where(eq(schema.teams.id, req.params.id));

      return { success: true, team: { ...team, ...updates } };
    }
  );
};
