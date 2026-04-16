/**
 * 告警管理 API
 *
 * 端点：
 * - GET  /api/alerts              — 告警列表（支持过滤）
 * - GET  /api/alerts/:id          — 告警详情
 * - POST /api/alerts/:id/ack      — 确认告警
 * - POST /api/alerts/webhook      — 配置 Webhook 通知（admin 权限）
 */

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { getDb, schema } from '@clawgate/core';
import { eq, and, desc, asc } from 'drizzle-orm';

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

export const alertRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/alerts — 告警列表
  app.get<{
    Querystring: {
      acknowledged?: 'true' | 'false';
      severity?: 'critical' | 'warning' | 'info';
      type?: string;
      limit?: string;
    };
  }>('/alerts', async (req, reply) => {
    try {
      const member = await authenticateMember(req);
      const db = getDb();

      const { acknowledged, severity, type, limit = '50' } = req.query;

      // 构建查询条件数组
      const conditions: ReturnType<typeof eq>[] = [
        eq(schema.alerts.teamId, member.teamId),
      ];

      if (acknowledged !== undefined) {
        conditions.push(eq(schema.alerts.acknowledged, acknowledged === 'true'));
      }

      if (severity) {
        conditions.push(eq(schema.alerts.severity, severity));
      }

      if (type) {
        conditions.push(eq(schema.alerts.type, type as 'offline' | 'error' | 'high_load' | 'gateway_unhealthy'));
      }

      const alerts = await db
        .select({
          id: schema.alerts.id,
          instanceId: schema.alerts.instanceId,
          type: schema.alerts.type,
          severity: schema.alerts.severity,
          message: schema.alerts.message,
          acknowledged: schema.alerts.acknowledged,
          createdAt: schema.alerts.createdAt,
        })
        .from(schema.alerts)
        .where(and(...conditions))
        .orderBy(desc(schema.alerts.createdAt))
        .limit(parseInt(limit, 10));

      // 统计未确认告警数
      const [unackCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(schema.alerts)
        .where(
          and(
            eq(schema.alerts.teamId, member.teamId),
            eq(schema.alerts.acknowledged, false)
          )
        );

      return {
        alerts: alerts.map((a) => ({
          ...a,
          acknowledged: !!a.acknowledged,
        })),
        unacknowledgedCount: unackCount?.count || 0,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Query failed';
      return reply.status(401).send({ error: msg });
    }
  });

  // GET /api/alerts/:id — 告警详情
  app.get<{ Params: { id: string } }>('/alerts/:id', async (req, reply) => {
    try {
      const member = await authenticateMember(req);
      const db = getDb();

      const [alert] = await db
        .select()
        .from(schema.alerts)
        .where(eq(schema.alerts.id, req.params.id));

      if (!alert) {
        return reply.status(404).send({ error: 'Alert not found' });
      }

      // 权限检查
      if (alert.teamId !== member.teamId) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      return {
        ...alert,
        acknowledged: !!alert.acknowledged,
        details: alert.details ? JSON.parse(alert.details) : null,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Query failed';
      return reply.status(401).send({ error: msg });
    }
  });

  // POST /api/alerts/:id/ack — 确认告警
  app.post<{ Params: { id: string } }>('/alerts/:id/ack', async (req, reply) => {
    try {
      const member = await authenticateMember(req);
      const db = getDb();
      const now = new Date().toISOString();

      const [alert] = await db
        .select({
          id: schema.alerts.id,
          teamId: schema.alerts.teamId,
          acknowledged: schema.alerts.acknowledged,
        })
        .from(schema.alerts)
        .where(eq(schema.alerts.id, req.params.id));

      if (!alert) {
        return reply.status(404).send({ error: 'Alert not found' });
      }

      if (alert.teamId !== member.teamId) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      if (alert.acknowledged) {
        return reply.status(400).send({ error: 'Alert already acknowledged' });
      }

      await db
        .update(schema.alerts)
        .set({
          acknowledged: true,
          acknowledgedBy: member.id,
          acknowledgedAt: now,
        })
        .where(eq(schema.alerts.id, req.params.id));

      return {
        success: true,
        message: 'Alert acknowledged',
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Acknowledgement failed';
      return reply.status(401).send({ error: msg });
    }
  });
};

// 需要导入 sql helper
import { sql } from 'drizzle-orm';
