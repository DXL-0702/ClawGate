/**
 * 团队部署架构 - OpenClaw 实例管理 API
 *
 * 端点：
 * - POST /api/instances/register  — 实例注册（成员认证）
 * - POST /api/instances/:id/heartbeat — 心跳上报
 * - GET  /api/instances           — 列表查询（成员权限）
 * - GET  /api/instances/:id       — 详情查询
 * - DELETE /api/instances/:id     — 注销实例（admin 或所有者）
 */

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { getDb, schema } from '@clawgate/core';
import { eq, and } from 'drizzle-orm';

// 认证中间件：从 X-API-Key 获取成员信息
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

// 注册请求体验证
interface RegisterBody {
  name: string;
  gatewayUrl: string;
  gatewayToken: string;
  version?: string;
  platform?: string;
  pid?: number;
  // Issue 9: 环境分组
  environment?: 'development' | 'staging' | 'production';
  tags?: string[];
}

// 心跳请求体验证
interface HeartbeatBody {
  version?: string;
  platform?: string;
  pid?: number;
  // 负载信息（新增）
  activeSessions?: number;      // 当前活跃 Session 数
  queuedTasks?: number;         // 队列等待任务
  cpuUsage?: number;            // CPU 使用率 0-100
  memoryUsage?: number;         // MB 已用内存
  gatewayHealthy?: boolean;     // Gateway 自检状态
}

export const instanceRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/instances/register — 实例注册
  app.post<{ Body: RegisterBody }>(
    '/instances/register',
    async (req, reply) => {
      try {
        const member = await authenticateMember(req);
        const db = getDb();
        const now = new Date().toISOString();

        const { name, gatewayUrl, gatewayToken, version, platform, pid, environment, tags } = req.body;

        // 验证必填字段
        if (!name || !gatewayUrl || !gatewayToken) {
          return reply.status(400).send({
            error: 'Missing required fields: name, gatewayUrl, gatewayToken',
          });
        }

        // 验证 environment 值
        if (environment && !['development', 'staging', 'production'].includes(environment)) {
          return reply.status(400).send({
            error: 'environment must be one of: development, staging, production',
          });
        }

        // 检查同成员下是否有同名实例
        const [existing] = await db
          .select()
          .from(schema.instances)
          .where(
            and(
              eq(schema.instances.memberId, member.id),
              eq(schema.instances.name, name)
            )
          );

        if (existing) {
          // 同名实例存在，更新连接信息（视为重新注册）
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
          // Issue 9: 更新环境信息（如果提供）
          if (environment) updates.environment = environment;
          if (tags !== undefined) updates.tags = JSON.stringify(tags);

          await db
            .update(schema.instances)
            .set(updates)
            .where(eq(schema.instances.id, existing.id));

          return {
            instanceId: existing.id,
            heartbeatIntervalSec: 10,
            message: 'Instance re-registered',
          };
        }

        // 创建新实例记录
        const instanceId = crypto.randomUUID();
        await db.insert(schema.instances).values({
          id: instanceId,
          teamId: member.teamId,
          memberId: member.id,
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

        return {
          instanceId,
          heartbeatIntervalSec: 10,
          message: 'Instance registered successfully',
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Registration failed';
        req.log.error({ err: msg }, 'Instance registration failed');
        return reply.status(401).send({ error: msg });
      }
    }
  );

  // POST /api/instances/:id/heartbeat — 心跳上报
  app.post<{ Params: { id: string }; Body: HeartbeatBody }>(
    '/instances/:id/heartbeat',
    async (req, reply) => {
      try {
        await authenticateMember(req);
        const db = getDb();
        const now = new Date().toISOString();

        const { version, platform, pid, activeSessions, queuedTasks, cpuUsage, memoryUsage, gatewayHealthy } = req.body;

        // 更新心跳时间和状态
        const updates: Record<string, unknown> = {
          status: gatewayHealthy === false ? 'error' : 'online',
          lastHeartbeatAt: now,
          updatedAt: now,
        };
        if (version !== undefined) updates.version = version;
        if (platform !== undefined) updates.platform = platform;
        if (pid !== undefined) updates.pid = pid;

        await db
          .update(schema.instances)
          .set(updates)
          .where(eq(schema.instances.id, req.params.id));

        // 存储负载信息到 Redis（供 GatewayPool 查询）
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
          // 设置 20 秒 TTL，超时未更新视为 offline
          await redis.expire(loadKey, 20);
        } catch (redisErr) {
          // Redis 失败不阻塞心跳响应
          req.log.warn({ err: redisErr }, 'Failed to store load info to Redis');
        }

        return {
          success: true,
          timestamp: now,
          status: updates.status,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Heartbeat failed';
        return reply.status(401).send({ error: msg });
      }
    }
  );

  // GET /api/instances — 查询当前成员的实例列表
  // 支持查询参数：?environment=development|staging|production&tag=xxx
  app.get<{
    Querystring: {
      environment?: 'development' | 'staging' | 'production';
      tag?: string;
    };
  }>('/instances', async (req, reply) => {
    try {
      const member = await authenticateMember(req);
      const db = getDb();

      // 构建查询条件数组
      const conditions: ReturnType<typeof eq>[] = [
        member.role === 'admin'
          ? eq(schema.instances.teamId, member.teamId)
          : eq(schema.instances.memberId, member.id),
      ];

      // Issue 9: 按环境过滤
      if (req.query.environment) {
        conditions.push(eq(schema.instances.environment, req.query.environment));
      }

      const instances = await db
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
        .from(schema.instances)
        .where(and(...conditions))
        .orderBy(schema.instances.createdAt);

      // Issue 9: 按标签过滤（内存过滤，因为 tags 是 JSON 存储）
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
          tags: i.tags ? JSON.parse(i.tags) as string[] : undefined,
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
      const member = await authenticateMember(req);
      const db = getDb();

      const [instance] = await db
        .select()
        .from(schema.instances)
        .where(eq(schema.instances.id, req.params.id));

      if (!instance) {
        return reply.status(404).send({ error: 'Instance not found' });
      }

      // 权限检查
      if (instance.teamId !== member.teamId) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      // member 只能看自己的实例
      if (member.role !== 'admin' && instance.memberId !== member.id) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      // 不返回敏感字段 gatewayToken
      return {
        id: instance.id,
        name: instance.name,
        environment: instance.environment,
        tags: instance.tags ? JSON.parse(instance.tags) as string[] : undefined,
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

  // GET /api/instances/:id/load — 查询实例实时负载
  app.get<{ Params: { id: string } }>('/instances/:id/load', async (req, reply) => {
    try {
      const member = await authenticateMember(req);

      const db = getDb();
      const [instance] = await db
        .select({ teamId: schema.instances.teamId, memberId: schema.instances.memberId })
        .from(schema.instances)
        .where(eq(schema.instances.id, req.params.id));

      if (!instance) {
        return reply.status(404).send({ error: 'Instance not found' });
      }

      // 权限检查
      if (instance.teamId !== member.teamId) {
        return reply.status(403).send({ error: 'Access denied' });
      }
      if (member.role !== 'admin' && instance.memberId !== member.id) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      // 从 Redis 查询负载信息
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
      const member = await authenticateMember(req);
      const db = getDb();

      const [instance] = await db
        .select()
        .from(schema.instances)
        .where(eq(schema.instances.id, req.params.id));

      if (!instance) {
        return reply.status(404).send({ error: 'Instance not found' });
      }

      // 权限检查：admin 或所有者
      if (member.role !== 'admin' && instance.memberId !== member.id) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      await db
        .delete(schema.instances)
        .where(eq(schema.instances.id, req.params.id));

      // 清理 Redis 负载数据
      try {
        const { getRedis } = await import('@clawgate/core');
        const redis = getRedis();
        await redis.del(`instance:load:${req.params.id}`);
      } catch {
        // 忽略清理错误
      }

      return { success: true, message: 'Instance unregistered' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Delete failed';
      return reply.status(401).send({ error: msg });
    }
  });
};
