import { Worker, Job } from 'bullmq';
import { getBullMqRedis } from '../redis/index.js';
import { getDb, schema } from '../db/index.js';
import { eq, and } from 'drizzle-orm';
import { executeAgentNode, executeAgentNodesParallel } from './gateway-executor.js';
import { getGatewayPool } from '../gateway/pool.js';
import { GatewayClient } from '../gateway/index.js';
import type { DagExecutionJob } from './queue.js';
import { topologicalSort } from './topo-sort.js';
import { substituteVariables } from './variable-subst.js';
import { PERSONAL_TEAM_ID } from '../auth/index.js';
import { configReader } from '../config/index.js';

let dagWorker: Worker | null = null;

/**
 * 启动 DAG Worker
 * Wave 3: 支持多节点拓扑排序执行（线性链 + 并行批次 + 变量替换）
 */
export function startDagWorker(): Worker {
  dagWorker = new Worker<DagExecutionJob>(
    'dag-execution',
    async (job: Job<DagExecutionJob>) => {
      let { runId, dagId, definition, triggeredBy = 'manual', environment = 'production' } = job.data;
      const db = getDb();
      const now = new Date().toISOString();

      // Cron 触发时 runId 为空（JobScheduler 模板限制），需在此处创建 dag_runs 记录
      if (!runId && triggeredBy === 'cron') {
        runId = crypto.randomUUID();
        await db.insert(schema.dagRuns).values({
          id: runId,
          dagId,
          status: 'pending',
          triggeredBy: 'cron',
          createdAt: now,
        });
      }

      console.log(`[DAG Worker] Starting run ${runId} for DAG ${dagId} (triggeredBy: ${triggeredBy}, env: ${environment})`);

      // 获取 DAG 所属团队（用于判断个人/团队模式）
      const [dag] = await db
        .select({ teamId: schema.dags.teamId })
        .from(schema.dags)
        .where(eq(schema.dags.id, dagId));

      if (!dag) {
        throw new Error(`DAG ${dagId} not found`);
      }

      // 判断模式：个人模式（teamId 为 null 或 'local'）vs 团队模式
      const isPersonalMode = !dag.teamId || dag.teamId === PERSONAL_TEAM_ID;

      // 获取 Gateway 连接
      let gateway: GatewayClient;

      if (isPersonalMode) {
        // 个人模式：直连本地 OpenClaw Gateway
        const cfg = configReader.get();
        console.log(`[DAG Worker] Personal mode: connecting to local Gateway ${cfg.gatewayUrl}`);

        gateway = new GatewayClient({
          url: cfg.gatewayUrl,
          token: cfg.gatewayToken,
        });

        try {
          await gateway.connect();
          console.log(`[DAG Worker] Personal mode: local Gateway connected`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          throw new Error(`Failed to connect to local OpenClaw Gateway: ${msg}`);
        }
      } else {
        // 团队模式：使用 GatewayPool 选择最优实例
        const pool = getGatewayPool();
        const instanceId = await pool.selectForTask(dag.teamId!, { environment });
        if (!instanceId) {
          throw new Error(
            `No available instance for environment "${environment}". Please register an instance or check health.`
          );
        }
        gateway = await pool.getConnection(instanceId);
        console.log(`[DAG Worker] Team mode: selected instance ${instanceId} for run ${runId}`);
      }

      try {
        // 1. 更新 dag_runs 状态为 running
        await db
          .update(schema.dagRuns)
          .set({ status: 'running', startedAt: now })
          .where(eq(schema.dagRuns.id, runId));

        // 2. 初始化所有节点状态为 pending
        for (const node of definition.nodes) {
          await db.insert(schema.dagNodeStates).values({
            runId,
            nodeId: node.id,
            status: 'pending',
            createdAt: now,
          });
        }

        // 3. 拓扑排序，检测循环依赖
        let batches: string[][];
        try {
          batches = topologicalSort(definition.nodes, definition.edges ?? []);
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Topology error';
          throw new Error(`DAG topology error: ${msg}`);
        }

        console.log(`[DAG Worker] Execution plan: ${batches.map((b) => `[${b.join(',')}]`).join(' → ')}`);

        // 5. 按批次执行
        const context: Record<string, string> = {};
        let runFailed = false;
        let failedNodeId: string | undefined;
        let failedError: string | undefined;

        const nodeMap = new Map(definition.nodes.map((n) => [n.id, n]));

        for (const batch of batches) {
          if (runFailed) {
            const skippedAt = new Date().toISOString();
            for (const nodeId of batch) {
              await db
                .update(schema.dagNodeStates)
                .set({ status: 'skipped', endedAt: skippedAt })
                .where(and(
                  eq(schema.dagNodeStates.runId, runId),
                  eq(schema.dagNodeStates.nodeId, nodeId)
                ));
            }
            continue;
          }

          const batchStartedAt = new Date().toISOString();
          for (const nodeId of batch) {
            await db
              .update(schema.dagNodeStates)
              .set({ status: 'running', startedAt: batchStartedAt })
              .where(and(
                eq(schema.dagNodeStates.runId, runId),
                eq(schema.dagNodeStates.nodeId, nodeId)
              ));
          }

          if (batch.length === 1) {
            const nodeId = batch[0]!;
            const node = nodeMap.get(nodeId)!;
            const resolvedPrompt = substituteVariables(node.prompt, context);

            console.log(`[DAG Worker] Executing node ${nodeId} (agent: ${node.agentId})`);

            const result = await executeAgentNode(gateway, {
              agentId: node.agentId,
              prompt: resolvedPrompt,
              timeoutMs: 60000,
            });

            const nodeEndedAt = new Date().toISOString();

            if (result.success) {
              context[nodeId] = result.output;
              await db
                .update(schema.dagNodeStates)
                .set({ status: 'completed', output: result.output, endedAt: nodeEndedAt })
                .where(and(
                  eq(schema.dagNodeStates.runId, runId),
                  eq(schema.dagNodeStates.nodeId, nodeId)
                ));
              console.log(`[DAG Worker] Node ${nodeId} completed`);
            } else {
              runFailed = true;
              failedNodeId = nodeId;
              failedError = result.error;
              await db
                .update(schema.dagNodeStates)
                .set({ status: 'failed', error: result.error, endedAt: nodeEndedAt })
                .where(and(
                  eq(schema.dagNodeStates.runId, runId),
                  eq(schema.dagNodeStates.nodeId, nodeId)
                ));
              console.error(`[DAG Worker] Node ${nodeId} failed: ${result.error}`);
            }
          } else {
            const parallelNodes = batch.map((nodeId) => {
              const node = nodeMap.get(nodeId)!;
              return {
                nodeId,
                agentId: node.agentId,
                prompt: substituteVariables(node.prompt, context),
              };
            });

            console.log(`[DAG Worker] Executing parallel batch: [${batch.join(', ')}]`);

            const results = await executeAgentNodesParallel(gateway, parallelNodes, 60000);
            const batchEndedAt = new Date().toISOString();

            for (const nodeId of batch) {
              const result = results.get(nodeId);
              if (!result) continue;

              if (result.success) {
                context[nodeId] = result.output;
                await db
                  .update(schema.dagNodeStates)
                  .set({ status: 'completed', output: result.output, endedAt: batchEndedAt })
                  .where(and(
                    eq(schema.dagNodeStates.runId, runId),
                    eq(schema.dagNodeStates.nodeId, nodeId)
                  ));
              } else {
                if (!runFailed) {
                  runFailed = true;
                  failedNodeId = nodeId;
                  failedError = result.error;
                }
                await db
                  .update(schema.dagNodeStates)
                  .set({ status: 'failed', error: result.error, endedAt: batchEndedAt })
                  .where(and(
                    eq(schema.dagNodeStates.runId, runId),
                    eq(schema.dagNodeStates.nodeId, nodeId)
                  ));
                console.error(`[DAG Worker] Node ${nodeId} failed: ${result.error}`);
              }
            }
          }
        }

        const runEndedAt = new Date().toISOString();

        if (runFailed) {
          await db
            .update(schema.dagRuns)
            .set({
              status: 'failed',
              error: `Node "${failedNodeId}" failed: ${failedError}`,
              endedAt: runEndedAt,
            })
            .where(eq(schema.dagRuns.id, runId));

          return { runId, status: 'failed', failedNodeId };
        }

        const lastBatch = batches[batches.length - 1] ?? [];
        const lastNodeId = lastBatch[lastBatch.length - 1];
        const finalOutput = lastNodeId ? (context[lastNodeId] ?? null) : null;

        await db
          .update(schema.dagRuns)
          .set({ status: 'completed', output: finalOutput, endedAt: runEndedAt })
          .where(eq(schema.dagRuns.id, runId));

        console.log(`[DAG Worker] Run ${runId} completed (${definition.nodes.length} nodes)`);
        return { runId, status: 'completed' };

      } finally {
        // 个人模式：清理 GatewayClient 连接
        if (isPersonalMode) {
          try {
            gateway.disconnect();
            console.log(`[DAG Worker] Personal mode: disconnected from local Gateway`);
          } catch {
            // 忽略清理错误
          }
        }
        // 团队模式：GatewayPool 的连接由连接池自动管理
      }
    },
    { connection: getBullMqRedis() }
  );

  dagWorker.on('completed', (job: Job) => {
    console.log(`[DAG Worker] Job ${job.id} completed`);
  });

  dagWorker.on('failed', (job: Job | undefined, err: Error) => {
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
