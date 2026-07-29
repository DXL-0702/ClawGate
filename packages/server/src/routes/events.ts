import type { FastifyPluginAsync } from 'fastify';
import type { WebSocket } from '@fastify/websocket';

// 全局订阅者集合
const subscribers = new Set<WebSocket>();

export function broadcastEvent(event: Record<string, unknown>): void {
  const payload = JSON.stringify(event);
  // 先快照再迭代，避免在 for-of 中修改 Set 导致漏发
  const snapshot = [...subscribers];
  for (const ws of snapshot) {
    if (ws.readyState === 1) { // OPEN
      ws.send(payload);
    } else {
      subscribers.delete(ws);
    }
  }
}

export const eventsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/events', { websocket: true }, (socket) => {
    subscribers.add(socket);

    socket.send(JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() }));

    socket.on('close', () => {
      subscribers.delete(socket);
    });

    socket.on('error', () => {
      subscribers.delete(socket);
    });
  });
};
