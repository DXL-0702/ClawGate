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

export interface DagExecutionJob {
  runId: string;
  dagId: string;
  triggeredBy: 'manual' | 'cron' | 'webhook';
  /** 指定运行环境（用于 GatewayPool 选择实例） */
  environment?: 'development' | 'staging' | 'production';
  definition: {
    nodes: Array<{
      id: string;
      type: 'agent';
      agentId: string;
      prompt: string;
    }>;
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
 */
export async function addDagCronJob(
  dagId: string,
  cronExpression: string,
  definition: DagExecutionJob['definition']
): Promise<void> {
  const queue = getDagQueue();
  const jobId = `dag-cron-${dagId}`;

  // 先移除现有的 Cron 任务（如果有）
  await removeDagCronJob(dagId);

  // BullMQ v5: 使用 Queue.upsertJobScheduler 创建定时任务
  await queue.upsertJobScheduler(
    jobId,
    { pattern: cronExpression }, // Cron 模式
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
 */
export async function updateDagCronJob(
  dagId: string,
  cronExpression: string | null,
  enabled: boolean,
  definition: DagExecutionJob['definition']
): Promise<void> {
  // 先移除现有任务
  await removeDagCronJob(dagId);

  // 如果启用且有 Cron 表达式，添加新任务
  if (enabled && cronExpression) {
    await addDagCronJob(dagId, cronExpression, definition);
  }
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
