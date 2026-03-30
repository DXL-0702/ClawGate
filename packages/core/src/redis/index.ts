import { Redis } from 'ioredis';

// Key 前缀常量
export const REDIS_KEYS = {
  sessionState: (key: string) => `session_state:${key}`,
  instanceHealth: (instanceId: string) => `instance_health:${instanceId}`,
  costsRealtime: (date: string) => `costs_realtime:${date}`,
  routingLogsBuffer: 'routing_logs_buf',
  feedbackQueue: 'feedback_queue',
  syncCheckpoint: 'sync_checkpoint',
} as const;

// TTL 常量（秒）
export const REDIS_TTL = {
  sessionState: 60 * 60 * 24,     // 24h
  instanceHealth: 10,              // 10s 心跳
  costsRealtime: 60 * 60 * 24,    // 24h
} as const;

let client: Redis | null = null;

export function initRedis(url?: string): Redis {
  const redisUrl = url ?? process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379';
  client = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    enableOfflineQueue: false,
    retryStrategy: (times) => {
      // 最多重试 5 次，指数退避，上限 10s
      if (times > 5) return null;
      return Math.min(times * 500, 10000);
    },
  });

  client.on('error', (err) => {
    // Log but don't crash — Redis is optional for MVP
    console.error('[Redis] connection error:', err.message);
  });

  return client;
}

export function getRedis(): Redis {
  if (!client) throw new Error('Redis not initialised. Call initRedis() first.');
  return client;
}

export async function connectRedis(url?: string): Promise<Redis> {
  const redis = client ?? initRedis(url);
  await redis.connect();
  return redis;
}

export async function disconnectRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
  }
}

// ── 高层操作封装 ────────────────────────────────────────────────

export async function setSessionState(
  key: string,
  value: Record<string, unknown>,
): Promise<void> {
  const redis = getRedis();
  await redis.setex(
    REDIS_KEYS.sessionState(key),
    REDIS_TTL.sessionState,
    JSON.stringify(value),
  );
}

export async function getSessionState(
  key: string,
): Promise<Record<string, unknown> | null> {
  const redis = getRedis();
  const raw = await redis.get(REDIS_KEYS.sessionState(key));
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
}

export async function incrCostRealtime(
  date: string,
  model: string,
  tokenInput: number,
  tokenOutput: number,
  estimatedUsd: number,
): Promise<void> {
  const redis = getRedis();
  const key = REDIS_KEYS.costsRealtime(date);
  // 原子操作：HINCRBY（整数）+ HINCRBYFLOAT（浮点），无并发竞争
  const pipeline = redis.pipeline();
  pipeline.hincrby(key, `${model}:token_input`, tokenInput);
  pipeline.hincrby(key, `${model}:token_output`, tokenOutput);
  pipeline.hincrbyfloat(key, `${model}:estimated_usd`, estimatedUsd);
  pipeline.expire(key, REDIS_TTL.costsRealtime);
  await pipeline.exec();
}

export async function pushRoutingLog(
  entry: Record<string, unknown>,
): Promise<void> {
  const redis = getRedis();
  await redis.lpush(REDIS_KEYS.routingLogsBuffer, JSON.stringify(entry));
  // 保留最近 1000 条
  await redis.ltrim(REDIS_KEYS.routingLogsBuffer, 0, 999);
}
