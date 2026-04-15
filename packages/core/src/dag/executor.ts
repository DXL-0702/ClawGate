import { Worker, Job } from 'bullmq';
import { getBullMqRedis } from '../redis/index.js';
import { getDb, schema } from '../db/index.js';
import { eq, and } from 'drizzle-orm';
import { executeAgentNode } from './gateway-executor.js';
import { GatewayClient } from '../gateway/index.js';
import type { DagExecutionJob } from './queue.js';

let dagWorker: Worker | null = null;

export function startDagWorker(gateway: GatewayClient): Worker {
  const connection = getBullMqRedis();

  dagWorker = new Worker<DagExecutionJob>(
    'dag-execution',
    async (job: Job<DagExecutionJob>) => {
      const { runId, dagId, definition } = job.data;
      const db = getDb();
      const now = new Date().toISOString();

      console.log(`[DAG Worker] Starting run ${runId} for DAG ${dagId}`);

      try {
        // 1. 更新 dag_runs 状态为 running
        await db
          .update(schema.dagRuns)
          .set({ status: 'running', startedAt: now })
          .where(eq(schema.dagRuns.id, runId));

        // 2. 初始化节点状态为 pending
        for (const node of definition.nodes) {
          await db.insert(schema.dagNodeStates).values({
            runId,
            nodeId: node.id,
            status: 'pending',
            createdAt: now,
          });
        }

        // 3. Week 1: 单节点执行
        const node = definition.nodes[0];
        if (!node) throw new Error('No nodes in DAG definition');

        // 更新为 running
        const nodeStartedAt = new Date().toISOString();
        await db
          .update(schema.dagNodeStates)
          .set({ status: 'running', startedAt: nodeStartedAt })
          .where(and(
            eq(schema.dagNodeStates.runId, runId),
            eq(schema.dagNodeStates.nodeId, node.id)
          ));

        console.log(`[DAG Worker] Executing node ${node.id} with agent ${node.agentId}`);

        // 4. 执行节点
        const result = await executeAgentNode(gateway, {
          agentId: node.agentId,
          prompt: node.prompt,
          timeoutMs: 60000,
        });

        console.log(`[DAG Worker] Node ${node.id} completed: ${result.success ? 'success' : 'failed'}`);

        // 5. 更新节点状态
        const nodeEndedAt = new Date().toISOString();
        await db
          .update(schema.dagNodeStates)
          .set({
            status: result.success ? 'completed' : 'failed',
            output: result.success ? result.output : null,
            error: result.success ? null : result.error,
            endedAt: nodeEndedAt,
          })
          .where(and(
            eq(schema.dagNodeStates.runId, runId),
            eq(schema.dagNodeStates.nodeId, node.id)
          ));

        // 6. 更新 dag_runs
        const runEndedAt = new Date().toISOString();
        await db
          .update(schema.dagRuns)
          .set({
            status: result.success ? 'completed' : 'failed',
            output: result.success ? result.output : null,
            error: result.success ? null : result.error,
            endedAt: runEndedAt,
          })
          .where(eq(schema.dagRuns.id, runId));

        return { runId, status: result.success ? 'completed' : 'failed' };

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[DAG Worker] Run ${runId} failed:`, errorMsg);

        // 更新为失败状态
        const failedAt = new Date().toISOString();
        await db
          .update(schema.dagRuns)
          .set({
            status: 'failed',
            error: errorMsg,
            endedAt: failedAt,
          })
          .where(eq(schema.dagRuns.id, runId));

        throw error;
      }
    },
    { connection }
  );

  dagWorker.on('completed', (job) => {
    console.log(`[DAG Worker] Job ${job.id} completed`);
  });

  dagWorker.on('failed', (job, err) => {
    console.error(`[DAG Worker] Job ${job?.id} failed:`, err.message);
  });

  return dagWorker;
}

export async function stopDagWorker(): Promise<void> {
  if (dagWorker) {
    await dagWorker.close();
    dagWorker = null;
  }
}
