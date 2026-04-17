import type { FastifyPluginAsync } from 'fastify';
import { getDb, schema, getRedis, REDIS_KEYS, RouterClient, getYamlConfig } from '@clawgate/core';
import { sql, desc } from 'drizzle-orm';

const routerUrl = process.env['ROUTER_URL'] ?? 'http://127.0.0.1:3001';
const routerClient = new RouterClient(routerUrl);

export const statsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/stats/overview', async (_req, reply) => {
    const db = getDb();

    // ── 路由层统计（SQLite routing_logs） ────────────────
    let routing = { total: 0, by_layer: { L1: 0, L2: 0, L3: 0 } as Record<string, number>, layer_pct: {} as Record<string, number>, avg_latency_ms: 0 };
    try {
      const rows = await db
        .select({
          layer: schema.routingLogs.layer,
          count: sql<number>`count(*)`,
          avgLatency: sql<number>`avg(${schema.routingLogs.latencyMs})`,
        })
        .from(schema.routingLogs)
        .groupBy(schema.routingLogs.layer);

      let total = 0;
      let totalLatency = 0;
      for (const row of rows) {
        const count = Number(row.count);
        routing.by_layer[row.layer] = count;
        total += count;
        totalLatency += (Number(row.avgLatency) || 0) * count;
      }
      routing.total = total;
      routing.avg_latency_ms = total > 0 ? totalLatency / total : 0;

      for (const layer of Object.keys(routing.by_layer)) {
        routing.layer_pct[layer] = total > 0
          ? Math.round((routing.by_layer[layer] / total) * 10000) / 100
          : 0;
      }
    } catch { /* SQLite not ready */ }

    // ── 今日实时成本（Redis） ────────────────────────────
    let todayUsd = 0;
    const byModel: Record<string, { tokens: number; usd: number }> = {};
    try {
      const redis = getRedis();
      const today = new Date().toISOString().slice(0, 10);
      const key = REDIS_KEYS.costsRealtime(today);
      const all = await redis.hgetall(key);

      for (const [field, value] of Object.entries(all)) {
        if (field.endsWith(':estimated_usd')) {
          const model = field.replace(':estimated_usd', '');
          const usd = parseFloat(value) || 0;
          todayUsd += usd;
          if (!byModel[model]) byModel[model] = { tokens: 0, usd: 0 };
          byModel[model].usd = usd;
        } else if (field.endsWith(':token_input') || field.endsWith(':token_output')) {
          const parts = field.split(':');
          const model = parts.slice(0, -1).join(':');
          const tokens = parseInt(value, 10) || 0;
          if (!byModel[model]) byModel[model] = { tokens: 0, usd: 0 };
          byModel[model].tokens += tokens;
        }
      }
    } catch { /* Redis not ready */ }

    const config = getYamlConfig();
    const budgetLimit = config.budgets?.daily_limit_usd ?? 0;
    const budgetPct = budgetLimit > 0 ? Math.round((todayUsd / budgetLimit) * 10000) / 100 : 0;

    // ── 近 7 日成本趋势（SQLite costs 表） ──────────────
    const trend: { dates: string[]; usd: number[] } = { dates: [], usd: [] };
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const rows = await db
        .select({
          date: schema.costs.date,
          totalUsd: sql<number>`sum(${schema.costs.estimatedUsd})`,
        })
        .from(schema.costs)
        .where(sql`${schema.costs.date} >= ${sevenDaysAgo}`)
        .groupBy(schema.costs.date)
        .orderBy(schema.costs.date);

      for (const row of rows) {
        trend.dates.push(row.date);
        trend.usd.push(Math.round((Number(row.totalUsd) || 0) * 10000) / 10000);
      }
    } catch { /* no historical data yet */ }

    // ── 熔断器状态（Rust service） ──────────────────────
    let circuit: Record<string, { state: string; allowed: boolean }> | null = null;
    try {
      const raw = await routerClient.circuitStatus();
      if (raw) {
        circuit = {};
        for (const [name, status] of Object.entries(raw)) {
          circuit[name] = { state: status.state, allowed: status.allowed };
        }
      }
    } catch { /* Rust not available */ }

    return reply.send({
      routing,
      costs: {
        today_usd: Math.round(todayUsd * 10000) / 10000,
        budget_limit_usd: budgetLimit,
        budget_used_pct: budgetPct,
        by_model: byModel,
      },
      trend,
      circuit,
    });
  });
};
