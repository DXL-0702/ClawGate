/**
 * 团队实例健康面板 API
 *
 * 端点：
 * - GET /api/health/overview — 实例健康总览（聚合统计）
 * - GET /api/health/trends — 负载趋势（最近 1 小时）
 * - GET /api/alerts — 告警历史
 */

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { getDb, schema, getRedis } from '@clawgate/core';
import { eq, and, gte, desc } from 'drizzle-orm';

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

export const healthOverviewRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/health/overview — 实例健康总览
  app.get('/health/overview', async (req, reply) => {
    try {
      const member = await authenticateMember(req);
      const db = getDb();

      // 查询团队所有实例
      const instances = await db
        .select({
          id: schema.instances.id,
          name: schema.instances.name,
          environment: schema.instances.environment,
          status: schema.instances.status,
          version: schema.instances.version,
          platform: schema.instances.platform,
          lastHeartbeatAt: schema.instances.lastHeartbeatAt,
        })
        .from(schema.instances)
        .where(eq(schema.instances.teamId, member.teamId));

      // 聚合统计
      const stats = {
        total: instances.length,
        online: 0,
        offline: 0,
        error: 0,
        byEnvironment: {} as Record<string, { total: number; online: number; offline: number; error: number }>,
      };

      for (const inst of instances) {
        stats[inst.status]++;

        // 按环境分组
        const env = inst.environment || 'development';
        if (!stats.byEnvironment[env]) {
          stats.byEnvironment[env] = { total: 0, online: 0, offline: 0, error: 0 };
        }
        stats.byEnvironment[env].total++;
        stats.byEnvironment[env][inst.status]++;
      }

      // 获取每个 online 实例的实时负载
      const onlineInstances = instances.filter(i => i.status === 'online');
      const instancesWithLoad = await Promise.all(
        onlineInstances.map(async (inst) => {
          try {
            const redis = getRedis();
            const loadData = await redis.hgetall(`instance:load:${inst.id}`);
            return {
              ...inst,
              load: loadData && Object.keys(loadData).length > 0 ? {
                activeSessions: parseInt(loadData.activeSessions || '0', 10),
                queuedTasks: parseInt(loadData.queuedTasks || '0', 10),
                cpuUsage: parseInt(loadData.cpuUsage || '0', 10),
                memoryUsage: parseInt(loadData.memoryUsage || '0', 10),
                gatewayHealthy: loadData.gatewayHealthy === 'true',
                timestamp: loadData.timestamp,
              } : null,
            };
          } catch {
            return { ...inst, load: null };
          }
        })
      );

      return {
        stats,
        instances: instancesWithLoad,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Query failed';
      return reply.status(401).send({ error: msg });
    }
  });

  // GET /api/health/trends — 负载趋势（最近 1 小时，每 5 分钟一个点）
  app.get('/health/trends', async (req, reply) => {
    try {
      const member = await authenticateMember(req);
      const db = getDb();
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

      // 获取最近 1 小时有心跳数据的实例
      const recentInstances = await db
        .select({
          id: schema.instances.id,
          name: schema.instances.name,
          environment: schema.instances.environment,
        })
        .from(schema.instances)
        .where(
          and(
            eq(schema.instances.teamId, member.teamId),
            gte(schema.instances.lastHeartbeatAt, oneHourAgo)
          )
        );

      // 生成 12 个时间点（每 5 分钟）
      const points: { time: string; avgCpu: number; avgMemory: number; totalSessions: number }[] = [];
      const now = Date.now();

      for (let i = 11; i >= 0; i--) {
        const pointTime = new Date(now - i * 5 * 60 * 1000);
        const pointTimeISO = pointTime.toISOString();

        // 获取该时间点附近的所有实例负载
        let totalCpu = 0;
        let totalMemory = 0;
        let totalSessions = 0;
        let count = 0;

        for (const inst of recentInstances) {
          try {
            const redis = getRedis();
            const loadData = await redis.hgetall(`instance:load:${inst.id}`);
            if (loadData && loadData.timestamp) {
              const loadTime = new Date(loadData.timestamp).getTime();
              // 如果负载数据在 5 分钟内（允许 2 分钟误差）
              if (Math.abs(loadTime - pointTime.getTime()) < 7 * 60 * 1000) {
                totalCpu += parseInt(loadData.cpuUsage || '0', 10);
                totalMemory += parseInt(loadData.memoryUsage || '0', 10);
                totalSessions += parseInt(loadData.activeSessions || '0', 10);
                count++;
              }
            }
          } catch {
            // 忽略单个实例错误
          }
        }

        points.push({
          time: pointTimeISO,
          avgCpu: count > 0 ? Math.round(totalCpu / count) : 0,
          avgMemory: count > 0 ? Math.round(totalMemory / count) : 0,
          totalSessions,
        });
      }

      return {
        points,
        instanceCount: recentInstances.length,
        timeRange: { from: oneHourAgo, to: new Date().toISOString() },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Query failed';
      return reply.status(401).send({ error: msg });
    }
  });
};
