import type { FastifyPluginAsync } from 'fastify';
import { getDb, schema, getAuthContext, PERSONAL_TEAM_ID } from '@clawgate/core';
import { eq, and, or, isNull, sql, desc } from 'drizzle-orm';

export const dagRunRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/dags/:dagId/runs - 查询指定 DAG 的执行历史列表
  app.get<{
    Params: { dagId: string };
    Querystring: { limit?: string; offset?: string };
  }>('/dags/:dagId/runs', async (req, reply) => {
    const auth = await getAuthContext(req.headers);
    const db = getDb();
    const { dagId } = req.params;
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10) || 20, 1), 100);
    const offset = Math.max(parseInt(req.query.offset || '0', 10) || 0, 0);

    // 校验 DAG 存在 + 归属
    const [dag] = await db
      .select({ id: schema.dags.id, teamId: schema.dags.teamId })
      .from(schema.dags)
      .where(eq(schema.dags.id, dagId));

    if (!dag) {
      return reply.status(404).send({ error: 'DAG not found' });
    }

    if (auth.mode === 'team' && dag.teamId !== auth.teamId) {
      return reply.status(403).send({ error: 'Access denied' });
    }

    // 查询 total
    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.dagRuns)
      .where(eq(schema.dagRuns.dagId, dagId));

    const total = countResult?.count ?? 0;

    // 查询 runs（按 createdAt DESC）
    const runs = await db
      .select({
        id: schema.dagRuns.id,
        status: schema.dagRuns.status,
        triggeredBy: schema.dagRuns.triggeredBy,
        startedAt: schema.dagRuns.startedAt,
        endedAt: schema.dagRuns.endedAt,
        createdAt: schema.dagRuns.createdAt,
      })
      .from(schema.dagRuns)
      .where(eq(schema.dagRuns.dagId, dagId))
      .orderBy(desc(schema.dagRuns.createdAt))
      .limit(limit)
      .offset(offset);

    // 计算 duration(ms)
    const runsWithDuration = runs.map((r) => {
      let duration: number | null = null;
      if (r.startedAt && r.endedAt) {
        duration = new Date(r.endedAt).getTime() - new Date(r.startedAt).getTime();
      }
      return { ...r, duration };
    });

    return { runs: runsWithDuration, total };
  });

  // GET /api/dag-runs/:runId - 查询执行详情（含节点状态）
  app.get<{ Params: { runId: string } }>('/dag-runs/:runId', async (req, reply) => {
    const auth = await getAuthContext(req.headers);
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

    // 团队模式校验 teamId
    if (auth.mode === 'team' && run.teamId && run.teamId !== auth.teamId) {
      return reply.status(403).send({ error: 'Access denied' });
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

    // 计算 run duration
    let duration: number | null = null;
    if (run.startedAt && run.endedAt) {
      duration = new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime();
    }

    return {
      id: run.id,
      dagId: run.dagId,
      status: run.status,
      triggeredBy: run.triggeredBy,
      output: run.output,
      error: run.error,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      createdAt: run.createdAt,
      duration,
      nodes,
    };
  });
};
