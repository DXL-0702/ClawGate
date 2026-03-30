import type { FastifyPluginAsync } from 'fastify';
import { RouterClient, getDb, schema, pushRoutingLog } from '@clawgate/core';

const router = new RouterClient();

export const routeRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/route — 请求路由决策
  app.post<{ Body: { prompt: string; session_key?: string } }>(
    '/route',
    async (req, reply) => {
      const { prompt, session_key } = req.body;
      if (!prompt) return reply.status(400).send({ error: 'prompt is required' });

      const decision = await router.route(prompt, session_key);

      // 异步写入 routing_logs（非阻塞）
      setImmediate(async () => {
        try {
          await pushRoutingLog({
            sessionKey: session_key ?? null,
            prompt,
            layer: decision.layer,
            model: decision.model,
            cacheHit: decision.cacheHit,
            latencyMs: decision.latencyMs,
          });
        } catch { /* non-fatal */ }
      });

      return decision;
    },
  );

  // GET /api/route/stats — 路由统计
  app.get('/route/stats', async () => {
    const stats = await router.stats();
    const routerHealthy = await router.health();
    return {
      router_healthy: routerHealthy,
      stats: stats ?? { total: 0, cache_hits: 0, hit_rate: 0 },
    };
  });
};
