import type { FastifyPluginAsync } from 'fastify';
import { getDb, schema, getDagQueue, addDagCronJob, removeDagCronJob, updateDagCronJob } from '@clawgate/core';
import { eq, and } from 'drizzle-orm';

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
  trigger?: 'manual' | 'cron' | 'webhook';
  cronExpression?: string;
  enabled?: boolean;
}

interface UpdateDagBody {
  name?: string;
  definition?: DagDefinition;
  trigger?: 'manual' | 'cron' | 'webhook';
  cronExpression?: string;
  enabled?: boolean;
}

// 简单的 Cron 表达式校验
function isValidCron(expression: string): boolean {
  // 基础校验：5个部分，由空格分隔
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  return true;
}

export const dagRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/dags - 列表
  app.get('/dags', async () => {
    const db = getDb();
    const dags = await db
      .select({
        id: schema.dags.id,
        name: schema.dags.name,
        trigger: schema.dags.trigger,
        enabled: schema.dags.enabled,
        createdAt: schema.dags.createdAt,
      })
      .from(schema.dags)
      .orderBy(schema.dags.createdAt);

    // 转换 enabled 为 boolean
    return {
      dags: dags.map(d => ({ ...d, enabled: !!d.enabled })),
    };
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
      trigger: dag.trigger,
      cronExpression: dag.cronExpression,
      enabled: !!dag.enabled,
      webhookToken: dag.webhookToken,
      createdAt: dag.createdAt,
      updatedAt: dag.updatedAt,
    };
  });

  // POST /api/dags - 创建
  app.post<{ Body: CreateDagBody }>('/dags', async (req, reply) => {
    const { name, definition, trigger = 'manual', cronExpression, enabled = true } = req.body;

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

    // Cron 表达式校验
    if (trigger === 'cron' && cronExpression) {
      if (!isValidCron(cronExpression)) {
        return reply.status(400).send({ error: 'Invalid cron expression. Format: "* * * * *" (minute hour day month weekday)' });
      }
    }

    const db = getDb();
    const now = new Date().toISOString();
    const id = crypto.randomUUID();

    // Webhook token 生成
    const webhookToken = trigger === 'webhook' ? crypto.randomUUID() : null;

    await db.insert(schema.dags).values({
      id,
      name: name.trim(),
      definition: JSON.stringify(definition),
      trigger,
      cronExpression: cronExpression || null,
      enabled: enabled,
      webhookToken,
      createdAt: now,
      updatedAt: now,
    });

    // 如果启用了 Cron，立即注册定时任务
    if (trigger === 'cron' && enabled && cronExpression) {
      try {
        await addDagCronJob(id, cronExpression, definition);
      } catch (err) {
        app.log.warn({ err, dagId: id }, 'Failed to register DAG cron job');
        // 不阻塞创建，记录警告即可
      }
    }

    return {
      id,
      name: name.trim(),
      definition,
      trigger,
      cronExpression,
      enabled: !!enabled,
      webhookToken,
      createdAt: now,
    };
  });

  // PATCH /api/dags/:id - 更新（包括触发器配置）
  app.patch<{ Params: { id: string }; Body: UpdateDagBody }>('/dags/:id', async (req, reply) => {
    const db = getDb();

    // 1. 获取现有 DAG
    const [existing] = await db
      .select()
      .from(schema.dags)
      .where(eq(schema.dags.id, req.params.id));

    if (!existing) {
      return reply.status(404).send({ error: 'DAG not found' });
    }

    const { name, definition, trigger, cronExpression, enabled } = req.body;
    const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };

    // 校验并应用更新
    if (name !== undefined) {
      if (!name.trim()) {
        return reply.status(400).send({ error: 'name cannot be empty' });
      }
      updates.name = name.trim();
    }

    if (definition !== undefined) {
      if (!definition.nodes || definition.nodes.length === 0) {
        return reply.status(400).send({ error: 'definition must have at least one node' });
      }
      updates.definition = JSON.stringify(definition);
    }

    if (trigger !== undefined) {
      updates.trigger = trigger;
    }

    if (cronExpression !== undefined) {
      if (cronExpression && !isValidCron(cronExpression)) {
        return reply.status(400).send({ error: 'Invalid cron expression' });
      }
      updates.cronExpression = cronExpression || null;
    }

    if (enabled !== undefined) {
      updates.enabled = enabled;
    }

    // 2. 更新数据库
    await db
      .update(schema.dags)
      .set(updates)
      .where(eq(schema.dags.id, req.params.id));

    // 3. 同步 Cron 任务
    const newTrigger = trigger ?? existing.trigger;
    const newCron = cronExpression ?? existing.cronExpression;
    const newEnabled = enabled ?? !!existing.enabled;  // 转换 0/1 为 boolean
    const newDefinition = definition ?? JSON.parse(existing.definition);

    if (newTrigger === 'cron') {
      await updateDagCronJob(req.params.id, newCron, newEnabled, newDefinition);
    } else {
      // 非 Cron 类型，移除可能存在的 Cron 任务
      await removeDagCronJob(req.params.id);
    }

    return {
      id: req.params.id,
      ...updates,
    };
  });

  // DELETE /api/dags/:id - 删除
  app.delete<{ Params: { id: string } }>('/dags/:id', async (req, reply) => {
    const db = getDb();

    const [existing] = await db
      .select()
      .from(schema.dags)
      .where(eq(schema.dags.id, req.params.id));

    if (!existing) {
      return reply.status(404).send({ error: 'DAG not found' });
    }

    // 1. 移除 Cron 任务
    await removeDagCronJob(req.params.id);

    // 2. 删除数据库记录（级联删除 dag_runs 和 dag_node_states）
    await db.delete(schema.dags).where(eq(schema.dags.id, req.params.id));

    reply.status(204).send();
  });

  // POST /api/dags/:id/run - 手动触发执行
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

    if (!dag.enabled) {
      return reply.status(400).send({ error: 'DAG is disabled' });
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
      triggeredBy: 'manual',
      createdAt: now,
    });

    // 4. 添加到 BullMQ 队列异步执行
    const queue = getDagQueue();
    await queue.add('execute-dag', {
      runId,
      dagId: dag.id,
      triggeredBy: 'manual',
      definition,
    });

    // 立即返回 runId，前端轮询获取状态
    return { runId, status: 'pending' };
  });

  // POST /api/dags/:id/webhook - Webhook 触发（外部调用）
  app.post<{ Params: { id: string }; Querystring: { token: string } }>('/dags/:id/webhook', async (req, reply) => {
    const db = getDb();

    // 1. 获取 DAG
    const [dag] = await db
      .select()
      .from(schema.dags)
      .where(eq(schema.dags.id, req.params.id));

    if (!dag) {
      return reply.status(404).send({ error: 'DAG not found' });
    }

    // 2. 校验 Webhook 配置
    if (dag.trigger !== 'webhook') {
      return reply.status(400).send({ error: 'DAG is not configured for webhook trigger' });
    }

    if (!dag.enabled) {
      return reply.status(400).send({ error: 'DAG is disabled' });
    }

    // 3. 校验 Token
    if (dag.webhookToken !== req.query.token) {
      return reply.status(401).send({ error: 'Invalid webhook token' });
    }

    // 4. 解析定义
    const definition = JSON.parse(dag.definition) as DagDefinition;

    // 5. 创建执行记录
    const runId = crypto.randomUUID();
    const now = new Date().toISOString();

    await db.insert(schema.dagRuns).values({
      id: runId,
      dagId: dag.id,
      status: 'pending',
      triggeredBy: 'webhook',
      createdAt: now,
    });

    // 6. 添加到队列
    const queue = getDagQueue();
    await queue.add('execute-dag', {
      runId,
      dagId: dag.id,
      triggeredBy: 'webhook',
      definition,
    });

    return { runId, status: 'pending', triggeredBy: 'webhook' };
  });
};
