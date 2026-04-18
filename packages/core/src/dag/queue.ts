import { Queue, JobScheduler } from 'bullmq';
import { getBullMqRedis } from '../redis/index.js';

const DAG_EXECUTION_QUEUE = 'dag-execution';

export interface DagEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

// ── 条件表达式 ─────────────────────────────────────────────────

export type ConditionOperator = 'eq' | 'neq' | 'contains' | 'not_contains' | 'empty' | 'not_empty';

export interface ConditionExpression {
  left: string;
  operator: ConditionOperator;
  right?: string;
}

// ── 节点定义（联合类型） ───────────────────────────────────────

export interface AgentNodeDef {
  id: string;
  type: 'agent';
  agentId: string;
  prompt: string;
  cacheTtl?: number; // 秒，0 或不设 = 不缓存
}

export interface ConditionNodeDef {
  id: string;
  type: 'condition';
  expression: ConditionExpression;
}

export interface DelayNodeDef {
  id: string;
  type: 'delay';
  delaySeconds: number;
}

export type DagNodeDef = AgentNodeDef | ConditionNodeDef | DelayNodeDef;

// ── 执行任务 ───────────────────────────────────────────────────

export interface DagExecutionJob {
  runId: string;
  dagId: string;
  triggeredBy: 'manual' | 'cron' | 'webhook';
  /** 指定运行环境（用于 GatewayPool 选择实例） */
  environment?: 'development' | 'staging' | 'production';
  /** Webhook 触发时携带的 request body，可在节点 prompt 中通过 {{webhookPayload.*}} 引用 */
  webhookPayload?: unknown;
  definition: {
    nodes: DagNodeDef[];
    edges?: DagEdge[];
  };
}

let dagQueue: Queue | null = null;
let dagJobScheduler: JobScheduler | null = null;

export function initDagQueue(): Queue {
  const connection = getBullMqRedis();
  dagQueue = new Queue(DAG_EXECUTION_QUEUE, {
    connection,
    defaultJobOptions: {
      removeOnComplete: 10,
      removeOnFail: 5,
      attempts: 1, // DAG 执行不重试
    },
  });
  // 初始化 JobScheduler 用于 Cron 任务（BullMQ v5）
  dagJobScheduler = new JobScheduler(DAG_EXECUTION_QUEUE, { connection });
  return dagQueue;
}

/**
 * 为 DAG 添加 Cron 定时任务
 * @param dagId DAG ID
 * @param cronExpression Cron 表达式，格式：minute hour day month weekday
 * @param definition DAG 定义
 * @param timezone IANA 时区字符串（如 "Asia/Shanghai"），默认 UTC
 */
export async function addDagCronJob(
  dagId: string,
  cronExpression: string,
  definition: DagExecutionJob['definition'],
  timezone?: string
): Promise<void> {
  const queue = getDagQueue();
  const jobId = `dag-cron-${dagId}`;

  // 先移除现有的 Cron 任务（如果有）
  await removeDagCronJob(dagId);

  // BullMQ v5: 使用 Queue.upsertJobScheduler 创建定时任务
  await queue.upsertJobScheduler(
    jobId,
    { pattern: cronExpression, ...(timezone ? { tz: timezone } : {}) },
    {
      name: 'execute-dag',
      data: { dagId, definition, triggeredBy: 'cron', runId: '' } as DagExecutionJob,
    }
  );
}

/**
 * 移除 DAG 的 Cron 任务
 * @param dagId DAG ID
 */
export async function removeDagCronJob(dagId: string): Promise<void> {
  const queue = getDagQueue();
  const jobId = `dag-cron-${dagId}`;

  try {
    // BullMQ v5: 使用 Queue.removeJobScheduler
    await queue.removeJobScheduler(jobId);
  } catch { /* 任务不存在时忽略 */ }
}

/**
 * 更新 DAG 的 Cron 任务（先移除再添加）
 * @param dagId DAG ID
 * @param cronExpression Cron 表达式
 * @param enabled 是否启用
 * @param definition DAG 定义
 * @param timezone IANA 时区字符串（如 "Asia/Shanghai"），默认 UTC
 */
export async function updateDagCronJob(
  dagId: string,
  cronExpression: string | null,
  enabled: boolean,
  definition: DagExecutionJob['definition'],
  timezone?: string
): Promise<void> {
  // 先移除现有任务
  await removeDagCronJob(dagId);

  // 如果启用且有 Cron 表达式，添加新任务
  if (enabled && cronExpression) {
    await addDagCronJob(dagId, cronExpression, definition, timezone);
  }
}

/**
 * 列出所有 BullMQ 中已注册的 DAG Cron Scheduler ID（去掉 dag-cron- 前缀）
 * 用于启动时检测孤儿 scheduler（DAG 已删/已禁用但 Redis 残留）
 */
export async function listAllDagCronSchedulerIds(): Promise<string[]> {
  const queue = getDagQueue();
  // 取全部（start=0, end=-1 表示全部）
  const schedulers = await queue.getJobSchedulers(0, -1, true);
  return schedulers
    .map((s) => s.key)
    .filter((k): k is string => typeof k === 'string' && k.startsWith('dag-cron-'))
    .map((k) => k.replace(/^dag-cron-/, ''));
}

export function getDagQueue(): Queue {
  if (!dagQueue) throw new Error('DAG queue not initialized. Call initDagQueue() first.');
  return dagQueue;
}

export async function stopDagQueue(): Promise<void> {
  if (dagJobScheduler) {
    await dagJobScheduler.close();
    dagJobScheduler = null;
  }
  if (dagQueue) {
    await dagQueue.close();
    dagQueue = null;
  }
}
