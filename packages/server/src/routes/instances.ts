/**
 * 实例管理 API — 支持双模式（个人/团队）
 *
 * 端点：
 * - POST /api/instances/register  — 实例注册
 * - POST /api/instances/:id/heartbeat — 心跳上报
 * - GET  /api/instances           — 列表查询
 * - GET  /api/instances/:id       — 详情查询
 * - GET  /api/instances/:id/load — 负载查询
 * - DELETE /api/instances/:id     — 注销实例
 */

import type { FastifyPluginAsync } from 'fastify';
import { getDb, schema, getAuthContext, PERSONAL_TEAM_ID } from '@clawgate/core';
import { eq, and, or, isNull } from 'drizzle-orm';

interface RegisterBody {
  name: string;
  gatewayUrl: string;
  gatewayToken: string;
  version?: string;
  platform?: string;
  pid?: number;
  environment?: 'development' | 'staging' | 'production';
  tags?: string[];
}

interface HeartbeatBody {
  version?: string;
  platform?: string;
  pid?: number;
  activeSessions?: number;
  queuedTasks?: number;
  cpuUsage?: number;
  memoryUsage?: number;
  gatewayHealthy?: boolean;
}

export const instanceRoutes: FastifyPluginAsync = async (app) => {

  // POST /api/instances/register — 实例注册
  // 个人模式：无需 API Key，注册到 teamId = 'local'
  // 团队模式：需要 API Key，注册到所属 team
  app.post<{ Body: RegisterBody }>('/instances/register', async (req, reply) => {
    try {
      const auth = await getAuthContext(req.headers);
      const db = getDb();
      const now = new Date().toISOString();

      const { name, gatewayUrl, gatewayToken, version, platform, pid, environment, tags } = req.body;

      if (!name || !gatewayUrl || !gatewayToken) {
        return reply.status(400).send({ error: 'Missing required fields: name, gatewayUrl, gatewayToken' });
      }

      if (environment && !['development', 'staging', 'production'].includes(environment)) {
        return reply.status(400).send({ error: 'environment must be one of: development, staging, production' });
      }

      // 团队模式：检查同成员下是否有同名实例
      // 个人模式：不检查（每个实例只属于 'local'）
      if (auth.mode === 'team') {
        const [existing] = await db
          .select()
          .from(schema.instances)
          .where(and(
            eq(schema.instances.memberId, auth.memberId!),
            eq(schema.instances.name, name)
          ));

        if (existing) {
          // 重新注册，更新连接信息
          const updates: Record<string, unknown> = {
            gatewayUrl,
            gatewayToken,
            status: 'online',
            lastHeartbeatAt: now,
            version: version || existing.version,
            platform: platform || existing.platform,
            pid: pid || existing.pid,
            updatedAt: now,
          };
          if (environment) updates.environment = environment;
          if (tags !== undefined) updates.tags = JSON.stringify(tags);

          await db.update(schema.instances).set(updates).where(eq(schema.instances.id, existing.id));

          return { instanceId: existing.id, heartbeatIntervalSec: 10, message: 'Instance re-registered' };
        }
      }

      // 创建新实例
      const instanceId = crypto.randomUUID();
      await db.insert(schema.instances).values({
        id: instanceId,
        teamId: auth.teamId,
        memberId: auth.mode === 'team' ? auth.memberId! : 'local',
        name,
        environment: environment || 'development',
        tags: tags ? JSON.stringify(tags) : null,
        gatewayUrl,
        gatewayToken,
        status: 'online',
        lastHeartbeatAt: now,
        version: version || null,
        platform: platform || null,
        pid: pid || null,
        createdAt: now,
        updatedAt: now,
      });

      return { instanceId, heartbeatIntervalSec: 10, message: 'Instance registered successfully' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Registration failed';
      req.log.error({ err: msg }, 'Instance registration failed');
      return reply.status(401).send({ error: msg });
    }
  });

  // POST /api/instances/:id/heartbeat — 心跳上报
  app.post<{ Params: { id: string }; Body: HeartbeatBody }>('/instances/:id/heartbeat', async (req, reply) => {
    try {
      await getAuthContext(req.headers); // 校验（团队模式）或直接通过（个人模式）
      const db = getDb();
      const now = new Date().toISOString();

      const { version, platform, pid, activeSessions, queuedTasks, cpuUsage, memoryUsage, gatewayHealthy } = req.body;

      const updates: Record<string, unknown> = {
        status: gatewayHealthy === false ? 'error' : 'online',
        lastHeartbeatAt: now,
        updatedAt: now,
      };
      if (version !== undefined) updates.version = version;
      if (platform !== undefined) updates.platform = platform;
      if (pid !== undefined) updates.pid = pid;

      await db.update(schema.instances).set(updates).where(eq(schema.instances.id, req.params.id));

      // 存储负载信息到 Redis
      try {
        const { getRedis } = await import('@clawgate/core');
        const redis = getRedis();
        const loadKey = `instance:load:${req.params.id}`;
        await redis.hset(loadKey, {
          activeSessions: activeSessions?.toString() || '0',
          queuedTasks: queuedTasks?.toString() || '0',
          cpuUsage: cpuUsage?.toString() || '0',
          memoryUsage: memoryUsage?.toString() || '0',
          gatewayHealthy: gatewayHealthy === false ? 'false' : 'true',
          timestamp: now,
        });
        await redis.expire(loadKey, 20);
      } catch (redisErr) {
        req.log.warn({ err: redisErr }, 'Failed to store load info to Redis');
      }

      return { success: true, timestamp: now, status: updates.status };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Heartbeat failed';
      return reply.status(401).send({ error: msg });
    }
  });

  // GET /api/instances — 列表查询
  app.get<{ Querystring: { environment?: 'development' | 'staging' | 'production'; tag?: string } }>('/instances', async (req, reply) => {
    try {
      const auth = await getAuthContext(req.headers);
      const db = getDb();

      // 个人模式：显示 teamId = 'local' 的实例
      // 团队模式：显示同 team 所有实例
      let instancesQuery = db
        .select({
          id: schema.instances.id,
          name: schema.instances.name,
          environment: schema.instances.environment,
          tags: schema.instances.tags,
          status: schema.instances.status,
          version: schema.instances.version,
          platform: schema.instances.platform,
          lastHeartbeatAt: schema.instances.lastHeartbeatAt,
          createdAt: schema.instances.createdAt,
        })
        .from(schema.instances);

      if (auth.mode === 'personal') {
        instancesQuery = instancesQuery.where(
          or(isNull(schema.instances.teamId), eq(schema.instances.teamId, PERSONAL_TEAM_ID))
        ) as typeof instancesQuery;
      } else {
        instancesQuery = instancesQuery.where(eq(schema.instances.teamId, auth.teamId)) as typeof instancesQuery;
      }

      // Issue 9: 按环境过滤
      if (req.query.environment) {
        instancesQuery = instancesQuery.where(eq(schema.instances.environment, req.query.environment)) as typeof instancesQuery;
      }

      const instances = await instancesQuery.orderBy(schema.instances.createdAt);

      // Issue 9: 按标签过滤（内存过滤）
      let filteredInstances = instances;
      if (req.query.tag) {
        filteredInstances = instances.filter((i) => {
          if (!i.tags) return false;
          try {
            const tags = JSON.parse(i.tags) as string[];
            return tags.includes(req.query.tag!);
          } catch {
            return false;
          }
        });
      }

      return {
        instances: filteredInstances.map((i) => ({
          ...i,
          tags: i.tags ? (JSON.parse(i.tags) as string[]) : undefined,
          status: i.status as 'online' | 'offline' | 'error',
        })),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Query failed';
      return reply.status(401).send({ error: msg });
    }
  });

  // GET /api/instances/:id — 详情查询
  app.get<{ Params: { id: string } }>('/instances/:id', async (req, reply) => {
    try {
      const auth = await getAuthContext(req.headers);
      const db = getDb();

      const [instance] = await db.select().from(schema.instances).where(eq(schema.instances.id, req.params.id));
      if (!instance) return reply.status(404).send({ error: 'Instance not found' });

      // 团队模式下校验 teamId
      if (auth.mode === 'team' && instance.teamId !== auth.teamId) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      // 团队模式下 member 只能看自己的实例
      if (auth.mode === 'team' && instance.memberId !== auth.memberId) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      return {
        id: instance.id,
        name: instance.name,
        environment: instance.environment,
        tags: instance.tags ? (JSON.parse(instance.tags) as string[]) : undefined,
        status: instance.status,
        gatewayUrl: instance.gatewayUrl,
        version: instance.version,
        platform: instance.platform,
        pid: instance.pid,
        lastHeartbeatAt: instance.lastHeartbeatAt,
        createdAt: instance.createdAt,
        updatedAt: instance.updatedAt,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Query failed';
      return reply.status(401).send({ error: msg });
    }
  });

  // GET /api/instances/:id/load — 负载查询
  app.get<{ Params: { id: string } }>('/instances/:id/load', async (req, reply) => {
    try {
      const auth = await getAuthContext(req.headers);
      const db = getDb();

      const [instance] = await db
        .select({ teamId: schema.instances.teamId, memberId: schema.instances.memberId })
        .from(schema.instances)
        .where(eq(schema.instances.id, req.params.id));

      if (!instance) return reply.status(404).send({ error: 'Instance not found' });

      // 团队模式下校验权限
      if (auth.mode === 'team') {
        if (instance.teamId !== auth.teamId) return reply.status(403).send({ error: 'Access denied' });
        if (instance.memberId !== auth.memberId) return reply.status(403).send({ error: 'Access denied' });
      }

      try {
        const { getRedis } = await import('@clawgate/core');
        const redis = getRedis();
        const loadKey = `instance:load:${req.params.id}`;
        const loadData = await redis.hgetall(loadKey);

        if (Object.keys(loadData).length === 0) {
          return reply.status(404).send({ error: 'Load data not available (instance may be offline)' });
        }

        return {
          instanceId: req.params.id,
          activeSessions: parseInt(loadData.activeSessions || '0', 10),
          queuedTasks: parseInt(loadData.queuedTasks || '0', 10),
          cpuUsage: parseInt(loadData.cpuUsage || '0', 10),
          memoryUsage: parseInt(loadData.memoryUsage || '0', 10),
          gatewayHealthy: loadData.gatewayHealthy === 'true',
          timestamp: loadData.timestamp,
        };
      } catch (redisErr) {
        return reply.status(503).send({ error: 'Failed to retrieve load data from Redis' });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Query failed';
      return reply.status(401).send({ error: msg });
    }
  });

  // DELETE /api/instances/:id — 注销实例
  app.delete<{ Params: { id: string } }>('/instances/:id', async (req, reply) => {
    try {
      const auth = await getAuthContext(req.headers);
      const db = getDb();

      const [instance] = await db.select().from(schema.instances).where(eq(schema.instances.id, req.params.id));
      if (!instance) return reply.status(404).send({ error: 'Instance not found' });

      // 团队模式下校验权限
      if (auth.mode === 'team') {
        // admin 或所有者
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const member = await db.select().from(schema.members).where(eq(schema.members.id, auth.memberId!)).then((r: any[]) => r[0]);
        if (member?.role !== 'admin' && instance.memberId !== auth.memberId) {
          return reply.status(403).send({ error: 'Access denied' });
        }
      }

      await db.delete(schema.instances).where(eq(schema.instances.id, req.params.id));

      try {
        const { getRedis } = await import('@clawgate/core');
        const redis = getRedis();
        await redis.del(`instance:load:${req.params.id}`);
      } catch {
        // ignore
      }

      return { success: true, message: 'Instance unregistered' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Delete failed';
      return reply.status(401).send({ error: msg });
    }
  });
};
