import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { existsSync } from 'fs';
import { join } from 'path';
import {
  configReader, GatewayClient, initDb, loadYamlConfig, generateDefaultConfig,
  connectRedis, disconnectRedis, disconnectBullMqRedis,
  initDagQueue, startDagWorker, stopDagWorker,
  startHealthCheckScheduler, startHealthCheckWorker, stopHealthCheck,
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
import { instanceRoutes } from './routes/instances.js';
import { teamRoutes } from './routes/teams.js';
import { memberRoutes } from './routes/members.js';
import { healthOverviewRoutes } from './routes/health-overview.js';
import { alertRoutes } from './routes/alerts.js';
import { statsRoutes } from './routes/stats.js';

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

// YAML 自生成：首次启动若配置不存在，生成默认 clawgate.yaml
const yamlPath = join(process.cwd(), 'clawgate.yaml');
if (!existsSync(yamlPath)) {
  try {
    await generateDefaultConfig(yamlPath);
    app.log.info(`Generated default clawgate.yaml at ${yamlPath}`);
  } catch (err) {
    app.log.warn({ err }, 'Failed to generate default clawgate.yaml');
  }
}
await loadYamlConfig();

// 初始化 SQLite
initDb();

// 初始化 Redis
await connectRedis();

const cfg = configReader.get();
const gateway = new GatewayClient({ url: cfg.gatewayUrl, token: cfg.gatewayToken });

// OpenClaw 可选模式：默认不要求 OpenClaw 可用（用户可只使用智能路由/OpenAI 兼容端点）
const requireOpenClaw = process.env['CLAWGATE_REQUIRE_OPENCLAW'] === 'true';
let openclawConnected = false;

try {
  await gateway.connect();
  openclawConnected = true;
  app.log.info('OpenClaw Gateway connected successfully');
} catch (err) {
  const error = err instanceof Error ? err.message : String(err);
  // 停止 GatewayClient 内部的重连循环，防止 unhandled rejection 崩溃进程
  gateway.disconnect();
  if (requireOpenClaw) {
    app.log.error({ err: error }, 'OpenClaw Gateway required but unreachable — exiting');
    process.exit(1);
  }
  app.log.warn({ err: error },
    'OpenClaw Gateway unavailable — running in standalone mode. ' +
    'Smart routing and /v1/chat/completions remain available. ' +
    'Agent/Session/DAG features will be disabled.');
}

// 初始化 DAG 执行队列
initDagQueue();

// 启动 DAG Worker（使用 GatewayPool 动态选择实例）
startDagWorker();
app.log.info('DAG Worker started with GatewayPool');

// 启动实例健康检查定时任务
startHealthCheckScheduler();
startHealthCheckWorker();
app.log.info('Instance health check scheduler started (running every minute)');

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
await app.register(instanceRoutes, { prefix: '/api' });
await app.register(teamRoutes, { prefix: '/api' });
await app.register(memberRoutes, { prefix: '/api' });
await app.register(healthOverviewRoutes, { prefix: '/api' });
await app.register(alertRoutes, { prefix: '/api' });
await app.register(statsRoutes, { prefix: '/api' });

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
  await stopHealthCheck();
  await disconnectBullMqRedis();
  await disconnectRedis();
  gateway.disconnect();
  process.exit(0);
});
process.on('SIGINT',  async () => {
  await stopDagWorker();
  await stopHealthCheck();
  await disconnectBullMqRedis();
  await disconnectRedis();
  gateway.disconnect();
  process.exit(0);
});

// 导出 broadcastEvent 供测试使用
export { broadcastEvent };
