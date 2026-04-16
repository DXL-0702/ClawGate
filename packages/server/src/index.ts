import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import {
  configReader, GatewayClient, initDb, loadYamlConfig,
  connectRedis, disconnectRedis, disconnectBullMqRedis,
  initDagQueue, startDagWorker, stopDagWorker,
} from '@clawgate/core';
import { agentRoutes } from './routes/agents.js';
import { sessionRoutes } from './routes/sessions.js';
import { healthRoutes } from './routes/health.js';
import { eventsRoutes, broadcastEvent } from './routes/events.js';
import { routeRoutes } from './routes/route.js';
import { openaiRoutes } from './routes/openai.js';
import { dagRoutes } from './routes/dags.js';
import { dagRunRoutes } from './routes/dag-runs.js';
import { feedbackRoutes } from './routes/feedback.js';
import { openclawLifecycleRoutes } from './routes/openclaw-lifecycle.js';

declare module 'fastify' {
  interface FastifyInstance {
    gateway: GatewayClient;
  }
}

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
await app.register(websocket);

await configReader.load();
configReader.watch().catch(() => {});
await loadYamlConfig();

// 初始化 SQLite
initDb();

// 初始化 Redis
await connectRedis();

const cfg = configReader.get();
const gateway = new GatewayClient({ url: cfg.gatewayUrl, token: cfg.gatewayToken });

// Connect gateway FIRST before starting Worker
try {
  await gateway.connect();
  app.log.info('OpenClaw Gateway connected successfully');
} catch (err) {
  const error = err instanceof Error ? err.message : String(err);
  app.log.error({ err: error }, 'OpenClaw Gateway connection failed');
  app.log.warn('Gateway not available — DAG execution will fail');
}

// 初始化 DAG 执行队列
initDagQueue();

// 启动 DAG Worker（在 Gateway 连接之后）
startDagWorker(gateway);
app.log.info('DAG Worker started');

// 启动时注册所有启用的 Cron DAG
import { getDb as getDbForCron, schema as schemaForCron, updateDagCronJob } from '@clawgate/core';
import { eq, and } from 'drizzle-orm';

(async () => {
  try {
    const db = getDbForCron();
    const cronDags = await db
      .select()
      .from(schemaForCron.dags)
      .where(and(
        eq(schemaForCron.dags.trigger, 'cron'),
        eq(schemaForCron.dags.enabled, true)
      ));

    for (const dag of cronDags) {
      try {
        const definition = JSON.parse(dag.definition);
        await updateDagCronJob(dag.id, dag.cronExpression, true, definition);
        app.log.info(`Registered cron DAG: ${dag.name} (${dag.cronExpression})`);
      } catch (err) {
        app.log.error({ err, dagId: dag.id }, 'Failed to register cron DAG on startup');
      }
    }

    if (cronDags.length > 0) {
      app.log.info(`Total cron DAGs registered: ${cronDags.length}`);
    }
  } catch (err) {
    app.log.error({ err }, 'Failed to initialize cron DAGs on startup');
  }
})();

app.decorate('gateway', gateway);

// 将 Gateway 推送事件桥接到 WebSocket 广播
const GATEWAY_EVENTS = ['session.start', 'session.end', 'session.message', 'session.failed'];
for (const event of GATEWAY_EVENTS) {
  gateway.onEvent(event, (data) => {
    broadcastEvent({ type: event, timestamp: new Date().toISOString(), ...(data as object) });
  });
}

await app.register(healthRoutes, { prefix: '/api' });
await app.register(agentRoutes, { prefix: '/api' });
await app.register(sessionRoutes, { prefix: '/api' });
await app.register(eventsRoutes, { prefix: '/ws' });
await app.register(routeRoutes, { prefix: '/api' });
await app.register(openaiRoutes, { prefix: '/v1' });
await app.register(dagRoutes, { prefix: '/api' });
await app.register(dagRunRoutes, { prefix: '/api' });
await app.register(feedbackRoutes, { prefix: '/api' });
await app.register(openclawLifecycleRoutes, { prefix: '/api' });

try {
  await app.listen({ port: 3000, host: '0.0.0.0' });
  app.log.info('ClawGate API server running on http://localhost:3000');
  app.log.info('WebSocket events endpoint: ws://localhost:3000/ws/events');
} catch (err) {
  app.log.error(err);
  gateway.disconnect();
  process.exit(1);
}

process.on('SIGTERM', async () => {
  await stopDagWorker();
  await disconnectBullMqRedis();
  await disconnectRedis();
  gateway.disconnect();
  process.exit(0);
});
process.on('SIGINT',  async () => {
  await stopDagWorker();
  await disconnectBullMqRedis();
  await disconnectRedis();
  gateway.disconnect();
  process.exit(0);
});

// 导出 broadcastEvent 供测试使用
export { broadcastEvent };
