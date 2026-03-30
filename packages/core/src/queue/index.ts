import { Queue, Worker, type Job } from 'bullmq';
import { getDb, schema } from '../db/index.js';
import { getRedis, REDIS_KEYS } from '../redis/index.js';
import { getYamlConfig } from '../yaml-config/index.js';

const QUEUE_NAME = 'clawgate:archive';
const JOB_COSTS_ARCHIVE = 'costs:archive';
const JOB_LOGS_ARCHIVE = 'logs:archive';

let archiveQueue: Queue | null = null;
let archiveWorker: Worker | null = null;

export function initQueue(): Queue {
  const connection = getRedis();
  archiveQueue = new Queue(QUEUE_NAME, { connection });
  return archiveQueue;
}

export function getQueue(): Queue {
  if (!archiveQueue) throw new Error('Queue not initialised. Call initQueue() first.');
  return archiveQueue;
}

// ── 归档任务处理器 ──────────────────────────────────────────────

async function handleCostsArchive(): Promise<void> {
  const redis = getRedis();
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  const key = REDIS_KEYS.costsRealtime(today);

  // 原子读取并清除（MULTI/EXEC）
  const pipeline = redis.pipeline();
  pipeline.hgetall(key);
  pipeline.del(key);
  const results = await pipeline.exec();
  const entries = results?.[0]?.[1] as Record<string, string> | null;

  if (!entries || Object.keys(entries).length === 0) return;

  // entries 格式：{ 'model:token_input': '100', 'model:token_output': '200', 'model:estimated_usd': '0.01' }
  const models = new Set(
    Object.keys(entries).map((k) => k.split(':').slice(0, -1).join(':'))
  );

  // 从 clawgate.yaml providers 查找 provider 名称
  const providerMap = new Map(
    getYamlConfig().providers.map((p) => [p.model, p.name])
  );

  const now = new Date().toISOString();
  for (const model of models) {
    const tokenInput = parseInt(entries[`${model}:token_input`] ?? '0', 10);
    const tokenOutput = parseInt(entries[`${model}:token_output`] ?? '0', 10);
    const estimatedUsd = parseFloat(entries[`${model}:estimated_usd`] ?? '0');
    const provider = providerMap.get(model) ?? 'unknown';

    await db.insert(schema.costs).values({
      date: today,
      model,
      provider,
      tokenInput,
      tokenOutput,
      estimatedUsd,
      createdAt: now,
    });
  }
}

async function handleLogsArchive(): Promise<void> {
  const redis = getRedis();
  const db = getDb();
  const key = REDIS_KEYS.routingLogsBuffer;

  // 原子读取最多 500 条并移除
  const pipeline = redis.pipeline();
  pipeline.lrange(key, 0, 499);
  pipeline.ltrim(key, 500, -1);
  const results = await pipeline.exec();
  const entries = results?.[0]?.[1] as string[] | null;

  if (!entries || entries.length === 0) return;

  const now = new Date().toISOString();
  for (const raw of entries) {
    const entry = JSON.parse(raw) as {
      sessionKey?: string;
      prompt: string;
      layer: 'L1' | 'L2' | 'L3';
      model: string;
      cacheHit?: boolean;
      latencyMs?: number;
    };
    await db.insert(schema.routingLogs).values({
      sessionKey: entry.sessionKey ?? null,
      prompt: entry.prompt,
      layer: entry.layer,
      model: entry.model,
      cacheHit: entry.cacheHit ?? false,
      latencyMs: entry.latencyMs ?? 0,
      createdAt: now,
    });
  }
}

// ── Worker 启动 ─────────────────────────────────────────────────

export function startArchiveWorker(): Worker {
  const connection = getRedis();
  archiveWorker = new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      if (job.name === JOB_COSTS_ARCHIVE) await handleCostsArchive();
      if (job.name === JOB_LOGS_ARCHIVE) await handleLogsArchive();
    },
    { connection },
  );

  archiveWorker.on('failed', (job, err) => {
    console.error(`[BullMQ] job ${job?.name} failed:`, err.message);
  });

  return archiveWorker;
}

// ── 定时任务注册（每 5 分钟归档 costs，每 10 分钟归档 logs）────

export async function scheduleArchiveJobs(): Promise<void> {
  const queue = getQueue();

  await queue.upsertJobScheduler(
    'costs-archive-scheduler',
    { every: 5 * 60 * 1000 },
    { name: JOB_COSTS_ARCHIVE, opts: { removeOnComplete: 10, removeOnFail: 5 } },
  );

  await queue.upsertJobScheduler(
    'logs-archive-scheduler',
    { every: 10 * 60 * 1000 },
    { name: JOB_LOGS_ARCHIVE, opts: { removeOnComplete: 10, removeOnFail: 5 } },
  );
}

export async function stopQueue(): Promise<void> {
  await archiveWorker?.close();
  await archiveQueue?.close();
  archiveWorker = null;
  archiveQueue = null;
}
