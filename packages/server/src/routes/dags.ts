import type { FastifyPluginAsync } from 'fastify';
import { getDb, schema } from '@clawgate/core';
import { eq } from 'drizzle-orm';

// Week 1: 单节点 DAG 定义
interface DagDefinition {
  nodes: {
    id: string;
    type: 'agent';
    agentId: string;
    prompt: string;
  }[];
  edges?: never; // Week 1 无连线
}

interface CreateDagBody {
  name: string;
  definition: DagDefinition;
}

export const dagRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/dags - 列表
  app.get('/dags', async () => {
    const db = getDb();
    const dags = await db
      .select({
        id: schema.dags.id,
        name: schema.dags.name,
        createdAt: schema.dags.createdAt,
      })
      .from(schema.dags)
      .orderBy(schema.dags.createdAt);

    return { dags };
  });

  // GET /api/dags/:id - 详情
  app.get<{ Params: { id: string } }>('/dags/:id', async (req, reply) => {
    const db = getDb();
    const [dag] = await db
      .select()
      .from(schema.dags)
      .where(eq(schema.dags.id, req.params.id));

    if (!dag) {
      return reply.status(404).send({ error: 'DAG not found' });
    }

    return {
      id: dag.id,
      name: dag.name,
      definition: JSON.parse(dag.definition) as DagDefinition,
      createdAt: dag.createdAt,
      updatedAt: dag.updatedAt,
    };
  });

  // POST /api/dags - 创建
  app.post<{ Body: CreateDagBody }>('/dags', async (req, reply) => {
    const { name, definition } = req.body;

    if (!name || !name.trim()) {
      return reply.status(400).send({ error: 'name is required' });
    }

    if (!definition || !definition.nodes || definition.nodes.length === 0) {
      return reply.status(400).send({ error: 'definition with at least one node is required' });
    }

    // Week 1: 验证单节点配置
    const node = definition.nodes[0];
    if (!node.agentId || !node.prompt) {
      return reply.status(400).send({ error: 'node must have agentId and prompt' });
    }

    const db = getDb();
    const now = new Date().toISOString();
    const id = crypto.randomUUID();

    await db.insert(schema.dags).values({
      id,
      name: name.trim(),
      definition: JSON.stringify(definition),
      createdAt: now,
      updatedAt: now,
    });

    return {
      id,
      name: name.trim(),
      definition,
      createdAt: now,
    };
  });

  // POST /api/dags/:id/run - 触发执行
  app.post<{ Params: { id: string } }>('/dags/:id/run', async (req, reply) => {
    const db = getDb();

    // 1. 获取 DAG
    const [dag] = await db
      .select()
      .from(schema.dags)
      .where(eq(schema.dags.id, req.params.id));

    if (!dag) {
      return reply.status(404).send({ error: 'DAG not found' });
    }

    // 2. 解析定义
    const definition = JSON.parse(dag.definition) as DagDefinition;

    // 3. 创建执行记录
    const runId = crypto.randomUUID();
    const now = new Date().toISOString();

    await db.insert(schema.dagRuns).values({
      id: runId,
      dagId: dag.id,
      status: 'running',
      createdAt: now,
      startedAt: now,
    });

    // 4. Week 1: 单节点执行
    // TODO: Week 2 接入 OpenClaw Gateway，Week 1 使用 mock 响应
    const node = definition.nodes[0];

    try {
      // Mock 响应（后续接入 Gateway）
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const mockResponse = `[Mock] Agent "${node.agentId}" 执行 Prompt: "${node.prompt.slice(0, 50)}..."`;

      // 更新为成功状态
      const endedAt = new Date().toISOString();
      await db
        .update(schema.dagRuns)
        .set({
          status: 'completed',
          output: mockResponse,
          endedAt,
        })
        .where(eq(schema.dagRuns.id, runId));

      return { runId, status: 'completed' };
    } catch (error) {
      // 更新为失败状态
      const endedAt = new Date().toISOString();
      const errorMsg = error instanceof Error ? error.message : 'Execution failed';

      await db
        .update(schema.dagRuns)
        .set({
          status: 'failed',
          error: errorMsg,
          endedAt,
        })
        .where(eq(schema.dagRuns.id, runId));

      return { runId, status: 'failed', error: errorMsg };
    }
  });

  // GET /api/dag-runs/:runId - 查询执行状态
  app.get<{ Params: { runId: string } }>('/dag-runs/:runId', async (req, reply) => {
    const db = getDb();
    const [run] = await db
      .select()
      .from(schema.dagRuns)
      .where(eq(schema.dagRuns.id, req.params.runId));

    if (!run) {
      return reply.status(404).send({ error: 'Run not found' });
    }

    return {
      id: run.id,
      dagId: run.dagId,
      status: run.status,
      output: run.output,
      error: run.error,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      createdAt: run.createdAt,
    };
  });
};
