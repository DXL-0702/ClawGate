import { Queue } from 'bullmq';
import { getBullMqRedis } from '../redis/index.js';

const DAG_EXECUTION_QUEUE = 'dag-execution';

export interface DagExecutionJob {
  runId: string;
  dagId: string;
  definition: {
    nodes: Array<{
      id: string;
      type: 'agent';
      agentId: string;
      prompt: string;
    }>;
    edges?: any[]; // v0.5 Week 1 不使用
  };
}

let dagQueue: Queue | null = null;

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
  return dagQueue;
}

export function getDagQueue(): Queue {
  if (!dagQueue) throw new Error('DAG queue not initialized. Call initDagQueue() first.');
  return dagQueue;
}

export async function stopDagQueue(): Promise<void> {
  if (dagQueue) {
    await dagQueue.close();
    dagQueue = null;
  }
}
