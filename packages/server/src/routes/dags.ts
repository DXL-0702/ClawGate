import type { FastifyPluginAsync } from 'fastify';
import {
  getDb, schema, getDagQueue, addDagCronJob, removeDagCronJob, updateDagCronJob,
  getAuthContext, PERSONAL_TEAM_ID,
} from '@clawgate/core';
import { eq, or, isNull } from 'drizzle-orm';

/** DAG 定义（支持 nodes + edges）*/
interface DagDefinition {
  nodes: Array<{
    id: string;
    type: 'agent';
    agentId: string;
    prompt: string;
  }>;
  edges?: Array<{
    id: string;
    source: string;
    target: string;
    sourceHandle?: string;
    targetHandle?: string;
  }>;
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

function isValidCron(expression: string): boolean {
  const parts = expression.trim().split(/\s+/);
  return parts.length === 5;
}

export const dagRoutes: FastifyPluginAsync = async (app) => {

  // GET /api/dags — 列表
  // 个人模式：只显示 teamId = 'local'
  // 团队模式：显示同团队所有 DAG
  app.get('/dags', async (req) => {
    const auth = await getAuthContext(req.headers);
    const db = getDb();

    // 团队模式：显示所有同 team 的 DAG
    // 个人模式：只显示 teamId = 'local' 的 DAG
    const conditions = auth.mode === 'personal'
      ? [isNull(schema.dags.teamId).or(eq(schema.dags.teamId, PERSONAL_TEAM_ID))]
      : [eq(schema.dags.teamId, auth.teamId)];

    const dags = await db
      .select({
        id: schema.dags.id,
        name: schema.dags.name,
        trigger: schema.dags.trigger,
        enabled: schema.dags.enabled,
        createdAt: schema.dags.createdAt,
      })
      .from(schema.dags)
      .where(or(...conditions))
      .orderBy(schema.dags.createdAt);

    return { dags: dags.map((d) => ({ ...d, enabled: !!d.enabled })) };
  });

  // GET /api/dags/:id — 详情
  app.get<{ Params: { id: string } }>('/dags/:id', async (req, reply) => {
    const auth = await getAuthContext(req.headers);
    const db = getDb();

    const [dag] = await db
      .select()
      .from(schema.dags)
      .where(eq(schema.dags.id, req.params.id));

    if (!dag) {
      return reply.status(404).send({ error: 'DAG not found' });
    }

    // 团队模式下校验 teamId 一致
    if (auth.mode === 'team' && dag.teamId !== auth.teamId) {
      return reply.status(403).send({ error: 'Access denied' });
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

  // POST /api/dags — 创建
  app.post<{ Body: CreateDagBody }>('/dags', async (req, reply) => {
    try {
      const auth = await getAuthContext(req.headers);
      const { name, definition, trigger = 'manual', cronExpression, enabled = true } = req.body;

      if (!name || !name.trim()) {
        return reply.status(400).send({ error: 'name is required' });
      }

      if (!definition || !definition.nodes || definition.nodes.length === 0) {
        return reply.status(400).send({ error: 'at least one node is required' });
      }

      const node = definition.nodes[0];
      if (!node.agentId || !node.prompt) {
        return reply.status(400).send({ error: 'node must have agentId and prompt' });
      }

      if (trigger === 'cron' && cronExpression && !isValidCron(cronExpression)) {
        return reply.status(400).send({ error: 'Invalid cron expression' });
      }

      const db = getDb();
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      const webhookToken = trigger === 'webhook' ? crypto.randomUUID() : null;

      await db.insert(schema.dags).values({
        id,
        name: name.trim(),
        teamId: auth.teamId, // 个人模式 = 'local'，团队模式 = 实际 teamId
        definition: JSON.stringify(definition),
        trigger,
        cronExpression: cronExpression || null,
        enabled,
        webhookToken,
        createdAt: now,
        updatedAt: now,
      });

      if (trigger === 'cron' && enabled && cronExpression) {
        try {
          await addDagCronJob(id, cronExpression, definition);
        } catch (err) {
          app.log.warn({ err, dagId: id }, 'Failed to register DAG cron job');
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create DAG';
      return reply.status(401).send({ error: msg });
    }
  });

  // PATCH /api/dags/:id — 更新
  app.patch<{ Params: { id: string }; Body: UpdateDagBody }>('/dags/:id', async (req, reply) => {
    const auth = await getAuthContext(req.headers);
    const db = getDb();

    const [existing] = await db
      .select()
      .from(schema.dags)
      .where(eq(schema.dags.id, req.params.id));

    if (!existing) {
      return reply.status(404).send({ error: 'DAG not found' });
    }

    if (auth.mode === 'team' && existing.teamId !== auth.teamId) {
      return reply.status(403).send({ error: 'Access denied' });
    }

    const { name, definition, trigger, cronExpression, enabled } = req.body;
    const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };

    if (name !== undefined) {
      if (!name.trim()) return reply.status(400).send({ error: 'name cannot be empty' });
      updates.name = name.trim();
    }

    if (definition !== undefined) {
      if (!definition.nodes || definition.nodes.length === 0) {
        return reply.status(400).send({ error: 'definition must have at least one node' });
      }
      updates.definition = JSON.stringify(definition);
    }

    if (trigger !== undefined) updates.trigger = trigger;
    if (cronExpression !== undefined) {
      if (cronExpression && !isValidCron(cronExpression)) {
        return reply.status(400).send({ error: 'Invalid cron expression' });
      }
      updates.cronExpression = cronExpression || null;
    }
    if (enabled !== undefined) updates.enabled = enabled;

    await db.update(schema.dags).set(updates).where(eq(schema.dags.id, req.params.id));

    const newTrigger = trigger ?? existing.trigger;
    const newCron = cronExpression ?? existing.cronExpression;
    const newEnabled = enabled ?? !!existing.enabled;
    const newDefinition = definition ?? JSON.parse(existing.definition);

    if (newTrigger === 'cron') {
      await updateDagCronJob(req.params.id, newCron, newEnabled, newDefinition);
    } else {
      await removeDagCronJob(req.params.id);
    }

    return { id: req.params.id, ...updates };
  });

  // DELETE /api/dags/:id — 删除
  app.delete<{ Params: { id: string } }>('/dags/:id', async (req, reply) => {
    const auth = await getAuthContext(req.headers);
    const db = getDb();

    const [existing] = await db
      .select()
      .from(schema.dags)
      .where(eq(schema.dags.id, req.params.id));

    if (!existing) {
      return reply.status(404).send({ error: 'DAG not found' });
    }

    if (auth.mode === 'team' && existing.teamId !== auth.teamId) {
      return reply.status(403).send({ error: 'Access denied' });
    }

    await removeDagCronJob(req.params.id);
    await db.delete(schema.dags).where(eq(schema.dags.id, req.params.id));

    reply.status(204).send();
  });

  // POST /api/dags/:id/run — 手动触发执行
  app.post<{ Params: { id: string } }>('/dags/:id/run', async (req, reply) => {
    const auth = await getAuthContext(req.headers);
    const db = getDb();

    const [dag] = await db
      .select()
      .from(schema.dags)
      .where(eq(schema.dags.id, req.params.id));

    if (!dag) return reply.status(404).send({ error: 'DAG not found' });
    if (auth.mode === 'team' && dag.teamId !== auth.teamId) {
      return reply.status(403).send({ error: 'Access denied' });
    }
    if (!dag.enabled) return reply.status(400).send({ error: 'DAG is disabled' });

    const definition = JSON.parse(dag.definition) as DagDefinition;
    const runId = crypto.randomUUID();
    const now = new Date().toISOString();

    await db.insert(schema.dagRuns).values({
      id: runId,
      dagId: dag.id,
      teamId: auth.teamId,
      status: 'pending',
      triggeredBy: 'manual',
      createdAt: now,
    });

    const queue = getDagQueue();
    await queue.add('execute-dag', { runId, dagId: dag.id, triggeredBy: 'manual', definition });

    return { runId, status: 'pending' };
  });

  // POST /api/dags/:id/webhook — Webhook 触发（外部调用，无需认证）
  app.post<{ Params: { id: string }; Querystring: { token: string } }>(
    '/dags/:id/webhook',
    async (req, reply) => {
      const db = getDb();

      const [dag] = await db
        .select()
        .from(schema.dags)
        .where(eq(schema.dags.id, req.params.id));

      if (!dag) return reply.status(404).send({ error: 'DAG not found' });
      if (dag.trigger !== 'webhook') return reply.status(400).send({ error: 'DAG is not configured for webhook trigger' });
      if (!dag.enabled) return reply.status(400).send({ error: 'DAG is disabled' });
      if (dag.webhookToken !== req.query.token) return reply.status(401).send({ error: 'Invalid webhook token' });

      const definition = JSON.parse(dag.definition) as DagDefinition;
      const runId = crypto.randomUUID();
      const now = new Date().toISOString();

      await db.insert(schema.dagRuns).values({
        id: runId,
        dagId: dag.id,
        teamId: dag.teamId ?? PERSONAL_TEAM_ID,
        status: 'pending',
        triggeredBy: 'webhook',
        createdAt: now,
      });

      const queue = getDagQueue();
      await queue.add('execute-dag', { runId, dagId: dag.id, triggeredBy: 'webhook', definition });

      return { runId, status: 'pending', triggeredBy: 'webhook' };
    }
  );
};
