import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { configReader, GatewayClient, initDb, loadYamlConfig } from '@clawgate/core';
import { agentRoutes } from './routes/agents.js';
import { sessionRoutes } from './routes/sessions.js';
import { healthRoutes } from './routes/health.js';
import { eventsRoutes, broadcastEvent } from './routes/events.js';
import { routeRoutes } from './routes/route.js';
import { openaiRoutes } from './routes/openai.js';

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

const cfg = configReader.get();
const gateway = new GatewayClient({ url: cfg.gatewayUrl, token: cfg.gatewayToken });
app.decorate('gateway', gateway);

// Connect gateway once at startup; reconnect loop handles drops automatically
try {
  await gateway.connect();
} catch {
  app.log.warn('OpenClaw Gateway not available at startup — will retry automatically');
}

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

try {
  await app.listen({ port: 3000, host: '0.0.0.0' });
  app.log.info('ClawGate API server running on http://localhost:3000');
  app.log.info('WebSocket events endpoint: ws://localhost:3000/ws/events');
} catch (err) {
  app.log.error(err);
  gateway.disconnect();
  process.exit(1);
}

process.on('SIGTERM', () => { gateway.disconnect(); process.exit(0); });
process.on('SIGINT',  () => { gateway.disconnect(); process.exit(0); });

// 导出 broadcastEvent 供测试使用
export { broadcastEvent };
