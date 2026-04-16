/**
 * 实例健康检查定时任务
 *
 * 职责：
 * 1. 每分钟检查所有标记为 online 的实例
 * 2. 验证 Redis 心跳数据是否存在（TTL 20s）
 * 3. 无心跳数据的实例标记为 offline
 * 4. 断开僵尸连接的 WebSocket
 */

import { Queue, Worker } from 'bullmq';
import { getBullMqRedis } from '../redis/index.js';
import { getDb, schema } from '../db/index.js';
import { getGatewayPool } from '../gateway/pool.js';
import { eq, and, lt } from 'drizzle-orm';

const HEALTH_CHECK_QUEUE = 'instance-health-check';

let healthCheckQueue: Queue | null = null;
let healthCheckWorker: Worker | null = null;

/**
 * 启动健康检查定时任务
 * 每分钟执行一次
 */
export function startHealthCheckScheduler(): Queue {
  const connection = getBullMqRedis();

  healthCheckQueue = new Queue(HEALTH_CHECK_QUEUE, {
    connection,
    defaultJobOptions: {
      removeOnComplete: 10,
      removeOnFail: 5,
    },
  });

  // 使用 BullMQ JobScheduler 每分钟触发一次
  healthCheckQueue.upsertJobScheduler(
    'instance-health-check-scheduler',
    { pattern: '* * * * *' }, // 每分钟
    {
      name: 'check-instances',
      data: { timestamp: new Date().toISOString() },
    }
  );

  console.log('[HealthCheck] Scheduler started, running every minute');
  return healthCheckQueue;
}

/**
 * 启动健康检查 Worker
 */
export function startHealthCheckWorker(): Worker {
  const connection = getBullMqRedis();
  const db = getDb();
  const pool = getGatewayPool();

  healthCheckWorker = new Worker(
    HEALTH_CHECK_QUEUE,
    async (job) => {
      const now = new Date();
      const nowISO = now.toISOString();

      console.log(`[HealthCheck] Running at ${nowISO}`);

      // 1. 获取所有标记为 online 的实例
      const onlineInstances = await db
        .select({
          id: schema.instances.id,
          name: schema.instances.name,
          lastHeartbeatAt: schema.instances.lastHeartbeatAt,
        })
        .from(schema.instances)
        .where(eq(schema.instances.status, 'online'));

      console.log(`[HealthCheck] Checking ${onlineInstances.length} online instances`);

      let offlineCount = 0;
      let disconnectedCount = 0;

      for (const instance of onlineInstances) {
        try {
          // 2. 检查 Redis 心跳数据
          const { getRedis } = await import('../redis/index.js');
          const redis = getRedis();
          const loadKey = `instance:load:${instance.id}`;
          const exists = await redis.exists(loadKey);

          if (!exists) {
            // 无心跳数据，标记为 offline
            console.log(`[HealthCheck] Instance ${instance.name} (${instance.id}) heartbeat expired, marking offline`);

            await db
              .update(schema.instances)
              .set({
                status: 'offline',
                updatedAt: nowISO,
              })
              .where(eq(schema.instances.id, instance.id));

            offlineCount++;

            // 3. 断开 WebSocket 连接（如果存在）
            try {
              await pool.disconnect(instance.id);
              console.log(`[HealthCheck] Disconnected WebSocket for instance ${instance.id}`);
              disconnectedCount++;
            } catch (disconnectErr) {
              // 连接可能已不存在，忽略错误
              console.log(`[HealthCheck] No active connection to disconnect for instance ${instance.id}`);
            }
          }
        } catch (err) {
          console.error(`[HealthCheck] Error checking instance ${instance.id}:`, err instanceof Error ? err.message : String(err));
        }
      }

      // 4. 额外检查：长时间（> 30 分钟）未更新的 offline 实例，可选择清理或告警
      const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000).toISOString();
      const staleOfflineInstances = await db
        .select({
          id: schema.instances.id,
          name: schema.instances.name,
          lastHeartbeatAt: schema.instances.lastHeartbeatAt,
        })
        .from(schema.instances)
        .where(
          and(
            eq(schema.instances.status, 'offline'),
            lt(schema.instances.lastHeartbeatAt, thirtyMinutesAgo)
          )
        );

      if (staleOfflineInstances.length > 0) {
        console.log(`[HealthCheck] Found ${staleOfflineInstances.length} stale offline instances (>30min)`);
        // 可选：发送告警通知
        for (const instance of staleOfflineInstances) {
          console.log(`[HealthCheck] Stale instance: ${instance.name} (${instance.id}), last seen: ${instance.lastHeartbeatAt}`);
        }
      }

      console.log(`[HealthCheck] Complete: ${offlineCount} marked offline, ${disconnectedCount} disconnected, ${staleOfflineInstances.length} stale`);

      return {
        timestamp: nowISO,
        checked: onlineInstances.length,
        markedOffline: offlineCount,
        disconnected: disconnectedCount,
        staleOffline: staleOfflineInstances.length,
      };
    },
    { connection }
  );

  healthCheckWorker.on('completed', (job, result) => {
    console.log('[HealthCheck] Job completed:', result);
  });

  healthCheckWorker.on('failed', (job, err) => {
    console.error('[HealthCheck] Job failed:', err.message);
  });

  return healthCheckWorker;
}

/**
 * 停止健康检查任务
 */
export async function stopHealthCheck(): Promise<void> {
  if (healthCheckWorker) {
    await healthCheckWorker.close();
    healthCheckWorker = null;
  }
  if (healthCheckQueue) {
    await healthCheckQueue.close();
    healthCheckQueue = null;
  }
  console.log('[HealthCheck] Stopped');
}

/**
 * 手动触发健康检查（用于测试或紧急检查）
 */
export async function triggerManualHealthCheck(): Promise<void> {
  if (!healthCheckQueue) {
    throw new Error('Health check queue not initialized');
  }
  await healthCheckQueue.add('check-instances', { manual: true, timestamp: new Date().toISOString() });
}
