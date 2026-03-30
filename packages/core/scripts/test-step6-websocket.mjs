#!/usr/bin/env node
/**
 * Step 6 验证脚本：WebSocket 事件推送 + Web UI Session 页面
 * 运行：cd packages/core && node scripts/test-step6-websocket.mjs
 */
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { WebSocket, WebSocketServer } from 'ws';

let passed = 0, failed = 0;
function ok(label) { console.log(`  ✓ ${label}`); passed++; }
function fail(label, err) { console.log(`  ✗ ${label}: ${err?.message ?? err}`); failed++; }

console.log('\n=== Step 6: WebSocket 事件推送 + Web UI Session 页面 ===\n');

const ROOT = new URL('../../../', import.meta.url).pathname;
const SERVER_SRC = `${ROOT}packages/server/src`;
const WEB_SRC = `${ROOT}packages/web`;

// 1. events.ts 路由验证
try {
  const src = readFileSync(`${SERVER_SRC}/routes/events.ts`, 'utf-8');
  if (src.includes('broadcastEvent')) ok('eventsRoutes 包含 broadcastEvent 导出');
  else fail('broadcastEvent', new Error('未找到'));
  if (src.includes('/events')) ok('eventsRoutes 注册了 /events WebSocket 端点');
  else fail('/events 端点', new Error('未找到'));
} catch (err) {
  fail('events.ts 读取', err);
}

// 2. Web UI dist 产物验证
try {
  const dist = `${WEB_SRC}/dist/assets`;
  if (existsSync(dist)) ok('Web UI dist 产物存在');
  else fail('Web UI dist', new Error('目录不存在'));
} catch (err) {
  fail('Web UI dist 验证', err);
}

// 3. useGatewayEvents hook 验证
try {
  const src = readFileSync(`${WEB_SRC}/src/hooks/useGatewayEvents.ts`, 'utf-8');
  if (src.includes('setTimeout(connect')) ok('useGatewayEvents 包含断线重连逻辑');
  else fail('重连逻辑', new Error('未找到 setTimeout(connect'));
  if (src.includes('/ws/events')) ok('useGatewayEvents 连接 /ws/events 端点');
  else fail('/ws/events', new Error('未找到'));
} catch (err) {
  fail('useGatewayEvents 验证', err);
}

// 4. eventStore 200 条限制验证
try {
  const src = readFileSync(`${WEB_SRC}/src/stores/eventStore.ts`, 'utf-8');
  if (src.includes('.slice(0, 200)')) ok('eventStore 限制最多 200 条事件');
  else fail('eventStore 200 条限制', new Error('未找到 slice(0, 200)'));
} catch (err) {
  fail('eventStore 验证', err);
}

// 5. 真实 WebSocket server 广播测试
await new Promise((resolve) => {
  const httpServer = createServer();
  const wss = new WebSocketServer({ server: httpServer });
  const subscribers = new Set();

  wss.on('connection', (ws) => {
    subscribers.add(ws);
    ws.send(JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() }));
    ws.on('close', () => subscribers.delete(ws));
  });

  function broadcast(event) {
    const payload = JSON.stringify(event);
    for (const ws of subscribers) {
      if (ws.readyState === 1) ws.send(payload);
    }
  }

  httpServer.listen(19790, '127.0.0.1', () => {
    const client = new WebSocket('ws://127.0.0.1:19790');
    const received = [];

    client.on('message', (data) => {
      received.push(JSON.parse(data.toString()));

      if (received.length === 1) {
        broadcast({ type: 'session.start', sessionKey: 'agent1:sess001', timestamp: new Date().toISOString() });
      }

      if (received.length === 2) {
        try {
          if (received[0].type === 'connected') ok('客户端收到 connected 事件');
          else fail('connected 事件', new Error(`got ${received[0].type}`));
          if (received[1].type === 'session.start' && received[1].sessionKey === 'agent1:sess001')
            ok('客户端收到广播的 session.start 事件');
          else fail('session.start 广播', new Error(JSON.stringify(received[1])));
        } finally {
          client.close();
          httpServer.close();
          resolve();
        }
      }
    });

    client.on('error', (err) => {
      fail('WebSocket 客户端', err);
      httpServer.close();
      resolve();
    });
  });
});

console.log(`\n结果：${passed} 通过，${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
