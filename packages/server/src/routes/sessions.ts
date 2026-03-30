import type { FastifyPluginAsync } from 'fastify';
import { getDb, schema, incrCostRealtime, pushRoutingLog } from '@clawgate/core';
import { eq, sql } from 'drizzle-orm';

interface CreateSessionBody {
  agentId: string;
}

interface RecordUsageBody {
  tokenInput: number;
  tokenOutput: number;
  model: string;
  estimatedUsd?: number;
}

export const sessionRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/sessions?agentId=xxx
  app.get('/sessions', async (req) => {
    const { agentId } = req.query as { agentId?: string };
    const sessions = await app.gateway.listSessions(agentId);
    return { sessions, total: sessions.length };
  });

  // POST /api/sessions — 创建新 Session
  app.post<{ Body: CreateSessionBody }>('/sessions', async (req, reply) => {
    const { agentId } = req.body;
    if (!agentId) return reply.status(400).send({ error: 'agentId is required' });
    const session = await app.gateway.createSession(agentId);
    // 持久化到 SQLite
    try {
      const now = new Date().toISOString();
      const db = getDb();
      await db.insert(schema.sessions).values({
        key: session.key,
        agentId: session.agentId,
        sessionId: session.sessionId,
        status: 'active',
        tokenInput: 0,
        tokenOutput: 0,
        model: null,
        createdAt: now,
        updatedAt: now,
      }).onConflictDoNothing();
    } catch {
      // DB write failure is non-fatal
    }
    return session;
  });

  // DELETE /api/sessions/:key — 终止 Session
  app.delete<{ Params: { key: string } }>('/sessions/:key', async (req, reply) => {
    const { key } = req.params;
    await app.gateway.abortSession(key);
    try {
      const db = getDb();
      await db
        .update(schema.sessions)
        .set({ status: 'ended', updatedAt: new Date().toISOString() })
        .where(eq(schema.sessions.key, key));
    } catch {
      // DB write failure is non-fatal
    }
    reply.status(204);
  });

  // POST /api/sessions/:key/usage — 记录 Token 用量
  app.post<{ Params: { key: string }; Body: RecordUsageBody }>(
    '/sessions/:key/usage',
    async (req, reply) => {
      const { key } = req.params;
      const { tokenInput, tokenOutput, model, estimatedUsd = 0 } = req.body;
      const today = new Date().toISOString().slice(0, 10);
      const now = new Date().toISOString();

      // Redis 实时累计（可选，Redis 不可用时跳过）
      try {
        await incrCostRealtime(today, model, tokenInput, tokenOutput, estimatedUsd);
      } catch { /* Redis not available */ }

      // SQLite 持久化（累加写）
      try {
        const db = getDb();
        await db
          .update(schema.sessions)
          .set({
            tokenInput: sql`token_input + ${tokenInput}`,
            tokenOutput: sql`token_output + ${tokenOutput}`,
            model,
            updatedAt: now,
          })
          .where(eq(schema.sessions.key, key));
      } catch { /* DB not available */ }

      reply.status(204);
    },
  );
};
