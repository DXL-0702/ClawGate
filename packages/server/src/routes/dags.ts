import type { FastifyPluginAsync } from 'fastify';
import { getDb, schema, getDagQueue } from '@clawgate/core';
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
      status: 'pending',
      createdAt: now,
    });

    // 4. 添加到 BullMQ 队列异步执行
    const queue = getDagQueue();
    await queue.add('execute-dag', {
      runId,
      dagId: dag.id,
      definition,
    });

    // 立即返回 runId，前端轮询获取状态
    return { runId, status: 'pending' };
  });

};
