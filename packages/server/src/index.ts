import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import staticPlugin from '@fastify/static';
import { existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
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

// ── Web UI 静态资源（生产 Docker 内置） ──────────────────────
// 路径解析顺序：
//   1. WEB_DIST 环境变量（Docker 镜像设为 /app/public）
//   2. 默认裸机开发：相对 packages/server/dist/ 的 ../../web/dist
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const webDistPath = process.env['WEB_DIST']
  ?? resolve(__dirname, '../../web/dist');

if (existsSync(webDistPath)) {
  await app.register(staticPlugin, {
    root: webDistPath,
    prefix: '/',
    wildcard: false,
    cacheControl: true,
    maxAge: '7d',
    setHeaders: (res, filePath) => {
      // index.html 不缓存（每次拉取最新版）
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      }
    },
  });

  // SPA fallback：仅对导航类路径（无扩展名或 .html）回退 index.html
  // 真实静态资源（.js/.css/.map/.png 等）缺失时保持 404，便于前端发现资源问题
  app.setNotFoundHandler((req, reply) => {
    const url = req.url;
    const isApi = url.startsWith('/api') || url.startsWith('/v1') || url.startsWith('/ws');
    if (req.method === 'GET' && !isApi) {
      // 提取 pathname（去除 query string）后判断扩展名
      const pathname = url.split('?')[0] ?? url;
      const lastSegment = pathname.split('/').pop() ?? '';
      const hasAssetExtension = lastSegment.includes('.') && !lastSegment.endsWith('.html');
      if (!hasAssetExtension) {
        return reply.type('text/html').sendFile('index.html');
      }
    }
    return reply.status(404).send({ error: 'Not Found', path: url });
  });

  app.log.info(`Web UI served from ${webDistPath}`);
} else {
  app.log.warn(`Web dist not found at ${webDistPath} — running API-only`);
}

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
