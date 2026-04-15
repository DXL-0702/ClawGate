import type { FastifyPluginAsync } from 'fastify';
import { getDb, schema } from '@clawgate/core';
import { eq } from 'drizzle-orm';

export const dagRunRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/dag-runs/:runId - 查询执行详情（含节点状态）
  app.get<{ Params: { runId: string } }>('/dag-runs/:runId', async (req, reply) => {
    const db = getDb();
    const { runId } = req.params;

    // 查询 run 基本信息
    const [run] = await db
      .select()
      .from(schema.dagRuns)
      .where(eq(schema.dagRuns.id, runId));

    if (!run) {
      return reply.status(404).send({ error: 'Run not found' });
    }

    // 查询节点状态
    const nodes = await db
      .select({
        nodeId: schema.dagNodeStates.nodeId,
        status: schema.dagNodeStates.status,
        output: schema.dagNodeStates.output,
        error: schema.dagNodeStates.error,
        startedAt: schema.dagNodeStates.startedAt,
        endedAt: schema.dagNodeStates.endedAt,
        createdAt: schema.dagNodeStates.createdAt,
      })
      .from(schema.dagNodeStates)
      .where(eq(schema.dagNodeStates.runId, runId));

    return {
      id: run.id,
      dagId: run.dagId,
      status: run.status,
      output: run.output,
      error: run.error,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      createdAt: run.createdAt,
      nodes,
    };
  });
};
