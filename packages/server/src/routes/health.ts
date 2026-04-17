import type { FastifyPluginAsync } from 'fastify';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async () => {
    const openclawConnected = app.gateway ? app.gateway.isConnected() : false;
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      openclaw: {
        connected: openclawConnected,
        mode: openclawConnected ? 'integrated' : 'standalone',
      },
    };
  });
};
