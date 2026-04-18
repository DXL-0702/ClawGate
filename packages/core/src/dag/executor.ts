import { Worker, Job } from 'bullmq';
import { getBullMqRedis } from '../redis/index.js';
import { getDb, schema } from '../db/index.js';
import type { Db } from '../db/index.js';
import { eq, and } from 'drizzle-orm';
import { executeAgentNode, executeAgentNodesParallel } from './gateway-executor.js';
import { getGatewayPool } from '../gateway/pool.js';
import { GatewayClient } from '../gateway/index.js';
import type { DagExecutionJob, DagNodeDef } from './queue.js';
import { topologicalSort } from './topo-sort.js';
import { substituteVariables } from './variable-subst.js';
import { evaluateConditionToString } from './condition-eval.js';
import { shouldSkipNode } from './skip-logic.js';
import { computeCacheKey } from './cache-key.js';
import { getDagNodeCache, setDagNodeCache } from '../redis/index.js';
import { PERSONAL_TEAM_ID } from '../auth/index.js';
import { configReader } from '../config/index.js';

let dagWorker: Worker | null = null;

// ── 核心执行逻辑（可独立测试） ──────────────────────────────────

export interface DagRunParams {
  runId: string;
  definition: {
    nodes: DagNodeDef[];
    edges?: Array<{ id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }>;
  };
  gateway: GatewayClient;
  db?: Db;
  /** Webhook 触发时携带的 request body，可在节点 prompt 中通过 {{webhookPayload.*}} 引用 */
  webhookPayload?: unknown;
}

export interface DagRunResult {
  runId: string;
  status: 'completed' | 'failed';
  failedNodeId?: string;
  output?: string | null;
}

/**
 * DAG 核心执行函数
 * 拓扑排序 → 分批执行 → 变量替换 → 状态持久化
 *
 * 从 Worker 回调中提取，支持独立测试（传入 Mock GatewayClient + 测试 DB）。
 */
export async function executeDagRun(params: DagRunParams): Promise<DagRunResult> {
  const { runId, definition, gateway, webhookPayload } = params;
  const db = params.db ?? getDb();
  const now = new Date().toISOString();

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
  const topoNodes = definition.nodes.map((n) => ({ id: n.id }));
  const topoEdges = (definition.edges ?? []).map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? undefined,
    targetHandle: e.targetHandle ?? undefined,
  }));
  try {
    batches = topologicalSort(topoNodes, topoEdges);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Topology error';
    const errorMsg = `DAG topology error: ${msg}`;
    await db
      .update(schema.dagRuns)
      .set({ status: 'failed', error: errorMsg, endedAt: new Date().toISOString() })
      .where(eq(schema.dagRuns.id, runId));
    return { runId, status: 'failed', output: null };
  }

  console.log(`[DAG Worker] Execution plan: ${batches.map((b) => `[${b.join(',')}]`).join(' → ')}`);

  // 4. 按批次执行
  const context: Record<string, string> = {};
  let runFailed = false;
  let failedNodeId: string | undefined;
  let failedError: string | undefined;
  const skippedNodes = new Set<string>();
  const conditionResults: Record<string, string> = {};

  const nodeMap = new Map(definition.nodes.map((n) => [n.id, n]));
  const edges = definition.edges ?? [];

  for (const batch of batches) {
    if (runFailed) {
      const skippedAt = new Date().toISOString();
      for (const nodeId of batch) {
        skippedNodes.add(nodeId);
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

    // 分类本批次节点：先过滤 skip，再分离 condition / agent
    const activeNodes: string[] = [];
    const skippedInBatch: string[] = [];

    for (const nodeId of batch) {
      if (shouldSkipNode(nodeId, edges, skippedNodes, conditionResults, nodeMap)) {
        skippedInBatch.push(nodeId);
      } else {
        activeNodes.push(nodeId);
      }
    }

    // 标记跳过的节点
    if (skippedInBatch.length > 0) {
      const skippedAt = new Date().toISOString();
      for (const nodeId of skippedInBatch) {
        skippedNodes.add(nodeId);
        await db
          .update(schema.dagNodeStates)
          .set({ status: 'skipped', endedAt: skippedAt })
          .where(and(
            eq(schema.dagNodeStates.runId, runId),
            eq(schema.dagNodeStates.nodeId, nodeId)
          ));
      }
    }

    if (activeNodes.length === 0) continue;

    // 同步处理 condition / delay 节点（不需要 Gateway）
    const conditionNodeIds: string[] = [];
    const delayNodeIds: string[] = [];
    const agentNodeIds: string[] = [];

    for (const nodeId of activeNodes) {
      const node = nodeMap.get(nodeId)!;
      if (node.type === 'condition') {
        conditionNodeIds.push(nodeId);
      } else if (node.type === 'delay') {
        delayNodeIds.push(nodeId);
      } else {
        agentNodeIds.push(nodeId);
      }
    }

    // 执行条件节点
    for (const nodeId of conditionNodeIds) {
      const node = nodeMap.get(nodeId)!;
      if (node.type !== 'condition') continue;

      const condStartedAt = new Date().toISOString();
      await db
        .update(schema.dagNodeStates)
        .set({ status: 'running', startedAt: condStartedAt })
        .where(and(
          eq(schema.dagNodeStates.runId, runId),
          eq(schema.dagNodeStates.nodeId, nodeId)
        ));

      const result = evaluateConditionToString(node.expression, context);
      context[nodeId] = result;
      conditionResults[nodeId] = result;

      const condEndedAt = new Date().toISOString();
      await db
        .update(schema.dagNodeStates)
        .set({ status: 'completed', output: result, endedAt: condEndedAt })
        .where(and(
          eq(schema.dagNodeStates.runId, runId),
          eq(schema.dagNodeStates.nodeId, nodeId)
        ));

      console.log(`[DAG Worker] Condition node ${nodeId} evaluated to "${result}"`);
    }

    // 执行 delay 节点
    for (const nodeId of delayNodeIds) {
      const node = nodeMap.get(nodeId)!;
      if (node.type !== 'delay') continue;

      const delayStartedAt = new Date().toISOString();
      await db
        .update(schema.dagNodeStates)
        .set({ status: 'running', startedAt: delayStartedAt })
        .where(and(
          eq(schema.dagNodeStates.runId, runId),
          eq(schema.dagNodeStates.nodeId, nodeId)
        ));

      const seconds = Math.max(0, node.delaySeconds);
      console.log(`[DAG Worker] Delay node ${nodeId} waiting ${seconds}s`);

      if (seconds > 0) {
        await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
      }

      const output = `${seconds}`;
      context[nodeId] = output;

      const delayEndedAt = new Date().toISOString();
      await db
        .update(schema.dagNodeStates)
        .set({ status: 'completed', output, endedAt: delayEndedAt })
        .where(and(
          eq(schema.dagNodeStates.runId, runId),
          eq(schema.dagNodeStates.nodeId, nodeId)
        ));

      console.log(`[DAG Worker] Delay node ${nodeId} completed (${seconds}s)`);
    }

    // 无 agent 节点需执行 → 跳到下一批次
    if (agentNodeIds.length === 0) continue;

    // 执行 agent 节点
    const batchStartedAt = new Date().toISOString();
    for (const nodeId of agentNodeIds) {
      await db
        .update(schema.dagNodeStates)
        .set({ status: 'running', startedAt: batchStartedAt })
        .where(and(
          eq(schema.dagNodeStates.runId, runId),
          eq(schema.dagNodeStates.nodeId, nodeId)
        ));
    }

    if (agentNodeIds.length === 1) {
      const nodeId = agentNodeIds[0]!;
      const node = nodeMap.get(nodeId)!;
      if (node.type !== 'agent') continue;

      const resolvedPrompt = substituteVariables(node.prompt, context, webhookPayload);

      // 缓存检查（opt-in，cacheTtl > 0 时生效）
      if ((node.cacheTtl ?? 0) > 0) {
        const hash = computeCacheKey(node.agentId, resolvedPrompt);
        const cached = await getDagNodeCache(hash);
        if (cached !== null) {
          context[nodeId] = cached;
          const cacheHitAt = new Date().toISOString();
          await db
            .update(schema.dagNodeStates)
            .set({ status: 'completed', output: cached, endedAt: cacheHitAt })
            .where(and(
              eq(schema.dagNodeStates.runId, runId),
              eq(schema.dagNodeStates.nodeId, nodeId)
            ));
          console.log(`[DAG Worker] Node ${nodeId} cache HIT`);
          continue;
        }
      }

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
        // 写入缓存（opt-in）
        if ((node.cacheTtl ?? 0) > 0) {
          const hash = computeCacheKey(node.agentId, resolvedPrompt);
          await setDagNodeCache(hash, result.output, node.cacheTtl!);
        }
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
      // 并行执行前先逐个检查缓存
      const parallelCandidates: Array<{ nodeId: string; agentId: string; prompt: string; cacheTtl: number }> = [];
      const batchStartedAtParallel = new Date().toISOString();

      for (const nodeId of agentNodeIds) {
        const node = nodeMap.get(nodeId)!;
        if (node.type !== 'agent') continue;
        const resolvedPrompt = substituteVariables(node.prompt, context, webhookPayload);
        const ttl = node.cacheTtl ?? 0;

        if (ttl > 0) {
          const hash = computeCacheKey(node.agentId, resolvedPrompt);
          const cached = await getDagNodeCache(hash);
          if (cached !== null) {
            context[nodeId] = cached;
            await db
              .update(schema.dagNodeStates)
              .set({ status: 'completed', output: cached, endedAt: batchStartedAtParallel })
              .where(and(
                eq(schema.dagNodeStates.runId, runId),
                eq(schema.dagNodeStates.nodeId, nodeId)
              ));
            console.log(`[DAG Worker] Node ${nodeId} cache HIT`);
            continue;
          }
        }
        parallelCandidates.push({ nodeId, agentId: node.agentId, prompt: resolvedPrompt, cacheTtl: ttl });
      }

      if (parallelCandidates.length === 0) continue;

      console.log(`[DAG Worker] Executing parallel batch: [${parallelCandidates.map((n) => n.nodeId).join(', ')}]`);

      const results = await executeAgentNodesParallel(
        gateway,
        parallelCandidates.map((n) => ({ nodeId: n.nodeId, agentId: n.agentId, prompt: n.prompt })),
        60000
      );
      const batchEndedAt = new Date().toISOString();

      for (const { nodeId, agentId, prompt, cacheTtl } of parallelCandidates) {
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
          // 写入缓存（opt-in）
          if (cacheTtl > 0) {
            const hash = computeCacheKey(agentId, prompt);
            await setDagNodeCache(hash, result.output, cacheTtl);
          }
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

  // 最终输出：取最后一个 completed 且非 condition/delay 的节点输出
  let finalOutput: string | null = null;
  for (let i = batches.length - 1; i >= 0; i--) {
    const batch = batches[i]!;
    for (let j = batch.length - 1; j >= 0; j--) {
      const nodeId = batch[j]!;
      const node = nodeMap.get(nodeId);
      const nodeType = node?.type;
      if (nodeType !== 'condition' && nodeType !== 'delay' && !skippedNodes.has(nodeId) && context[nodeId] !== undefined) {
        finalOutput = context[nodeId] ?? null;
        break;
      }
    }
    if (finalOutput !== null) break;
  }

  await db
    .update(schema.dagRuns)
    .set({ status: 'completed', output: finalOutput, endedAt: runEndedAt })
    .where(eq(schema.dagRuns.id, runId));

  console.log(`[DAG Worker] Run ${runId} completed (${definition.nodes.length} nodes)`);
  return { runId, status: 'completed', output: finalOutput };
}

// ── BullMQ Worker（薄封装） ─────────────────────────────────────

/**
 * 启动 DAG Worker
 * 职责：Gateway 获取 + executeDagRun() 调用 + 连接清理
 */
export function startDagWorker(): Worker {
  dagWorker = new Worker<DagExecutionJob>(
    'dag-execution',
    async (job: Job<DagExecutionJob>) => {
      let { runId, dagId, definition, triggeredBy = 'manual', environment = 'production', webhookPayload } = job.data;
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
        return await executeDagRun({ runId, definition, gateway, db, webhookPayload });
      } finally {
        if (isPersonalMode) {
          try {
            gateway.disconnect();
            console.log(`[DAG Worker] Personal mode: disconnected from local Gateway`);
          } catch {
            // 忽略清理错误
          }
        }
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
